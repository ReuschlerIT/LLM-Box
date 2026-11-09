@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js wurde nicht gefunden. Bitte installieren: https://nodejs.org
  pause
  exit /b 1
)
call npm install
if errorlevel 1 ( echo Installation fehlgeschlagen. & pause & exit /b 1 )
call npm run dist
echo.
echo Fertig. Installer und portable EXE liegen im Ordner "dist".
pause
