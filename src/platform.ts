// Мост к десктопной оболочке pywebview (Python) — window.pywebview.api.
// В обычном браузере: уведомления → Web Notification API, остальное — тихий no-op.

interface PyApi {
  notify(title: string, body: string): Promise<unknown>;
  toggle_widget(): Promise<unknown>;
  show_main(): Promise<unknown>;
  set_autostart(enabled: boolean): Promise<unknown>;
  is_autostart(): Promise<boolean>;
}

declare global {
  interface Window {
    pywebview?: { api?: PyApi };
  }
}

let readyPromise: Promise<void> | null = null;

// pywebview инжектит api после загрузки DOM — ждём событие (макс 2 с)
function waitForPy(): Promise<void> {
  readyPromise ??= new Promise((resolve) => {
    const done = () => {
      window.removeEventListener("pywebviewready", done);
      resolve();
    };
    window.addEventListener("pywebviewready", done);
    setTimeout(done, 2000);
  });
  return readyPromise;
}

async function getPyApi(): Promise<PyApi | null> {
  if (window.pywebview?.api) return window.pywebview.api;
  await waitForPy();
  return window.pywebview?.api ?? null;
}

export async function osNotify(title: string, body: string) {
  const api = await getPyApi();
  if (api) return api.notify(title, body);
  if (typeof Notification !== "undefined") {
    let granted = Notification.permission === "granted";
    if (!granted && Notification.permission === "default")
      granted = (await Notification.requestPermission()) === "granted";
    if (granted) new Notification(title, { body });
  }
}

export async function toggleWidgetWindow() {
  (await getPyApi())?.toggle_widget();
}

export async function showMainWindow() {
  (await getPyApi())?.show_main();
}

export async function autostartSet(enabled: boolean) {
  return (await getPyApi())?.set_autostart(enabled);
}

export async function autostartIsEnabled(): Promise<boolean> {
  return (await getPyApi())?.is_autostart() ?? false;
}
