import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { VaultManager } = require("../electron/vault.cjs");

const TEST_KDF = { name: "scrypt", N: 2 ** 15, r: 8, p: 1 };
const OLD = "Old-Password-2026";
const NEW = "New-Password-2027";

function tmpRoot(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `alif-vault-${label}-`));
}

function manager(root: string) {
  return new VaultManager(() => root, undefined, { kdf: TEST_KDF });
}

/** Creates a locked vault in `root` that holds one small file per name. */
async function vaultWithFiles(root: string, password: string, names: string[]) {
  const vm = manager(root);
  await vm.createVault(password);
  for (const name of names) {
    const file = path.join(root, name); // stored under this name
    fs.writeFileSync(file, `content of ${name}`);
    await vm.addFile(file);
  }
  vm.lock();
  return vm;
}

const vaultDir = (root: string) => path.join(root, "vault");
const fileNames = async (vm: { listFiles: () => Promise<Array<{ name: string }>> }) =>
  (await vm.listFiles()).map((f) => f.name).sort();

describe("changing the vault password", () => {
  it("re-encrypts every file under the new password and keeps the contents", async () => {
    const root = tmpRoot("change");
    try {
      const vm = await vaultWithFiles(root, OLD, ["a.pdf", "b.pdf"]);
      await vm.unlock(OLD);
      const status = await vm.changePassword(OLD, NEW);
      expect(status.unlocked).toBe(true);
      vm.lock();

      await expect(vm.unlock(OLD)).rejects.toThrow("كلمة المرور غير صحيحة");
      await vm.unlock(NEW);
      expect(await fileNames(vm)).toEqual(["a.pdf", "b.pdf"]);
      const first = await vm.readFile((await vm.listFiles())[0].id);
      expect(Buffer.from(first.data).toString("utf8")).toMatch(/^content of /);
      vm.lock();
      expect(fs.existsSync(path.join(root, "vault.next"))).toBe(false);
      expect(fs.existsSync(path.join(root, "vault.previous"))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a wrong current password and leaves the vault as it was", async () => {
    const root = tmpRoot("wrong-current");
    try {
      const vm = await vaultWithFiles(root, OLD, ["a.pdf"]);
      await vm.unlock(OLD);
      await expect(vm.changePassword("not-the-password", NEW)).rejects.toThrow("كلمة المرور الحالية غير صحيحة");
      vm.lock();
      await vm.unlock(OLD);
      expect(await fileNames(vm)).toEqual(["a.pdf"]);
      vm.lock();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a new password that is too short", async () => {
    const root = tmpRoot("short");
    try {
      const vm = await vaultWithFiles(root, OLD, []);
      await vm.unlock(OLD);
      await expect(vm.changePassword(OLD, "short")).rejects.toThrow("12 حرفاً");
      vm.lock();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("finishes a switch that stopped after the old vault was moved aside", async () => {
    const rootA = tmpRoot("finish-a");
    const rootB = tmpRoot("finish-b");
    try {
      await vaultWithFiles(rootA, OLD, ["a.pdf"]);
      await vaultWithFiles(rootB, NEW, ["a.pdf", "b.pdf"]);
      // The state after a crash: the new vault is complete and the old one has been moved aside.
      fs.cpSync(vaultDir(rootB), path.join(rootA, "vault.next"), { recursive: true });
      fs.writeFileSync(path.join(rootA, "vault.next", "COMPLETE"), "1");
      fs.renameSync(vaultDir(rootA), path.join(rootA, "vault.previous"));

      const vm = manager(rootA);
      await vm.unlock(NEW);
      expect(await fileNames(vm)).toEqual(["a.pdf", "b.pdf"]);
      vm.lock();
      expect(fs.existsSync(path.join(rootA, "vault.previous"))).toBe(false);
    } finally {
      fs.rmSync(rootA, { recursive: true, force: true });
      fs.rmSync(rootB, { recursive: true, force: true });
    }
  });

  it("puts the old vault back when a switch stopped before the new one was complete", async () => {
    const root = tmpRoot("rollback");
    try {
      await vaultWithFiles(root, OLD, ["a.pdf"]);
      fs.renameSync(vaultDir(root), path.join(root, "vault.previous"));
      const vm = manager(root);
      await vm.unlock(OLD);
      expect(await fileNames(vm)).toEqual(["a.pdf"]);
      expect(fs.existsSync(path.join(root, "vault.previous"))).toBe(false);
      vm.lock();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("discards an unfinished new vault and keeps the old password", async () => {
    const rootA = tmpRoot("discard-a");
    const rootB = tmpRoot("discard-b");
    try {
      await vaultWithFiles(rootA, OLD, ["a.pdf"]);
      await vaultWithFiles(rootB, NEW, ["x.pdf"]);
      fs.cpSync(vaultDir(rootB), path.join(rootA, "vault.next"), { recursive: true }); // no COMPLETE marker

      const vm = manager(rootA);
      await vm.unlock(OLD);
      expect(fs.existsSync(path.join(rootA, "vault.next"))).toBe(false);
      expect(await fileNames(vm)).toEqual(["a.pdf"]);
      vm.lock();
    } finally {
      fs.rmSync(rootA, { recursive: true, force: true });
      fs.rmSync(rootB, { recursive: true, force: true });
    }
  });

  it("removes the old copy once the new vault is in place", async () => {
    const rootA = tmpRoot("cleanup-a");
    const rootB = tmpRoot("cleanup-b");
    try {
      await vaultWithFiles(rootA, OLD, ["a.pdf"]);
      await vaultWithFiles(rootB, NEW, ["a.pdf"]);
      fs.cpSync(vaultDir(rootA), path.join(rootA, "vault.previous"), { recursive: true });
      fs.rmSync(vaultDir(rootA), { recursive: true, force: true });
      fs.cpSync(vaultDir(rootB), vaultDir(rootA), { recursive: true });

      const vm = manager(rootA);
      await vm.unlock(NEW);
      expect(fs.existsSync(path.join(rootA, "vault.previous"))).toBe(false);
      vm.lock();
    } finally {
      fs.rmSync(rootA, { recursive: true, force: true });
      fs.rmSync(rootB, { recursive: true, force: true });
    }
  });
});
