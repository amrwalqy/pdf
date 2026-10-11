/* Alif theme engine — 4 palettes (brown / gray / black / white),
   each with a dark → light depth slider (0 = غامق جداً … 100 = فاتح جداً).
   Palettes are defined at 3 stops and interpolated in RGB; secondary
   tokens are derived so every combination stays readable. */

export type ThemeId = "brown" | "gray" | "black" | "white";
export type ThemeState = { preset: ThemeId; depth: number };

export const DEFAULT_THEME: ThemeState = { preset: "black", depth: 30 };
const LS_THEME = "alif:theme";

/* ---------- color math ---------- */

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex([r, g, b]: RGB): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** mix(a, b, t): t=0 → a, t=1 → b */
export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}

/** relative luminance 0..1 */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
}

/* ---------- palette stops ---------- */

type Stop = { paper: string; panel: string; line: string; ink: string; primary: string; accent: string };

type PresetDef = {
  id: ThemeId;
  name: string;
  desc: string;
  stops: { at: number; c: Stop }[];
};

export const PRESETS: PresetDef[] = [
  {
    id: "brown",
    name: "بنّي",
    desc: "درجات دافئة",
    stops: [
      { at: 0, c: { paper: "#171411", panel: "#211d19", line: "#39312b", ink: "#ede8e2", primary: "#d3c4b4", accent: "#aa9680" } },
      { at: 55, c: { paper: "#f4f1ee", panel: "#fffefd", line: "#e5dfd9", ink: "#302a25", primary: "#625448", accent: "#968675" } },
      { at: 100, c: { paper: "#faf9f7", panel: "#ffffff", line: "#ebe7e2", ink: "#28231e", primary: "#584b3f", accent: "#867765" } },
    ],
  },
  {
    id: "gray",
    name: "رمادي",
    desc: "درجات محايدة",
    stops: [
      { at: 0, c: { paper: "#15171a", panel: "#1d2024", line: "#33373d", ink: "#e9ebee", primary: "#d1d5db", accent: "#919ba8" } },
      { at: 55, c: { paper: "#f5f6f7", panel: "#ffffff", line: "#e6e7e9", ink: "#25282c", primary: "#393f46", accent: "#69727d" } },
      { at: 100, c: { paper: "#fafbfc", panel: "#ffffff", line: "#eceef0", ink: "#202328", primary: "#30363d", accent: "#626c78" } },
    ],
  },
  {
    id: "black",
    name: "أسود",
    desc: "أسود وذهبي",
    stops: [
      { at: 0, c: { paper: "#000000", panel: "#0d0c0a", line: "#2c2415", ink: "#f6f2e9", primary: "#e8c98a", accent: "#d8a354" } },
      { at: 30, c: { paper: "#090909", panel: "#12100c", line: "#332a19", ink: "#f1f0ed", primary: "#ead9b8", accent: "#d8a354" } },
      { at: 100, c: { paper: "#1b1913", panel: "#242018", line: "#4a3f28", ink: "#fbf8f1", primary: "#f2e3c4", accent: "#e0b269" } },
    ],
  },
  {
    id: "white",
    name: "أبيض",
    desc: "درجات فاتحة",
    stops: [
      { at: 0, c: { paper: "#c9cacd", panel: "#dbdcdf", line: "#b4b6ba", ink: "#161719", primary: "#202224", accent: "#62666d" } },
      { at: 55, c: { paper: "#f7f7f8", panel: "#ffffff", line: "#e5e5e8", ink: "#1b1c1e", primary: "#292b2e", accent: "#676c75" } },
      { at: 100, c: { paper: "#ffffff", panel: "#ffffff", line: "#e9e9ec", ink: "#101114", primary: "#17181b", accent: "#717681" } },
    ],
  },
];

