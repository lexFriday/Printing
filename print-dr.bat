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
  echo.
  echo [Delivery Receipt Direct Printer]
  echo.
  echo Please provide a Job Order ID or Number.
  echo Example:
  echo   print-dr.bat 2026-001
  echo   print-dr.bat test --pdf-only
  echo.
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
