import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, relative, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';
import { chromium, firefox } from 'playwright';

const args = process.argv.slice(2);
const priorDirectory = args.find(arg => !arg.startsWith('--'));
const inspectUrl = args.find(arg => arg.startsWith('--inspect='))?.slice('--inspect='.length);
const hostedUrl = args.find(arg => arg.startsWith('--url='))?.slice('--url='.length);
assert.ok(args.length === Number(priorDirectory !== undefined) + Number(inspectUrl !== undefined) + Number(hostedUrl !== undefined)
  && (inspectUrl !== undefined ? !priorDirectory && hostedUrl === undefined : priorDirectory),
  'Pass an older dist directory, add --url=https://host/game/ for a hosted update, or use --inspect=https://host/game/ for one build.');
const channel = process.env.NINE_KINGDOMS_BROWSER ?? 'msedge';
const mount = '/releases/nine-kingdoms/';
const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
  png: 'image/png', webp: 'image/webp', ogg: 'audio/ogg', txt: 'text/plain; charset=utf-8' };
const immutable = 'public, max-age=31536000, immutable';
const hashedAsset = name => /^assets\/.+-[\w-]{8}\.[a-z]+$/.test(name);
const extension = name => name.split('.').at(-1);
const compressed = name => ['html', 'js', 'css'].includes(extension(name));

async function readRelease(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const files = await Promise.all(entries.filter(entry => entry.isFile()).map(async entry => {
    const path = join(entry.path, entry.name);
    const name = relative(directory, path).split(sep).join('/');
    const body = await readFile(path);
    const etag = `W/"${createHash('sha256').update(body).digest('base64url')}"`;
    return [name, { body, etag, gzip: compressed(name) ? gzipSync(body) : undefined }];
  }));
  const release = new Map(files);
  assert.ok(release.has('index.html'), `No index.html in ${directory}`);
  return release;
}

function releaseUrl(value) {
  const address = new URL(value);
  assert.ok(['http:', 'https:'].includes(address.protocol) && address.pathname.endsWith('/')
    && !address.search && !address.hash && !address.username && !address.password,
    'Pass a complete HTTP(S) release directory URL ending in /, without credentials or a query.');
  return address.href;
}

const request = (url, headers = {}) => fetch(url, {
  headers: { 'Accept-Encoding': 'gzip, br', ...headers }, redirect: 'manual', signal: AbortSignal.timeout(12000),
});
const readBody = async response => Buffer.from(await response.arrayBuffer());

function validator(response, address) {
  const etag = response.headers.get('etag');
  if (etag) return { 'If-None-Match': etag };
  const modified = response.headers.get('last-modified');
  assert.ok(modified && Number.isFinite(Date.parse(modified)), `${address} needs an ETag or valid Last-Modified`);
  return { 'If-Modified-Since': modified };
}

async function checkFile(base, name, file, useDirectory = false) {
  const address = new URL(useDirectory ? '' : name, base).href;
  const response = await request(address);
  if (name === 'index.html' && !useDirectory && [301, 302, 307, 308].includes(response.status)) {
    const location = response.headers.get('location');
    assert.ok(location && new URL(location, address).href === base, `${address}: unexpected redirect ${location}`);
    return response;
  }
  assert.equal(response.status, 200, `${address}: HTTP ${response.status}, expected 200`);
  const actualType = response.headers.get('content-type')?.split(';')[0]?.toLowerCase();
  const expectedType = types[extension(name)]?.split(';')[0];
  const validTypes = expectedType === 'text/javascript' ? [expectedType, 'application/javascript'] : [expectedType];
  assert.ok(expectedType && validTypes.includes(actualType), `${address}: unexpected Content-Type ${actualType}`);
  const cache = new Set((response.headers.get('cache-control') ?? '').toLowerCase().split(',').map(value => value.trim()));
  if (hashedAsset(name)) {
    assert.ok(['public', 'max-age=31536000', 'immutable'].every(value => cache.has(value))
      && !['private', 'no-store', 'no-cache'].some(value => cache.has(value)), `${address}: expected immutable public cache`);
  } else {
    assert.ok(cache.has('no-cache'), `${address}: expected cache revalidation`);
    const unchanged = await request(address, validator(response, address));
    assert.equal(unchanged.status, 304, `${address}: unchanged conditional request should return 304`);
  }
  if (['js', 'css'].includes(extension(name))) {
    assert.match(response.headers.get('content-encoding') ?? '', /^(?:gzip|br)$/i, `${address}: expected gzip or Brotli`);
  }
  assert.ok((await readBody(response)).equals(file.body), `${address}: content differs from the release artifact`);
  return response;
}

async function checkRelease(base, release) {
  await Promise.all([...release].map(([name, file]) => checkFile(base, name, file)));
  return checkFile(base, 'index.html', release.get('index.html'), true);
}

