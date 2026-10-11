import PdfToolsWorker from "./pdfTools.worker?worker&inline";

/** Creates the worker that runs PDF tools. Kept in its own module so the tests never load the bundled worker. */
export function createPdfToolWorker(): Worker {
  return new PdfToolsWorker();
}
