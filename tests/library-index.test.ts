import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { writePdfsAsync } from "./helpers/fixtures";

const require = createRequire(import.meta.url);
const { LibraryIndex, SAFETY_LIMIT_FILES } = require("../electron/library-index.cjs");

function tmpLibrary(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "alif-index-"));
}

function writePdf(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "%PDF-1.4 test");
}

function recorder() {
  const deltas: Array<Record<string, string[]> & { addedFiles: Array<{ path: string }>; updatedFiles: Array<{ path: string }>; removedFiles: string[]; addedDirs: string[]; removedDirs: string[] }> = [];
  return { deltas, onDelta: (delta: never) => deltas.push(delta) };
}

describe("library index", () => {
  it("finds every PDF at any depth, and every folder", async () => {
    const root = tmpLibrary();
    try {
      writePdf(path.join(root, "a.pdf"));
      writePdf(path.join(root, "one", "b.pdf"));
      writePdf(path.join(root, "one", "two", "three", "deep.pdf"));
      writePdf(path.join(root, ".hidden", "skip.pdf"));
      fs.writeFileSync(path.join(root, "notes.txt"), "not a book");
      const index = new LibraryIndex(root);
      const snapshot = await index.build();
      expect(snapshot.files.map((f: { name: string }) => f.name).sort()).toEqual(["a.pdf", "b.pdf", "deep.pdf"]);
      expect(snapshot.dirs.map((d: string) => path.relative(root, d).split(path.sep).join("/")).sort()).toEqual([
        "one",
        "one/two",
        "one/two/three",
      ]);
      expect(snapshot.truncated).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports a new file as one added entry after a notification", async () => {
    const root = tmpLibrary();
    try {
      writePdf(path.join(root, "shelf", "old.pdf"));
      const rec = recorder();
      const index = new LibraryIndex(root, { onDelta: rec.onDelta });
      await index.build();
      writePdf(path.join(root, "shelf", "new.pdf"));
      index.notify(path.join(root, "shelf"), "new.pdf");
      await index.flush();
      expect(rec.deltas).toHaveLength(1);
      expect(rec.deltas[0].addedFiles.map((f) => path.basename(f.path))).toEqual(["new.pdf"]);
      expect(rec.deltas[0].removedFiles).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports a deleted file as a removal, and touches nothing else", async () => {
    const root = tmpLibrary();
    try {
      writePdf(path.join(root, "shelf", "gone.pdf"));
      writePdf(path.join(root, "shelf", "stays.pdf"));
      const rec = recorder();
      const index = new LibraryIndex(root, { onDelta: rec.onDelta });
      await index.build();
      fs.rmSync(path.join(root, "shelf", "gone.pdf"));
      index.notify(path.join(root, "shelf"), "gone.pdf");
      await index.flush();
      expect(rec.deltas[0].removedFiles.map((p) => path.basename(p))).toEqual(["gone.pdf"]);
      expect(index.snapshot().files.map((f: { name: string }) => f.name)).toEqual(["stays.pdf"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("indexes a newly created folder with its files, and removes a deleted folder with its files", async () => {
    const root = tmpLibrary();
    try {
      writePdf(path.join(root, "keep", "k.pdf"));
      const rec = recorder();
      const index = new LibraryIndex(root, { onDelta: rec.onDelta });
      await index.build();

      writePdf(path.join(root, "fresh", "inner", "f.pdf"));
      index.notify(root, "fresh");
      await index.flush();
      expect(rec.deltas[0].addedDirs.map((d) => path.basename(d)).sort()).toEqual(["fresh", "inner"]);
      expect(rec.deltas[0].addedFiles.map((f) => f.name)).toEqual(["f.pdf"]);

      fs.rmSync(path.join(root, "fresh"), { recursive: true, force: true });
      index.notify(root, "fresh");
      await index.flush();
      expect(rec.deltas[1].removedDirs.map((d) => path.basename(d)).sort()).toEqual(["fresh", "inner"]);
      expect(rec.deltas[1].removedFiles.map((p) => path.basename(p))).toEqual(["f.pdf"]);
      expect(index.snapshot().files.map((f: { name: string }) => f.name)).toEqual(["k.pdf"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("catches a changed file size when asked to re-check every file", async () => {
    const root = tmpLibrary();
    try {
      const file = path.join(root, "shelf", "grow.pdf");
      writePdf(file);
      const rec = recorder();
      const index = new LibraryIndex(root, { onDelta: rec.onDelta });
      await index.build();
      fs.writeFileSync(file, "%PDF-1.4 a much longer test document body");
      await index.verify({ restat: true });
      expect(rec.deltas[0].updatedFiles.map((f) => f.path)).toEqual([file]);
      expect(index.snapshot().files[0].size).toBe(fs.statSync(file).size);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("stops at the safety limit and says so", async () => {
    const root = tmpLibrary();
    try {
      for (let i = 0; i < 5; i++) writePdf(path.join(root, `book-${i}.pdf`));
      const index = new LibraryIndex(root, { maxFiles: 3 });
      const snapshot = await index.build();
      expect(snapshot.files).toHaveLength(3);
      expect(snapshot.truncated).toBe(true);
      expect(SAFETY_LIMIT_FILES).toBeGreaterThan(100000);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("indexes a library with 10,000 sub-folders, including a PDF deep inside one of them", async () => {
    const root = tmpLibrary();
    try {
      const files: string[] = [];
      for (let i = 0; i < 10000; i++) {
        files.push(path.join(root, `folder-${String(i).padStart(5, "0")}`, `book-${i}.pdf`));
      }
      files.push(path.join(root, "folder-09999", "chapters", "part", "needle-deep.pdf"));
      // Creating the fixture is not what this test measures, so it is done in parallel and not timed.
      await writePdfsAsync(files);
      const started = Date.now();
      const index = new LibraryIndex(root);
      const snapshot = await index.build();
      const seconds = (Date.now() - started) / 1000;
      expect(snapshot.dirs.length).toBeGreaterThanOrEqual(10000);
      expect(snapshot.files.length).toBe(10001);
      expect(snapshot.files.some((f: { name: string }) => f.name === "needle-deep.pdf")).toBe(true);
      expect(seconds).toBeLessThan(60);
      console.log(`    indexed 10,000 folders and ${snapshot.files.length} PDFs in ${seconds.toFixed(2)} s`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 600_000);

  it("reports nothing when a full re-check finds nothing changed", async () => {
    const root = tmpLibrary();
    try {
      writePdf(path.join(root, "shelf", "still.pdf"));
      const rec = recorder();
      const index = new LibraryIndex(root, { onDelta: rec.onDelta });
      await index.build();
      await index.verify({ restat: true });
      expect(rec.deltas).toHaveLength(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
