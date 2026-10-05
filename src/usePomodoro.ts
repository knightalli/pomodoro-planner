import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, Settings, Section, Reminder, DayStats, Task, FixedEvent, TaskPriority } from "./types";
import { localDateStr, scheduleTasks, timeToMinutes, minutesToTime, occupiedMinutes, addDays } from "./scheduler";
import { playBell } from "./sound";
import { notifyBreakStart, notifyBreakEnd, notifyReminder, notifyTaskStart, notifyTaskDone } from "./notifications";
import { autostartIsEnabled, autostartSet } from "./platform";

interface TrackerState {
  isTracking: boolean;
  isPaused: boolean;
  isOnBreak: boolean;
  workSeconds: number;
  breakSecondsLeft: number;
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

const STORAGE_KEY = "pomodoro-state";

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

interface StoredState {
  totalWorkSeconds: number;
  settings: Settings;
  sections: Section[];
  activeSectionId: string | null;
  isTracking: boolean;
  isPaused: boolean;
  isOnBreak: boolean;
  workSeconds: number;
  breakSecondsLeft: number;
  nextBreakThreshold: number;
  reminders: Reminder[];
  tasks: Task[];
  fixedEvents: FixedEvent[];
  history: DayStats[];
  lastResetDate: string;
}

function todayStr(): string {
  return localDateStr();
}

function shouldReset(lastResetDate: string, resetTime: string): boolean {
  const today = todayStr();
  if (lastResetDate === today) return false;
  const now = new Date();
  const [rh, rm] = resetTime.split(":").map(Number);
  const resetToday = new Date(now);
  resetToday.setHours(rh, rm, 0, 0);
  const last = new Date(lastResetDate + "T00:00:00");
  return now >= resetToday && last < resetToday;
}

function loadStored(): StoredState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    return {
      totalWorkSeconds: parsed.totalWorkSeconds ?? 0,
      settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
      sections: parsed.sections ?? [],
      activeSectionId: parsed.activeSectionId ?? null,
      isTracking: parsed.isTracking ?? false,
      isPaused: parsed.isPaused ?? false,
      isOnBreak: parsed.isOnBreak ?? false,
      workSeconds: parsed.workSeconds ?? 0,
      breakSecondsLeft: parsed.breakSecondsLeft ?? (parsed.settings ?? DEFAULT_SETTINGS).breakDuration * 60,
      nextBreakThreshold: parsed.nextBreakThreshold ?? (parsed.settings ?? DEFAULT_SETTINGS).breakInterval * 60,
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

function saveStored(state: StoredState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function usePomodoro() {
  const stored = loadStored();
  const [settings, setSettings] = useState<Settings>(stored?.settings ?? DEFAULT_SETTINGS);
  const [isTracking, setIsTracking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [workSeconds, setWorkSeconds] = useState(stored?.workSeconds ?? 0);
  const [breakSecondsLeft, setBreakSecondsLeft] = useState(
    stored?.breakSecondsLeft ?? settings.breakDuration * 60
  );
  const [nextBreakThreshold, setNextBreakThreshold] = useState(
    stored?.nextBreakThreshold ?? settings.breakInterval * 60
  );
  const [totalWorkSeconds, setTotalWorkSeconds] = useState(stored?.totalWorkSeconds ?? 0);
  const [sections, setSections] = useState<Section[]>(stored?.sections ?? []);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(stored?.activeSectionId ?? null);
  const [reminders, setReminders] = useState<Reminder[]>(stored?.reminders ?? []);
  const [tasks, setTasks] = useState<Task[]>(stored?.tasks ?? []);
  const [fixedEvents, setFixedEvents] = useState<FixedEvent[]>(stored?.fixedEvents ?? []);
  const [history, setHistory] = useState<DayStats[]>(stored?.history ?? []);
  const [lastResetDate, setLastResetDate] = useState<string>(stored?.lastResetDate ?? todayStr());
  const [showDailyStats, setShowDailyStats] = useState(false);
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  const [schedTick, setSchedTick] = useState(0);
  const intervalRef = useRef<number | null>(null);
  const remindersRef = useRef<Reminder[]>(reminders);
  const tasksRef = useRef<Task[]>(tasks);
  const sectionsRef = useRef<Section[]>(sections);

  useEffect(() => {
    remindersRef.current = reminders;
  }, [reminders]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    sectionsRef.current = sections;
  }, [sections]);

  // Sync state from localStorage when widget modifies it
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const s = loadStored();
      if (!s) return;
      setIsTracking(s.isTracking);
      setIsPaused(s.isPaused);
      setIsOnBreak(s.isOnBreak);
      setWorkSeconds(s.workSeconds);
      setBreakSecondsLeft(s.breakSecondsLeft);
      setNextBreakThreshold(s.nextBreakThreshold);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

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
            setHistory(deduped);
          }
        }
      } catch {
        // ignore
      }
    }
  }, []);

  // Daily reset check on mount
  useEffect(() => {
    if (stored && shouldReset(stored.lastResetDate, settings.resetTime)) {
      const activeReminders = (stored.reminders ?? []).filter((r) => r.enabled);
      const reminderBreakdown = activeReminders.map((r) => ({
        name: r.name,
        done: r.doneCount ?? 0,
        missed: r.missedCount ?? 0,
      }));
      const dayStats: DayStats = {
        date: stored.lastResetDate,
        totalWorkSeconds: stored.totalWorkSeconds,
        sectionBreakdown: stored.sections.map((s) => ({
          name: s.name,
          seconds: s.trackedSeconds,
        })),
        reminderBreakdown,
      };
      setHistory((prev) => [...prev.slice(-29), dayStats]);
      setTotalWorkSeconds(0);
      setSections((prev) => prev.map((s) => ({ ...s, trackedSeconds: 0 })));
      setReminders((prev) => prev.map((r) => ({ ...r, missedCount: 0, doneCount: 0 })));
      // Выполненные задачи прошлого исчезают вместе с итогами дня
      setTasks((prev) => prev.filter((t) => !t.done || (t.scheduledDate !== null && t.scheduledDate >= todayStr())));
      setLastResetDate(todayStr());
      setShowDailyStats(true);
    }
  }, []);

  // Auto-scheduling: расставляем незавершённые задачи по свободным слотам;
  // активная (выбранная в таймере) задача держит свой слот
  useEffect(() => {
    const activeTaskId = tasks.find((t) => !t.done && t.sectionId !== null && t.sectionId === activeSectionId)?.id ?? null;
    const next = scheduleTasks(tasks, fixedEvents, settings, activeTaskId);
    if (next.some((t, i) => t !== tasks[i])) {
      setTasks(next);
    }
  }, [tasks, fixedEvents, settings, activeSectionId, schedTick]);

  // Раз в минуту пересчитываем план: просроченные задачи «плывут» вниз к текущему времени
  useEffect(() => {
    const id = window.setInterval(() => setSchedTick((v) => v + 1), 60000);
    return () => window.clearInterval(id);
  }, []);

  // Main timer tick
  useEffect(() => {
    if ((isTracking && !isPaused) || isOnBreak) {
      intervalRef.current = window.setInterval(() => {
        if (isTracking && !isPaused) {
          let reachedBreak = false;
          setWorkSeconds((prev) => {
            const next = prev + 1;
            if (next >= nextBreakThreshold) {
              reachedBreak = true;
            }
            return next;
          });
          if (reachedBreak) {
            setIsTracking(false);
            setIsOnBreak(true);
            setBreakSecondsLeft(settings.breakDuration * 60);
            setNextBreakThreshold((t) => t + settings.breakInterval * 60);
            playBell();
            notifyBreakStart(settings.breakDuration);
          } else {
            setTotalWorkSeconds((prev) => prev + 1);
            if (activeSectionId) {
              setSections((prev) =>
                prev.map((s) =>
                  s.id === activeSectionId ? { ...s, trackedSeconds: s.trackedSeconds + 1 } : s
                )
              );
              const linked = tasksRef.current.find((t) => t.sectionId === activeSectionId && !t.done);
              if (linked) {
                setTasks((prev) =>
                  prev.map((t) => {
                    if (t.id !== linked.id) return t;
                    const tracked = t.trackedSeconds + 1;
                    const justDone = tracked >= t.durationMinutes * 60 && t.trackedSeconds < t.durationMinutes * 60;
                    // Первый тик по задаче — прибиваем её слот к текущему моменту
                    if (t.trackedSeconds === 0) {
                      const d = new Date();
                      const nowMin = d.getHours() * 60 + d.getMinutes();
                      return {
                        ...t,
                        trackedSeconds: tracked,
                        done: t.done || justDone,
                        scheduledDate: localDateStr(),
                        scheduledStart: minutesToTime(nowMin),
                        scheduledEnd: minutesToTime(nowMin + occupiedMinutes(t.durationMinutes, settings)),
                      };
                    }
                    return { ...t, trackedSeconds: tracked, done: t.done || justDone };
                  })
                );
                const dur = linked.durationMinutes * 60;
                if (linked.trackedSeconds < dur && linked.trackedSeconds + 1 >= dur) {
                  playBell();
                  notifyTaskDone(linked.name);
                }
              }
            }
          }
        } else if (isOnBreak) {
          let breakEnded = false;
          setBreakSecondsLeft((prev) => {
            if (prev <= 1) {
              breakEnded = true;
              return 0;
            }
            return prev - 1;
          });
          if (breakEnded) {
            setIsOnBreak(false);
            playBell();
            notifyBreakEnd();
            setIsTracking(true);
          }
        }
      }, 1000);
    } else if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [isTracking, isPaused, isOnBreak, settings, activeSectionId, nextBreakThreshold]);

  // Persist to localStorage
  useEffect(() => {
    saveStored({
      totalWorkSeconds, settings, sections, activeSectionId,
      isTracking, isPaused, isOnBreak, workSeconds, breakSecondsLeft, nextBreakThreshold,
      reminders, tasks, fixedEvents, history, lastResetDate,
    });
  }, [totalWorkSeconds, settings, sections, activeSectionId, isTracking, isPaused, isOnBreak, workSeconds, breakSecondsLeft, nextBreakThreshold, reminders, tasks, fixedEvents, history, lastResetDate]);

  // Reminder checker — fires on schedule, repeats every 60s up to 3 times if pending (not confirmed)
  useEffect(() => {
    const checkReminders = () => {
      const now = Date.now();
      const current = remindersRef.current;
      const toFire: string[] = [];
      let changed = false;

      const next = current.map((r) => {
        if (!r.enabled) return r;
        if (r.pending) {
          if (r.lastFired !== null && now - r.lastFired >= 60 * 1000) {
            if (r.repeatCount >= 3) {
              changed = true;
              return { ...r, pending: false, repeatCount: 0, missedCount: r.missedCount + 1, lastFired: now };
            }
            toFire.push(r.name);
            changed = true;
            return { ...r, lastFired: now, repeatCount: r.repeatCount + 1 };
          }
          return r;
        }
        let shouldFire = false;
        if (r.type === "interval") {
          if (r.lastFired === null || now - r.lastFired >= r.intervalMinutes * 60 * 1000) {
            shouldFire = true;
          }
        } else {
          const [h, m] = r.specificTime.split(":").map(Number);
          const target = new Date();
          target.setHours(h, m, 0, 0);
          if (r.lastFired === null) {
            if (now >= target.getTime() && now < target.getTime() + 60000) {
              shouldFire = true;
            }
          } else {
            const lastDate = new Date(r.lastFired);
            if (lastDate.getDate() !== target.getDate() && now >= target.getTime()) {
              shouldFire = true;
            }
          }
        }
        if (shouldFire) {
          toFire.push(r.name);
          changed = true;
          return { ...r, lastFired: now, pending: true, repeatCount: 1 };
        }
        return r;
      });

      if (changed) {
        setReminders(next);
      }
      if (toFire.length > 0) {
        playBell();
        toFire.forEach((name) => notifyReminder(name));
      }
    };
    const reminderInterval = window.setInterval(checkReminders, 10000);
    checkReminders();
    return () => window.clearInterval(reminderInterval);
  }, []);

  // Task start notifications — когда наступает слот задачи (окно 15 минут)
  useEffect(() => {
    const checkTaskStarts = () => {
      const now = new Date();
      const today = localDateStr();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      let changed = false;
      const fired: string[] = [];
      const next = tasksRef.current.map((t) => {
        if (t.done || t.startNotified || t.scheduledDate !== today || !t.scheduledStart) return t;
        const startMin = timeToMinutes(t.scheduledStart);
        if (nowMin >= startMin && nowMin < startMin + 15) {
          changed = true;
          fired.push(t.name);
          return { ...t, startNotified: true };
        }
        return t;
      });
      if (changed) setTasks(next);
      if (fired.length > 0) {
        playBell();
        fired.forEach((name) => notifyTaskStart(name));
      }
    };
    const taskInterval = window.setInterval(checkTaskStarts, 30000);
    checkTaskStarts();
    return () => window.clearInterval(taskInterval);
  }, []);

  const startTracking = useCallback(() => {
    if (isOnBreak) return;
    setIsTracking(true);
  }, [isOnBreak]);

  const toggleTracking = useCallback(() => {
    if (isOnBreak) return;
    setIsTracking((prev) => {
      if (!prev) return true;
      setWorkSeconds(0);
      setNextBreakThreshold(settings.breakInterval * 60);
      return false;
    });
  }, [isOnBreak, settings.breakInterval]);

  const stopTracking = useCallback(() => {
    setIsTracking(false);
    setIsPaused(false);
    setWorkSeconds(0);
    setNextBreakThreshold(settings.breakInterval * 60);
  }, [settings.breakInterval]);

  const pauseTracking = useCallback(() => {
    setIsPaused(true);
  }, []);

  const resumeTracking = useCallback(() => {
    setIsPaused(false);
  }, []);

  const updateSettings = useCallback((newSettings: Settings) => {
    setSettings(newSettings);
    setBreakSecondsLeft(newSettings.breakDuration * 60);
    if (!isTracking && !isOnBreak) {
      setNextBreakThreshold(newSettings.breakInterval * 60);
    }
  }, [isTracking, isOnBreak]);

  const addSection = useCallback((name: string) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const section: Section = { id, name, trackedSeconds: 0 };
    setSections((prev) => [...prev, section]);
    setActiveSectionId(id);
  }, []);

  const removeSection = useCallback((id: string) => {
    setSections((prev) => prev.filter((s) => s.id !== id));
    setActiveSectionId((curr) => (curr === id ? null : curr));
  }, []);

  const selectSection = useCallback((id: string) => {
    setActiveSectionId(id);
  }, []);

  // Reminder CRUD
  const addReminder = useCallback((reminder: Omit<Reminder, "id" | "lastFired" | "pending" | "repeatCount" | "missedCount" | "doneCount">) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    setReminders((prev) => [...prev, { ...reminder, id, lastFired: null, pending: false, repeatCount: 0, missedCount: 0, doneCount: 0 }]);
  }, []);

  const removeReminder = useCallback((id: string) => {
    setReminders((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const toggleReminder = useCallback((id: string) => {
    setReminders((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      const enabling = !r.enabled;
      if (enabling) {
        return { ...r, enabled: true, pending: false, repeatCount: 0, lastFired: Date.now() };
      }
      return { ...r, enabled: false, pending: false, repeatCount: 0 };
    }));
  }, []);

  const confirmReminder = useCallback((id: string) => {
    setReminders((prev) => prev.map((r) => (r.id === id ? { ...r, pending: false, repeatCount: 0, lastFired: Date.now(), doneCount: r.doneCount + 1 } : r)));
  }, []);

  // Planner: задачи
  const addTask = useCallback((data: { name: string; durationMinutes: number; priority: TaskPriority; deadline: string }) => {
    const task: Task = {
      ...data,
      id: genId(),
      scheduledDate: null,
      scheduledStart: null,
      scheduledEnd: null,
      done: false,
      trackedSeconds: 0,
      sectionId: null,
      startNotified: false,
      createdAt: Date.now(),
    };
    setTasks((prev) => [...prev, task]);
  }, []);

  const removeTask = useCallback((id: string) => {
    const task = tasksRef.current.find((t) => t.id === id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
    // Чистим раздел удалённой задачи, иначе таймер продолжит писать в «сироту»
    if (task?.sectionId) {
      setSections((prev) => prev.filter((s) => s.id !== task.sectionId));
      setActiveSectionId((curr) => (curr === task.sectionId ? null : curr));
    }
  }, []);

  const toggleTaskDone = useCallback((id: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  }, []);

  // Перенос задачи на завтра (когда не влезла в сегодняшний день)
  const postponeTask = useCallback((id: string) => {
    const tomorrow = addDays(localDateStr(), 1);
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, deadline: tomorrow } : t)));
  }, []);

  const updateTask = useCallback((id: string, data: { name: string; durationMinutes: number; priority: TaskPriority; deadline: string }) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...data } : t)));
  }, []);

  // Выбор задачи для таймера: привязывает/создаёт раздел и делает его активным
  const selectTask = useCallback((id: string | null) => {
    if (!id) {
      setActiveSectionId(null);
      return;
    }
    const task = tasksRef.current.find((t) => t.id === id);
    if (!task || task.done) return;
    let sectionId = task.sectionId;
    if (!sectionId || !sectionsRef.current.some((s) => s.id === sectionId)) {
      sectionId = genId();
      setSections((prev) => [...prev, { id: sectionId!, name: task.name, trackedSeconds: 0 }]);
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, sectionId } : t)));
    }
    setActiveSectionId(sectionId);
  }, []);

  // Запуск трекинга задачи: привязывает задачу, прибивает слот к «сейчас» и включает таймер
  const startTask = useCallback((id: string) => {
    if (isOnBreak) return;
    const task = tasksRef.current.find((t) => t.id === id);
    if (!task || task.done) return;
    selectTask(id);
    const d = new Date();
    const nowMin = d.getHours() * 60 + d.getMinutes();
    const remainingMin = Math.max(1, Math.ceil(task.durationMinutes - task.trackedSeconds / 60));
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              scheduledDate: localDateStr(),
              scheduledStart: minutesToTime(nowMin),
              scheduledEnd: minutesToTime(nowMin + occupiedMinutes(remainingMin, settings)),
            }
          : t
      )
    );
    setIsTracking(true);
    setIsPaused(false);
  }, [isOnBreak, selectTask, settings]);

  // Planner: фиксированные дела
  const addFixedEvent = useCallback((data: { name: string; startTime: string; endTime: string; days: number[] }) => {
    setFixedEvents((prev) => [...prev, { ...data, id: genId() }]);
  }, []);

  const updateFixedEvent = useCallback((id: string, data: { name: string; startTime: string; endTime: string; days: number[] }) => {
    setFixedEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...data } : e)));
  }, []);

  const removeFixedEvent = useCallback((id: string) => {
    setFixedEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const setDayBounds = useCallback((dayStart: string, dayEnd: string) => {
    setSettings((prev) => ({ ...prev, dayStart, dayEnd }));
  }, []);

  // Autostart
  const setAutoStart = useCallback(async (enabled: boolean) => {
    try {
      await autostartSet(enabled);
      setAutoStartEnabled(enabled);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    autostartIsEnabled().then((e) => setAutoStartEnabled(e)).catch(() => {});
  }, []);

  const state: TrackerState = {
    isTracking, isPaused, isOnBreak, workSeconds, breakSecondsLeft, nextBreakThreshold, totalWorkSeconds,
    settings, sections, activeSectionId, reminders, tasks, fixedEvents, history, lastResetDate,
    showDailyStats, autoStartEnabled,
  };

  return {
    state, startTracking, stopTracking, pauseTracking, resumeTracking, toggleTracking, updateSettings,
    addSection, removeSection, selectSection,
    addReminder, removeReminder, toggleReminder, confirmReminder,
    addTask, removeTask, toggleTaskDone, postponeTask, updateTask, startTask, selectTask,
    addFixedEvent, updateFixedEvent, removeFixedEvent, setDayBounds,
    setShowDailyStats, setAutoStart,
  };
}
