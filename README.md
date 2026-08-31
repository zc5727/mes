# MES 智能制造运营平台

面向中小型工厂的核心 MES 试点与演示工程，当前包含四条产线数字孪生、设备模拟采集、工单/质量/维修基础能力、策略治理和 NestJS 集成层；SaaS、多租户和真实设备控制不在当前交付范围。

## 项目结构

```text
mes/
├── backend/                         # NestJS 后端基础服务
├── third_party/threejs-factory-demo/ # Vue 3 + Three.js 数字孪生演示
├── MES智能制造运营平台设计与实施方案.pdf
├── MES智能制造运营平台设计与实施方案.docx
├── MES智能制造平台架构.drawio
└── .gitignore
```

## 当前演示能力

- 四条产线：CNC 加工线、装配线、焊接线、视觉检测线
- 产线总览、状态切换、实时指标和设备详情展示
- 数字孪生工厂场景与基础设备状态模拟
- 面向厂长的智能秘书对话入口
- NestJS MES API、MQTT/HTTP 事件接入、告警、工单、质量、维修、库存和策略基础模块
- PostgreSQL、MQTT、MinIO 的本地基础设施编排

## 本地启动

### 前端数字孪生演示

```bash
cd third_party/threejs-factory-demo
npm ci
npm run dev
```

访问 `http://localhost:5173`。

### 后端基础服务

```bash
cd backend
cp .env.example .env
npm ci
npm run start:dev
```

健康检查：`http://localhost:3000/api/v1/health`。

如需启动 PostgreSQL、Mosquitto 和可选 MinIO，推荐使用统一运行脚本：

```bash
scripts/mes-runtime.sh start --object-storage
scripts/mes-runtime.sh ready
```

停止并清理：

```bash
scripts/mes-runtime.sh stop --object-storage
```

也可以直接使用 Compose（新版 Docker 使用 `docker compose`，旧版使用
`docker-compose`）：

```bash
docker-compose -f backend/docker-compose.yml --profile infra up -d postgres mqtt
docker-compose -f backend/docker-compose.yml --profile object-storage up -d minio
```

## 说明

本仓库是赵丞单人开发的核心 MES MVP/演示基线。代码级门禁和本机容器校验已具备，但生产接入仍需完成 ERPNext/ThingsBoard 现场联调、完整质量与追溯闭环、正式身份/TLS、对象存储、备份恢复、桌面签名和人工验收。详见 `docs/MES最终交付运行手册.md`。

开发者：赵丞
