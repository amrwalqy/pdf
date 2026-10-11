import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { VaultManager } = require("../electron/vault.cjs");

const PASSWORD = "Backup-Test-2026";
const OTHER = "Another-Password-2026";
const TEST_KDF = { name: "scrypt", N: 2 ** 15, r: 8, p: 1 };

function tmp(made: string[], prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
}

async function vaultWithFile(root: string, password: string, fileName: string, bytes: Buffer, work: string) {
  const vm = new VaultManager(() => root, undefined, { kdf: TEST_KDF });
  await vm.createVault(password);
  const file = path.join(work, fileName);
  fs.writeFileSync(file, bytes);
  await vm.addFile(file);
  return vm;
}

describe("vault backup and restore", () => {
  it("restores an exported backup with the same files and the same password", async () => {
    const made: string[] = [];
    try {
      const bytes = Buffer.from("%PDF-1.4 restored body");
      const work = tmp(made, "alif-bak-work-");
      const sourceRoot = tmp(made, "alif-bak-src-");
      const source = await vaultWithFile(sourceRoot, PASSWORD, "book.pdf", bytes, work);
      const out = path.join(work, "backup");
      const exported = await source.exportBackup(out);
      expect(exported.fileCount).toBeGreaterThanOrEqual(3);

      const targetRoot = tmp(made, "alif-bak-dst-");
      const target = new VaultManager(() => targetRoot, undefined, { kdf: TEST_KDF });
      const status = await target.importBackup(out, PASSWORD);
      expect(status.unlocked).toBe(true);
      const files = await target.listFiles();
      expect(files.map((f: { name: string }) => f.name)).toEqual(["book.pdf"]);
      const back = await target.readFile(files[0].id);
      expect(Buffer.from(back.data).equals(bytes)).toBe(true);
    } finally {
      for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("refuses a wrong password and leaves the target untouched", async () => {
    const made: string[] = [];
    try {
      const work = tmp(made, "alif-bak-work-");
      const source = await vaultWithFile(tmp(made, "alif-bak-src-"), PASSWORD, "a.pdf", Buffer.from("%PDF a"), work);
      const out = path.join(work, "backup");
      await source.exportBackup(out);
      const targetRoot = tmp(made, "alif-bak-dst-");
      const target = new VaultManager(() => targetRoot, undefined, { kdf: TEST_KDF });
      await expect(target.importBackup(out, "Wrong-Password-2026")).rejects.toThrow("كلمة المرور غير صحيحة");
      expect(fs.existsSync(path.join(targetRoot, "vault"))).toBe(false);
    } finally {
      for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("detects a changed file in the backup before restoring anything", async () => {
    const made: string[] = [];
    try {
      const work = tmp(made, "alif-bak-work-");
      const source = await vaultWithFile(tmp(made, "alif-bak-src-"), PASSWORD, "a.pdf", Buffer.from("%PDF a"), work);
      const out = path.join(work, "backup");
      await source.exportBackup(out);
      const damaged = fs.readdirSync(out).find((n) => n.endsWith(".vault") && n !== "index.vault");
      expect(damaged).toBeTruthy();
      fs.appendFileSync(path.join(out, damaged as string), Buffer.from("tampered"));
      const targetRoot = tmp(made, "alif-bak-dst-");
      const target = new VaultManager(() => targetRoot, undefined, { kdf: TEST_KDF });
      await expect(target.importBackup(out, PASSWORD)).rejects.toThrow("تكامل النسخة فشل");
    } finally {
      for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("requires the manifest, so an unverifiable copy is never restored", async () => {
    const made: string[] = [];
    try {
      const work = tmp(made, "alif-bak-work-");
      const source = await vaultWithFile(tmp(made, "alif-bak-src-"), PASSWORD, "a.pdf", Buffer.from("%PDF a"), work);
      const out = path.join(work, "backup");
      await source.exportBackup(out);
      fs.rmSync(path.join(out, "MANIFEST.json"));
      const targetRoot = tmp(made, "alif-bak-dst-");
      const target = new VaultManager(() => targetRoot, undefined, { kdf: TEST_KDF });
      await expect(target.importBackup(out, PASSWORD)).rejects.toThrow("MANIFEST");
    } finally {
      for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("restores only the files the manifest lists", async () => {
    const made: string[] = [];
    try {
      const work = tmp(made, "alif-bak-work-");
      const source = await vaultWithFile(tmp(made, "alif-bak-src-"), PASSWORD, "a.pdf", Buffer.from("%PDF a"), work);
      const out = path.join(work, "backup");
      await source.exportBackup(out);
      fs.writeFileSync(path.join(out, "extra.vault"), Buffer.from("not listed in the manifest"));
      const targetRoot = tmp(made, "alif-bak-dst-");
      await new VaultManager(() => targetRoot, undefined, { kdf: TEST_KDF }).importBackup(out, PASSWORD);
      expect(fs.existsSync(path.join(targetRoot, "vault", "extra.vault"))).toBe(false);
    } finally {
      for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("replaces an existing vault only when asked, and the old password stops working", async () => {
    const made: string[] = [];
    try {
      const work = tmp(made, "alif-bak-work-");
      const source = await vaultWithFile(tmp(made, "alif-bak-src-"), PASSWORD, "new.pdf", Buffer.from("%PDF new"), work);
      const out = path.join(work, "backup");
      await source.exportBackup(out);

      const existing = await vaultWithFile(tmp(made, "alif-bak-old-"), OTHER, "old.pdf", Buffer.from("%PDF old"), work);
      await expect(existing.importBackup(out, PASSWORD)).rejects.toThrow("الخزنة موجودة مسبقاً");

      const status = await existing.importBackup(out, PASSWORD, { overwrite: true });
      expect(status.unlocked).toBe(true);
      existing.lock();
      await expect(existing.unlock(OTHER)).rejects.toThrow();
      await existing.unlock(PASSWORD);
      expect((await existing.listFiles()).map((f: { name: string }) => f.name)).toEqual(["new.pdf"]);
    } finally {
      for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);

  it("will not export a vault that does not exist", async () => {
    const made: string[] = [];
    try {
      const emptyRoot = tmp(made, "alif-bak-none-");
      const vm = new VaultManager(() => emptyRoot, undefined, { kdf: TEST_KDF });
      await expect(vm.exportBackup(path.join(tmp(made, "alif-bak-out-"), "copy"))).rejects.toThrow("الخزنة غير موجودة");
    } finally {
      for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
