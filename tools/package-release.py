"""Build the static, offline and source delivery archives from this project."""

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parent.parent
ROOT_FILES = (
    '.editorconfig', '.gitattributes', '.gitignore', 'AGENTS.md', 'ART_DIRECTION.md',
    'GAME_DESIGN.md', 'README.md', 'ROADMAP.md', 'TASKS.md', 'TECH_DESIGN.md',
    'TEST_PLAN.md', 'THIRD_PARTY_NOTICES.md', 'index.html', 'package-lock.json',
    'package.json', 'progress.md', 'tsconfig.json', 'vite.config.ts', 'wrangler.jsonc',
)
SOURCE_DIRS = ('assets', 'docs', 'public', 'src', 'tests', 'tools')
SOURCE_EXTS = frozenset('.css .html .js .json .md .mjs .mts .ogg .png .py .ts .txt .webp'.split())
EXCLUDED_DIRS = {'__pycache__', 'build', 'coverage', 'dist', 'node_modules', 'test-results'}


def project_files(directory):
    if not directory.is_dir() or directory.resolve() != directory:
        raise RuntimeError(f'Expected a project directory: {directory}')
    for folder, directories, files in os.walk(directory):
        parent = Path(folder)
        directories[:] = sorted(name for name in directories
                                if not name.startswith('.') and name not in EXCLUDED_DIRS
                                and (parent / name).resolve() == parent / name)
        for name in sorted(files):
            file = parent / name
            if (not name.startswith('.') and name != 'project.private.config.json'
                    and file.suffix in SOURCE_EXTS and file.is_file() and file.resolve() == file):
                yield file


def build_id(path):
    result = subprocess.run(['node', '--input-type=module', '--eval',
                             "import { readFileSync } from 'node:fs';"
                             "import { releaseBuildId } from './tools/build-id.mjs';"
                             "const { version } = JSON.parse(readFileSync('package.json', 'utf8'));"
                             "console.log(releaseBuildId(version));"], cwd=path, text=True,
                            stdout=subprocess.PIPE, check=True)
    tag = result.stdout.strip()
    if re.fullmatch(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\+[0-9a-f]{12}', tag) is None:
        raise RuntimeError(f'Unexpected build identifier: {tag}')
    return tag


def write_archive(path, entries):
    with ZipFile(path, mode='x') as archive:
        for name, source in sorted(entries.items()):
            if not source.is_file() or source.resolve() != source or not source.is_relative_to(ROOT):
                raise RuntimeError(f'Expected a project file: {source}')
            info = ZipInfo(name)
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, source.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=6)
    with ZipFile(path) as archive:
        if archive.testzip() is not None or archive.namelist() != sorted(entries):
            raise RuntimeError(f'Archive integrity check failed: {path.name}')
    return {
        'name': path.name, 'files': len(entries), 'size': path.stat().st_size,
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def release_entries(tag):
    dist = ROOT / 'dist'
    offline = ROOT / 'build/Nine Kingdoms.html'
    entry = (dist / 'index.html').read_text(encoding='utf-8')
    scripts = list((dist / 'assets').glob('index-*.js'))
    if (tag.encode() not in offline.read_bytes() or not any(
            f'./{script.relative_to(dist).as_posix()}' in entry and tag.encode() in script.read_bytes()
            for script in scripts)):
        raise RuntimeError('The offline and static outputs must both match the source build identifier')

    playtest = ROOT / 'docs/PLAYTEST.md'
    deployment = ROOT / 'docs/DEPLOYMENT.md'
    source = [ROOT / file for file in ROOT_FILES]
    for directory in SOURCE_DIRS:
        source.extend(project_files(ROOT / directory))
    return {
        'offline-playtest': {offline.name: offline, playtest.name: playtest},
        'static-release-candidate': {
            **{file.relative_to(ROOT).as_posix(): file for file in project_files(dist)},
            playtest.name: playtest, deployment.name: deployment,
        },
        'source': {f'before-the-onslaught/{file.relative_to(ROOT).as_posix()}': file for file in source},
    }


def main():
    releases = ROOT / 'build/releases'
    for output in (ROOT / 'dist', ROOT / 'build/Nine Kingdoms.html', releases):
        if output.resolve() != output:
            raise RuntimeError(f'The build output must be inside this project: {output}')
    npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
    if npm is None:
        raise RuntimeError('npm is required to build the release')

    tag = build_id(ROOT)
    for script in ('build', 'build:playtest'):
        subprocess.run([npm, 'run', script], cwd=ROOT, check=True)

    label = tag.replace('+', '-')
    entries = release_entries(tag)
    releases.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix='.package-', dir=releases) as temporary:
        staged = Path(temporary) / 'delivery'
        staged.mkdir()
        records = {kind: write_archive(staged / f'before-the-onslaught-{label}-{kind}.zip', paths)
                   for kind, paths in entries.items()}
        with ZipFile(staged / records['source']['name']) as archive:
            snapshot = Path(temporary) / 'snapshot'
            for name in archive.namelist():
                member = PurePosixPath(name)
                target = (snapshot / member).resolve()
                if not target.is_relative_to(snapshot):
                    raise RuntimeError(f'Unexpected source archive path: {name}')
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(name))
            if build_id(snapshot / 'before-the-onslaught') != tag or build_id(ROOT) != tag:
                raise RuntimeError('Source package does not match the built game')

        manifest = (json.dumps({'build': tag, 'packages': records}, indent=2) + '\n').encode('utf-8')
        (staged / 'release.json').write_bytes(manifest)
        fingerprint = hashlib.sha256(manifest).hexdigest()[:12]
        destination = releases / f'{label}-{fingerprint}'
        if destination.resolve() != destination:
            raise RuntimeError('The delivery directory must be inside the release directory')
        try:
            staged.rename(destination)
        except OSError:
            if not destination.is_dir():
                raise
            if ((destination / 'release.json').read_bytes() != manifest or any(
                    hashlib.sha256((destination / record['name']).read_bytes()).hexdigest() != record['sha256']
                    for record in records.values())):
                raise RuntimeError(f'Existing delivery failed verification: {destination}')
    print(f'Release {tag}: {destination}')


if __name__ == '__main__':
    main()
