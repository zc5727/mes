"""Compatibility-first orchestration for the HBJTBOT query kernel."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from loguru import logger

from nanobot.query_runtime.contracts import QueryRequest, QueryResponse, RuntimeMode
from nanobot.query_runtime.protocols import (
    AuditSink,
    Composer,
    Executor,
    LegacyHandler,
    Planner,
    Validator,
)
from nanobot.query_runtime.tracing import TraceRecorder


@dataclass(frozen=True, slots=True)
class QueryRuntimeConfig:
    """Safe rollout controls.

    The default is deliberately ``legacy``.  Enabling the package alone cannot
    change production answers.
    """

    mode: RuntimeMode = RuntimeMode.LEGACY
    fallback_to_legacy: bool = True
    shadow_timeout_seconds: float = 30.0


class QueryRuntime:
    """Runs legacy, shadow, or modular agent execution behind one contract."""

    def __init__(
        self,
        *,
        legacy_handler: LegacyHandler,
        config: QueryRuntimeConfig | None = None,
        planner: Planner | None = None,
        executor: Executor | None = None,
        validator: Validator | None = None,
        composer: Composer | None = None,
        audit_sink: AuditSink | None = None,
    ) -> None:
        self.legacy_handler = legacy_handler
        self.config = config or QueryRuntimeConfig()
        self.planner = planner
        self.executor = executor
        self.validator = validator
        self.composer = composer
        self.audit_sink = audit_sink
        self._shadow_tasks: set[asyncio.Task[None]] = set()

        if self.config.mode in {RuntimeMode.SHADOW, RuntimeMode.AGENT}:
            missing = [
                name
                for name, dependency in (
                    ("planner", planner),
                    ("executor", executor),
                    ("validator", validator),
                    ("composer", composer),
                )
                if dependency is None
            ]
            if missing:
                raise ValueError(f"modular runtime dependencies missing: {', '.join(missing)}")

    async def run(self, request: QueryRequest) -> QueryResponse:
        """Execute one isolated query turn according to the rollout mode."""

        trace = TraceRecorder(request.session.correlation_id, self.audit_sink)
        await trace.record("runtime", "started", self.config.mode.value)

        if self.config.mode is RuntimeMode.LEGACY:
            payload = await self._run_legacy(request, trace)
            return QueryResponse(
                payload=payload,
                mode=RuntimeMode.LEGACY,
                correlation_id=request.session.correlation_id,
                trace_id=trace.trace_id,
            )

        if self.config.mode is RuntimeMode.SHADOW:
            payload = await self._run_legacy(request, trace)
            task = asyncio.create_task(self._run_shadow(request))
            self._shadow_tasks.add(task)
            task.add_done_callback(self._shadow_tasks.discard)
            await trace.record("shadow", "scheduled")
            return QueryResponse(
                payload=payload,
                mode=RuntimeMode.SHADOW,
                correlation_id=request.session.correlation_id,
                trace_id=trace.trace_id,
                metadata={"response_source": "legacy"},
            )

        try:
            payload = await self._run_agent(request, trace)
        except Exception as exc:
            await trace.record("agent", "failed", f"{type(exc).__name__}: {exc}")
            if not self.config.fallback_to_legacy:
                raise
            payload = await self._run_legacy(request, trace)
            await trace.record("fallback", "completed")
            return QueryResponse(
                payload=payload,
                mode=RuntimeMode.AGENT,
                correlation_id=request.session.correlation_id,
                trace_id=trace.trace_id,
                fallback_used=True,
                metadata={"response_source": "legacy"},
            )

        await trace.record("runtime", "completed")
        return QueryResponse(
            payload=payload,
            mode=RuntimeMode.AGENT,
            correlation_id=request.session.correlation_id,
            trace_id=trace.trace_id,
            metadata={"response_source": "agent"},
        )

    async def _run_legacy(self, request: QueryRequest, trace: TraceRecorder) -> Any:
        await trace.record("legacy", "started")
        payload = await self.legacy_handler(request)
        await trace.record("legacy", "completed")
        return payload

    async def _run_agent(self, request: QueryRequest, trace: TraceRecorder) -> Any:
        assert self.planner is not None
        assert self.executor is not None
        assert self.validator is not None
        assert self.composer is not None

        await trace.record("plan", "started")
        plan = await self.planner.plan(request)
        await trace.record("plan", "completed", plan.intent)
        self._enforce_permissions(request, plan.required_permissions)

        await trace.record("execute", "started")
        results = await self.executor.execute(request, plan)
        await trace.record("execute", "completed", str(len(results)))

        await trace.record("validate", "started")
        validated = await self.validator.validate(request, plan, results)
        if not validated.valid:
            raise ValueError("validation failed: " + "; ".join(validated.issues))
        await trace.record("validate", "completed")

        await trace.record("compose", "started")
        payload = await self.composer.compose(request, plan, validated)
        await trace.record("compose", "completed")
        return payload

    async def _run_shadow(self, request: QueryRequest) -> None:
        trace = TraceRecorder(request.session.correlation_id, self.audit_sink)
        try:
            await asyncio.wait_for(
                self._run_agent(request, trace),
                timeout=self.config.shadow_timeout_seconds,
            )
            await trace.record("shadow", "completed")
        except Exception as exc:
            logger.warning(
                "Query shadow run failed correlation_id={}: {}: {}",
                request.session.correlation_id,
                type(exc).__name__,
                exc,
            )
            await trace.record("shadow", "failed", f"{type(exc).__name__}: {exc}")

    @staticmethod
    def _enforce_permissions(request: QueryRequest, required: tuple[str, ...]) -> None:
        missing = sorted(set(required) - set(request.identity.permissions))
        if missing:
            raise PermissionError("missing query permissions: " + ", ".join(missing))

    async def drain_shadow_tasks(self) -> None:
        """Wait for current shadow runs; intended for shutdown and tests."""

        if self._shadow_tasks:
            await asyncio.gather(*tuple(self._shadow_tasks), return_exceptions=True)
