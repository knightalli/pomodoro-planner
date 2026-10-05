import { usePomodoro } from "./usePomodoro";
import { Settings, ReminderType, Task, FixedEvent, TaskPriority, formatClock, formatDuration } from "./types";
import {
  localDateStr, parseDate, timeToMinutes, minutesToTime,
  formatDayLabel, formatDateShort, freeMinutesForDate, WEEKDAYS_SHORT,
} from "./scheduler";
import { useState, useEffect } from "react";
import "./App.css";

type Tab = "timer" | "stats" | "reminders" | "planner";

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  high: "высокий",
  medium: "средний",
  low: "низкий",
};

interface TimelineItem {
  kind: "event" | "task";
  id: string;
  start: number;
  end: number;
  event: FixedEvent | null;
  task: Task | null;
}

function buildSectionRows(state: { sections: { id: string; name: string; trackedSeconds: number }[]; totalWorkSeconds: number }) {
  const trackedSum = state.sections.reduce((sum, s) => sum + s.trackedSeconds, 0);
  const untracked = state.totalWorkSeconds - trackedSum;
  const rows: { name: string; seconds: number }[] = [];
  if (untracked > 0) rows.push({ name: "Без раздела", seconds: untracked });
  state.sections.filter((s) => s.trackedSeconds > 0).forEach((s) => rows.push({ name: s.name, seconds: s.trackedSeconds }));
  if (rows.length === 0) rows.push({ name: "Без раздела", seconds: 0 });
  return rows;
}

