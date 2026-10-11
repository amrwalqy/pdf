import type { PdfToolProgress, PdfToolRequest } from "./pdfToolRunner";

export type PdfToolJob = {
  result: Promise<Uint8Array<ArrayBuffer>>;
  cancel: () => void;
};

type StartOptions = {
  createWorker: () => Pick<Worker, "postMessage" | "terminate" | "onmessage" | "onerror">;
  onProgress?: (progress: PdfToolProgress) => void;
};

type WorkerReply =
  | ({ type: "progress" } & PdfToolProgress)
  | { type: "done"; bytes: Uint8Array<ArrayBuffer> }
  | { type: "error"; message: string };

/**
 * Runs one PDF tool in its own worker thread, so a large merge, split or signature never freezes the window.
 * Each job gets a fresh worker, so cancelling simply stops that worker. The inputs are copied to the worker
 * (the viewer still needs them); the finished file is transferred back without another copy.
 */
export function startPdfTool(request: PdfToolRequest, options: StartOptions): PdfToolJob {
  const worker = options.createWorker();
  let finished = false;
  let rejectResult: (reason: Error) => void = () => {};

  const result = new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    rejectResult = reject;
    worker.onmessage = (event) => {
      if (finished) return;
      const reply = event.data as WorkerReply;
      if (reply.type === "progress") {
        options.onProgress?.({ done: reply.done, total: reply.total });
        return;
      }
      finished = true;
      worker.terminate();
      if (reply.type === "done") resolve(reply.bytes);
      else reject(new Error(reply.message));
    };
    worker.onerror = (event) => {
      if (finished) return;
      finished = true;
      worker.terminate();
      reject(new Error(event.message || "تعذّر تشغيل أداة PDF."));
    };
  });

  worker.postMessage({ request }, []);

  return {
    result,
    cancel: () => {
      if (finished) return;
      finished = true;
      worker.terminate();
      rejectResult(new DOMException("أُلغيت العملية.", "AbortError"));
    },
  };
}
