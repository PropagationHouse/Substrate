@echo off
echo Starting Substrate Remote Access Server...
echo.
echo This will start a web server that allows you to access Substrate remotely
echo via your ZeroTier network.
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

echo Starting server...
echo.
echo Press Ctrl+C to stop the server
echo.

REM Start the server
python "%SCRIPT_DIR%simple_test_server.py"

REM If we get here, the server has stopped
echo.
echo Server stopped.
pause
