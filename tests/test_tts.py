"""Tests for aai_agent.tts."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from aai_agent.tts import RimeTTS, RIME_API_URL
from aai_agent.types import TTSConfig


class TestRimeTTS:
    def test_init_defaults(self):
        tts = RimeTTS("test-key")
        assert tts.api_key == "test-key"
        assert tts.config.speaker == "luna"
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

        mock_stream_ctx = AsyncMock()
        mock_stream_ctx.__aenter__ = AsyncMock(return_value=mock_response)
        mock_stream_ctx.__aexit__ = AsyncMock(return_value=False)

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.stream = MagicMock(return_value=mock_stream_ctx)

        with patch("aai_agent.tts.httpx.AsyncClient", return_value=mock_client):
            result = await tts.synthesize("Hello world")

        assert result == b"RIFFdata"
        mock_client.stream.assert_called_once()
        call_args = mock_client.stream.call_args
        assert call_args[0][0] == "POST"
        assert call_args[0][1] == RIME_API_URL
        assert call_args[1]["json"]["text"] == "Hello world"
        assert call_args[1]["json"]["speaker"] == "luna"
