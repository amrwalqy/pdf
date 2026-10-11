/**
 * Arabic text normalization for precise document search:
 * - Strips all Arabic diacritics / Tashkeel (U+064B..U+065F, U+0670)
 * - Strips Tatweel / Kashida (U+0640)
 * - Normalizes Alef variants (أ, إ, آ, ٱ -> ا)
 * - Normalizes Yaa (ى -> ي)
 * - Normalizes Taa Marbuta (ة -> ه)
 * - Converts Eastern Arabic / Indic numerals (٠-٩) to Latin (0-9)
 */

const TASHKEEL_REGEX = /[\u064B-\u065F\u0670]/g;
const TATWEEL_REGEX = /\u0640/g;
const INDIC_NUMERALS: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

export function normalizeArabic(text: string): string {
  if (!text) return "";

  return text
    .replace(TASHKEEL_REGEX, "")
    .replace(TATWEEL_REGEX, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (digit) => INDIC_NUMERALS[digit] ?? digit)
    .trim()
    .toLowerCase();
}

/** Check if normalized needle is contained in normalized haystack */
export function arabicIncludes(haystack: string, needle: string): boolean {
  if (!needle.trim()) return true;
  return normalizeArabic(haystack).includes(normalizeArabic(needle));
}
