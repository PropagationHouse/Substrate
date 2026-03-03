@echo off
setlocal

echo Starting Substrate...

:: Get the directory where this script is located
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

:: Skip Ollama check to speed up startup (we'll handle missing Ollama gracefully in the app)
set "SKIP_OLLAMA_CHECK=1"

:: Set environment variables to improve startup performance
set "NODE_OPTIONS=--no-warnings"
set "PYTHONUNBUFFERED=1"

:: Ensure PyAudio is installed in the venv before app starts
call venv\Scripts\activate
python -c "import pyaudio" 2>NUL
if errorlevel 1 (
    echo PyAudio not found, installing...
    pip install pyaudio || (
        echo PyAudio wheel install fallback...
        pip install --upgrade pip
        pip install --only-binary :all: pyaudio
    )
)
REM No deactivate needed in batch, just proceed

:: Start the application
call npm start

pause
echo Substrate has been closed.
endlocal
