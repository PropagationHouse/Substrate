@echo off
echo Starting Substrate Remote Bridge...
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
if not exist "%SCRIPT_DIR%remote_bridge.py" (
    echo Server script not found: %SCRIPT_DIR%remote_bridge.py
    pause
    exit /b 1
)

REM Check if required packages are installed
python -c "import requests" >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Installing required packages...
    pip install requests flask
)

echo Starting bridge server...
echo.
echo Press Ctrl+C to stop the server
echo.

REM Start the server
python "%SCRIPT_DIR%remote_bridge.py"

REM If we get here, the server has stopped
echo.
echo Server stopped.
pause
