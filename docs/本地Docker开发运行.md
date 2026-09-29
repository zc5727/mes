# MES 本地 Docker 开发运行

从现在开始，MES 的本地开发、仿真、数据库、MQTT 和前端统一通过根目录 `docker-compose.yml` 管理。

## 启动

```bash
docker compose up --build
```

访问：

- 数字孪生：http://localhost:5173
- 仿真控制台：http://localhost:5174
- MES API：http://localhost:3000/api/v1/health
- PostgreSQL：localhost:5432
- MQTT：localhost:1883
- MinIO：localhost:9000

## 后台启动

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f backend simulator
```

## 停止

```bash
docker compose down
```

停止并删除本地数据库和对象存储数据：

```bash
docker compose down -v
```

## 开发方式

源代码目录以 volume 挂载到容器内，NestJS 和 Vite 使用 watch 模式。修改本地代码后不需要重新构建镜像；只有依赖或 Dockerfile 变化时使用：

```bash
docker compose up --build
```

容器内部访问地址必须使用服务名：

- PostgreSQL：`postgres:5432`
- MQTT：`mqtt:1883`

浏览器访问后端则使用宿主机地址：`http://localhost:3000`。
