/* Library index (Electron main process).
   Keeps an in-memory index of every PDF in the library folder, at any depth, and keeps it current
   from file-system events. Changes are reported as small deltas, so the interface never rescans the
   whole library after a change. Plain Node.js with no Electron dependency, so it is unit-tested directly. */

const fsModule = require("fs");
const fsp = require("fs").promises;
const path = require("path");
const { createLimiter, isSkippedFolder } = require("./library-scan.cjs");

const PDF_PATTERN = /\.pdf$/i;
// Safety limits only. They are far above any real library and exist so a broken folder cannot exhaust memory.
const SAFETY_LIMIT_FILES = 200000;
const SAFETY_LIMIT_DIRS = 100000;
const CONCURRENCY = 48;
const FLUSH_DELAY_MS = 150;
const SAFETY_VERIFY_MS = 5 * 60 * 1000;
const MISSING = Symbol("missing");
const ALL_NAMES = { has: () => true };

function emptyDelta() {
  return { addedFiles: [], updatedFiles: [], removedFiles: [], addedDirs: [], removedDirs: [] };
}

function hasChanges(delta) {
  return (
    delta.addedFiles.length > 0 ||
    delta.updatedFiles.length > 0 ||
    delta.removedFiles.length > 0 ||
    delta.addedDirs.length > 0 ||
    delta.removedDirs.length > 0
  );
}

class LibraryIndex {
  constructor(root, options = {}) {
    this.root = path.resolve(root);
    this.fs = options.fs || fsp;
    this.fsSync = options.fsSync || fsModule;
    this.onDelta = options.onDelta || (() => {});
    this.onError = options.onError || (() => {});
    this.limit = createLimiter(options.concurrency ?? CONCURRENCY);
    this.maxFiles = options.maxFiles ?? SAFETY_LIMIT_FILES;
    this.maxDirs = options.maxDirs ?? SAFETY_LIMIT_DIRS;

    this.files = new Map(); // absolute path -> { name, path, size, lastModified }
    this.dirs = new Set(); // absolute folder paths below the root (the root itself is not listed)
    this.children = new Map(); // absolute folder path -> Map(name -> 'file' | 'dir')
    this.truncated = false;

    this.watcher = null;
    this.pending = new Map(); // folder -> names reported as changed
    this.flushTimer = null;
    this.verifyTimer = null;
    this.closed = false;
    this.queue = Promise.resolve(); // one refresh at a time, so every delta is computed on current data
  }

  /** Scans the whole library once. Returns the snapshot. */
  async build() {
    this.files.clear();
    this.dirs.clear();
    this.children.clear();
    this.truncated = false;
    await this._scanSubtree(this.root, emptyDelta());
    return this.snapshot();
  }

  snapshot() {
    return { files: Array.from(this.files.values()), dirs: Array.from(this.dirs), truncated: this.truncated };
  }

  /** Starts watching the folder. Events are batched and turned into deltas. */
  startWatching() {
    if (this.watcher || this.closed) return;
    try {
      this.watcher = this.fsSync.watch(this.root, { recursive: true }, (_eventType, filename) => {
        if (!filename) {
          this._scheduleVerify();
          return;
        }
        const full = path.join(this.root, String(filename));
        this.notify(path.dirname(full), path.basename(full));
      });
      this.watcher.on("error", (error) => {
        this.onError(error);
        this.stopWatching();
        this._scheduleVerify();
      });
    } catch (error) {
      // Watching is not available here (for example, too many watches): the periodic check still keeps the index current.
      this.onError(error);
    }
    this.verifyTimer = setInterval(() => void this.verify(), SAFETY_VERIFY_MS);
    if (this.verifyTimer.unref) this.verifyTimer.unref();
  }

  stopWatching() {
    try {
      if (this.watcher) this.watcher.close();
    } catch {
      /* already closed */
    }
    this.watcher = null;
  }

  close() {
    this.closed = true;
    clearTimeout(this.flushTimer);
    clearInterval(this.verifyTimer);
    this.stopWatching();
    this.pending.clear();
  }

