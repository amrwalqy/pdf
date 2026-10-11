import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { VaultManager, MAGIC, KDF_CURRENT } = require("../electron/vault.cjs");

const PASSWORD = "LegacyPassword!2026";
// Same algorithm as production, cheaper cost, so the suite stays fast on slow machines.
const TEST_KDF = { name: "scrypt", N: 2 ** 15, r: 8, p: 1 };

/** Writes a vault exactly as the first Alif build did: scrypt N=2^15 and no "kdf" entry in the config. */
function writeLegacyVault(storageDir: string) {
  const vaultDir = path.join(storageDir, "vault");
  fs.mkdirSync(vaultDir, { recursive: true });

  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(PASSWORD, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(Buffer.from("[]", "utf8")), cipher.final()]);
  const payload = Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);

  fs.writeFileSync(path.join(vaultDir, "vault-config.json"), JSON.stringify({ saltHex: salt.toString("hex"), createdAt: 1 }));
  fs.writeFileSync(path.join(vaultDir, "index.vault"), payload);
}

describe("vault key derivation and upgrades", () => {
  it("uses the production scrypt cost for new vaults by default", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alif-kdf-default-"));
    try {
      const vm = new VaultManager(() => dir);
      expect(vm.newVaultKdf).toEqual(KDF_CURRENT);
      expect(KDF_CURRENT.N).toBe(2 ** 17);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes the cost used for a new vault into its config and unlocks with it", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alif-kdf-new-"));
    try {
      const vm = new VaultManager(() => dir, undefined, { kdf: TEST_KDF });
      await vm.createVault(PASSWORD);
      vm.lock();
      const config = JSON.parse(fs.readFileSync(path.join(dir, "vault", "vault-config.json"), "utf8"));
      expect(config.kdf).toEqual(TEST_KDF);
      await vm.unlock(PASSWORD);
      expect(vm.getStatus().unlocked).toBe(true);
      vm.lock();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("opens a vault created by the previous version and keeps it usable after upgrade", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alif-kdf-legacy-"));
    try {
      writeLegacyVault(dir);
      const vm = new VaultManager(() => dir);

      await expect(vm.unlock("wrong-password")).rejects.toThrow("كلمة المرور غير صحيحة");
      await vm.unlock(PASSWORD);
      expect(await vm.listFiles()).toEqual([]);

      const sample = path.join(dir, "note.pdf");
      fs.writeFileSync(sample, "%PDF-1.4 legacy test");
      await vm.addFile(sample);
      vm.lock();

      await vm.unlock(PASSWORD);
      const files = await vm.listFiles();
      expect(files.map((f: { name: string }) => f.name)).toEqual(["note.pdf"]);
      vm.lock();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a config with an unknown or unsafe scrypt setting", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alif-kdf-bad-"));
    try {
      writeLegacyVault(dir);
      const configPath = path.join(dir, "vault", "vault-config.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      config.kdf = { name: "scrypt", N: 2 ** 30, r: 8, p: 1 };
      fs.writeFileSync(configPath, JSON.stringify(config));

      const vm = new VaultManager(() => dir);
      await expect(vm.unlock(PASSWORD)).rejects.toThrow();
      expect(vm.getStatus().unlocked).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
