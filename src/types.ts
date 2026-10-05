export interface Settings {
  breakInterval: number;
  breakDuration: number;
  autoStartBreak: boolean;
  resetTime: string;
  dayStart: string;
  dayEnd: string;
}

export interface Section {
  id: string;
  name: string;
  trackedSeconds: number;
}

export type ReminderType = "interval" | "specific";

export interface Reminder {
  id: string;
  name: string;
  type: ReminderType;
  intervalMinutes: number;
  specificTime: string;
  enabled: boolean;
  lastFired: number | null;
  pending: boolean;
  repeatCount: number;
  missedCount: number;
  doneCount: number;
}

export type TaskPriority = "high" | "medium" | "low";

export interface Task {
  id: string;
  name: string;
  durationMinutes: number;
  priority: TaskPriority;
  deadline: string; // YYYY-MM-DD
  scheduledDate: string | null; // YYYY-MM-DD, назначается планировщиком
  scheduledStart: string | null; // HH:MM
  done: boolean;
  trackedSeconds: number; // натрекано таймером через связанный раздел
  sectionId: string | null; // раздел тайм-трекера
  startNotified: boolean;
  createdAt: number;
}

export interface FixedEvent {
  id: string;
  name: string;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  days: number[]; // 0 = воскресенье … 6 = суббота
}

export interface DayStats {
  date: string;
  totalWorkSeconds: number;
  sectionBreakdown: { name: string; seconds: number }[];
  reminderBreakdown: { name: string; done: number; missed: number }[];
}

export const DEFAULT_SETTINGS: Settings = {
  breakInterval: 15,
  breakDuration: 5,
  autoStartBreak: true,
  resetTime: "04:00",
  dayStart: "08:00",
  dayEnd: "23:00",
};

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}ч ${m}м ${s}с`;
  if (m > 0) return `${m}м ${s}с`;
  return `${s}с`;
}

export function formatClock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
