import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { startPdfTool } from "../src/lib/pdfTools";
import { runPdfTool, type PdfToolRequest } from "../src/lib/pdfToolRunner";

type Handler = (worker: FakeWorker, message: { request: PdfToolRequest }) => void;

/** Stands in for a Web Worker: records messages and lets the test send replies back. */
class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  terminated = false;
  messages: unknown[] = [];

  constructor(private readonly handler: Handler) {}

  postMessage(message: { request: PdfToolRequest }): void {
    this.messages.push(message);
    this.handler(this, message);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(data: unknown): void {
    this.onmessage?.({ data });
  }
}

function asWorker(fake: FakeWorker): () => Pick<Worker, "postMessage" | "terminate" | "onmessage" | "onerror"> {
  return () => fake as unknown as Pick<Worker, "postMessage" | "terminate" | "onmessage" | "onerror">;
}

async function makePdf(pages: number): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("PDF tool worker client", () => {
  it("resolves with the file, forwards progress and stops the worker when done", async () => {
    const fake = new FakeWorker((worker) => {
      queueMicrotask(() => {
        worker.reply({ type: "progress", done: 1, total: 2 });
        worker.reply({ type: "done", bytes: new Uint8Array([7, 8]) });
      });
    });
    const progress: number[] = [];
    const job = startPdfTool({ op: "merge", buffers: [] }, { createWorker: asWorker(fake), onProgress: (p) => progress.push(p.done) });
    expect(Array.from(await job.result)).toEqual([7, 8]);
    expect(progress).toEqual([1]);
    expect(fake.terminated).toBe(true);
  });

  it("rejects with the message the worker reports", async () => {
    const fake = new FakeWorker((worker) => queueMicrotask(() => worker.reply({ type: "error", message: "boom" })));
    const job = startPdfTool({ op: "split", buffer: new ArrayBuffer(0), range: "1" }, { createWorker: asWorker(fake) });
    await expect(job.result).rejects.toThrow("boom");
    expect(fake.terminated).toBe(true);
  });

  it("rejects when the worker itself fails", async () => {
    const fake = new FakeWorker(() => undefined);
    const job = startPdfTool({ op: "merge", buffers: [] }, { createWorker: asWorker(fake) });
    fake.onerror?.({ message: "crash" });
    await expect(job.result).rejects.toThrow("crash");
    expect(fake.terminated).toBe(true);
  });

  it("cancels by stopping the worker, and ignores replies that arrive afterwards", async () => {
    const fake = new FakeWorker(() => undefined);
    const job = startPdfTool({ op: "merge", buffers: [] }, { createWorker: asWorker(fake) });
    job.cancel();
    expect(fake.terminated).toBe(true);
    fake.reply({ type: "done", bytes: new Uint8Array([1]) });
    await expect(job.result).rejects.toMatchObject({ name: "AbortError" });
  });

  it("produces the same merged file as running the tool directly", async () => {
    const fake = new FakeWorker((worker, message) => {
      void (async () => {
        const bytes = await runPdfTool(message.request, (p) => worker.reply({ type: "progress", ...p }));
        worker.reply({ type: "done", bytes });
      })();
    });
    const job = startPdfTool({ op: "merge", buffers: [await makePdf(2), await makePdf(3)] }, { createWorker: asWorker(fake) });
    const merged = await job.result;
    expect((await PDFDocument.load(merged)).getPageCount()).toBe(5);
  });
});
