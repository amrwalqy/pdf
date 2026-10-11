import { countPdfPages, extractPdfPages, mergePdfBuffers, parsePageRanges, stampVisualSignature } from "./pdfLibOps";

export type PdfToolProgress = { done: number; total: number };
export type PdfToolBox = { x: number; y: number; width: number; height: number };

export type PdfToolRequest =
  | { op: "merge"; buffers: ArrayBuffer[] }
  | { op: "split"; buffer: ArrayBuffer; range: string }
  | { op: "sign"; buffer: ArrayBuffer; signaturePng: string; pageIndex: number; box: PdfToolBox };

/**
 * Runs one PDF tool and returns the new file. This is plain logic with no DOM access, so the same code
 * runs in the worker thread and in the unit tests.
 */
export async function runPdfTool(
  request: PdfToolRequest,
  onProgress?: (progress: PdfToolProgress) => void,
): Promise<Uint8Array> {
  switch (request.op) {
    case "merge":
      return mergePdfBuffers(request.buffers, onProgress);
    case "split": {
      const pageCount = await countPdfPages(request.buffer);
      const parsed = parsePageRanges(request.range, pageCount);
      if (!parsed.valid) throw new Error(parsed.error || "مجال الصفحات غير صالح.");
      return extractPdfPages(request.buffer, parsed.pages);
    }
    case "sign":
      return stampVisualSignature(request.buffer, request.signaturePng, request.pageIndex, request.box);
  }
}
