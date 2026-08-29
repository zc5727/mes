from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from nanobot.agent.tools.mes import GetActiveAlarmsTool, GetLineStatusTool, MesToolsConfig
from nanobot.agent.tools.context import RequestContext, request_context


class FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError("unexpected status")

    def json(self) -> dict:
        return self._payload


class FakeClient:
    last_request: dict | None = None

    def __init__(self, **_: object) -> None:
        pass

    async def __aenter__(self) -> "FakeClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        return None

    async def post(self, url: str, *, json: dict, headers: dict) -> FakeResponse:
        self.last_request = {"url": url, "json": json, "headers": headers}
        FakeClient.last_request = self.last_request
        return FakeResponse({"ok": True, "data": {"total": 4}})


@pytest.mark.asyncio
async def test_mes_tool_sends_identity_and_trace(monkeypatch: pytest.MonkeyPatch) -> None:
    from nanobot.agent.tools import mes

    monkeypatch.setattr(mes.httpx, "AsyncClient", FakeClient)
    tool = GetLineStatusTool(MesToolsConfig(tenant_id="tenant-demo", requested_by="operator"))
    context = RequestContext(channel="test", chat_id="chat", sender_id="user", turn_id="trace-123")

    with request_context(context):
        result = await tool.execute(line_id="line-cnc")

    assert json.loads(result) == {"total": 4}
    assert FakeClient.last_request is not None
    body = FakeClient.last_request["json"]
    assert body["tenantId"] == "tenant-demo"
    assert body["requestedBy"] == "operator"
    assert body["traceId"] == "trace-123"
    assert body["tool"] == "get_line_status"
    assert body["arguments"] == {"lineId": "line-cnc"}


@pytest.mark.asyncio
async def test_mes_tool_converts_business_error_to_tool_error(monkeypatch: pytest.MonkeyPatch) -> None:
    from nanobot.agent.tools import mes

    class ErrorClient(FakeClient):
        async def post(self, url: str, *, json: dict, headers: dict) -> FakeResponse:
            return FakeResponse({"ok": False, "error": {"code": "NOT_FOUND", "message": "产线不存在"}})

    monkeypatch.setattr(mes.httpx, "AsyncClient", ErrorClient)
    result = await GetActiveAlarmsTool(MesToolsConfig()).execute()

    assert result.is_error is True
    assert str(result) == "Error: 产线不存在"


def test_mes_tools_are_read_only_and_strictly_discoverable() -> None:
    tool = GetLineStatusTool(MesToolsConfig())
    assert tool.read_only is True
    assert "line_id" in tool.parameters["properties"]
    assert tool.parameters["required"] == ["line_id"]
    assert SimpleNamespace(mes=MesToolsConfig(enable=False)).mes.enable is False
