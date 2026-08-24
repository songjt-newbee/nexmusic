@echo off
chcp 65001 >nul
cd /d "%~dp0.."
start "NexMusic Dev" powershell -NoExit -ExecutionPolicy Bypass -Command "$env:NEXMUSIC_DEV_IN_WINDOW='1'; & '%~dp0dev-desktop.ps1'"
exit /b 0
