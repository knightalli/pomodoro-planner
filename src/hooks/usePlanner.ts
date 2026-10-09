import { useCallback, useEffect, useRef, useState } from "react";
import { Settings, Section, Task, FixedEvent, TaskPriority } from "../types";
import { localDateStr, scheduleTasks, timeToMinutes, minutesToTime, occupiedMinutes, addDays } from "../scheduler";
import { StoredState, genId } from "../storage";
import { playBell } from "../sound";
import { notifyTaskStart, notifyTaskDone } from "../notifications";

// Планировщик-домен: задачи, фиксированные дела, разделы трекинга и
// авто-расстановка по слотам. Таймер сюда не лезет — наоборот, таймер через
// accrueWork(dt) доносит отработанные секунды, а старт задачи снаружи идёт
// через prepareStartTask (usePomodoro сам решает, включать ли таймер).
interface PlannerProps {
  stored: StoredState | null;
  settings: Settings;
  settingsRef: { current: Settings };
}

export function usePlanner({ stored, settings, settingsRef }: PlannerProps) {
  const [sections, setSections] = useState<Section[]>(stored?.sections ?? []);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(stored?.activeSectionId ?? null);
  const [tasks, setTasks] = useState<Task[]>(stored?.tasks ?? []);
  const [fixedEvents, setFixedEvents] = useState<FixedEvent[]>(stored?.fixedEvents ?? []);
  const [schedTick, setSchedTick] = useState(0);
  const tasksRef = useRef(tasks);
  const sectionsRef = useRef(sections);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  useEffect(() => {
    sectionsRef.current = sections;
  }, [sections]);

  // Auto-scheduling: расставляем незавершённые задачи по свободным слотам;
  // активная (выбранная в таймере) задача держит свой слот
  useEffect(() => {
    const activeTaskId = tasks.find((t) => !t.done && t.sectionId !== null && t.sectionId === activeSectionId)?.id ?? null;
    const next = scheduleTasks(tasks, fixedEvents, settings, activeTaskId);
    if (next.some((t, i) => t !== tasks[i])) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- синхронизация derived-состояния с входными данными: план пересчитывается при изменении задач
      setTasks(next);
    }
  }, [tasks, fixedEvents, settings, activeSectionId, schedTick]);

  // Раз в минуту пересчитываем план: просроченные задачи «плывут» вниз к текущему времени
  useEffect(() => {
    const id = window.setInterval(() => setSchedTick((v) => v + 1), 60000);
    return () => window.clearInterval(id);
  }, []);

  // Уведомления о старте — когда наступает слот задачи (окно 15 минут)
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

  // Секунды от таймера в активный раздел и привязанную задачу (+ auto-done)
  const accrueWork = useCallback((dt: number) => {
    if (!activeSectionId) return;
    setSections((prev) =>
      prev.map((s) => (s.id === activeSectionId ? { ...s, trackedSeconds: s.trackedSeconds + dt } : s))
    );
    const linked = tasksRef.current.find((t) => t.sectionId === activeSectionId && !t.done);
    if (!linked) return;
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== linked.id) return t;
        const tracked = t.trackedSeconds + dt;
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
            scheduledEnd: minutesToTime(nowMin + occupiedMinutes(t.durationMinutes, settingsRef.current)),
          };
        }
        return { ...t, trackedSeconds: tracked, done: t.done || justDone };
      })
    );
    const dur = linked.durationMinutes * 60;
    if (linked.trackedSeconds < dur && linked.trackedSeconds + dt >= dur) {
      playBell();
      notifyTaskDone(linked.name);
    }
  }, [activeSectionId, settingsRef]);

  // Task CRUD
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
    const task = tasksRef.current.find((t) => t.id === id);
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
    // Завершённая задача отпускает активный раздел — таймер идёт «без задачи»
    if (task && !task.done && task.sectionId) {
      setActiveSectionId((curr) => (curr === task.sectionId ? null : curr));
    }
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

  // Подготовка к старту трекинга: привязать раздел + прибить слот к «сейчас».
  // Возвращает false, если задачу трекать нельзя — таймер запускает вызывающий.
  const prepareStartTask = useCallback((id: string) => {
    const task = tasksRef.current.find((t) => t.id === id);
    if (!task || task.done) return false;
    selectTask(id);
    const d = new Date();
    const nowMin = d.getHours() * 60 + d.getMinutes();
    const s = settingsRef.current;
    const remainingMin = Math.max(1, Math.ceil(task.durationMinutes - task.trackedSeconds / 60));
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              scheduledDate: localDateStr(),
              scheduledStart: minutesToTime(nowMin),
              scheduledEnd: minutesToTime(nowMin + occupiedMinutes(remainingMin, s)),
            }
          : t
      )
    );
    return true;
  }, [selectTask, settingsRef]);

  // Fixed events CRUD
  const addFixedEvent = useCallback((data: { name: string; startTime: string; endTime: string; days: number[] }) => {
    setFixedEvents((prev) => [...prev, { ...data, id: genId() }]);
  }, []);

  const updateFixedEvent = useCallback((id: string, data: { name: string; startTime: string; endTime: string; days: number[] }) => {
    setFixedEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...data } : e)));
  }, []);

  const removeFixedEvent = useCallback((id: string) => {
    setFixedEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  return {
    sections, setSections, activeSectionId, setActiveSectionId,
    tasks, setTasks, fixedEvents, setFixedEvents,
    accrueWork,
    addTask, removeTask, toggleTaskDone, postponeTask, updateTask, selectTask, prepareStartTask,
    addFixedEvent, updateFixedEvent, removeFixedEvent,
  };
}
