import { describe, it, expect } from "vitest";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { validateFileName, planRename, MAX_NAME_LENGTH } = require("../electron/rename.cjs");

describe("renaming a PDF", () => {
  it("adds .pdf when the user leaves it out, and does not double it when they type it", () => {
    expect(validateFileName("كتاب جديد")).toEqual({ ok: true, fileName: "كتاب جديد.pdf" });
    expect(validateFileName("Report.PDF")).toEqual({ ok: true, fileName: "Report.pdf" });
    expect(validateFileName("  spaced name  ")).toEqual({ ok: true, fileName: "spaced name.pdf" });
  });

  it("refuses an empty name", () => {
    expect(validateFileName("   ").ok).toBe(false);
    expect(validateFileName(".pdf").ok).toBe(false);
    expect(validateFileName(undefined as unknown as string).ok).toBe(false);
  });

  it("refuses characters Windows does not allow, including path separators", () => {
    for (const bad of ["a/b", "a\\b", "a:b", "a*b", "a?b", 'a"b', "a<b", "a>b", "a|b", "a\u0001b", "..\\..\\evil"]) {
      expect(validateFileName(bad).ok, bad).toBe(false);
    }
  });

  it("refuses names Windows reserves, and names ending in a dot or space", () => {
    for (const bad of ["CON", "nul", "COM1", "lpt9", "aux.backup", "name.", "name "]) {
      const r = validateFileName(bad);
      // "name " is trimmed first, so it is fine; the others must fail
      if (bad === "name ") expect(r.ok).toBe(true);
      else expect(r.ok, bad).toBe(false);
    }
  });

  it("refuses a name that is too long", () => {
    expect(validateFileName("a".repeat(MAX_NAME_LENGTH)).ok).toBe(true);
    expect(validateFileName("a".repeat(MAX_NAME_LENGTH + 1)).ok).toBe(false);
  });

  it("keeps the file in its own folder", () => {
    const old = path.join("C:", "Books", "deep", "old.pdf");
    const plan = planRename(old, "new");
    expect(plan.ok).toBe(true);
    expect(plan.newPath).toBe(path.join(path.dirname(old), "new.pdf"));
  });

  it("recognises an unchanged name and a case-only change", () => {
    const old = path.join("C:", "Books", "Old.pdf");
    expect(planRename(old, "Old").unchanged).toBe(true);
    const caseOnly = planRename(old, "old");
    expect(caseOnly.unchanged).toBe(false);
    expect(caseOnly.caseOnly).toBe(true);
    expect(planRename(old, "different").caseOnly).toBe(false);
  });
});
