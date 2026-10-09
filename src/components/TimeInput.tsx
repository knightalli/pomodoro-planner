// Выбор времени в 24-часовом формате: два селекта ЧЧ : ММ
// (нативный input[type=time] зависит от локали, поэтому свой)
export function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [h = "00", m = "00"] = (value || "00:00").split(":");
  const opts = (n: number) => Array.from({ length: n }, (_, i) => i.toString().padStart(2, "0"));
  return (
    <span className="time-input">
      <select value={h} onChange={(e) => onChange(`${e.target.value}:${m}`)}>
        {opts(24).map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <span className="time-sep">:</span>
      <select value={m} onChange={(e) => onChange(`${h}:${e.target.value}`)}>
        {opts(60).map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
    </span>
  );
}
