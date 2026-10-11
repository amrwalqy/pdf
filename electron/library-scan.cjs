/* Library folder scanning (Electron main process).
   Walks a library folder with bounded parallelism, so a large library is indexed in well under a second
   on an SSD without blocking the application. Plain Node.js with no Electron dependency, so it is
   unit-tested directly. */

const path = require("path");
const fsp = require("fs").promises;

const MAX_SCAN_DEPTH = 8;
const MAX_SCAN_FILES = 5000;
const MAX_SCAN_DIRS = 3000;
const DEFAULT_CONCURRENCY = 32;

const PDF_PATTERN = /\.pdf$/i;

function isSkippedFolder(name) {
  return name.startsWith(".") || name === "$RECYCLE.BIN" || name === "System Volume Information";
}

/** Returns a function that runs at most `max` tasks at the same time. */
function createLimiter(max) {
  let active = 0;
  const waiting = [];
  const next = () => {
    if (active >= max || waiting.length === 0) return;
    active += 1;
    const { task, resolve, reject } = waiting.shift();
    task()
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };
  return (task) =>
    new Promise((resolve, reject) => {
      waiting.push({ task, resolve, reject });
      next();
    });
}

/**
 * Lists every PDF under `root` and the folders that contain them.
 * Returns { files, dirs, truncated }. `truncated` is true when a limit stopped the scan early.
 */
async function scanLibraryTree(root, options = {}) {
  const fs = options.fs || fsp;
  const maxDepth = options.maxDepth ?? MAX_SCAN_DEPTH;
  const maxFiles = options.maxFiles ?? MAX_SCAN_FILES;
  const maxDirs = options.maxDirs ?? MAX_SCAN_DIRS;
  const limit = createLimiter(options.concurrency ?? DEFAULT_CONCURRENCY);

  const files = [];
  const dirs = [];
  let truncated = false;

  const visit = async (dir, depth) => {
    if (files.length >= maxFiles || dirs.length >= maxDirs) {
      truncated = true;
      return;
    }

    let entries;
    try {
      entries = await limit(() => fs.readdir(dir, { withFileTypes: true }));
    } catch {
      return; // unreadable folder: skip it
    }

    const subfolders = [];
    const pdfNames = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (isSkippedFolder(entry.name)) continue;
        if (depth + 1 > maxDepth) {
          truncated = true;
          continue;
        }
        subfolders.push(path.join(dir, entry.name));
      } else if (PDF_PATTERN.test(entry.name)) {
        pdfNames.push(entry.name);
      }
    }

    const accepted = [];
    for (const folder of subfolders) {
      if (dirs.length >= maxDirs) {
        truncated = true;
        break;
      }
      dirs.push(folder);
      accepted.push(folder);
    }

    const room = Math.max(0, maxFiles - files.length);
    if (pdfNames.length > room) {
      truncated = true;
      pdfNames.length = room;
    }

    const stats = await Promise.all(
      pdfNames.map((name) =>
        limit(async () => {
          const full = path.join(dir, name);
          try {
            const st = await fs.stat(full);
            return { name, path: full, size: st.size, lastModified: Math.floor(st.mtimeMs) };
          } catch {
            return null; // the file vanished or cannot be read
          }
        }),
      ),
    );
    // Folders are scanned in parallel, so the room check above can pass for several folders at once.
    // Any file that does not fit is dropped here, and that must still mark the scan as truncated.
    for (const item of stats) {
      if (!item) continue;
      if (files.length < maxFiles) files.push(item);
      else truncated = true;
    }

    await Promise.all(accepted.map((folder) => visit(folder, depth + 1)));
  };

  await visit(root, 0);
  files.sort((a, b) => b.lastModified - a.lastModified);
  return { files, dirs, truncated };
}

module.exports = {
  scanLibraryTree,
  createLimiter,
  isSkippedFolder,
  MAX_SCAN_DEPTH,
  MAX_SCAN_FILES,
  MAX_SCAN_DIRS,
};
