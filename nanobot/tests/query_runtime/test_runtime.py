from __future__ import annotations

import asyncio
from typing import Any

import pytest

from nanobot.query_runtime.contracts import (
    IdentityContext,
    QueryPlan,
    QueryRequest,
    RuntimeMode,
    SessionContext,
    ToolResult,
    ValidatedResult,
)
from nanobot.query_runtime.runtime import QueryRuntime, QueryRuntimeConfig
from nanobot.query_runtime.tracing import InMemoryAuditSink


def request(*, permissions: tuple[str, ...] = ("metric.read",)) -> QueryRequest:
    return QueryRequest(
        text="查询本月经营收入",
        identity=IdentityContext(
            user_id="u-1",
            username="jianghanfgs1",
            roles=("branch_manager",),
            organization_scope=("jianghan",),
            permissions=permissions,
        ),
        session=SessionContext(
            session_id="query:u-1:c-1",
            conversation_id="c-1",
            correlation_id="corr-1",
        ),
    )


class Planner:
    async def plan(self, value: QueryRequest) -> QueryPlan:
        return QueryPlan(
            intent="metric_query",
            steps=("semantic", "fetch", "compose"),
            required_permissions=("metric.read",),
        )


class Executor:
    async def execute(self, value: QueryRequest, plan: QueryPlan) -> tuple[ToolResult, ...]:
        return (ToolResult(tool_name="metric_fetch", payload={"value": 100}),)


class Validator:
    async def validate(
        self,
        value: QueryRequest,
        plan: QueryPlan,
        results: tuple[ToolResult, ...],
    ) -> ValidatedResult:
        return ValidatedResult(results=results, valid=True, facts={"value": 100})


class Composer:
    async def compose(self, value: QueryRequest, plan: QueryPlan, result: ValidatedResult) -> Any:
        return {"answer": "本月经营收入为100万元", "facts": dict(result.facts)}


def dependencies() -> dict[str, Any]:
    return {
        "planner": Planner(),
        "executor": Executor(),
        "validator": Validator(),
        "composer": Composer(),
    }


@pytest.mark.asyncio
async def test_legacy_mode_is_default_and_preserves_payload() -> None:
    calls: list[QueryRequest] = []

    async def legacy(value: QueryRequest) -> Any:
        calls.append(value)
        return {"answer": "legacy"}

    response = await QueryRuntime(legacy_handler=legacy).run(request())

    assert response.payload == {"answer": "legacy"}
    assert response.mode is RuntimeMode.LEGACY
    assert response.correlation_id == "corr-1"
    assert calls == [request()]


@pytest.mark.asyncio
async def test_shadow_mode_returns_legacy_even_when_shadow_fails() -> None:
    class BrokenPlanner:
        async def plan(self, value: QueryRequest) -> QueryPlan:
            raise RuntimeError("shadow exploded")

    sink = InMemoryAuditSink()

    async def legacy(value: QueryRequest) -> Any:
        return "unchanged"

    runtime = QueryRuntime(
        legacy_handler=legacy,
        config=QueryRuntimeConfig(mode=RuntimeMode.SHADOW),
        audit_sink=sink,
        **{**dependencies(), "planner": BrokenPlanner()},
    )
    response = await runtime.run(request())
    await runtime.drain_shadow_tasks()

    assert response.payload == "unchanged"
    assert response.metadata["response_source"] == "legacy"
    assert any(event["stage"] == "shadow" and event["status"] == "failed" for event in sink.events)


@pytest.mark.asyncio
async def test_agent_mode_runs_modular_pipeline() -> None:
    async def legacy(value: QueryRequest) -> Any:
        raise AssertionError("legacy should not run")

    response = await QueryRuntime(
        legacy_handler=legacy,
        config=QueryRuntimeConfig(mode=RuntimeMode.AGENT),
        **dependencies(),
    ).run(request())

    assert response.payload["facts"] == {"value": 100}
    assert response.metadata["response_source"] == "agent"
    assert response.fallback_used is False


@pytest.mark.asyncio
async def test_agent_permission_failure_falls_back_to_legacy() -> None:
    async def legacy(value: QueryRequest) -> Any:
        return "safe fallback"

    response = await QueryRuntime(
        legacy_handler=legacy,
        config=QueryRuntimeConfig(mode=RuntimeMode.AGENT),
        **dependencies(),
    ).run(request(permissions=()))

    assert response.payload == "safe fallback"
    assert response.fallback_used is True


@pytest.mark.asyncio
async def test_query_runtime_rejects_cross_product_session() -> None:
    with pytest.raises(ValueError, match="product='query'"):
        SessionContext(
            session_id="qa:u-1:c-1",
            correlation_id="corr-1",
            product="qa",
        )


@pytest.mark.asyncio
async def test_shadow_does_not_delay_legacy_response() -> None:
    shadow_started = asyncio.Event()
    shadow_release = asyncio.Event()

    class SlowPlanner:
        async def plan(self, value: QueryRequest) -> QueryPlan:
            shadow_started.set()
            await shadow_release.wait()
            return await Planner().plan(value)

    async def legacy(value: QueryRequest) -> Any:
        return "fast"

    runtime = QueryRuntime(
        legacy_handler=legacy,
        config=QueryRuntimeConfig(mode=RuntimeMode.SHADOW, shadow_timeout_seconds=1),
        **{**dependencies(), "planner": SlowPlanner()},
    )
    response = await asyncio.wait_for(runtime.run(request()), timeout=0.1)
    assert response.payload == "fast"
    await shadow_started.wait()
    shadow_release.set()
    await runtime.drain_shadow_tasks()
