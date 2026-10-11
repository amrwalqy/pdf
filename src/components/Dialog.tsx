import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** A shared, plain modal shell. Focus stays in the active dialog. */
export function Dialog({ title, description, children, footer, onClose }: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}) {
  const headingId = useId();
  const dialog = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      const field = dialog.current?.querySelector<HTMLElement>('input:not([type="range"]):not([type="checkbox"]), textarea, select');
      (field ?? dialog.current)?.focus();
    });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const nodes = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'));
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", keydown, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", keydown, true);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);

  return createPortal(<div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} className="plain-dialog" role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1} dir="rtl">
      <header className="dialog-heading">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="text-[15px] font-semibold text-ink">{title}</h2>
          {description && <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">{description}</p>}
        </div>
        <button onClick={onClose} className="plain-icon" aria-label="إغلاق"><X className="h-4 w-4" /></button>
      </header>
      <div className="dialog-body scroll-cab">{children}</div>
      {footer && <footer className="dialog-footer">{footer}</footer>}
    </div>
  </div>, document.body);
}