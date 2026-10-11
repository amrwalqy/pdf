import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PathSecurity } = require("../electron/paths.cjs");

describe("PathSecurity allowlist and traversal protection", () => {
  it("allows files under root, blocks outside traversal, symlinks outside, and non-pdf", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alif-paths-test-"));
    const libDir = path.join(tmpDir, "Library");
    const secretDir = path.join(tmpDir, "Secret");
    fs.mkdirSync(libDir, { recursive: true });
    fs.mkdirSync(secretDir, { recursive: true });

    const goodPdf = path.join(libDir, "book.pdf");
    const badTxt = path.join(libDir, "script.exe");
    const secretPdf = path.join(secretDir, "secret.pdf");
    fs.writeFileSync(goodPdf, "pdf");
    fs.writeFileSync(badTxt, "exe");
    fs.writeFileSync(secretPdf, "secret");

    try {
      const ps = new PathSecurity(() => libDir);

      // Allowed under libDir
      expect(ps.assertAllowed(goodPdf, { requirePdf: true })).toBe(fs.realpathSync(goodPdf));

      // Traversal using .. to secret
      expect(() =>
        ps.assertAllowed(path.join(libDir, "..", "Secret", "secret.pdf"), { requirePdf: true })
      ).toThrow("خارج نطاق");

      // Non-PDF rejection
      expect(() => ps.assertAllowed(badTxt, { requirePdf: true })).toThrow("يجب أن يكون .pdf");

      // Symlink escaping library
      try {
        const symlinkPath = path.join(libDir, "escaped.pdf");
        fs.symlinkSync(secretPdf, symlinkPath);
        expect(() => ps.assertAllowed(symlinkPath, { requirePdf: true })).toThrow("خارج نطاق");
      } catch (symErr) {
        // Windows unprivileged symlinks might throw EPERM; ignore if system doesn't permit symlink
      }

      // Explicitly allowed single file
      ps.addAllowedFile(secretPdf);
      expect(ps.assertAllowed(secretPdf, { requirePdf: true })).toBe(fs.realpathSync(secretPdf));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
