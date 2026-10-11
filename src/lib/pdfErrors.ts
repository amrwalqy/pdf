/** Turns a failure while opening a PDF into a message the reader can show. Pure, so it is unit-tested. */
export function classifyPdfError(err: unknown): string {
  const name = (err as { name?: string })?.name || "";
  const msg = String((err as Error)?.message || err || "");
  if (name === "PasswordException" || /password/i.test(msg)) {
    return "هذا الملف محمي بكلمة مرور. أدخل كلمة المرور الصحيحة.";
  }
  if (name === "InvalidPDFException" || /Invalid PDF|format error|Missing PDF|not a PDF/i.test(msg)) {
    return "الملف تالف أو ليس بصيغة PDF صالحة.";
  }
  if (/network|Failed to fetch|alif-file|NetworkError|Range/i.test(msg)) {
    return "تعذّر الوصول إلى الملف على القرص. تحقق من المسار والصلاحيات.";
  }
  if (/out of memory|OOM|allocation/i.test(msg)) {
    return "الملف كبير جدًا على الذاكرة المتاحة. أغلق نوافذ أخرى وحاول مجددًا.";
  }
  return "تعذّر قراءة هذا الملف. تأكد من وجوده وصحته.";
}
