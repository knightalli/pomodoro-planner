import { useState } from "react";
import { PomodoroApi } from "../usePomodoro";
import { Task, FixedEvent, TaskPriority, formatDuration } from "../types";
import {
  localDateStr, parseDate, timeToMinutes, minutesToTime,
  formatDayLabel, formatDateShort, freeMinutesForDate, occupiedMinutes, WEEKDAYS_SHORT,
} from "../scheduler";
import { useNow } from "../useNow";
import { TimeInput } from "./TimeInput";
import { TaskProgressBar } from "./TaskProgressBar";

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

export function PlannerTab({ pomo }: { pomo: PomodoroApi }) {
  const {
    state, addTask, updateTask, removeTask, toggleTaskDone, postponeTask, startTask,
    addFixedEvent, updateFixedEvent, removeFixedEvent, setDayBounds,
  } = pomo;
  const now = useNow();
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
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  const shiftPlannerDay = (delta: number) => {
    const d = parseDate(plannerDate);
    d.setDate(d.getDate() + delta);
    setPlannerDate(localDateStr(d));
  };

  const resetTaskForm = () => {
    setNewTask((p) => ({ ...p, name: "" }));
    setEditingTaskId(null);
  };

  const handleSaveTask = () => {
    const name = newTask.name.trim();
    if (!name || newTask.durationMinutes <= 0 || !newTask.deadline) return;
    const data = { name, durationMinutes: newTask.durationMinutes, priority: newTask.priority, deadline: newTask.deadline };
    if (editingTaskId) {
      updateTask(editingTaskId, data);
      resetTaskForm();
    } else {
      addTask(data);
      setNewTask((p) => ({ ...p, name: "" }));
    }
  };

  const handleEditTask = (t: Task) => {
    setNewTask({ name: t.name, durationMinutes: t.durationMinutes, priority: t.priority, deadline: t.deadline });
    setEditingTaskId(t.id);
  };

  const resetEventForm = () => {
    setNewEvent({ name: "", startTime: "09:00", endTime: "13:00", days: [1, 2, 3, 4, 5] });
    setEditingEventId(null);
  };

  const handleSaveEvent = () => {
    const name = newEvent.name.trim();
    if (!name || newEvent.days.length === 0 || newEvent.endTime <= newEvent.startTime) return;
    const data = { name, startTime: newEvent.startTime, endTime: newEvent.endTime, days: [...newEvent.days] };
    if (editingEventId) {
      updateFixedEvent(editingEventId, data);
    } else {
      addFixedEvent(data);
    }
    resetEventForm();
    setShowEventForm(false);
  };

  const handleEditEvent = (e: FixedEvent) => {
    setNewEvent({ name: e.name, startTime: e.startTime, endTime: e.endTime, days: [...e.days] });
    setEditingEventId(e.id);
    setShowEventForm(true);
  };

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
    const end = t.scheduledEnd ? timeToMinutes(t.scheduledEnd) : start + occupiedMinutes(t.durationMinutes, state.settings);
    items.push({ kind: "task", id: t.id, start, end, event: null, task: t });
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
          <TimeInput value={state.settings.dayStart} onChange={(v) => setDayBounds(v, state.settings.dayEnd)} />
          <span>—</span>
          <TimeInput value={state.settings.dayEnd} onChange={(v) => setDayBounds(state.settings.dayStart, v)} />
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
                    {occupiedMinutes(t.durationMinutes, state.settings) > t.durationMinutes && <span className="tl-breaks">+ перерывы</span>}
                    {t.deadline !== plannerDate && <span className="tl-deadline">до {formatDateShort(t.deadline)}</span>}
                  </div>
                  {!t.done && (
                    <TaskProgressBar durationMinutes={t.durationMinutes} trackedSeconds={t.trackedSeconds} settings={state.settings} />
                  )}
                </div>
                <div className="tl-actions">
                  {!t.done && <button className="tl-btn start" title="Трекать задачу" onClick={() => startTask(t.id)}>▶</button>}
                  {!t.done && <button className="tl-btn edit" title="Редактировать" onClick={() => handleEditTask(t)}>✎</button>}
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
                <button className="tl-btn start" title="Начать сейчас" onClick={() => startTask(t.id)}>▶</button>
                <button className="tl-btn edit" title="Редактировать" onClick={() => handleEditTask(t)}>✎</button>
                <button className="tl-btn postpone" title="Перенести дедлайн на завтра" onClick={() => postponeTask(t.id)}>→ Завтра</button>
                <button className="tl-btn ok" title="Выполнено" onClick={() => toggleTaskDone(t.id)}>✓</button>
                <button className="tl-btn remove" title="Удалить" onClick={() => removeTask(t.id)}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="task-add-card">
        <h4>{editingTaskId ? "✎ Редактировать задачу" : "➕ Новая задача"}</h4>
        <input
          type="text"
          className="task-name-input"
          placeholder="Что нужно сделать?"
          value={newTask.name}
          onChange={(e) => setNewTask({ ...newTask, name: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") handleSaveTask(); }}
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
          <button className="btn-primary btn-small" onClick={handleSaveTask}>{editingTaskId ? "✓" : "＋"}</button>
          {editingTaskId && (
            <button className="btn-secondary btn-small" onClick={resetTaskForm}>Отмена</button>
          )}
        </div>
        <p className="planner-hint">
          Задачи расставляются автоматически: раньше дедлайн и выше приоритет — раньше слот.
          Кнопка ▶ запускает таймер по задаче, выполненные отмечаются сами.
        </p>
      </div>

      <div className="fixed-events-card">
        <div className="fixed-events-header">
          <h4>📌 Фиксированные дела</h4>
          <button className="btn-secondary btn-small" onClick={() => { if (!showEventForm) resetEventForm(); setShowEventForm(!showEventForm); }}>{showEventForm ? "—" : "＋"}</button>
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
            <button className="task-remove fe-edit" title="Редактировать" onClick={() => handleEditEvent(e)}>✎</button>
            <button className="task-remove" title="Удалить" onClick={() => removeFixedEvent(e.id)}>✕</button>
          </div>
        ))}
        {showEventForm && (
          <div className="event-add">
            <input
              type="text"
              placeholder="Например: Работа"
              value={newEvent.name}
              onChange={(e) => setNewEvent({ ...newEvent, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveEvent(); }}
            />
            <div className="event-add-row">
              <TimeInput value={newEvent.startTime} onChange={(v) => setNewEvent({ ...newEvent, startTime: v })} />
              <span className="fe-dash">—</span>
              <TimeInput value={newEvent.endTime} onChange={(v) => setNewEvent({ ...newEvent, endTime: v })} />
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
            <div className="event-add-actions">
              <button className="btn-primary btn-small" onClick={handleSaveEvent}>{editingEventId ? "Сохранить" : "Добавить"}</button>
              {editingEventId && (
                <button className="btn-secondary btn-small" onClick={resetEventForm}>Отмена</button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
