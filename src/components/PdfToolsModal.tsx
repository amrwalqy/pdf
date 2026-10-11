import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { Doc } from "../data";
import { isDesktop, readLibraryPdf } from "../lib/desktop";
import { createPdfToolWorker } from "../lib/pdfToolsWorker";
import { startPdfTool, type PdfToolJob } from "../lib/pdfTools";
import { Dialog } from "./Dialog";

type Props = {
  tool: "merge" | "split" | "sign";
  onClose: () => void;
  onNotice: (message: string) => void;
  availableDocs: Doc[];
  onOpenNewDoc?: (file: { name: string; data: ArrayBuffer }) => void;
};

export function PdfToolsModal({ tool, availableDocs, onClose, onNotice }: Props) {
  const [mergeDocs, setMergeDocs] = useState<Doc[]>(() => availableDocs.slice(0, 2));
  // Documents can still be opening when the dialog appears, so the defaults are chosen once they are ready.
  useEffect(() => {
    if (mergeDocs.length === 0 && availableDocs.length >= 2) setMergeDocs(availableDocs.slice(0, 2));
  }, [availableDocs, mergeDocs.length]);
  const [sourceId, setSourceId] = useState(availableDocs[0]?.id ?? "");
  const [range, setRange] = useState("1-2");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hasSignature, setHasSignature] = useState(false);
  const [progressText, setProgressText] = useState("");
  const jobRef = useRef<PdfToolJob | null>(null);
  // Leaving the dialog stops a job that is still running.
  useEffect(() => () => jobRef.current?.cancel(), []);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const source = availableDocs.find((doc) => doc.id === sourceId) ?? availableDocs[0];
  const title = tool === "merge" ? "دمج ملفات PDF" : tool === "split" ? "استخراج صفحات" : "توقيع مرئي";

  const getBytes = async (doc: Doc) => {
    if (doc.pdf?.data) return doc.pdf.data;
    if (doc.path && (doc.origin === "watched" || (doc.origin === "imported" && isDesktop()))) {
      const data = await readLibraryPdf(doc.path);
      if (data) { if (doc.pdf) doc.pdf.data = data; return data; }
    }
    throw new Error(`تعذّر قراءة الملف: ${doc.file}`);
  };
  const save = async (bytes: Uint8Array<ArrayBuffer>, name: string) => {
    if (window.electronAPI?.saveFile) {
      const result = await window.electronAPI.saveFile({ defaultName: name, data: bytes });
      if (result.canceled) return;
      onNotice(`تم حفظ المستند: ${result.path ?? name}`);
    } else {
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      onNotice(`تم تجهيز تنزيل الملف: ${name}`);
    }
    onClose();
  };
  const execute = async () => {
    setError("");
    setProgressText("");
    setBusy(true);
    try {
      if (tool === "merge") {
        if (mergeDocs.length < 2) throw new Error("اختر ملفين على الأقل للدمج.");
        const buffers: ArrayBuffer[] = [];
        for (const doc of mergeDocs) buffers.push(await getBytes(doc));
        const job = startPdfTool({ op: "merge", buffers }, {
          createWorker: createPdfToolWorker,
          onProgress: ({ done, total }) => setProgressText(`جارٍ دمج الملف ${done} من ${total}`),
        });
        jobRef.current = job;
        await save(await job.result, `دمج_${Date.now()}.pdf`);
      } else {
        if (!source) throw new Error("اختر مستنداً أولاً.");
        const data = await getBytes(source);
        if (tool === "split") {
          const job = startPdfTool({ op: "split", buffer: data, range }, { createWorker: createPdfToolWorker });
          jobRef.current = job;
          await save(await job.result, `مستخرج_${source.title}.pdf`);
        } else {
          if (!canvas.current || !hasSignature) throw new Error("ارسم توقيعك أو اختر صورة PNG أولاً.");
          const job = startPdfTool({
            op: "sign",
            buffer: data,
            signaturePng: canvas.current.toDataURL("image/png"),
            pageIndex: page - 1,
            box: { x: 50, y: 50, width: 140, height: 70 },
          }, { createWorker: createPdfToolWorker });
          jobRef.current = job;
          await save(await job.result, `موقع_${source.title}.pdf`);
        }
      }
    } catch (reason) {
      if ((reason as Error).name !== "AbortError") setError((reason as Error).message || "تعذّر تنفيذ العملية.");
    } finally {
      jobRef.current = null;
      setBusy(false);
      setProgressText("");
    }
  };
  const cancelJob = () => jobRef.current?.cancel();

  const reorder = (index: number, direction: number) => setMergeDocs((previous) => {
    const next = [...previous];
    const target = index + direction;
    if (target < 0 || target >= next.length) return previous;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const node = canvas.current!;
    const rect = node.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * node.width / rect.width, y: (event.clientY - rect.top) * node.height / rect.height };
  };
  const startDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = point(event);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineWidth = 2.5;
    context.lineCap = "round";
    context.strokeStyle = "#25282c";
    drawing.current = true;
    setHasSignature(true);
  };
  const draw = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    const next = point(event);
    context.lineTo(next.x, next.y);
    context.stroke();
  };
  const clear = () => {
    const node = canvas.current;
    if (node) node.getContext("2d")?.clearRect(0, 0, node.width, node.height);
    setHasSignature(false);
  };
  const importSignature = (file?: File) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const node = canvas.current;
      if (node) {
        clear();
        const scale = Math.min(node.width / image.width, node.height / image.height);
        node.getContext("2d")?.drawImage(image, 0, 0, image.width * scale, image.height * scale);
        setHasSignature(true);
      }
      URL.revokeObjectURL(url);
    };
    image.onerror = () => { URL.revokeObjectURL(url); setError("تعذّر قراءة صورة التوقيع."); };
    image.src = url;
  };

  return <Dialog title={title} description={tool === "sign" ? "توقيع ظاهر على الصفحة، وليس توقيعاً رقمياً معتمداً." : "يُحفظ الناتج كملف جديد، ويبقى الأصل كما هو."} onClose={onClose} footer={<>
    <button onClick={busy ? cancelJob : onClose} className="plain-button">{busy ? "إيقاف" : "إلغاء"}</button>
    <button onClick={execute} disabled={busy || !availableDocs.length} className="plain-button plain-button-primary">{busy ? progressText || "جارٍ التنفيذ..." : "تنفيذ وحفظ"}</button>
  </>}>
    {error && <p role="alert" className="plain-error mb-3">{error}</p>}
    {busy && progressText && <p className="mb-3 text-[11px] text-ink-3" role="status">{progressText}</p>}
    {!availableDocs.length ? <p className="py-5 text-center text-[12px] text-ink-3">أضف ملفات PDF إلى المكتبة قبل استخدام هذه الأداة.</p> : tool === "merge" ? <>
      <label className="field-label">الملفات بالترتيب</label>
      <div className="border-y border-line">
        {mergeDocs.map((doc, index) => <div key={doc.id} className="flex items-center gap-2 border-b border-line py-2 last:border-0">
          <span className="tnum w-4 shrink-0 text-[11px] text-ink-3">{index + 1}</span><span dir="auto" className="min-w-0 flex-1 truncate text-[12px]">{doc.file}</span>
          <button onClick={() => reorder(index, -1)} disabled={index === 0} className="plain-icon" aria-label="نقل للأعلى"><ArrowUp className="h-3.5 w-3.5" /></button>
          <button onClick={() => reorder(index, 1)} disabled={index === mergeDocs.length - 1} className="plain-icon" aria-label="نقل للأسفل"><ArrowDown className="h-3.5 w-3.5" /></button>
          <button onClick={() => setMergeDocs((previous) => previous.filter((_, at) => at !== index))} className="plain-icon" aria-label="إزالة من قائمة الدمج"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>)}
      </div>
      <select defaultValue="" onChange={(event) => { const next = availableDocs.find((doc) => doc.id === event.target.value); if (next) setMergeDocs((previous) => [...previous, next]); event.target.value = ""; }} className="plain-field mt-4" aria-label="إضافة ملف إلى قائمة الدمج">
        <option value="" disabled>إضافة ملف...</option>{availableDocs.filter((doc) => !mergeDocs.some((item) => item.id === doc.id)).map((doc) => <option key={doc.id} value={doc.id}>{doc.file}</option>)}
      </select>
    </> : <div className="space-y-5">
      <div><label htmlFor="tool-source" className="field-label">المستند</label><select id="tool-source" value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="plain-field">{availableDocs.map((doc) => <option key={doc.id} value={doc.id}>{doc.file}</option>)}</select></div>
      {tool === "split" ? <div><label htmlFor="tool-pages" className="field-label">نطاق الصفحات</label><input id="tool-pages" value={range} onChange={(e) => setRange(e.target.value)} placeholder="1-3,7,10-" dir="ltr" className="plain-field" /><p className="field-help">صفحات مفردة أو نطاقات، مثل 1-3,7,10-.</p></div> : <>
        <div className="flex items-center justify-between gap-3"><label htmlFor="signature-page" className="field-label mb-0">رقم الصفحة</label><input id="signature-page" type="number" min={1} value={page} onChange={(e) => setPage(Math.max(1, Number(e.target.value) || 1))} className="plain-field w-20 text-center" /></div>
        <div><div className="mb-2 flex items-center justify-between"><label className="field-label mb-0">ارسم التوقيع</label><button onClick={clear} className="text-[11px] text-ink-3 hover:text-ink">مسح</button></div>
          <canvas ref={canvas} width={500} height={140} onPointerDown={startDrawing} onPointerMove={draw} onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }} className="w-full touch-none cursor-crosshair rounded-[3px] border border-line-2 bg-white" style={{ height: 125 }} />
          <label className="mt-3 block text-[11px] text-ink-3">أو اختر صورة PNG<input type="file" accept="image/png" onChange={(e) => importSignature(e.target.files?.[0])} className="mt-1.5 block w-full text-[11px]" /></label>
          <p className="field-help">يُضاف التوقيع إلى أسفل الصفحة من اليسار.</p>
        </div>
      </>}
    </div>}
  </Dialog>;
}