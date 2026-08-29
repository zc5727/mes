from __future__ import annotations

import pytest

from nanobot.agent import knowledge_grounding


@pytest.mark.asyncio
async def test_grounding_disabled_without_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("NANOBOT_KB_GROUNDING_URL", raising=False)

    assert await knowledge_grounding.build_online_knowledge_block("question") is None


@pytest.mark.asyncio
async def test_grounding_renders_retrieved_evidence(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NANOBOT_KB_GROUNDING_URL", "http://knowledge.test/retrieve")
    monkeypatch.setattr(
        knowledge_grounding,
        "_retrieve",
        lambda _question: {
            "search_result_list": [
                {
                    "title": "Fire policy",
                    "source_file": "policy.md",
                    "section_path": "Emergency / Fire",
                    "score": 0.91,
                    "content": "Evacuate and report immediately.",
                }
            ]
        },
    )

    block = await knowledge_grounding.build_online_knowledge_block("What should I do?")

    assert block is not None
    assert block.source == "online-knowledge-grounding"
    assert "Fire policy" in block.content
    assert "Evacuate and report immediately." in block.content


@pytest.mark.asyncio
async def test_grounding_skips_slash_commands(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NANOBOT_KB_GROUNDING_URL", "http://knowledge.test/retrieve")

    assert await knowledge_grounding.build_online_knowledge_block("/new") is None


@pytest.mark.asyncio
async def test_grounding_adds_web_results_when_knowledge_is_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("NANOBOT_KB_GROUNDING_URL", "http://knowledge.test/retrieve")
    monkeypatch.setattr(
        knowledge_grounding,
        "_retrieve",
        lambda _question: {"search_result_list": []},
    )
    monkeypatch.setattr(
        knowledge_grounding,
        "_search_web",
        lambda _question: [
            {
                "title": "Public source",
                "url": "https://example.com/source",
                "snippet": "Supported public information.",
            }
        ],
    )

    block = await knowledge_grounding.build_online_knowledge_block("latest public update")

    assert block is not None
    assert "[Public Web Search Evidence]" in block.content
    assert "[网页1]" in block.content
    assert "https://example.com/source" not in block.content
    assert knowledge_grounding.append_exact_web_sources(
        "Answer [网页1]\nBad link: https/www3/example.com",
        [block],
    ) == (
        "Answer [网页1]\n\n"
        "网页来源：\n"
        "1. [Public source](https://example.com/source)"
    )


def test_bing_parser_extracts_organic_result() -> None:
    parser = knowledge_grounding._BingSearchParser()
    parser.feed(
        '<li class="b_algo"><h2><a href="https://example.com">Example title</a></h2>'
        '<div><p class="b_lineclamp2">Example snippet.</p></div></li>'
    )

    assert parser.results == [
        {
            "title": "Example title",
            "url": "https://example.com",
            "snippet": "Example snippet.",
        }
    ]


def test_web_search_query_removes_instruction_text() -> None:
    query = knowledge_grounding._web_search_query(
        "请使用网页来源告诉我湖北交通投资集团有限公司的官方网站，并给出可点击链接和网页来源。"
    )

    assert query == "湖北交通投资集团 官网"
