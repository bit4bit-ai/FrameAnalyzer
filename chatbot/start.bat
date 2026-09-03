@echo off
cd /d "%~dp0"

echo ==========================================
echo   Starting Gemini Chatbot on Localhost
echo ==========================================

if not exist "node_modules\" (
    echo [INFO] Installing dependencies...
    call npm install
)

echo [INFO] Opening http://localhost:3000 in your browser...
start http://localhost:3000

echo [INFO] Starting Next.js development server...
call npm run dev
