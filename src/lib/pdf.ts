import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { LruCache } from "./lru";

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
let workerUrl: string | null = null;

export async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      const src = (await import("pdfjs-dist/build/pdf.worker.min.mjs?raw")).default;
      workerUrl = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })().catch((err) => {
      pdfjsPromise = null;
      throw err;
    });
  }
  return pdfjsPromise;
}

export function prewarmPdf() {
  void getPdfjs().catch(() => {});
}

// LRU cache for opened PDFDocumentProxy (max 5)
const openProxies = new Map<string, PDFDocumentProxy>();
const invalidProxies = new WeakSet<PDFDocumentProxy>();

export function isProxyUsable(proxy: PDFDocumentProxy | null | undefined) {
  return !!proxy && !invalidProxies.has(proxy);
}

export function registerProxyLRU(key: string, proxy: PDFDocumentProxy) {
  if (openProxies.has(key)) {
    openProxies.delete(key);
  } else if (openProxies.size >= 5) {
    const oldestKey = openProxies.keys().next().value;
    if (oldestKey) {
      const p = openProxies.get(oldestKey);
      openProxies.delete(oldestKey);
      try {
        if (p) invalidProxies.add(p);
        if (p) void p.loadingTask.destroy().catch(() => undefined);
      } catch {
        /* ignore */
      }
    }
  }
  openProxies.set(key, proxy);
}

export function destroyProxy(key: string) {
  const p = openProxies.get(key);
  if (p) {
    openProxies.delete(key);
    try {
      invalidProxies.add(p);
      void p.loadingTask.destroy().catch(() => undefined);
    } catch {
      /* ignore */
    }
  }
}

export type OpenPdfOptions = {
  data?: ArrayBuffer;
  url?: string;
  onPasswordRequest?: (reason: "need_password" | "incorrect_password") => Promise<string | null>;
};

export type OpenPdfResult = {
  proxy: PDFDocumentProxy;
  pages: number;
};

/**
 * Opens a local PDF (either via ArrayBuffer or custom protocol URL).
 * Intercepts password requests with onPasswordRequest callback.
 */
/**
 * Opens a document and throws the real reason on failure (damaged file, unreachable file, password), so the
 * reader can say what is wrong with the file.
 */
export async function openPdfOrThrow(
  input: ArrayBuffer | OpenPdfOptions,
  passwordCallback?: (reason: "need_password" | "incorrect_password") => Promise<string | null>
): Promise<OpenPdfResult> {
  const pdfjs = await getPdfjs();
  let src: any = {};

  if (input instanceof ArrayBuffer) {
    // pdf.js transfers the input to its worker, detaching its ArrayBuffer.
    // Keep the caller's bytes intact for IndexedDB and reopening a tab.
    src = { data: new Uint8Array(input.slice(0)) };
  } else {
    if (input.url) src.url = input.url;
    else if (input.data) src.data = new Uint8Array(input.data.slice(0));
    if (input.onPasswordRequest) passwordCallback = input.onPasswordRequest;
  }

  src.isEvalSupported = false;
  src.disableAutoFetch = true;
  src.disableStream = false;

  const task = pdfjs.getDocument(src);

  if (passwordCallback) {
    let attempts = 0;
    task.onPassword = async (callback: (pwd: string) => void, reason: any) => {
      if (++attempts > 3) {
        void task.destroy();
        return;
      }
      const r = reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD ? "incorrect_password" : "need_password";
      try {
        const pwd = await passwordCallback!(r);
        if (pwd !== null) callback(pwd);
        else void task.destroy();
      } catch {
        void task.destroy();
      }
    };
  }

  const proxy = await task.promise;
  return { proxy, pages: proxy.numPages };
}

/** Like openPdfOrThrow, but returns null when the file cannot be opened. A password request still throws. */
export async function openPdf(
  input: ArrayBuffer | OpenPdfOptions,
  passwordCallback?: (reason: "need_password" | "incorrect_password") => Promise<string | null>
): Promise<OpenPdfResult | null> {
  try {
    return await openPdfOrThrow(input, passwordCallback);
  } catch (err: any) {
    if (err?.name === "PasswordException") throw err;
    return null;
  }
}

// Render at the actual zoom level rather than scaling a low-resolution snapshot.
// The limits protect memory on very large/scanned pages while allowing noticeably sharper
// inspection at 200%+ zoom. One RGBA canvas pixel costs about 4 bytes.
export const RENDER_MAX_PIXELS = 48_000_000;
export const RENDER_MAX_SIDE = 20_000;
export const RENDER_DPR_LIMIT = 2.5;

export type RenderPlan = { scale: number; width: number; height: number; limited: boolean };

/** Pure, testable raster plan used for both normal and high-zoom rendering. */
export function calculateRenderPlan(
  baseWidth: number,
  baseHeight: number,
  cssWidth: number,
  devicePixelRatio = 1,
): RenderPlan {
  const dpr = Math.min(Math.max(devicePixelRatio || 1, 1), RENDER_DPR_LIMIT);
  const initialScale = (cssWidth / baseWidth) * dpr;
  const rawWidth = baseWidth * initialScale;
  const rawHeight = baseHeight * initialScale;
  const limit = Math.min(1, Math.sqrt(RENDER_MAX_PIXELS / Math.max(1, rawWidth * rawHeight)), RENDER_MAX_SIDE / Math.max(rawWidth, rawHeight));
  const scale = initialScale * limit;
  return { scale, width: Math.max(1, Math.floor(baseWidth * scale)), height: Math.max(1, Math.floor(baseHeight * scale)), limited: limit < 0.999999 };
}

