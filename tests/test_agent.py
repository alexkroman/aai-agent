"""Tests for aai_agent.agent."""

import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from aai_agent.agent import (
    DEFAULT_GREETING,
    DEFAULT_MODEL,
    VOICE_RULES,
    VoiceAgent,
)
from aai_agent.types import STTConfig, StreamingToken, TTSConfig, VoiceResponse


@pytest.fixture
def agent(mock_env):
    return VoiceAgent()


class TestVoiceAgentInit:
    def test_requires_assemblyai_key(self):
        with patch.dict(os.environ, {}, clear=True), \
             patch("dotenv.load_dotenv", return_value=False):
            with pytest.raises(ValueError, match="assemblyai_api_key"):
                VoiceAgent()

    def test_requires_rime_key(self):
        with patch.dict(os.environ, {"ASSEMBLYAI_API_KEY": "aai-key"}, clear=True), \
             patch("dotenv.load_dotenv", return_value=False):
            with pytest.raises(ValueError, match="rime_api_key"):
                VoiceAgent()

    def test_keys_from_env(self):
        with patch.dict(
            os.environ,
            {"ASSEMBLYAI_API_KEY": "aai-key", "RIME_API_KEY": "rime-key"},
        ):
            agent = VoiceAgent()
            assert agent._assemblyai_api_key == "aai-key"
            assert agent.tts.api_key == "rime-key"

    def test_explicit_keys_override_env(self):
        with patch.dict(
            os.environ,
            {"ASSEMBLYAI_API_KEY": "env-aai", "RIME_API_KEY": "env-rime"},
        ):
            agent = VoiceAgent(
                assemblyai_api_key="explicit-aai",
                rime_api_key="explicit-rime",
            )
            assert agent._assemblyai_api_key == "explicit-aai"
            assert agent.tts.api_key == "explicit-rime"

    def test_default_model(self):
        assert DEFAULT_MODEL == "claude-haiku-4-5-20251001"

    def test_custom_model(self, mock_env):
        agent = VoiceAgent(model="custom-model")
        assert agent._model_id == "custom-model"

    @pytest.mark.parametrize("greeting,expected", [
        (None, DEFAULT_GREETING),
        ("Hi!", "Hi!"),
        ("", ""),
    ])
    def test_greeting(self, mock_env, greeting, expected):
        kwargs = {} if greeting is None else {"greeting": greeting}
        agent = VoiceAgent(**kwargs)
        assert agent._greeting == expected

    def test_default_max_steps(self, mock_env):
        agent = VoiceAgent()
        assert agent._max_steps == 3

    def test_max_steps_rejects_zero(self, mock_env):
        with pytest.raises(ValueError, match="max_steps"):
            VoiceAgent(max_steps=0)

    def test_max_steps_rejects_negative(self, mock_env):
        with pytest.raises(ValueError, match="max_steps"):
            VoiceAgent(max_steps=-1)

    def test_custom_configs(self, mock_env):
        tts_cfg = TTSConfig(speaker="aria")
        stt_cfg = STTConfig(sample_rate=8000)
        agent = VoiceAgent(tts_config=tts_cfg, stt_config=stt_cfg)
        assert agent.tts.config.speaker == "aria"
        assert agent.stt.config.sample_rate == 8000

    @pytest.mark.parametrize("voice_rules,expected", [
        (None, VOICE_RULES),
        ("Be brief.", "Be brief."),
        ("", ""),
    ])
    def test_voice_rules(self, mock_env, voice_rules, expected):
        kwargs = {} if voice_rules is None else {"voice_rules": voice_rules}
        agent = VoiceAgent(**kwargs)
        assert agent._voice_rules == expected

    def test_tools_resolved_from_strings(self, mock_env):
        from smolagents import DuckDuckGoSearchTool
        agent = VoiceAgent(tools=["DuckDuckGoSearchTool"])
        assert len(agent._tools) == 1
        assert isinstance(agent._tools[0], DuckDuckGoSearchTool)

    def test_ask_user_tool_always_included(self, mock_env):
        agent = VoiceAgent()
        built = agent._build_agent()
        tool_names = [t.name for t in built.tools.values()]
        assert "ask_user" in tool_names

    def test_ask_user_tool_not_duplicated(self, mock_env):
        agent = VoiceAgent(tools=["DuckDuckGoSearchTool"])
        built = agent._build_agent()
        tool_names = [t.name for t in built.tools.values()]
        assert tool_names.count("ask_user") == 1


