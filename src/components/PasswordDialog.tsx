import { useState } from "react";
import { Dialog } from "./Dialog";

export function PasswordDialog({ isOpen, isRetry, fileName, onSubmit, onCancel }: {
  isOpen: boolean;
  isRetry: boolean;
  fileName: string;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  if (!isOpen) return null;
  const submit = () => { if (password) { onSubmit(password); setPassword(""); } };
  return <Dialog title="ملف محمي بكلمة سر" description={fileName} onClose={onCancel} footer={<>
    <button onClick={onCancel} className="plain-button">إلغاء</button>
    <button onClick={submit} disabled={!password} className="plain-button plain-button-primary">فتح الملف</button>
  </>}>
    <label htmlFor="pdf-password" className="field-label">كلمة السر</label>
    <input id="pdf-password" autoFocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} dir="ltr" className="plain-field" autoComplete="off" />
    {isRetry && <p className="plain-error" role="alert">كلمة السر غير صحيحة. حاول مرة أخرى.</p>}
    <p className="field-help">لا تُحفظ كلمة السر في التطبيق.</p>
  </Dialog>;
}