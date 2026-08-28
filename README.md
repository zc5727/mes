# MES 智能制造运营平台

面向中小型工厂的 MES SaaS 演示项目，当前包含四条产线数字孪生演示、智能秘书交互入口、云边协同架构设计，以及 NestJS 后端基础骨架。

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
- NestJS 健康检查接口和后续业务模块扩展骨架
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

如需启动本地依赖：

```bash
docker compose up -d
```

## 说明

本仓库是单人开发的 MVP/演示基线，生产接入前仍需完成设备协议适配、真实数据采集、权限隔离、策略仿真、审计、容灾和现场联调。

开发者：赵丞
