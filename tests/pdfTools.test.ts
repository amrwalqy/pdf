import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { extractPdfPages, mergePdfBuffers, parsePageRanges } from "../src/lib/pdfLibOps";

async function makePdf(pageCount: number): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([100, 100]);
  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function pageCountOf(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}

describe("mergePdfBuffers", () => {
  it("merges a 3-page and a 5-page document into 8 pages", async () => {
    const merged = await mergePdfBuffers([await makePdf(3), await makePdf(5)]);
    expect(await pageCountOf(merged)).toBe(8);
  });

  it("refuses to merge fewer than two files", async () => {
    await expect(mergePdfBuffers([await makePdf(2)])).rejects.toThrow("ملفين على الأقل");
  });
});

describe("extractPdfPages", () => {
  it("extracts only the requested 0-based pages, in the requested order", async () => {
    const extracted = await extractPdfPages(await makePdf(5), [0, 2]);
    expect(await pageCountOf(extracted)).toBe(2);
  });

  it("rejects page indices outside the document", async () => {
    await expect(extractPdfPages(await makePdf(2), [0, 5])).rejects.toThrow("خارج نطاق");
  });
});

describe("parsePageRanges", () => {
  it("parses mixed ranges into unique 0-based indices", () => {
    const result = parsePageRanges("1-3, 5, 8-", 8);
    expect(result.valid).toBe(true);
    expect(result.pages).toEqual([0, 1, 2, 4, 7]);
  });

  it("rejects an inverted range", () => {
    const result = parsePageRanges("5-2", 8);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("نطاق معكوس");
  });

  it("rejects a range that goes past the last page", () => {
    const result = parsePageRanges("1-9", 8);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("تتجاوز");
  });
});
