import { describe, it, expect } from "vitest";
import { relPath, relDir, buildShelfTree } from "../src/lib/shelves";
import type { Doc } from "../src/data";

describe("Shelves path resolution and tree building", () => {
  it("resolves Windows paths with trailing slash and without", () => {
    const full = "C:\\Lib\\روايات\\خيال\\a.pdf";
    expect(relPath(full, "C:\\Lib\\")).toBe("روايات/خيال/a.pdf");
    expect(relPath(full, "C:\\Lib")).toBe("روايات/خيال/a.pdf");
    expect(relDir(full, "C:\\Lib")).toBe("روايات/خيال");
  });

  it("handles case-insensitive drive letters and root paths", () => {
    const full = "C:\\Lib\\دين\\تفسير\\كتاب.pdf";
    expect(relPath(full, "c:\\lib")).toBe("دين/تفسير/كتاب.pdf");
    expect(relDir(full, "c:\\lib")).toBe("دين/تفسير");
  });

  it("handles UNC paths correctly", () => {
    const full = "\\\\server\\share\\lib\\دواوين\\شعر.pdf";
    const root = "\\\\server\\share\\lib";
    expect(relPath(full, root)).toBe("دواوين/شعر.pdf");
    expect(relDir(full, root)).toBe("دواوين");
  });

  it("handles files directly in root and browser relative paths", () => {
    expect(relPath("C:\\Lib\\main.pdf", "C:\\Lib")).toBe("main.pdf");
    expect(relDir("C:\\Lib\\main.pdf", "C:\\Lib")).toBe("");

    expect(relPath("روايات/خيال/b.pdf", null)).toBe("روايات/خيال/b.pdf");
    expect(relDir("روايات/خيال/b.pdf", null)).toBe("روايات/خيال");
  });

  it("builds shelf tree including empty shelves and sorts Arabic names", () => {
    const docs: Doc[] = [
      {
        id: "1",
        file: "b.pdf",
        title: "كتاب ب",
        path: "C:\\Lib\\روايات\\b.pdf",
      } as any,
      {
        id: "2",
        file: "a.pdf",
        title: "كتاب أ",
        path: "C:\\Lib\\دواوين\\a.pdf",
      } as any,
    ];

    const dirs = ["C:\\Lib\\دين", "C:\\Lib\\روايات", "C:\\Lib\\دواوين"];
    const { tree } = buildShelfTree(docs, "C:\\Lib", "المكتبة", dirs);

    expect(tree.children.length).toBe(3);
    // Arabic alphabetical sort: دواوين, دين, روايات
    expect(tree.children.map((c) => c.name)).toEqual(["دواوين", "دين", "روايات"]);

    const deen = tree.children.find((c) => c.name === "دين");
    expect(deen?.total).toBe(0); // empty shelf retained
    expect(deen?.direct).toBe(0);
  });
});
