# MES Tauri 桌面版测试矩阵

## 1. 文档目的

本文是 MES 数字孪生桌面化的测试方案，覆盖 Tauri 安装、启动、本地服务编排、窗口交互、网络异常和退出行为。测试对象仍是四条产线的模拟 MES，不接真实 PLC、不执行自动控制、不包含 SaaS/Nanobot。

当前结论：仓库已创建 Tauri wrapper，并已生成 macOS `.app`/`.dmg`；桌面专属运行时用例仍未完成，现有 Web 版交互只能作为桌面 WebView 的前置基线。

桌面演示运行时会显式启用 PostgreSQL、MQTT 和对象存储；依赖不可用时必须在启动阶段失败，不得静默降级到内存数据。

## 2. 已有测试基础

| 能力 | 入口 | 当前用途 |
|---|---|---|
| 后端单元/E2E | `cd backend && npm run test:all` | API、状态和业务契约 |
| MQTT smoke | `cd backend && npm run smoke:mqtt` | telemetry、告警、Dashboard 链路 |
| 故障演练 | `cd backend && npm run smoke:fault` | 故障/恢复和幂等 |
| 数字孪生 E2E | `cd backend && npm run smoke:digital-twin` | 快照、告警生命周期、四产线 |
| 模拟器回归 | `cd simulator && npm run check` | 固定种子、回放和策略 |
| Web 构建 | `cd third_party/threejs-factory-demo && npm run build` | Vue/Three.js 类型和打包 |
| Web 浏览器 smoke | `node scripts/browser-smoke.mjs` | 页面加载、API 降级和基础交互 |
| 桌面结构 smoke | `node scripts/desktop-smoke.mjs` | Tauri 工程是否已具备运行前提 |

服务启动基线：

```bash
cd /Users/a1/Documents/ChatGPT/mes
./scripts/dev-up.sh --infra --mqtt
./scripts/dev-down.sh              # 停止应用进程
./scripts/dev-down.sh --infra      # 同时停止 PostgreSQL/Mosquitto
```

如果开发机的默认端口已被 Colima、SSH 转发或其他本地服务占用，可为桌面
运行时指定隔离端口；端口会同时传递给 Compose、Backend 和 Simulator：

```bash
MES_POSTGRES_HOST_PORT=15432 \
MES_MQTT_HOST_PORT=11883 \
MES_MQTT_WS_HOST_PORT=19001 \
MES_MINIO_HOST_PORT=19000 \
MES_MINIO_CONSOLE_HOST_PORT=19002 \
./scripts/desktop-runtime.sh --once
```

## 3. 测试矩阵

状态含义：`BLOCKED` 表示当前环境或真实依赖无法执行；`READY` 表示已有前置能力但缺少本用例证据；`部分通过` 表示代码级/结构级证据已有但仍缺实机或人工证据；`PASS` 必须有实际运行证据。

