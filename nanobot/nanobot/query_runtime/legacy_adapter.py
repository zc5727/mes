"""Adapters between the existing HBJTBOT handler and query runtime contracts."""

from __future__ import annotations

from typing import Any, Awaitable, Callable

from nanobot.query_runtime.contracts import QueryRequest

RawLegacyHandler = Callable[..., Awaitable[Any]]


class LegacyHandlerAdapter:
    """Passes the existing request fields through without reinterpretation."""

    def __init__(self, handler: RawLegacyHandler) -> None:
        self._handler = handler

    async def __call__(self, request: QueryRequest) -> Any:
        return await self._handler(
            text=request.text,
            user_id=request.identity.user_id,
            username=request.identity.username,
            roles=list(request.identity.roles),
            permissions=list(request.identity.permissions),
            organization_scope=list(request.identity.organization_scope),
            session_id=request.session.session_id,
            conversation_id=request.session.conversation_id,
            correlation_id=request.session.correlation_id,
            metadata=dict(request.metadata),
        )