  /** Records that `name` inside `parentDir` may have changed. Changes are applied after a short pause. */
  notify(parentDir, name) {
    if (this.closed) return;
    let names = this.pending.get(parentDir);
    if (!names) {
      names = new Set();
      this.pending.set(parentDir, names);
    }
    if (name) names.add(name);
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), FLUSH_DELAY_MS);
  }

  /** Applies the recorded changes now and reports them as one delta. */
  flush() {
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const batch = this.pending;
    this.pending = new Map();
    if (batch.size === 0) return Promise.resolve();
    return this._serial(async () => {
      const delta = emptyDelta();
      const folders = [...batch.keys()].sort((a, b) => a.length - b.length); // parents before children
      for (const folder of folders) {
        if (!this.children.has(folder)) continue; // unknown folder: its parent decides whether it exists
        await this._refreshDirectory(folder, batch.get(folder), delta);
      }
      if (hasChanges(delta)) this.onDelta(delta);
    });
  }

  /**
   * Re-reads every known folder and reports what changed. With `restat`, every PDF is also checked for a
   * new size or modification time (used by the manual sync; the periodic check only looks at names).
   */
  verify(options = {}) {
    if (this.closed) return Promise.resolve();
    const restat = options.restat === true;
    return this._serial(async () => {
      const delta = emptyDelta();
      for (const folder of [this.root, ...this.dirs]) {
        if (!this.children.has(folder)) continue;
        await this._refreshDirectory(folder, restat ? ALL_NAMES : new Set(), delta);
      }
      if (hasChanges(delta)) this.onDelta(delta);
    });
  }

  _scheduleVerify() {
    if (this.closed) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.verify({ restat: true }), FLUSH_DELAY_MS);
  }

  _serial(task) {
    const run = this.queue.then(task);
    this.queue = run.catch((error) => this.onError(error));
    return run;
  }

  async _readDir(dirAbs) {
    try {
      return await this.limit(() => this.fs.readdir(dirAbs, { withFileTypes: true }));
    } catch (error) {
      return error && (error.code === "ENOENT" || error.code === "ENOTDIR") ? MISSING : null;
    }
  }

  async _stat(full) {
    try {
      return await this.limit(() => this.fs.stat(full));
    } catch {
      return null;
    }
  }

  async _addFile(dirAbs, name, delta) {
    const full = path.join(dirAbs, name);
    const stat = await this._stat(full);
    if (!stat) return;
    // Checked after the await: parallel additions must not all pass the check before any of them is recorded.
    if (!this.files.has(full) && this.files.size >= this.maxFiles) {
      this.truncated = true;
      return;
    }
    const entry = { name, path: full, size: stat.size, lastModified: Math.floor(stat.mtimeMs) };
    const previous = this.files.get(full);
    if (previous) {
      if (previous.size === entry.size && previous.lastModified === entry.lastModified) return; // unchanged: no delta
      this.files.set(full, entry);
      delta.updatedFiles.push(entry);
    } else {
      this.files.set(full, entry);
      delta.addedFiles.push(entry);
    }
  }

  _removeFile(full, delta) {
    if (this.files.delete(full)) delta.removedFiles.push(full);
  }

  _removeTree(dirAbs, delta) {
    const kids = this.children.get(dirAbs);
    if (kids) {
      for (const [name, kind] of kids) {
        const full = path.join(dirAbs, name);
        if (kind === "file") this._removeFile(full, delta);
        else this._removeTree(full, delta);
      }
    }
    this.children.delete(dirAbs);
    if (this.dirs.delete(dirAbs)) delta.removedDirs.push(dirAbs);
  }

  /** Lists a folder that is not indexed yet, and everything below it. */
  async _scanSubtree(dirAbs, delta) {
    if (this.closed) return;
    const entries = await this._readDir(dirAbs);
    if (!entries || entries === MISSING) return;

    const children = new Map();
    const pdfNames = [];
    const subfolders = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (isSkippedFolder(entry.name)) continue;
        children.set(entry.name, "dir");
        subfolders.push(path.join(dirAbs, entry.name));
      } else if (PDF_PATTERN.test(entry.name)) {
        children.set(entry.name, "file");
        pdfNames.push(entry.name);
      }
    }
    this.children.set(dirAbs, children);
    await Promise.all(pdfNames.map((name) => this._addFile(dirAbs, name, delta)));

    const accepted = [];
    for (const folder of subfolders) {
      if (this.dirs.size >= this.maxDirs) {
        this.truncated = true;
        break;
      }
      this.dirs.add(folder);
      delta.addedDirs.push(folder);
      accepted.push(folder);
    }
    await Promise.all(accepted.map((folder) => this._scanSubtree(folder, delta)));
  }

  /** Brings one known folder up to date with the file system, touching only what changed. */
  async _refreshDirectory(dirAbs, changedNames, delta) {
    if (this.closed) return;
    const previous = this.children.get(dirAbs) || new Map();
    const entries = await this._readDir(dirAbs);
    if (entries === MISSING) {
      this._removeTree(dirAbs, delta);
      return;
    }
    if (!entries) return; // unreadable right now: keep what the index knows

    const current = new Map();
    const pdfNames = [];
    const subfolders = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (isSkippedFolder(entry.name)) continue;
        current.set(entry.name, "dir");
        subfolders.push(path.join(dirAbs, entry.name));
      } else if (PDF_PATTERN.test(entry.name)) {
        current.set(entry.name, "file");
        pdfNames.push(entry.name);
      }
    }

    // Names that disappeared, or changed from file to folder (or back).
    for (const [name, kind] of previous) {
      if (current.get(name) === kind) continue;
      const full = path.join(dirAbs, name);
      if (kind === "file") this._removeFile(full, delta);
      else this._removeTree(full, delta);
    }

    this.children.set(dirAbs, current);

    const newFolders = [];
    for (const folder of subfolders) {
      if (previous.get(path.basename(folder)) === "dir") continue;
      if (this.dirs.size >= this.maxDirs) {
        this.truncated = true;
        break;
      }
      this.dirs.add(folder);
      delta.addedDirs.push(folder);
      newFolders.push(folder);
    }

    const toStat = pdfNames.filter((name) => previous.get(name) !== "file" || changedNames.has(name));
    await Promise.all(toStat.map((name) => this._addFile(dirAbs, name, delta)));
    await Promise.all(newFolders.map((folder) => this._scanSubtree(folder, delta)));
  }
}

module.exports = { LibraryIndex, emptyDelta, hasChanges, SAFETY_LIMIT_FILES, SAFETY_LIMIT_DIRS };
