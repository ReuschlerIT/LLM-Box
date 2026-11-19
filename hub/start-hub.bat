@echo off
rem LLM Box Hub starten (Windows). Daten: %USERPROFILE%\.llm-box-hub
cd /d "%~dp0"
node hub.js %*
pause
