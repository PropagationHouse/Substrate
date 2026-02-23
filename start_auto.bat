@echo off
setlocal EnableDelayedExpansion
title TPXGO - Fully Automated Startup
color 0A

echo ===================================
echo Substrate with XGO Integration
echo ===================================
echo.

:: Set working directory to script location
cd "%~dp0"

:: Configuration settings
set XGO_IP=10.0.0.144
set XGO_USER=pi
set XGO_PASSWORD=raspberry
set XGO_PORT=22
set FLASK_PORT=5000
set TRITON_PATH=C:\Users\Bl0ck\Desktop\triton

:: Create necessary directories
echo [1/6] Creating directories...
if not exist "src\voice\temp" mkdir "src\voice\temp"
if not exist "XGO_Audio_Bridge\xgo_audio" mkdir "XGO_Audio_Bridge\xgo_audio"

:: Install dependencies - use compatible torch and torchvision versions
echo [2/6] Installing dependencies...
pip install flask watchdog pygame

:: Uninstall existing torch and torchvision to avoid conflicts
echo     Uninstalling existing torch packages...
pip uninstall -y torch torchvision

:: Install specific versions known to work together
echo     Installing compatible torch and torchvision versions...
pip install torch==1.13.1 torchvision==0.14.1

:: Start Triton Server
echo [3/6] Starting Triton Server...
if exist "%TRITON_PATH%\run.bat" (
    start "Triton Server" cmd /c "title Triton Server && color 0C && cd /d %TRITON_PATH% && run.bat"
    timeout /t 10 /nobreak > nul
) else (
    echo WARNING: Triton not found at %TRITON_PATH%. Voice synthesis may not work correctly.
)

:: Start XGO Audio Bridge
echo [4/6] Starting XGO Audio Bridge...
start "XGO Audio Bridge" cmd /c "title XGO Audio Bridge && color 0B && cd /d %cd% && python XGO_Audio_Bridge\standalone_xgo_bridge.py"
timeout /t 5 /nobreak > nul

:: Start Substrate
echo [5/7] Starting Substrate...
start "Substrate" cmd /c "title Substrate && color 0E && cd /d %cd% && python main.py"
timeout /t 5 /nobreak > nul

:: Start Speech Recognition
echo [6/7] Starting Speech Recognition...
start "Speech Recognition" cmd /c "title Speech Recognition && color 0D && cd /d %cd% && python speech_components\whisper_speech.py"
timeout /t 5 /nobreak > nul

:: Setup XGO connection
echo [7/7] Setting up XGO connection...
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 %XGO_USER%@%XGO_IP% -p %XGO_PORT% "echo XGO connection test" >nul 2>nul
if %errorlevel% equ 0 (
    echo XGO connection successful
    
    :: Transfer audio receiver script
    scp -P %XGO_PORT% -o StrictHostKeyChecking=no XGO_Audio_Bridge\xgo_audio_receiver_compatible.py %XGO_USER%@%XGO_IP%:~/xgo_audio_receiver.py >nul 2>nul
    
    :: Start audio receiver on XGO
    start "XGO Audio Receiver" cmd /c "title XGO Audio Receiver && color 09 && ssh -p %XGO_PORT% -o StrictHostKeyChecking=no %XGO_USER%@%XGO_IP% 'mkdir -p ~/audio && python3 ~/xgo_audio_receiver.py'
) else (
    echo WARNING: Could not connect to XGO. Audio forwarding to XGO will not work.
)

echo.
echo ===================================
echo All components started successfully!
echo ===================================
echo.
echo The following services are now running:
echo  - Triton Server (for voice synthesis)
echo  - XGO Audio Bridge (monitoring for new audio files)
echo  - Substrate (main application)
echo  - Speech Recognition (processing audio input)
echo  - XGO Audio Receiver (if XGO connection was successful)
echo.
echo This window will remain open to keep the services running.
echo Close this window ONLY when you want to shut down all services.
echo.
echo ===================================

:: Keep the window open
cmd /k
