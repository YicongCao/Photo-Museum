/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { MediaError, ProgressiveMedia, TexturePool, type CatalogAsset, type DecodedImage, type MediaState } from './media.ts';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) { if (check()) return; await tick(); }
  assert.ok(check(), 'Expected asynchronous condition to become true');
}
function response(width = 16, height = 10, revision = 'v1') {
  return new Response(JSON.stringify({ width, height }), { headers: { 'X-Content-Version': revision } });
}
const decode = async (blob: Blob): Promise<DecodedImage> => JSON.parse(await blob.text());
function asset(id = 'a'): CatalogAsset {
  return { id, eventId: 'event', title: id, width: 32, height: 20, revision: 'v1', thumbnail: `/${id}/thumb`, preview: `/${id}/preview`,
    detail: { kind: 'image', url: `/${id}/original` }, sourceKind: 'demo' };
}
function fetcher(fn: (url: string, init?: RequestInit) => Promise<Response>): typeof fetch {
  return (input, init) => fn(String(input), init);
}
function simplePool(extra: ConstructorParameters<typeof TexturePool>[0] = {}) {
  return new TexturePool({ decoder: decode, fetcher: fetcher(async (url) => url.includes('preview') ? response() : response(32, 20)), ...extra });
}

test('4K first frame and GPU preparation gate original readiness without a fabricated timer', async () => {
  const frame = deferred<void>(), upload = deferred<void>();
  const requests: string[] = [], states: MediaState[] = [];
  const pool = simplePool({ fetcher: fetcher(async (url) => { requests.push(url); return url.includes('preview') ? response() : response(32, 20); }),
    prepare: async (texture) => { if ((texture.image as DecodedImage).width === 32) await upload.promise; } });
  const media = new ProgressiveMedia({ pool, onChange: (s) => states.push(s), onPreviewFrame: () => frame.promise });
  media.open(asset()); await until(() => media.snapshot.phase === 'preview_ready');
  assert.deepEqual(requests, ['/a/preview']);
  frame.resolve(); await until(() => media.snapshot.phase === 'detail_preparing');
  assert.ok(!states.some((s) => s.phase === 'detail_ready'));
  upload.resolve(); await until(() => media.snapshot.phase === 'detail_ready');
  assert.deepEqual(requests, ['/a/preview', '/a/original']);
  assert.equal(media.snapshot.preview?.width, 16); assert.equal(media.snapshot.detail?.width, 32);
  media.close(); pool.dispose();
});

test('source version mismatch preserves preview and never presents mixed-version detail', async () => {
  const pool = simplePool({ fetcher: fetcher(async (url) => response(16, 10, url.includes('original') ? 'v2' : 'v1')) });
  const media = new ProgressiveMedia({ pool, onChange: () => undefined });
  media.open(asset()); await until(() => media.snapshot.phase === 'source_changed');
  assert.ok(media.snapshot.preview); assert.equal(media.snapshot.detail, undefined); assert.equal(media.snapshot.errorCode, 'source_changed');
  media.close(); pool.dispose();
});

test('invalid source bytes and expired sessions preserve a usable preview', async () => {
  for (const fault of ['decode', 'expired']) {
    const pool = simplePool({ fetcher: fetcher(async (url) => !url.includes('original') ? response() : fault === 'expired' ? new Response('', { status: 401 }) : new Response('invalid bytes', { headers: { 'X-Content-Version': 'v1' } })) });
    const media = new ProgressiveMedia({ pool, onChange: () => undefined });
    media.open(asset()); await until(() => media.snapshot.phase === 'detail_unavailable');
    assert.ok(media.snapshot.preview); assert.equal(media.snapshot.detail, undefined); assert.equal(media.snapshot.errorCode, fault === 'expired' ? 'unauthorized' : 'decode');
    media.close(); pool.dispose();
  }
});

test('a late non-abortable decode from A cannot overwrite B and its bitmap closes', async () => {
  const slowDecode = deferred<DecodedImage>(); let decoded = 0, closed = 0;
  const pool = simplePool({ decoder: async (blob) => ++decoded === 1 ? slowDecode.promise : decode(blob) });
  const media = new ProgressiveMedia({ pool, onChange: () => undefined });
  media.open(asset('a')); await until(() => decoded === 1);
  media.open(asset('b')); await until(() => media.snapshot.phase === 'detail_ready');
  slowDecode.resolve({ width: 16, height: 10, close: () => closed++ }); await until(() => closed === 1);
  assert.equal(media.snapshot.asset?.id, 'b'); assert.equal(media.snapshot.detail?.key.includes('b:'), true); assert.ok(pool.stats().staleDrops >= 1);
  media.close(); pool.dispose();
});

