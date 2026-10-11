/* Alif Secure Vault (Windows).
   Every file is encrypted with AES-256-GCM. The key is derived from the vault password with scrypt
   and kept in memory only while the vault is unlocked. The key is not bound to this PC, the Windows
   account or any hardware: if the password is forgotten, the vault cannot be recovered.
   Large files are encrypted and decrypted as streams, so the application keeps responding.
   A password change writes a complete new vault folder first and then switches folders, so an
   interruption never loses the vault (see changePassword and _recoverInterruptedChange). */

const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs").promises;
const path = require("path");
const { Writable } = require("stream");
const { pipeline } = require("stream/promises");

const MAGIC = Buffer.from("ALIFVAULT1", "utf8"); // 10 bytes
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const MIN_PASSWORD_LENGTH = 12;
const SCRYPT_MAX_MEM = 256 * 1024 * 1024;
const MAX_VAULT_FILE_BYTES = 2 * 1024 * 1024 * 1024;

// Layout of an encrypted blob: MAGIC | salt (reserved slot) | iv | tag | ciphertext
const IV_OFFSET = MAGIC.length + SALT_LEN;
const TAG_OFFSET = IV_OFFSET + IV_LEN;
const HEADER_LEN = TAG_OFFSET + TAG_LEN;

// Cost used for new vaults: scrypt N=2^17 (about 128 MiB while the key is derived).
const KDF_CURRENT = Object.freeze({ name: "scrypt", N: 2 ** 17, r: 8, p: 1 });
// Vaults created before this setting existed have no "kdf" entry in vault-config.json.
const KDF_LEGACY = Object.freeze({ name: "scrypt", N: 2 ** 15, r: 8, p: 1 });
const KDF_MIN_N = 2 ** 15;
const KDF_MAX_N = 2 ** 20;

// Folder names used while the password is changed. A change is committed by renaming these folders.
const NEXT_FOLDER = "vault.next";
const PREVIOUS_FOLDER = "vault.previous";
const COMPLETE_MARKER = "COMPLETE";

function kdfFromConfig(config) {
  if (!config.kdf) return KDF_LEGACY;
  const { name, N, r, p } = config.kdf;
  const isValid =
    name === "scrypt" &&
    Number.isInteger(N) &&
    N >= KDF_MIN_N &&
    N <= KDF_MAX_N &&
    (N & (N - 1)) === 0 &&
    r === 8 &&
    p === 1;
  if (!isValid) throw new Error("إعدادات تشفير الخزنة غير معروفة");
  return { name, N, r, p };
}

// The index and the config are small, so they are written in one piece: temp file, then rename.
function writeFileAtomic(target, data) {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, target);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
    throw err;
  }
}

// Streams the plaintext through AES-GCM. The auth tag is only known at the end, so it is written
// into the header's reserved slot once the stream has finished.
async function encryptFileTo(sourcePath, targetPath, key) {
  const salt = crypto.randomBytes(SALT_LEN); // reserved slot of the format; the key is derived once per unlock
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const tmp = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  const out = fs.createWriteStream(tmp);
  try {
    out.write(Buffer.concat([MAGIC, salt, iv, Buffer.alloc(TAG_LEN)]));
    await pipeline(fs.createReadStream(sourcePath), cipher, out);
    const tag = cipher.getAuthTag();
    const handle = await fsp.open(tmp, "r+");
    try {
      await handle.write(tag, 0, TAG_LEN, TAG_OFFSET);
    } finally {
      await handle.close();
    }
    await fsp.rename(tmp, targetPath);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

async function decryptFileToBuffer(file, key) {
  const handle = await fsp.open(file, "r");
  let header;
  try {
    header = Buffer.alloc(HEADER_LEN);
    const { bytesRead } = await handle.read(header, 0, HEADER_LEN, 0);
    if (bytesRead < HEADER_LEN || !header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error("Invalid vault payload");
    }
  } finally {
    await handle.close();
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, header.subarray(IV_OFFSET, TAG_OFFSET));
  decipher.setAuthTag(header.subarray(TAG_OFFSET, HEADER_LEN));
  const chunks = [];
  await pipeline(
    fs.createReadStream(file, { start: HEADER_LEN }),
    decipher,
    new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    }),
  );
  return Buffer.concat(chunks);
}

