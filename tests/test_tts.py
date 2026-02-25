"""Tests for aai_agent.tts."""

from unittest.mock import MagicMock, patch

import pytest

from aai_agent.tts import RimeTTS, RIME_API_URL
from aai_agent.types import TTSConfig

from helpers import make_async_context_mock


class TestRimeTTS:
    def test_init_defaults(self):
        tts = RimeTTS("test-key")
        assert tts.api_key == "test-key"
        assert tts.config.speaker == "lintel"
        assert tts.config.model == "arcana"

    def test_init_custom_config(self):
        cfg = TTSConfig(speaker="aria", speed=1.5)
        tts = RimeTTS("test-key", cfg)
        assert tts.config.speaker == "aria"
        assert tts.config.speed == 1.5

    @pytest.mark.anyio
    async def test_synthesize(self):
        tts = RimeTTS("test-key")

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        async def mock_aiter_bytes():
            yield b"RIFF"
            yield b"data"

        mock_response.aiter_bytes = mock_aiter_bytes

        mock_stream_ctx = make_async_context_mock(__aenter__=mock_response)
        mock_client = make_async_context_mock(
            stream=MagicMock(return_value=mock_stream_ctx),
        )

        with patch("aai_agent.tts.httpx.AsyncClient", return_value=mock_client):
            result = await tts.synthesize("Hello world")

        assert result == b"RIFFdata"
        mock_client.stream.assert_called_once()
        call_kwargs = mock_client.stream.call_args.kwargs
        assert call_kwargs["method"] == "POST"
        assert call_kwargs["url"] == RIME_API_URL
        assert call_kwargs["json"]["text"] == "Hello world"
        assert call_kwargs["json"]["speaker"] == "lintel"
