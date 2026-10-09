import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, Settings } from "../types";
import { StoredState } from "../storage";
import { playBell } from "../sound";
import { notifyBreakStart, notifyBreakEnd } from "../notifications";
import { TT_CHANNEL, WidgetCommand } from "../bridge";

// Таймер на timestamp-якорях: workStartedAt — начало текущего рабочего
// сегмента, breakEndsAt — момент конца перерыва. setInterval — только
// «сердцебиение»: на каждом тике реально прошедшее время досчитывается по якорю,
// поэтому сон/троттлинг окна не теряют секунды (один тик может докоммитить
// сразу много секунд). workSeconds/breakSecondsLeft — накопленные (committed)
// значения для отображения и persistence.
interface TimerProps {
  stored: StoredState | null;
  settingsRef: { current: Settings };
  onWorkElapsed: (dt: number) => void; // отработанные секунды → total/раздел/задача
}

// Чистый шаг таймера: сколько секунд закоммитить из якоря и не пора ли на
// перерыв. Время сверх порога не коммитится — оно уже «перерывное».
export function workStep(anchor: number, now: number, workSeconds: number, threshold: number) {
  const elapsed = Math.floor((now - anchor) / 1000);
  if (elapsed < 1) return { dt: 0, reachedBreak: workSeconds >= threshold };
  const room = Math.max(0, threshold - workSeconds);
  const dt = Math.min(elapsed, room);
  return { dt, reachedBreak: workSeconds + dt >= threshold };
}

export function useTimer({ stored, settingsRef, onWorkElapsed }: TimerProps) {
  const [isTracking, setIsTracking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [workSeconds, setWorkSeconds] = useState(stored?.workSeconds ?? 0);
  const [workStartedAt, setWorkStartedAt] = useState<number | null>(null);
  const [breakSecondsLeft, setBreakSecondsLeft] = useState(
    stored?.breakSecondsLeft ?? (stored?.settings ?? DEFAULT_SETTINGS).breakDuration * 60
  );
  const [breakEndsAt, setBreakEndsAt] = useState<number | null>(null);
  const [nextBreakThreshold, setNextBreakThreshold] = useState(
    stored?.nextBreakThreshold ?? (stored?.settings ?? DEFAULT_SETTINGS).breakInterval * 60
  );

  // Актуальные значения для тика — чтобы интервал не зависел от замыканий
  const workRef = useRef({ workSeconds, workStartedAt, nextBreakThreshold });
  const breakEndsAtRef = useRef(breakEndsAt);
  const onWorkElapsedRef = useRef(onWorkElapsed);
  useEffect(() => {
    workRef.current = { workSeconds, workStartedAt, nextBreakThreshold };
  });
  useEffect(() => {
    breakEndsAtRef.current = breakEndsAt;
  }, [breakEndsAt]);
  useEffect(() => {
    onWorkElapsedRef.current = onWorkElapsed;
  });

  useEffect(() => {
    if (!(isTracking && !isPaused) && !isOnBreak) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      if (isOnBreak) {
        const endsAt = breakEndsAtRef.current;
        if (endsAt === null) return;
        const remaining = Math.ceil((endsAt - now) / 1000);
        if (remaining > 0) {
          setBreakSecondsLeft(remaining);
          return;
        }
        // Перерыв окончен — работа возобновляется от момента конца перерыва
        setIsOnBreak(false);
        setBreakEndsAt(null);
        setBreakSecondsLeft(0);
        playBell();
        notifyBreakEnd();
        setIsTracking(true);
        setIsPaused(false);
        setWorkStartedAt(endsAt);
        return;
      }
      const { workSeconds: ws, workStartedAt: anchor, nextBreakThreshold: thr } = workRef.current;
      if (anchor === null) return;
      const { dt, reachedBreak } = workStep(anchor, now, ws, thr);
      if (dt > 0) {
        setWorkStartedAt((a) => (a === null ? null : a + dt * 1000));
        setWorkSeconds((w) => w + dt);
        onWorkElapsedRef.current(dt);
      }
      if (reachedBreak) {
        setIsTracking(false);
        setIsOnBreak(true);
        setWorkStartedAt(null);
        setBreakEndsAt(now + settingsRef.current.breakDuration * 1000);
        setBreakSecondsLeft(settingsRef.current.breakDuration * 60);
        setNextBreakThreshold((t) => t + settingsRef.current.breakInterval * 60);
        playBell();
        notifyBreakStart(settingsRef.current.breakDuration);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [isTracking, isPaused, isOnBreak, settingsRef]);

  const startTracking = useCallback(() => {
    if (isOnBreak) return;
    setIsTracking(true);
    setWorkStartedAt((a) => a ?? Date.now());
  }, [isOnBreak]);

  const stopTracking = useCallback(() => {
    setIsTracking(false);
    setIsPaused(false);
    setWorkStartedAt(null);
    setWorkSeconds(0);
    setNextBreakThreshold(settingsRef.current.breakInterval * 60);
  }, [settingsRef]);

  const pauseTracking = useCallback(() => {
    setIsPaused(true);
    setWorkStartedAt(null); // под-секундный остаток теряется — пренебрежимо
  }, []);

  const resumeTracking = useCallback(() => {
    setIsPaused(false);
    setWorkStartedAt((a) => a ?? Date.now());
  }, []);

  // Смена настроек: перезапускаем отсчёт текущего перерыва (как старая
  // семантика reset breakSecondsLeft), порог — только вне сессии
  const applySettings = useCallback((s: Settings) => {
    setBreakSecondsLeft(s.breakDuration * 60);
    setBreakEndsAt((e) => (e === null ? null : Date.now() + s.breakDuration * 1000));
    setNextBreakThreshold((t) => (isTracking || isOnBreak ? t : s.breakInterval * 60));
  }, [isTracking, isOnBreak]);

  // Подхват полей, записанных другим окном (storage-событие)
  const syncFromStorage = useCallback((s: StoredState) => {
    setIsTracking(s.isTracking);
    setIsPaused(s.isPaused);
    setIsOnBreak(s.isOnBreak);
    setWorkSeconds(s.workSeconds);
    setWorkStartedAt(s.workStartedAt);
    setBreakSecondsLeft(s.breakSecondsLeft);
    setBreakEndsAt(s.breakEndsAt);
    setNextBreakThreshold(s.nextBreakThreshold);
  }, []);

  // Команды от виджета (BroadcastChannel): виджет read-only, состояние меняет
  // только это окно; виджет подхватит результат через storage-событие
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(TT_CHANNEL);
    ch.onmessage = (e) => {
      const cmd = e.data as WidgetCommand;
      if (cmd === "pause") {
        setIsPaused(true);
        setWorkStartedAt(null);
      } else if (cmd === "resume") {
        setIsPaused(false);
        setWorkStartedAt((a) => a ?? Date.now());
      } else if (cmd === "toggle") {
        if (isOnBreak) return;
        if (isTracking) {
          stopTracking();
        } else {
          setIsPaused(false);
          setIsTracking(true);
          setWorkStartedAt((a) => a ?? Date.now());
        }
      }
    };
    return () => ch.close();
  }, [isOnBreak, isTracking, stopTracking]);

  return {
    isTracking, isPaused, isOnBreak,
    workSeconds, workStartedAt, breakSecondsLeft, breakEndsAt, nextBreakThreshold,
    startTracking, stopTracking, pauseTracking, resumeTracking,
    applySettings, syncFromStorage,
  };
}