test('shared pending fetch survives one lease cancellation, and releases exactly once', async () => {
  const fetchDone = deferred<Response>(); let requests = 0, closed = 0;
  const pool = simplePool({ fetcher: fetcher(async () => { requests++; return fetchDone.promise; }), decoder: async () => ({ width: 16, height: 10, close: () => closed++ }) });
  const abort = new AbortController();
  const first = pool.acquire('same', '/same', { revision: 'v1', signal: abort.signal });
  const second = pool.acquire('same', '/same', { revision: 'v1' });
  abort.abort(); await assert.rejects(first, { name: 'AbortError' });
  fetchDone.resolve(response()); const handle = await second;
  assert.equal(requests, 1); assert.equal(pool.stats().activeTextures, 1);
  handle.release(); handle.release(); pool.clearUnused();
  assert.equal(closed, 1); assert.equal(pool.stats().bytes, 0); pool.dispose();
});

test('pool LRU evicts only unleased resources and never exceeds its byte budget', async () => {
  let closed = 0;
  const pool = simplePool({ budgetBytes: 1280, decoder: async (blob) => ({ ...await decode(blob), close: () => closed++ }), fetcher: fetcher(async () => response()) });
  const first = await pool.acquire('one', '/one', { revision: 'v1' }); const second = await pool.acquire('two', '/two', { revision: 'v1' });
  first.release(); const third = await pool.acquire('three', '/three', { revision: 'v1' });
  assert.equal(pool.has('one'), false); assert.equal(pool.has('two'), true); assert.equal(pool.stats().peakBytes, 1280);
  await assert.rejects(pool.acquire('four', '/four', { revision: 'v1' }), (error: unknown) => error instanceof MediaError && error.code === 'budget');
  assert.equal(pool.stats().bytes, 1280); assert.equal(closed, 2);
  second.release(); third.release(); pool.dispose(); assert.equal(pool.stats().bytes, 0); assert.equal(closed, 4);
});

test('a cached original is immediately reused without waiting for or downgrading to 4K', async () => {
  const requests: string[] = [], states: MediaState[] = [];
  const pool = simplePool({ fetcher: fetcher(async (url) => { requests.push(url); return url.includes('preview') ? response() : response(32, 20); }) });
  const media = new ProgressiveMedia({ pool, onChange: (s) => states.push(s) });
  media.open(asset()); await until(() => media.snapshot.phase === 'detail_ready'); media.close(); states.length = 0;
  media.open(asset()); await until(() => media.snapshot.phase === 'detail_ready');
  assert.equal(requests.length, 2); assert.equal(media.snapshot.quality, 'original'); assert.ok(!states.some((s) => s.phase === 'preview_ready'));
  media.close(); pool.dispose();
});

test('closing at preview frame boundary prevents original fetch and drops active leases', async () => {
  const frame = deferred<void>(), requests: string[] = [];
  const pool = simplePool({ fetcher: fetcher(async (url) => { requests.push(url); return response(); }) });
  const media = new ProgressiveMedia({ pool, onChange: () => undefined, onPreviewFrame: () => frame.promise });
  media.open(asset()); await until(() => media.snapshot.phase === 'preview_ready'); media.close(); frame.resolve(); await tick();
  assert.deepEqual(requests, ['/a/preview']); assert.equal(media.snapshot.phase, 'idle'); assert.equal(pool.stats().activeBytes, 0);
  pool.clearUnused(); assert.equal(pool.stats().bytes, 0); pool.dispose();
});

function tiledAsset(): CatalogAsset {
  return { ...asset('tiles'), width: 128, height: 64, detail: { kind: 'tiles', tileSize: 16, levels: [
    { level: 0, width: 32, height: 16, cols: 2, rows: 1, urlTemplate: '/tiles/0/{x}/{y}' },
    { level: 1, width: 64, height: 32, cols: 4, rows: 2, urlTemplate: '/tiles/1/{x}/{y}' },
    { level: 2, width: 128, height: 64, cols: 8, rows: 4, urlTemplate: '/tiles/2/{x}/{y}' },
  ] } };
}