if (inspectUrl !== undefined) {
  const address = releaseUrl(inspectUrl);
  const release = await readRelease('dist');
  const entry = await checkRelease(address, release);
  console.log(`${address}: matched ${release.size} files and directory entry, MIME types, cache validators and JS/CSS compression. Entry encoding: ${entry.headers.get('content-encoding') ?? 'identity'}.`);
  process.exit(0);
}

const [prior, current] = await Promise.all([readRelease(priorDirectory), readRelease('dist')]);
assert.notEqual(current.get('index.html').etag, prior.get('index.html').etag, 'Use two distinct builds.');
let published = prior;
const server = hostedUrl === undefined ? createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  const name = pathname === mount ? 'index.html' : pathname.startsWith(mount) ? pathname.slice(mount.length) : '';
  const hashed = hashedAsset(name);
  const file = published.get(name) ?? (hashed ? prior.get(name) : undefined);
  if (!file) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader('Cache-Control', hashed ? immutable : 'no-cache');
  res.setHeader('ETag', file.etag);
  if (file.gzip) res.setHeader('Vary', 'Accept-Encoding');
  if (req.headers['if-none-match'] === file.etag) {
    res.writeHead(304).end();
    return;
  }
  res.setHeader('Content-Type', types[name.split('.').at(-1)] ?? 'application/octet-stream');
  const gzip = file.gzip && req.headers['accept-encoding']?.includes('gzip');
  if (gzip) res.setHeader('Content-Encoding', 'gzip');
  res.end(gzip ? file.gzip : file.body);
}) : undefined;

if (server) await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
const url = server ? new URL(mount, `http://127.0.0.1:${server.address().port}`).href : releaseUrl(hostedUrl);
async function waitForHostedUpdate() {
  const until = Date.now() + 10 * 60 * 1000;
  console.log(`Previous build and its reward checkpoint verified. Waiting up to 10 minutes for the current build at ${url}.`);
  while (Date.now() < until) {
    const response = await request(url, { 'Cache-Control': 'no-cache' });
    assert.equal(response.status, 200, url);
    const body = await readBody(response);
    if (body.equals(current.get('index.html').body)) return;
    assert.ok(body.equals(prior.get('index.html').body), `${url}: entry matches neither release`);
    await delay(2000);
  }
  assert.fail(`${url}: timed out waiting for the current release`);
}

