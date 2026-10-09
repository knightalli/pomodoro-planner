import { useState } from "react";
import { PomodoroApi } from "../usePomodoro";
import { Settings } from "../types";
import { notifyTaskStart } from "../notifications";
import { TimeInput } from "./TimeInput";

// Модалка настроек; draft живёт внутри — при открытии монтируется заново
export function SettingsPanel({ pomo, onClose }: { pomo: PomodoroApi; onClose: () => void }) {
  const { state, updateSettings, setAutoStart } = pomo;
  const [draft, setDraft] = useState<Settings>(state.settings);

  const save = () => {
    updateSettings(draft);
    onClose();
  };

  return (
    <div className="settings-panel">
      <h3>Настройки</h3>
      <label>
        Интервал до перерыва (мин):
        <input type="number" min={1} max={120} value={draft.breakInterval}
          onChange={(e) => setDraft({ ...draft, breakInterval: Number(e.target.value) })} />
      </label>
      <label>
        Длительность перерыва (мин):
        <input type="number" min={1} max={60} value={draft.breakDuration}
          onChange={(e) => setDraft({ ...draft, breakDuration: Number(e.target.value) })} />
      </label>
      <label>
        Сброс статистики в:
        <TimeInput value={draft.resetTime}
          onChange={(v) => setDraft({ ...draft, resetTime: v })} />
      </label>
      <label>
        Начало дня (план):
        <TimeInput value={draft.dayStart}
          onChange={(v) => setDraft({ ...draft, dayStart: v })} />
      </label>
      <label>
        Конец дня (план):
        <TimeInput value={draft.dayEnd}
          onChange={(v) => setDraft({ ...draft, dayEnd: v })} />
      </label>
      <label className="checkbox-label">
        <input type="checkbox" checked={state.autoStartEnabled}
          onChange={(e) => setAutoStart(e.target.checked)} />
        Автозапуск при включении ПК
      </label>
      <button className="btn-secondary" onClick={() => notifyTaskStart("Тестовое уведомление")}>
        Проверить уведомление
      </button>
      <button className="btn-primary" onClick={save}>Сохранить</button>
    </div>
  );
}
