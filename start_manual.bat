@echo off
setlocal EnableDelayedExpansion
title TPXGO - Manual Startup System
color 0A

echo ===================================
echo Substrate with XGO Integration
echo ===================================
echo.

:: Set working directory to script location
cd "%~dp0"

:: Configuration settings
set XGO_IP=192.168.4.1
set XGO_USER=root
set XGO_PASSWORD=123
set XGO_PORT=22
set FLASK_PORT=5000
set TRITON_PATH=C:\Users\Bl0ck\Desktop\triton

:: Create necessary directories
echo [1] Checking directory structure...
if not exist "src\voice\temp" mkdir "src\voice\temp"
if not exist "XGO_Audio_Bridge\xgo_audio" mkdir "XGO_Audio_Bridge\xgo_audio"
echo Directory structure checked.
echo.

:: Install dependencies
echo [2] Installing required packages...
pip install flask watchdog pygame
echo Base packages installed.
echo.

echo [3] Fixing torch/torchvision...
pip uninstall -y torchvision
pip install torchvision==0.15.2
echo Torchvision fixed.
echo.

echo ===================================
echo Setup complete! Now you need to:
echo ===================================
echo.
echo 1. Start Triton (if needed):
echo    Open a new command prompt and run:
echo    cd %TRITON_PATH% ^& run.bat
echo.
echo 2. Start the XGO Audio Bridge:
echo    Open a new command prompt and run:
echo    cd %cd% ^& python XGO_Audio_Bridge\standalone_xgo_bridge.py
echo.
echo 3. Start Substrate:
echo    Open a new command prompt and run:
echo    cd %cd% ^& python main.py
echo.
echo 4. Connect to XGO (if needed):
echo    Open a new command prompt and run:
echo    ssh %XGO_USER%@%XGO_IP% -p %XGO_PORT%
echo    Then run: python3 /root/xgo_audio_receiver.py
echo.
echo ===================================
echo Press any key to exit...
pause > nul