| ID | 优先级 | 场景 | 前置条件 | 操作与预期 | 当前状态 |
|---|---|---|---|---|---|
| D01 | P0 | 安装包安装 | 产出 `.dmg/.msi/.AppImage` | 安装成功、版本可见、卸载无残留 | READY：macOS `.app/.dmg` 已生成，安装/卸载待人工 |
| D02 | P0 | 首次启动 | 安装完成 | 启动桌面窗口，加载数字孪生首页，不白屏 | READY：wrapper 已存在，首次启动待人工 |
| D03 | P0 | 自动拉起本地服务 | 后端/模拟器未启动 | 桌面端按顺序拉起服务，等待 health/readiness 后加载页面；失败必须显示明确错误 | 部分通过：`desktop-runtime.sh` 和 readiness 检查已有，桌面实机联动待验 |
| D04 | P0 | 服务异常 | 可注入后端启动失败/退出 | 页面显示服务不可用；不假报在线；恢复服务后可重连 | READY：Web 降级可复用，桌面进程监管待测 |
| D05 | P0 | API 断线重连 | 页面已加载 | 断开 3000 端口，保留最后快照并提示；恢复后重新获取状态，不重复告警 | READY：Web 层可复用 |
| D06 | P0 | 安全退出 | 服务运行中 | 关闭窗口，子进程、端口、PID 文件均清理；再次启动不受旧进程影响 | 部分通过：Rust 退出钩子、SIGTERM 和 runtime self-test 通过；窗口实机待验 |
| D07 | P1 | 重复启动 | 已有一个桌面实例 | 第二次启动聚焦已有窗口或明确拒绝，不能重复占用端口/拉起服务 | 部分通过：Rust single-instance 注册已由 desktop smoke 验证；第二次启动行为待实机 |
| D08 | P1 | 窗口缩放 | 首页已加载 | 最小/最大/全屏尺寸下布局不溢出，三维画布和面板仍可操作 | READY：需在 Tauri 窗口实测 |
| D09 | P1 | 三维拖拽与滚轮 | 首页已加载 | 拖拽改变相机视角，滚轮缩放，边界不会失控，无 JS/Rust 错误 | READY：已有 Web 交互基线 |
| D10 | P1 | 三维设备点击 | 有设备快照 | 点击设备联动左侧选中态、详情和故障高亮；离线设备灰显 | READY：需桌面 WebView 复测 |
| D11 | P1 | 四产线切换 | 四条产线数据已加载 | 逐一切换 CNC、装配、焊接、视觉检测，设备/AGV/OEE/告警上下文一致 | READY：需桌面 WebView 复测 |
| D12 | P1 | MQTT/实时异常 | MQTT 正常后断开 broker | 页面不白屏、不伪造实时连接；恢复后状态可继续刷新 | READY：broker smoke 可复用，桌面提示待测 |
| D13 | P1 | 后端重启 | 页面已加载 | 重启后端，客户端进入降级态，服务恢复后自动恢复，不产生重复告警 | READY：Web API 降级可复用 |
| D14 | P2 | 多次启动/退出 | 连续执行 10 次 | 无孤儿进程、端口泄漏、日志持续增长或状态污染 | 待现场：尚无 10 次实机循环记录 |
| D15 | P2 | 离线安装环境 | 断网或无 Docker | 给出依赖缺失提示；不静默失败；允许连接外部已运行服务（若设计支持） | BLOCKED |
| D16 | P2 | 日志和诊断 | 启动/异常/退出均发生 | 日志包含启动阶段、子进程 PID、端口、错误和退出原因，不记录敏感配置 | 部分通过：runtime 脚本日志/退出原因已有；Tauri 实机日志审计待验 |

## 4. 桌面进程编排验收契约

桌面实现后必须明确并测试以下顺序：

```text
Tauri 启动
  → 检查端口/单实例
  → 启动或连接 PostgreSQL/Mosquitto（若采用本地依赖）
  → 启动 backend
  → 等待 GET /api/v1/health 成功
  → 启动 simulator（演示模式）
  → 加载前端 WebView
```

任何一步失败都必须：

1. 在桌面窗口显示可理解的失败阶段和修复建议；
2. 记录结构化日志；
3. 按已启动资源的逆序清理；
4. 不把“最后一次成功快照”伪装成实时在线；
5. 不自动调用真实设备控制接口。

## 5. 执行与证据

桌面 wrapper 创建后，先运行结构检查：

```bash
cd /Users/a1/Documents/ChatGPT/mes
node scripts/desktop-smoke.mjs --app-dir=desktop
```

工程创建前预期退出码为 `2`；当前结构检查应为 `0`。CI 只做基线扫描时可用：

```bash
node scripts/desktop-smoke.mjs --app-dir=desktop --allow-missing
```

Tauri 工程创建后执行不依赖 GUI 的结构、前端构建和 Rust 编译检查：

```bash
node scripts/desktop-smoke.mjs --app-dir=desktop --build
```

该命令只执行配置校验、`build:frontend`（仅构建 Vue/Vite 前端）和 `cargo check`，不会打开窗口、执行 Tauri 打包、启动后端、连接 MQTT 或操作设备。JSON 配置会解析必需字段；JSON5 配置由 Tauri CLI 在后续构建阶段解析。

每次桌面验收至少留存：安装包版本、操作系统、窗口尺寸、启动日志、服务 PID/端口、截图或录屏、用例结果、退出后的进程和端口检查结果。禁止把 `--allow-missing` 的结果作为桌面验收通过依据。

