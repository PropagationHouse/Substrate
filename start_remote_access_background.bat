@echo off
echo Starting Substrate Remote Access Server in background...
echo.

REM Get the current directory
set SCRIPT_DIR=%~dp0

REM Check if Python is available
where python >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Python not found in PATH. Please make sure Python is installed.
    pause
    exit /b 1
)

REM Check if the server script exists
if not exist "%SCRIPT_DIR%simple_test_server.py" (
    echo Server script not found: %SCRIPT_DIR%simple_test_server.py
    pause
    exit /b 1
)

REM Create a VBS script to run the Python script without a window
echo Set WshShell = CreateObject("WScript.Shell") > "%TEMP%\run_hidden.vbs"
echo WshShell.Run "cmd /c cd /d %SCRIPT_DIR% && python simple_test_server.py > remote_access.log 2>&1", 0, False >> "%TEMP%\run_hidden.vbs"

REM Run the VBS script
start /b "" wscript.exe "%TEMP%\run_hidden.vbs"

echo.
echo Remote access server started in background.
echo Log file: %SCRIPT_DIR%remote_access.log
echo.
echo To access the server:
echo 1. Make sure your device is connected to the ZeroTier network
echo 2. Open a browser and navigate to http://YOUR_ZEROTIER_IP:8080
echo.
echo To stop the server, use Task Manager to end the Python process.
echo.
timeout /t 5
