@echo off
title Oganesson in Cards
cd /d "%~dp0"
echo Starting Oganesson in Cards on http://localhost:8000
echo (Hot-seat, vs Bot and online games. For LAN games without internet use PlayLAN.bat)

:: Open the browser first
start http://localhost:8000

:: Python's file server, but telling the browser to always re-check files (so edited cards show up on refresh)
python -c "import http.server as s; H = s.SimpleHTTPRequestHandler; e = H.end_headers; H.end_headers = lambda self: (self.send_header('Cache-Control', 'no-cache'), e(self)); s.test(H, port=8000, bind='0.0.0.0')"
