param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSCommandPath
$healthUrl = 'http://127.0.0.1:8765/v1/health'
$previewUrl = $env:SMARTFLOW_PREVIEW_URL
if ([string]::IsNullOrWhiteSpace($previewUrl)) {
    $previewUrl = 'http://127.0.0.1:5173/'
}
$previewUrl = $previewUrl.Trim()

function Fail([string]$Message) {
    Write-Host ''
    Write-Host ('BLAD: ' + $Message) -ForegroundColor Red
    Write-Host ''
    if (-not $NoBrowser) { Read-Host 'Nacisnij Enter, aby zamknac' | Out-Null }
    exit 1
}

function Read-BridgeStartupStatus([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $null
    }

    try {
        return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json)
    } catch {
        return $null
    }
}

function Test-BridgeHealth {
    try {
        $response = Invoke-RestMethod -Method Get -Uri $healthUrl -TimeoutSec 2
        return [bool]($response -and $response.ok -eq $true -and $response.read_only -eq $true)
    } catch {
        return $false
    }
}

function Test-LocalMatrix {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173/src/SmartFlowShell.tsx' -TimeoutSec 2
        return ($response.StatusCode -eq 200 -and $response.Content.Contains('sf-matrix'))
    } catch { return $false }
}

function Start-LocalMatrix {
    if (Test-LocalMatrix) { return }
    $listener = Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue
    if ($listener) { Fail 'Port 5173 jest zajety przez inny widok. Zatrzymaj poprzedni serwer terminalu i uruchom ponownie.' }
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { Fail 'Nie wykryto Node.js. Zainstaluj Node.js, aby uruchomic lokalny terminal.' }
    $vite = Join-Path $root 'node_modules\vite\bin\vite.js'
    if (-not (Test-Path -LiteralPath $vite)) { Fail 'Brakuje zaleznosci terminalu. W katalogu projektu wykonaj npm ci.' }
    $runtimeDir = Join-Path $root '.smartflow-runtime'
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    $runId = [Guid]::NewGuid().ToString('N')
    $viteProcess = Start-Process -FilePath $node.Source -ArgumentList @(('"' + $vite + '"'), '--host', '127.0.0.1', '--port', '5173', '--strictPort') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDir ($runId + '.out.log')) -RedirectStandardError (Join-Path $runtimeDir ($runId + '.err.log')) -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-LocalMatrix) { Write-Host '    Lokalny Matrix dziala.' -ForegroundColor Green; return }
        $viteProcess.Refresh()
        if ($viteProcess.HasExited) { Fail ('Serwer terminalu zakonczyl dzialanie. Sprawdz logi w ' + $runtimeDir) }
        Start-Sleep -Milliseconds 250
    }
    Fail ('Terminal nie odpowiedzial w 30 sekund. Sprawdz logi w ' + $runtimeDir)
}

function Stop-IfBridgeFailed([System.Diagnostics.Process]$Process, [string]$StatusPath) {
    $Process.Refresh()
    $status = Read-BridgeStartupStatus $StatusPath

    if ($status -and $status.state -eq 'error') {
        Fail ('Bridge nie wystartowal: ' + $status.message)
    }

    if ($Process.HasExited) {
        $detail = ''
        if ($status -and $status.message) {
            $detail = ' Szczegoly: ' + $status.message
        }
        Fail ('Proces PowerShell bridge zakonczyl dzialanie (kod ' + $Process.ExitCode + ').' + $detail)
    }
}

Write-Host ''
Write-Host '==========================================' -ForegroundColor DarkGray
Write-Host '  TERMINAL RYNKOWY - URUCHAMIANIE' -ForegroundColor Cyan
Write-Host '==========================================' -ForegroundColor DarkGray
Write-Host ''

