import { Settings } from "../types";
import { occupiedMinutes } from "../scheduler";

// Прогресс-бар задачи по слоту: зелёные полосы — перерывы, синяя заливка — отработано
export function TaskProgressBar({ durationMinutes, trackedSeconds, settings }: { durationMinutes: number; trackedSeconds: number; settings: Settings }) {
  const biSec = settings.breakInterval * 60;
  const bdSec = settings.breakDuration * 60;
  const occSec = Math.max(1, occupiedMinutes(durationMinutes, settings) * 60);
  const bands: { left: number; width: number }[] = [];
  for (let k = 1; k * biSec <= durationMinutes * 60; k++) {
    const start = k * biSec + (k - 1) * bdSec;
    bands.push({ left: (start / occSec) * 100, width: (bdSec / occSec) * 100 });
  }
  // Позиция в слоте = отработанные секунды + уже пройденные перерывы
  const pos = trackedSeconds <= 0
    ? 0
    : Math.min(occSec, trackedSeconds + Math.floor((trackedSeconds - 1) / biSec) * bdSec);
  return (
    <div className="tl-progress">
      {bands.map((b, i) => (
        <span key={i} className="tl-break-band" style={{ left: `${b.left}%`, width: `${b.width}%` }} />
      ))}
      <div className="tl-progress-fill" style={{ width: `${(pos / occSec) * 100}%` }} />
    </div>
  );
}
