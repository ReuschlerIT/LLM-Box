@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js wurde nicht gefunden. Bitte installieren: https://nodejs.org
  pause
  exit /b 1
)

rem Die Versionsnummer der EXE steht nur in package.json ("version"). Hier wird sie vor dem Bauen angezeigt und bei Bedarf geaendert.
for /f "usebackq delims=" %%v in (`node -p "require('./package.json').version"`) do set CUR=%%v
set NEW=%~1
if "%NEW%"=="" (
  echo Aktuelle Version in package.json: %CUR%
  set /p NEW=Version fuer diesen Build eingeben [Enter = %CUR% behalten]: 
)
if "%NEW%"=="" set NEW=%CUR%
if not "%NEW%"=="%CUR%" (
  call npm version %NEW% --no-git-tag-version --allow-same-version
  if errorlevel 1 ( echo Ungueltige Versionsnummer "%NEW%". Beispiel: 1.0.25 & pause & exit /b 1 )
)
echo.
echo Es wird Version %NEW% gebaut.
echo.

call npm install
if errorlevel 1 ( echo Installation fehlgeschlagen. & pause & exit /b 1 )
call npm run dist
if errorlevel 1 ( echo Build fehlgeschlagen. & pause & exit /b 1 )
echo.
echo Fertig: Version %NEW%. Installer und portable EXE liegen im Ordner "dist":
dir /b dist\*%NEW%*.exe
pause
