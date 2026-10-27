@echo off
title Oganesson in Cards - LAN server
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is needed for the LAN server: https://nodejs.org
    pause
    exit /b 1
)
:: Serves the game on port 8080 to this computer and the local network, and opens the browser
node server.js 8080 --open
pause
