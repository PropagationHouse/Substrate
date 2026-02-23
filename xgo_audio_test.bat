@echo off
echo ===================================
echo XGO Audio Configuration Test
echo ===================================
echo.

echo [1/4] Testing SSH connection to XGO...
ssh -o ConnectTimeout=5 pi@10.0.0.144 "echo Connection successful"

echo.
echo [2/4] Checking audio devices on XGO...
ssh pi@10.0.0.144 "aplay -l"

echo.
echo [3/4] Checking audio volume settings...
ssh pi@10.0.0.144 "amixer"

echo.
echo [4/4] Testing audio playback directly...
ssh pi@10.0.0.144 "echo 'Testing audio playback...'; aplay -D plughw:0,0 /home/pi/audio/*.wav 2>&1 || echo 'No audio files found'"

echo.
echo ===================================
echo Audio test complete
echo ===================================
echo.
pause
