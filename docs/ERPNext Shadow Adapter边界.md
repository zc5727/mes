# ERPNext Shadow Adapter 边界

`backend/src/integrations/erpnext/erpnext-adapter.port.ts` 定义可替换的 ERPNext 适配端口：

- `ErpNextAdapterPort`：统一健康检查、资源读取和报工提交流程。
- `ErpNextShadowAdapter`：仅使用本地 fixture，不发起 HTTP，不写 ERPNext。
- 所有 shadow 读取标记为 `source=shadow`、`degraded=true`。
- shadow 报工固定返回 `accepted=false`，不得生成或伪造 externalId。

当前线上 ERPNext HTTP 客户端仍由既有 `ErpNextService` 管理；本端口是后续替换边界，不代表已经完成 ERPNext 接入。
