/* Streaming PDF addresses (alif-file://). Kept apart from main.cjs so the byte-range rules can be unit-tested.
   pdf.js asks for byte ranges. A range that runs past the end of a file is shortened to the end, as HTTP requires;
   it is refused only when it starts at or after the end, or when it is malformed. */

const path = require("path");

const ALIF_FILE_SCHEME = "alif-file";

function toAlifFileUrl(filePath) {
  return `${ALIF_FILE_SCHEME}://local/${Buffer.from(path.resolve(filePath), "utf8").toString("base64url")}`;
}

function fromAlifFileUrl(requestUrl) {
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== `${ALIF_FILE_SCHEME}:`) return null;
    const payload = url.pathname.replace(/^\//, "");
    return payload ? Buffer.from(payload, "base64url").toString("utf8") : null;
  } catch {
    return null;
  }
}

/**
 * Reads a "Range: bytes=..." header for a file of `total` bytes. Returns the inclusive start and end, or null when
 * the range cannot be served (the caller then answers 416). Supports "start-end", "start-" and the suffix form "-count".
 */
function parseByteRange(header, total) {
  if (!Number.isFinite(total) || total <= 0) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || "").trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start;
  let end;
  if (m[1] === "") {
    const count = parseInt(m[2], 10);
    if (!(count > 0)) return null;
    start = Math.max(0, total - count);
    end = total - 1;
  } else {
    start = parseInt(m[1], 10);
    end = m[2] === "" ? total - 1 : Math.min(parseInt(m[2], 10), total - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= total || start > end) return null;
  return { start, end };
}

module.exports = { ALIF_FILE_SCHEME, toAlifFileUrl, fromAlifFileUrl, parseByteRange };
