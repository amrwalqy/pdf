import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { VaultManager } = require("../electron/vault.cjs");

const PASSWORD = "Storage-Test-2026";
const TEST_KDF = { name: "scrypt", N: 2 ** 15, r: 8, p: 1 };

describe("vault file storage", () => {
  it("round-trips a large file exactly", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alif-vault-big-"));
    try {
      const vm = new VaultManager(() => dir, undefined, { kdf: TEST_KDF });
      await vm.createVault(PASSWORD);
      const bytes = crypto.randomBytes(12 * 1024 * 1024);
      const source = path.join(dir, "large.pdf");
      fs.writeFileSync(source, bytes);

      const added = await vm.addFile(source);
      const back = await vm.readFile(added.id);
      expect(added.size).toBe(bytes.length);
      expect(Buffer.from(back.data).equals(bytes)).toBe(true);
      vm.lock();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("keeps every file when several are added at the same time", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alif-vault-parallel-"));
    try {
      const vm = new VaultManager(() => dir, undefined, { kdf: TEST_KDF });
      await vm.createVault(PASSWORD);
      const sources = [1, 2, 3, 4].map((i) => {
        const file = path.join(dir, `part-${i}.pdf`);
        fs.writeFileSync(file, `%PDF-1.4 part ${i}`);
        return file;
      });
      await Promise.all(sources.map((file) => vm.addFile(file)));
      const names = (await vm.listFiles()).map((f: { name: string }) => f.name).sort();
      expect(names).toEqual(["part-1.pdf", "part-2.pdf", "part-3.pdf", "part-4.pdf"]);
      vm.lock();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects tampering inside a stored file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alif-vault-tamper-"));
    try {
      const vm = new VaultManager(() => dir, undefined, { kdf: TEST_KDF });
      await vm.createVault(PASSWORD);
      const source = path.join(dir, "book.pdf");
      fs.writeFileSync(source, crypto.randomBytes(256 * 1024));
      const added = await vm.addFile(source);

      const blob = path.join(dir, "vault", `${added.id}.vault`);
      const bytes = fs.readFileSync(blob);
      bytes[Math.floor(bytes.length / 2)] ^= 0x01;
      fs.writeFileSync(blob, bytes);

      await expect(vm.readFile(added.id)).rejects.toThrow();
      vm.lock();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to add a file that does not exist", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alif-vault-missing-"));
    try {
      const vm = new VaultManager(() => dir, undefined, { kdf: TEST_KDF });
      await vm.createVault(PASSWORD);
      await expect(vm.addFile(path.join(dir, "missing.pdf"))).rejects.toThrow("الملف غير موجود");
      expect(await vm.listFiles()).toEqual([]);
      vm.lock();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
