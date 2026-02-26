"""Tests for aai_agent.stt."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from aai_agent.stt import AssemblyAISTT, TOKEN_URL
from aai_agent.types import STTConfig


class TestAssemblyAISTT:
    def test_init_defaults(self):
        stt = AssemblyAISTT("test-key")
        assert stt.api_key == "test-key"
        assert stt.config.sample_rate == 16000
        assert stt.config.speech_model == "u3-pro"

    def test_init_custom_config(self):
        cfg = STTConfig(sample_rate=8000, speech_model="nano")
        stt = AssemblyAISTT("test-key", cfg)
        assert stt.config.sample_rate == 8000
        assert stt.config.speech_model == "nano"

    def test_properties(self):
        stt = AssemblyAISTT("test-key")
        assert stt.sample_rate == 16000
        assert stt.wss_base == "wss://streaming.assemblyai.com/v3/ws"
        assert stt.speech_model == "u3-pro"

    @pytest.mark.anyio
    async def test_create_token(self):
        stt = AssemblyAISTT("test-key")

        mock_response = MagicMock()
        mock_response.json.return_value = {"token": "ephemeral-token"}
        mock_response.raise_for_status = MagicMock()

        stt._client = MagicMock()
        stt._client.get = AsyncMock(return_value=mock_response)

        token = await stt.create_token()

        assert token == "ephemeral-token"
        stt._client.get.assert_called_once_with(
            TOKEN_URL,
            headers={"Authorization": "test-key"},
            params={"expires_in_seconds": 480},
        )

    @pytest.mark.anyio
    async def test_aclose(self):
        stt = AssemblyAISTT("test-key")
        stt._client = MagicMock()
        stt._client.aclose = AsyncMock()

        await stt.aclose()
        stt._client.aclose.assert_called_once()