export function presetById(id: ThemeId): PresetDef {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

function stopAt(def: PresetDef, depth: number): Stop {
  const d = Math.max(0, Math.min(100, depth));
  const stops = def.stops;
  let lo = stops[0];
  let hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (d >= stops[i].at && d <= stops[i + 1].at) {
      lo = stops[i];
      hi = stops[i + 1];
      break;
    }
  }
  const span = Math.max(hi.at - lo.at, 1);
  const t = (d - lo.at) / span;
  const keys: (keyof Stop)[] = ["paper", "panel", "line", "ink", "primary", "accent"];
  const out = {} as Stop;
  for (const k of keys) out[k] = mix(lo.c[k], hi.c[k], t);
  return out;
}

/* ---------- css vars ---------- */

export type ThemeVars = Record<string, string>;

/** Full variable set for a preset + depth. */
export function getThemeVars(preset: ThemeId, depth: number): ThemeVars {
  const s = stopAt(presetById(preset), depth);
  // Intermediate slider shades must not interpolate text into the same grey
  // as the surface. Move toward a readable ink only when contrast is too low.
  const surfaceContrast = (color: string) => Math.min(contrast(color, s.paper), contrast(color, s.panel));
  const fallback = surfaceContrast("#ffffff") > surfaceContrast("#000000") ? "#ffffff" : "#000000";
  const surfaceTarget = fallback === "#000000" ? "#ffffff" : "#000000";
  for (let step = 0; step < 20 && surfaceContrast(fallback) < 4.5; step++) {
    s.paper = mix(s.paper, surfaceTarget, .03);
    s.panel = mix(s.panel, surfaceTarget, .03);
  }
  const dark = luminance(s.paper) < .18;
  const lum = luminance(s.paper);
  const grain = (0.04 + Math.max(0, Math.min(1, (lum - 0.02) / 0.75)) * 0.12).toFixed(3);
  const readable = (candidate: string) => {
    for (let step = 0; step <= 20; step++) {
      const color = mix(candidate, fallback, step / 20);
      if (surfaceContrast(color) >= 4.5) return color;
    }
    return fallback;
  };
  const ink = readable(s.ink);
  const primary = readable(s.primary);

  return {
    "--color-paper": s.paper,
    "--color-paper-2": mix(s.paper, s.panel, 0.55),
    "--color-panel": s.panel,
    "--color-line": s.line,
    "--color-line-2": mix(s.line, s.ink, 0.22),
    "--color-ink": ink,
    "--color-ink-2": readable(mix(ink, s.paper, 0.3)),
    "--color-ink-3": readable(mix(ink, s.paper, 0.5)),
    "--color-brown": primary,
    "--color-brown-2": readable(mix(primary, s.accent, 0.28)),
    "--color-amber": s.accent,
    "--color-amber-soft": mix(s.accent, s.panel, 0.78),
    "--color-on-accent": luminance(s.accent) > 0.3 ? "#241a13" : "#ffffff",
    "--color-brick": dark ? "#d4694f" : "#a4402c",
    "--color-moss": dark ? "#7ba873" : "#4f7a4a",
    "--desk-veil": rgba(s.paper, 0.9),
    "--grain-opacity": grain,
    "--theme-scheme": dark ? "dark" : "light",
  };
}

/** Apply to <html> so body, portals and scrollbars follow. */
export function applyTheme(state: ThemeState) {
  const vars = getThemeVars(state.preset, state.depth);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.colorScheme = vars["--theme-scheme"];
  return vars;
}

export function depthLabel(depth: number): string {
  if (depth <= 15) return "غامق جداً";
  if (depth <= 38) return "غامق";
  if (depth <= 68) return "متوازن";
  if (depth <= 88) return "فاتح";
  return "فاتح جداً";
}

/* ---------- persistence ---------- */

export function loadTheme(): ThemeState {
  try {
    const raw = localStorage.getItem(LS_THEME);
    if (!raw) return DEFAULT_THEME;
    const p = JSON.parse(raw) as Partial<ThemeState>;
    const preset: ThemeId =
      p.preset === "gray" || p.preset === "black" || p.preset === "white" || p.preset === "brown"
        ? p.preset
        : DEFAULT_THEME.preset;
    const depth = typeof p.depth === "number" ? Math.max(0, Math.min(100, Math.round(p.depth))) : 55;
    return { preset, depth };
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(s: ThemeState) {
  try {
    localStorage.setItem(LS_THEME, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
