"""Native read-only tools for the MES agent API."""

from __future__ import annotations

import json
from typing import Any
from uuid import uuid4

import httpx
from pydantic import Field

from nanobot.agent.tools.base import Tool, ToolResult, tool_parameters
from nanobot.agent.tools.context import current_request_context
from nanobot.agent.tools.schema import StringSchema, tool_parameters_schema
from nanobot.config_base import Base


class MesToolsConfig(Base):
    """Connection and identity settings for the MES read-only Tool API."""

    enable: bool = True
    base_url: str = "http://127.0.0.1:3000/api/v1/agent-api/tools/execute"
    tenant_id: str = "tenant-demo"
    requested_by: str = "nanobot"
    api_key: str | None = Field(default=None, repr=False)
    timeout_seconds: float = Field(default=10.0, ge=1.0, le=60.0)


class _MesTool(Tool):
    """Common transport and identity handling for MES query tools."""

    config_key = "mes"
    _scopes = {"core"}

    def __init__(self, config: MesToolsConfig | None = None) -> None:
        self.config = config or MesToolsConfig()

    @classmethod
    def config_cls(cls):
        return MesToolsConfig

    @classmethod
    def enabled(cls, ctx: Any) -> bool:
        return bool(getattr(getattr(ctx.config, "mes", None), "enable", False))

    @classmethod
    def create(cls, ctx: Any) -> Tool:
        return cls(config=ctx.config.mes)

    @property
    def read_only(self) -> bool:
        return True

    async def _call(self, arguments: dict[str, Any]) -> str | ToolResult:
        request = current_request_context()
        trace_id = (request.turn_id if request and request.turn_id else None) or uuid4().hex
        requested_by = self.config.requested_by or (request.sender_id if request else None) or "nanobot"
        payload = {
            "tool": self.name,
            "arguments": arguments,
            "tenantId": self.config.tenant_id,
            "requestedBy": requested_by,
            "traceId": trace_id,
        }
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"

        try:
            async with httpx.AsyncClient(timeout=self.config.timeout_seconds) as client:
                response = await client.post(self.config.base_url, json=payload, headers=headers)
                response.raise_for_status()
                result = response.json()
        except httpx.HTTPStatusError as exc:
            return ToolResult.error(f"Error: MES API returned HTTP {exc.response.status_code}")
        except (httpx.HTTPError, ValueError) as exc:
            return ToolResult.error(f"Error: MES API request failed: {exc}")

        if not isinstance(result, dict):
            return ToolResult.error("Error: MES API returned an invalid response")
        if result.get("ok") is not True:
            error = result.get("error")
            message = error.get("message") if isinstance(error, dict) else "MES Tool API query failed"
            return ToolResult.error(f"Error: {message}")
        return json.dumps(result.get("data"), ensure_ascii=False, default=str)


@tool_parameters(tool_parameters_schema())
class GetProductionOverviewTool(_MesTool):
    @property
    def name(self) -> str:
        return "get_production_overview"

    @property
    def description(self) -> str:
        return "Query the MES production overview. Read-only; never controls equipment."

    async def execute(self) -> str | ToolResult:
        return await self._call({})


@tool_parameters(tool_parameters_schema(required=["line_id"], line_id=StringSchema("MES production line ID.")))
class GetLineStatusTool(_MesTool):
    @property
    def name(self) -> str:
        return "get_line_status"

    @property
    def description(self) -> str:
        return "Query one MES production line status, devices, alarms and workload. Read-only."

    async def execute(self, line_id: str) -> str | ToolResult:
        return await self._call({"lineId": line_id})


@tool_parameters(tool_parameters_schema(required=["device_id"], device_id=StringSchema("MES device ID."), line_id=StringSchema("Optional MES line ID.", nullable=True)))
class GetDeviceStatusTool(_MesTool):
    @property
    def name(self) -> str:
        return "get_device_status"

    @property
    def description(self) -> str:
        return "Query one MES device status and telemetry. Read-only; never changes device state."

    async def execute(self, device_id: str, line_id: str | None = None) -> str | ToolResult:
        return await self._call({"deviceId": device_id, **({"lineId": line_id} if line_id else {})})


@tool_parameters(tool_parameters_schema(line_id=StringSchema("Optional MES line ID.", nullable=True), device_id=StringSchema("Optional MES device ID.", nullable=True), level=StringSchema("Optional alarm level: info, warning or critical.", nullable=True)))
class GetActiveAlarmsTool(_MesTool):
    @property
    def name(self) -> str:
        return "get_active_alarms"

    @property
    def description(self) -> str:
        return "Query active MES alarms with optional line, device and severity filters. Read-only."

    async def execute(self, line_id: str | None = None, device_id: str | None = None, level: str | None = None) -> str | ToolResult:
        return await self._call({key: value for key, value in {"lineId": line_id, "deviceId": device_id, "level": level}.items() if value})


@tool_parameters(tool_parameters_schema(required=["work_order_id"], work_order_id=StringSchema("MES work order ID.")))
class GetWorkOrderProgressTool(_MesTool):
    @property
    def name(self) -> str:
        return "get_work_order_progress"

    @property
    def description(self) -> str:
        return "Query MES work order progress and completion. Read-only; never edits work orders."

    async def execute(self, work_order_id: str) -> str | ToolResult:
        return await self._call({"workOrderId": work_order_id})


@tool_parameters(tool_parameters_schema(required=["work_order_id"], work_order_id=StringSchema("MES work order ID.")))
class GetDelayRiskTool(_MesTool):
    @property
    def name(self) -> str:
        return "get_delay_risk"

    @property
    def description(self) -> str:
        return "Query MES work order delay risk. Read-only; returns analysis only."

    async def execute(self, work_order_id: str) -> str | ToolResult:
        return await self._call({"workOrderId": work_order_id})


@tool_parameters(tool_parameters_schema(simulation_id=StringSchema("Optional simulation ID.", nullable=True)))
class GetSimulationSnapshotTool(_MesTool):
    @property
    def name(self) -> str:
        return "get_simulation_snapshot"

    @property
    def description(self) -> str:
        return "Query the MES simulation snapshot. Read-only; never starts or controls a simulation."

    async def execute(self, simulation_id: str | None = None) -> str | ToolResult:
        return await self._call({"simulationId": simulation_id} if simulation_id else {})


@tool_parameters(tool_parameters_schema(required=["simulation_id"], simulation_id=StringSchema("MES simulation ID.")))
class GetStrategyResultTool(_MesTool):
    @property
    def name(self) -> str:
        return "get_strategy_result"

    @property
    def description(self) -> str:
        return "Query a MES strategy simulation result and recommendations. Read-only; never executes a strategy."

    async def execute(self, simulation_id: str) -> str | ToolResult:
        return await self._call({"simulationId": simulation_id})

