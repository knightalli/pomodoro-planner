import { osNotify } from "./platform";

export interface AppToast {
  title: string;
  body: string;
}

export const TOAST_EVENT = "tt-toast";

function showToast(title: string, body: string) {
  window.dispatchEvent(
    new CustomEvent<AppToast>(TOAST_EVENT, { detail: { title, body } }),
  );
}

async function notify(title: string, body: string) {
  showToast(title, body);
  try {
    await osNotify(title, body);
  } catch (err) {
    console.error("notify: failed to send OS notification", err);
  }
}

export function notifyBreakStart(duration: number) {
  return notify("Тайм-трекер: Перерыв!", `Время отдохнуть ${duration} минут.`);
}

export function notifyBreakEnd() {
  return notify("Тайм-трекер: Перерыв окончен!", "Время продолжить работу.");
}

export function notifyReminder(name: string) {
  return notify(
    `Тайм-трекер: ${name}`,
    'Нажмите "Подтвердить" в приложении, когда выполните.',
  );
}

export function notifyTaskStart(name: string) {
  return notify(
    "Тайм-трекер: пора начинать!",
    `По плану сейчас — «${name}».`,
  );
}

export function notifyTaskDone(name: string) {
  return notify(
    "Тайм-трекер: задача выполнена!",
    `«${name}» — отработано запланированное время.`,
  );
}
