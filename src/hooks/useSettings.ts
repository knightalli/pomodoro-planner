import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, Settings } from "../types";
import { autostartIsEnabled, autostartSet } from "../platform";

// Настройки приложения + автозапуск (platform-мост). updateSettings живёт в
// usePomodoro — она кросс-доменная (дёргает и setSettings, и таймер).
export function useSettings(initial?: Settings) {
  const [settings, setSettings] = useState<Settings>(initial ?? DEFAULT_SETTINGS);
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const setDayBounds = useCallback((dayStart: string, dayEnd: string) => {
    setSettings((prev) => ({ ...prev, dayStart, dayEnd }));
  }, []);

  const setAutoStart = useCallback(async (enabled: boolean) => {
    try {
      await autostartSet(enabled);
      setAutoStartEnabled(enabled);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    autostartIsEnabled().then((e) => setAutoStartEnabled(e)).catch(() => {});
  }, []);

  return { settings, setSettings, settingsRef, setDayBounds, autoStartEnabled, setAutoStart };
}
