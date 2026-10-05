"""Десктопная оболочка Тайм-трекера на pywebview (WebView2) — без Rust/MSVC.

Запуск:
    python app.py          — фронтенд из собранного dist/
    python app.py --dev    — фронтенд с vite dev-сервера (http://localhost:1420)

Оба окна грузятся с одного localhost-порта → общий localStorage,
виджет синхронизируется через storage-события, как и в Tauri-версии.
"""

from __future__ import annotations

import argparse
import http.server
import sys
import threading
import winreg
from pathlib import Path

import webview

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
APP_NAME = "Тайм-трекер"
REG_NAME = "TimeTracker"
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"

main_window: webview.Window | None = None
widget_window: webview.Window | None = None


class DistHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST), **kwargs)

    def log_message(self, *args):
        pass


def start_server() -> str:
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), DistHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{httpd.server_port}"


_toaster = None


def send_toast(title: str, body: str) -> None:
    global _toaster
    try:
        from windows_toasts import Toast, WindowsToaster

        if _toaster is None:
            _toaster = WindowsToaster(APP_NAME)
        toast = Toast()
        toast.text_fields = [title, body]
        _toaster.show_toast(toast)
    except Exception:
        pass


def _autostart_cmd() -> str:
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}"'
    pythonw = Path(sys.executable).with_name("pythonw.exe")
    exe = pythonw if pythonw.exists() else Path(sys.executable)
    return f'"{exe}" "{ROOT / "app.py"}"'


def is_autostart() -> bool:
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
            winreg.QueryValueEx(key, REG_NAME)
        return True
    except OSError:
        return False


def set_autostart(enabled: bool) -> None:
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
        if enabled:
            winreg.SetValueEx(key, REG_NAME, 0, winreg.REG_SZ, _autostart_cmd())
        else:
            try:
                winreg.DeleteValue(key, REG_NAME)
            except OSError:
                pass


class Api:
    """Мост JS → Python. Доступен как window.pywebview.api.*"""

    widget_visible = False

    def notify(self, title: str, body: str) -> None:
        send_toast(str(title), str(body))

    def toggle_widget(self) -> None:
        if widget_window is None:
            return
        self.widget_visible = not self.widget_visible
        (widget_window.show if self.widget_visible else widget_window.hide)()

    def show_main(self) -> None:
        if main_window is not None:
            main_window.show()
            main_window.restore()

    def set_autostart(self, enabled: bool) -> None:
        set_autostart(bool(enabled))

    def is_autostart(self) -> bool:
        return is_autostart()


def tray_image():
    from PIL import Image

    icon = ROOT / "icon.png"
    if icon.exists():
        return Image.open(icon)
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    from PIL import ImageDraw

    ImageDraw.Draw(img).ellipse((4, 4, 60, 60), fill=(74, 144, 217, 255))
    return img


def run_tray() -> None:
    import pystray

    def show(icon, item):
        if main_window is not None:
            main_window.show()
            main_window.restore()

    def quit_app(icon, item):
        for w in list(webview.windows):
            w.destroy()
        icon.stop()

    menu = pystray.Menu(
        pystray.MenuItem("Показать", show, default=True),
        pystray.MenuItem("Выход", quit_app),
    )
    pystray.Icon("timetracker", tray_image(), APP_NAME, menu).run()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dev", action="store_true", help="vite dev-сервер на :1420")
    args = parser.parse_args()

    if args.dev:
        base = "http://localhost:1420"
    elif (DIST / "index.html").exists():
        base = start_server()
    else:
        sys.exit("dist/ не собран. Сначала: npm run build")

    global main_window, widget_window
    api = Api()
    main_window = webview.create_window(
        APP_NAME, f"{base}/index.html",
        js_api=api, width=560, height=720, min_size=(460, 600),
    )
    widget_window = webview.create_window(
        APP_NAME, f"{base}/widget.html",
        js_api=api, width=160, height=96, resizable=False,
        frameless=True, on_top=True, transparent=True, hidden=True,
    )

    def hide_main():
        main_window.hide()
        return False

    def hide_widget():
        api.widget_visible = False
        widget_window.hide()
        return False

    main_window.events.closing += hide_main
    widget_window.events.closing += hide_widget

    threading.Thread(target=run_tray, daemon=True).start()
    webview.start()


if __name__ == "__main__":
    main()
