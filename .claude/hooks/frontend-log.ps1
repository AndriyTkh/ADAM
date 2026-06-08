# Injects last N lines of frontend.log + backend.log (browser errors go there via /client-log)
# Strips ANSI escape codes so content is readable

$ansi = [regex]'\x1B\[[0-9;]*[mGKHF]|\x1B\[\?[0-9;]*[hl]|\x1B\([AB]|\x1B[>=]|\r'

function Show-Log($path, $label, $tail) {
    if (-not (Test-Path $path)) {
        Write-Output "=== ${label}: not found ==="
        return
    }
    try {
        $lines = Get-Content $path -Encoding UTF8 -Tail $tail -ErrorAction Stop
    } catch {
        # fallback UTF-16 (old logs before fix)
        try { $lines = Get-Content $path -Encoding Unicode -Tail $tail -ErrorAction Stop } catch {
            Write-Output "=== ${label}: read error: $($_.Exception.Message) ==="; return
        }
    }
    if (-not $lines -or $lines.Count -eq 0) { Write-Output "=== ${label}: empty ==="; return }
    $clean = $lines | ForEach-Object { $ansi.Replace($_, '') } | Where-Object { $_.Trim() -ne '' }
    Write-Output "=== $label (last $($clean.Count) lines) ==="
    $clean | ForEach-Object { Write-Output $_ }
    Write-Output "=== end $label ==="
}

Show-Log 'c:\Users\andri\Documents\WebDev\ADAM\logs\frontend.log' 'frontend.log' 30
Show-Log 'c:\Users\andri\Documents\WebDev\ADAM\logs\backend.log'  'backend.log (includes browser errors via /client-log)' 40
