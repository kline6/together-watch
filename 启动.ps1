Set-Location $PSScriptRoot
$Host.UI.RawUI.WindowTitle = "Watch Together"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   Watch Together - Sync Theater" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Checking Node.js..." -ForegroundColor Yellow
try {
    $nodeVer = & node --version 2>&1
    Write-Host "  Node.js $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Node.js not found. Install from https://nodejs.org" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "Starting services..." -ForegroundColor Yellow
Write-Host "  Frontend: http://localhost:5173" -ForegroundColor White
Write-Host "  Backend:  http://localhost:3001" -ForegroundColor White
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop" -ForegroundColor DarkGray
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

& npm run dev

Read-Host "Press Enter to exit"
