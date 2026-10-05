@echo off
rem Запуск Тайм-трекера: создаёт venv и собирает фронтенд при необходимости
cd /d "%~dp0"

if not exist .venv\Scripts\pythonw.exe (
  python -m venv .venv || goto :err
  .venv\Scripts\pip.exe install -r requirements.txt || goto :err
)

if not exist dist\index.html (
  call npm install || goto :err
  call npm run build || goto :err
)

start "" .venv\Scripts\pythonw.exe app.py
exit /b 0

:err
echo Ошибка подготовки окружения. Проверьте python и node в PATH.
pause
exit /b 1
