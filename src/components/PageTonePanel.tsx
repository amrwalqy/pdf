import { DEFAULT_PAGE_TONE, PAGE_TONE_PRESETS, resolvePageStyle, type PageToneState } from "../lib/pageTone";
import { cn } from "../utils/cn";
import { Dialog } from "./Dialog";

type Props = { open: boolean; tone: PageToneState; onChange: (tone: PageToneState) => void; onClose: () => void };

export function PageTonePanel({ open, tone, onChange, onClose }: Props) {
  if (!open) return null;
  const style = resolvePageStyle(tone);
  const update = (field: "warmth" | "brightness" | "contrast", value: number) => onChange({ ...tone, id: "custom", [field]: value });
  return <Dialog title="لون صفحات PDF" description="يتغير مظهر القراءة فقط، ولا يتغير ملف PDF الأصلي." onClose={onClose} footer={<>
    <button onClick={() => onChange(DEFAULT_PAGE_TONE)} className="plain-button me-auto">استعادة الأصل</button>
    <button onClick={onClose} className="plain-button plain-button-primary">تم</button>
  </>}>
    <label className="field-label">لون الورق</label>
    <div className="setting-options">
      {PAGE_TONE_PRESETS.map((preset) => <button key={preset.id} onClick={() => onChange({ id: preset.id, warmth: preset.warmth, brightness: preset.brightness, contrast: preset.contrast, invert: preset.invert })} title={preset.desc} aria-pressed={tone.id === preset.id} className={cn("setting-option", tone.id === preset.id && "is-active")}>
        <span className="h-3 w-3 rounded-sm border border-line-2" style={{ backgroundColor: preset.swatch }} />
        {preset.id === "white" ? "أبيض" : preset.id === "sepia" ? "دافئ" : preset.id === "amber" ? "كهرماني" : preset.id === "mint" ? "أخضر" : preset.id === "gray" ? "رمادي" : preset.id === "night" ? "ليلي" : "أسود"}
      </button>)}
    </div>
    <div className="mt-4 border-y border-line px-4 py-3" style={{ background: style.bg, color: style.text }}>
      <span className="text-[10px]" style={{ color: style.subText }}>معاينة</span>
      <p className="mt-1 font-display text-[16px] leading-relaxed">اعلم أن التاريخ فن عزيز المذهب، جم الفوائد، شريف الغاية.</p>
    </div>
    <div className="mt-4 space-y-3">
      {([
        ["warmth", "دفء الورق", 0, 100], ["brightness", "السطوع", 60, 130], ["contrast", "التباين", 75, 125],
      ] as const).map(([field, label, min, max]) => <div key={field}>
        <div className="setting-row"><label htmlFor={`page-${field}`}>{label}</label><span className="tnum text-[11px] text-ink-3">{tone[field]}%</span></div>
        <input id={`page-${field}`} type="range" min={min} max={max} step={2} value={tone[field]} onChange={(e) => update(field, Number(e.target.value))} dir="ltr" className="theme-slider" />
      </div>)}
    </div>
    <label className="setting-row mt-3 border-t border-line pt-3"><span>عكس ألوان الصفحة</span><input type="checkbox" checked={tone.invert} onChange={() => onChange({ ...tone, id: "custom", invert: !tone.invert })} className="h-3.5 w-3.5 accent-[var(--color-brown)]" /></label>
  </Dialog>;
}