let browser;
try {
  const verifiedOld = await checkRelease(url, prior);
  const oldValidator = validator(verifiedOld, url);
  browser = channel === 'firefox' ? await firefox.launch() : await chromium.launch({ channel });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  const failedEngineRequests = [];
  let rejectedEngineUrl;
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => {
    if (request.url() === rejectedEngineUrl) failedEngineRequests.push(request.url());
    else errors.push(`${request.failure()?.errorText}: ${request.url()}`);
  });
  page.on('request', request => { if (!request.url().startsWith(url)) errors.push(request.url()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`); });
  const button = name => page.getByRole('button', { name, exact: true });
  const readStorage = () => page.evaluate(() => ({
    checkpoint: JSON.parse(localStorage.getItem('nine-kingdoms-run-v1')),
    backup: JSON.parse(localStorage.getItem('nine-kingdoms-run-backup-v1')),
    settings: JSON.parse(localStorage.getItem('nine-kingdoms-settings')),
  }));
  const ready = () => page.waitForFunction(() => document.documentElement.dataset.atlasReady === 'true');

  const oldDocument = await page.goto(url);
  await ready();
  assert.equal(oldDocument.url(), url);
  assert.ok((await oldDocument.body()).equals(prior.get('index.html').body), 'Browser must start on the verified previous version');
  await page.locator('#menu-settings').click();
  await page.locator('#mute').check();
  await page.locator('#frame-rate').selectOption('60');
  await page.locator('#close-settings').click();
  await page.getByLabel('战役').selectOption('march');
  await page.getByLabel('王国', { exact: true }).selectOption('iron');
  await page.getByLabel('战局种子').fill('119');
  await button('开始部署').click();
  for (const [card, column, row] of [['watch', 6, 3], ['watch', 6, 5], ['farm', 5, 2], ['guard', 8, 4]]) {
    await page.locator(`#hand [data-card="${card}"]`).first().click();
    await page.getByRole('button', { name: new RegExp(`^${column}列${row}行 `) }).click();
  }
  await page.getByLabel('守军阵势').selectOption('bank');
  await button('开始战斗').click();
  const reward = page.getByRole('heading', { name: '选择战利品', exact: true });
  await reward.waitFor({ timeout: 60000 });
  const old = await readStorage();
  assert.equal(old.checkpoint.run.phase, 'reward');
  assert.equal(old.checkpoint.run.buildings.length, 3);
  assert.equal(old.checkpoint.run.rally.length, 1);
  assert.equal(old.checkpoint.run.formation, 'bank');
  assert.equal(old.settings.frameRate, '60');
  assert.equal(old.settings.muted, true);

  if (server) published = current;
  else await waitForHostedUpdate();
  await checkRelease(url, current);
  const changed = await request(url, oldValidator);
  assert.equal(changed.status, 200, 'Old validator must receive the updated index');
  assert.ok((await readBody(changed)).equals(current.get('index.html').body));
  const oldOnly = [...prior].filter(([name]) => hashedAsset(name) && !current.has(name));
  await Promise.all(oldOnly.map(([name, file]) => checkFile(url, name, file)));

  const updatedDocument = await page.reload();
  assert.equal(updatedDocument.url(), url);
  assert.ok((await updatedDocument.body()).equals(current.get('index.html').body), 'Browser reload must load the new version');
  await ready();

  const atlasFile = /\/nine-kingdoms-sprites-[\w-]+\.webp$/;
  let resumeAtlas;
  const atlasGate = new Promise(resolve => { resumeAtlas = resolve; });
  await page.route(atlasFile, async route => {
    await atlasGate;
    await route.continue();
  });
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const crest = window.document.querySelector('.menu-crest img');
      return crest?.complete && crest.naturalWidth === 96;
    });
    assert.equal(await page.locator('html').getAttribute('data-atlas-ready'), null);
  } finally {
    resumeAtlas();
  }
  await ready();
  await page.unroute(atlasFile);
  assert.deepEqual(await readStorage(), old);
  await button('继续战局').click();
  await reward.waitFor();
  const offers = page.locator('[data-reward]');
  assert.deepEqual(await offers.evaluateAll(nodes => nodes.map(node => node.dataset.reward)), old.checkpoint.run.rewards);
  const chosen = await offers.first().getAttribute('data-reward');
  await offers.first().click();
  const saved = await readStorage();
  assert.equal(saved.checkpoint.run.phase, 'planning');
  assert.equal(saved.checkpoint.run.wave, 1);
  assert.ok(saved.checkpoint.version >= old.checkpoint.version);
  assert.ok(saved.checkpoint.run.hand.includes(chosen));
  assert.deepEqual(saved.checkpoint.run.pastWaves.map(wave => [wave.wave, wave.reward]), [[0, chosen]]);
  for (const key of ['seed', 'kingdom', 'formation', 'rally', 'keepHp', 'defeated', 'chronicleId']) {
    assert.deepEqual(saved.checkpoint.run[key], old.checkpoint.run[key], key);
  }
  // Cooldowns are local to the previous battle and reset when a stable checkpoint is loaded.
  assert.deepEqual(saved.checkpoint.run.buildings, old.checkpoint.run.buildings.map(building => ({ ...building, cooldown: 0 })));
  assert.deepEqual(saved.checkpoint, saved.backup);
  assert.deepEqual(saved.settings, old.settings);
  await page.reload();
  await button('继续战局').click();
  assert.equal(await page.getByLabel('守军阵势').inputValue(), 'bank');
  assert.deepEqual(await readStorage(), saved);

  const engineFile = [...current.keys()].find(name => /^assets\/phaser-core-.+\.js$/.test(name));
  if (server && engineFile) {
    const engineUrl = new URL(engineFile, url).href;
    let resumeEngine;
    const engineGate = new Promise(resolve => { resumeEngine = resolve; });
    const holdEngine = async route => {
      await engineGate;
      await route.continue();
    };
    await page.route(engineUrl, holdEngine);
    try {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await button('继续战局').click();
      const waiting = button('正在加载战场…');
      await waiting.waitFor();
      assert.equal(await waiting.isDisabled(), true);
      assert.equal(await page.locator('#field canvas').count(), 0);
      assert.deepEqual(await readStorage(), saved);
    } finally {
      resumeEngine();
    }
    await button('开始战斗').waitFor();
    await page.unroute(engineUrl, holdEngine);

    rejectedEngineUrl = engineUrl;
    await page.route(engineUrl, route => route.abort(), { times: 1 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await button('继续战局').click();
    await page.getByText('战场加载失败。请检查连接后重新加载页面。', { exact: true }).waitFor();
    assert.equal(await page.locator('#field canvas').count(), 0);
    assert.deepEqual(await readStorage(), saved);
    await button('重新加载页面').click();
    await button('继续战局').click();
    await button('开始战斗').waitFor();
    assert.deepEqual(failedEngineRequests, [engineUrl]);
    assert.deepEqual(await readStorage(), saved);
    console.log(`${channel}: menu, battlefield loading, and reload recovery verified with a delayed and failed engine request.`);
  }

  assert.deepEqual(errors, []);
  await mkdir('test-results', { recursive: true });
  const prefix = hostedUrl === undefined ? 'release-update' : 'release-update-hosted';
  await page.screenshot({ path: `test-results/${prefix}-${channel}.png` });
  console.log(`${channel} ${browser.version()} at ${url}: verified ${prior.size} previous files, ${current.size} current files and ${oldOnly.length} retained hashes. Menu, checkpoint v${old.checkpoint.version} → v${saved.checkpoint.version}, settings and wave 2 resume passed.`);
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
}