class TestVoiceAgentGreet:
    @pytest.mark.anyio
    async def test_greet_with_audio(self, agent):
        agent.tts.synthesize = AsyncMock(return_value=b"wav-data")
        resp = await agent.greet()
        assert resp.text == DEFAULT_GREETING
        assert resp.audio == b"wav-data"

    @pytest.mark.anyio
    async def test_greet_tts_failure(self, agent):
        agent.tts.synthesize = AsyncMock(side_effect=Exception("TTS down"))
        resp = await agent.greet()
        assert resp.text == DEFAULT_GREETING
        assert resp.audio is None

    @pytest.mark.anyio
    async def test_greet_disabled(self, mock_env):
        agent = VoiceAgent(greeting="")
        resp = await agent.greet()
        assert resp.text == ""
        assert resp.audio is None


class TestVoiceAgentChat:
    @pytest.mark.anyio
    async def test_chat_rejects_empty_message(self, agent):
        with pytest.raises(ValueError, match="message must not be empty"):
            await agent.chat("")

    @pytest.mark.anyio
    async def test_chat_rejects_whitespace_message(self, agent):
        with pytest.raises(ValueError, match="message must not be empty"):
            await agent.chat("   ")

    @pytest.mark.anyio
    async def test_chat_returns_voice_response(self, agent):
        mock_agent = MagicMock()
        mock_agent.run.return_value = "The answer is 42."
        agent._agent = mock_agent

        resp = await agent.chat("What is the answer?")
        assert isinstance(resp, VoiceResponse)
        assert resp.text == "The answer is 42."
        assert resp.audio is None
        mock_agent.run.assert_called_once_with("What is the answer?", reset=False)

    @pytest.mark.anyio
    async def test_chat_with_reset(self, agent):
        mock_agent = MagicMock()
        mock_agent.run.return_value = "Fresh start."
        agent._agent = mock_agent

        resp = await agent.chat("Hello", reset=True)
        mock_agent.run.assert_called_once_with("Hello", reset=True)
        assert resp.text == "Fresh start."

    @pytest.mark.anyio
    async def test_voice_chat_includes_audio(self, agent):
        mock_agent = MagicMock()
        mock_agent.run.return_value = "Hello!"
        agent._agent = mock_agent
        agent.tts.synthesize = AsyncMock(return_value=b"audio-bytes")

        resp = await agent.voice_chat("Hi")
        assert resp.text == "Hello!"
        assert resp.audio == b"audio-bytes"
        agent.tts.synthesize.assert_called_once_with("Hello!")

    @pytest.mark.anyio
    async def test_voice_chat_tts_failure(self, agent):
        mock_agent = MagicMock()
        mock_agent.run.return_value = "Hello!"
        agent._agent = mock_agent
        agent.tts.synthesize = AsyncMock(side_effect=Exception("TTS error"))

        resp = await agent.voice_chat("Hi")
        assert resp.text == "Hello!"
        assert resp.audio is None


class TestVoiceAgentSynthesize:
    @pytest.mark.anyio
    async def test_synthesize(self, agent):
        agent.tts.synthesize = AsyncMock(return_value=b"wav")
        result = await agent.synthesize("Hello")
        assert result == b"wav"
        agent.tts.synthesize.assert_called_once_with("Hello")


class TestVoiceAgentStreamingToken:
    @pytest.mark.anyio
    async def test_create_streaming_token(self, agent):
        agent.stt.create_token = AsyncMock(return_value="test-token")

        result = await agent.create_streaming_token()
        assert isinstance(result, StreamingToken)
        assert result.sample_rate == 16000
        assert "test-token" in result.wss_url
        assert "sample_rate=16000" in result.wss_url
        assert "speech_model=u3-pro" in result.wss_url
