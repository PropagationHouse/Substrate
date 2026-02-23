@echo off
echo Adding Substrate Remote Access to Windows Startup...
echo.

REM Get the current directory
set SCRIPT_DIR=%~dp0
set STARTUP_SCRIPT=%SCRIPT_DIR%start_remote_access_background.bat
set STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup

REM Check if the startup script exists
if not exist "%STARTUP_SCRIPT%" (
    echo Startup script not found: %STARTUP_SCRIPT%
    pause
    exit /b 1
)

REM Create a shortcut in the Windows Startup folder
echo Set oWS = WScript.CreateObject("WScript.Shell") > "%TEMP%\create_shortcut.vbs"
echo sLinkFile = "%STARTUP_FOLDER%\Substrate Remote Access.lnk" >> "%TEMP%\create_shortcut.vbs"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%TEMP%\create_shortcut.vbs"
echo oLink.TargetPath = "%STARTUP_SCRIPT%" >> "%TEMP%\create_shortcut.vbs"
echo oLink.WorkingDirectory = "%SCRIPT_DIR%" >> "%TEMP%\create_shortcut.vbs"
echo oLink.Description = "Start Substrate Remote Access Server" >> "%TEMP%\create_shortcut.vbs"
echo oLink.Save >> "%TEMP%\create_shortcut.vbs"

REM Run the VBS script
cscript //nologo "%TEMP%\create_shortcut.vbs"

echo.
echo Substrate Remote Access has been added to Windows Startup.
echo The server will start automatically when you log in to Windows.
echo.
echo To remove it from startup, delete the shortcut from:
echo %STARTUP_FOLDER%
echo.
pause
