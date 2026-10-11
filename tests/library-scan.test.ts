import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { writePdfsAsync } from "./helpers/fixtures";

const require = createRequire(import.meta.url);
const { scanLibraryTree, MAX_SCAN_FILES } = require("../electron/library-scan.cjs");

function tmpLibrary(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "alif-scan-"));
}

function writePdf(file: string, mtimeSeconds?: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "%PDF-1.4 test");
  if (mtimeSeconds !== undefined) fs.utimesSync(file, mtimeSeconds, mtimeSeconds);
}

const relative = (root: string, full: string) => path.relative(root, full).split(path.sep).join("/");

describe("library folder scan", () => {
  it("lists PDFs and folders, skips hidden folders and ignores other files", async () => {
    const root = tmpLibrary();
    try {
      writePdf(path.join(root, "a.pdf"));
      writePdf(path.join(root, "sub", "b.PDF"));
      writePdf(path.join(root, "sub", "deep", "c.pdf"));
      writePdf(path.join(root, ".hidden", "d.pdf"));
      fs.writeFileSync(path.join(root, "notes.txt"), "not a book");
      fs.mkdirSync(path.join(root, "empty"));

      const result = await scanLibraryTree(root);
      expect(result.files.map((f: { name: string }) => f.name).sort()).toEqual(["a.pdf", "b.PDF", "c.pdf"]);
      expect(result.dirs.map((d: string) => relative(root, d)).sort()).toEqual(["empty", "sub", "sub/deep"]);
      expect(result.truncated).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("sorts the newest files first and reports size and modification time", async () => {
    const root = tmpLibrary();
    try {
      writePdf(path.join(root, "old.pdf"), 1_600_000_000);
      writePdf(path.join(root, "new.pdf"), 1_700_000_000);
      const result = await scanLibraryTree(root);
      expect(result.files.map((f: { name: string }) => f.name)).toEqual(["new.pdf", "old.pdf"]);
      expect(result.files[0].lastModified).toBe(1_700_000_000_000);
      expect(result.files[0].size).toBeGreaterThan(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("stops at the depth limit and reports it", async () => {
    const root = tmpLibrary();
    try {
      writePdf(path.join(root, "top.pdf"));
      writePdf(path.join(root, "one", "inside.pdf"));
      writePdf(path.join(root, "one", "two", "deeper.pdf"));
      const result = await scanLibraryTree(root, { maxDepth: 1 });
      expect(result.files.map((f: { name: string }) => f.name).sort()).toEqual(["inside.pdf", "top.pdf"]);
      expect(result.truncated).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("stops at the file limit and reports it", async () => {
    const root = tmpLibrary();
    try {
      for (let i = 0; i < 3; i++) writePdf(path.join(root, `book-${i}.pdf`));
      const result = await scanLibraryTree(root, { maxFiles: 2 });
      expect(result.files).toHaveLength(2);
      expect(result.truncated).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports truncation when the limit is reached while several folders are scanned at once", async () => {
    const root = tmpLibrary();
    try {
      for (let folder = 0; folder < 6; folder++) writePdf(path.join(root, `shelf-${folder}`, "book.pdf"));
      const result = await scanLibraryTree(root, { maxFiles: 4 });
      expect(result.files).toHaveLength(4);
      expect(result.truncated).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("indexes a full-size library (5000 PDFs in 50 folders) quickly and completely", async () => {
    const root = tmpLibrary();
    try {
      const files: string[] = [];
      for (let folder = 0; folder < 50; folder++) {
        for (let book = 0; book < 100; book++) {
          files.push(path.join(root, `shelf-${folder}`, `book-${book}.pdf`));
        }
      }
      await writePdfsAsync(files);
      expect(MAX_SCAN_FILES).toBe(5000);
      const started = Date.now();
      const result = await scanLibraryTree(root);
      const elapsed = Date.now() - started;
      expect(result.files).toHaveLength(5000);
      expect(result.dirs).toHaveLength(50);
      expect(result.truncated).toBe(false);
      expect(elapsed).toBeLessThan(15_000);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 300_000);
});
