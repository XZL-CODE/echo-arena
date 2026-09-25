# Agent Note: 跨平台本地运行技术栈

Status: implemented

## Problem

游戏要以桌面客户端的形式在 macOS 和 Windows 上本地、离线运行，启动要简单，工程也要方便以后迭代。需要确定客户端外壳、渲染、界面、构建、打包和存档怎么组合。

## Proposal

- 游戏须能在 macOS 与 Windows 上运行，技术栈按此选择。理由：用户 2026-09-24 明确提出，这是计划游玩的两个平台。
- 首次安装后离线运行，不需要账号、API Key、云端服务或持续联网；素材本地可用，不依赖在线素材、外部字体或流媒体。理由：Brief §7、§9，随时打开的休闲游戏不应受网络和账号影响。
- 以桌面客户端交付，可安装运行，也可从源码用启动脚本运行；不强制开发原生 macOS 应用，客户端不对外提供网络服务。理由：用户 2026-09-24 追加要求“我想要客户端”；Brief §9。
- 安装包由 GitHub Actions 在 macOS 与 Windows 上构建，仓库与安装包公开。理由：用户 2026-09-24 同意“打包可以用 GitHub 的 CI 流水线”“打包的时候可以设置为公开”，并已把仓库设为公开。
- 启动方式简单明确，可提供启动脚本或少量命令；第一版不要求签名、公证和商店分发。理由：Brief §9。
- 按需要和可维护性选型，不为展示技术栈堆依赖；规则、内容配置、状态与渲染适当分离，不搭建与规模不相称的插件平台、编辑器或企业级架构。理由：Brief §9。
- 具体框架、引擎和渲染库由 Agent 选定并记录，不逐项确认。理由：用户 2026-09-24 授权“最大自由度”。

## Decision

与 Proposal 一致，按下方 Plan 落实。

## Plan

- 以 Electron 桌面客户端交付（用户 2026-09-24 追加要求“我想要客户端”）。主进程只负责窗口、`app://` 本地资源协议和存档读写；页面在上下文隔离加沙盒中运行，只通过预加载脚本拿到存档与窗口接口。
- 游戏本体仍用 TypeScript（纯 JS 实现的 6.x 编译器）直接编译成原生 ES 模块：Canvas 2D 画战场，Web Audio 合成声音，界面用原生 DOM 加自写的 JSX 工厂，运行时没有第三方依赖。Electron 自带的 Chromium 保证两个平台画面和声音一致。
- 从源码运行：`npm start` 或双击启动脚本。首次自动安装依赖、下载 Electron（官方源失败时改用 npmmirror 镜像）并构建，然后打开游戏窗口。要求 Node.js 22.12 以上（Electron 44 安装工具的要求）。启动脚本的 `--check` 只做准备、不开窗口，供 CI 验证。
- 打包用 electron-builder：macOS 出 Intel 与 Apple 芯片通用的 dmg，只做 ad-hoc 签名、不公证；Windows 出 NSIS 安装包和免安装版，不签名。GitHub Actions（用户同意用 CI 打包，并已把仓库设为公开）在 macOS 与 Windows 机器上打包，再对打包好的客户端跑全部端到端测试；同时在两个平台上从全新检出执行启动脚本并用源码版跑冒烟测试；合并到默认分支（版本号取 `package.json`，已发布过就跳过）、推送 `v*` 标签或手动运行并填写版本号时，在测试通过后发布 Release。
- 取舍：Electron 体积大（安装包 100 MB 以上），换来两个平台一致的渲染与音频和成熟的打包链。Tauri 需要 Rust 工具链，且 macOS 上是 Safari 内核，没有采用。
- 规则模拟放在不依赖 DOM 的 `src/core`，用 Node 内置测试运行器测试；Playwright 直接驱动客户端做端到端测试。

## Acceptance criteria

- 干净检出后执行 `npm start`（或双击启动脚本）能自动装依赖、构建并打开游戏窗口。
- CI 在 macOS 与 Windows 上打包成功，打包好的客户端通过全部端到端测试；启动脚本在两个平台的全新检出上能完成准备。
- 游戏运行时不发起外部网络请求；类型检查、单元测试和端到端主流程通过。

## Verification

- GitHub Actions 在 macOS（Apple 芯片虚拟机）打出通用 dmg、在 Windows 打出安装版与免安装版，对打包好的程序跑全部端到端测试均通过。
- 本地 Linux 环境从全新克隆执行启动脚本，能装好依赖、下载 Electron、构建并打开客户端。
- 页面的内容安全策略只允许加载本地资源；冒烟测试核对页面请求全部是 `app://`、`data:` 或 `blob:`。
- Electron 内置拼写检查会在 Windows / Linux 上联网下载词典：本地代理日志显示每次启动都尝试连接 `redirector.gvt1.com`。启动时清空拼写检查语言并关闭拼写检查后，全部端到端测试期间代理日志没有任何对外连接；冒烟测试核对这项设置。
- 启动脚本在 macOS 与 Windows 的全新检出上完成安装、下载与构建，源码版冒烟测试通过（GitHub Actions）。
- 2026-09-25 08:20 UTC：PR #1 合并到 main 后，CI 在公开仓库 XZL-CODE/echo-arena 发布 Release `v0.1.0`（macOS 通用 dmg、Windows 安装版与免安装版、SHA256SUMS.txt）。
- 未验证：真实 Mac / Windows 电脑上的安装与首次打开（Gatekeeper、SmartScreen 提示）、Intel Mac 上的运行。

## Related materials

- [原始需求文档](../../../相关材料/20260924-原始需求文档/Echo_Arena_Brief.md)
