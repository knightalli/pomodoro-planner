# Тайм-трекер — руководство разработчика

## Стек

- **pywebview** (Python + WebView2 на Windows) — окна, трей, уведомления, автозапуск
- **React 19 + TypeScript** (фронтенд)
- **Vite 7** (dev-сервер и сборка)
- Python-зависимости: `pywebview`, `pystray`, `pillow`, `windows-toasts`

## Запуск и сборка

```bash
npm install
run.bat              # десктопная оболочка на pywebview (venv + build при первом запуске)
python app.py        # то же, если .venv уже создан (.venv\Scripts\python.exe app.py)
python app.py --dev  # оболочка поверх vite dev-сервера
npm run dev          # только фронтенд на http://localhost:1420 (платформенные API заглушены)
npm run build        # tsc + vite build → dist/
npm test             # vitest: scheduler + storage + workStep
npm run lint         # eslint (flat config, react-hooks)
npm run format       # prettier --write .
```

### pywebview-оболочка (`app.py`)

Запускается без MSVC: поднимает локальный HTTP-сервер для `dist/` на
фиксированном порту `PORT = 31873` и открывает два окна WebView2 — главное и
скрытый виджет (frameless + always-on-top, перетаскивается за любое место через
`easy_drag`). Оба окна на одном origin → общий `localStorage`, синхронизация
виджета через storage-события + команды по `BroadcastChannel`.
Трей — `pystray` (Показать/Выход), уведомления — `windows-toasts`,
автозапуск — запись в `HKCU\...\Run` (`TimeTracker`).

**Персистентность** держится на трёх вещах, все обязательны:

- `webview.start(private_mode=False)` — дефолт `True` гоняет WebView2 в
  InPrivate и localStorage не пишется на диск;
- `storage_path=%APPDATA%\TimeTracker` — отдельный профиль, а не общий
  `%APPDATA%\pywebview`;
- фиксированный порт сервера — origin `http://127.0.0.1:PORT` постоянен, иначе
  localStorage партиционируется по случайному порту каждого запуска.
  Заодно занятый порт = второй экземпляр не поднимется (single-instance guard).

JS-сторона идёт через `src/platform.ts`: пробует
`window.pywebview.api`, в браузере — Web Notification/no-op.

## Карта файлов

```
src/
  main.tsx          entry: рендерит <App/>
  App.tsx           оболочка: нав-вкладки, попап итогов дня, монтирование вкладок
  components/
    TimerTab.tsx    таймер: круг, выбор задачи, кнопки
    PlannerTab.tsx  ежедневник: таймлайн, формы задач и фикс-событий
    StatsTab.tsx    статистика по дням
    RemindersTab.tsx напоминания: список, pending, форма
    SettingsPanel.tsx модалка настроек
    Toasts.tsx      стек внутриприложенческих тостов
    TimeInput.tsx   выбор ЧЧ:ММ (два селекта, 24 ч)
    TaskProgressBar.tsx полоса прогресса задачи с метками перерывов
  usePomodoro.ts    композиция доменов + persistence + daily reset + кросс-доменные экшены
  hooks/
    useSettings.ts  настройки + автозапуск (platform-мост)
    useTimer.ts     таймер/перерывы на timestamp-якорях + команды виджета
    usePlanner.ts   задачи, разделы, фикс-дела, авто-расстановка, accrueWork
    useReminders.ts напоминания: CRUD + проверка срабатываний
  storage.ts        STORAGE_KEY, StoredState, мягкие миграции (loadStored),
                    shouldReset, кламп настроек — общий модуль для окон
  bridge.ts         команды виджет → главное окно (BroadcastChannel)
  useNow.ts         хук «тикающего» Date.now()
  scheduler.ts      чистый авто-планировщик (без React): слоты, даты, форматирование
  types.ts          модели данных + DEFAULT_SETTINGS + форматтеры времени
  notifications.ts  обёртки уведомлений (все в try/catch)
  platform.ts       мост к pywebview (notify, виджет, автозапуск) + браузерный fallback
  sound.ts          колокольчик (WebAudio)
  widget.tsx        отдельное окно-виджет (widget.html), read-only + команды
  *.test.ts         vitest: scheduler и storage
app.py              десктопная оболочка: окна, трей, уведомления, автозапуск
run.bat             лаунчер: venv + build + запуск
widget.html         входная точка виджета
docs/               документация
```

## Архитектура состояния

Единственный источник правды — `usePomodoro()`: композиция доменных хуков
(`useSettings`, `useTimer`, `usePlanner`, `useReminders` из `src/hooks/`).
Возвращает `{ state, ...actions }` (тип `PomodoroApi`, его и получают
компоненты-вкладки пропсом `pomo`). Всё состояние зеркалируется в `localStorage`
под ключом `pomodoro-state` (эффект-персистор в конце хука).

