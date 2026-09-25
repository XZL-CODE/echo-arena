@echo off
chcp 65001 >nul
rem 回声竞技场 Windows 启动脚本（从源码运行）：双击即可。
rem 首次运行会自动安装依赖并下载 Electron（需要联网），之后可离线游玩。
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
node scripts\start.mjs %*
if errorlevel 1 goto failed
exit /b 0

:nonode
echo.
echo 没有找到 Node.js。请先安装 Node.js 22.12 或更新版本：
echo https://nodejs.org （下载 LTS 版），安装后重新双击本文件。
echo 如果只想玩，也可以直接下载打包好的安装包，见 README。
echo.
pause
exit /b 1

:failed
echo.
echo 启动失败，请查看上方信息。
pause
exit /b 1
