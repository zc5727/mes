# MES SaaS Backend

赵丞单人开发的MES SaaS后端起始工程，采用NestJS + TypeScript。

## 当前状态

这是第一阶段基础骨架，已准备：

- NestJS模块化后端
- `/api/v1`统一接口前缀
- 环境变量配置
- CORS和请求校验
- PostgreSQL、MQTT、MinIO本地依赖编排
- auth、tenants、factories、production-lines、devices、orders、work-orders、quality、documents、strategies、assistant、audit模块目录

## 启动

```bash
cp .env.example .env
npm install
npm run start:dev
```

后端地址：`http://localhost:3000/api/v1`

默认 `MQTT_ENABLED=false`，不会连接消息代理。进行模拟器联调时，先启动 Mosquitto，再使用：

```bash
MQTT_ENABLED=true MQTT_URL=mqtt://localhost:1883 npm run start:dev
```

## 启动本地依赖

```bash
docker compose up -d
```

## 下一步开发顺序

1. 租户、用户和权限
2. 工厂、车间和四条产线
3. 设备台账与实时状态
4. 订单、工单和报工
5. 质量、批次和异常闭环
6. WebSocket设备事件
7. 图纸、表单和对象存储
8. 主动策略与厂长智能体