try {
    Write-Host '1/3 Sprawdzam MetaTrader 5...' -ForegroundColor Cyan
    $terminal = Get-Process -Name 'terminal64','terminal' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $terminal) {
        Fail 'Nie wykryto MetaTrader 5. Uruchom MT5 i kliknij START_SMARTFLOW_X.cmd ponownie.'
    }
    Write-Host '    MT5 dziala.' -ForegroundColor Green

    Write-Host '2/3 Otwieram ekran wczytywania terminalu...' -ForegroundColor Cyan
    $targetUri = [Uri]$previewUrl
    if ($targetUri.Host -in @('127.0.0.1', 'localhost') -and $targetUri.Port -eq 5173) { Start-LocalMatrix }
    $launchUri = [UriBuilder]::new($targetUri)
    $bootToken = [Guid]::NewGuid().ToString('N')
    $existingQuery = $targetUri.Query.TrimStart('?')
    $launchUri.Query = if ([string]::IsNullOrWhiteSpace($existingQuery)) { 'boot=' + $bootToken } else { $existingQuery + '&boot=' + $bootToken }
    if (-not $NoBrowser) { Start-Process -FilePath $launchUri.Uri.AbsoluteUri }

    Write-Host '3/3 Uruchamiam i sprawdzam most MT5...' -ForegroundColor Cyan
    $healthy = Test-BridgeHealth

    if (-not $healthy) {
        $bridgeDir = Join-Path $root 'mt5-bridge'
        $bridgeScript = Join-Path $bridgeDir 'start.ps1'

        if (-not (Test-Path -LiteralPath $bridgeScript -PathType Leaf)) {
            Fail 'Nie znaleziono mt5-bridge\start.ps1. Pobierz i rozpakuj caly projekt.'
        }

        $python = Get-Command py,python -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandType -eq 'Application' } |
            Select-Object -First 1
        if (-not $python) {
            Fail 'Nie wykryto Pythona. Zainstaluj Python x64 z opcja Add Python to PATH.'
        }

        $startupStatusPath = Join-Path ([System.IO.Path]::GetTempPath()) (
            'SmartFlowX-Bridge-' + [Guid]::NewGuid().ToString('N') + '.json'
        )
        $powershellExe = Join-Path $PSHOME 'powershell.exe'
        if (-not (Test-Path -LiteralPath $powershellExe)) { $powershellExe = Join-Path $PSHOME 'pwsh.exe' }
        $arguments = @(
            '-NoLogo',
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            ('"' + $bridgeScript + '"'),
            '-StartupStatusPath',
            ('"' + $startupStatusPath + '"')
        )

        Write-Host '    Uruchamiam bridge w tle...' -ForegroundColor Yellow
        try {
            $bridgeProcess = Start-Process -FilePath $powershellExe -ArgumentList $arguments -WorkingDirectory $bridgeDir -WindowStyle Hidden -PassThru
        } catch {
            Fail ('Nie udalo sie otworzyc osobnego okna PowerShell. ' + $_.Exception.Message)
        }

        if (-not $bridgeProcess) {
            Fail 'Start-Process nie zwrocil procesu PowerShell dla bridge.'
        }

        Stop-IfBridgeFailed $bridgeProcess $startupStatusPath
        Write-Host ('    Okno PowerShell uruchomione (PID ' + $bridgeProcess.Id + ').') -ForegroundColor Green

        $startupDeadline = [DateTime]::UtcNow.AddSeconds(10)
        $startupStatus = Read-BridgeStartupStatus $startupStatusPath
        while (-not $startupStatus -and [DateTime]::UtcNow -lt $startupDeadline) {
            Stop-IfBridgeFailed $bridgeProcess $startupStatusPath
            $startupStatus = Read-BridgeStartupStatus $startupStatusPath
            if (-not $startupStatus) {
                Start-Sleep -Milliseconds 250
            }
        }

        Stop-IfBridgeFailed $bridgeProcess $startupStatusPath
        if (-not $startupStatus) {
            Fail 'Okno PowerShell zostalo otwarte, ale mt5-bridge\start.ps1 nie potwierdzil startu w 10 sekund. Sprawdz sciezke i komunikat w oknie bridge.'
        }

        Write-Host '    Proces bridge dziala. Czekam na health endpoint...' -ForegroundColor Yellow
        $deadline = [DateTime]::UtcNow.AddSeconds(120)
        $healthy = $false

        while ([DateTime]::UtcNow -lt $deadline) {
            Stop-IfBridgeFailed $bridgeProcess $startupStatusPath
            $healthy = Test-BridgeHealth
            if ($healthy) {
                break
            }
            Start-Sleep -Milliseconds 750
        }

        if (-not $healthy) {
            $lastStatus = Read-BridgeStartupStatus $startupStatusPath
            $lastStage = ''
            if ($lastStatus -and $lastStatus.message) {
                $lastStage = ' Ostatni etap: ' + $lastStatus.message
            }
            Fail ('PowerShell bridge dziala (PID ' + $bridgeProcess.Id + '), ale health endpoint nie odpowiedzial w 120 sekund.' + $lastStage + ' Sprawdz osobne okno PowerShell.')
        }

        Remove-Item -LiteralPath $startupStatusPath -Force -ErrorAction SilentlyContinue
    }

    Write-Host '    Bridge dziala w trybie READ ONLY.' -ForegroundColor Green

    Write-Host ''
    Write-Host 'GOTOWE - terminal i most MT5 dzialaja.' -ForegroundColor Green
    Write-Host 'Zostaw MT5 uruchomiony. Zamkniecie terminalu zatrzyma most.' -ForegroundColor DarkGray
    Write-Host ''
    Start-Sleep -Seconds 2
    exit 0
} catch {
    Fail $_.Exception.Message
}
