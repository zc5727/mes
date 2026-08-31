# MES GitHub 交付说明

**仓库：** `https://github.com/zc5727/mes`
**当前基线：** `9d9633d4`
**负责人：** 赵丞

## 1. 交付内容

本仓库交付的是单工厂、单车间、四条模拟产线的核心 MES 试点工程，包含：

- NestJS MES API、MQTT 采集和告警边界
- 四条产线模拟器与故障注入/回放
- PostgreSQL Schema、迁移和基础持久化边界
- 质量、维修、文档、批次/序列号和策略治理基础模块
- 数字孪生前端、前端契约 smoke 和 Tauri 工程
- 本地、CI、运行时验证脚本与最终运行手册

## 2. 交付判定

GitHub 提交存在、构建通过或单测通过，只能证明代码级能力；不能替代 ERPNext、ThingsBoard/Gateway、生产 PostgreSQL、TLS、对象存储、签名桌面包和现场人工验收。最终状态以以下文档为准：

- `docs/MES成熟功能域路线与端到端验收.md`
- `docs/MES里程碑计划.md`
- `docs/MES最终交付运行手册.md`

## 3. 拉取与本地验证

```bash
git clone https://github.com/zc5727/mes.git
cd mes
git checkout 9d9633d4
./scripts/verify-local.sh
```

需要真实 PostgreSQL/MQTT 依赖时：

```bash
./scripts/verify-runtime.sh
```

CI 使用：

```bash
CI=true ./scripts/verify-ci.sh
```

依赖不可用时必须保留 `BLOCKED` 或非零退出结果，不得用 Mock 输出冒充现场通过。

## 4. GitHub 安全与发布规则

- 禁止提交 `.env`、数据库密码、MQTT 管理凭据、TLS 私钥、对象存储密钥和生产日志。
- Pull Request 必须附带 commit、测试命令、运行输出和未验证项。
- 生产发布前锁定版本、依赖、迁移、SBOM、许可证和回滚点。
- 未完成现场验证前，GitHub Release 只能标记为开发演示版/候选版，不能标记为生产版。
- 发布包必须排除模拟器、测试账号、密钥和本地数据库文件。

## 5. 当前未完成项

ERPNext 真实旁路对账、真实设备接入、生产数据库恢复、完整 IQC/IPQC/OQC/NCR/CAPA、库存/备件、对象存储、身份/TLS、不可篡改审计、Tauri 签名安装包和升级回滚仍需现场或等价隔离环境证据。
