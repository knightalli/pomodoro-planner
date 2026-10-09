import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { formatClock } from "./types";
import { STORAGE_KEY, StoredState, defaultStored, loadStored } from "./storage";
import { showMainWindow } from "./platform";
import { sendWidgetCommand } from "./bridge";
import { useNow } from "./useNow";

function loadState(): StoredState {
  return loadStored() ?? defaultStored();
}

function Widget() {
  const [state, setState] = useState<StoredState>(loadState);
  const now = useNow();
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

  // Управление таймером — командами в главное окно; само состояние не трогаем
  const send = (cmd: "toggle" | "pause" | "resume") => (e: React.MouseEvent) => {
    e.stopPropagation();
    sendWidgetCommand(cmd);
  };

  const activeTask = state.tasks.find((t) => !t.done && t.sectionId !== null && t.sectionId === state.activeSectionId);
  const taskRemaining = activeTask ? Math.max(0, activeTask.durationMinutes * 60 - activeTask.trackedSeconds) : null;
  // «Живые» значения по timestamp-якорям — виджет досчитывает сам, не дожидаясь
  // записи главным окном
  const liveWork = state.workSeconds + (
    state.isTracking && !state.isPaused && state.workStartedAt !== null
      ? Math.max(0, Math.floor((now - state.workStartedAt) / 1000))
      : 0
  );
  const liveBreakLeft = state.breakEndsAt !== null
    ? Math.max(0, Math.ceil((state.breakEndsAt - now) / 1000))
    : state.breakSecondsLeft;
  const displaySeconds = state.isOnBreak ? liveBreakLeft : taskRemaining ?? liveWork;
  const accent = state.isOnBreak ? "#27ae60" : "#4a90d9";
  const activeSection = state.sections.find((s) => s.id === state.activeSectionId);
  const sectionName = state.isOnBreak ? "Перерыв" : (activeTask?.name ?? activeSection?.name ?? "Без задачи");
  const taskProgress = activeTask ? Math.min(1, activeTask.trackedSeconds / (activeTask.durationMinutes * 60)) : null;
  const breakLeft = state.isTracking && !state.isOnBreak ? Math.max(0, state.nextBreakThreshold - liveWork) : null;

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
            onClick={send("pause")}
            onMouseDown={(e) => e.stopPropagation()}
            style={{ background: "#f39c12" }}
          >⏸</button>
          <button
            className="widget-btn"
            onClick={send("toggle")}
            onMouseDown={(e) => e.stopPropagation()}
            style={{ background: "#e74c3c" }}
          >⏹</button>
        </div>
      ) : state.isPaused && !state.isOnBreak ? (
        <div className="widget-btns">
          <button
            className="widget-btn"
            onClick={send("resume")}
            onMouseDown={(e) => e.stopPropagation()}
            style={{ background: "var(--accent)" }}
          >▶</button>
          <button
            className="widget-btn"
            onClick={send("toggle")}
            onMouseDown={(e) => e.stopPropagation()}
            style={{ background: "#e74c3c" }}
          >⏹</button>
        </div>
      ) : (
        <button
          className="widget-btn"
          onClick={send("toggle")}
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
