import { runPdfTool, type PdfToolRequest } from "./pdfToolRunner";

type WorkerScope = {
  onmessage: ((event: MessageEvent<{ request: PdfToolRequest }>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  runPdfTool(event.data.request, (progress) => scope.postMessage({ type: "progress", ...progress }))
    .then((bytes) => {
      // Hand the file back without copying it, unless it is a view into a larger buffer.
      const exact = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
      scope.postMessage({ type: "done", bytes: exact }, [exact.buffer as ArrayBuffer]);
    })
    .catch((error: unknown) => {
      scope.postMessage({ type: "error", message: error instanceof Error ? error.message : "تعذّر تنفيذ العملية." });
    });
};
