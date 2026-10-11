import { useEffect, useState } from "react";
import type { UpdateStatus } from "../lib/desktop";
import { Dialog } from "./Dialog";

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [logStatus, setLogStatus] = useState<string | null>(null);
  const [licenseStatus, setLicenseStatus] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  useEffect(() => {
    if (!open || typeof window.electronAPI?.updateStatus !== "function") return;
    void window.electronAPI.updateStatus().then(setUpdate).catch(() => undefined);
  }, [open]);
  if (!open) return null;

  const canOpenLogs = typeof window.electronAPI?.openLogs === "function";
  const canOpenLicenses = typeof window.electronAPI?.openThirdPartyNotices === "function";

  async function openLogFolder() {
    try {
      const result = await window.electronAPI!.openLogs();
      setLogStatus(result.error ? `تعذّر فتح المجلد: ${result.error}` : "تم فتح مجلد السجلات");
    } catch {
      setLogStatus("تعذّر فتح مجلد السجلات");
    }
  }

  async function openLicenseNotices() {
    try {
      const result = await window.electronAPI!.openThirdPartyNotices!();
      setLicenseStatus(result.error ? `تعذّر فتح إشعار التراخيص: ${result.error}` : "تم فتح إشعار تراخيص الطرف الثالث");
    } catch {
      setLicenseStatus("تعذّر فتح إشعار تراخيص الطرف الثالث");
    }
  }

  // Every update step runs only when the user presses its button.
  async function runUpdate(action: "updateCheck" | "updateDownload" | "updateInstall") {
    const call = window.electronAPI?.[action];
    if (typeof call !== "function") return;
    setUpdateBusy(true);
    try {
      const next = await call();
      if (next) setUpdate(next);
    } catch {
      setUpdate((current) => (current ? { ...current, error: "تعذّر تنفيذ العملية" } : current));
    } finally {
      setUpdateBusy(false);
    }
  }

  function updateText(s: UpdateStatus | null): string {
    if (!s) return "";
    if (!s.supported) return s.error || "التحديث التلقائي يعمل في النسخة المثبّتة فقط.";
    if (s.error) return `تعذّر التحقق من التحديثات: ${s.error}`;
    if (!s.configured) return s.note || "التحديثات غير مُفعّلة في هذا البناء.";
    if (s.downloading) return `جارٍ تنزيل التحديث ${s.progress}%`;
    if (s.downloaded) return `التحديث ${s.version ?? ""} جاهز. يُثبَّت عند الضغط على زر التثبيت.`;
    if (s.available) return `يتوفر إصدار أحدث ${s.version ?? ""}.`;
    if (s.checking) return "جارٍ التحقق من التحديثات...";
    return "أنت تستخدم أحدث إصدار متاح.";
  }

  return (
    <Dialog
      title="Alif PDF Reader — أليف"
      description="قارئ ملفات PDF لسطح المكتب: مكتبة مجلدات، بحث عربي، خزنة مشفّرة، وأدوات دمج واستخراج وتوقيع — كل ذلك محلياً على جهازك."
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {canOpenLogs && <button onClick={openLogFolder} className="plain-button">فتح مجلد السجلات</button>}
            {canOpenLicenses && <button onClick={openLicenseNotices} className="plain-button">تراخيص الطرف الثالث</button>}
            {!canOpenLogs && !canOpenLicenses && <span />}
          </div>
          <button onClick={onClose} className="plain-button plain-button-primary">
            إغلاق
          </button>
        </div>
      }
    >
      <div className="flex flex-col items-center py-2 text-center">
        <img src="alif-logo.png" alt="شعار Alif PDF" className="h-24 w-24 rounded-2xl" draggable={false} />
        <p className="mt-3 text-[13px] font-semibold text-ink" dir="ltr">
          ALIF PDF
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
          الإصدار {__APP_VERSION__} · يعمل دون إنترنت
          <br />
          الاختصارات: Ctrl+K للبحث · Ctrl+O لفتح ملف · F11 لملء الشاشة
        </p>
        {logStatus && <p className="mt-2 text-[11px] text-ink-3">{logStatus}</p>}
        {licenseStatus && <p className="mt-2 text-[11px] text-ink-3">{licenseStatus}</p>}
        {update && <div className="mt-4 w-full border-t border-line pt-3 text-start">
          <p className="text-[11.5px] font-medium text-ink-2">التحديثات</p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{updateText(update)}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => runUpdate("updateCheck")} disabled={updateBusy || !update.supported || update.checking} className="plain-button">التحقق من التحديثات</button>
            {update.available && !update.downloaded && <button onClick={() => runUpdate("updateDownload")} disabled={updateBusy || update.downloading} className="plain-button">تنزيل التحديث</button>}
            {update.downloaded && <button onClick={() => runUpdate("updateInstall")} className="plain-button plain-button-primary">تثبيت الآن وإعادة التشغيل</button>}
          </div>
        </div>}
      </div>
    </Dialog>
  );
}
