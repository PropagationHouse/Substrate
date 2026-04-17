@echo off
setlocal enabledelayedexpansion

set "SUBSTRATE_VERSION=1.2.0"

echo ===================================
echo Substrate Setup / Update  v%SUBSTRATE_VERSION%
echo ===================================
echo.

:: Detect fresh install vs update
set "IS_UPDATE=0"
if exist venv (
    if exist .deps_installed (
        set "IS_UPDATE=1"
    )
)

if "%IS_UPDATE%"=="1" (
    echo Detected existing installation — running UPDATE.
    echo.
) else (
    echo Running FRESH INSTALL.
    echo.
)

:: Check if Python is installed — auto-install if missing
python --version > nul 2>&1
if %errorlevel% neq 0 (
    echo Python not found. Downloading Python 3.12 automatically...
    set "PY_URL=https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe"
    set "PY_INSTALLER=%TEMP%\python-3.12.10-amd64.exe"
    curl -L -o "%PY_INSTALLER%" "%PY_URL%"
    if %errorlevel% neq 0 (
        echo Failed to download Python. Please install manually from https://python.org
        pause
        exit /b 1
    )
    echo Installing Python silently...
    "%PY_INSTALLER%" /quiet InstallAllUsers=0 PrependPath=1 Include_pip=1 Include_venv=1 Include_launcher=1 Include_test=0 Include_doc=0
    if %errorlevel% neq 0 (
        echo Python installation failed. Please install manually from https://python.org
        pause
        exit /b 1
    )
    del "%PY_INSTALLER%" > nul 2>&1
    :: Refresh PATH for this session
    for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "PATH=%%B;%PATH%"
    python --version > nul 2>&1
    if %errorlevel% neq 0 (
        echo Python installed but not found in PATH. Please restart this script.
        pause
        exit /b 1
    )
    echo Python installed successfully!
)

:: Check if Node.js is installed
node --version > nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js is not installed or not in PATH. Please install Node.js 14 or higher.
    pause
    exit /b 1
)

:: Check if Ollama is installed
where ollama > nul 2>&1
if %errorlevel% neq 0 (
    echo WARNING: Ollama not found in PATH. Substrate requires Ollama for local LLM functionality.
    echo Please install Ollama from https://ollama.com/
    echo.
    echo Press any key to continue setup anyway...
    pause > nul
)

:: ── Virtual environment ──────────────────────────────────────────────
if "%IS_UPDATE%"=="0" (
    echo Creating virtual environment...
    if exist venv (
        echo Found existing virtual environment, removing...
        rmdir /s /q venv
    )
    python -m venv venv
)
call venv\Scripts\activate.bat

:: ── Python dependencies ──────────────────────────────────────────────
echo.
if "%IS_UPDATE%"=="1" (
    echo Updating Python dependencies...
) else (
    echo Installing Python dependencies...
)
python -m pip install --upgrade pip
echo Installing PyTorch with CUDA support...
pip install torch==2.5.1+cu121 --index-url https://download.pytorch.org/whl/cu121
pip install -r requirements.txt

:: ── Node.js dependencies ─────────────────────────────────────────────
echo.
if "%IS_UPDATE%"=="1" (
    echo Updating Node.js dependencies...
) else (
    echo Installing Node.js dependencies...
)
call npm install

:: ── Build Dashboard ────────────────────────────────────────────────
echo.
echo Building Substrate Dashboard...
pushd dashboard
call npm install
call npx vite build
popd
if exist dashboard\dist\index.html (
    echo   Dashboard built successfully.
) else (
    echo   WARNING: Dashboard build may have failed. You can rebuild later with: cd dashboard ^& npx vite build
)

:: ── Create all required directories ──────────────────────────────
echo.
echo Ensuring all directories exist...
for %%D in (
    profiles
    knowledge
    workspace
    workspace\recordings
    workspace\emergent
    workspace\output
    workspace\temp
    data
    data\events
    data\sounds
    logs
    uploads
    screenshots
    config
    skills
    certs
) do (
    if not exist "%%D" (
        mkdir "%%D"
        echo   Created %%D
    )
)

:: ── Default config ───────────────────────────────────────────────────
echo.
if not exist config.json (
    echo Creating default configuration from config.example.json...
    copy config.example.json config.json > nul
    echo   config.json created — configure your model and API endpoint before starting.
) else (
    echo Configuration file already exists, keeping current settings.
)

:: ── Write version marker ─────────────────────────────────────────────
echo %SUBSTRATE_VERSION%> .deps_installed

echo.
echo ===================================
if "%IS_UPDATE%"=="1" (
    echo Update to v%SUBSTRATE_VERSION% complete!
) else (
    echo Fresh install v%SUBSTRATE_VERSION% complete!
)
echo.
echo To start Substrate, run start.bat
echo ===================================
echo.
pause
endlocal
