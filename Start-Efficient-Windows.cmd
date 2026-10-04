@echo off
setlocal
cd /d "%~dp0"
where bun >nul 2>nul
if errorlevel 1 (
  echo Bun 1.4.0 is required. See EFFICIENT-FORK.md for setup.
  exit /b 1
)
call bun run app:efficient
exit /b %errorlevel%
