import { useCallback, useEffect, useState } from "react";
import { FileText, Trash2 } from "lucide-react";
import type { Doc } from "../data";
import { formatBytes, isDesktop } from "../lib/desktop";
import { Dialog } from "./Dialog";

export type VaultFileInfo = { id: string; name: string; size: number; addedAt: number };
type Props = { open: boolean; onClose: () => void; onNotice: (message: string) => void; onOpenDecryptedDoc: (doc: Doc) => void };

export function VaultModal({ open, onClose, onNotice, onOpenDecryptedDoc }: Props) {
  const [created, setCreated] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [files, setFiles] = useState<VaultFileInfo[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showChange, setShowChange] = useState(false);
  const [notice, setNotice] = useState("");
  const [overwriteOk, setOverwriteOk] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newConfirmation, setNewConfirmation] = useState("");
  const desktop = isDesktop();
  const api = () => (window as any).electronAPI;

  const refresh = useCallback(async () => {
    if (!desktop) return;
    try {
      const status = await api().vaultStatus();
      setCreated(status.created);
      setUnlocked(status.unlocked);
      setFiles(status.unlocked ? await api().vaultList() : []);
    } catch { setError("تعذّر قراءة حالة الخزنة."); }
  }, [desktop]);
  useEffect(() => {
    if (!open) return;
    setPassword(""); setConfirmation(""); setError("");
    setShowChange(false); setCurrentPassword(""); setNewPassword(""); setNewConfirmation("");
    void refresh();
    if (desktop && api().onVaultAutoLocked) return api().onVaultAutoLocked(() => { setUnlocked(false); setFiles([]); setPassword(""); });
  }, [open, desktop, refresh]);
  if (!open) return null;

  // Backups stay encrypted: the copy can only be opened with the vault password.
  const exportBackupNow = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await api().vaultExportBackup();
      if (!r.canceled) setNotice(`تم حفظ النسخة الاحتياطية: ${r.fileCount ?? 0} ملفات مشفّرة.`);
    } catch (err) {
      setError(String((err as Error)?.message || "").replace(/^Error invoking remote method '[^']+': (Error: )?/, "") || "تعذّر إنشاء النسخة الاحتياطية.");
    } finally {
      setBusy(false);
    }
  };

  const importBackupNow = async () => {
    setError("");
    setNotice("");
    if (!password) { setError("أدخل كلمة سر النسخة الاحتياطية أولاً."); return; }
    if (created && !overwriteOk) { setError("فعّل خيار الاستبدال أولاً. الخزنة الحالية ستُستبدل بالنسخة."); return; }
    setBusy(true);
    try {
      const r = await api().vaultImportBackup(password, created && overwriteOk);
      if (!r.canceled && r.status) {
        setCreated(r.status.created);
        setUnlocked(r.status.unlocked);
        setPassword("");
        setConfirmation("");
        setOverwriteOk(false);
        setFiles(r.status.unlocked ? await api().vaultList() : []);
        setNotice("تمت استعادة الخزنة من النسخة الاحتياطية.");
      }
    } catch (err) {
      setError(String((err as Error)?.message || "").replace(/^Error invoking remote method '[^']+': (Error: )?/, "") || "تعذّر استعادة النسخة الاحتياطية.");
    } finally {
      setBusy(false);
    }
  };

  const unlock = async () => {
    setError("");
    if (!created && password.length < 12) { setError("كلمة السر يجب ألا تقل عن 12 حرفاً."); return; }
    if (!created && password !== confirmation) { setError("كلمتا السر غير متطابقتين."); return; }
    setBusy(true);
    try {
      if (created) await api().vaultUnlock(password); else await api().vaultCreate(password);
      setPassword(""); setConfirmation("");
      await refresh();
    } catch { setError("تعذّر فتح الخزنة. تحقق من كلمة السر."); }
    finally { setBusy(false); }
  };
  const lock = async () => {
    try { await api().vaultLock(); setUnlocked(false); setFiles([]); setPassword(""); }
    catch { setError("تعذّر قفل الخزنة."); }
  };
  const add = async () => {
    setBusy(true); setError("");
    try {
      const picked = await api().pickFiles();
      for (const file of picked) await api().vaultAdd(file.path);
      await refresh();
      if (picked.length) onNotice(`أُضيف ${picked.length} ملف إلى الخزنة`);
    } catch { setError("تعذّر إضافة الملف إلى الخزنة."); }
    finally { setBusy(false); }
  };
  const read = async (item: VaultFileInfo) => {
    setBusy(true); setError("");
    try {
      const file = await api().vaultRead(item.id);
      onOpenDecryptedDoc({
        id: `vault-${item.id}`, file: file.name, title: file.name.replace(/\.pdf$/i, ""),
        kindLabel: "الخزنة", badge: "الخزنة", desc: "ملف من الخزنة للقراءة.",
        pages: 1, pageCountPending: true, at: 1, size: formatBytes(file.size),
        meta: "الخزنة", folder: "reading", ocr: false,
        thumbHead: file.name.slice(0, 22), thumbSub: "الخزنة", origin: "vault",
        path: `vault://${item.id}`, toc: [], notes: [], bookmarks: [], body: [],
        pdf: { data: file.data, proxy: null },
      });
      onClose();
    } catch { setError("تعذّر قراءة الملف من الخزنة."); }
    finally { setBusy(false); }
  };
  const changePassword = async () => {
    setError("");
    if (newPassword.length < 12) { setError("كلمة السر الجديدة يجب ألا تقل عن 12 حرفاً."); return; }
    if (newPassword !== newConfirmation) { setError("كلمتا السر الجديدتان غير متطابقتين."); return; }
    setBusy(true);
    try {
      await api().vaultChangePassword(currentPassword, newPassword);
      setCurrentPassword(""); setNewPassword(""); setNewConfirmation(""); setShowChange(false);
      onNotice("تم تغيير كلمة سر الخزنة");
      await refresh();
    } catch (reason) {
      // Electron prefixes errors from the main process; show only the message itself.
      const message = String((reason as Error)?.message ?? "").replace(/^Error invoking remote method '[^']+': Error: /, "");
      setError(message || "تعذّر تغيير كلمة السر.");
    } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    setError("");
    try { await api().vaultRemove(id); await refresh(); }
    catch { setError("تعذّر حذف الملف."); }
  };

  return <Dialog title="الخزنة" description="الملفات المحفوظة داخل الخزنة مستقلة عن المكتبة." onClose={onClose} footer={<button onClick={onClose} className="plain-button">إغلاق</button>}>
    {!desktop ? <p className="text-[12px] leading-relaxed text-ink-3">الخزنة غير متاحة في المتصفح. استخدم تطبيق أليف على ويندوز.</p> : <>
      {error && <p className="plain-error mb-3" role="alert">{error}</p>}
      {!unlocked ? <div className="space-y-4">
        {!created && <p className="text-[12px] leading-[1.8] text-brick">لا يمكن استرجاع كلمة السر؛ إن ضاعت فلن تتمكن من فتح الملفات.</p>}
        <div><label htmlFor="vault-password" className="field-label">{created ? "كلمة سر الخزنة" : "كلمة سر جديدة، 12 حرفاً على الأقل"}</label><input id="vault-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && created) void unlock(); }} dir="ltr" autoComplete="off" className="plain-field" /></div>
        {!created && <div><label htmlFor="vault-confirm" className="field-label">تأكيد كلمة السر</label><input id="vault-confirm" type="password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} dir="ltr" autoComplete="off" className="plain-field" /></div>}
        <button onClick={unlock} disabled={busy || !password} className="plain-button plain-button-primary">{busy ? "جارٍ التحقق..." : created ? "فتح الخزنة" : "إنشاء الخزنة"}</button>
        <div className="border-t border-line pt-3">
          <p className="field-help">لديك نسخة احتياطية؟ أدخل كلمة سرها ثم اختر مجلدها.</p>
          {created && <label className="mt-2 flex items-center gap-2 text-[11.5px] text-brick"><input type="checkbox" checked={overwriteOk} onChange={(e) => setOverwriteOk(e.target.checked)} />استبدال الخزنة الحالية بالنسخة (يُحذف محتواها الحالي)</label>}
          <button onClick={importBackupNow} disabled={busy} className="plain-button mt-2">استعادة من نسخة احتياطية</button>
          {notice && <p className="mt-2 text-[11.5px] text-ink-2">{notice}</p>}
        </div>
        <p className="field-help">تشفير AES-256-GCM. تقفل الخزنة بعد 5 دقائق من عدم استخدامها.</p>
      </div> : <>
        <div className="mb-4 flex items-center justify-between text-[12px]"><span className="text-ink-3">{files.length} ملف</span><div className="flex gap-2"><button onClick={add} disabled={busy} className="plain-button">إضافة PDF</button><button onClick={() => setShowChange((open) => !open)} className="plain-button">تغيير كلمة السر</button><button onClick={lock} className="plain-button">قفل</button></div></div>
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[12px]"><button onClick={exportBackupNow} disabled={busy} className="plain-button">نسخة احتياطية مشفّرة</button>{notice && <span className="text-ink-2">{notice}</span>}</div>
        {showChange && <div className="mb-4 space-y-3 border-b border-line pb-4">
          <div><label htmlFor="vault-current" className="field-label">كلمة السر الحالية</label><input id="vault-current" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} dir="ltr" autoComplete="off" className="plain-field" /></div>
          <div><label htmlFor="vault-new" className="field-label">كلمة السر الجديدة، 12 حرفاً على الأقل</label><input id="vault-new" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} dir="ltr" autoComplete="off" className="plain-field" /></div>
          <div><label htmlFor="vault-new-confirm" className="field-label">تأكيد كلمة السر الجديدة</label><input id="vault-new-confirm" type="password" value={newConfirmation} onChange={(e) => setNewConfirmation(e.target.value)} dir="ltr" autoComplete="off" className="plain-field" /></div>
          <div className="flex justify-end gap-2"><button onClick={() => setShowChange(false)} className="plain-button">إلغاء</button><button onClick={changePassword} disabled={busy || !currentPassword || !newPassword} className="plain-button plain-button-primary">{busy ? "جارٍ إعادة التشفير..." : "تغيير كلمة السر"}</button></div>
          <p className="field-help">تُعاد تشفير كل الملفات بكلمة السر الجديدة، وقد يستغرق ذلك وقتاً مع الملفات الكبيرة.</p>
        </div>}
        <div className="border-y border-line">{files.length ? files.map((item) => <div key={item.id} className="flex items-center gap-2 border-b border-line py-2.5 last:border-0">
          <FileText className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} />
          <button onClick={() => read(item)} disabled={busy} dir="auto" className="min-w-0 flex-1 truncate text-start text-[12px] text-ink hover:underline">{item.name}</button>
          <span className="tnum shrink-0 text-[10px] text-ink-3">{formatBytes(item.size)}</span>
          <button onClick={() => remove(item.id)} aria-label={`حذف ${item.name}`} className="plain-icon"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>) : <p className="py-6 text-center text-[12px] text-ink-3">لا توجد ملفات في الخزنة بعد.</p>}</div>
        <p className="field-help mt-3">عند إضافة ملف، تبقى النسخة الأصلية خارج الخزنة في مكانها.</p>
      </>}
    </>}
  </Dialog>;
}