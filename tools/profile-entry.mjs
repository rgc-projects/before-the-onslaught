import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { preview } from 'vite';

const directories = process.argv.slice(2);
assert.ok(directories.length, 'Pass one or more production build directories.');
const browserChannel = process.env.NINE_KINGDOMS_BROWSER ?? 'msedge';
const base = '/releases/nine-kingdoms/';
const cpuRate = 4;
const network = { offline: false, latency: 150, downloadThroughput: 250_000, uploadThroughput: 125_000 };
const repetitions = 5;
const servers = new Map();
let browser;
try {
  for (const directory of directories) {
    servers.set(directory, await preview({ base, preview: { host: '127.0.0.1', port: 0 }, build: { outDir: directory } }));
  }
  browser = await chromium.launch({ channel: browserChannel });
  await mkdir('test-results', { recursive: true });
  const results = [];
  for (let repeat = 0; repeat < repetitions; repeat++) {
    for (const [directory, server] of servers) {
      const address = `http://127.0.0.1:${server.httpServer.address().port}${base}`;
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      try {
        const page = await context.newPage();
        const errors = [];
        const atlasRequests = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('requestfailed', request => errors.push(request.url()));
        page.on('request', request => {
          if (!request.url().startsWith(address)) errors.push(request.url());
          if (/nine-kingdoms-sprites-.+\.webp$/.test(request.url())) atlasRequests.push(request.url());
        });
        await page.addInitScript(() => {
          const times = window.entryTimes = {};
          function record() {
            if (!times.menu && document.getElementById('new-run')) times.menu = performance.now();
            if (!times.battlefield && document.querySelector('#field canvas[aria-hidden="true"]')) times.battlefield = performance.now();
            if (!times.atlas && document.documentElement?.dataset.atlasReady === 'true') times.atlas = performance.now();
            const crest = document.querySelector('.menu-crest img');
            if (!times.crest && times.menu && (crest ? crest.complete && crest.naturalWidth : times.atlas)) times.crest = performance.now();
            if (times.menu && times.battlefield && times.atlas && times.crest) {
              observer.disconnect();
              document.removeEventListener('load', record, true);
            }
          }
          const observer = new MutationObserver(record);
          observer.observe(document, { attributes: true, childList: true, subtree: true, attributeFilter: ['data-atlas-ready'] });
          document.addEventListener('load', record, true);
        });
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', network);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
        await page.goto(address);
        await page.waitForFunction(() => window.entryTimes?.battlefield && window.entryTimes?.atlas
          && window.entryTimes?.menu && window.entryTimes?.crest);
        const result = await page.evaluate(() => {
          const resources = performance.getEntriesByType('resource');
          const atlas = resources.find(entry => /nine-kingdoms-sprites-.+\.webp$/.test(entry.name));
          const script = resources.find(entry => /\/assets\/index-.+\.js$/.test(entry.name));
          const engine = resources.find(entry => /\/assets\/phaser-core-.+\.js$/.test(entry.name));
          const { menu, crest, atlas: atlasReady, battlefield } = window.entryTimes;
          return { menu, crest, battlefield, ready: Math.max(menu, atlasReady, battlefield), atlasStart: atlas.startTime,
            atlasEnd: atlas.responseEnd, scriptEnd: script.responseEnd, scriptTransferred: script.encodedBodySize,
            engineTransferred: engine?.encodedBodySize ?? 0 };
        });
        assert.deepEqual(errors, []);
        assert.equal(atlasRequests.length, 1, 'The main atlas should be fetched once.');
        if (repeat === 0) await page.locator('.menu-crest').screenshot({ path: `test-results/entry-crest-${directories.indexOf(directory)}.png` });
        results.push({ directory, ...result });
      } finally {
        await context.close();
      }
    }
  }
  const median = values => Math.round(values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)]);
  console.log(`${browserChannel} ${browser.version()} · ${cpuRate}× CPU · 150 ms latency · 2 Mbps download · ${repetitions} cold loads each.`);
  console.table(directories.map(directory => {
    const rows = results.filter(row => row.directory === directory);
    const keys = ['menu', 'crest', 'battlefield', 'ready', 'atlasStart', 'atlasEnd', 'scriptEnd', 'scriptTransferred', 'engineTransferred'];
    return { directory, ...Object.fromEntries(keys.map(key => [key, median(rows.map(row => row[key]))])) };
  }));
} finally {
  await browser?.close();
  await Promise.all([...servers.values()].map(server => new Promise((resolve, reject) =>
    server.httpServer.close(error => error ? reject(error) : resolve()))));
}
