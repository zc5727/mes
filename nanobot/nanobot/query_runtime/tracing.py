"""Small, dependency-free trace recorder for query turns."""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass
from typing import Any
from uuid import uuid4

from nanobot.query_runtime.protocols import AuditSink


@dataclass(frozen=True, slots=True)
class TraceEvent:
    trace_id: str
    correlation_id: str
    stage: str
    status: str
    timestamp: float
    elapsed_ms: int
    detail: str | None = None


class TraceRecorder:
    """Records stage events and optionally forwards them to an audit sink."""

    def __init__(self, correlation_id: str, sink: AuditSink | None = None) -> None:
        self.trace_id = uuid4().hex
        self.correlation_id = correlation_id
        self._sink = sink
        self._started_at = time.monotonic()
        self.events: list[TraceEvent] = []

    async def record(
        self,
        stage: str,
        status: str,
        detail: str | None = None,
    ) -> None:
        event = TraceEvent(
            trace_id=self.trace_id,
            correlation_id=self.correlation_id,
            stage=stage,
            status=status,
            timestamp=time.time(),
            elapsed_ms=int((time.monotonic() - self._started_at) * 1000),
            detail=detail,
        )
        self.events.append(event)
        if self._sink is not None:
            await self._sink.write(asdict(event))


class InMemoryAuditSink:
    """Useful default for tests and local shadow runs."""

    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    async def write(self, event: dict[str, Any]) -> None:
        self.events.append(dict(event))
