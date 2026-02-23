@echo off
echo ===================================
echo Fixing Torch Installation
echo ===================================
echo.

echo Uninstalling existing torch packages...
pip uninstall -y torch torchvision

echo Installing specific torch version...
pip install torch==1.13.1+cu116 torchvision==0.14.1+cu116 --extra-index-url https://download.pytorch.org/whl/cu116

echo.
echo Installation complete. Press any key to exit...
pause > nul
