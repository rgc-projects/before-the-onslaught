import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'vite';

const result = await build({
  build: {
    write: false,
    copyPublicDir: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
if (!('output' in result)) throw new Error('Expected a single production bundle');

const entry = result.output.find(page => page.type === 'chunk' && page.isEntry);
const page = result.output.find(asset => asset.fileName === 'index.html');
const stylesheet = result.output.find(asset => asset.type === 'asset' && asset.fileName.endsWith('.css'));
if (!entry || !page || !stylesheet || result.output.length !== 3 || entry.imports.length || entry.dynamicImports.length) {
  throw new Error('The playtest page must have one bundled script and one stylesheet, with assets inlined');
}
const css = String(stylesheet.source);
if (/<\/script|<!--/i.test(entry.code) || /<\/style/i.test(css)) {
  throw new Error('The build contains markup that cannot be embedded safely');
}

const icon = (await readFile('public/crest.png')).toString('base64');
const licenseDirectory = 'public/licenses';
const licensePaths = (await readdir(licenseDirectory)).sort();
const licenses = await Promise.all(licensePaths.map(async name =>
  `=== ${name} ===\n${await readFile(join(licenseDirectory, name), 'utf8')}`));
const notice = licenses.join('\n');
if (notice.includes('-->')) throw new Error('License text cannot be embedded safely');

let html = String(page.source);
function replaceTag(tag, replacement) {
  if (!html.includes(tag)) throw new Error(`Missing tag in production HTML: ${tag}`);
  html = html.replace(tag, () => replacement);
}
replaceTag('href="./crest.png"', `href="data:image/png;base64,${icon}"`);
replaceTag('</body>', `<!-- Third-party licenses\n${notice}\n-->\n</body>`);
replaceTag(`<link rel="stylesheet" crossorigin href="./${stylesheet.fileName}">`, `<style>\n${css}\n</style>`);
replaceTag(`<script type="module" crossorigin src="./${entry.fileName}"></script>`, `<script type="module">\n${entry.code}\n</script>`);

await mkdir('build', { recursive: true });
const destination = join('build', 'Nine Kingdoms.html');
await writeFile(destination, html);
console.log(`Offline playtest: ${destination} (${Buffer.byteLength(html)} bytes)`);
