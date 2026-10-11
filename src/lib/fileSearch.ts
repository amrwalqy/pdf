import type { Doc } from "../data";
import { normalizeArabic } from "./arabicSearch";

// One collator for every search, instead of a locale comparison per pair of results.
const collator = new Intl.Collator("ar");

// Normalised names are computed once per document, not once per keystroke.
const nameCache = new WeakMap<Doc, string>();

function searchableName(doc: Doc): string {
  let name = nameCache.get(doc);
  if (name === undefined) {
    name = normalizeArabic(doc.file.replace(/\.pdf$/i, "")).replace(/\s+/g, " ").trim();
    nameCache.set(doc, name);
  }
  return name;
}

/** Search filenames only, regardless of shelf, Arabic diacritics, or letter case. */
export function searchPdfNames(docs: Doc[], query: string): Doc[] {
  const needle = normalizeArabic(query.replace(/\.pdf\s*$/i, "")).replace(/\s+/g, " ").trim();
  if (!needle) return [];

  const ranked: Array<{ doc: Doc; rank: number }> = [];
  for (const doc of docs) {
    const name = searchableName(doc);
    if (!name.includes(needle)) continue;
    const rank =
      name === needle ? 0 : name.startsWith(needle) ? 1 : name.split(" ").some((part) => part.startsWith(needle)) ? 2 : 3;
    ranked.push({ doc, rank });
  }
  ranked.sort((a, b) => a.rank - b.rank || collator.compare(a.doc.file, b.doc.file));
  return ranked.map((entry) => entry.doc);
}
