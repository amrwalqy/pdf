/* Page color & tone engine for Alif PDF reader.
   Supports preset tints (White, Warm Sepia, Antique Amber, Mint Eye-Care, Muted Gray, Dark Night, True OLED),
   custom warmth/brightness/contrast sliders, invert mode, and persistence. */

export type PageToneId = "white" | "sepia" | "amber" | "mint" | "gray" | "night" | "oled" | "custom";

export type PageToneState = {
  id: PageToneId;
  warmth: number;     // 0..100 (%)
  brightness: number; // 60..140 (%)
  contrast: number;   // 70..130 (%)
  invert: boolean;
};

export type PresetToneDef = {
  id: PageToneId;
  name: string;
  desc: string;
  swatch: string;
  bg: string;
  border: string;
  text: string;
  subText: string;
  markBg: string;
  isDark: boolean;
  warmth: number;
  brightness: number;
  contrast: number;
  invert: boolean;
};

export const PAGE_TONE_PRESETS: PresetToneDef[] = [
  {
    id: "white",
    name: "أبيض أصلي",
    desc: "ألوان الصفحة الأصلية بدون تعديل",
    swatch: "#ffffff",
    bg: "#ffffff",
    border: "#d9cdb8",
    text: "#2e2119",
    subText: "#93826f",
    markBg: "#f3ddb4",
    isDark: false,
    warmth: 0,
    brightness: 100,
    contrast: 100,
    invert: false,
  },
  {
    id: "sepia",
    name: "ورق دافئ (Sepia)",
    desc: "بيج ورقي كلاسيكي مريح للأعين",
    swatch: "#f5edd6",
    bg: "#f5edd6",
    border: "#d8c7a8",
    text: "#3d2b1f",
    subText: "#8d7658",
    markBg: "#eed4a5",
    isDark: false,
    warmth: 40,
    brightness: 97,
    contrast: 97,
    invert: false,
  },
  {
    id: "amber",
    name: "ورق كهرماني",
    desc: "دفء خفيف لحجب الضوء الأزرق",
    swatch: "#faebd0",
    bg: "#faebd0",
    border: "#dfc093",
    text: "#3d2510",
    subText: "#936838",
    markBg: "#eed39d",
    isDark: false,
    warmth: 75,
    brightness: 95,
    contrast: 96,
    invert: false,
  },
  {
    id: "mint",
    name: "أخضر هادئ (راحة العين)",
    desc: "صبغة نعناعية مهدئة للإرهاق البصري",
    swatch: "#e2ede2",
    bg: "#e2ede2",
    border: "#b9cdb8",
    text: "#1c301e",
    subText: "#557453",
    markBg: "#cde3cb",
    isDark: false,
    warmth: 20,
    brightness: 98,
    contrast: 96,
    invert: false,
  },
  {
    id: "gray",
    name: "رمادي محايد",
    desc: "سطوع خافت متوازن للقراءة المطوّلة",
    swatch: "#e6e8eb",
    bg: "#e6e8eb",
    border: "#c5c8d0",
    text: "#1f242d",
    subText: "#666d7b",
    markBg: "#d1d5db",
    isDark: false,
    warmth: 0,
    brightness: 93,
    contrast: 96,
    invert: false,
  },
  {
    id: "night",
    name: "ليلي داكن",
    desc: "خلفية داكنة مع نصوص مضيئة",
    swatch: "#1c1c1f",
    bg: "#18181b",
    border: "#3f3f46",
    text: "#e4e4e7",
    subText: "#a1a1aa",
    markBg: "#3f3f46",
    isDark: true,
    warmth: 0,
    brightness: 95,
    contrast: 95,
    invert: true,
  },
  {
    id: "oled",
    name: "أسود فحمي (OLED)",
    desc: "أقصى توفير للطاقة وظلام نقي",
    swatch: "#000000",
    bg: "#000000",
    border: "#27272a",
    text: "#fafafa",
    subText: "#71717a",
    markBg: "#27272a",
    isDark: true,
    warmth: 0,
    brightness: 90,
    contrast: 90,
    invert: true,
  },
];

export const DEFAULT_PAGE_TONE: PageToneState = {
  id: "white",
  warmth: 0,
  brightness: 100,
  contrast: 100,
  invert: false,
};

const LS_KEY = "alif:page-tone";

export function loadPageTone(): PageToneState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_PAGE_TONE;
    const parsed = JSON.parse(raw);
    const validIds: PageToneId[] = ["white", "sepia", "amber", "mint", "gray", "night", "oled", "custom"];
    const id = validIds.includes(parsed.id) ? parsed.id : "white";
    return {
      id,
      warmth: typeof parsed.warmth === "number" ? Math.max(0, Math.min(100, parsed.warmth)) : 0,
      brightness: typeof parsed.brightness === "number" ? Math.max(60, Math.min(140, parsed.brightness)) : 100,
      contrast: typeof parsed.contrast === "number" ? Math.max(70, Math.min(130, parsed.contrast)) : 100,
      invert: !!parsed.invert,
    };
  } catch {
    return DEFAULT_PAGE_TONE;
  }
}

export function savePageTone(tone: PageToneState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(tone));
  } catch {
    /* ignore */
  }
}

/** Computes the CSS filter string for a canvas based on tone settings. */
export function computeCanvasFilter(tone: PageToneState): string {
  const parts: string[] = [];

  if (tone.id === "mint") {
    parts.push("sepia(25%) hue-rotate(55deg) saturate(120%)");
  } else if (tone.warmth > 0) {
    const s = (tone.warmth * 0.7).toFixed(1);
    parts.push(`sepia(${s}%)`);
    if (tone.warmth > 40) {
      parts.push("saturate(130%)");
    }
  }

  if (tone.invert) {
    parts.push("invert(0.92) hue-rotate(180deg)");
  }

  if (tone.brightness !== 100) {
    parts.push(`brightness(${(tone.brightness / 100).toFixed(2)})`);
  }

  if (tone.contrast !== 100) {
    parts.push(`contrast(${(tone.contrast / 100).toFixed(2)})`);
  }

  return parts.length > 0 ? parts.join(" ") : "none";
}

/** Resolves visual styling (bg, text, border, filter) for current state. */
export function resolvePageStyle(tone: PageToneState) {
  const preset = PAGE_TONE_PRESETS.find((p) => p.id === tone.id) ?? PAGE_TONE_PRESETS[0];
  const filter = computeCanvasFilter(tone);

  let bg = preset.bg;
  let text = preset.text;
  let border = preset.border;
  let subText = preset.subText;
  let markBg = preset.markBg;

  if (tone.invert && !preset.isDark) {
    bg = "#18181b";
    text = "#e4e4e7";
    border = "#3f3f46";
    subText = "#a1a1aa";
    markBg = "#3f3f46";
  }

  return {
    bg,
    text,
    border,
    subText,
    markBg,
    filter,
    isDark: tone.invert || preset.isDark,
  };
}