function App() {
  const {
    state, startTracking, stopTracking, pauseTracking, resumeTracking, updateSettings,
    addSection, removeSection, selectSection,
    addReminder, removeReminder, toggleReminder, confirmReminder,
    addTask, removeTask, toggleTaskDone, startTask,
    addFixedEvent, removeFixedEvent, setDayBounds,
    setShowDailyStats, setAutoStart,
  } = usePomodoro();
  const [tab, setTab] = useState<Tab>("timer");
  const [now, setNow] = useState(Date.now());
  const [showSettings, setShowSettings] = useState(false);
  const [draftSettings, setDraftSettings] = useState<Settings>(state.settings);
  const [newReminder, setNewReminder] = useState({
    name: "",
    type: "interval" as ReminderType,
    intervalMinutes: 60,
    specificTime: "12:00",
  });
  const [sectionModal, setSectionModal] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [deleteSectionId, setDeleteSectionId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState(0);
  const [plannerDate, setPlannerDate] = useState(() => localDateStr());
  const [newTask, setNewTask] = useState<{ name: string; durationMinutes: number; priority: TaskPriority; deadline: string }>({
    name: "",
    durationMinutes: 30,
    priority: "medium",
    deadline: localDateStr(),
  });
  const [newEvent, setNewEvent] = useState<{ name: string; startTime: string; endTime: string; days: number[] }>({
    name: "",
    startTime: "09:00",
    endTime: "13:00",
    days: [1, 2, 3, 4, 5],
  });
  const [showEventForm, setShowEventForm] = useState(false);

  const isBreak = state.isOnBreak;
  const displaySeconds = isBreak ? state.breakSecondsLeft : state.workSeconds;
  const progress = isBreak
    ? 1 - state.breakSecondsLeft / (state.settings.breakDuration * 60)
    : state.workSeconds / (state.settings.breakInterval * 60);

  const handleSaveSettings = () => {
    updateSettings(draftSettings);
    setShowSettings(false);
  };

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

  const shiftPlannerDay = (delta: number) => {
    const d = parseDate(plannerDate);
    d.setDate(d.getDate() + delta);
    setPlannerDate(localDateStr(d));
  };

  const handleAddTask = () => {
    const name = newTask.name.trim();
    if (!name || newTask.durationMinutes <= 0 || !newTask.deadline) return;
    addTask({
      name,
      durationMinutes: newTask.durationMinutes,
      priority: newTask.priority,
      deadline: newTask.deadline,
    });
    setNewTask((p) => ({ ...p, name: "" }));
  };

  const handleAddEvent = () => {
    const name = newEvent.name.trim();
    if (!name || newEvent.days.length === 0 || newEvent.endTime <= newEvent.startTime) return;
    addFixedEvent({ name, startTime: newEvent.startTime, endTime: newEvent.endTime, days: [...newEvent.days] });
    setNewEvent({ name: "", startTime: "09:00", endTime: "13:00", days: [1, 2, 3, 4, 5] });
    setShowEventForm(false);
  };

  const handleShowWidget = async () => {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const existing = await WebviewWindow.getByLabel("widget");
      if (existing) {
        const isVisible = await existing.isVisible();
        if (isVisible) {
          await existing.hide();
        } else {
          await existing.show();
          await existing.setFocus();
        }
        return;
      }
      new WebviewWindow("widget", {
        url: "widget.html",
        title: "Тайм-трекер",
        width: 140,
        height: 80,
        resizable: false,
        decorations: false,
        alwaysOnTop: true,
        transparent: true,
        skipTaskbar: true,
      });
    } catch {
      // Widget window not available in browser dev
    }
  };

  const activeSection = state.sections.find((s) => s.id === state.activeSectionId);

  useEffect(() => {
    if (tab !== "reminders" && tab !== "planner") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [tab]);

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
    <main className="container">
      {/* Top nav tabs */}
      <div className="nav-tabs">
        <button className={`nav-tab ${tab === "timer" ? "active" : ""}`} onClick={() => setTab("timer")}>⏱ Таймер</button>
        <button className={`nav-tab ${tab === "planner" ? "active" : ""}`} onClick={() => setTab("planner")}>📅 План</button>
        <button className={`nav-tab ${tab === "stats" ? "active" : ""}`} onClick={() => setTab("stats")}>📊 Статистика</button>
        <button className={`nav-tab ${tab === "reminders" ? "active" : ""}`} onClick={() => setTab("reminders")}>🔔 Напоминания</button>
      </div>

      {/* Daily stats popup */}
      {state.showDailyStats && (
        <div className="daily-stats-popup">
          <h3>📊 Итоги дня</h3>
          <p>Вы отработали: <strong>{formatDuration(state.history[state.history.length - 1]?.totalWorkSeconds ?? 0)}</strong></p>
          {state.history[state.history.length - 1]?.sectionBreakdown.map((s) => (
            <p key={s.name}>{s.name}: {formatDuration(s.seconds)}</p>
          ))}
          <button className="btn-primary" onClick={() => setShowDailyStats(false)}>Отлично!</button>
        </div>
      )}

      {tab === "timer" && (
        <>
          {/* Section dropdown - above timer */}
          <div className="section-selector">
            <select
              value={state.activeSectionId ?? ""}
              onChange={(e) => selectSection(e.target.value)}
              className="section-dropdown"
            >
              <option value="">— Выберите раздел —</option>
              {[...state.sections].sort((a, b) => a.name.localeCompare(b.name)).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button className="btn-secondary btn-small" onClick={() => { setNewSectionName(""); setSectionModal(true); }}>＋</button>
            {state.activeSectionId && (
              <button className="btn-secondary btn-small btn-danger" onClick={() => setDeleteSectionId(state.activeSectionId!)}>✕</button>
            )}
          </div>

          {/* Timer */}
          <div className="timer-wrapper">
            <svg className="progress-ring" width="240" height="240">
              <circle className="progress-bg" cx="120" cy="120" r="110" fill="none" strokeWidth="6" />
              <circle
                className="progress-bar"
                cx="120" cy="120" r="110" fill="none" strokeWidth="6"
                strokeDasharray={2 * Math.PI * 110}
                strokeDashoffset={2 * Math.PI * 110 * (1 - Math.min(progress, 1))}
                strokeLinecap="round"
                transform="rotate(-90 120 120)"
              />
            </svg>
            <div className="timer-display">
              <span className="time">{formatClock(displaySeconds)}</span>
              <span className="mode-label">
                {isBreak ? "☕ Перерыв" : activeSection ? activeSection.name : "Без раздела"}
              </span>
            </div>
          </div>

          {/* Controls - main Start/Stop centered */}
          <div className="controls-main">
            {!state.isTracking && !isBreak ? (
              <button className="btn-primary" onClick={startTracking}>▶ Старт</button>
            ) : isBreak ? (
              <span className="break-info">Идёт перерыв…</span>
            ) : state.isPaused ? (
              <div className="controls-pause">
                <button className="btn-primary" onClick={resumeTracking}>▶ Продолжить</button>
                <button className="btn-primary btn-stop" onClick={stopTracking}>⏹ Стоп</button>
              </div>
            ) : (
              <div className="controls-pause">
                <button className="btn-secondary" onClick={pauseTracking}>⏸ Пауза</button>
                <button className="btn-primary btn-stop" onClick={stopTracking}>⏹ Стоп</button>
              </div>
            )}
          </div>

          {/* Secondary controls - settings and widget */}
          <div className="controls-secondary">
            <button className="btn-secondary btn-small" onClick={() => { setDraftSettings(state.settings); setShowSettings(!showSettings); }}>⚙ Настройки</button>
            <button className="btn-secondary btn-small" onClick={handleShowWidget}>📺 Виджет</button>
          </div>

        </>
      )}

      {tab === "planner" && (() => {
        const weekday = parseDate(plannerDate).getDay();
        const nowDate = new Date(now);
        const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();
        const items: TimelineItem[] = [];
        for (const e of state.fixedEvents) {
          if (!e.days.includes(weekday)) continue;
          items.push({ kind: "event", id: e.id, start: timeToMinutes(e.startTime), end: timeToMinutes(e.endTime), event: e, task: null });
        }
        for (const t of state.tasks) {
          if (t.scheduledDate !== plannerDate || !t.scheduledStart) continue;
          const start = timeToMinutes(t.scheduledStart);
          items.push({ kind: "task", id: t.id, start, end: start + t.durationMinutes, event: null, task: t });
        }
        items.sort((a, b) => a.start - b.start || a.end - b.end);
        const unscheduled = state.tasks.filter((t) => !t.done && !t.scheduledDate);
        const freeMin = freeMinutesForDate(plannerDate, state.fixedEvents, state.tasks, state.settings);
        const hasAnything = items.length > 0 || unscheduled.length > 0 || state.fixedEvents.length > 0;

        return (
          <div className="planner-section">
            <h3>📅 Ежедневник</h3>

            <div className="planner-day-bar">
              <div className="day-nav">
                <button className="day-nav-btn" onClick={() => shiftPlannerDay(-1)}>‹</button>
                <span className="day-nav-label">{formatDayLabel(plannerDate)}</span>
                <button className="day-nav-btn" onClick={() => shiftPlannerDay(1)}>›</button>
                {plannerDate !== localDateStr() && (
                  <button className="btn-secondary btn-small" onClick={() => setPlannerDate(localDateStr())}>Сегодня</button>
                )}
              </div>
              <div className="day-bounds">
                <input type="time" value={state.settings.dayStart} onChange={(e) => setDayBounds(e.target.value, state.settings.dayEnd)} />
                <span>—</span>
                <input type="time" value={state.settings.dayEnd} onChange={(e) => setDayBounds(state.settings.dayStart, e.target.value)} />
              </div>
            </div>

            {hasAnything ? (
              <div className="timeline">
                {freeMin > 0 && <div className="planner-free">Свободно: {formatDuration(freeMin * 60)}</div>}
                {items.map((item) => {
                  const isNow = item.start <= nowMin && nowMin < item.end;
                  const isPast = item.end <= nowMin;
                  if (item.kind === "event") {
                    const e = item.event!;
                    return (
                      <div key={`e-${item.id}`} className={`timeline-item event ${isNow ? "now" : ""} ${isPast ? "past" : ""}`}>
                        <span className="tl-time">{e.startTime}–{e.endTime}</span>
                        <div className="tl-body">
                          <span className="tl-name">{e.name}</span>
                          <span className="tl-badge">фикс</span>
                        </div>
                      </div>
                    );
                  }
                  const t = item.task!;
                  const progress = Math.min(1, t.trackedSeconds / (t.durationMinutes * 60));
                  return (
                    <div key={`t-${item.id}`} className={`timeline-item task prio-${t.priority} ${t.done ? "done" : ""} ${isNow ? "now" : ""} ${isPast && !t.done ? "past" : ""}`}>
                      <span className="tl-time">{t.scheduledStart}–{minutesToTime(item.end)}</span>
                      <div className="tl-body">
                        <div className="tl-title">
                          <span className="tl-name">{t.name}</span>
                          <span className={`tl-prio prio-${t.priority}`}>{PRIORITY_LABEL[t.priority]}</span>
                        </div>
                        <div className="tl-meta">
                          <span>{formatDuration(t.trackedSeconds)} / {formatDuration(t.durationMinutes * 60)}</span>
                          {t.deadline !== plannerDate && <span className="tl-deadline">до {formatDateShort(t.deadline)}</span>}
                        </div>
                        {!t.done && (
                          <div className="tl-progress"><div className="tl-progress-fill" style={{ width: `${progress * 100}%` }} /></div>
                        )}
                      </div>
                      <div className="tl-actions">
                        {!t.done && <button className="tl-btn start" title="Трекать задачу" onClick={() => startTask(t.id)}>▶</button>}
                        <button className="tl-btn ok" title={t.done ? "Вернуть в работу" : "Выполнено"} onClick={() => toggleTaskDone(t.id)}>{t.done ? "↺" : "✓"}</button>
                        <button className="tl-btn remove" title="Удалить" onClick={() => removeTask(t.id)}>✕</button>
                      </div>
                    </div>
                  );
                })}
                {items.length === 0 && <p className="tasks-empty">На этот день задач нет.</p>}
              </div>
            ) : (
              <p className="planner-empty">План пуст. Добавьте фиксированные дела и задачи — приложение само расставит их по свободному времени.</p>
            )}

            {unscheduled.length > 0 && (
              <div className="unscheduled">
                <div className="unscheduled-title">⚠ Не хватает свободного времени до дедлайна</div>
                {unscheduled.map((t) => (
                  <div key={t.id} className="unscheduled-item">
                    <div className="tl-body">
                      <div className="tl-title"><span className="tl-name">{t.name}</span></div>
                      <div className="tl-meta">
                        <span>{formatDuration(t.durationMinutes * 60)}</span>
                        <span className={`tl-deadline ${t.deadline < localDateStr() ? "overdue" : ""}`}>до {formatDateShort(t.deadline)}</span>
                      </div>
                    </div>
                    <div className="tl-actions">
                      <button className="tl-btn ok" title="Выполнено" onClick={() => toggleTaskDone(t.id)}>✓</button>
                      <button className="tl-btn remove" title="Удалить" onClick={() => removeTask(t.id)}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="task-add-card">
              <h4>➕ Новая задача</h4>
              <input
                type="text"
                className="task-name-input"
                placeholder="Что нужно сделать?"
                value={newTask.name}
                onChange={(e) => setNewTask({ ...newTask, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddTask(); }}
              />
              <div className="task-add-row">
                <input
                  type="number" min={5} step={5}
                  title="Длительность, минут"
                  value={newTask.durationMinutes}
                  onChange={(e) => setNewTask({ ...newTask, durationMinutes: Number(e.target.value) })}
                />
                <select
                  value={newTask.priority}
                  onChange={(e) => setNewTask({ ...newTask, priority: e.target.value as TaskPriority })}
                >
                  <option value="high">Высокий приоритет</option>
                  <option value="medium">Средний приоритет</option>
                  <option value="low">Низкий приоритет</option>
                </select>
                <input
                  type="date"
                  title="Дедлайн"
                  value={newTask.deadline}
                  onChange={(e) => setNewTask({ ...newTask, deadline: e.target.value })}
                />
                <button className="btn-primary btn-small" onClick={handleAddTask}>＋</button>
              </div>
              <p className="planner-hint">
                Задачи расставляются автоматически: раньше дедлайн и выше приоритет — раньше слот.
                Кнопка ▶ запускает таймер по задаче, выполненные отмечаются сами.
              </p>
            </div>

            <div className="fixed-events-card">
              <div className="fixed-events-header">
                <h4>📌 Фиксированные дела</h4>
                <button className="btn-secondary btn-small" onClick={() => setShowEventForm(!showEventForm)}>{showEventForm ? "—" : "＋"}</button>
              </div>
              {state.fixedEvents.length === 0 && (
                <p className="tasks-empty">Пусто. Добавьте работу, пары и другие дела с постоянным временем.</p>
              )}
              {state.fixedEvents.map((e) => (
                <div key={e.id} className="fixed-event-item">
                  <div className="fe-info">
                    <span className="tl-name">{e.name}</span>
                    <span className="fe-days">{e.days.slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WEEKDAYS_SHORT[d]).join(" ")}</span>
                  </div>
                  <span className="fe-time">{e.startTime}–{e.endTime}</span>
                  <button className="task-remove" onClick={() => removeFixedEvent(e.id)}>✕</button>
                </div>
              ))}
              {showEventForm && (
                <div className="event-add">
                  <input
                    type="text"
                    placeholder="Например: Работа"
                    value={newEvent.name}
                    onChange={(e) => setNewEvent({ ...newEvent, name: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAddEvent(); }}
                  />
                  <div className="event-add-row">
                    <input type="time" value={newEvent.startTime} onChange={(e) => setNewEvent({ ...newEvent, startTime: e.target.value })} />
                    <span className="fe-dash">—</span>
                    <input type="time" value={newEvent.endTime} onChange={(e) => setNewEvent({ ...newEvent, endTime: e.target.value })} />
                  </div>
                  <div className="weekday-chips">
                    {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                      <button
                        key={d}
                        className={`chip ${newEvent.days.includes(d) ? "on" : ""}`}
                        onClick={() => setNewEvent((p) => ({
                          ...p,
                          days: p.days.includes(d) ? p.days.filter((x) => x !== d) : [...p.days, d],
                        }))}
                      >{WEEKDAYS_SHORT[d]}</button>
                    ))}
                  </div>
                  <button className="btn-primary btn-small" onClick={handleAddEvent}>Добавить</button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {tab === "stats" && (
        <div className="stats-section">
          <h3>📊 Статистика</h3>

          {(() => {
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
              return <p className="stats-empty">Статистика пока пуста.</p>;
            }

            return (
              <>
                <select
                  className="day-selector-dropdown"
                  value={selectedDay}
                  onChange={(e) => setSelectedDay(Number(e.target.value))}
                >
                  {allDays.map((day, i) => (
                    <option key={i} value={i}>{day.date}</option>
                  ))}
                </select>
                {allDays[selectedDay] && (() => {
                  const day = allDays[selectedDay];
                  const sections = day.sectionBreakdown ?? [];
                  const reminders = day.reminderBreakdown ?? [];
                  const hasSections = sections.some((s) => s.seconds > 0);
                  const hasReminders = reminders.some((r) => r.done > 0 || r.missed > 0);
                  return (
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
                  );
                })()}
              </>
            );
          })()}
        </div>
      )}

      {tab === "reminders" && (
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
              <input
                type="time"
                value={newReminder.specificTime}
                onChange={(e) => setNewReminder({ ...newReminder, specificTime: e.target.value })}
              />
            )}
            <button className="btn-secondary" onClick={handleAddReminder}>＋</button>
          </div>
        </div>
      )}

      {/* Section name modal */}
      {sectionModal && (
        <div className="modal-overlay" onClick={() => setSectionModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Новый раздел</h3>
            <input
              type="text"
              autoFocus
              placeholder="Название раздела"
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const name = newSectionName.trim();
                  if (name) addSection(name);
                  setSectionModal(false);
                }
                if (e.key === "Escape") setSectionModal(false);
              }}
            />
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setSectionModal(false)}>Отмена</button>
              <button className="btn-primary" onClick={() => {
                const name = newSectionName.trim();
                if (name) addSection(name);
                setSectionModal(false);
              }}>Добавить</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete section confirmation modal */}
      {deleteSectionId && (
        <div className="modal-overlay" onClick={() => setDeleteSectionId(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Удалить раздел?</h3>
            <p className="modal-text">Вы точно хотите удалить раздел «{state.sections.find((s) => s.id === deleteSectionId)?.name}»?</p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setDeleteSectionId(null)}>Отмена</button>
              <button className="btn-primary btn-stop" onClick={() => { removeSection(deleteSectionId); setDeleteSectionId(null); }}>Удалить</button>
            </div>
          </div>
        </div>
      )}

      {/* Settings panel */}
      {showSettings && (
        <div className="settings-panel">
          <h3>Настройки</h3>
          <label>
            Интервал до перерыва (мин):
            <input type="number" min={1} max={120} value={draftSettings.breakInterval}
              onChange={(e) => setDraftSettings({ ...draftSettings, breakInterval: Number(e.target.value) })} />
          </label>
          <label>
            Длительность перерыва (мин):
            <input type="number" min={1} max={60} value={draftSettings.breakDuration}
              onChange={(e) => setDraftSettings({ ...draftSettings, breakDuration: Number(e.target.value) })} />
          </label>
          <label>
            Сброс статистики в:
            <input type="time" value={draftSettings.resetTime}
              onChange={(e) => setDraftSettings({ ...draftSettings, resetTime: e.target.value })} />
          </label>
          <label>
            Начало дня (план):
            <input type="time" value={draftSettings.dayStart}
              onChange={(e) => setDraftSettings({ ...draftSettings, dayStart: e.target.value })} />
          </label>
          <label>
            Конец дня (план):
            <input type="time" value={draftSettings.dayEnd}
              onChange={(e) => setDraftSettings({ ...draftSettings, dayEnd: e.target.value })} />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={state.autoStartEnabled}
              onChange={(e) => setAutoStart(e.target.checked)} />
            Автозапуск при включении ПК
          </label>
          <button className="btn-primary" onClick={handleSaveSettings}>Сохранить</button>
        </div>
      )}
    </main>
  );
}

export default App;
