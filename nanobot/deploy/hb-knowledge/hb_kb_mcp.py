#!/usr/bin/env python3
"""MCP bridge for the Hubei Jiaotou online knowledge base."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

from mcp.server.fastmcp import FastMCP


MCP_SERVER = FastMCP("Hubei Jiaotou Online Knowledge")
DEFAULT_URL = "http://127.0.0.1:9091/knowledge-bases/retrieve"


def _compact_text(value: Any, *, limit: int = 4_000) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "..."


def retrieve_online_knowledge(query: str, top_k: int = 6) -> dict[str, Any]:
    query = query.strip()
    if not query:
        raise ValueError("query must not be empty")

    api_key = os.environ.get("HB_KB_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("HB_KB_API_KEY is not configured")

    top_k = max(1, min(int(top_k), 8))
    payload = json.dumps(
        {
            "knowledge_base_ids": [os.environ.get("HB_KB_ID", "active")],
            "query": query,
            "method": "doc",
            "offset": 0,
            "limit": top_k,
            "top_k": top_k,
            "search_threshold": float(os.environ.get("HB_KB_SEARCH_THRESHOLD", "0.15")),
        },
        ensure_ascii=False,
    ).encode("utf-8")
    request = urllib.request.Request(
        os.environ.get("HB_KB_URL", DEFAULT_URL),
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:300]
        raise RuntimeError(f"knowledge API returned HTTP {exc.code}: {detail}") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError(f"knowledge API is unavailable: {exc}") from exc

    hits = []
    for rank, item in enumerate(result.get("search_result_list") or [], start=1):
        hits.append(
            {
                "rank": rank,
                "title": _compact_text(item.get("title"), limit=500),
                "content": _compact_text(item.get("content")),
                "score": item.get("score"),
                "source_file": _compact_text(item.get("source_file"), limit=500),
                "section_path": _compact_text(item.get("section_path"), limit=500),
                "knowledge_base_id": item.get("knowledge_base_id"),
            }
        )

    return {
        "status": "ok",
        "query": query,
        "knowledge_base": os.environ.get("HB_KB_ID", "active"),
        "total": len(hits),
        "hits": hits,
        "grounding_rule": (
            "Use only directly relevant statements in hits. If hits do not contain enough "
            "evidence, say the online knowledge base has no sufficient basis."
        ),
    }


@MCP_SERVER.tool()
def search_online_knowledge(query: str, top_k: int = 6) -> dict[str, Any]:
    """Search the sole approved online knowledge source before answering factual questions."""

    return retrieve_online_knowledge(query, top_k)


if __name__ == "__main__":
    MCP_SERVER.run(transport="stdio")