Разделение по доменам: таймер (`useTimer`) владеет секундами/перерывами/командами
виджета, планировщик (`usePlanner`) — задачами, разделами, фикс-делами и
авто-расстановкой, `useReminders` — напоминаниями, `useSettings` — настройками и
автозапуском. Кросс-доменные вещи живут в `usePomodoro`: persistence,
daily-reset, `updateSettings` (настройки → таймер), `startTask` (задача →
таймер). Связь таймер→планировщик — через коллбэк `onWorkElapsed(dt)`.

Схема состояния и хранилище — `storage.ts`: `STORAGE_KEY`, `StoredState`,
`defaultStored()`, `saveStored()`, `shouldReset()`. `loadStored()` выполняет
мягкие миграции: при чтении старого состояния недостающие поля заполняются
дефолтами (`tasks[].sectionId`, `startNotified`, счётчики напоминаний и т.д.) и
клампятся настройки (`clampSettings`, защита планировщика от `breakInterval <= 0`).
При добавлении новых полей в модель — добавляйте дефолт туда.

### Модели (`types.ts`)

| Модель | Назначение |
|---|---|
| `Settings` | интервалы перерывов, время сброса дня, границы дня для планировщика |
| `Section` | корзина трекинга (`trackedSeconds`). Задачи автосоздают себе раздел |
| `Task` | задача: длительность, приоритет, дедлайн, назначенный слот, `trackedSeconds`, `sectionId` |
| `FixedEvent` | регулярное занятие: время + набор дней недели |
| `Reminder` | напоминание: interval/specific, pending/повторы, счётчики done/missed |
| `DayStats` | снимок дня для истории |

## Таймерный цикл

Таймер — на **timestamp-якорях** (`useTimer`), а не на счётчике тиков:
`workStartedAt` — начало текущего рабочего сегмента, `breakEndsAt` — момент
конца перерыва. `setInterval(1000)` — только «сердцебиение»: на каждом тике
реально прошедшее время досчитывается по якорю (`workStep`), поэтому сон и
троттлинг окна не теряют секунды — один тик может докоммитить сразу много.

- **Работа**: `elapsed = now − workStartedAt`; коммитится `min(elapsed, room)`,
  где `room = nextBreakThreshold − workSeconds` (время сверх порога — уже
  «перерывное», не коммитится). Якорь двигается на закоммиченное: дробный
  остаток не теряется. Коммит идёт в `workSeconds`, `totalWorkSeconds`,
  активный раздел и — если раздел привязан к задаче — `task.trackedSeconds`
  (`accrueWork` в `usePlanner`). При `trackedSeconds >= duration*60` задача
  `done` + `notifyTaskDone`. При достижении порога → перерыв.
- **Перерыв**: `breakSecondsLeft = ⌈(breakEndsAt − now)/1000⌉`; при `now >=
  breakEndsAt` → обратно в работу, `workStartedAt = breakEndsAt` (время после
  конца перерыва честно считается работой).
- **Пауза** обнуляет якорь (теряется под-секундный остаток), **резюме** ставит
  новый; **стоп** сбрасывает всё.

После перезапуска приложения таймер стартует остановленным (как раньше) —
stored-якоря нужны виджету для «живого» отображения, а не возобновлению.

Отображение в UI: с выбранной задачей таймер — обратный отсчёт
`duration*60 − trackedSeconds`, кольцо = прогресс задачи; без задачи — счёт до
перерыва. Ввод времени везде — компонент `TimeInput` (два селекта ЧЧ:ММ,
24 ч) вместо нативного `input[type=time]`, чей формат зависит от локали.

Связь задача↔таймер: `selectTask(id)` гарантирует задаче собственный `Section`
(создаёт при первом использовании) и делает его активным. `startTask(id)` =
`selectTask` + старт таймера. Прямой выбор раздела из UI убран — разделы теперь
чисто внутренний механизм агрегации времени (и статистики).

Тик-секунды используют `tasksRef`/`sectionsRef`/`remindersRef` — актуальные
снимки, чтобы интервал не зависел от замыканий.

## Планировщик (`scheduler.ts`)

`scheduleTasks(tasks, events, settings)` — чистая функция, вызывается эффектом при
любом изменении `tasks`/`fixedEvents`/`settings`:

