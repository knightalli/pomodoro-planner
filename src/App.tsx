import { useState } from "react";
import { usePomodoro } from "./usePomodoro";
import { formatDuration } from "./types";
import { TimerTab } from "./components/TimerTab";
import { PlannerTab } from "./components/PlannerTab";
import { StatsTab } from "./components/StatsTab";
import { RemindersTab } from "./components/RemindersTab";
import { SettingsPanel } from "./components/SettingsPanel";
import { Toasts } from "./components/Toasts";
import "./App.css";

type Tab = "timer" | "stats" | "reminders" | "planner";

function App() {
  const pomo = usePomodoro();
  const { state, setShowDailyStats } = pomo;
  const [tab, setTab] = useState<Tab>("timer");
  const [showSettings, setShowSettings] = useState(false);

  return (
    <main className="container">
      {/* Top nav tabs */}
      <div className="nav-tabs">
        <button className={`nav-tab ${tab === "timer" ? "active" : ""}`} onClick={() => setTab("timer")}>⏱ Таймер</button>
        <button className={`nav-tab ${tab === "planner" ? "active" : ""}`} onClick={() => setTab("planner")}>📅 План</button>
        <button className={`nav-tab ${tab === "stats" ? "active" : ""}`} onClick={() => setTab("stats")}>📊 Статистика</button>
        <button className={`nav-tab ${tab === "reminders" ? "active" : ""}`} onClick={() => setTab("reminders")}>🔔 Напоминания</button>
      </div>

      {/* Daily stats popup */}
      {state.showDailyStats && (
        <div className="daily-stats-popup">
          <h3>📊 Итоги дня</h3>
          <p>Вы отработали: <strong>{formatDuration(state.history[state.history.length - 1]?.totalWorkSeconds ?? 0)}</strong></p>
          {state.history[state.history.length - 1]?.sectionBreakdown.map((s) => (
            <p key={s.name}>{s.name}: {formatDuration(s.seconds)}</p>
          ))}
          <button className="btn-primary" onClick={() => setShowDailyStats(false)}>Отлично!</button>
        </div>
      )}

      {tab === "timer" && <TimerTab pomo={pomo} onToggleSettings={() => setShowSettings((v) => !v)} />}
      {tab === "planner" && <PlannerTab pomo={pomo} />}
      {tab === "stats" && <StatsTab pomo={pomo} />}
      {tab === "reminders" && <RemindersTab pomo={pomo} />}

      {/* Settings panel */}
      {showSettings && <SettingsPanel pomo={pomo} onClose={() => setShowSettings(false)} />}

      <Toasts />
    </main>
  );
}

export default App;
