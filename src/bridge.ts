// Команды виджет → главное окно. Виджет read-only: состояние правит только
// главное окно (usePomodoro), виджет лишь шлёт команды по BroadcastChannel и
// показывает localStorage. Работает и в браузерном dev-режиме.

export const TT_CHANNEL = "tt-commands";

export type WidgetCommand = "toggle" | "pause" | "resume";

let ch: BroadcastChannel | null = null;

export function sendWidgetCommand(cmd: WidgetCommand) {
  try {
    ch ??= new BroadcastChannel(TT_CHANNEL);
    ch.postMessage(cmd);
  } catch {
    // BroadcastChannel недоступен — виджет просто не будет управлять таймером
  }
}
