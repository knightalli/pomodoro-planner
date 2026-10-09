import { useCallback, useEffect, useRef, useState } from "react";
import { Reminder } from "../types";
import { genId } from "../storage";
import { playBell } from "../sound";
import { notifyReminder } from "../notifications";

// Напоминания: состояние + CRUD + проверка раз в 10 с. Самодостаточный домен —
// наружу отдаёт состояние и действия, уведомления шлёт сам.
export function useReminders(initial?: Reminder[]) {
  const [reminders, setReminders] = useState<Reminder[]>(initial ?? []);
  const remindersRef = useRef(reminders);
  useEffect(() => {
    remindersRef.current = reminders;
  }, [reminders]);

  // Проверка срабатываний: interval — по прошествии intervalMinutes от lastFired;
  // specific — раз в день в specificTime. pending → повтор каждые 60 с,
  // макс. 3 раза, потом missedCount++.
  useEffect(() => {
    const checkReminders = () => {
      const now = Date.now();
      const current = remindersRef.current;
      const toFire: string[] = [];
      let changed = false;

      const next = current.map((r) => {
        if (!r.enabled) return r;
        if (r.pending) {
          if (r.lastFired !== null && now - r.lastFired >= 60 * 1000) {
            if (r.repeatCount >= 3) {
              changed = true;
              return { ...r, pending: false, repeatCount: 0, missedCount: r.missedCount + 1, lastFired: now };
            }
            toFire.push(r.name);
            changed = true;
            return { ...r, lastFired: now, repeatCount: r.repeatCount + 1 };
          }
          return r;
        }
        let shouldFire = false;
        if (r.type === "interval") {
          if (r.lastFired === null || now - r.lastFired >= r.intervalMinutes * 60 * 1000) {
            shouldFire = true;
          }
        } else {
          const [h, m] = r.specificTime.split(":").map(Number);
          const target = new Date();
          target.setHours(h, m, 0, 0);
          if (r.lastFired === null) {
            if (now >= target.getTime() && now < target.getTime() + 60000) {
              shouldFire = true;
            }
          } else {
            const lastDate = new Date(r.lastFired);
            if (lastDate.toDateString() !== target.toDateString() && now >= target.getTime()) {
              shouldFire = true;
            }
          }
        }
        if (shouldFire) {
          toFire.push(r.name);
          changed = true;
          return { ...r, lastFired: now, pending: true, repeatCount: 1 };
        }
        return r;
      });

      if (changed) {
        setReminders(next);
      }
      if (toFire.length > 0) {
        playBell();
        toFire.forEach((name) => notifyReminder(name));
      }
    };
    const reminderInterval = window.setInterval(checkReminders, 10000);
    checkReminders();
    return () => window.clearInterval(reminderInterval);
  }, []);

  const addReminder = useCallback((reminder: Omit<Reminder, "id" | "lastFired" | "pending" | "repeatCount" | "missedCount" | "doneCount">) => {
    const id = genId();
    setReminders((prev) => [...prev, { ...reminder, id, lastFired: null, pending: false, repeatCount: 0, missedCount: 0, doneCount: 0 }]);
  }, []);

  const removeReminder = useCallback((id: string) => {
    setReminders((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const toggleReminder = useCallback((id: string) => {
    setReminders((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      const enabling = !r.enabled;
      if (enabling) {
        return { ...r, enabled: true, pending: false, repeatCount: 0, lastFired: Date.now() };
      }
      return { ...r, enabled: false, pending: false, repeatCount: 0 };
    }));
  }, []);

  const confirmReminder = useCallback((id: string) => {
    setReminders((prev) => prev.map((r) => (r.id === id ? { ...r, pending: false, repeatCount: 0, lastFired: Date.now(), doneCount: r.doneCount + 1 } : r)));
  }, []);

  return { reminders, setReminders, addReminder, removeReminder, toggleReminder, confirmReminder };
}
