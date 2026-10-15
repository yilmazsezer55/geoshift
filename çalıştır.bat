@echo off
cd /d "%~dp0"
start "" "%SystemRoot%\System32\wscript.exe" "%~dp0run-tauri-dev-hidden.vbs"
exit /b 0