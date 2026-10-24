/** P0.5 browser acceptance. Run against the loopback fixture server after npm run build.
 * Public evidence contains demo assets only. Any real-photo screenshots stay under data/.
 * Real mobile hardware, display colorimetry, HDR and NAS/WebDAV are outside this harness.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const baseURL = process.env.MUSEUM_URL || 'http://127.0.0.1:8787';
const executablePath = process.env.MUSEUM_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const publicDir = path.join(root, 'docs/design/previews/p05');
const privateDir = path.join(root, 'data/prototype-verification');
const evidencePath = path.join(root, 'docs/research/p05-browser-evidence.json');
await Promise.all([fs.mkdir(publicDir, { recursive: true }), fs.mkdir(privateDir, { recursive: true })]);
const evidence = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  baseURL,
  scope: 'Loopback P0.5 fixture; browser behavior and resource accounting, not NAS or physical-display acceptance.',
  limitations: [
    'Mobile results use Chromium viewport/touch emulation on this Mac, not an actual phone.',
    'Texture byte counters are application estimates, not measured GPU memory.',
    'No colorimeter, HDR output acceptance, Safari verification or full-library WebDAV scan.',
    'Failure scenarios are deliberately injected local fixture responses.'
  ],
  browser: {},
  checks: [],
  screenshots: [],
  consoleErrors: [],
  uncaughtErrors: [],
};
const browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
evidence.browser.version = browser.version();
evidence.browser.executable = path.basename(executablePath);
let page;
let context;
let currentCase = 'startup';
let inPrivate = false;
let originalRequests = [];
const readyPhases = ['detail_ready', 'developing', 'detail_visible'];
const errorPhases = ['detail_unavailable', 'source_changed', 'error'];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function invoke(method, ...args) {
  return page.evaluate(({ method, args }) => {
    const fn = window.__museum?.[method];
    if (typeof fn !== 'function') throw new Error(`Missing __museum.${method}`);
    return fn(...args);
  }, { method, args });
}
async function snapshot() { return page.evaluate(() => window.__museum.snapshot()); }
function summarize(s) {
  return {
    mode: s.mode, phase: s.phase, quality: s.quality, zoom: s.zoom,
    generation: s.generation, previewReady: s.previewReady,
    tileCount: s.tileCount, contextLost: s.contextLost,
    photoTextures: s.photoTextures, renderer: s.renderer,
    frameStats: s.frameStats, canvasCount: s.canvasCount,
    reducedMotion: s.reducedMotion,
    // Source titles, file paths, GPS and image payloads are intentionally absent.
    errorPresent: Boolean(s.error),
  };
}
function textureBytes(s) {
  const p = s.photoTextures || {};
  const bytes = p.bytes ?? p.residentBytes ?? p.estimatedBytes ?? p.usedBytes;
  assert.equal(typeof bytes, 'number', 'snapshot must expose texture byte accounting');
  return bytes;
}
function textureBudget(s) {
  const p = s.photoTextures || {};
  return p.budgetBytes ?? p.budget ?? 128 * 1024 * 1024;
}
function assertBudget(s) {
  assert.ok(textureBytes(s) <= textureBudget(s), `texture bytes ${textureBytes(s)} exceed budget ${textureBudget(s)}`);
}
async function waitState(predicate, timeout = 20_000) {
  const start = Date.now();
  let s;
  while (Date.now() - start < timeout) {
    s = await snapshot();
    if (predicate(s)) return s;
    await sleep(35);
  }
  throw new Error(`State timeout: ${JSON.stringify(summarize(s || {}))}`);
}
async function waitReady(id) {
  return waitState(s => s.assetId === id && readyPhases.includes(s.phase));
}
async function waitVisible(id) {
  return waitState(s => s.assetId === id && s.phase === 'detail_visible');
}
async function freshPage(options = {}) {
  if (context) await context.close();
  const { maxTextureSizeOverride, ...contextOptions } = options;
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, ...contextOptions });
  if (maxTextureSizeOverride) await context.addInitScript(limit => {
    const original = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function(parameter) {
      const result = original.call(this, parameter);
      return parameter === this.MAX_TEXTURE_SIZE ? Math.min(result, limit) : result;
    };
  }, maxTextureSizeOverride);
  page = await context.newPage();
  originalRequests = [];
  page.on('pageerror', error => evidence.uncaughtErrors.push({ case: currentCase, message: error.message }));
  page.on('console', message => {
    if (message.type() === 'error') {
      const text = message.text();
      // Fixture 401/503 and context-loss diagnostics are recorded but are expected.
      const expected = /Failed to load resource.*(?:401|503)|CONTEXT_LOST_WEBGL/i.test(text);
      evidence.consoleErrors.push({ case: currentCase, expected, message: inPrivate ? 'Private collection console error (see local run).' : text });
    }
  });
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/media/') && /\/(?:original|tile)(?:\/|$)/.test(url.pathname)) {
      originalRequests.push({ at: Date.now(), path: url.pathname, search: url.search });
    }
  });
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__museum && window.__museum.catalog?.assets?.length > 0);
  const bundle = await page.evaluate(() => new URL(document.querySelector('script[src]').src).pathname);
  if (evidence.browser.bundleFile) assert.equal(bundle, evidence.browser.bundleFile, 'build changed during verification; rerun against one stable build');
  else evidence.browser.bundleFile = bundle;
  await page.evaluate(() => { window.__qaCanvas = document.querySelector('canvas'); });
  await waitState(s => s.mode === 'theme' || s.mode === 'wall');
  return page.evaluate(() => window.__museum.catalog.assets.map(a => ({
    id: a.id, width: a.width, height: a.height, kind: a.detail.kind, sourceKind: a.sourceKind
  })));
}
async function assertCanvas() {
  const surface = await page.evaluate(() => {
    const canvases = [...document.querySelectorAll('canvas')];
    const canvas = canvases[0];
    const r = canvas?.getBoundingClientRect();
    return {
      count: canvases.length, same: canvas === window.__qaCanvas,
      width: r?.width, height: r?.height, left: r?.left, top: r?.top,
      viewportWidth: innerWidth, viewportHeight: innerHeight,
      overflowX: document.documentElement.scrollWidth > innerWidth,
      overflowY: document.documentElement.scrollHeight > innerHeight,
      visibleImages: [...document.querySelectorAll('img, video')].filter(el => {
        const rect = el.getBoundingClientRect(); const css = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && css.display !== 'none' && css.visibility !== 'hidden';
      }).length,
      gl: Boolean(canvas?.getContext('webgl2')),
    };
  });
  assert.equal(surface.count, 1, 'exactly one DOM canvas');
  assert.equal(surface.same, true, 'renderer canvas must survive scene changes');
  assert.equal(surface.gl, true, 'canvas owns WebGL2 context');
  assert.equal(surface.visibleImages, 0, 'photos must not be DOM img/video overlays');
  assert.equal(surface.overflowX, false);
  assert.equal(surface.overflowY, false);
  assert.ok(Math.abs(surface.width - surface.viewportWidth) <= 1);
  assert.ok(Math.abs(surface.height - surface.viewportHeight) <= 1);
  assert.ok(Math.abs(surface.left) <= 1 && Math.abs(surface.top) <= 1);
  return surface;
}
async function shot(name, privatePhoto = false) {
  const directory = privatePhoto ? privateDir : publicDir;
  await page.screenshot({ path: path.join(directory, name), animations: 'disabled' });
  if (!privatePhoto) evidence.screenshots.push(path.relative(root, path.join(directory, name)));
}
async function sampleScreen(points) {
  const buffer = await page.screenshot({ animations: 'disabled' });
  return page.evaluate(async ({ base64, points }) => {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const surface = new OffscreenCanvas(image.width, image.height);
    const ctx = surface.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const pixels = points.map(p => [...ctx.getImageData(Math.floor(p.x * devicePixelRatio), Math.floor(p.y * devicePixelRatio), 1, 1).data]);
    image.close();
    return pixels;
  }, { base64: buffer.toString('base64'), points });
}

async function check(name, work) {
  currentCase = name;
  const began = Date.now();
  try {
    const result = await work();
    evidence.checks.push({ name, status: 'passed', durationMs: Date.now() - began, result });
    console.log(`PASS ${name}`);
    return result;
  } catch (error) {
    evidence.checks.push({ name, status: 'failed', durationMs: Date.now() - began, error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(privateDir, `failure-${name.replace(/[^a-z0-9-]/gi, '-')}.png`) }).catch(() => {});
    }
    throw error;
  }
}

try {
  let assets = await freshPage();
  const primary = assets.find(a => a.kind === 'image' && a.width > 3840) || assets.find(a => a.kind === 'image') || assets[0];
  const secondary = assets.find(a => a.id !== primary.id && a.kind === 'image') || assets[1];
  const tiled = assets.find(a => a.kind === 'tiles' && a.width * a.height >= 60_000_000);
  assert.ok(primary && secondary, 'fixture needs two distinct assets');
  assert.ok(tiled, 'fixture needs a native ~61 MP tiled image');

  await check('desktop-single-canvas', async () => {
    const surface = await assertCanvas();
    await sleep(500);
    await shot('desktop-theme.png');
    return { surface, capabilities: (await snapshot()).capabilities };
  });

  await check('keyboard-accessibility', async () => {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement?.tagName === 'CANVAS')) await page.keyboard.press('Tab');
    const initial = await page.evaluate(() => ({ tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent }));
    assert.equal(initial.tag, 'BUTTON', 'keyboard Tab must reach an action');
    assert.ok(initial.label?.trim(), 'focused action has an accessible name');
    await page.getByRole('button', { name: '打开当前照片', exact: true }).focus();
    await page.keyboard.press('Enter');
    await waitReady(primary.id);
    await page.keyboard.press('Escape');
    await waitState(s => !s.assetId);
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-action') === 'open-main');
    return { tabAction: initial.label, enterOpensDetail: true, escapeClosesDetail: true, entryFocusRestored: true };
  });

  await check('slow-detail-keeps-4k-before-developing', async () => {
    await freshPage();
    await invoke('fixture', { delayMs: 1700, fault: '' });
    const t0 = Date.now();
    await invoke('open', primary.id);
    const preview = await waitState(s => s.assetId === primary.id && (s.previewReady === true || s.phase === 'source_loading'));
    assert.ok(!readyPhases.includes(preview.phase), 'detail must not be announced before delayed transfer');
    assert.equal(preview.error || null, null);
    const previewMs = Date.now() - t0;
    await shot('desktop-4k-waiting.png');
    const ready = await waitReady(primary.id);
    assert.ok(Date.now() - t0 >= 1500, 'injected source delay must be observed');
    await waitVisible(primary.id);
    await shot('desktop-detail.png');
    assertBudget(ready);
    return { previewMs, visibleMs: Date.now() - t0, preview: summarize(preview), final: summarize(await snapshot()), originalRequests: originalRequests.length };
  });

  for (const fault of ['offline', 'decode', 'changed', 'expired']) {
    await check(`detail-${fault}-retains-preview-and-recovers`, async () => {
      await freshPage();
      await invoke('fixture', { delayMs: 0, fault });
      await invoke('open', primary.id);
      const failed = await waitState(s => s.assetId === primary.id && (errorPhases.includes(s.phase) || Boolean(s.error)));
      assert.equal(failed.previewReady, true, 'usable 4K texture must survive detail failure');
      assertBudget(failed);
      await invoke('fixture', { delayMs: 0, fault: '' });
      await invoke('open', primary.id);
      const recovered = await waitReady(primary.id);
      assert.equal(Boolean(recovered.error), false);
      return { failure: summarize(failed), recovery: summarize(recovered) };
    });
  }

  await check('A-B-A-generation-fence', async () => {
    await freshPage();
    await invoke('fixture', { delayMs: 900, fault: '' });
    await invoke('open', primary.id);
    await waitState(s => s.assetId === primary.id && s.previewReady);
    const firstGeneration = (await snapshot()).generation;
    await invoke('open', secondary.id);
    await sleep(90);
    await invoke('open', primary.id);
    const currentGeneration = (await snapshot()).generation;
    assert.ok(currentGeneration > firstGeneration, 'each selection needs a new generation');
    await waitVisible(primary.id);
    await sleep(1200);
    const final = await snapshot();
    assert.equal(final.assetId, primary.id, 'late B response must not replace A');
    assert.equal(final.generation, currentGeneration);
    assertBudget(final);
    return { firstGeneration, currentGeneration, final: summarize(final) };
  });

  await check('close-cancels-pending-detail', async () => {
    await invoke('close');
    await invoke('fixture', { delayMs: 1100, fault: '' });
    await invoke('open', secondary.id);
    await waitState(s => s.assetId === secondary.id && s.previewReady);
    await invoke('close');
    const closed = await waitState(s => !s.assetId);
    await sleep(1400);
    const later = await snapshot();
    assert.equal(Boolean(later.assetId), false, 'closed photo must not reappear after response');
    assertBudget(later);
    return { closed: summarize(closed), afterLateResponse: summarize(later) };
  });

  await check('native-61MP-tiles-and-zoom', async () => {
    await invoke('fixture', { delayMs: 0, fault: '' });
    await invoke('open', tiled.id);
    await waitVisible(tiled.id);
    const fit = await snapshot();
    assert.ok(fit.tileCount > 0, 'large image must be displayed through tiles');
    const r = fit.detailRect;
    assert.ok(r && Number.isFinite(r.x) && r.width > 0, 'detailRect required for actual framebuffer color/orientation check');
    const expected = [[239,68,68], [34,197,94], [59,130,246], [234,179,8], [168,85,247], [6,182,212]];
    const points = expected.map((_, col) => ({ x: r.x + r.width * (col + 0.5) / 6, y: r.y + r.height * .095 }));
    const actual = await sampleScreen(points);
    const differences = actual.map((pixel, i) => Math.max(...pixel.slice(0, 3).map((value, channel) => Math.abs(value - expected[i][channel]))));
    assert.ok(differences.every(delta => delta <= 4), `sRGB/vertical orientation mismatch: ${JSON.stringify({ expected, actual, differences })}`);
    await invoke('zoomTo', 4);
    const zoomed = await waitState(s => s.assetId === tiled.id && s.zoom >= 3.9 && readyPhases.includes(s.phase));
    assert.ok(zoomed.tileCount > 0);
    assertBudget(zoomed);
    await waitVisible(tiled.id);
    await shot('desktop-61mp-detail.png');
    return { sourceWidth: tiled.width, sourceHeight: tiled.height, colorCheck: { expected, actual, maxChannelError: Math.max(...differences), tolerance: 4 }, fit: summarize(fit), zoomed: summarize(zoomed) };
  });

  await check('constrained-texture-edge-uses-tiles', async () => {
    await freshPage({ maxTextureSizeOverride: 4096 });
    await invoke('fixture', { delayMs: 0, fault: '' });
    await invoke('open', tiled.id);
    const s = await waitVisible(tiled.id);
    assert.ok(s.tileCount > 0);
    assertBudget(s);
    const requests = originalRequests.filter(request => request.path.includes(tiled.id));
    assert.ok(requests.some(request => request.path.includes('/tile/')));
    assert.equal(requests.some(request => request.path.endsWith('/original')), false, 'oversize source must not be decoded into one texture');
    const result = { simulatedMaxTextureSize: 4096, sourceWidth: tiled.width, resource: summarize(s), requestedTiles: requests.length, scope: 'Capability fixture constrains the reported texture edge; this is not a claim about native device limit.' };
    await freshPage();
    return result;
  });

  await check('wall-and-theme-share-context', async () => {
    await invoke('close');
    await invoke('setMode', 'wall');
    await waitState(s => s.mode === 'wall');
    await sleep(350);
    await assertCanvas();
    await shot('desktop-wall.png');
    await invoke('setMode', 'theme');
    await assertCanvas();
    return { canvasPreserved: true, final: summarize(await snapshot()) };
  });

  await check('20000-metadata-virtualization', async () => {
    const began = Date.now();
    const previousFrames = (await snapshot()).frameStats.renderedFrames;
    await invoke('stressCatalog', 20_000);
    await invoke('selectEvent', 1999);
    const s = await waitState(state => state.metaCount === 20_000 && state.eventIndex === 1999 && state.pendingThumbnails === 0 && state.photoTextures.loading === 0 && state.photoTextures.activeTextures > 0 && state.frameStats.renderedFrames > previousFrames + 1);
    assertBudget(s);
    assert.ok(s.photoTextures.activeTextures <= 12, 'offscreen metadata must not allocate active photo textures');
    assert.ok(s.renderer.calls < 40, 'scene draw count must depend on visibility, not 20k records');
    await assertCanvas();
    const result = { metadataRecords: s.metaCount, selectedEvent: s.eventIndex, jumpReadyMs: Date.now() - began, resource: summarize(s), scope: '20k metadata rows reference repeated synthetic fixture files; not 20k independent image downloads.' };
    await invoke('setCollection', 'demo');
    await page.waitForFunction(() => window.__museum.catalog.assets.length < 100);
    return result;
  });

  await check('100-photo-visits-bounded-residency', async () => {
    await invoke('setReducedMotion', true);
    await invoke('fixture', { delayMs: 0, fault: '' });
    const pool = assets.filter(a => a.kind === 'image');
    const samples = [];
    const residency = [];
    for (let i = 0; i < 100; i++) {
      const asset = pool[i % pool.length];
      await invoke('open', asset.id);
      await waitReady(asset.id);
      const s = await snapshot();
      assertBudget(s);
      residency.push(textureBytes(s));
      if (i % 10 === 9) samples.push({ visits: i + 1, ...summarize(s) });
    }
    await invoke('close');
    await sleep(200);
    const closed = await snapshot();
    assertBudget(closed);
    const laterPeak = Math.max(...residency.slice(50));
    const warmPeak = Math.max(...residency.slice(10, 50));
    assert.ok(laterPeak <= warmPeak + 8 * 1024 * 1024, 'after warmup, texture residency should plateau across repeated catalog visits');
    return { visits: 100, samples, warmPeak, laterPeak, closed: summarize(closed), scope: '100 sequential visits over the bounded demo catalog, not 100 distinct source files.' };
  });

  await check('reduced-motion-skips-developing', async () => {
    await freshPage();
    await invoke('setReducedMotion', true);
    await invoke('open', primary.id);
    const visualPhases = [];
    const s = await waitState(state => {
      visualPhases.push(state.phase);
      return state.assetId === primary.id && state.phase === 'detail_visible';
    });
    assert.equal(s.reducedMotion, true);
    assert.equal(s.frameStats.intervalP95, 0, 'fresh reduced-motion scene must not register timed animation frames');
    assert.equal(visualPhases.includes('developing'), false, 'reduced motion should not enter a timed develop animation');
    const events = Array.isArray(s.events) ? s.events.filter(e => e.generation === s.generation) : [];
    return { final: summarize(s), sampledVisualPhases: visualPhases, loaderPhases: events.map(e => e.phase) };
  });

  await check('webgl-context-restoration', async () => {
    await invoke('loseContext');
    await waitState(s => s.contextLost === true);
    await invoke('next');
    const intended = (await snapshot()).assetId;
    assert.notEqual(intended, primary.id, 'selection should advance while context is lost');
    await invoke('restoreContext');
    await waitState(s => s.contextLost === false && s.assetId === intended && readyPhases.includes(s.phase), 25_000);
    await assertCanvas();
    const s = await snapshot();
    assert.equal(s.loaderAssetId, intended, 'restoration must load current selection, not old photo behind a new title');
    assertBudget(s);
    return { selectedAndLoadedMatch: true, state: summarize(s) };
  });

  await check('fullscreen-gesture-and-exit', async () => {
    await invoke('close');
    const candidates = page.getByRole('button', { name: /全屏|入馆/ });
    await candidates.first().waitFor({ state: 'attached', timeout: 5000 });
    const button = candidates.first();
    // The semantic button is deliberately transparent; keyboard activation exercises the same action.
    await button.focus();
    await page.keyboard.press('Enter');
    await sleep(250);
    const entered = await page.evaluate(() => Boolean(document.fullscreenElement));
    if (entered) await page.evaluate(() => document.exitFullscreen());
    await assertCanvas();
    return { entered, fallbackRemainsViewportCanvas: true, capability: entered ? 'headless Chromium accepted user-gesture fullscreen' : 'platform rejected/omitted fullscreen; viewport fallback retained' };
  });

  await check('fullscreen-rejection-retains-exhibit', async () => {
    await page.evaluate(() => {
      window.__qaRequestFullscreen = Element.prototype.requestFullscreen;
      Element.prototype.requestFullscreen = () => Promise.reject(new DOMException('Fixture fullscreen rejection', 'NotAllowedError'));
    });
    const button = page.getByRole('button', { name: /全屏|入馆/ }).first();
    await button.focus();
    await page.keyboard.press('Enter');
    await sleep(120);
    await assertCanvas();
    await page.evaluate(() => { Element.prototype.requestFullscreen = window.__qaRequestFullscreen; });
    return { explicitRejectionInjected: true, exhibitRetained: true };
  });

  await check('webgl-unavailable-has-explicit-fallback', async () => {
    const noGL = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      await noGL.addInitScript(() => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
          if (String(kind).startsWith('webgl') || kind === 'experimental-webgl') return null;
          return getContext.call(this, kind, ...args);
        };
      });
      const p = await noGL.newPage();
      const errors = [];
      p.on('pageerror', error => errors.push(error.message));
      await p.goto(baseURL, { waitUntil: 'domcontentloaded' });
      assert.equal(await p.getByText('这座展厅需要 WebGL 2').isVisible(), true);
      assert.equal(await p.getByRole('button', { name: '重试进入' }).isVisible(), true);
      return { unavailableContextInjected: true, explanatoryFallbackVisible: true, startupErrors: errors };
    } finally { await noGL.close(); }
  });

  await check('mobile-390-DPR2-touch-and-rotation', async () => {
    assets = await freshPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await sleep(300);
    await assertCanvas();
    await shot('mobile-theme.png');
    await invoke('fixture', { delayMs: 500, fault: '' });
    await invoke('open', primary.id);
    await waitVisible(primary.id);
    await shot('mobile-detail.png');
    const before = await snapshot();
    await page.touchscreen.tap(195, 400);
    await waitState(s => s.hudVisible === false);
    await page.touchscreen.tap(195, 400);
    const awakened = await waitState(s => s.hudVisible === true);
    assert.equal(awakened.assetId, primary.id, 'waking HUD must not change selected photo');
    const cdp = await context.newCDPSession(page);
    // Actual input events, not only a zoom method: two-finger separation then drag.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 380, id: 0 }, { x: 240, y: 380, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 100, y: 380, id: 0 }, { x: 290, y: 380, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const pinched = await waitState(s => s.zoom > before.zoom + 0.1);
    await page.setViewportSize({ width: 844, height: 390 });
    await sleep(120);
    await assertCanvas();
    const rotated = await snapshot();
    assert.equal(rotated.assetId, primary.id);
    assert.ok(rotated.zoom > 1);
    await invoke('close');
    await invoke('setMode', 'wall');
    await page.setViewportSize({ width: 390, height: 844 });
    await sleep(350);
    await assertCanvas();
    await shot('mobile-wall.png');
    return { emulated: true, hiddenHudSingleTapRestores: true, before: summarize(before), pinched: summarize(pinched), rotated: summarize(rotated), deviceScaleFactor: 2 };
  });

  await check('private-SDR-small-sample-smoke', async () => {
    inPrivate = true;
    const result = await page.request.get(`${baseURL}/api/catalog?collection=private`);
    const catalog = result.ok() ? await result.json() : { assets: [] };
    if (!catalog.assets?.length) return { available: false, coverage: 'No existing private sample catalog available; no NAS scan performed.' };
    await invoke('setCollection', 'private');
    await page.waitForFunction(() => window.__museum.catalog.assets[0]?.sourceKind === 'private');
    const records = [];
    for (const [index, asset] of catalog.assets.slice(0, 6).entries()) {
      await invoke('open', asset.id);
      const s = await waitVisible(asset.id);
      assertBudget(s);
      records.push({ sample: index + 1, width: asset.width, height: asset.height, detailKind: asset.detail.kind, phase: s.phase, errorPresent: Boolean(s.error) });
    }
    await shot('private-SDR-detail.png', true);
    await invoke('close');
    await invoke('setCollection', 'demo');
    inPrivate = false;
    return { available: true, samples: records, scope: 'Known local SDR copies and compatible derivatives only; visual/capture review remains separate.' };
  });

  await check('no-unexpected-browser-errors', async () => {
    const unexpected = evidence.consoleErrors.filter(x => !x.expected);
    assert.equal(evidence.uncaughtErrors.length, 0, 'uncaught browser errors');
    assert.equal(unexpected.length, 0, `unexpected console errors: ${JSON.stringify(unexpected)}`);
    return { unexpectedConsoleErrors: unexpected.length, uncaughtErrors: evidence.uncaughtErrors.length, expectedFixtureErrors: evidence.consoleErrors.filter(x => x.expected).length };
  });
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed';
  evidence.failure = error.message;
  process.exitCode = 1;
} finally {
  evidence.finishedAt = new Date().toISOString();
  await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  await browser.close();
  console.log(`Evidence: ${path.relative(root, evidencePath)}`);
}
