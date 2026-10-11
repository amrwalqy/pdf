import { useState } from "react";
import { Dialog } from "./Dialog";

/** Asks for a new file name. The ".pdf" extension is added automatically, so only the name is edited. */
export function RenameDialog({ currentName, onSubmit, onCancel }: {
  currentName: string;
  onSubmit: (newName: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const stem = currentName.replace(/\.pdf$/i, "");
  const [value, setValue] = useState(stem);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const validate = (raw: string): string | null => {
    const next = raw.trim().replace(/\.pdf$/i, "").trim();
    if (!next) return "اكتب اسماً للملف";
    if (/[<>:"/\\|?*\u0000-\u001f]/.test(next)) return "الاسم يحتوي على محارف غير مسموحة في ويندوز";
    if (/[. ]$/.test(next)) return "لا يجوز أن ينتهي الاسم بنقطة أو مسافة";
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(next.split(".")[0])) return "هذا الاسم محجوز في ويندوز، اختر اسماً آخر";
    if (next.length > 200) return "الاسم طويل جداً (الحد 200 حرفاً)";
    return null;
  };

  const submit = async () => {
    if (busy) return;
    const next = value.trim();
    const validationError = validate(next);
    if (validationError) { setError(validationError); return; }
    if (next.replace(/\.pdf$/i, "").trim() === stem) { onCancel(); return; }
    setBusy(true);
    const problem = await onSubmit(next);
    setBusy(false);
    if (problem) setError(problem);
  };

  return <Dialog title="تغيير اسم الملف" description="يتغيّر اسم الملف على القرص نفسه، ويبقى في مجلده." onClose={onCancel} footer={<>
    <button onClick={onCancel} className="plain-button">إلغاء</button>
    <button onClick={() => void submit()} disabled={busy || !value.trim()} className="plain-button plain-button-primary">{busy ? "جارٍ التغيير…" : "تغيير الاسم"}</button>
  </>}>
    <label htmlFor="rename-file" className="field-label">الاسم الجديد</label>
    <input
      id="rename-file"
      autoFocus
      value={value}
      onChange={(event) => {
        const next = event.target.value;
        setValue(next);
        setError(validate(next));
      }}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => { if (event.key === "Enter") void submit(); }}
      dir="auto"
      className="plain-field"
      autoComplete="off"
      spellCheck={false}
      maxLength={204}
      aria-invalid={!!error}
      aria-describedby={error ? "rename-error" : "rename-help"}
    />
    {error && <p id="rename-error" className="plain-error" role="alert">{error}</p>}
    <p id="rename-help" className="field-help">يُضاف الامتداد <span dir="ltr">.pdf</span> تلقائياً · يبقى الملف في المجلد نفسه.</p>
  </Dialog>;
}
