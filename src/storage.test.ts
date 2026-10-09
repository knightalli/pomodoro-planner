import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadStored, saveStored, shouldReset, clampSettings, STORAGE_KEY, defaultStored } from "./storage";
import { DEFAULT_SETTINGS } from "./types";

// 06.10.2026 10:00
const NOW = new Date(2026, 9, 6, 10, 0, 0);

const mem = new Map<string, string>();
const localStorageStub = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
};

beforeEach(() => {
  mem.clear();
  vi.stubGlobal("localStorage", localStorageStub);
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("shouldReset", () => {
  it("no reset when lastResetDate is today", () => {
    expect(shouldReset("2026-10-06", "04:00")).toBe(false);
  });
  it("resets when day passed and reset time already came", () => {
    expect(shouldReset("2026-10-05", "04:00")).toBe(true); // 10:00 > 04:00
  });
  it("no reset when reset time has not come yet today", () => {
    expect(shouldReset("2026-10-05", "12:00")).toBe(false); // 10:00 < 12:00
  });
});

describe("clampSettings", () => {
  it("clamps break values (guards scheduler from garbage)", () => {
    const s = clampSettings({ ...DEFAULT_SETTINGS, breakInterval: 0, breakDuration: -3 });
    expect(s.breakInterval).toBe(DEFAULT_SETTINGS.breakInterval); // 0 → дефолт
    expect(s.breakDuration).toBe(1); // отрицательное → минимум
  });
  it("restores defaults on NaN/undefined-ish input", () => {
    const s = clampSettings({ ...DEFAULT_SETTINGS, breakInterval: Number("x") });
    expect(s.breakInterval).toBe(DEFAULT_SETTINGS.breakInterval);
  });
});

describe("loadStored", () => {
  it("returns null when storage is empty or broken", () => {
    expect(loadStored()).toBeNull();
    mem.set(STORAGE_KEY, "{not json");
    expect(loadStored()).toBeNull();
  });

  it("fills defaults for missing fields (soft migration)", () => {
    mem.set(STORAGE_KEY, JSON.stringify({ totalWorkSeconds: 42 }));
    const s = loadStored()!;
    expect(s.totalWorkSeconds).toBe(42);
    expect(s.settings).toEqual(DEFAULT_SETTINGS);
    expect(s.tasks).toEqual([]);
    expect(s.lastResetDate).toBe("2026-10-06");
  });

  it("merges partial settings and clamps them", () => {
    mem.set(STORAGE_KEY, JSON.stringify({ settings: { breakInterval: 0 } }));
    const s = loadStored()!;
    expect(s.settings.breakInterval).toBe(DEFAULT_SETTINGS.breakInterval);
    expect(s.settings.dayStart).toBe(DEFAULT_SETTINGS.dayStart);
  });

  it("migrates old tasks without new fields", () => {
    mem.set(STORAGE_KEY, JSON.stringify({ tasks: [{ id: "t1", name: "x", done: false }] }));
    const [t] = loadStored()!.tasks;
    expect(t.scheduledDate).toBeNull();
    expect(t.trackedSeconds).toBe(0);
    expect(t.sectionId).toBeNull();
  });
});

describe("saveStored / defaultStored", () => {
  it("round-trips through localStorage", () => {
    const s = { ...defaultStored(), totalWorkSeconds: 123 };
    saveStored(s);
    expect(loadStored()!.totalWorkSeconds).toBe(123);
  });
  it("does not throw when storage write fails", () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => { throw new Error("quota"); } });
    expect(() => saveStored(defaultStored())).not.toThrow();
  });
});
