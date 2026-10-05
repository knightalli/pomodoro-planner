import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { Settings, DEFAULT_SETTINGS, Section, Task, formatClock } from "./types";
import { showMainWindow } from "./platform";

const STORAGE_KEY = "pomodoro-state";

interface StoredState {
  isTracking: boolean;
  isPaused: boolean;
  isOnBreak: boolean;
  workSeconds: number;
  breakSecondsLeft: number;
  nextBreakThreshold: number;
  settings: Settings;
  sections: Section[];
  tasks: Task[];
  activeSectionId: string | null;
}

const EMPTY: StoredState = { isTracking: false, isPaused: false, isOnBreak: false, workSeconds: 0, breakSecondsLeft: 300, nextBreakThreshold: 900, settings: DEFAULT_SETTINGS, sections: [], tasks: [], activeSectionId: null };

function loadState(): StoredState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw);
    return {
      isTracking: parsed.isTracking ?? false,
      isPaused: parsed.isPaused ?? false,
      isOnBreak: parsed.isOnBreak ?? false,
      workSeconds: parsed.workSeconds ?? 0,
      breakSecondsLeft: parsed.breakSecondsLeft ?? 300,
      nextBreakThreshold: parsed.nextBreakThreshold ?? (parsed.settings ?? DEFAULT_SETTINGS).breakInterval * 60,
      settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
      sections: parsed.sections ?? [],
      tasks: parsed.tasks ?? [],
      activeSectionId: parsed.activeSectionId ?? null,
    };
  } catch {
    return EMPTY;
  }
}

function saveState(partial: Record<string, unknown>) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    Object.assign(parsed, partial);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch { /* ignore */ }
}

function Widget() {
  const [state, setState] = useState<StoredState>(loadState);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setState(loadState());
    };
    window.addEventListener("storage", onStorage);
    const interval = window.setInterval(() => setState(loadState()), 1000);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(interval);
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { x: e.screenX, y: e.screenY, moved: false };
  };

  // Перетаскивание делает easy_drag у pywebview; здесь только помечаем,
  // что мышь двигалась — чтобы drag не считался кликом
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = Math.abs(e.screenX - dragRef.current.x);
    const dy = Math.abs(e.screenY - dragRef.current.y);
    if (dx > 3 || dy > 3) dragRef.current.moved = true;
  };

  const openMainApp = async () => {
    if (dragRef.current?.moved) return;
    try {
      await showMainWindow();
    } catch { /* ignore */ }
  };

  const toggleTracking = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (state.isOnBreak) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const newTracking = !parsed.isTracking;
      parsed.isTracking = newTracking;
      parsed.isPaused = false;
      if (!newTracking) {
        parsed.workSeconds = 0;
        parsed.nextBreakThreshold = (parsed.settings ?? DEFAULT_SETTINGS).breakInterval * 60;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      setState(loadState());
    } catch { /* ignore */ }
  };

  const handlePause = (e: React.MouseEvent) => {
    e.stopPropagation();
    saveState({ isPaused: true });
    setState(loadState());
  };

  const handleResume = (e: React.MouseEvent) => {
    e.stopPropagation();
    saveState({ isPaused: false });
    setState(loadState());
  };

  const activeTask = state.tasks.find((t) => !t.done && t.sectionId !== null && t.sectionId === state.activeSectionId);
  const taskRemaining = activeTask ? Math.max(0, activeTask.durationMinutes * 60 - activeTask.trackedSeconds) : null;
  const displaySeconds = state.isOnBreak ? state.breakSecondsLeft : taskRemaining ?? state.workSeconds;
  const accent = state.isOnBreak ? "#27ae60" : "#4a90d9";
  const activeSection = state.sections.find((s) => s.id === state.activeSectionId);
  const sectionName = state.isOnBreak ? "Перерыв" : (activeTask?.name ?? activeSection?.name ?? "Без задачи");
  const taskProgress = activeTask ? Math.min(1, activeTask.trackedSeconds / (activeTask.durationMinutes * 60)) : null;
  const breakLeft = state.isTracking && !state.isOnBreak ? Math.max(0, state.nextBreakThreshold - state.workSeconds) : null;

  return (
    <div
      className="widget-container"
      style={{ ["--accent" as string]: accent }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onClick={openMainApp}
    >
      <div className="widget-time" style={{ color: state.isOnBreak ? "#27ae60" : "#1a3a5c" }}>
        {formatClock(displaySeconds)}
      </div>
      <div className="widget-section">{sectionName}</div>
      {taskProgress !== null && !state.isOnBreak && (
        <div className="widget-progress"><div className="widget-progress-fill" style={{ width: `${taskProgress * 100}%` }} /></div>
      )}
      {breakLeft !== null && (
        <div className="widget-break">☕ {formatClock(breakLeft)}</div>
      )}
      {state.isTracking && !state.isPaused && !state.isOnBreak ? (
        <div className="widget-btns">
          <button
            className="widget-btn"
            onClick={handlePause}
            onMouseDown={(e) => e.stopPropagation()}
            style={{ background: "#f39c12" }}
          >⏸</button>
          <button
            className="widget-btn"
            onClick={toggleTracking}
            onMouseDown={(e) => e.stopPropagation()}
            style={{ background: "#e74c3c" }}
          >⏹</button>
        </div>
      ) : state.isPaused && !state.isOnBreak ? (
        <div className="widget-btns">
          <button
            className="widget-btn"
            onClick={handleResume}
            onMouseDown={(e) => e.stopPropagation()}
            style={{ background: "var(--accent)" }}
          >▶</button>
          <button
            className="widget-btn"
            onClick={toggleTracking}
            onMouseDown={(e) => e.stopPropagation()}
            style={{ background: "#e74c3c" }}
          >⏹</button>
        </div>
      ) : (
        <button
          className="widget-btn"
          onClick={toggleTracking}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ background: state.isTracking ? "#e74c3c" : "var(--accent)" }}
        >
          {state.isTracking ? "⏹" : "▶"}
        </button>
      )}
    </div>
  );
}

const styles = `
.widget-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.15rem;
  width: 160px;
  height: 96px;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 12px;
  border: 1px solid #d0dce8;
  cursor: pointer;
  position: relative;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  user-select: none;
  -webkit-user-select: none;
  transition: transform 0.15s ease, border-color 0.2s;
  box-shadow: 0 2px 12px rgba(74, 144, 217, 0.15);
  padding: 0.3rem;
}

.widget-container:hover {
  transform: scale(1.05);
  border-color: var(--accent);
}

.widget-time {
  font-size: 1.2rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.widget-section {
  font-size: 0.65rem;
  color: #6b8aab;
  font-weight: 500;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.2;
}

.widget-btn {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: none;
  color: #fff;
  font-size: 0.7rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: filter 0.2s;
  margin-top: 0.1rem;
}

.widget-btn:hover {
  filter: brightness(0.9);
}

.widget-btns {
  display: flex;
  gap: 0.3rem;
  margin-top: 0.1rem;
}

.widget-progress {
  width: 110px;
  height: 3px;
  border-radius: 2px;
  background: #dce8f5;
  overflow: hidden;
}

.widget-progress-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.5s ease;
}

.widget-break {
  font-size: 0.6rem;
  color: #43a047;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
`;

const styleEl = document.createElement("style");
styleEl.textContent = styles;
document.head.appendChild(styleEl);

ReactDOM.createRoot(document.getElementById("widget-root") as HTMLElement).render(
  <React.StrictMode>
    <Widget />
  </React.StrictMode>
);
