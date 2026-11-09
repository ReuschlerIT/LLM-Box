@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js wurde nicht gefunden. Bitte installieren: https://nodejs.org  ^(LTS-Version^)
  pause
  exit /b 1
)
if not exist node_modules (
  echo Erster Start: Abhaengigkeiten werden installiert ...
  call npm install
  if errorlevel 1 ( echo Installation fehlgeschlagen. & pause & exit /b 1 )
)
call npm start
