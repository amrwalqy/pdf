import { describe, it, expect } from "vitest";
import { normalizeArabic, arabicIncludes } from "../src/lib/arabicSearch";

describe("normalizeArabic", () => {
  it("removes Tashkeel and Tatweel", () => {
    expect(normalizeArabic("كِتَابٌ")).toBe("كتاب");
    expect(normalizeArabic("مـَـرْحـَـبـاً")).toBe("مرحبا");
  });

  it("normalizes Alef, Yaa, and Taa Marbuta variants", () => {
    expect(normalizeArabic("أحمد")).toBe("احمد");
    expect(normalizeArabic("إبراهيم")).toBe("ابراهيم");
    expect(normalizeArabic("آثار")).toBe("اثار");
    expect(normalizeArabic("عليّ وموسى")).toBe("علي وموسي");
    expect(normalizeArabic("مكتبة")).toBe("مكتبه");
  });

  it("converts Eastern Arabic numerals to Latin", () => {
    expect(normalizeArabic("صفحة ١٨٤ من ٢٨٨")).toBe("صفحه 184 من 288");
  });

  it("matches text regardless of diacritics and Alef forms", () => {
    const text = "إِنَّ تَارِيخَ الأُمَمِ عِبْرَةٌ لِأُولِي الأَلْبَابِ";
    expect(arabicIncludes(text, "تاريخ الامم")).toBe(true);
    expect(arabicIncludes(text, "عبره")).toBe(true);
    expect(arabicIncludes(text, "لاولي الالباب")).toBe(true);
  });
});
