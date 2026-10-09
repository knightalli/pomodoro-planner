import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  scheduleTasks, occupiedMinutes, timeToMinutes, minutesToTime,
  localDateStr, addDays,
} from "./scheduler";
import { DEFAULT_SETTINGS, Settings, Task, FixedEvent } from "./types";

// Вторник 06.10.2026, 10:00 — «сейчас» для всех тестов
const NOW = new Date(2026, 9, 6, 10, 0, 0);
const TODAY = "2026-10-06";
const TOMORROW = "2026-10-07";

const S: Settings = { ...DEFAULT_SETTINGS, breakInterval: 15, breakDuration: 5, dayStart: "08:00", dayEnd: "23:00" };

let seq = 0;
function makeTask(p: Partial<Task>): Task {
  seq += 1;
  return {
    id: `t${seq}`,
    name: `task-${seq}`,
    durationMinutes: 30,
    priority: "medium",
    deadline: TODAY,
    scheduledDate: null,
    scheduledStart: null,
    scheduledEnd: null,
    done: false,
    trackedSeconds: 0,
    sectionId: null,
    startNotified: false,
    createdAt: seq,
    ...p,
  };
}

function makeEvent(p: Partial<FixedEvent>): FixedEvent {
  return { id: "e1", name: "event", startTime: "10:00", endTime: "11:00", days: [0, 1, 2, 3, 4, 5, 6], ...p };
}

beforeEach(() => {
  seq = 0;
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("time utils", () => {
  it("timeToMinutes / minutesToTime roundtrip", () => {
    expect(timeToMinutes("08:30")).toBe(510);
    expect(minutesToTime(510)).toBe("08:30");
  });
  it("minutesToTime clamps out-of-range", () => {
    expect(minutesToTime(-5)).toBe("00:00");
    expect(minutesToTime(10_000)).toBe("23:59");
  });
});

describe("occupiedMinutes", () => {
  it("adds a break after every breakInterval, including the trailing one", () => {
    expect(occupiedMinutes(10, S)).toBe(10);
    expect(occupiedMinutes(15, S)).toBe(20); // 15 работы + перерыв в хвосте
    expect(occupiedMinutes(20, S)).toBe(25);
    expect(occupiedMinutes(30, S)).toBe(40);
  });
});

describe("scheduleTasks", () => {
  it("places a task at the nearest free slot from now", () => {
    const t = makeTask({ durationMinutes: 30 });
    const [r] = scheduleTasks([t], [], S);
    expect(r.scheduledDate).toBe(TODAY);
    expect(r.scheduledStart).toBe("10:00");
    expect(r.scheduledEnd).toBe("10:40"); // 15+5+15+5
  });

  it("does not schedule into the past: window starts at now", () => {
    const t = makeTask({ durationMinutes: 5 });
    const [r] = scheduleTasks([t], [], S);
    expect(timeToMinutes(r.scheduledStart!)).toBeGreaterThanOrEqual(600);
  });

  it("works around fixed events", () => {
    const ev = makeEvent({ startTime: "10:00", endTime: "12:00" });
    const t = makeTask({ durationMinutes: 10 });
    const [r] = scheduleTasks([t], [ev], S);
    expect(r.scheduledStart).toBe("12:00");
  });

  it("orders by deadline, then priority, then createdAt", () => {
    const low = makeTask({ id: "low", priority: "low", createdAt: 1 });
    const high = makeTask({ id: "high", priority: "high", createdAt: 2 });
    const lateDl = makeTask({ id: "late", priority: "high", deadline: TOMORROW, createdAt: 3 });
    const out = scheduleTasks([low, high, lateDl], [], S);
    const byId = Object.fromEntries(out.map((t) => [t.id, t]));
    // high раньше low (приоритет), lateDL позже обоих (дедлайн важнее приоритета)
    expect(byId.high.scheduledStart! < byId.low.scheduledStart!).toBe(true);
    expect(byId.late.scheduledStart! > byId.low.scheduledStart!).toBe(true);
  });

  it("leaves task unscheduled when the day has no room", () => {
    const t = makeTask({ durationMinutes: 30 });
    const [r] = scheduleTasks([t], [], { ...S, dayEnd: "10:10" });
    expect(r.scheduledDate).toBeNull();
    expect(r.scheduledStart).toBeNull();
  });

  it("spills to the next day when today is full but deadline allows", () => {
    const t = makeTask({ durationMinutes: 30, deadline: TOMORROW, startNotified: true });
    const [r] = scheduleTasks([t], [], { ...S, dayEnd: "10:10" });
    expect(r.scheduledDate).toBe(TOMORROW);
    expect(r.scheduledStart).toBe("08:00");
    // перенос на другой день сбрасывает флаг уведомления о старте
    expect(r.startNotified).toBe(false);
  });

  it("keeps startNotified when the slot moves within the same day", () => {
    const t = makeTask({ durationMinutes: 10, scheduledDate: TODAY, scheduledStart: "09:00", startNotified: true });
    const [r] = scheduleTasks([t], [], S);
    expect(r.scheduledDate).toBe(TODAY);
    expect(r.startNotified).toBe(true);
  });

  it("pins the active task slot and schedules others around it", () => {
    const active = makeTask({ id: "a", durationMinutes: 30, trackedSeconds: 600, scheduledDate: TODAY, scheduledStart: "10:00" });
    const other = makeTask({ id: "b", durationMinutes: 30 });
    const out = scheduleTasks([active, other], [], S, "a");
    const a = out.find((t) => t.id === "a")!;
    const b = out.find((t) => t.id === "b")!;
    // активная: остаток 20 мин + перерыв 5 → конец 10:25, слот сохранён
    expect(a.scheduledStart).toBe("10:00");
    expect(a.scheduledEnd).toBe("10:25");
    expect(b.scheduledStart).toBe("10:25");
  });

  it("re-plans a past-dated unfinished task from now with remaining work", () => {
    // задача стояла «вчера», 15 мин из 60 отработано — после рестарта должна
    // встать от текущего времени на остаток
    const t = makeTask({
      durationMinutes: 60,
      trackedSeconds: 900,
      scheduledDate: "2026-10-05",
      scheduledStart: "09:00",
      scheduledEnd: "10:00",
    });
    const [r] = scheduleTasks([t], [], S);
    expect(r.scheduledDate).toBe(TODAY);
    expect(r.scheduledStart).toBe("10:00"); // от now, а не вчерашний слот
    expect(r.scheduledEnd).toBe("11:00");   // 45 мин остатка + 3 перерыва по 5
  });

  it("ignores done tasks", () => {
    const done = makeTask({ done: true, scheduledDate: TODAY, scheduledStart: "10:00" });
    const t = makeTask({ durationMinutes: 10 });
    const out = scheduleTasks([done, t], [], S, done.id);
    const d = out.find((x) => x.id === done.id)!;
    const r = out.find((x) => x.id === t.id)!;
    expect(r.scheduledStart).toBe("10:00"); // done не занял слот
    expect(d.scheduledStart).toBe("10:00"); // done не тронули
  });
});

describe("date utils", () => {
  it("localDateStr formats local date", () => {
    expect(localDateStr(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
  it("addDays shifts date", () => {
    expect(addDays(TODAY, 1)).toBe(TOMORROW);
    expect(addDays(TODAY, -1)).toBe("2026-10-05");
  });
});
