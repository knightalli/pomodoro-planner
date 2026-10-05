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

// Сколько минут занимает блок работы с учётом перерывов:
// после каждых breakInterval минут работы — перерыв, включая хвостовой
// (20 мин работы при 15/5 → 25; 15 мин → 20, перерыв встаёт между задачами).
export function occupiedMinutes(durationMinutes: number, settings: Settings): number {
  const breaks = Math.max(0, Math.floor(durationMinutes / settings.breakInterval));
  return durationMinutes + breaks * settings.breakDuration;
}

/**
 * Пересобирает расписание: незавершённые и ещё не начатые задачи расставляются
 * заново (ASAP от начала дня, не позже дедлайна), задачи, за которыми уже шёл
 * трекинг, сохраняют свой слот и занимают время. Возвращает новый массив в том
 * же порядке; неизменённые задачи возвращаются как есть (по ссылке).
 */
export function scheduleTasks(tasks: Task[], events: FixedEvent[], settings: Settings, activeTaskId: string | null = null): Task[] {
  const from = localDateStr();
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const dayStart = timeToMinutes(settings.dayStart);
  const dayEnd = timeToMinutes(settings.dayEnd);
  if (dayEnd <= dayStart) return tasks;

  // Закреплённый слот держит только активная задача (выбранная в таймере) —
  // остальные начатые, но недоделанные уходят в кандидаты на остаток и
  // «плывут» вниз. Слот в прошлом не закрепляется в любом случае.
  const busyByDate = new Map<string, Interval[]>();
  const pinned = new Set<string>();
  // Конец слота активной задачи — динамический: max(старт, сейчас) + остаток
  // работы с перерывами. На паузе блок растёт и сдвигает дела ниже.
  const pinnedInterval = (t: Task): Interval => {
    const start = timeToMinutes(t.scheduledStart!);
    const remainingMin = Math.max(1, Math.ceil(t.durationMinutes - t.trackedSeconds / 60));
    const anchor = t.scheduledDate === from ? Math.max(start, nowMinutes) : start;
    return { start, end: anchor + occupiedMinutes(remainingMin, settings) };
  };
  for (const t of tasks) {
    if (t.done || !t.scheduledDate || !t.scheduledStart || t.scheduledDate < from) continue;
    if (t.id !== activeTaskId) continue;
    pinned.add(t.id);
    busyByDate.set(t.scheduledDate, [...(busyByDate.get(t.scheduledDate) ?? []), pinnedInterval(t)]);
  }

  const candidates = tasks
    .filter((t) => !t.done && !pinned.has(t.id))
    .sort((a, b) => {
      if (a.deadline !== b.deadline) return a.deadline.localeCompare(b.deadline);
      const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (p !== 0) return p;
      return a.createdAt - b.createdAt;
    });

  const assigned = new Map<string, { date: string; start: string; end: string }>();
  // Накопительная модель перерывов: сколько минут работы прошло с последнего
  // перерыва в этом дне и где закончился предыдущий занятый блок.
  const accumByDate = new Map<string, number>();
  const lastEndByDate = new Map<string, number>();

  for (const task of candidates) {
    const workMin = Math.max(1, Math.ceil(task.durationMinutes - task.trackedSeconds / 60));
    let placed = false;
    for (let date = from; date <= task.deadline && !placed; date = addDays(date, 1)) {
      const windowStart = date === from ? Math.max(dayStart, nowMinutes) : dayStart;
      const busy = [...busyForDate(date, events), ...(busyByDate.get(date) ?? [])];
      const free = subtract({ start: windowStart, end: dayEnd }, busy);
      const accumBase = accumByDate.get(date) ?? 0;
      const lastEnd = lastEndByDate.get(date) ?? windowStart;

      for (const f of free) {
        // Свободный зазор перед слотом считаем отдыхом — цикл перерывов сбрасывается
        let accum = f.start - lastEnd >= settings.breakDuration ? 0 : accumBase;
        let p = f.start;
        let w = workMin;
        while (w > 0 && p < f.end) {
          const chunk = Math.min(settings.breakInterval - accum, w, f.end - p);
          p += chunk;
          w -= chunk;
          accum += chunk;
          if (accum >= settings.breakInterval) {
            p += settings.breakDuration;
            accum = 0;
          }
        }
        if (w <= 0 && p <= f.end) {
          assigned.set(task.id, { date, start: minutesToTime(f.start), end: minutesToTime(p) });
          busyByDate.set(date, [...busy, { start: f.start, end: p }]);
          accumByDate.set(date, accum);
          lastEndByDate.set(date, p);
          placed = true;
          break;
        }
      }
    }
    if (!placed) assigned.set(task.id, { date: "", start: "", end: "" });
  }

  return tasks.map((t) => {
    if (pinned.has(t.id)) {
      const endStr = minutesToTime(pinnedInterval(t).end);
      return t.scheduledEnd === endStr ? t : { ...t, scheduledEnd: endStr };
    }
    const a = assigned.get(t.id);
    if (!a) return t;
    const date = a.date || null;
    const start = a.start || null;
    const end = a.end || null;
    if (t.scheduledDate === date && t.scheduledStart === start && t.scheduledEnd === end) return t;
    // Уведомление о старте сбрасываем только при переносе на другой день:
    // сдвиг времени внутри дня не должен дублировать уведомление.
    return { ...t, scheduledDate: date, scheduledStart: start, scheduledEnd: end, startNotified: t.scheduledDate === date ? t.startNotified : false };
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
    const end = t.scheduledEnd ? timeToMinutes(t.scheduledEnd) : start + occupiedMinutes(t.durationMinutes, settings);
    busy.push({ start, end });
  }
  return subtract({ start: windowStart, end: dayEnd }, busy).reduce((s, f) => s + (f.end - f.start), 0);
}
