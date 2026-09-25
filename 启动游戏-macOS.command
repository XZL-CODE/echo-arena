#!/bin/bash
# 回声竞技场 macOS 启动脚本（从源码运行）：双击即可。
# 首次运行会自动安装依赖并下载 Electron（需要联网），之后可离线游玩。
cd "$(dirname "$0")" || exit 1

# 从 Finder 打开的终端可能没有加载 Homebrew / nvm 的 PATH，这里在末尾补上常见位置
# （放在末尾，已有 PATH 里的 Node 优先，避免被旧版本覆盖）。
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
fi

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "没有找到 Node.js。请先安装 Node.js 22.12 或更新版本："
  echo "https://nodejs.org （下载 LTS 版），安装后重新双击本文件。"
  echo "如果只想玩，也可以直接下载打包好的安装包，见 README。"
  echo ""
  read -r -p "按回车键关闭……" _
  exit 1
fi

node scripts/start.mjs "$@"
status=$?
if [ $status -ne 0 ]; then
  read -r -p "启动失败，请查看上方信息。按回车键关闭……" _
fi
exit $status
