import { FixedEvent, Settings, Task, TaskPriority } from "./types";

// Чистый планировщик: раскладывает задачи по свободным слотам дня.
// Время — в минутах от полуночи, даты — "YYYY-MM-DD" (локальные).

export interface Interval {
  start: number;
  end: number;
}

export const WEEKDAYS_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

const MONTHS_GEN = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minutesToTime(min: number): string {
  const m = Math.max(0, Math.min(23 * 60 + 59, Math.round(min)));
  return `${Math.floor(m / 60).toString().padStart(2, "0")}:${(m % 60).toString().padStart(2, "0")}`;
}

export function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
}

export function parseDate(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00");
}

export function addDays(dateStr: string, delta: number): string {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + delta);
  return localDateStr(d);
}

export function formatDayLabel(dateStr: string): string {
  const today = localDateStr();
  if (dateStr === today) return "Сегодня";
  if (dateStr === addDays(today, 1)) return "Завтра";
  if (dateStr === addDays(today, -1)) return "Вчера";
  const d = parseDate(dateStr);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}, ${WEEKDAYS_SHORT[d.getDay()].toLowerCase()}`;
}

export function formatDateShort(dateStr: string): string {
  const d = parseDate(dateStr);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()].slice(0, 3)}`;
}

function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      out.push({ ...iv });
    }
  }
  return out;
}

// Свободные слоты внутри окна, не пересекающиеся с busy
function subtract(window: Interval, busy: Interval[]): Interval[] {
  const free: Interval[] = [];
  let cursor = window.start;
  for (const b of mergeIntervals(busy)) {
    if (b.end <= cursor || b.start >= window.end) continue;
    if (b.start > cursor) free.push({ start: cursor, end: Math.min(b.start, window.end) });
    cursor = Math.max(cursor, b.end);
    if (cursor >= window.end) break;
  }
  if (cursor < window.end) free.push({ start: cursor, end: window.end });
  return free.filter((f) => f.end > f.start);
}

export function busyForDate(dateStr: string, events: FixedEvent[]): Interval[] {
  const wd = parseDate(dateStr).getDay();
  return events
    .filter((e) => e.days.includes(wd))
    .map((e) => ({ start: timeToMinutes(e.startTime), end: timeToMinutes(e.endTime) }))
    .filter((iv) => iv.end > iv.start);
}

const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

/**
 * Пересобирает расписание: незавершённые и ещё не начатые задачи расставляются
 * заново (ASAP от начала дня, не позже дедлайна), задачи, за которыми уже шёл
 * трекинг, сохраняют свой слот и занимают время. Возвращает новый массив в том
 * же порядке; неизменённые задачи возвращаются как есть (по ссылке).
 */
export function scheduleTasks(tasks: Task[], events: FixedEvent[], settings: Settings): Task[] {
  const from = localDateStr();
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const dayStart = timeToMinutes(settings.dayStart);
  const dayEnd = timeToMinutes(settings.dayEnd);
  if (dayEnd <= dayStart) return tasks;

  // Занятое время: начатые задачи держат свой слот
  const busyByDate = new Map<string, Interval[]>();
  for (const t of tasks) {
    if (t.done || t.trackedSeconds <= 0 || !t.scheduledDate || !t.scheduledStart) continue;
    const start = timeToMinutes(t.scheduledStart);
    const list = busyByDate.get(t.scheduledDate) ?? [];
    list.push({ start, end: start + t.durationMinutes });
    busyByDate.set(t.scheduledDate, list);
  }

  const candidates = tasks
    .filter((t) => !t.done && t.trackedSeconds === 0)
    .sort((a, b) => {
      if (a.deadline !== b.deadline) return a.deadline.localeCompare(b.deadline);
      const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (p !== 0) return p;
      return a.createdAt - b.createdAt;
    });

  const assigned = new Map<string, { date: string; start: string }>();

  for (const task of candidates) {
    let placed = false;
    for (let date = from; date <= task.deadline; date = addDays(date, 1)) {
      const windowStart = date === from ? Math.max(dayStart, nowMinutes) : dayStart;
      const busy = [...busyForDate(date, events), ...(busyByDate.get(date) ?? [])];
      const free = subtract({ start: windowStart, end: dayEnd }, busy);
      const slot = free.find((f) => f.end - f.start >= task.durationMinutes);
      if (slot) {
        assigned.set(task.id, { date, start: minutesToTime(slot.start) });
        busyByDate.set(date, [...busy, { start: slot.start, end: slot.start + task.durationMinutes }]);
        placed = true;
        break;
      }
    }
    if (!placed) assigned.set(task.id, { date: "", start: "" });
  }

  return tasks.map((t) => {
    const a = assigned.get(t.id);
    if (!a) return t;
    const date = a.date || null;
    const start = a.start || null;
    if (t.scheduledDate === date && t.scheduledStart === start) return t;
    // Уведомление о старте сбрасываем только при переносе на другой день:
    // сдвиг времени внутри дня не должен дублировать уведомление.
    return { ...t, scheduledDate: date, scheduledStart: start, startNotified: t.scheduledDate === date ? t.startNotified : false };
  });
}

export function freeMinutesForDate(dateStr: string, events: FixedEvent[], tasks: Task[], settings: Settings): number {
  const dayStart = timeToMinutes(settings.dayStart);
  const dayEnd = timeToMinutes(settings.dayEnd);
  if (dayEnd <= dayStart) return 0;
  let windowStart = dayStart;
  if (dateStr === localDateStr()) {
    const n = new Date();
    windowStart = Math.max(dayStart, n.getHours() * 60 + n.getMinutes());
  }
  const busy = [...busyForDate(dateStr, events)];
  for (const t of tasks) {
    if (t.done || t.scheduledDate !== dateStr || !t.scheduledStart) continue;
    const start = timeToMinutes(t.scheduledStart);
    busy.push({ start, end: start + t.durationMinutes });
  }
  return subtract({ start: windowStart, end: dayEnd }, busy).reduce((s, f) => s + (f.end - f.start), 0);
}