// Page proxies per document. Only the most recent pages stay cached; evicted pages release their images and fonts.
const PAGE_CACHE_LIMIT = 16;
const pageCache = new WeakMap<PDFDocumentProxy, LruCache<number, Promise<PDFPageProxy>>>();
const aspectCache = new WeakMap<PDFDocumentProxy, Map<number, number>>();
const tasks = new WeakMap<HTMLCanvasElement, any>();

function getPageCached(proxy: PDFDocumentProxy, pageNumber: number): Promise<PDFPageProxy> {
  let cache = pageCache.get(proxy);
  if (!cache) {
    cache = new LruCache<number, Promise<PDFPageProxy>>(PAGE_CACHE_LIMIT, (evicted) => {
      // cleanup() frees cached images and fonts; the page can still be rendered again later.
      void evicted.then((page) => page.cleanup()).catch(() => {});
    });
    pageCache.set(proxy, cache);
  }
  let pending = cache.get(pageNumber);
  if (!pending) {
    pending = proxy.getPage(pageNumber);
    cache.set(pageNumber, pending);
  }
  return pending;
}

export async function pageAspect(proxy: PDFDocumentProxy, pageNumber: number): Promise<number> {
  const cached = aspectCache.get(proxy)?.get(pageNumber);
  if (cached) return cached;
  try {
    const page = await getPageCached(proxy, pageNumber);
    const v = page.getViewport({ scale: 1 });
    const a = v.height / v.width;
    let m = aspectCache.get(proxy);
    if (!m) {
      m = new Map();
      aspectCache.set(proxy, m);
    }
    m.set(pageNumber, a);
    return a;
  } catch {
    return 1.414;
  }
}

export function prefetchPage(proxy: PDFDocumentProxy, pageNumber: number) {
  if (pageNumber < 1 || pageNumber > proxy.numPages) return;
  void getPageCached(proxy, pageNumber).catch(() => {});
}

export async function renderPage(
  proxy: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  cssWidth: number
): Promise<boolean> {
  try {
    const page = await getPageCached(proxy, pageNumber);
    const base = page.getViewport({ scale: 1 });
    const plan = calculateRenderPlan(base.width, base.height, cssWidth, typeof window === "undefined" ? 1 : window.devicePixelRatio);
    const viewport = page.getViewport({ scale: plan.scale });

    // Render directly into the visible canvas. The previous two-canvas approach
    // temporarily held two full RGBA page buffers, which could exceed low-memory
    // machines while zooming. A cancelled render is simply replaced in-place.
    tasks.get(canvas)?.cancel?.();
    canvas.width = plan.width;
    canvas.height = plan.height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return false;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const task = page.render({ canvas, canvasContext: ctx, viewport } as any);
    tasks.set(canvas, task);
    await task.promise;
    tasks.delete(canvas);
    return true;
  } catch (err: any) {
    tasks.delete(canvas);
    if (err?.name === "RenderingCancelledException") return true;
    return false;
  }
}

/**
 * Render TextLayer for selectable and searchable text overlay in pdfjs 5.x
 */
export async function renderTextLayer(
  proxy: PDFDocumentProxy,
  pageNumber: number,
  container: HTMLDivElement,
  cssWidth: number
): Promise<any> {
  try {
    const page = await getPageCached(proxy, pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = cssWidth / base.width;
    const viewport = page.getViewport({ scale });

    container.innerHTML = "";
    container.style.width = `${Math.floor(viewport.width)}px`;
    container.style.height = `${Math.floor(viewport.height)}px`;
    container.style.setProperty("--scale-factor", `${scale}`);
    container.style.setProperty("--total-scale-factor", `${scale}`);

    const pdfjs = await getPdfjs();
    const textLayer = new (pdfjs as any).TextLayer({
      textContentSource: page.streamTextContent(),
      container,
      viewport,
    });

    await textLayer.render();
    return textLayer;
  } catch {
    return null;
  }
}

/**
 * Sample first 5 pages to detect if document is scanned (average < 20 chars per page)
 */
export async function detectOcrText(
  proxy: PDFDocumentProxy
): Promise<{ isScanned: boolean; sampleText: string; avgChars: number }> {
  try {
    const pagesToCheck = Math.min(proxy.numPages, 5);
    let totalChars = 0;
    let sampleParts: string[] = [];

    for (let p = 1; p <= pagesToCheck; p++) {
      const page = await getPageCached(proxy, p);
      const content = await page.getTextContent();
      const pageText = content.items.map((it: any) => it.str || "").join(" ");
      totalChars += pageText.trim().length;
      if (p <= 2 && pageText.trim().length > 0) {
        sampleParts.push(pageText.slice(0, 300));
      }
    }

    const avgChars = totalChars / pagesToCheck;
    const isScanned = avgChars < 20;

    return {
      isScanned,
      sampleText: sampleParts.join(" "),
      avgChars,
    };
  } catch {
    return { isScanned: true, sampleText: "", avgChars: 0 };
  }
}
