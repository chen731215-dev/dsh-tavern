@echo off
chcp 65001 >nul
title dsh-tavern 一键安装
echo ========================================
echo   dsh-tavern 酒馆插件 一键安装
echo ========================================
echo.

powershell -ExecutionPolicy Bypass -File "%~dp0install.ps1"

echo.
pause
