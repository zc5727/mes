"""Modular query-agent runtime for HBJTBOT data conversations.

The package is intentionally independent from the generic agent loop.  It can
be introduced in legacy, shadow, and agent modes without changing the public
chat API or sharing state with the knowledge Q&A product.
"""

from nanobot.query_runtime.contracts import (
    IdentityContext,
    QueryPlan,
    QueryRequest,
    QueryResponse,
    RuntimeMode,
    SessionContext,
    ToolResult,
    ValidatedResult,
)
from nanobot.query_runtime.runtime import QueryRuntime, QueryRuntimeConfig

__all__ = [
    "IdentityContext",
    "QueryPlan",
    "QueryRequest",
    "QueryResponse",
    "QueryRuntime",
    "QueryRuntimeConfig",
    "RuntimeMode",
    "SessionContext",
    "ToolResult",
    "ValidatedResult",
]
