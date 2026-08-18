@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js not found on PATH. Install Node 20+ and retry.
  echo.
  pause
  exit /b 1
)

node --import tsx tools/early-changes.ts --menu %*
set EXIT_CODE=%ERRORLEVEL%
if not "%EXIT_CODE%"=="0" (
  echo.
  echo Early changes exited with code %EXIT_CODE%.
  pause
)
exit /b %EXIT_CODE%
