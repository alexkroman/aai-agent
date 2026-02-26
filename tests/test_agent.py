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
from aai_agent.types import STTConfig, StreamingToken, VoiceResponse


@pytest.fixture
def agent(mock_env):
    return VoiceAgent()


class TestVoiceAgentInit:
    def test_requires_assemblyai_key(self):
        with (
            patch.dict(os.environ, {}, clear=True),
            patch("aai_agent.agent._load_dotenv"),
        ):
            with pytest.raises(ValueError, match="assemblyai_api_key"):
                VoiceAgent()

    def test_keys_from_env(self, mock_env):
        agent = VoiceAgent()
        assert agent._assemblyai_api_key == "test-key"

    def test_explicit_key_overrides_env(self, mock_env):
        agent = VoiceAgent(assemblyai_api_key="explicit-aai")
        assert agent._assemblyai_api_key == "explicit-aai"

    def test_default_model(self):
        assert DEFAULT_MODEL == "claude-haiku-4-5-20251001"

    def test_custom_model(self, mock_env):
        agent = VoiceAgent(model="custom-model")
        assert agent._model_id == "custom-model"

    @pytest.mark.parametrize(
        "greeting,expected",
        [
            (None, DEFAULT_GREETING),
            ("Hi!", "Hi!"),
            ("", ""),
        ],
    )
    def test_greeting(self, mock_env, greeting, expected):
        kwargs = {} if greeting is None else {"greeting": greeting}
        agent = VoiceAgent(**kwargs)
        assert agent.greeting == expected

    def test_default_max_steps(self, mock_env):
        agent = VoiceAgent()
        assert agent._max_steps == 3

    def test_max_steps_rejects_zero(self, mock_env):
        with pytest.raises(ValueError, match="max_steps"):
            VoiceAgent(max_steps=0)

    def test_max_steps_rejects_negative(self, mock_env):
        with pytest.raises(ValueError, match="max_steps"):
            VoiceAgent(max_steps=-1)

    def test_custom_stt_config(self, mock_env):
        stt_cfg = STTConfig(sample_rate=8000)
        agent = VoiceAgent(stt_config=stt_cfg)
        assert agent.stt.config.sample_rate == 8000

    @pytest.mark.parametrize(
        "voice_rules,expected",
        [
            (None, VOICE_RULES),
            ("Be brief.", "Be brief."),
            ("", ""),
        ],
    )
    def test_voice_rules(self, mock_env, voice_rules, expected):
        kwargs = {} if voice_rules is None else {"voice_rules": voice_rules}
        agent = VoiceAgent(**kwargs)
        assert agent._voice_rules == expected

    def test_memory_empty_before_chat(self, mock_env):
        agent = VoiceAgent()
        assert agent.memory == []


class TestVoiceAgentGreet:
    @pytest.mark.anyio
    async def test_greet_returns_text(self, agent):
        resp = await agent.greet()
        assert resp.text == DEFAULT_GREETING

    @pytest.mark.anyio
    async def test_greet_disabled(self, mock_env):
        agent = VoiceAgent(greeting="")
        resp = await agent.greet()
        assert resp.text == ""


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
        mock_result = MagicMock()
        mock_result.output = "The answer is 42."
        mock_result.all_messages.return_value = [MagicMock()]
        mock_result.new_messages.return_value = []
        agent._agent.run = AsyncMock(return_value=mock_result)

        resp = await agent.chat("What is the answer?")
        assert isinstance(resp, VoiceResponse)
        assert resp.text == "The answer is 42."

    @pytest.mark.anyio
    async def test_chat_with_reset(self, agent):
        # Seed some history
        agent._message_history = [MagicMock()]

        mock_result = MagicMock()
        mock_result.output = "Fresh start."
        mock_result.all_messages.return_value = []
        mock_result.new_messages.return_value = []
        agent._agent.run = AsyncMock(return_value=mock_result)

        resp = await agent.chat("Hello", reset=True)
        assert resp.text == "Fresh start."
        # message_history should have been cleared before the run
        call_kwargs = agent._agent.run.call_args
        assert call_kwargs.kwargs.get("message_history") == []


class TestVoiceAgentReset:
    @pytest.mark.anyio
    async def test_reset_clears_history(self, agent):
        agent._message_history = [MagicMock()]
        await agent.reset()
        assert agent._message_history == []


class TestVoiceAgentContextManager:
    @pytest.mark.anyio
    async def test_async_with(self, mock_env):
        async with VoiceAgent() as agent:
            assert isinstance(agent, VoiceAgent)
        # aclose was called — clients are closed

    @pytest.mark.anyio
    async def test_aclose(self, agent):
        agent.stt.aclose = AsyncMock()
        await agent.aclose()
        agent.stt.aclose.assert_called_once()


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


class TestExtractSteps:
    def test_extracts_tool_calls(self):
        from pydantic_ai.messages import ModelResponse, ToolCallPart

        from aai_agent.agent import _extract_steps

        messages = [
            ModelResponse(
                parts=[
                    ToolCallPart(
                        tool_name="duckduckgo_search_tool", args="{}", tool_call_id="1"
                    )
                ],
            ),
        ]
        steps = _extract_steps(messages)
        assert steps == ["Using duckduckgo_search_tool"]

    def test_empty_messages(self):
        from aai_agent.agent import _extract_steps

        assert _extract_steps([]) == []
