@echo off
chcp 65001 >nul
rem 回声竞技场 Windows 启动脚本：双击运行。
rem 首次运行会自动安装依赖并构建（需要联网），之后可离线游玩。
cd /d "%~dp0"
where node >/dev/null 2>nul
if errorlevel 1 goto nonode
node scripts\start.mjs %*
if errorlevel 1 goto failed
exit /b 0

:nonode
echo.
echo 没有找到 Node.js。请先安装 Node.js 18 或更新版本：
echo https://nodejs.org （下载 LTS 版），安装后重新双击本文件。
echo.
pause
exit /b 1

:failed
echo.
echo 启动失败，请查看上方信息。
pause
exit /b 1