1. Закреплённое время (`pinned`) = фиксированные дела по дню недели + **только
   активная задача** (выбранная в таймере, `activeTaskId` — 4-й аргумент) со
   слотом не в прошлом. Начатые, но не активные задачи — кандидаты на остаток
   (`⌈длит. − tracked/60⌉` мин) и «плывут» вниз; слот в прошлом не держится.
   Эффект пересчитывает план по изменению состояния и раз в минуту (`schedTick`)
   — просроченные задачи сами съезжают к текущему времени.
   Конец слота активной задачи (`pinnedInterval`) динамический:
   `max(старт, сейчас) + occupiedMinutes(остаток)` — на паузе блок растёт и
   сдвигает дела ниже; `scheduledEnd` обновляется при каждом пересчёте.
2. Кандидаты: `!done && !pinned`, сортировка deadline → priority → createdAt.
3. Для каждой задачи — симуляция размещения в свободных окнах
   `[windowStart, dayEnd)` от сегодня до дедлайна. Для сегодня
   `windowStart = max(dayStart, now)` — в прошлое не планируем.
   Перерывы считаются накопительно (`accumByDate`): работа копится, при
   достижении `breakInterval` в слот вписывается `breakDuration` — внутри
   задачи или сразу после неё (перерыв «между задачами»). Свободный зазор ≥
   `breakDuration` перед слотом сбрасывает счёт (отдохнули). Назначается
   `scheduledStart` и `scheduledEnd` (конец с перерывами).
   `occupiedMinutes(d, settings) = d + ⌊d/breakInterval⌋·breakDuration` —
   та же модель для одиночной задачи.

`startTask(id)`/`selectTask(id)` привязывают задачу к разделу; `startTask` и
первый тик таймера штампуют слот к текущему времени — задача «поднимается
наверх» плана, остальные перепланируются вокруг.
4. `startNotified` сбрасывается только при переносе на другой день — сдвиг слота
   внутри дня не должен дублировать уведомление.
5. Возвращает новый массив, неизменённые задачи — по ссылке (эффект сравнивает
   `t !== tasks[i]`, чтобы не зациклить setState).

`freeMinutesForDate` — то же вычитание для UI-счётчика «Свободно» (для сегодня —
от now; done-задачи не занимают время).

Отдельный интервал (30 c) `checkTaskStarts` шлёт `notifyTaskStart`, когда
наступает слот задачи (окно 15 мин, флаг `startNotified`).

## Ежедневный сброс

`applyDailyReset()` проверяет `shouldReset(lastResetDate, settings.resetTime)`
при маунте и **раз в минуту** — приложение может пережить полночь без рестарта:

- снимок дня уходит в `history` (`[...prev.slice(-29), dayStats]`, лимит 30);
- обнуляются счётчики; выполненные задачи прошлых дней удаляются;
- `showDailyStats` → попап «Итоги дня».

Функция читает свежее состояние через `loadStored()` (зеркало в localStorage),
поэтому не зависит от замыканий интервала.

Даты — локальные `YYYY-MM-DD` (`localDateStr`), сравнение строками. Не
используйте `toISOString()` — это UTC и расходится с локальной датой ночью.

## Виджет

`widget.tsx` — второе окно pywebview (`widget.html`), компактный always-on-top
frameless (перетаскивается easy_drag за любое место). Виджет **строго read-only**:
сам читает `localStorage` через общий `storage.ts` (подписка на `storage`-событие
+ поллинг раз в секунду) и ничего туда не пишет. Кнопки управления шлют команды
`toggle`/`pause`/`resume` по `BroadcastChannel("tt-commands")` (`bridge.ts`) —
обработчик в `usePomodoro` применяет те же экшены, что и UI. Один писатель =
нет ручной правки JSON и расхождений семантики.

## Напоминания

Интервал 10 c: `interval` — по прошествии `intervalMinutes` от `lastFired`;
`specific` — один раз в день в `specificTime`. `pending` → повтор каждые 60 с,
макс. 3 раза, потом `missedCount++`. `confirmReminder` → `doneCount++`.

## Нюансы и известные ограничения

Полный разбор проблем и план по ним — `docs/TECH_DEBT.md`. Основное:

- После авто-завершения задачи таймер **не останавливается**: секунды продолжают
  идти в раздел задачи (видно в статистике как время сверх оценки).
- Сон/троттлинг во время работы считается честно (якоря), но время **закрытого**
  приложения не учитывается — после перезапуска таймер остановлен.
- `localStorage` — единственное хранилище; нет бэкапа/экспорта.
- Уведомления и напоминания работают только при запущенном приложении.
- `handleShowWidget` в браузерном dev-режиме молча падает (try/catch) — нормально.
- В `StoredState` нет `showDailyStats`/`autoStartEnabled` — это сессионные поля.

## Стиль кода

- Компактные функции, без лишних try/catch; ошибки глотаются осознанно только на
  границах (notifications, autostart, localStorage, platform-мост).
- Комментарии — по-русски, только где неочевидно.
- Новые поля в persisted-моделях → дефолт в `loadStored`.
