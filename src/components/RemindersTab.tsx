import { useState } from "react";
import { PomodoroApi } from "../usePomodoro";
import { ReminderType, formatClock } from "../types";
import { useNow } from "../useNow";
import { TimeInput } from "./TimeInput";

export function RemindersTab({ pomo }: { pomo: PomodoroApi }) {
  const { state, addReminder, removeReminder, toggleReminder, confirmReminder } = pomo;
  const now = useNow();
  const [newReminder, setNewReminder] = useState({
    name: "",
    type: "interval" as ReminderType,
    intervalMinutes: 60,
    specificTime: "12:00",
  });

  const handleAddReminder = () => {
    const name = newReminder.name.trim();
    if (!name) return;
    addReminder({
      name,
      type: newReminder.type,
      intervalMinutes: newReminder.intervalMinutes,
      specificTime: newReminder.specificTime,
      enabled: true,
    });
    setNewReminder({ name: "", type: "interval", intervalMinutes: 60, specificTime: "12:00" });
  };

  function getReminderCountdown(r: typeof state.reminders[number]): { seconds: number; isRed: boolean } | null {
    if (!r.enabled || r.lastFired === null) return null;
    if (r.pending) {
      const remaining = Math.ceil((r.lastFired + 60 * 1000 - now) / 1000);
      return { seconds: Math.max(0, remaining), isRed: true };
    }
    if (r.type === "interval") {
      const remaining = Math.ceil((r.lastFired + r.intervalMinutes * 60 * 1000 - now) / 1000);
      return { seconds: Math.max(0, remaining), isRed: false };
    } else {
      const [h, m] = r.specificTime.split(":").map(Number);
      const target = new Date();
      target.setHours(h, m, 0, 0);
      if (target.getTime() <= now) target.setDate(target.getDate() + 1);
      const remaining = Math.ceil((target.getTime() - now) / 1000);
      return { seconds: Math.max(0, remaining), isRed: false };
    }
  }

  return (
    <div className="reminders-section">
      <h3>🔔 Напоминания</h3>

      {state.reminders.some((r) => r.pending) && (
        <div className="pending-reminders">
          {state.reminders.filter((r) => r.pending).map((r) => {
            const cd = getReminderCountdown(r);
            return (
              <div key={r.id} className="pending-reminder">
                <div className="pending-reminder-info">
                  <span>⏰ {r.name}</span>
                  {cd && (
                    <span className={`reminder-countdown ${cd.isRed ? "red" : "blue"}`}>
                      Повтор через {formatClock(cd.seconds)}
                    </span>
                  )}
                </div>
                <button className="btn-primary" onClick={() => confirmReminder(r.id)}>✓ Подтвердить</button>
              </div>
            );
          })}
        </div>
      )}

      <div className="reminders-list">
        {state.reminders.length === 0 && (
          <span className="tasks-empty">Нет напоминаний. Добавьте ниже.</span>
        )}
        {state.reminders.map((r) => {
          const cd = getReminderCountdown(r);
          return (
            <div key={r.id} className={`reminder-item ${r.enabled ? "enabled" : "disabled"}`}>
              <div className="reminder-item-row">
                <label className="checkbox-label">
                  <input type="checkbox" checked={r.enabled} onChange={() => toggleReminder(r.id)} />
                  <span className="reminder-name">{r.name}</span>
                </label>
                <button className="task-remove" onClick={() => removeReminder(r.id)}>✕</button>
              </div>
              <div className="reminder-item-row">
                <span className="reminder-schedule">
                  {r.type === "interval" ? `каждые ${r.intervalMinutes} мин` : `в ${r.specificTime}`}
                </span>
                {cd && (
                  <span className={`reminder-countdown ${cd.isRed ? "red" : "blue"}`}>
                    {cd.isRed ? `Повтор: ${formatClock(cd.seconds)}` : `Через: ${formatClock(cd.seconds)}`}
                  </span>
                )}
                {r.missedCount > 0 && (
                  <span className="reminder-missed">Пропущено: {r.missedCount}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="reminder-add">
        <input
          type="text"
          placeholder="Например: Попить воды"
          value={newReminder.name}
          onChange={(e) => setNewReminder({ ...newReminder, name: e.target.value })}
        />
        <select
          value={newReminder.type}
          onChange={(e) => setNewReminder({ ...newReminder, type: e.target.value as ReminderType })}
        >
          <option value="interval">Каждые N минут</option>
          <option value="specific">В определённое время</option>
        </select>
        {newReminder.type === "interval" ? (
          <input
            type="number" min={1} max={1440}
            value={newReminder.intervalMinutes}
            onChange={(e) => setNewReminder({ ...newReminder, intervalMinutes: Number(e.target.value) })}
            placeholder="мин"
          />
        ) : (
          <TimeInput
            value={newReminder.specificTime}
            onChange={(v) => setNewReminder({ ...newReminder, specificTime: v })}
          />
        )}
        <button className="btn-secondary" onClick={handleAddReminder}>＋</button>
      </div>
    </div>
  );
}
