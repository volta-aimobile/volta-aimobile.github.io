#!/bin/bash
# ============================================================
#   Volta App - One-Click Launcher for macOS / Linux
#   Double-click this file (or run: ./START-Mac.command)
# ============================================================

cd "$(dirname "$0")"

echo ""
echo "  ============================================"
echo "    Volta App - Starting..."
echo "  ============================================"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
  echo "  [ERROR] Node.js is not installed."
  echo ""
  echo "  Please install it from: https://nodejs.org/"
  echo "  Download the LTS version, run the installer,"
  echo "  then run this file again."
  echo ""
  read -p "Press Enter to exit..."
  exit 1
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
  echo "  First-time setup: installing dependencies..."
  echo "  This will take about 1 minute. Please wait."
  echo ""
  npm install
  if [ $? -ne 0 ]; then
    echo ""
    echo "  [ERROR] npm install failed."
    read -p "Press Enter to exit..."
    exit 1
  fi
  echo ""
  echo "  Dependencies installed successfully."
  echo ""
fi

# Create .env if it doesn't exist
if [ ! -f ".env" ]; then
  cp .env.example .env
fi

# Start the server
echo "  Starting Volta App..."
echo ""
echo "  Once you see 'Volta backend running' below,"
echo "  open your browser to:  http://localhost:4000/"
echo ""
echo "  To stop the server: close this window or press Ctrl+C."
echo "  ----------------------------------------------------------"
echo ""

node server/index.js
