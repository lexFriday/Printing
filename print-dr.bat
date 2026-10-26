@echo off
setlocal enabledelayedexpansion

:: =========================================================================
:: Pre-Printed Delivery Receipt Direct Background Printer
:: Usage:
::   print-dr.bat [JOB_ID_OR_JOB_NUMBER] [OPTIONAL_PRINTER_NAME]
::   print-dr.bat test --pdf-only
:: =========================================================================

set TARGET=%~1
set PRINTER=%~2

if "%TARGET%"=="" (
  echo ========================================================
  echo   Automate DirectPrint Helper
  echo ========================================================
  echo   1. Start Background Print Server (Daemon for Web App)
  echo   2. Print single Delivery Receipt or Test PDF
  echo ========================================================
  set /p MODE="Select [1 or 2, default is 1]: "
  if "!MODE!"=="" set MODE=1
  if "!MODE!"=="1" (
    echo Starting Print Daemon on port 18890...
    node "%~dp0scripts\print-delivery-receipt.mjs" --daemon
    exit /b %ERRORLEVEL%
  )
  set /p TARGET="Enter Job Number or 'test': "
)

if "%TARGET%"=="" (
  echo No job provided. Exiting.
  exit /b 1
)

if not "%PRINTER%"=="" (
  set PRINTER_FLAG=--printer="%PRINTER%"
) else (
  set PRINTER_FLAG=
)

echo [1/2] Processing Delivery Receipt for: %TARGET%...
node "%~dp0scripts\print-delivery-receipt.mjs" %TARGET% %PRINTER_FLAG% %3 %4

if errorlevel 1 (
  echo [ERROR] Failed to process delivery receipt.
  pause
  exit /b 1
)

echo.
echo [DONE] Delivery receipt processing complete.
