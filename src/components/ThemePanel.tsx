import { DEFAULT_THEME, depthLabel, getThemeVars, PRESETS, type ThemeId } from "../lib/theme";
import { cn } from "../utils/cn";
import { Dialog } from "./Dialog";

type Props = {
  open: boolean;
  preset: ThemeId;
  depth: number;
  onPreset: (id: ThemeId) => void;
  onDepth: (value: number) => void;
  onReset: () => void;
  onClose: () => void;
};

export function ThemePanel({ open, preset, depth, onPreset, onDepth, onReset, onClose }: Props) {
  if (!open) return null;
  return <Dialog title="المظهر" description="غيّر لون واجهة التطبيق. يظهر التغيير مباشرة ويُحفظ على جهازك." onClose={onClose} footer={<>
    <button onClick={onReset} className="plain-button me-auto">استعادة الافتراضي</button>
    <button onClick={onClose} className="plain-button plain-button-primary">تم</button>
  </>}>
    <label className="field-label">لون الواجهة</label>
    <div className="setting-options">
      {PRESETS.map((option) => <button key={option.id} onClick={() => onPreset(option.id)} aria-pressed={preset === option.id} className={cn("setting-option", preset === option.id && "is-active")}>
        <span className="h-3 w-3 rounded-sm border border-line-2" style={{ backgroundColor: getThemeVars(option.id, 55)["--color-paper"] }} />
        {option.name}
      </button>)}
    </div>
    <div className="mt-5">
      <div className="setting-row"><label htmlFor="theme-depth">درجة اللون</label><span className="tnum text-[11px] text-ink-3">{depthLabel(depth)} · {depth}%</span></div>
      <input id="theme-depth" type="range" min={0} max={100} step={1} value={depth} onChange={(e) => onDepth(Number(e.target.value))} className="theme-slider" dir="ltr" />
      <div className="mt-2 flex justify-between text-[10px] text-ink-3"><span>غامق</span><span>فاتح</span></div>
    </div>
    <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-3">لون صفحة PDF يُضبط بشكل مستقل من أدوات القارئ.</p>
    <span className="sr-only">الافتراضي: {DEFAULT_THEME.preset}</span>
  </Dialog>;
}