@echo off
setlocal
title Terminal rynkowy

set "SCRIPT=%~dp0START_SMARTFLOW_X.ps1"

if not exist "%SCRIPT%" (
    echo.
    echo BLAD: Nie znaleziono START_SMARTFLOW_X.ps1
    echo Pobierz ponownie caly projekt.
    echo.
    pause
    exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
set "RESULT=%ERRORLEVEL%"

if not "%RESULT%"=="0" (
    echo.
    echo Uruchamianie nie powiodlo sie.
    pause
)

exit /b %RESULT%
