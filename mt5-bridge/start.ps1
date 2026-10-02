param(
    [string]$StartupStatusPath,
    [string]$RuntimeRoot
)

$ErrorActionPreference = 'Stop'
$BridgeRoot = [System.IO.Path]::GetDirectoryName($PSCommandPath)
if ([string]::IsNullOrWhiteSpace($RuntimeRoot)) {
    $RuntimeRoot = $BridgeRoot
} else {
    [System.IO.Directory]::CreateDirectory($RuntimeRoot) | Out-Null
}

function Write-BridgeStartupStatus([string]$State, [string]$Message) {
    if ([string]::IsNullOrWhiteSpace($StartupStatusPath)) {
        return
    }

    try {
        $status = @{
            state = $State
            message = $Message
            process_id = $PID
            updated_at = (Get-Date).ToString('o')
        }
        $json = $status | ConvertTo-Json -Compress
        [System.IO.File]::WriteAllText($StartupStatusPath, $json, [System.Text.UTF8Encoding]::new($false))
    } catch {
        # Startup status is diagnostic only; never block the bridge on a log write.
    }
}

try {
    Write-BridgeStartupStatus 'starting' 'PowerShell opened start.ps1.'
    # Use .NET path operations below: hidden GUI-launched PowerShell can have
    # no active FileSystem drive for PowerShell's Join-Path provider.
    $pythonCommand = Get-Command py,python -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandType -eq 'Application' } |
        Select-Object -First 1

    if (-not $pythonCommand) {
        throw 'Python nie jest zainstalowany lub nie ma go w PATH. Zainstaluj Python x64.'
    }

    $venvDirectory = [System.IO.Path]::Combine($RuntimeRoot, '.venv')
    $venvPython = [System.IO.Path]::Combine($venvDirectory, 'Scripts\python.exe')
    $requirementsFile = [System.IO.Path]::Combine($BridgeRoot, 'requirements.txt')
    $bridgeFile = [System.IO.Path]::Combine($BridgeRoot, 'bridge.py')

    if (-not [System.IO.File]::Exists($venvPython)) {
        Write-BridgeStartupStatus 'starting' 'Tworze srodowisko Python .venv.'
        Write-Host 'Tworze srodowisko Python .venv...' -ForegroundColor Yellow
        & $pythonCommand.Source -m venv $venvDirectory
        $venvExitCode = $LASTEXITCODE
        if ($venvExitCode -ne 0 -or -not [System.IO.File]::Exists($venvPython)) {
            throw ('Nie udalo sie utworzyc srodowiska .venv (kod ' + $venvExitCode + ').')
        }
    }

    Write-BridgeStartupStatus 'starting' 'Sprawdzam wymagane pakiety Python.'
    $packagesReady = $false
    try {
        & $venvPython -c 'import MetaTrader5, fastapi, uvicorn' 2>$null
        $packagesReady = ($LASTEXITCODE -eq 0)
    } catch {
        $packagesReady = $false
    }

    if (-not $packagesReady) {
        Write-BridgeStartupStatus 'starting' 'Instaluje brakujace pakiety z requirements.txt.'
        Write-Host 'Instaluje brakujace pakiety MT5 Bridge...' -ForegroundColor Yellow
        & $venvPython -m pip install -r $requirementsFile
        $pipExitCode = $LASTEXITCODE
        if ($pipExitCode -ne 0) {
            throw ('Instalacja requirements.txt nie powiodla sie (kod ' + $pipExitCode + ').')
        }

        & $venvPython -c 'import MetaTrader5, fastapi, uvicorn'
        $verifyExitCode = $LASTEXITCODE
        if ($verifyExitCode -ne 0) {
            throw ('Weryfikacja pakietow Python nie powiodla sie (kod ' + $verifyExitCode + ').')
        }
    } else {
        Write-Host 'Wymagane pakiety sa juz gotowe; pomijam pip install.' -ForegroundColor Green
    }

    Write-Host ''
    Write-Host 'Uruchamiam CRT Terminal MT5 Local Bridge...' -ForegroundColor Cyan
    Write-Host 'MT5 powinien byc uruchomiony i zalogowany na konto brokerskie.' -ForegroundColor Yellow
    Write-Host 'Adres: http://127.0.0.1:8765/v1/health' -ForegroundColor Green
    Write-Host ''

    Write-BridgeStartupStatus 'starting' 'Uruchamiam bridge Python i health endpoint.'
    & $venvPython $bridgeFile
    $bridgeExitCode = $LASTEXITCODE
    if ($bridgeExitCode -ne 0) { throw ('Proces bridge zakonczyl sie nieoczekiwanie (kod ' + $bridgeExitCode + ').') }
    Write-BridgeStartupStatus 'stopped' 'Most i polaczenie MT5 zostaly zamkniete.'
    Write-Host 'BYE ADMIN! Bridge zatrzymany.' -ForegroundColor Green
} catch {
    $line = $_.InvocationInfo.ScriptLineNumber
    $command = $_.InvocationInfo.Line.Trim()
    $message = "Linia $line ($command): $($_.Exception.Message)"
    Write-BridgeStartupStatus 'error' $message
    Write-Host ''
    Write-Host ('BLAD: ' + $message) -ForegroundColor Red
    Write-Host 'Pozostawiam komunikat w osobnym oknie PowerShell.' -ForegroundColor Yellow
    throw
}
