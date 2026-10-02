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
    # The Windows `py.exe` launcher can exist even when it has no registered
    # interpreter. Probe candidates and prefer a working python.exe instead
    # of trusting command order (which previously selected an empty launcher).
    $pythonSource = $null
    $pythonArgs = @()
    foreach ($candidateName in @('python', 'py')) {
        $candidate = Get-Command $candidateName -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandType -eq 'Application' } |
            Select-Object -First 1
        if (-not $candidate) { continue }
        $candidateArgs = if ($candidateName -eq 'py') { @('-3.13') } else { @() }
        $versionOutput = & $candidate.Source @candidateArgs --version 2>&1
        if ($LASTEXITCODE -eq 0 -and ($versionOutput -join ' ') -match 'Python 3\.13\.') {
            $pythonSource = $candidate.Source
            $pythonArgs = $candidateArgs
            break
        }
    }

    if (-not $pythonSource) {
        throw 'Nie znaleziono dzialajacego Python 3.13 x64. Python Launcher bez zarejestrowanego interpretera nie wystarcza.'
    }

    $venvDirectory = [System.IO.Path]::Combine($RuntimeRoot, '.venv')
    $venvPython = [System.IO.Path]::Combine($venvDirectory, 'Scripts\python.exe')
    $requirementsFile = [System.IO.Path]::Combine($BridgeRoot, 'requirements.txt')
    $wheelhouseDirectory = [System.IO.Path]::Combine($BridgeRoot, 'wheelhouse')
    $bridgeFile = [System.IO.Path]::Combine($BridgeRoot, 'bridge.py')

    if (-not [System.IO.Directory]::Exists($wheelhouseDirectory)) {
        throw ('Brakuje lokalnych pakietów mostu: ' + $wheelhouseDirectory)
    }

    $venvVersion = $null
    if ([System.IO.File]::Exists($venvPython)) {
        $venvVersion = & $venvPython -c 'import sys; print(".".join(map(str, sys.version_info[:2])))' 2>$null
        if ($LASTEXITCODE -ne 0) { $venvVersion = $null }
    }

    if (-not [System.IO.File]::Exists($venvPython) -or $venvVersion -ne '3.13') {
        Write-BridgeStartupStatus 'starting' 'Przygotowuje lokalne srodowisko Python 3.13.'
        Write-Host 'Tworze srodowisko Python .venv...' -ForegroundColor Yellow
        & $pythonSource @pythonArgs -m venv --clear $venvDirectory
        $venvExitCode = $LASTEXITCODE
        if ($venvExitCode -ne 0 -or -not [System.IO.File]::Exists($venvPython)) {
            throw ('Nie udalo sie utworzyc srodowiska .venv (kod ' + $venvExitCode + ').')
        }
    }

    Write-BridgeStartupStatus 'starting' 'Weryfikuje przypiete pakiety z lokalnego zestawu, bez dostepu do sieci.'
    Write-Host 'Weryfikuje lokalne pakiety MT5 Bridge...' -ForegroundColor Yellow
    $pipOutput = & $venvPython -m pip install --disable-pip-version-check --no-input --no-index --find-links $wheelhouseDirectory -r $requirementsFile 2>&1
    $pipExitCode = $LASTEXITCODE
    if ($pipExitCode -ne 0) {
        $pipDetails = ($pipOutput | Select-Object -Last 8) -join ' | '
        throw ('Nie udalo sie przygotowac lokalnych pakietow mostu (kod ' + $pipExitCode + '). ' + $pipDetails)
    }

    & $venvPython -c 'import MetaTrader5, fastapi, uvicorn'
    $verifyExitCode = $LASTEXITCODE
    if ($verifyExitCode -ne 0) {
        throw ('Weryfikacja pakietow Python nie powiodla sie (kod ' + $verifyExitCode + ').')
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
