@echo off
echo Installing required dependencies for Substrate Remote Bridge...
echo.

echo Installing Flask for web server...
pip install flask flask-cors
echo.

echo Installing requests for API communication...
pip install requests
echo.

echo Installing pywin32 for named pipe communication...
pip install pywin32
echo.

echo Installing additional utilities...
pip install python-dateutil
echo.

echo Dependencies installed successfully!
echo.
echo Press any key to exit...
pause > nul