// Re-encrypts one stored file under a new key. Streamed, so a large file never sits in memory whole.
async function reencryptFile(sourcePath, targetPath, oldKey, newKey) {
  const handle = await fsp.open(sourcePath, "r");
  let header;
  try {
    header = Buffer.alloc(HEADER_LEN);
    const { bytesRead } = await handle.read(header, 0, HEADER_LEN, 0);
    if (bytesRead < HEADER_LEN || !header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error("Invalid vault payload");
    }
  } finally {
    await handle.close();
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", oldKey, header.subarray(IV_OFFSET, TAG_OFFSET));
  decipher.setAuthTag(header.subarray(TAG_OFFSET, HEADER_LEN));
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", newKey, iv);
  const tmp = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  const out = fs.createWriteStream(tmp);
  try {
    out.write(Buffer.concat([MAGIC, crypto.randomBytes(SALT_LEN), iv, Buffer.alloc(TAG_LEN)]));
    await pipeline(fs.createReadStream(sourcePath, { start: HEADER_LEN }), decipher, cipher, out);
    const tag = cipher.getAuthTag();
    const target = await fsp.open(tmp, "r+");
    try {
      await target.write(tag, 0, TAG_LEN, TAG_OFFSET);
    } finally {
      await target.close();
    }
    await fsp.rename(tmp, targetPath);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

// Helpers for vault backups.
async function hashFile(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

const VAULT_FILE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.vault$/i;

/** Only the files a vault folder can contain are copied into or out of a backup. */
function isVaultFileName(name) {
  return name === "vault-config.json" || name === "index.vault" || VAULT_FILE_PATTERN.test(name);
}

class VaultManager {
  constructor(getStorageDir, onAutoLocked, options = {}) {
    this.getStorageDir = getStorageDir;
    this.onAutoLocked = onAutoLocked;
    // Cost for vaults created from now on. Tests pass a cheaper setting so the suite stays fast.
    this.newVaultKdf = options.kdf || KDF_CURRENT;
    this.activeKey = null; // Buffer (32 bytes) while unlocked
    this.inactivityTimeoutMs = 5 * 60 * 1000; // 5 minutes
    this.lockTimer = null;
    // Changes to the index run one after another, so parallel additions cannot overwrite each other.
    this.indexQueue = Promise.resolve();
    this.changing = false; // true while the password is being changed
    this.pendingOperations = 0; // vault operations in progress
  }

  _exclusive(task) {
    const run = this.indexQueue.then(task);
    this.indexQueue = run.catch(() => {});
    return run;
  }

  /** Runs one vault operation, unless a password change is replacing the vault folder. */
  _operation(task) {
    if (this.changing) {
      return Promise.reject(new Error("الخزنة تُعاد تشفيرها الآن، حاول بعد لحظات"));
    }
    this.pendingOperations += 1;
    return Promise.resolve()
      .then(task)
      .finally(() => {
        this.pendingOperations -= 1;
      });
  }

  /**
   * Finishes or undoes a password change that was interrupted (for example by a power cut).
   * The new vault is used only when it was completely written and the old one was moved aside;
   * otherwise the old vault stays in place.
   */
  _recoverInterruptedChange() {
    if (this.changing) return; // a change in this process is still running
    const root = this.getStorageDir();
    const vaultDir = path.join(root, "vault");
    const nextDir = path.join(root, NEXT_FOLDER);
    const previousDir = path.join(root, PREVIOUS_FOLDER);
    const hasVault = () => fs.existsSync(path.join(vaultDir, "vault-config.json"));

    if (!hasVault()) {
      if (fs.existsSync(path.join(nextDir, COMPLETE_MARKER))) {
        fs.rmSync(vaultDir, { recursive: true, force: true });
        fs.renameSync(nextDir, vaultDir);
      } else if (fs.existsSync(previousDir)) {
        fs.rmSync(vaultDir, { recursive: true, force: true });
        fs.renameSync(previousDir, vaultDir);
      }
    }
    if (hasVault()) {
      fs.rmSync(nextDir, { recursive: true, force: true }); // an unfinished new vault
      fs.rmSync(previousDir, { recursive: true, force: true }); // the old copy after a finished swap
    }
  }

  _getVaultDir() {
    const dir = path.join(this.getStorageDir(), "vault");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  _getConfigPath() {
    return path.join(this._getVaultDir(), "vault-config.json");
  }

  _getIndexFile() {
    return path.join(this._getVaultDir(), "index.vault");
  }

  _touchActivity() {
    if (this.lockTimer) clearTimeout(this.lockTimer);
    if (this.activeKey) {
      this.lockTimer = setTimeout(() => {
        this.lock();
        if (typeof this.onAutoLocked === "function") {
          this.onAutoLocked();
        }
      }, this.inactivityTimeoutMs);
    }
  }

  getStatus() {
    this._recoverInterruptedChange();
    const exists = fs.existsSync(path.join(this.getStorageDir(), "vault", "vault-config.json"));
    return {
      created: exists,
      unlocked: this.activeKey !== null,
    };
  }

  async _deriveKey(password, salt, kdf) {
    return new Promise((resolve, reject) => {
      crypto.scrypt(password, salt, KEY_LEN, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: SCRYPT_MAX_MEM }, (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      });
    });
  }

  _encryptBuffer(buffer, key) {
    const salt = crypto.randomBytes(SALT_LEN); // reserved slot, see encryptFileTo
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const tag = cipher.getAuthTag();

    return Buffer.concat([MAGIC, salt, iv, tag, encrypted]);
  }

  _decryptBuffer(payload, key) {
    if (payload.length < HEADER_LEN) {
      throw new Error("Invalid vault payload");
    }
    const magic = payload.subarray(0, MAGIC.length);
    if (!magic.equals(MAGIC)) {
      throw new Error("Invalid vault magic");
    }
    const iv = payload.subarray(IV_OFFSET, TAG_OFFSET);
    const tag = payload.subarray(TAG_OFFSET, HEADER_LEN);
    const ciphertext = payload.subarray(HEADER_LEN);

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  async createVault(password) {
    if (this.changing) throw new Error("الخزنة تُعاد تشفيرها الآن، حاول بعد لحظات");
    this._recoverInterruptedChange();
    if (!password || typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      throw new Error("كلمة المرور يجب أن لا تقل عن 12 حرفاً");
    }
    if (fs.existsSync(this._getConfigPath())) {
      throw new Error("الخزنة موجودة مسبقاً");
    }

    const salt = crypto.randomBytes(SALT_LEN);
    const kdf = this.newVaultKdf;
    const key = await this._deriveKey(password, salt, kdf);

    const config = {
      saltHex: salt.toString("hex"),
      createdAt: Date.now(),
      kdf,
    };
    writeFileAtomic(this._getConfigPath(), JSON.stringify(config));

    // Encrypted empty index, so unlock can verify the password right away.
    writeFileAtomic(this._getIndexFile(), this._encryptBuffer(Buffer.from(JSON.stringify([]), "utf8"), key));

    this.activeKey = key;
    this._touchActivity();
    return this.getStatus();
  }

  async unlock(password) {
    if (this.changing) throw new Error("الخزنة تُعاد تشفيرها الآن، حاول بعد لحظات");
    this._recoverInterruptedChange();
    if (!fs.existsSync(this._getConfigPath())) {
      throw new Error("الخزنة غير موجودة");
    }
    try {
      const config = JSON.parse(fs.readFileSync(this._getConfigPath(), "utf8"));
      const salt = Buffer.from(config.saltHex, "hex");
      const key = await this._deriveKey(password, salt, kdfFromConfig(config));

      // AES-GCM authentication fails for a wrong key, so decrypting the index verifies the password.
      const indexRaw = fs.readFileSync(this._getIndexFile());
      this._decryptBuffer(indexRaw, key);

      this.activeKey = key;
      this._touchActivity();
      return this.getStatus();
    } catch {
      throw new Error("كلمة المرور غير صحيحة أو البيانات تالفة");
    }
  }

  lock() {
    if (this.lockTimer) {
      clearTimeout(this.lockTimer);
      this.lockTimer = null;
    }
    if (this.activeKey) {
      this.activeKey.fill(0); // Zero the key buffer in memory
      this.activeKey = null;
    }
    return this.getStatus();
  }

  _readIndex() {
    if (!this.activeKey) throw new Error("الخزنة مقفلة");
    const raw = fs.readFileSync(this._getIndexFile());
    const dec = this._decryptBuffer(raw, this.activeKey);
    return JSON.parse(dec.toString("utf8"));
  }

  _writeIndex(indexData) {
    if (!this.activeKey) throw new Error("الخزنة مقفلة");
    const enc = this._encryptBuffer(Buffer.from(JSON.stringify(indexData), "utf8"), this.activeKey);
    writeFileAtomic(this._getIndexFile(), enc);
  }

  listFiles() {
    return this._operation(async () => {
      if (!this.activeKey) throw new Error("الخزنة مقفلة");
      this._touchActivity();
      const index = this._readIndex();
      return index.map((item) => ({
        id: item.id,
        name: item.name,
        size: item.size,
        addedAt: item.addedAt,
      }));
    });
  }

  addFile(sourcePath) {
    return this._operation(async () => {
      if (!this.activeKey) throw new Error("الخزنة مقفلة");
      this._touchActivity();
      const stat = await fsp.stat(sourcePath).catch(() => null);
      if (!stat || !stat.isFile()) throw new Error("الملف غير موجود");
      if (stat.size > MAX_VAULT_FILE_BYTES) {
        throw new Error("حجم الملف يتجاوز الحد المسموح به للخزنة (2 جيجابايت)");
      }

      // A copy of the key, so locking the vault while this runs cannot zero the key mid-encryption.
      const key = Buffer.from(this.activeKey);
      const id = crypto.randomUUID();
      const name = path.basename(sourcePath);
      const targetFile = path.join(this._getVaultDir(), `${id}.vault`);
      try {
        await encryptFileTo(sourcePath, targetFile, key);
        return await this._exclusive(async () => {
          try {
            const index = this._readIndex();
            index.push({ id, name, size: stat.size, addedAt: Date.now() });
            this._writeIndex(index);
            return { id, name, size: stat.size };
          } catch (err) {
            // Do not leave an encrypted blob that the index does not know about.
            await fsp.rm(targetFile, { force: true }).catch(() => {});
            throw err;
          }
        });
      } catch (err) {
        await fsp.rm(targetFile, { force: true }).catch(() => {});
        throw err;
      } finally {
        key.fill(0);
      }
    });
  }

  readFile(fileId) {
    return this._operation(async () => {
      if (!this.activeKey) throw new Error("الخزنة مقفلة");
      this._touchActivity();
      const index = this._readIndex();
      const item = index.find((x) => x.id === fileId);
      if (!item) throw new Error("الملف غير موجود في الخزنة");

      const vaultFile = path.join(this._getVaultDir(), `${fileId}.vault`);
      if (!fs.existsSync(vaultFile)) throw new Error("ملف الخزنة مفقود على القرص");

      const key = Buffer.from(this.activeKey);
      try {
        const plain = await decryptFileToBuffer(vaultFile, key);
        return {
          name: item.name,
          size: plain.length,
          data: plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength),
        };
      } finally {
        key.fill(0);
      }
    });
  }

  removeFile(fileId) {
    return this._operation(async () => {
      if (!this.activeKey) throw new Error("الخزنة مقفلة");
      this._touchActivity();
      return this._exclusive(async () => {
        const index = this._readIndex();
        this._writeIndex(index.filter((x) => x.id !== fileId));
        fs.rmSync(path.join(this._getVaultDir(), `${fileId}.vault`), { force: true });
        return true;
      });
    });
  }

  /**
   * Changes the password. The current password must be typed again, so an unlocked window alone cannot
   * change it. Every file is re-encrypted into a new vault folder first; the switch is three renames,
   * so an interruption at any step leaves a vault that opens with one of the two passwords.
   */
  /**
   * Copies the encrypted vault into a new folder, with a SHA-256 manifest. The copy stays encrypted,
   * so it can only be opened with the vault password.
   */
  async exportBackup(destDir) {
    if (!destDir || typeof destDir !== "string") throw new Error("مسار النسخة الاحتياطية غير صالح");
    this._recoverInterruptedChange();
    if (this.changing) throw new Error("الخزنة تُعاد تشفيرها الآن، حاول بعد لحظات");
    const vaultDir = path.join(this.getStorageDir(), "vault");
    if (!fs.existsSync(path.join(vaultDir, "vault-config.json"))) throw new Error("الخزنة غير موجودة");

    this.changing = true; // keep the copy consistent: nothing else may change the vault meanwhile
    try {
      while (this.pendingOperations > 0) await new Promise((resolve) => setTimeout(resolve, 25));
      const out = path.resolve(destDir);
      await fsp.mkdir(out, { recursive: true });
      const names = (await fsp.readdir(vaultDir)).filter(isVaultFileName);
      const manifest = { format: "alif-vault-backup", version: 1, exportedAt: Date.now(), files: [] };
      for (const name of names) {
        const target = path.join(out, name);
        await fsp.copyFile(path.join(vaultDir, name), target);
        const { size } = await fsp.stat(target);
        manifest.files.push({ name, size, sha256: await hashFile(target) });
      }
      if (!names.includes("vault-config.json") || !names.includes("index.vault")) throw new Error("الخزنة ناقصة");
      writeFileAtomic(path.join(out, "MANIFEST.json"), JSON.stringify(manifest, null, 2));
      return { path: out, fileCount: manifest.files.length, exportedAt: manifest.exportedAt };
    } finally {
      this.changing = false;
    }
  }

  /**
   * Restores a backup made by exportBackup. The backup password is required, and an existing vault is
   * replaced only when `overwrite` is true. The restore goes through the same crash-safe folder swap as
   * a password change, so an interruption never loses either vault.
   */
  async importBackup(srcDir, password, { overwrite = false } = {}) {
    if (!srcDir || typeof srcDir !== "string") throw new Error("مسار النسخة الاحتياطية غير صالح");
    if (!password || typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      throw new Error("كلمة المرور يجب أن لا تقل عن 12 حرفاً");
    }
    if (this.changing) throw new Error("الخزنة تُعاد تشفيرها الآن، حاول بعد لحظات");
    this._recoverInterruptedChange();

    const src = path.resolve(srcDir);
    const configSrc = path.join(src, "vault-config.json");
    const indexSrc = path.join(src, "index.vault");
    if (!fs.existsSync(configSrc) || !fs.existsSync(indexSrc)) {
      throw new Error("مجلد النسخة الاحتياطية غير صالح (ناقص vault-config أو index)");
    }

    // The manifest is required: every file in the backup must match its recorded SHA-256 before anything is restored.
    const manifestPath = path.join(src, "MANIFEST.json");
    if (!fs.existsSync(manifestPath)) throw new Error("النسخة لا تحتوي على ملف التحقق MANIFEST.json");
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      throw new Error("ملف MANIFEST تالف");
    }
    if (manifest.format !== "alif-vault-backup" || !Array.isArray(manifest.files)) {
      throw new Error("ملف MANIFEST غير معروف");
    }
    const listed = new Set(manifest.files.map((entry) => entry.name));
    if (!listed.has("vault-config.json") || !listed.has("index.vault")) {
      throw new Error("النسخة ناقصة: vault-config أو index");
    }
    for (const entry of manifest.files) {
      if (!isVaultFileName(entry.name)) throw new Error(`ملف غير متوقع في النسخة: ${entry.name}`);
      const file = path.join(src, entry.name);
      if (!fs.existsSync(file)) throw new Error(`ملف مفقود في النسخة: ${entry.name}`);
      if (typeof entry.sha256 !== "string" || (await hashFile(file)) !== entry.sha256) {
        throw new Error(`تكامل النسخة فشل: ${entry.name}`);
      }
    }

    const config = JSON.parse(fs.readFileSync(configSrc, "utf8"));
    const key = await this._deriveKey(password, Buffer.from(config.saltHex, "hex"), kdfFromConfig(config));
    try {
      this._decryptBuffer(fs.readFileSync(indexSrc), key); // the password check
    } catch {
      key.fill(0);
      throw new Error("كلمة المرور غير صحيحة أو النسخة تالفة");
    }

    const root = this.getStorageDir();
    const vaultDir = path.join(root, "vault");
    const nextDir = path.join(root, NEXT_FOLDER);
    const previousDir = path.join(root, PREVIOUS_FOLDER);
    const hasVault = fs.existsSync(path.join(vaultDir, "vault-config.json"));
    if (hasVault && !overwrite) {
      key.fill(0);
      throw new Error("الخزنة موجودة مسبقاً. اختر استبدالاً صريحاً لاستيراد النسخة.");
    }

    this.lock();
    this.changing = true;
    try {
      while (this.pendingOperations > 0) await new Promise((resolve) => setTimeout(resolve, 25));
      fs.rmSync(nextDir, { recursive: true, force: true });
      fs.mkdirSync(nextDir, { recursive: true });
      for (const entry of manifest.files) {
        await fsp.copyFile(path.join(src, entry.name), path.join(nextDir, entry.name));
      }
      fs.writeFileSync(path.join(nextDir, COMPLETE_MARKER), "1");

      // Commit: the current vault moves aside, the restored one takes its place, then the old copy goes.
      if (hasVault) fs.renameSync(vaultDir, previousDir);
      fs.renameSync(nextDir, vaultDir);
      fs.rmSync(previousDir, { recursive: true, force: true });

      this.activeKey = key; // unlocked with the backup's password
      this._touchActivity();
      return this.getStatus();
    } catch (err) {
      if (!fs.existsSync(path.join(vaultDir, "vault-config.json")) && fs.existsSync(previousDir)) {
        fs.rmSync(vaultDir, { recursive: true, force: true });
        fs.renameSync(previousDir, vaultDir);
      }
      fs.rmSync(nextDir, { recursive: true, force: true });
      key.fill(0);
      throw err;
    } finally {
      this.changing = false;
    }
  }

  async changePassword(currentPassword, newPassword) {
    if (!this.activeKey) throw new Error("الخزنة مقفلة");
    if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new Error("كلمة المرور الجديدة يجب أن لا تقل عن 12 حرفاً");
    }
    if (this.changing) throw new Error("تغيير كلمة المرور قيد التنفيذ");
    this._recoverInterruptedChange();

    const root = this.getStorageDir();
    const vaultDir = path.join(root, "vault");
    const nextDir = path.join(root, NEXT_FOLDER);
    const previousDir = path.join(root, PREVIOUS_FOLDER);
    const config = JSON.parse(fs.readFileSync(path.join(vaultDir, "vault-config.json"), "utf8"));

    const check = await this._deriveKey(currentPassword, Buffer.from(config.saltHex, "hex"), kdfFromConfig(config));
    const matches =
      this.activeKey !== null && check.length === this.activeKey.length && crypto.timingSafeEqual(check, this.activeKey);
    check.fill(0);
    if (!matches) throw new Error("كلمة المرور الحالية غير صحيحة");

    this.changing = true;
    const oldKey = Buffer.from(this.activeKey); // a private copy: locking during the change must not zero it
    let newKey = null;
    try {
      while (this.pendingOperations > 0) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await this._exclusive(async () => {
        fs.rmSync(nextDir, { recursive: true, force: true });
        fs.mkdirSync(nextDir, { recursive: true });
        const salt = crypto.randomBytes(SALT_LEN);
        newKey = await this._deriveKey(newPassword, salt, this.newVaultKdf);

        const index = JSON.parse(
          this._decryptBuffer(fs.readFileSync(path.join(vaultDir, "index.vault")), oldKey).toString("utf8"),
        );
        for (const item of index) {
          await reencryptFile(
            path.join(vaultDir, `${item.id}.vault`),
            path.join(nextDir, `${item.id}.vault`),
            oldKey,
            newKey,
          );
        }
        writeFileAtomic(
          path.join(nextDir, "index.vault"),
          this._encryptBuffer(Buffer.from(JSON.stringify(index), "utf8"), newKey),
        );
        writeFileAtomic(
          path.join(nextDir, "vault-config.json"),
          JSON.stringify({ saltHex: salt.toString("hex"), createdAt: config.createdAt ?? Date.now(), kdf: this.newVaultKdf }),
        );
        fs.writeFileSync(path.join(nextDir, COMPLETE_MARKER), "1");

        // Commit: the old vault moves aside, the new one takes its place, then the old copy is removed.
        fs.renameSync(vaultDir, previousDir);
        fs.renameSync(nextDir, vaultDir);
        fs.rmSync(previousDir, { recursive: true, force: true });
      });

      // Stay unlocked with the new key, unless the vault was locked while the change ran.
      if (this.activeKey) {
        this.activeKey.fill(0);
        this.activeKey = newKey;
      } else {
        newKey.fill(0);
      }
      newKey = null;
    } catch (err) {
      // Undo a half-finished switch right away, so the old vault keeps working.
      if (!fs.existsSync(path.join(vaultDir, "vault-config.json")) && fs.existsSync(previousDir)) {
        fs.rmSync(vaultDir, { recursive: true, force: true });
        fs.renameSync(previousDir, vaultDir);
      }
      fs.rmSync(nextDir, { recursive: true, force: true });
      throw err;
    } finally {
      if (newKey) newKey.fill(0);
      oldKey.fill(0);
      this.changing = false;
    }
    this._touchActivity();
    return this.getStatus();
  }
}

module.exports = { VaultManager, MAGIC, KDF_CURRENT, KDF_LEGACY };
