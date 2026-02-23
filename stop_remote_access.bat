@echo off
echo Stopping Substrate Remote Bridge System...
echo.

REM Kill all Python processes except the main app
echo Stopping all remote bridge processes...
taskkill /f /im python.exe /fi "WINDOWTITLE eq *Command Server*" 2>nul
taskkill /f /im python.exe /fi "WINDOWTITLE eq *Remote Bridge*" 2>nul
taskkill /f /im python.exe /fi "WINDOWTITLE eq *IPC Server*" 2>nul
taskkill /f /im python.exe /fi "WINDOWTITLE eq *Test IPC Server*" 2>nul

REM Wait a moment to ensure processes are terminated
timeout /t 2 > nul

echo.
echo Remote Bridge System has been stopped.
echo.
echo Press any key to exit...
pause > nul
