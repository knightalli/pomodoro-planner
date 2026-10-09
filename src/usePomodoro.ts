import { useCallback, useEffect, useMemo, useState } from "react";
import { Settings, Section, Reminder, DayStats, Task, FixedEvent } from "./types";
import { STORAGE_KEY, clampSettings, loadStored, saveStored, shouldReset, todayStr } from "./storage";
import { useSettings } from "./hooks/useSettings";
import { useTimer } from "./hooks/useTimer";
import { usePlanner } from "./hooks/usePlanner";
import { useReminders } from "./hooks/useReminders";

interface TrackerState {
  isTracking: boolean;
  isPaused: boolean;
  isOnBreak: boolean;
  workSeconds: number;
  workStartedAt: number | null;
  breakSecondsLeft: number;
  breakEndsAt: number | null;
  nextBreakThreshold: number;
  totalWorkSeconds: number;
  settings: Settings;
  sections: Section[];
  activeSectionId: string | null;
  reminders: Reminder[];
  tasks: Task[];
  fixedEvents: FixedEvent[];
  history: DayStats[];
  lastResetDate: string;
  showDailyStats: boolean;
  autoStartEnabled: boolean;
}

// Композиция доменных хуков. Здесь живёт только то, что пересекает домены:
// загрузка/сохранение в localStorage, daily reset, статистика дня и связки
// вида «startTask = подготовить задачу + запустить таймер».
export function usePomodoro() {
  const stored = useMemo(() => loadStored(), []);
  const { settings, setSettings, settingsRef, setDayBounds, autoStartEnabled, setAutoStart } = useSettings(stored?.settings);
  const { reminders, setReminders, addReminder, removeReminder, toggleReminder, confirmReminder } = useReminders(stored?.reminders);
  const planner = usePlanner({ stored, settings, settingsRef });
  const { tasks, setTasks, sections, setSections, activeSectionId, fixedEvents, accrueWork } = planner;

  // Статистика дня и сессионные поля — домена нет, живут здесь
  const [totalWorkSeconds, setTotalWorkSeconds] = useState(stored?.totalWorkSeconds ?? 0);
  const [history, setHistory] = useState<DayStats[]>(stored?.history ?? []);
  const [lastResetDate, setLastResetDate] = useState<string>(stored?.lastResetDate ?? todayStr());
  const [showDailyStats, setShowDailyStats] = useState(false);

  const handleWorkElapsed = useCallback((dt: number) => {
    setTotalWorkSeconds((t) => t + dt);
    accrueWork(dt);
  }, [accrueWork]);

  const timer = useTimer({ stored, settingsRef, onWorkElapsed: handleWorkElapsed });
  const {
    isTracking, isPaused, isOnBreak,
    workSeconds, workStartedAt, breakSecondsLeft, breakEndsAt, nextBreakThreshold,
    startTracking, stopTracking, pauseTracking, resumeTracking,
    applySettings, syncFromStorage,
  } = timer;

  // Sync state from localStorage (другое окно/внешняя запись)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const s = loadStored();
      if (!s) return;
      syncFromStorage(s);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [syncFromStorage]);

  // One-time cleanup: remove duplicate history entries
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.history && Array.isArray(parsed.history)) {
          const seen = new Set<string>();
          const deduped = parsed.history.filter((d: DayStats) => {
            if (seen.has(d.date)) return false;
            seen.add(d.date);
            return true;
          });
          if (deduped.length !== parsed.history.length) {
            parsed.history = deduped;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
            // eslint-disable-next-line react-hooks/set-state-in-effect -- одноразовая миграция при монтировании
            setHistory(deduped);
          }
        }
      } catch {
        // ignore
      }
    }
  }, []);

  // Daily reset: проверяем при маунте и раз в минуту — приложение может
  // пережить полночь без рестарта. Читаем storage (зеркало состояния), чтобы
  // не зависеть от замыканий.
  const applyDailyReset = useCallback(() => {
    const s = loadStored();
    if (!s || !shouldReset(s.lastResetDate, s.settings.resetTime)) return;
    const activeReminders = s.reminders.filter((r) => r.enabled);
    const reminderBreakdown = activeReminders.map((r) => ({
      name: r.name,
      done: r.doneCount ?? 0,
      missed: r.missedCount ?? 0,
    }));
    const dayStats: DayStats = {
      date: s.lastResetDate,
      totalWorkSeconds: s.totalWorkSeconds,
      sectionBreakdown: s.sections.map((x) => ({
        name: x.name,
        seconds: x.trackedSeconds,
      })),
      reminderBreakdown,
    };
    setHistory((prev) => [...prev.slice(-29), dayStats]);
    setTotalWorkSeconds(0);
    setSections((prev) => prev.map((x) => ({ ...x, trackedSeconds: 0 })));
    setReminders((prev) => prev.map((r) => ({ ...r, missedCount: 0, doneCount: 0 })));
    // Выполненные задачи прошлого исчезают вместе с итогами дня
    setTasks((prev) => prev.filter((t) => !t.done || (t.scheduledDate !== null && t.scheduledDate >= todayStr())));
    setLastResetDate(todayStr());
    setShowDailyStats(true);
  }, [setSections, setReminders, setTasks]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- проверка сброса дня при маунте
    applyDailyReset();
    const id = window.setInterval(applyDailyReset, 60000);
    return () => window.clearInterval(id);
  }, [applyDailyReset]);

  // Persist to localStorage
  useEffect(() => {
    saveStored({
      totalWorkSeconds, settings, sections, activeSectionId,
      isTracking, isPaused, isOnBreak, workSeconds, workStartedAt,
      breakSecondsLeft, breakEndsAt, nextBreakThreshold,
      reminders, tasks, fixedEvents, history, lastResetDate,
    });
  }, [totalWorkSeconds, settings, sections, activeSectionId, isTracking, isPaused, isOnBreak, workSeconds, workStartedAt, breakSecondsLeft, breakEndsAt, nextBreakThreshold, reminders, tasks, fixedEvents, history, lastResetDate]);

  // Кросс-доменные действия
  const updateSettings = useCallback((next: Settings) => {
    const s = clampSettings(next);
    setSettings(s);
    applySettings(s);
  }, [setSettings, applySettings]);

  // Запуск трекинга задачи: привязать раздел + слот «сейчас» + включить таймер
  const startTask = useCallback((id: string) => {
    if (isOnBreak) return;
    if (planner.prepareStartTask(id)) startTracking();
  }, [isOnBreak, startTracking, planner]);

  const state: TrackerState = {
    isTracking, isPaused, isOnBreak,
    workSeconds, workStartedAt, breakSecondsLeft, breakEndsAt, nextBreakThreshold,
    totalWorkSeconds,
    settings, sections, activeSectionId, reminders, tasks, fixedEvents, history, lastResetDate,
    showDailyStats, autoStartEnabled,
  };

  return {
    state,
    startTracking, stopTracking, pauseTracking, resumeTracking,
    updateSettings,
    addReminder, removeReminder, toggleReminder, confirmReminder,
    addTask: planner.addTask,
    removeTask: planner.removeTask,
    toggleTaskDone: planner.toggleTaskDone,
    postponeTask: planner.postponeTask,
    updateTask: planner.updateTask,
    startTask,
    selectTask: planner.selectTask,
    addFixedEvent: planner.addFixedEvent,
    updateFixedEvent: planner.updateFixedEvent,
    removeFixedEvent: planner.removeFixedEvent,
    setDayBounds,
    setShowDailyStats,
    setAutoStart,
  };
}

export type PomodoroApi = ReturnType<typeof usePomodoro>;
