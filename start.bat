@echo off
setlocal
title FrameAnalyzer

cd /d "%~dp0"

echo ===================================================
echo             Starting FrameAnalyzer
echo ===================================================
echo.

:: 1. Check if Node.js is installed
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not found in PATH!
    echo Please install Node.js from https://nodejs.org/ to run this app.
    echo.
    pause
    exit /b 1
)

:: 2. Check for environment file (.env.local or .env)
if not exist ".env.local" (
    if not exist ".env" (
        echo [INFO] No .env.local found. Creating a template .env.local...
        (
            echo # Gemini API Key for FrameAnalyzer
            echo GEMINI_API_KEY=
        ) > .env.local
        echo [NOTICE] Created .env.local. Please make sure to add your Gemini API key!
        echo.
    )
)

:: 3. Check and install dependencies if node_modules is missing
if not exist "node_modules\" (
    echo [INFO] node_modules folder not found. Installing dependencies...
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo.
        echo [ERROR] Dependency installation failed!
        pause
        exit /b %ERRORLEVEL%
    )
    echo [INFO] Dependencies installed successfully.
    echo.
)

:: 4. Start the development server and open browser
echo [INFO] Starting Vite development server...
echo [INFO] App will be available at http://localhost:3000/
echo.

call npm run dev -- --open

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Application exited with an error code.
    pause
)
