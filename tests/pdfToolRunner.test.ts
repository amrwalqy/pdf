import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { runPdfTool } from "../src/lib/pdfToolRunner";

// A 1 x 1 PNG, enough to check that a signature image is embedded.
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

async function makePdf(pages: number): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}

describe("PDF tool runner", () => {
  it("merges files in order and reports progress for each one", async () => {
    const progress: Array<[number, number]> = [];
    const merged = await runPdfTool(
      { op: "merge", buffers: [await makePdf(3), await makePdf(2), await makePdf(4)] },
      (p) => progress.push([p.done, p.total]),
    );
    expect(await pageCount(merged)).toBe(9);
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it("extracts a page range from a document it counts itself", async () => {
    const out = await runPdfTool({ op: "split", buffer: await makePdf(8), range: "1-3, 8" });
    expect(await pageCount(out)).toBe(4);
  });

  it("reports an invalid page range in Arabic", async () => {
    await expect(runPdfTool({ op: "split", buffer: await makePdf(8), range: "5-2" })).rejects.toThrow("نطاق معكوس");
  });

  it("stamps a signature image on the chosen page", async () => {
    const out = await runPdfTool({
      op: "sign",
      buffer: await makePdf(2),
      signaturePng: TINY_PNG,
      pageIndex: 1,
      box: { x: 10, y: 10, width: 50, height: 30 },
    });
    expect(await pageCount(out)).toBe(2);
  });

  it("refuses to sign a page that does not exist", async () => {
    await expect(
      runPdfTool({ op: "sign", buffer: await makePdf(2), signaturePng: TINY_PNG, pageIndex: 5, box: { x: 0, y: 0, width: 10, height: 10 } }),
    ).rejects.toThrow("غير موجودة");
  });
});
