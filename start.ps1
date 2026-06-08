# ADAM dev startup — launches backend (FastAPI) + frontend (Vite) in parallel
# Usage: .\start.ps1
# Logs: ADAM/logs/backend.log + ADAM/logs/frontend.log (tail -f to follow)

$ErrorActionPreference = "Stop"

$root        = $PSScriptRoot
$backendDir  = Join-Path (Split-Path $root -Parent) "ADAM-backend"
$frontendDir = Join-Path (Split-Path $root -Parent) "ADAM-frontend"
$venv        = Join-Path $backendDir ".venv\Scripts\python.exe"
$pidFile     = Join-Path $root ".adam-pids"
$logsDir     = Join-Path $root "logs"
$backendLog  = Join-Path $logsDir "backend.log"
$frontendLog = Join-Path $logsDir "frontend.log"

if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory $logsDir | Out-Null }

$BackendTitle  = "ADAM - backend"
$FrontendTitle = "ADAM - frontend"

if (-not (Test-Path $backendDir))  { Write-Error "Backend not found: $backendDir";  exit 1 }
if (-not (Test-Path $frontendDir)) { Write-Error "Frontend not found: $frontendDir"; exit 1 }
if (-not (Test-Path $venv))        { Write-Error ".venv not found. Run: python -m venv .venv && pip install -r requirements.txt"; exit 1 }

# 0. Close previous instances
Write-Host "[0/2] Closing previous instances..." -ForegroundColor DarkGray

if (Test-Path $pidFile) {
    Get-Content $pidFile | ForEach-Object {
        $p = $_.Trim()
        if ($p -match '^\d+$') {
            Write-Host "  killing tree PID $p" -ForegroundColor DarkGray
            try { taskkill /PID $p /T /F | Out-Null } catch {}
        }
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

# Fallback: cmdline match for untracked launches
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    ($_.CommandLine -like '*uvicorn*') -or
    ($_.CommandLine -like '*ADAM-frontend*')
} | ForEach-Object {
    Write-Host "  cmdline-kill PID $($_.ProcessId)" -ForegroundColor DarkGray
    try { taskkill /PID $_.ProcessId /T /F | Out-Null } catch {}
}

Start-Sleep -Milliseconds 500

# 1. Backend
Write-Host "[1/2] Backend (http://localhost:8000)..." -ForegroundColor Cyan

$backendProc = Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "`$host.UI.RawUI.WindowTitle = '$BackendTitle'; `$ErrorActionPreference = 'SilentlyContinue'; cd '$backendDir'; Write-Host 'ADAM backend' -ForegroundColor Cyan; .venv\Scripts\Activate.ps1; `$env:PYTHONUNBUFFERED=1; uvicorn app.main:app --reload --port 8000 2>&1 | Tee-Object -FilePath '$backendLog'"
) -PassThru

Start-Sleep -Seconds 1

# 2. Frontend
Write-Host "[2/2] Frontend (http://localhost:5173)..." -ForegroundColor Cyan

$frontendProc = Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "`$host.UI.RawUI.WindowTitle = '$FrontendTitle'; cd '$frontendDir'; Write-Host 'ADAM frontend' -ForegroundColor Cyan; '' | Out-File '$frontendLog' -Encoding utf8; npm run dev 2>&1 | ForEach-Object { `$_; `$_ | Out-File '$frontendLog' -Encoding utf8 -Append }"
) -PassThru

# Save PIDs for next kill (taskkill /T covers child processes)
@($backendProc.Id, $frontendProc.Id) | Set-Content $pidFile

Write-Host ""
Write-Host "Backend  PID: $($backendProc.Id)  log: $backendLog" -ForegroundColor Green
Write-Host "Frontend PID: $($frontendProc.Id)  log: $frontendLog" -ForegroundColor Green
Write-Host "Done. Re-run .\start.ps1 to restart cleanly." -ForegroundColor Green
