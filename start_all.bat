@echo off
echo Starting Substrate XGO Avatar System
echo =====================================

:: Start start_auto.bat
echo Starting start_auto.bat...
start "" start_auto.bat

:: Wait a moment
timeout /t 2 /nobreak >nul

:: Start the avatar display
echo Starting XGO avatar display...
start "" start.bat

:: Start the remote audio server
echo Starting Remote Audio Server...
start "Remote Audio Server" cmd /c "cd /d C:\Users\Bl0ck\Desktop\TPXGO && python home_pc_server.py"

echo.
echo All systems started!
echo The Substrate avatar should now be running on your XGO Rider.
echo Remote Audio Server is running to process audio from XGO when remote.
