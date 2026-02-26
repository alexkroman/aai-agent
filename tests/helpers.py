"""Shared test helpers (importable by test modules)."""

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
