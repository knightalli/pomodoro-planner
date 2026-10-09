import { useEffect, useState } from "react";
import { TOAST_EVENT, AppToast } from "../notifications";

// Стек внутриприложенческих тостов: слушает TOAST_EVENT, живёт 8 секунд,
// закрывается кликом
export function Toasts() {
  const [toasts, setToasts] = useState<(AppToast & { id: number })[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const { title, body } = (e as CustomEvent<AppToast>).detail;
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, title, body }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 8000);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className="toast" onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}>
          <div className="toast-title">{t.title}</div>
          <div className="toast-body">{t.body}</div>
        </div>
      ))}
    </div>
  );
}
