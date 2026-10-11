import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Alif render error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper px-6 text-center text-ink" dir="rtl">
        <h1 className="text-[20px] font-semibold text-ink">تعذّر عرض أليف</h1>
        <p className="max-w-lg text-sm text-ink-2">ظهر خطأ أثناء تشغيل الواجهة. يمكنك إعادة المحاولة أو نسخ رسالة الخطأ وإرسالها للدعم.</p>
        <pre dir="ltr" className="max-w-full overflow-auto rounded border border-line bg-panel p-3 text-xs text-brick">
          {this.state.error.message}
        </pre>
        <button onClick={() => window.location.reload()} className="plain-button plain-button-primary">
          إعادة المحاولة
        </button>
      </main>
    );
  }
}