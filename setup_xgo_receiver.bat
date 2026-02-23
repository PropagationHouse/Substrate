@echo off
echo ===================================
echo XGO Audio Receiver Setup
echo ===================================
echo.

:: Configuration settings
set XGO_IP=10.147.17.147
set XGO_USER=pi
set XGO_PASSWORD=raspberry
set XGO_PORT=22

echo [1/3] Transferring audio receiver script to XGO...
scp -P %XGO_PORT% -o StrictHostKeyChecking=no XGO_Audio_Bridge\xgo_audio_receiver.py %XGO_USER%@%XGO_IP%:/root/

echo [2/3] Creating audio directory on XGO...
ssh -p %XGO_PORT% -o StrictHostKeyChecking=no %XGO_USER%@%XGO_IP% "mkdir -p /root/audio"

echo [3/3] Starting audio receiver on XGO...
start "XGO Audio Receiver" cmd /c "ssh -p %XGO_PORT% -o StrictHostKeyChecking=no %XGO_USER%@%XGO_IP% 'python3 /root/xgo_audio_receiver.py'"

echo.
echo ===================================
echo XGO Audio Receiver setup complete!
echo ===================================
echo.
echo A new terminal window should have opened running the audio receiver.
echo If you don't see it, check your SSH connection to the XGO device.
echo.
pause
