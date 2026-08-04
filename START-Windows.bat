@echo off
REM ============================================================
REM   Volta App - One-Click Launcher for Windows
REM   Double-click this file to start the app.
REM ============================================================

title Volta App
cd /d "%~dp0"

echo.
echo  ============================================
echo    Volta App - Starting...
echo  ============================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] Node.js is not installed.
  echo.
  echo  Please install it from: https://nodejs.org/
  echo  Download the LTS version (green button), run the installer,
  echo  then double-click this file again.
  echo.
  echo  Press any key to close...
  pause >nul
  exit /b 1
)

echo  [OK] Node.js found:
node --version
echo.

REM Check if dependencies are installed
if not exist "node_modules" (
  echo  First-time setup: installing dependencies...
  echo  This will take about 1-2 minutes. Please wait.
  echo.
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    echo.
    echo  [ERROR] npm install failed.
    echo  Press any key to close...
    pause >nul
    exit /b 1
  )
  echo.
  echo  [OK] Dependencies installed successfully.
  echo.
)

REM Create .env if it doesn't exist
if not exist ".env" (
  copy .env.example .env >nul
  echo  [OK] Created .env from .env.example
  echo.
)

REM Start the server
echo  ============================================
echo   Starting Volta App...
echo  ============================================
echo.
echo  Once you see "Volta backend running" below,
echo  open your browser to:  http://localhost:4000/
echo.
echo  To stop the server: close this window
echo  or press Ctrl+C.
echo  --------------------------------------------
echo.

node server/index.js

echo.
echo  ============================================
echo   Server stopped.
echo  ============================================
echo  Press any key to close...
pause >nul