## 6. 通过门槛

- P0 用例全部 PASS，才能进入桌面版演示。
- D03、D06、D07、D13 必须验证资源清理和重连，不以“页面还能显示”为通过条件。
- D09–D11 必须在 Tauri WebView 实际操作，不仅依赖浏览器 smoke。
- 任意重复告警、状态倒退、孤儿进程、端口泄漏或白屏均为阻断问题。

## 7. 平台差异补充

| 平台 | 无 GUI 检查 | 桌面运行时重点 |
|---|---|---|
| macOS | `cargo check`、前端构建、Tauri 配置校验 | `.app/.dmg` 签名与公证、Intel/Apple Silicon、权限弹窗、Dock 关闭行为、系统代理和端口占用 |
| Linux | `cargo check`、前端构建、Tauri 配置校验 | `.AppImage/.deb` 依赖、Wayland/X11、无桌面环境启动失败提示、SIGTERM/SIGINT 子进程清理 |
| Windows | `cargo check`、前端构建、Tauri 配置校验 | `.msi/.nsis` 安装卸载、WebView2 缺失、Firewall/Defender 拦截、窗口关闭消息和端口冲突 |

跨平台构建不能替代目标系统验收。每个平台至少需要在目标系统执行 D01、D02、D03、D06、D07、D08、D09 和 D13；macOS 还要验证签名，Windows 还要验证 WebView2，Linux 还要验证图形会话和打包依赖。

## 8. macOS 最终验收记录（2026-08-29）

| 项目 | 实际证据 | 结论 |
|---|---|---|
| 从 DMG 解出并打开 `.app` | `open` 返回 `0`，应用进程 `mes-desktop` 成功出现，窗口可被 macOS UI Scripting 识别 | 部分通过：进程/窗口启动通过，未完成业务页面视觉和三维手势自动化 |
| DMG 挂载/卸载 | `hdiutil attach -readonly` 成功；挂载目录含 `.app`；`hdiutil detach` 成功且挂载点释放 | 通过 |
| 窗口缩放 | UI Scripting 将窗口设置为 `1100x720`、`1440x900`，系统返回对应尺寸 | 通过窗口 API；三维拖拽/滚轮未自动化 |
| 不同路径副本单实例 | Tauri single-instance 插件之外，Rust 启动前使用固定应用标识的原子锁，并清理已退出进程留下的失效锁 | 代码已补强；需重新执行两份 `.app` 的实机验证，确认第二份不创建窗口/服务 |
| 关闭后进程清理 | 关闭菜单自动化未找到菜单项，随后终止主进程；主进程退出 | 部分通过：进程可清理，但正常菜单退出路径未完成验证 |
| `codesign` | `codesign --verify --deep --strict` 失败：`code has no resources but signature indicates they must be present`；无 `TeamIdentifier` | 未通过：当前为 ad-hoc/不完整签名 |
| 公证/Gatekeeper | `spctl -a -vv --type execute` 失败，继承上述签名错误 | 环境阻塞：需要 Developer ID Application 证书、签名身份和 Apple 公证账号 |

当前 macOS 阻塞项：单实例、正常退出菜单链路、三维手势自动化、正式签名和公证。上述失败均已保留为验收结果，不伪造为通过。

## 9. macOS GUI Smoke 复测（2026-09-01）

| 项目 | 实际证据 | 结论 |
|---|---|---|
| 打包 `.app` 启动 | `scripts/desktop-browser-smoke.mjs --close-after` 检测到 `mes-desktop` 进程启动 | 通过进程启动 |
| 单实例 | 第二次 `open -a` 后进程数保持 1 | 通过 |
| 退出清理 | `--close-after` 后 `mes-desktop` 进程退出 | 通过 |
| 可见窗口 | `System Events` 在当前执行环境返回“没有可见窗口” | BLOCKED：需要 macOS 辅助功能/窗口会话权限或人工确认 |

本次复测未将“进程已启动”冒充为“窗口和业务页面已验收”；三维拖拽、滚轮、缩放和页面内业务操作仍需在可见桌面窗口中完成。
