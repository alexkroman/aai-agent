"""Tests for aai_agent.stt."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock

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

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=mock_response)

        with patch("aai_agent.stt.httpx.AsyncClient", return_value=mock_client):
            token = await stt.create_token()

        assert token == "ephemeral-token"
        mock_client.get.assert_called_once_with(
            TOKEN_URL,
            headers={"Authorization": "test-key"},
            params={"expires_in_seconds": 480},
        )
