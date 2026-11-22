import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const inputs = [
  'src', 'public', 'assets/generated', 'assets/originals', 'index.html',
  'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json',
  'tools/build-id.mjs', 'tools/build-playtest.mjs',
];

function sourceFiles(path) {
  const absolute = join(root, path);
  return statSync(absolute).isDirectory()
    ? readdirSync(absolute).flatMap(name => sourceFiles(`${path}/${name}`))
    : [path];
}

export function releaseBuildId(version) {
  const hash = createHash('sha256');
  for (const file of inputs.flatMap(sourceFiles).sort()) {
    const bytes = readFileSync(join(root, file));
    hash.update(`${file}\0${bytes.length}\0`).update(bytes);
  }
  return `${version}+${hash.digest('hex').slice(0, 12)}`;
}
