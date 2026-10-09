import { DEFAULT_SETTINGS, DayStats, FixedEvent, Reminder, Section, Settings, Task } from "./types";
import { localDateStr } from "./scheduler";

// Единая точка правды о persisted-состоянии: ключ, схема, мягкие миграции.
// Импортируется и главным окном (usePomodoro), и виджетом — чтобы копии не
// расходились. При добавлении новых полей в модель — добавляйте дефолт в
// loadStored.

export const STORAGE_KEY = "pomodoro-state";

export interface StoredState {
  totalWorkSeconds: number;
  settings: Settings;
  sections: Section[];
  activeSectionId: string | null;
  isTracking: boolean;
  isPaused: boolean;
  isOnBreak: boolean;
  workSeconds: number;
  workStartedAt: number | null; // timestamp-якорь текущего рабочего сегмента
  breakSecondsLeft: number;
  breakEndsAt: number | null; // timestamp конца перерыва
  nextBreakThreshold: number;
  reminders: Reminder[];
  tasks: Task[];
  fixedEvents: FixedEvent[];
  history: DayStats[];
  lastResetDate: string;
}

export function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function todayStr(): string {
  return localDateStr();
}

export function defaultStored(): StoredState {
  return {
    totalWorkSeconds: 0,
    settings: { ...DEFAULT_SETTINGS },
    sections: [],
    activeSectionId: null,
    isTracking: false,
    isPaused: false,
    isOnBreak: false,
    workSeconds: 0,
    workStartedAt: null,
    breakSecondsLeft: DEFAULT_SETTINGS.breakDuration * 60,
    breakEndsAt: null,
    nextBreakThreshold: DEFAULT_SETTINGS.breakInterval * 60,
    reminders: [],
    tasks: [],
    fixedEvents: [],
    history: [],
    lastResetDate: todayStr(),
  };
}

export function clampSettings(s: Settings): Settings {
  // breakInterval <= 0 ломает планировщик (occupiedMinutes → ∞), клампим на входе
  return {
    ...s,
    breakInterval: Math.max(1, s.breakInterval || DEFAULT_SETTINGS.breakInterval),
    breakDuration: Math.max(1, s.breakDuration || DEFAULT_SETTINGS.breakDuration),
  };
}

export function shouldReset(lastResetDate: string, resetTime: string): boolean {
  const today = todayStr();
  if (lastResetDate === today) return false;
  const now = new Date();
  const [rh, rm] = resetTime.split(":").map(Number);
  const resetToday = new Date(now);
  resetToday.setHours(rh, rm, 0, 0);
  const last = new Date(lastResetDate + "T00:00:00");
  return now >= resetToday && last < resetToday;
}

export function loadStored(): StoredState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    const settings = clampSettings({ ...DEFAULT_SETTINGS, ...parsed.settings });
    return {
      totalWorkSeconds: parsed.totalWorkSeconds ?? 0,
      settings,
      sections: parsed.sections ?? [],
      activeSectionId: parsed.activeSectionId ?? null,
      isTracking: parsed.isTracking ?? false,
      isPaused: parsed.isPaused ?? false,
      isOnBreak: parsed.isOnBreak ?? false,
      workSeconds: parsed.workSeconds ?? 0,
      workStartedAt: parsed.workStartedAt ?? null,
      breakSecondsLeft: parsed.breakSecondsLeft ?? settings.breakDuration * 60,
      breakEndsAt: parsed.breakEndsAt ?? null,
      nextBreakThreshold: parsed.nextBreakThreshold ?? settings.breakInterval * 60,
      reminders: (parsed.reminders ?? []).map((r) => ({
        ...r,
        repeatCount: r.repeatCount ?? 0,
        missedCount: r.missedCount ?? 0,
        doneCount: r.doneCount ?? 0,
      })),
      history: parsed.history ?? [],
      tasks: (parsed.tasks ?? []).map((t: Task) => ({
        ...t,
        scheduledDate: t.scheduledDate ?? null,
        scheduledStart: t.scheduledStart ?? null,
        scheduledEnd: t.scheduledEnd ?? null,
        trackedSeconds: t.trackedSeconds ?? 0,
        sectionId: t.sectionId ?? null,
        startNotified: t.startNotified ?? false,
        createdAt: t.createdAt ?? Date.now(),
      })),
      fixedEvents: parsed.fixedEvents ?? [],
      lastResetDate: parsed.lastResetDate ?? todayStr(),
    };
  } catch {
    return null;
  }
}

export function saveStored(state: StoredState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}
