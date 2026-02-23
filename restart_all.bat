@echo off
echo Restarting all components...
echo.

echo Stopping any running processes...
taskkill /f /im python.exe /fi "WINDOWTITLE eq Command Server*" 2>nul
taskkill /f /im python.exe /fi "WINDOWTITLE eq Remote Bridge*" 2>nul
timeout /t 2 > nul

echo Starting Command Server with Response Server...
start "Command Server" cmd /k "python command_server.py"
timeout /t 2 > nul

echo Starting Remote Bridge...
start "Remote Bridge" cmd /k "python remote_bridge.py"

echo.
echo All components restarted!
echo.
echo Press any key to exit...
pause > nul
