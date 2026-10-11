/* Update feed rules (pure functions, unit-tested).
   A placeholder address never counts as configured, so an unconfigured build makes no network request at all. */

const fs = require("fs");
const path = require("path");

const PLACEHOLDER_SUFFIXES = [".local", ".example", ".invalid", ".test"];
const PLACEHOLDER_HOSTS = ["example.com", "example.org", "example.net"];

function isPlaceholderHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  // Subdomains of a reserved domain are placeholders too (updates.example.com).
  const reserved = PLACEHOLDER_HOSTS.some((name) => host === name || host.endsWith(`.${name}`));
  return reserved || PLACEHOLDER_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function resolveFeedUrl(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  const off = (reason) => ({ url: null, configured: false, reason });
  if (!raw) return off("لم يُضبط عنوان التحديثات في هذا البناء");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return off("عنوان التحديثات غير صالح");
  }
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
    return off("يجب أن يبدأ عنوان التحديثات بـ https");
  }
  if (isPlaceholderHost(parsed.hostname)) return off("عنوان التحديثات ما زال عنواناً تجريبياً");
  return { url: parsed.toString().replace(/\/$/, ""), configured: true, reason: null };
}

/** Reads the feed written into a packaged build (app-update.yml). Returns null when there is none. */
function readAppUpdateUrl(resourcesDir) {
  try {
    const file = path.join(resourcesDir || "", "app-update.yml");
    if (!resourcesDir || !fs.existsSync(file)) return null;
    const match = /^\s*url:\s*(\S+)/m.exec(fs.readFileSync(file, "utf8"));
    return match ? match[1].replace(/^["']|["']$/g, "") : null;
  } catch {
    return null;
  }
}

module.exports = { resolveFeedUrl, readAppUpdateUrl, isPlaceholderHost };
