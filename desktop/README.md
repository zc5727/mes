# MES Desktop

基于 Tauri 2 的桌面壳层，复用 `third_party/threejs-factory-demo` 的 Vue + Three.js 前端，不重写现有页面。

## 环境

- Node.js 22+
- Rust 1.77+
- macOS/Linux 对应的 Tauri 系统依赖

## 开发

```bash
cd desktop
npm install
npm run dev
```

`tauri dev` 会先启动现有 Vite 前端（5173），窗口加载前端开发地址；API 仍由 `VITE_API_BASE_URL` 指向后端服务。

## 构建

```bash
cd desktop
npm run build
```

构建前会执行前端 `npm run build`，产物目录为 `third_party/threejs-factory-demo/dist`，再由 Tauri 打包。

## 边界

- 本目录只提供桌面容器和权限基座。
- 不包含后端业务、Nanobot 或真实设备控制逻辑。
- 图纸上传、系统托盘、自动更新和本地数据库暂未接入。
