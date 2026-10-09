import { describe, it, expect } from "vitest";
import { workStep } from "./useTimer";

describe("workStep (timestamp-якоря)", () => {
  it("no commit below one full second", () => {
    expect(workStep(0, 999, 0, 900)).toEqual({ dt: 0, reachedBreak: false });
  });

  it("commits real elapsed time, not ticks", () => {
    expect(workStep(0, 5000, 0, 900)).toEqual({ dt: 5, reachedBreak: false });
    // «проспал» час — коммитит всё разом, без потерь от пропущенных тиков
    expect(workStep(0, 3_600_000, 0, 10_000)).toEqual({ dt: 3600, reachedBreak: false });
  });

  it("caps commit at the break threshold — excess time is break time", () => {
    // до порога осталось 10 с, прошло 30 → коммитим 10 и уходим на перерыв
    expect(workStep(0, 30_000, 890, 900)).toEqual({ dt: 10, reachedBreak: true });
  });

  it("fires break exactly at the threshold", () => {
    expect(workStep(0, 900_000, 0, 900).reachedBreak).toBe(true);
    expect(workStep(0, 899_000, 0, 900).reachedBreak).toBe(false);
  });
});
