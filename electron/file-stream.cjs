/* Helpers for the alif-file:// protocol, which streams local PDFs to the reader (Electron main process).
   Plain functions, so they are unit-tested without Electron. */

const path = require("path");

const SCHEME = "alif-file:";

/** Encodes an absolute path as an alif-file:// URL (the path travels base64url-encoded in the URL). */
function toAlifFileUrl(filePath) {
  const resolved = path.resolve(filePath);
  return `alif-file://local/${Buffer.from(resolved, "utf8").toString("base64url")}`;
}

/** Decodes the path from an alif-file:// URL, or returns null for anything else. */
function fromAlifFileUrl(requestUrl) {
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== SCHEME) return null;
    const token = url.pathname.replace(/^\//, "");
    if (!token) return null;
    return Buffer.from(token, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Parses one byte range such as "bytes=0-99", "bytes=900-" or "bytes=-100" (last 100 bytes).
 * Returns { start, end } (both inclusive), or null when the range is invalid or cannot be satisfied.
 */
function parseByteRange(header, total) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || "").trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  let start;
  let end;
  if (match[1] === "") {
    const suffix = parseInt(match[2], 10);
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = parseInt(match[1], 10);
    end = match[2] === "" ? total - 1 : Math.min(parseInt(match[2], 10), total - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || total <= 0 || start > end || start >= total) return null;
  return { start, end };
}

module.exports = { toAlifFileUrl, fromAlifFileUrl, parseByteRange };
