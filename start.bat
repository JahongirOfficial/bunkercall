@echo off
cd /d "%~dp0"
start "" http://localhost:8780/
python -m http.server 8780
