@echo off
rem Serves HanziHome at http://127.0.0.1:8765 and opens it. Leave this window open while you study:
rem closing it stops the recordings loading. Your progress is kept per address, so keep using this one.
cd /d "%~dp0site"
start "" "http://127.0.0.1:8765/"
python -m http.server 8765 --bind 127.0.0.1
pause