test('tiled detail keeps 4K base, respects the viewport and upgrades to native LOD when zooming', async () => {
  const requests: string[] = [];
  const pool = simplePool({ budgetBytes: 12_000, maxTextureSize: 64, fetcher: fetcher(async (url) => { requests.push(url); return url.includes('preview') ? response(32, 16) : response(16, 16); }) });
  const media = new ProgressiveMedia({ pool, onChange: () => undefined });
  media.open(tiledAsset()); media.setView({ x: 0, y: 0, width: 1, height: 1, pixelWidth: 50, pixelHeight: 25 });
  await until(() => media.snapshot.phase === 'detail_ready');
  assert.equal(media.snapshot.detailLevel, 1); assert.equal(media.snapshot.tiles.length, 8); assert.ok(media.snapshot.preview);
  media.setView({ x: 0.25, y: 0.25, width: 0.25, height: 0.25, pixelWidth: 100, pixelHeight: 50 });
  await until(() => media.snapshot.phase === 'detail_ready' && media.snapshot.detailLevel === 2);
  assert.equal(media.snapshot.tiles.length, 2); assert.ok(media.snapshot.tiles.every((t) => t.x >= 0.25 && t.x < 0.5 && t.y === 0.25));
  assert.equal(media.snapshot.detailWidth, 128); assert.ok(pool.stats().peakBytes <= 12_000); assert.ok(!requests.some((url) => url.includes('original')));
  media.close(); assert.equal(pool.stats().activeBytes, 0); pool.dispose();
});

test('tile view changes discard late results from the previous viewport', async () => {
  const stalled = deferred<Response>(); let stall = false;
  const pool = simplePool({ budgetBytes: 32_000, fetcher: fetcher(async (url) => {
    if (url.includes('preview')) return response(32, 16); if (stall && url.includes('/2/2/1')) return stalled.promise; return response(16, 16);
  }) });
  const media = new ProgressiveMedia({ pool, onChange: () => undefined });
  media.open(tiledAsset()); media.setView({ x: 0, y: 0, width: 1, height: 1, pixelWidth: 32, pixelHeight: 16 });
  await until(() => media.snapshot.phase === 'detail_ready'); stall = true;
  media.setView({ x: 0.25, y: 0.25, width: 0.125, height: 0.25, pixelWidth: 80, pixelHeight: 80 }); await tick();
  media.setView({ x: 0.75, y: 0.75, width: 0.125, height: 0.25, pixelWidth: 80, pixelHeight: 80 });
  await until(() => media.snapshot.phase === 'detail_ready'); stalled.resolve(response(16, 16)); await tick(); await tick();
  assert.ok(media.snapshot.tiles.every((tile) => tile.x === 0.75 && tile.y === 0.75)); media.close(); pool.dispose();
});

test('oversized untiled original is refused without claiming lower resolution is the original', async () => {
  let closed = 0;
  const pool = simplePool({ maxTextureSize: 64, decoder: async (blob) => ({ ...await decode(blob), close: () => closed++ }), fetcher: fetcher(async (url) => url.includes('preview') ? response() : response(128, 80)) });
  const media = new ProgressiveMedia({ pool, onChange: () => undefined }); media.open(asset()); await until(() => media.snapshot.phase === 'detail_unavailable');
  assert.equal(media.snapshot.errorCode, 'texture_size'); assert.equal(media.snapshot.quality, 'preview'); assert.equal(closed, 1); media.close(); pool.dispose();
});

test('100 selections and closes leave no active resources and all unused textures are reclaimable', async () => {
  const pool = simplePool({ budgetBytes: 10_000 }); const media = new ProgressiveMedia({ pool, onChange: () => undefined });
  for (let i = 0; i < 100; i++) { media.open(asset(`image-${i}`)); await until(() => media.snapshot.phase === 'detail_ready'); media.close(); assert.equal(pool.stats().activeBytes, 0); }
  assert.ok(pool.stats().peakBytes <= pool.budgetBytes); pool.clearUnused();
  assert.equal(pool.stats().bytes, 0); assert.equal(pool.stats().textures, 0); assert.equal(pool.stats().created, pool.stats().disposed); pool.dispose();
});

test('repeated render updates do not retry a failed tile source without an explicit new view', async () => {
  let detailRequests = 0;
  const pool = simplePool({ fetcher: fetcher(async (url) => {
    if (url.includes('preview')) return response(32, 16);
    detailRequests++; return new Response('', { status: 503 });
  }) });
  const media = new ProgressiveMedia({ pool, onChange: () => undefined });
  const view = { x: 0, y: 0, width: 1, height: 1, pixelWidth: 32, pixelHeight: 16 };
  media.open(tiledAsset()); media.setView(view);
  await until(() => media.snapshot.phase === 'detail_unavailable');
  const firstAttempt = detailRequests;
  for (let i = 0; i < 50; i++) media.setView(view);
  await tick();
  assert.equal(detailRequests, firstAttempt);
  assert.ok(media.snapshot.preview);
  media.close(); pool.dispose();
});
