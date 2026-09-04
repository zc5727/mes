"""Policy helpers for running Nanobot as a MES-only adapter."""

from __future__ import annotations

from collections.abc import Iterable
from typing import TypeVar

from nanobot.agent.tools.base import Tool

_ToolT = TypeVar("_ToolT", bound=type[Tool])
MES_TOOL_MODULE = "nanobot.agent.tools.mes"


def mes_only_tool_classes(classes: Iterable[_ToolT]) -> list[_ToolT]:
    """Keep only native MES tools when MES-only mode is enabled."""
    return [tool_class for tool_class in classes if tool_class.__module__ == MES_TOOL_MODULE]
