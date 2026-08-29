"""Dependency protocols for the modular query-agent runtime."""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Protocol

from nanobot.query_runtime.contracts import (
    QueryPlan,
    QueryRequest,
    ToolResult,
    ValidatedResult,
)

LegacyHandler = Callable[[QueryRequest], Awaitable[Any]]


class Planner(Protocol):
    async def plan(self, request: QueryRequest) -> QueryPlan: ...


class Executor(Protocol):
    async def execute(
        self,
        request: QueryRequest,
        plan: QueryPlan,
    ) -> tuple[ToolResult, ...]: ...


class Validator(Protocol):
    async def validate(
        self,
        request: QueryRequest,
        plan: QueryPlan,
        results: tuple[ToolResult, ...],
    ) -> ValidatedResult: ...


class Composer(Protocol):
    async def compose(
        self,
        request: QueryRequest,
        plan: QueryPlan,
        result: ValidatedResult,
    ) -> Any: ...


class AuditSink(Protocol):
    async def write(self, event: dict[str, Any]) -> None: ...
