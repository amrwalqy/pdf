import { PDFDocument } from "pdf-lib";

export type PageRangeParseResult = {
  valid: boolean;
  pages: number[]; // 0-indexed page numbers
  error?: string;
};

/**
 * Parses user input page ranges like "1-3, 5, 8-"
 * Validates strictly:
 * - 1-based indices within [1, totalPages]
 * - No inverted ranges like 5-2
 * - Human-readable Arabic error messages
 */
export function parsePageRanges(input: string, totalPages: number): PageRangeParseResult {
  if (!input || !input.trim()) {
    return { valid: false, pages: [], error: "يرجى إدخال مجال الصفحات المطلوب (مثال: 1-3, 5, 8)" };
  }

  const cleaned = input.trim();
  const parts = cleaned.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { valid: false, pages: [], error: "صيغة المجال غير صحيحة" };
  }

  const selectedPages: number[] = [];
  const seen = new Set<number>();

  for (const part of parts) {
    if (part.includes("-")) {
      const sides = part.split("-").map((s) => s.trim());
      if (sides.length !== 2) {
        return { valid: false, pages: [], error: `صيغة النطاق غير صالحة: ${part}` };
      }
      const startStr = sides[0];
      const endStr = sides[1];

      let start = startStr ? parseInt(startStr, 10) : 1;
      let end = endStr ? parseInt(endStr, 10) : totalPages;

      if (isNaN(start) || isNaN(end)) {
        return { valid: false, pages: [], error: `أرقام الصفحات يجب أن تكون صحيحة: ${part}` };
      }
      if (start < 1) {
        return { valid: false, pages: [], error: `رقم بداية الصفحة (${start}) أقل من 1` };
      }
      if (end > totalPages) {
        return { valid: false, pages: [], error: `الصفحة (${end}) تتجاوز إجمالي صفحات الملف (${totalPages})` };
      }
      if (start > end) {
        return { valid: false, pages: [], error: `نطاق معكوس غير صالح: من ${start} إلى ${end}` };
      }

      for (let p = start; p <= end; p++) {
        const idx = p - 1;
        if (!seen.has(idx)) {
          seen.add(idx);
          selectedPages.push(idx);
        }
      }
    } else {
      const p = parseInt(part, 10);
      if (isNaN(p)) {
        return { valid: false, pages: [], error: `رقم صفحة غير صالح: ${part}` };
      }
      if (p < 1 || p > totalPages) {
        return { valid: false, pages: [], error: `رقم الصفحة (${p}) خارج النطاق المتاح (1 إلى ${totalPages})` };
      }
      const idx = p - 1;
      if (!seen.has(idx)) {
        seen.add(idx);
        selectedPages.push(idx);
      }
    }
  }

  if (selectedPages.length === 0) {
    return { valid: false, pages: [], error: "لم يتم تحديد أي صفحات صحيحة" };
  }

  return { valid: true, pages: selectedPages };
}

/** Merge multiple PDF files (provided as Uint8Array / ArrayBuffer) */
export async function mergePdfBuffers(
  buffers: ArrayBuffer[],
  onProgress?: (progress: { done: number; total: number }) => void,
): Promise<Uint8Array> {
  if (buffers.length < 2) {
    throw new Error("يجب توفير ملفين على الأقل لإتمام عملية الدمج");
  }

  const merged = await PDFDocument.create();
  for (const [index, buf] of buffers.entries()) {
    const srcDoc = await PDFDocument.load(buf, { ignoreEncryption: true });
    const count = srcDoc.getPageCount();
    const indices = Array.from({ length: count }, (_, i) => i);
    const copiedPages = await merged.copyPages(srcDoc, indices);
    copiedPages.forEach((p) => merged.addPage(p));
    onProgress?.({ done: index + 1, total: buffers.length });
  }

  return await merged.save();
}

/** Extract specific 0-indexed pages from source PDF */
export async function extractPdfPages(sourceBuffer: ArrayBuffer, pageIndices: number[]): Promise<Uint8Array> {
  if (pageIndices.length === 0) {
    throw new Error("لم يتم تحديد صفحات للاستخراج");
  }

  const srcDoc = await PDFDocument.load(sourceBuffer, { ignoreEncryption: true });
  const total = srcDoc.getPageCount();
  for (const idx of pageIndices) {
    if (idx < 0 || idx >= total) {
      throw new Error(`الصفحة رقم ${idx + 1} خارج نطاق صفحات المستند`);
    }
  }

  const targetDoc = await PDFDocument.create();
  const copied = await targetDoc.copyPages(srcDoc, pageIndices);
  copied.forEach((p) => targetDoc.addPage(p));

  return await targetDoc.save();
}

/** Visual signature stamp (draw or image PNG) onto page */
export async function stampVisualSignature(
  sourceBuffer: ArrayBuffer,
  signaturePngDataUrl: string,
  pageIndex: number,
  options: { x: number; y: number; width: number; height: number }
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(sourceBuffer, { ignoreEncryption: true });
  const total = doc.getPageCount();
  if (pageIndex < 0 || pageIndex >= total) {
    throw new Error(`الصفحة المحددة (${pageIndex + 1}) غير موجودة بالمستند`);
  }

  const page = doc.getPage(pageIndex);
  const base64Data = signaturePngDataUrl.replace(/^data:image\/\w+;base64,/, "");
  const pngBytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
  const embeddedImage = await doc.embedPng(pngBytes);

  page.drawImage(embeddedImage, {
    x: options.x,
    y: options.y,
    width: options.width,
    height: options.height,
  });

  return await doc.save();
}

/** Number of pages in a PDF, read without changing the document. */
export async function countPdfPages(buffer: ArrayBuffer): Promise<number> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  return doc.getPageCount();
}
