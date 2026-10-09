import { useState } from "react";
import { PomodoroApi } from "../usePomodoro";
import { formatDuration } from "../types";

function buildSectionRows(state: { sections: { id: string; name: string; trackedSeconds: number }[]; totalWorkSeconds: number }) {
  const trackedSum = state.sections.reduce((sum, s) => sum + s.trackedSeconds, 0);
  const untracked = state.totalWorkSeconds - trackedSum;
  const rows: { name: string; seconds: number }[] = [];
  if (untracked > 0) rows.push({ name: "Без раздела", seconds: untracked });
  state.sections.filter((s) => s.trackedSeconds > 0).forEach((s) => rows.push({ name: s.name, seconds: s.trackedSeconds }));
  if (rows.length === 0) rows.push({ name: "Без раздела", seconds: 0 });
  return rows;
}

export function StatsTab({ pomo }: { pomo: PomodoroApi }) {
  const { state } = pomo;
  // Выбранный день хранится датой, а не индексом — при добавлении записи в
  // историю индексы съезжают, дата нет
  const [selectedDate, setSelectedDate] = useState<string>("Сегодня");

  const todayRows = buildSectionRows(state);
  const todayReminderBreakdown = state.reminders
    .filter((r) => r.enabled)
    .map((r) => ({ name: r.name, done: r.doneCount ?? 0, missed: r.missedCount ?? 0 }));
  const todayEntry = {
    date: "Сегодня",
    totalWorkSeconds: state.totalWorkSeconds,
    sectionBreakdown: todayRows,
    reminderBreakdown: todayReminderBreakdown,
  };
  const allDays = [todayEntry, ...state.history.slice().reverse()];

  if (state.totalWorkSeconds === 0 && state.history.length === 0 && todayReminderBreakdown.every((r) => r.done === 0 && r.missed === 0)) {
    return (
      <div className="stats-section">
        <h3>📊 Статистика</h3>
        <p className="stats-empty">Статистика пока пуста.</p>
      </div>
    );
  }

  const day = allDays.find((d) => d.date === selectedDate) ?? allDays[0];
  const sections = day.sectionBreakdown ?? [];
  const reminders = day.reminderBreakdown ?? [];
  const hasSections = sections.some((s) => s.seconds > 0);
  const hasReminders = reminders.some((r) => r.done > 0 || r.missed > 0);

  return (
    <div className="stats-section">
      <h3>📊 Статистика</h3>
      <select
        className="day-selector-dropdown"
        value={day.date}
        onChange={(e) => setSelectedDate(e.target.value)}
      >
        {allDays.map((d, i) => (
          <option key={i} value={d.date}>{d.date}</option>
        ))}
      </select>
      <div className="stats-card">
        <div className="stat-day-header">
          <span className="stat-day-date">{day.date}</span>
          <span className="stat-day-total">{formatDuration(day.totalWorkSeconds)}</span>
        </div>
        {hasSections && (
          <div className="stat-day-breakdown">
            {sections.filter((s) => s.seconds > 0).map((s) => (
              <div key={s.name} className="stat-row">
                <span>{s.name}</span>
                <span className="stat-row-count">{formatDuration(s.seconds)}</span>
              </div>
            ))}
          </div>
        )}
        {hasReminders && (
          <div className="stat-day-reminders">
            {reminders.filter((r) => r.done > 0 || r.missed > 0).map((r) => (
              <div key={r.name} className="stat-row">
                <span>{r.name}</span>
                <span className="stat-row-count">
                  <span className="stat-done">{r.done}</span>
                  <span className="stat-sep"> - </span>
                  <span className="stat-missed">{r.missed}</span>
                </span>
              </div>
            ))}
          </div>
        )}
        {!hasSections && !hasReminders && day.totalWorkSeconds === 0 && (
          <p className="stats-empty">Нет данных за этот день.</p>
        )}
      </div>
    </div>
  );
}
