# PostToolUse hook: run tsc+vitest on FE edits, ruff+pytest on BE edits
# Exit 0 = pass (silent). Exit 2 = fail (wakes Claude with output).

$raw = $input | Out-String
try { $data = $raw | ConvertFrom-Json } catch { exit 0 }

$filePath = $data.tool_input.file_path
if (-not $filePath) { exit 0 }

$beRoot = "c:\Users\andri\Documents\WebDev\ADAM-backend"
$feRoot = "c:\Users\andri\Documents\WebDev\ADAM-frontend"

if ($filePath -like "*ADAM-backend*") {
    Set-Location $beRoot
    $ruff  = & "$beRoot\.venv\Scripts\ruff.exe" check $filePath 2>&1
    $ruffOk = $LASTEXITCODE -eq 0

    # derive module path from file path for targeted pytest
    $rel = $filePath -replace [regex]::Escape($beRoot + "\"), ""
    $testMod = $rel -replace "\\", "/" -replace "^app/", ""
    $pytest = & "$beRoot\.venv\Scripts\pytest.exe" -q --tb=short 2>&1
    $pytestOk = $LASTEXITCODE -eq 0

    if (-not $ruffOk -or -not $pytestOk) {
        Write-Host "=== BE check failed for: $filePath ==="
        if (-not $ruffOk)  { Write-Host "-- ruff --"; $ruff }
        if (-not $pytestOk){ Write-Host "-- pytest --"; $pytest }
        exit 2
    }
    exit 0
}

if ($filePath -like "*ADAM-frontend*") {
    Set-Location $feRoot
    $tsc = & npx tsc --noEmit 2>&1
    $tscOk = $LASTEXITCODE -eq 0

    # vitest related (only if vitest is configured)
    $vitestOk = $true
    $vitestOut = ""
    if (Test-Path "$feRoot\vitest.config.*") {
        $vitestOut = & npx vitest related $filePath --run 2>&1
        $vitestOk  = $LASTEXITCODE -eq 0
    }

    if (-not $tscOk -or -not $vitestOk) {
        Write-Host "=== FE check failed for: $filePath ==="
        if (-not $tscOk)    { Write-Host "-- tsc --"; $tsc }
        if (-not $vitestOk) { Write-Host "-- vitest --"; $vitestOut }
        exit 2
    }
    exit 0
}

exit 0
