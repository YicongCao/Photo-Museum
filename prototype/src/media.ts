import { ClampToEdgeWrapping, LinearFilter, SRGBColorSpace, Texture } from 'three';

export interface TileLevel {
  level: number;
  width: number;
  height: number;
  cols: number;
  rows: number;
  urlTemplate: string;
}
export interface CatalogAsset {
  id: string;
  eventId: string;
  title: string;
  width: number;
  height: number;
  revision: string;
  thumbnail: string;
  preview: string;
  detail: { kind: 'image' | 'tiles'; url?: string; tileSize?: number; levels?: TileLevel[] };
  sourceKind: 'demo' | 'private';
  format?: string;
}
export interface DecodedImage { width: number; height: number; close?: () => void }
export type LoadStage = 'fetching' | 'received' | 'decoded' | 'uploaded';
export interface TextureHandle {
  readonly key: string;
  readonly texture: Texture;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  release(): void;
}
export class MediaError extends Error {
  constructor(public readonly code: 'source_changed' | 'unauthorized' | 'network' | 'decode' | 'budget' | 'texture_size', message: string) {
    super(message); this.name = 'MediaError';
  }
}
const aborted = () => new DOMException('Media request cancelled', 'AbortError');
export const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';
interface AcquireOptions { revision: string; signal?: AbortSignal; onStage?: (stage: LoadStage) => void }
interface Watcher {
  resolve: (handle: TextureHandle) => void;
  reject: (error: unknown) => void;
  options: AcquireOptions;
  onAbort: () => void;
}
interface Entry {
  key: string; url: string; revision: string; controller: AbortController;
  watchers: Map<symbol, Watcher>; refs: number; touched: number;
  image?: DecodedImage; texture?: Texture; bytes: number;
}
export interface TextureStats {
  bytes: number; peakBytes: number; activeBytes: number; textures: number; activeTextures: number;
  loading: number; created: number; disposed: number; staleDrops: number; cacheHits: number; budgetBytes: number;
}
export interface TexturePoolOptions {
  budgetBytes?: number;
  maxTextureSize?: number;
  prepare?: (texture: Texture) => void | Promise<void>;
  fetcher?: typeof fetch;
  decoder?: (blob: Blob) => Promise<DecodedImage>;
}

