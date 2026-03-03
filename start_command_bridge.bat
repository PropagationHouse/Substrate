@echo off
echo Starting Substrate Remote Bridge System...
echo.

echo IMPORTANT: For full functionality, you need to integrate with your main app.
echo Have you added the command pipe server to your main Substrate application? (Y/N)
set /p integrated=

if /i "%integrated%"=="N" (
    echo.
    echo Would you like to run the integration script to automatically integrate with your main app? (Y/N)
    set /p run_integration=
    
    if /i "%run_integration%"=="Y" (
        echo.
        echo Running integration script...
        python integrate_with_main_app.py
        echo.
        echo Integration complete. Please restart your main Substrate application.
        echo Press any key to continue...
        pause > nul
    ) else (
        echo.
        echo Please follow these steps to integrate with your main app:
        echo 1. Open your main Substrate application code (proxy_server.py)
        echo 2. Add the following code at the top of the file:
        echo    from main_app_integration import start_command_pipe_server
        echo 3. Add the following line after your agent is initialized:
        echo    start_command_pipe_server(agent)
        echo 4. Restart your main Substrate application
        echo.
        echo Press any key to continue anyway...
        pause > nul
    )
)

echo Step 1: Starting Command Server with Response Server...
start "Command Server" cmd /k "python command_server.py"
timeout /t 2 > nul

echo Step 2: Starting Remote Bridge...
start "Remote Bridge" cmd /k "python remote_bridge.py"

echo.
echo System started! You can access the remote interface at:
echo http://localhost:8080 (Local)
ipconfig | findstr "IPv4" | findstr "10.147"
echo.
echo For full functionality:
echo 1. Main Substrate application should be running with command pipe integration
echo 2. Command Server is running
echo 3. Remote Bridge is running
echo.
echo Your ZeroTier IP address is shown above.
echo.
echo Press any key to exit this window...
pause > nul
