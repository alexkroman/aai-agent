"""Built-in tools for the voice agent."""

from __future__ import annotations

import asyncio

import httpx
from pydantic_ai import Tool

_VISIT_TIMEOUT = 15.0
_MAX_CHARS = 8000


async def _visit_url(url: str) -> str:
    """Fetch a web page and return its text content.

    Args:
        url: The full URL to visit, e.g. "https://example.com".
    """
    try:
        from markdownify import markdownify
    except ImportError:
        markdownify = None  # type: ignore[assignment]

    async with httpx.AsyncClient(
        timeout=_VISIT_TIMEOUT, follow_redirects=True
    ) as client:
        resp = await client.get(url, headers={"User-Agent": "aai-agent/0.1"})
        resp.raise_for_status()

    content_type = resp.headers.get("content-type", "")
    if "html" in content_type and markdownify is not None:
        text = await asyncio.to_thread(
            markdownify, resp.text, strip=["img", "script", "style"]
        )
    else:
        text = resp.text

    if len(text) > _MAX_CHARS:
        text = text[:_MAX_CHARS] + "\n\n[truncated]"
    return text


def visit_url_tool() -> Tool:
    """Create a tool that fetches and returns the text content of a web page."""
    return Tool(_visit_url, name="visit_url")
