/**
 * Prints a PDF that is already open in the reader.
 * Each page is drawn to an image, put in a hidden frame, and the system print dialog is opened.
 * Pages are drawn one at a time, so memory stays modest even for long documents.
 */

export const PRINT_PAGE_LIMIT = 400;
const PRINT_SCALE = 2; // about 144 dpi for a normal page: sharp on paper, light on memory

type PdfProxyLike = {
  numPages: number;
  getPage: (n: number) => Promise<{
    getViewport: (o: { scale: number }) => { width: number; height: number };
    render: (o: any) => { promise: Promise<void> };
    cleanup?: () => void;
  }>;
};

export type PrintOutcome = "printed" | "cancelled" | "too-long" | "failed";

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.92));
}

export async function printPdfDocument(
  proxy: PdfProxyLike,
  title: string,
  onProgress?: (done: number, total: number) => void,
  isCancelled?: () => boolean,
): Promise<PrintOutcome> {
  const total = proxy.numPages;
  if (total > PRINT_PAGE_LIMIT) return "too-long";
  const urls: string[] = [];
  const cleanup = (frame?: HTMLIFrameElement) => {
    for (const url of urls) URL.revokeObjectURL(url);
    urls.length = 0;
    frame?.remove();
  };
  try {
    for (let n = 1; n <= total; n++) {
      if (isCancelled?.()) { cleanup(); return "cancelled"; }
      const page = await proxy.getPage(n);
      const viewport = page.getViewport({ scale: PRINT_SCALE });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) { cleanup(); return "failed"; }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      const blob = await canvasToBlob(canvas);
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup?.();
      if (!blob) { cleanup(); return "failed"; }
      urls.push(URL.createObjectURL(blob));
      onProgress?.(n, total);
    }

    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) { cleanup(frame); return "failed"; }
    const safeTitle = title.replace(/[<>&"]/g, " ");
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title><style>
      @page { margin: 0; }
      html, body { margin: 0; padding: 0; background: #fff; }
      img { display: block; width: 100%; height: auto; page-break-after: always; break-after: page; }
      img:last-child { page-break-after: auto; break-after: auto; }
    </style></head><body>${urls.map((u) => `<img src="${u}" alt="">`).join("")}</body></html>`);
    doc.close();

    // Wait until every page image is decoded, then print.
    await Promise.all(Array.from(doc.images).map((img) => (img.complete ? Promise.resolve() : new Promise<void>((resolve) => { img.onload = img.onerror = () => resolve(); }))));
    await new Promise<void>((resolve) => {
      const finish = () => resolve();
      win.addEventListener("afterprint", finish, { once: true });
      window.setTimeout(finish, 10 * 60 * 1000); // safety: never keep the pages in memory forever
      win.focus();
      win.print();
    });
    cleanup(frame);
    return "printed";
  } catch {
    cleanup();
    return "failed";
  }
}
