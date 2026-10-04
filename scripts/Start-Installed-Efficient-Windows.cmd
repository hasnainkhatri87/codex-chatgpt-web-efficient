@echo off
setlocal
set "APP=%~1"
if not defined APP (
  echo First close Codex Web GPT completely, including its tray icon.
  echo Paste the full path to the installed Codex Web GPT.exe, or drag that executable onto this file.
  set /p "APP=Executable path: "
)
set "APP=%APP:"=%"
if not exist "%APP%" (
  echo ERROR: The selected executable does not exist.
  exit /b 2
)
for %%F in ("%APP%") do set "APPNAME=%%~nxF"
if /i not "%APPNAME%"=="Codex Web GPT.exe" (
  echo ERROR: Select the installed Codex Web GPT.exe, not the installer.
  exit /b 2
)
set "CODEX_CHATGPT_WEB_RESOURCE_PROFILE=low"
set "CODEX_CHATGPT_WEB_MAX_TABS=5"
set "CODEX_CHATGPT_WEB_IDLE_TAB_SECONDS=300"
start "" "%APP%"
exit /b %errorlevel%
