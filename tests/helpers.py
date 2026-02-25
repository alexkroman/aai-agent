"""Shared test helpers (importable by test modules)."""

import json
from unittest.mock import AsyncMock


def make_async_context_mock(**kwargs):
    """Create a mock with async context manager support (__aenter__/__aexit__).

    By default ``__aenter__`` returns the mock itself.
    Pass ``__aenter__=obj`` to override the enter value.
    All other kwargs are set as attributes on the mock.
    """
    mock = AsyncMock()
    enter_value = kwargs.pop("__aenter__", mock)
    mock.__aenter__ = AsyncMock(return_value=enter_value)
    mock.__aexit__ = AsyncMock(return_value=False)
    for attr, value in kwargs.items():
        setattr(mock, attr, value)
    return mock


def parse_ndjson(resp):
    """Parse NDJSON response lines into a list of dicts."""
    return [json.loads(line) for line in resp.text.strip().split("\n") if line.strip()]


def assert_ndjson_stream(resp, *, text, steps=None, has_audio=True):
    """Assert common NDJSON stream response structure."""
    assert resp.status_code == 200
    msgs = parse_ndjson(resp)
    reply = next(m for m in msgs if m["type"] == "reply")
    assert reply["text"] == text
    if steps is not None:
        assert reply["steps"] == steps
    if has_audio:
        assert any(m["type"] == "audio" for m in msgs)
    assert any(m["type"] == "done" for m in msgs)