/** Leased, bounded RGBA8 textures. CPU ImageBitmaps stay alive for context recovery. */
export class TexturePool {
  readonly budgetBytes: number;
  readonly maxTextureSize: number;
  private entries = new Map<string, Entry>();
  private live = true;
  private bytes = 0;
  private peakBytes = 0;
  private created = 0;
  private disposed = 0;
  private staleDrops = 0;
  private cacheHits = 0;
  private tick = 0;
  private fetcher: typeof fetch;
  private decoder: (blob: Blob) => Promise<DecodedImage>;
  private prepare: (texture: Texture) => void | Promise<void>;
  constructor(options: TexturePoolOptions = {}) {
    this.budgetBytes = options.budgetBytes ?? 128 * 1024 * 1024;
    this.maxTextureSize = options.maxTextureSize ?? 8192;
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    // Server fixtures are explicitly normalized to sRGB SDR and orientation=1.
    // ImageBitmap ignores Texture.flipY, so orientation is applied at decode.
    this.decoder = options.decoder ?? ((blob) => createImageBitmap(blob, {
      imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none',
    }));
    this.prepare = options.prepare ?? (() => undefined);
  }
  has(key: string): boolean { return Boolean(this.entries.get(key)?.texture); }
  acquire(key: string, url: string, options: AcquireOptions): Promise<TextureHandle> {
    if (!this.live || options.signal?.aborted) return Promise.reject(aborted());
    let entry = this.entries.get(key);
    if (entry && (entry.url !== url || entry.revision !== options.revision)) {
      return Promise.reject(new MediaError('source_changed', 'Cache identity does not match media revision'));
    }
    if (entry?.texture) {
      this.cacheHits++;
      return Promise.resolve(this.lease(entry));
    }
    const fresh = !entry;
    if (!entry) {
      entry = { key, url, revision: options.revision, controller: new AbortController(), watchers: new Map(), refs: 0, touched: ++this.tick, bytes: 0 };
      this.entries.set(key, entry);
    }
    const target = entry;
    const promise = new Promise<TextureHandle>((resolve, reject) => {
      const token = Symbol();
      const onAbort = () => {
        target.watchers.delete(token);
        reject(aborted());
        if (!target.watchers.size && !target.texture) {
          target.controller.abort();
          if (this.entries.get(key) === target) this.entries.delete(key);
        }
      };
      target.watchers.set(token, { resolve, reject, options, onAbort });
      options.signal?.addEventListener('abort', onAbort, { once: true });
    });
    if (fresh) void this.load(target);
    return promise;
  }
  private stage(entry: Entry, stage: LoadStage): void {
    for (const watcher of entry.watchers.values()) watcher.options.onStage?.(stage);
  }
  private lease(entry: Entry): TextureHandle {
    entry.refs++;
    entry.touched = ++this.tick;
    let released = false;
    return { key: entry.key, texture: entry.texture!, width: entry.image!.width, height: entry.image!.height, bytes: entry.bytes,
      release: () => {
        if (released) return;
        released = true;
        entry.refs = Math.max(0, entry.refs - 1);
        entry.touched = ++this.tick;
      } };
  }
  private stillWanted(entry: Entry): boolean {
    return this.live && !entry.controller.signal.aborted && this.entries.get(entry.key) === entry && entry.watchers.size > 0;
  }
  private async load(entry: Entry): Promise<void> {
    let decoded: DecodedImage | undefined;
    let texture: Texture | undefined;
    let admitted = false;
    try {
      this.stage(entry, 'fetching');
      const response = await this.fetcher(entry.url, { signal: entry.controller.signal, credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401 || response.status === 403) throw new MediaError('unauthorized', 'Session is not authorized');
      if (response.status === 409 || response.status === 412) throw new MediaError('source_changed', 'Source revision changed');
      if (!response.ok) throw new MediaError('network', `Media request failed (${response.status})`);
      if (response.headers.get('X-Content-Version') !== entry.revision) throw new MediaError('source_changed', 'Media version does not match selection');
      const blob = await response.blob();
      if (!this.stillWanted(entry)) { this.staleDrops++; throw aborted(); }
      this.stage(entry, 'received');
      try { decoded = await this.decoder(blob); }
      catch (error) { if (isAbort(error)) throw error; throw new MediaError('decode', 'Cannot decode this media'); }
      if (!this.stillWanted(entry)) { this.staleDrops++; throw aborted(); }
      if (!Number.isFinite(decoded.width) || !Number.isFinite(decoded.height) || decoded.width <= 0 || decoded.height <= 0) {
        throw new MediaError('decode', 'Invalid decoded dimensions');
      }
      if (decoded.width > this.maxTextureSize || decoded.height > this.maxTextureSize) {
        throw new MediaError('texture_size', 'Image needs tiled detail on this device');
      }
      const bytes = decoded.width * decoded.height * 4;
      this.makeRoom(bytes);
      if (this.bytes + bytes > this.budgetBytes) throw new MediaError('budget', 'Texture budget cannot hold this detail');
      this.stage(entry, 'decoded');
      texture = new Texture(decoded as ImageBitmap);
      texture.colorSpace = SRGBColorSpace;
      texture.generateMipmaps = false;
      texture.minFilter = LinearFilter;
      texture.magFilter = LinearFilter;
      texture.wrapS = ClampToEdgeWrapping;
      texture.wrapT = ClampToEdgeWrapping;
      texture.flipY = false;
      texture.needsUpdate = true;
      // Account before the async upload hook, preventing concurrent admissions overshooting the budget.
      this.bytes += bytes;
      this.peakBytes = Math.max(this.peakBytes, this.bytes);
      this.created++;
      entry.bytes = bytes;
      admitted = true;
      await this.prepare(texture);
      if (!this.stillWanted(entry)) { this.staleDrops++; throw aborted(); }
      entry.image = decoded;
      entry.texture = texture;
      decoded = undefined;
      texture = undefined;
      this.stage(entry, 'uploaded');
      for (const watcher of entry.watchers.values()) {
        watcher.options.signal?.removeEventListener('abort', watcher.onAbort);
        if (watcher.options.signal?.aborted) watcher.reject(aborted());
        else watcher.resolve(this.lease(entry));
      }
      entry.watchers.clear();
    } catch (error) {
      if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
      if (entry.texture) { this.evict(entry); admitted = false; }
      texture?.dispose();
      decoded?.close?.();
      if (admitted) { this.bytes -= entry.bytes; this.disposed++; }
      for (const watcher of entry.watchers.values()) {
        watcher.options.signal?.removeEventListener('abort', watcher.onAbort);
        watcher.reject(error);
      }
      entry.watchers.clear();
    }
  }
  private makeRoom(incoming: number): void {
    const candidates = [...this.entries.values()].filter((e) => e.texture && e.refs === 0).sort((a, b) => a.touched - b.touched);
    for (const candidate of candidates) {
      if (this.bytes + incoming <= this.budgetBytes) break;
      this.evict(candidate);
    }
  }
  private evict(entry: Entry): void {
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    entry.texture?.dispose();
    entry.image?.close?.();
    this.bytes -= entry.bytes;
    this.disposed++;
    entry.texture = undefined;
    entry.image = undefined;
    entry.bytes = 0;
  }
  clearUnused(): void {
    for (const entry of [...this.entries.values()]) if (entry.texture && entry.refs === 0) this.evict(entry);
  }
  stats(): TextureStats {
    const entries = [...this.entries.values()];
    return { bytes: this.bytes, peakBytes: this.peakBytes, activeBytes: entries.filter((e) => e.refs > 0).reduce((n, e) => n + e.bytes, 0),
      textures: entries.filter((e) => e.texture).length, activeTextures: entries.filter((e) => e.texture && e.refs > 0).length,
      loading: entries.filter((e) => !e.texture).length, created: this.created, disposed: this.disposed,
      staleDrops: this.staleDrops, cacheHits: this.cacheHits, budgetBytes: this.budgetBytes };
  }
  dispose(): void {
    this.live = false;
    for (const entry of [...this.entries.values()]) {
      if (entry.texture) this.evict(entry);
      else {
        entry.controller.abort();
        for (const watcher of entry.watchers.values()) {
          watcher.options.signal?.removeEventListener('abort', watcher.onAbort);
          watcher.reject(aborted());
        }
        entry.watchers.clear();
        this.entries.delete(entry.key);
      }
    }
  }
}

export interface ViewRect {
  /** Normalized image coordinates, top-left origin. */
  x: number; y: number; width: number; height: number;
  /** Physical screen pixels occupied by this visible rect (CSS size multiplied by actual rendering DPR). */
  pixelWidth: number; pixelHeight: number;
}
export interface TileVisual {
  key: string; texture: Texture; x: number; y: number; width: number; height: number; level: number;
}
export type MediaPhase = 'idle' | 'preview_loading' | 'preview_ready' | 'preview_unavailable' | 'source_loading' | 'source_received' | 'detail_preparing' | 'detail_ready' | 'detail_unavailable' | 'source_changed';
export interface MediaState {
  asset: CatalogAsset | null; phase: MediaPhase; preview?: TextureHandle; detail?: TextureHandle;
  tiles: TileVisual[]; error?: string; errorCode?: string; generation: number;
  quality: 'none' | 'preview' | 'original' | 'tiled'; detailLevel?: number; detailWidth?: number;
}
export interface OpenOptions { delayMs?: number; fault?: 'offline' | 'decode' | 'changed' | 'expired' | '' }
export interface ProgressiveMediaOptions {
  pool: TexturePool;
  onChange: (state: MediaState) => void;
  onPreviewFrame?: () => Promise<void>;
}
interface TileRequest { key: string; url: string; x: number; y: number; width: number; height: number; level: number; bytes: number }
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
export function normalizeView(view: ViewRect): ViewRect {
  const x = clamp(Number.isFinite(view.x) ? view.x : 0, 0, 1 - 1e-6);
  const y = clamp(Number.isFinite(view.y) ? view.y : 0, 0, 1 - 1e-6);
  return { x, y, width: clamp(view.width || 1, 1e-6, 1 - x), height: clamp(view.height || 1, 1e-6, 1 - y),
    pixelWidth: Math.max(1, view.pixelWidth || 1), pixelHeight: Math.max(1, view.pixelHeight || 1) };
}
function faultUrl(url: string, options: OpenOptions): string {
  const query = new URLSearchParams();
  if (options.delayMs) query.set('delay', String(Math.max(0, options.delayMs)));
  if (options.fault) query.set('fault', options.fault);
  return query.size ? `${url}${url.includes('?') ? '&' : '?'}${query}` : url;
}

/** A single selection, with generation fencing for fetch, non-abortable decode and tile view changes. */
export class ProgressiveMedia {
  private pool: TexturePool;
  private onChange: (state: MediaState) => void;
  private onPreviewFrame: () => Promise<void>;
  private state: MediaState = { asset: null, phase: 'idle', tiles: [], generation: 0, quality: 'none' };
  private selection?: AbortController;
  private tileController?: AbortController;
  private tileGeneration = 0;
  private options: OpenOptions = {};
  private view: ViewRect = { x: 0, y: 0, width: 1, height: 1, pixelWidth: 1600, pixelHeight: 1000 };
  private tileHandles = new Map<string, TextureHandle>();
  private tileViewKey = '';
  constructor(options: ProgressiveMediaOptions) {
    this.pool = options.pool; this.onChange = options.onChange;
    this.onPreviewFrame = options.onPreviewFrame ?? (() => Promise.resolve());
  }
  get snapshot(): MediaState { return { ...this.state, tiles: [...this.state.tiles] }; }
  private publish(patch: Partial<MediaState> = {}): void {
    this.state = { ...this.state, ...patch };
    this.onChange(this.snapshot);
  }
  private current(generation: number): boolean { return this.state.generation === generation && !this.selection?.signal.aborted; }
  private clearSelection(): void {
    this.selection?.abort(); this.tileController?.abort(); this.tileGeneration++;
    this.state.preview?.release(); this.state.detail?.release();
    for (const handle of this.tileHandles.values()) handle.release();
    this.tileHandles.clear(); this.tileViewKey = '';
  }
  close(): void {
    this.clearSelection();
    this.publish({ asset: null, generation: this.state.generation + 1, phase: 'idle', quality: 'none', tiles: [], preview: undefined, detail: undefined, error: undefined, errorCode: undefined, detailLevel: undefined, detailWidth: undefined });
  }
  open(asset: CatalogAsset, options: OpenOptions = {}): void {
    this.clearSelection();
    const generation = this.state.generation + 1;
    this.selection = new AbortController(); this.options = { ...options };
    this.view = { x: 0, y: 0, width: 1, height: 1, pixelWidth: 1600, pixelHeight: 1000 };
    this.publish({ asset, generation, phase: 'preview_loading', quality: 'none', tiles: [], preview: undefined, detail: undefined, error: undefined, errorCode: undefined, detailLevel: undefined, detailWidth: undefined });
    void this.run(asset, generation, this.selection.signal);
  }
  retry(): void { if (this.state.asset) this.open(this.state.asset, this.options); }
  setView(view: ViewRect): void {
    const next = normalizeView(view);
    if (next.x === this.view.x && next.y === this.view.y && next.width === this.view.width && next.height === this.view.height && next.pixelWidth === this.view.pixelWidth && next.pixelHeight === this.view.pixelHeight) return;
    this.view = next;
    if (this.state.asset?.detail.kind === 'tiles' && this.state.preview && this.state.phase !== 'preview_ready') {
      void this.loadTiles(this.state.asset, this.state.generation);
    }
  }
  private async run(asset: CatalogAsset, generation: number, signal: AbortSignal): Promise<void> {
    try {
      if (asset.detail.kind === 'image' && asset.detail.url) {
        const url = faultUrl(asset.detail.url, this.options);
        const key = `${asset.id}:${asset.revision}:detail:${url}`;
        if (this.pool.has(key)) {
          const detail = await this.pool.acquire(key, url, { revision: asset.revision, signal });
          if (!this.current(generation)) { detail.release(); return; }
          this.publish({ detail, phase: 'detail_ready', quality: 'original', detailWidth: detail.width });
          return;
        }
      }
      const preview = await this.pool.acquire(`${asset.id}:${asset.revision}:preview`, asset.preview, { revision: asset.revision, signal });
      if (!this.current(generation)) { preview.release(); return; }
      this.publish({ preview, phase: 'preview_ready', quality: 'preview' });
      await this.onPreviewFrame();
      if (!this.current(generation)) return;
      if (asset.detail.kind === 'tiles') { await this.loadTiles(asset, generation); return; }
      if (!asset.detail.url) throw new MediaError('network', 'No detail resource is available');
      this.publish({ phase: 'source_loading' });
      const url = faultUrl(asset.detail.url, this.options);
      const detail = await this.pool.acquire(`${asset.id}:${asset.revision}:detail:${url}`, url, {
        revision: asset.revision, signal,
        onStage: (stage) => { if (this.current(generation)) this.stage(stage); },
      });
      if (!this.current(generation)) { detail.release(); return; }
      this.publish({ detail, phase: 'detail_ready', quality: 'original', detailWidth: detail.width });
    } catch (error) { this.failure(error, generation); }
  }
  private stage(stage: LoadStage): void {
    if (stage === 'received') this.publish({ phase: 'source_received' });
    if (stage === 'decoded') this.publish({ phase: 'detail_preparing' });
  }
  private failure(error: unknown, generation: number): void {
    if (!this.current(generation) || isAbort(error)) return;
    const code = error instanceof MediaError ? error.code : 'network';
    this.publish({ phase: code === 'source_changed' ? 'source_changed' : this.state.preview ? 'detail_unavailable' : 'preview_unavailable',
      error: error instanceof Error ? error.message : String(error), errorCode: code });
  }
  private requests(asset: CatalogAsset, level: TileLevel): TileRequest[] {
    const size = asset.detail.tileSize ?? 1024;
    const view = this.view;
    const x0 = clamp(Math.floor(view.x * level.width / size), 0, level.cols - 1);
    const y0 = clamp(Math.floor(view.y * level.height / size), 0, level.rows - 1);
    const x1 = clamp(Math.ceil((view.x + view.width) * level.width / size) - 1, x0, level.cols - 1);
    const y1 = clamp(Math.ceil((view.y + view.height) * level.height / size) - 1, y0, level.rows - 1);
    const result: TileRequest[] = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const width = Math.min(size, level.width - x * size), height = Math.min(size, level.height - y * size);
      const url = faultUrl(level.urlTemplate.replaceAll('{level}', String(level.level)).replaceAll('{x}', String(x)).replaceAll('{y}', String(y)), this.options);
      result.push({ key: `${asset.id}:${asset.revision}:tile:${url}`, url, x: x * size / level.width, y: y * size / level.height,
        width: width / level.width, height: height / level.height, level: level.level, bytes: width * height * 4 });
    }
    const cx = view.x + view.width / 2, cy = view.y + view.height / 2;
    return result.sort((a, b) => Math.hypot(a.x + a.width / 2 - cx, a.y + a.height / 2 - cy) - Math.hypot(b.x + b.width / 2 - cx, b.y + b.height / 2 - cy));
  }
  private chooseTiles(asset: CatalogAsset): { level: TileLevel; requests: TileRequest[] } {
    const levels = [...(asset.detail.levels ?? [])].sort((a, b) => a.width - b.width);
    if (!levels.length) throw new MediaError('network', 'No tile levels available');
    const previewWidth = this.state.preview?.width ?? 1;
    const desired = Math.max(previewWidth, this.view.pixelWidth / this.view.width, this.view.pixelHeight / this.view.height * asset.width / asset.height);
    let index = levels.findIndex((level) => level.width >= desired);
    if (index < 0) index = levels.length - 1;
    const heldTiles = [...this.tileHandles.values()].reduce((sum, h) => sum + h.bytes, 0);
    const available = this.pool.budgetBytes - this.pool.stats().activeBytes + heldTiles;
    for (let i = index; i >= 0; i--) {
      const level = levels[i];
      if (level.width < previewWidth && i < levels.length - 1) continue;
      const requests = this.requests(asset, level);
      if (requests.reduce((sum, r) => sum + r.bytes, 0) <= available && (asset.detail.tileSize ?? 1024) <= this.pool.maxTextureSize) return { level, requests };
    }
    throw new MediaError('budget', 'Visible detail exceeds the texture budget; zoom in to request fewer tiles');
  }
  private async loadTiles(asset: CatalogAsset, generation: number): Promise<void> {
    if (!this.current(generation) || !this.state.preview) return;
    let chosen: { level: TileLevel; requests: TileRequest[] };
    try { chosen = this.chooseTiles(asset); } catch (error) { this.failure(error, generation); return; }
    const key = chosen.requests.map((r) => r.key).sort().join('|');
    if (key === this.tileViewKey) return;
    this.tileViewKey = key;
    this.tileController?.abort();
    const controller = new AbortController(); this.tileController = controller;
    const viewGeneration = ++this.tileGeneration;
    const valid = () => this.current(generation) && this.tileGeneration === viewGeneration && !controller.signal.aborted;
    const wanted = new Set(chosen.requests.map((r) => r.key));
    for (const [tileKey, handle] of this.tileHandles) if (!wanted.has(tileKey)) { handle.release(); this.tileHandles.delete(tileKey); }
    const visuals = () => chosen.requests.filter((r) => this.tileHandles.has(r.key)).map((r) => ({ key: r.key, texture: this.tileHandles.get(r.key)!.texture, x: r.x, y: r.y, width: r.width, height: r.height, level: r.level }));
    this.publish({ tiles: visuals(), phase: 'source_loading', error: undefined, errorCode: undefined, detailLevel: chosen.level.level, detailWidth: chosen.level.width });
    let cursor = 0;
    const worker = async () => {
      while (valid() && cursor < chosen.requests.length) {
        const request = chosen.requests[cursor++];
        if (this.tileHandles.has(request.key)) continue;
        const handle = await this.pool.acquire(request.key, request.url, {
          revision: asset.revision, signal: controller.signal,
          onStage: (stage) => { if (valid()) this.stage(stage); },
        });
        if (!valid()) { handle.release(); return; }
        this.tileHandles.set(request.key, handle);
        this.publish({ tiles: visuals() });
      }
    };
    try {
      await Promise.all([worker(), worker()]);
      if (valid()) this.publish({ tiles: visuals(), phase: 'detail_ready', quality: 'tiled' });
    } catch (error) {
      // Keep this view key after failure: the render loop may call setView on every
      // frame, which must not turn an unavailable source into an automatic retry loop.
      if (valid()) { controller.abort(); this.failure(error, generation); }
    }
  }
}
