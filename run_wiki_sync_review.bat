@echo off
setlocal
cd /d "%~dp0"

echo.
echo === Wiki Sync Review ===
echo.

REM Discord summary: wiki-sync posts a run summary if a webhook is configured.
if exist "tools\wiki-sync.webhook.local" (
  echo Discord: webhook file found [tools\wiki-sync.webhook.local]
) else if defined COS_WIKI_SYNC_DISCORD_WEBHOOK (
  echo Discord: env webhook COS_WIKI_SYNC_DISCORD_WEBHOOK is set
) else (
  echo Discord: NOT configured - no summary will be posted
)
echo.

echo Optional Discord webhook:
echo   tools\wiki-sync.webhook.local   or env COS_WIKI_SYNC_DISCORD_WEBHOOK
echo.
echo Extra flags - pass any after the script name:
echo   --pvp           show only PvP-relevant changes
echo   --send-discord  post the run summary to Discord
echo   --no-apply      preview only; do not write / commit / push
echo   --icons-all     backfill icons for every creature missing one
echo   --all           sync all creatures
echo.
echo Applied changes are committed and pushed to prod after confirmations.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js not found on PATH. Install Node 20+ and retry.
  echo.
  pause
  exit /b 1
)

node --import tsx tools/wiki-sync.ts --push-prod %*
set EXIT_CODE=%ERRORLEVEL%

echo.
if not "%EXIT_CODE%"=="0" (
  echo Wiki sync review FAILED with exit code %EXIT_CODE%.
) else (
  echo Wiki sync review finished.
)
echo.
pause
exit /b %EXIT_CODE%
