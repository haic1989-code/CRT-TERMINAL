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
        # A broken launcher may write stderr; it must not abort candidate discovery.
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $versionOutput = & $candidate.Source @candidateArgs -c 'import sys; print(sys.version_info.major, sys.version_info.minor, sys.maxsize > 2**32)' 2>&1
            $probeExitCode = $LASTEXITCODE
        } finally { $ErrorActionPreference = $previousPreference }
        if ($probeExitCode -eq 0 -and ($versionOutput -join ' ').Trim() -eq '3 13 True') {
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
    # Serialize creation/pip access to the shared venv across application windows.
    $setupMutex = [System.Threading.Mutex]::new($false, 'Local\CRTTerminalBridgeSetupV2')
    $setupLocked = $false
    try {
        try { $setupLocked = $setupMutex.WaitOne(120000) } catch [System.Threading.AbandonedMutexException] { $setupLocked = $true }
        if (-not $setupLocked) { throw 'Przekroczono czas oczekiwania na przygotowanie srodowiska mostu.' }

    if (-not [System.IO.Directory]::Exists($wheelhouseDirectory)) {
        throw ('Brakuje lokalnych pakietów mostu: ' + $wheelhouseDirectory)
    }

    $venvVersion = $null
    if ([System.IO.File]::Exists($venvPython)) {
        $ErrorActionPreference = 'Continue'
        $venvVersion = & $venvPython -c 'import sys; print(sys.version_info.major, sys.version_info.minor, sys.maxsize > 2**32)' 2>$null
        if ($LASTEXITCODE -ne 0) { $venvVersion = $null }
        $ErrorActionPreference = 'Stop'
    }

    if (-not [System.IO.File]::Exists($venvPython) -or $venvVersion -ne '3 13 True') {
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
    $ErrorActionPreference = 'Continue'
    $pipOutput = & $venvPython -m pip install --disable-pip-version-check --no-input --no-index --find-links $wheelhouseDirectory -r $requirementsFile 2>&1
    $pipExitCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($pipExitCode -ne 0) {
        $pipDetails = ($pipOutput | Select-Object -Last 8) -join ' | '
        throw ('Nie udalo sie przygotowac lokalnych pakietow mostu (kod ' + $pipExitCode + '). ' + $pipDetails)
    }

    & $venvPython -c 'import MetaTrader5, fastapi, uvicorn'
    $verifyExitCode = $LASTEXITCODE
    if ($verifyExitCode -ne 0) {
        throw ('Weryfikacja pakietow Python nie powiodla sie (kod ' + $verifyExitCode + ').')
    }
    } finally {
        if ($setupLocked) { $setupMutex.ReleaseMutex() }
        $setupMutex.Dispose()
    }

    Write-Host ''
    Write-Host 'Uruchamiam CRT Terminal MT5 Local Bridge...' -ForegroundColor Cyan
    Write-Host 'MT5 powinien byc uruchomiony i zalogowany na konto brokerskie.' -ForegroundColor Yellow
    Write-Host 'Aplikacja odczyta adres prywatnej sesji mostu.' -ForegroundColor Green
    Write-Host ''

    Write-BridgeStartupStatus 'starting' 'Uruchamiam bridge Python i health endpoint.'
    if ($env:SMARTFLOW_BRIDGE_ENDPOINT_FILE) {
        $bridgeLog = [System.IO.Path]::ChangeExtension($env:SMARTFLOW_BRIDGE_ENDPOINT_FILE, '.log')
        # Log native stderr without PowerShell treating normal uvicorn logs as errors.
        $ErrorActionPreference = 'Continue'
        & $venvPython $bridgeFile *> $bridgeLog
        $ErrorActionPreference = 'Stop'
    } else {
        $ErrorActionPreference = 'Continue'
        & $venvPython $bridgeFile
        $ErrorActionPreference = 'Stop'
    }
    $bridgeExitCode = $LASTEXITCODE
    if ($bridgeExitCode -ne 0) {
        $bridgeDetails = if ($bridgeLog -and [System.IO.File]::Exists($bridgeLog)) { (Get-Content -LiteralPath $bridgeLog -Tail 8) -join ' | ' } else { '' }
        throw ('Proces bridge zakonczyl sie nieoczekiwanie (kod ' + $bridgeExitCode + '). ' + $bridgeDetails)
    }
    Write-BridgeStartupStatus 'stopped' 'Most i polaczenie MT5 zostaly zamkniete.'
    Write-Host 'BYE ADMIN! Bridge zatrzymany.' -ForegroundColor Green
} catch {
    $line = $_.InvocationInfo.ScriptLineNumber
    $command = ([string]$_.InvocationInfo.Line).Trim()
    $message = "Linia $line ($command): $($_.Exception.Message)"
    Write-BridgeStartupStatus 'error' $message
    Write-Host ''
    Write-Host ('BLAD: ' + $message) -ForegroundColor Red
    Write-Host 'Szczegoly bledu sa dostepne w diagnostyce uruchamiania aplikacji.' -ForegroundColor Yellow
    throw
}
