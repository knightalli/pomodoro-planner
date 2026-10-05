import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

export async function notifyBreakStart(duration: number) {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const perm = await requestPermission();
      granted = perm === "granted";
    }
    if (granted) {
      sendNotification({
        title: "Тайм-трекер: Перерыв!",
        body: `Время отдохнуть ${duration} минут.`,
      });
    }
  } catch {
    // ignore
  }
}

export async function notifyBreakEnd() {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const perm = await requestPermission();
      granted = perm === "granted";
    }
    if (granted) {
      sendNotification({
        title: "Тайм-трекер: Перерыв окончен!",
        body: "Время продолжить работу.",
      });
    }
  } catch {
    // ignore
  }
}

export async function notifyReminder(name: string) {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const perm = await requestPermission();
      granted = perm === "granted";
    }
    if (granted) {
      sendNotification({
        title: `Тайм-трекер: ${name}`,
        body: "Нажмите \"Подтвердить\" в приложении, когда выполните.",
      });
    }
  } catch {
    // ignore
  }
}

export async function notifyTaskStart(name: string) {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const perm = await requestPermission();
      granted = perm === "granted";
    }
    if (granted) {
      sendNotification({
        title: "Тайм-трекер: пора начинать!",
        body: `По плану сейчас — «${name}».`,
      });
    }
  } catch {
    // ignore
  }
}

export async function notifyTaskDone(name: string) {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const perm = await requestPermission();
      granted = perm === "granted";
    }
    if (granted) {
      sendNotification({
        title: "Тайм-трекер: задача выполнена!",
        body: `«${name}» — отработано запланированное время.`,
      });
    }
  } catch {
    // ignore
  }
}
