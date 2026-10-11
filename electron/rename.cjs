"use strict";
/* Rules for renaming a PDF on disk. Pure functions, so they can be unit-tested without Electron. */

const path = require("path");

const MAX_NAME_LENGTH = 200; // without the ".pdf" extension
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Checks a name typed by the user. The ".pdf" extension is optional in what they type and is always kept on the file.
 * Returns { ok: true, fileName } or { ok: false, error } with a message to show them.
 */
function validateFileName(raw) {
  if (typeof raw !== "string") return { ok: false, error: "الاسم غير صالح" };
  let stem = raw.trim().replace(/\.pdf$/i, "").trim();
  if (!stem) return { ok: false, error: "اكتب اسماً للملف" };
  if (INVALID_CHARS.test(stem)) {
    return { ok: false, error: "الاسم يحتوي على محارف غير مسموحة في ويندوز: < > : \" / \\ | ? *" };
  }
  if (/[. ]$/.test(stem)) return { ok: false, error: "لا يجوز أن ينتهي الاسم بنقطة أو مسافة" };
  if (RESERVED.test(stem.split(".")[0])) return { ok: false, error: "هذا الاسم محجوز في ويندوز، اختر اسماً آخر" };
  if (stem.length > MAX_NAME_LENGTH) return { ok: false, error: `الاسم طويل جداً (الحد ${MAX_NAME_LENGTH} حرفاً)` };
  return { ok: true, fileName: `${stem}.pdf` };
}

/**
 * Where the file would end up. The file always stays in its own folder.
 * `unchanged` is true when the name is identical; `caseOnly` when only the letter case differs.
 */
function planRename(oldPath, raw) {
  const checked = validateFileName(raw);
  if (!checked.ok) return checked;
  const dir = path.dirname(oldPath);
  const oldName = path.basename(oldPath);
  const newPath = path.join(dir, checked.fileName);
  return {
    ok: true,
    newPath,
    fileName: checked.fileName,
    unchanged: oldName === checked.fileName,
    caseOnly: oldName !== checked.fileName && oldName.toLowerCase() === checked.fileName.toLowerCase(),
  };
}

module.exports = { validateFileName, planRename, MAX_NAME_LENGTH };
