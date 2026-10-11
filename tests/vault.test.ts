import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { VaultManager } = require("../electron/vault.cjs");

describe("VaultManager AES-256-GCM encryption & security", () => {
  it("encrypts, decrypts, rejects wrong password, and detects single-byte tampering", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alif-vault-test-"));
    try {
      const vm = new VaultManager(() => tmpDir, undefined, { kdf: { name: "scrypt", N: 2 ** 15, r: 8, p: 1 } });
      expect(vm.getStatus().created).toBe(false);

      // Create with short password fails
      await expect(vm.createVault("short")).rejects.toThrow();

      // Create with valid password
      const status = await vm.createVault("SecretPassword123!");
      expect(status.created).toBe(true);
      expect(status.unlocked).toBe(true);

      // Add a dummy file
      const sampleFile = path.join(tmpDir, "document.pdf");
      const originalBytes = Buffer.from("Hello Arabic Alif Secure Vault! %PDF-1.4 sample content", "utf8");
      fs.writeFileSync(sampleFile, originalBytes);

      const added = await vm.addFile(sampleFile);
      expect(added.id).toBeDefined();

      const list = await vm.listFiles();
      expect(list.length).toBe(1);
      expect(list[0].name).toBe("document.pdf");

      // Read decrypted data and compare SHA-256
      const decrypted = await vm.readFile(added.id);
      const decHash = crypto.createHash("sha256").update(Buffer.from(decrypted.data)).digest("hex");
      const origHash = crypto.createHash("sha256").update(originalBytes).digest("hex");
      expect(decHash).toBe(origHash);

      // Lock vault
      vm.lock();
      expect(vm.getStatus().unlocked).toBe(false);
      await expect(vm.listFiles()).rejects.toThrow("الخزنة مقفلة");

      // Wrong password fails
      await expect(vm.unlock("WrongPassword999")).rejects.toThrow();
      expect(vm.getStatus().unlocked).toBe(false);

      // Correct password unlocks
      await vm.unlock("SecretPassword123!");
      expect(vm.getStatus().unlocked).toBe(true);

      // Tamper 1 byte of the encrypted payload on disk
      const vaultFile = path.join(tmpDir, "vault", `${added.id}.vault`);
      const encBytes = fs.readFileSync(vaultFile);
      encBytes[encBytes.length - 5] ^= 0xff; // flip bits of ciphertext
      fs.writeFileSync(vaultFile, encBytes);

      // Decryption must fail due to GCM auth tag mismatch
      await expect(vm.readFile(added.id)).rejects.toThrow();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
