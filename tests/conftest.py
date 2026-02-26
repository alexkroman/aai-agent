"""Shared test configuration and fixtures."""

import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from aai_agent.manager import VoiceAgentManager
from aai_agent.types import StreamingToken, VoiceResponse


@pytest.fixture(params=["asyncio"])
def anyio_backend(request):
    """Only run async tests against asyncio (skip trio)."""
    return request.param


@pytest.fixture
def mock_env():
    """Patch environment with test API keys for the duration of the test."""
    with patch.dict(
        os.environ,
        {"ASSEMBLYAI_API_KEY": "test-key", "RIME_API_KEY": "test-key"},
    ):
        yield


@pytest.fixture
def manager(mock_env):
    """Create a VoiceAgentManager with test API keys."""
    return VoiceAgentManager()


@pytest.fixture
def mock_agent():
    """Create a fully mocked VoiceAgent for endpoint testing."""
    agent = MagicMock()
    agent.create_streaming_token = AsyncMock(
        return_value=StreamingToken(wss_url="wss://example.com", sample_rate=16000)
    )
    agent.greeting = "Hello!"
    agent.chat = AsyncMock(
        return_value=VoiceResponse(text="42", steps=["Using DuckDuckGoSearchTool"])
    )
    agent.cancel = AsyncMock()

    async def _fake_stream(text):
        yield b"fake-wav-bytes"

    agent.tts = MagicMock()
    agent.tts.config.sample_rate = 24000
    agent.tts.synthesize_stream = _fake_stream
    return agent
