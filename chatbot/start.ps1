Set-Location -Path $PSScriptRoot

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Starting Gemini Chatbot on Localhost   " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

if (-not (Test-Path "node_modules")) {
    Write-Host "[INFO] Installing dependencies..." -ForegroundColor Yellow
    npm install
}

Write-Host "[INFO] Opening http://localhost:3000 in browser..." -ForegroundColor Green
Start-Process "http://localhost:3000"

Write-Host "[INFO] Starting Next.js development server..." -ForegroundColor Green
npm run dev
