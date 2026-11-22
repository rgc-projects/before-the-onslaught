import { defineConfig, transformWithEsbuild } from 'vite';
import type { Plugin } from 'vite';
import { version } from './package.json';
import { releaseBuildId } from './tools/build-id.mjs';

// Phaser's source treats these typeof expressions as compile-time feature flags.
// Fold them before CommonJS resolves optional renderer and audio dependencies.
const canvasPhaser: Plugin = {
  name: 'nine-kingdoms-phaser-canvas',
  enforce: 'pre',
  transform(source, id) {
    if (!id.includes('/node_modules/phaser/src/') || !id.endsWith('.js')) return;
    const code = source.replace(/\btypeof (CANVAS_RENDERER|WEBGL_RENDERER|FEATURE_SOUND|PLUGIN_CAMERA3D|PLUGIN_FBINSTANT)\b/g,
      (_, feature: string) => feature === 'CANVAS_RENDERER' ? 'true' : 'false');
    if (code !== source) return transformWithEsbuild(code, id, { loader: 'js', minifySyntax: true });
  },
};

export default defineConfig(({ command }) => ({
  base: './',
  define: { __NINE_KINGDOMS_BUILD__: JSON.stringify(command === 'build' ? releaseBuildId(version) : `${version}+dev`) },
  ...(command === 'build' ? {
    resolve: { alias: [{ find: /^phaser$/, replacement: 'phaser/src/phaser-core.js' }] },
    plugins: [canvasPhaser],
  } : {}),
}));
