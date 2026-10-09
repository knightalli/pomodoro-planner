import { PomodoroApi } from "../usePomodoro";
import { formatClock, formatDuration } from "../types";
import { localDateStr, formatDateShort } from "../scheduler";
import { toggleWidgetWindow } from "../platform";
import { TaskProgressBar } from "./TaskProgressBar";

export function TimerTab({ pomo, onToggleSettings }: { pomo: PomodoroApi; onToggleSettings: () => void }) {
  const { state, startTracking, stopTracking, pauseTracking, resumeTracking, selectTask, toggleTaskDone } = pomo;

  const isBreak = state.isOnBreak;
  const activeSection = state.sections.find((s) => s.id === state.activeSectionId);
  const activeTask = state.tasks.find((t) => !t.done && t.sectionId !== null && t.sectionId === state.activeSectionId);
  const openTasks = state.tasks.filter((t) => !t.done);
  const todayTasks = openTasks
    .filter((t) => t.scheduledDate === localDateStr())
    .sort((a, b) => (a.scheduledStart ?? "").localeCompare(b.scheduledStart ?? ""));
  const otherTasks = openTasks
    .filter((t) => t.scheduledDate !== localDateStr())
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
  // С выбранной задачей таймер идёт на обратный отсчёт её остатка; без задачи — счёт до перерыва
  const taskRemaining = activeTask ? Math.max(0, activeTask.durationMinutes * 60 - activeTask.trackedSeconds) : null;
  const displaySeconds = isBreak ? state.breakSecondsLeft : taskRemaining ?? state.workSeconds;
  const progress = isBreak
    ? 1 - state.breakSecondsLeft / (state.settings.breakDuration * 60)
    : activeTask
      ? Math.min(1, activeTask.trackedSeconds / (activeTask.durationMinutes * 60))
      : state.workSeconds / (state.settings.breakInterval * 60);

  const handleShowWidget = async () => {
    try {
      await toggleWidgetWindow();
    } catch {
      // Widget window not available in browser dev
    }
  };

  return (
    <>
      {/* Task selector - above timer */}
      <div className="section-selector">
        <select
          value={activeTask?.id ?? ""}
          onChange={(e) => selectTask(e.target.value || null)}
          className="section-dropdown"
        >
          <option value="">— Без задачи —</option>
          {todayTasks.length > 0 && (
            <optgroup label="Сегодня по плану">
              {todayTasks.map((t) => (
                <option key={t.id} value={t.id}>{t.scheduledStart} {t.name}</option>
              ))}
            </optgroup>
          )}
          {otherTasks.length > 0 && (
            <optgroup label="Остальные задачи">
              {otherTasks.map((t) => (
                <option key={t.id} value={t.id}>{t.name} (до {formatDateShort(t.deadline)})</option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {/* Timer */}
      <div className="timer-wrapper">
        <svg className="progress-ring" width="240" height="240">
          <circle className="progress-bg" cx="120" cy="120" r="110" fill="none" strokeWidth="6" />
          <circle
            className="progress-bar"
            cx="120" cy="120" r="110" fill="none" strokeWidth="6"
            strokeDasharray={2 * Math.PI * 110}
            strokeDashoffset={2 * Math.PI * 110 * (1 - Math.min(progress, 1))}
            strokeLinecap="round"
            transform="rotate(-90 120 120)"
          />
        </svg>
        <div className="timer-display">
          <span className="time">{formatClock(displaySeconds)}</span>
          <span className="mode-label">
            {isBreak ? "☕ Перерыв" : activeTask ? activeTask.name : activeSection ? activeSection.name : "Без задачи"}
          </span>
        </div>
      </div>

      {/* Selected task progress */}
      {activeTask && !isBreak && (
        <div className="timer-task-progress">
          <span>{formatDuration(activeTask.trackedSeconds)} / {formatDuration(activeTask.durationMinutes * 60)}</span>
          <TaskProgressBar
            durationMinutes={activeTask.durationMinutes}
            trackedSeconds={activeTask.trackedSeconds}
            settings={state.settings}
          />
        </div>
      )}
      {!isBreak && state.isTracking && (
        <span className="timer-break-left">☕ Перерыв через {formatClock(Math.max(0, state.nextBreakThreshold - state.workSeconds))}</span>
      )}

      {/* Отметить выбранную задачу выполненной */}
      {activeTask && (
        <button className="btn-secondary btn-small btn-done" onClick={() => toggleTaskDone(activeTask.id)}>
          ✓ Задача выполнена
        </button>
      )}

      {/* Controls - main Start/Stop centered */}
      <div className="controls-main">
        {!state.isTracking && !isBreak ? (
          <button className="btn-primary" onClick={startTracking}>▶ Старт</button>
        ) : isBreak ? (
          <span className="break-info">Идёт перерыв…</span>
        ) : state.isPaused ? (
          <div className="controls-pause">
            <button className="btn-primary" onClick={resumeTracking}>▶ Продолжить</button>
            <button className="btn-primary btn-stop" onClick={stopTracking}>⏹ Стоп</button>
          </div>
        ) : (
          <div className="controls-pause">
            <button className="btn-secondary" onClick={pauseTracking}>⏸ Пауза</button>
            <button className="btn-primary btn-stop" onClick={stopTracking}>⏹ Стоп</button>
          </div>
        )}
      </div>

      {/* Secondary controls - settings and widget */}
      <div className="controls-secondary">
        <button className="btn-secondary btn-small" onClick={onToggleSettings}>⚙ Настройки</button>
        <button className="btn-secondary btn-small" onClick={handleShowWidget}>📺 Виджет</button>
      </div>
    </>
  );
}
