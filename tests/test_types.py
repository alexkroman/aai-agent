"""Tests for aai_agent.types."""

import pytest
from pydantic import ValidationError

from aai_agent.types import (
    FallbackAnswerPrompt,
    STTConfig,
    StreamingToken,
    VoiceResponse,
)


class TestSTTConfig:
    def test_defaults(self):
        cfg = STTConfig()
        assert cfg.sample_rate == 16000
        assert cfg.speech_model == "u3-pro"
        assert cfg.wss_base == "wss://streaming.assemblyai.com/v3/ws"
        assert cfg.token_expires_in == 480
        assert cfg.format_turns is True
        assert cfg.min_end_of_turn_silence_when_confident == 400
        assert cfg.max_turn_silence == 1200

    def test_custom_values(self):
        cfg = STTConfig(sample_rate=8000, speech_model="nano")
        assert cfg.sample_rate == 8000
        assert cfg.speech_model == "nano"

    def test_frozen(self):
        cfg = STTConfig()
        with pytest.raises(ValidationError):
            cfg.sample_rate = 8000

    def test_rejects_invalid_sample_rate(self):
        with pytest.raises(ValidationError):
            STTConfig(sample_rate=0)

    def test_rejects_invalid_token_expires_in(self):
        with pytest.raises(ValidationError):
            STTConfig(token_expires_in=0)


class TestFallbackAnswerPrompt:
    def test_valid(self):
        prompt = FallbackAnswerPrompt(pre_messages="pre", post_messages="post")
        assert prompt.pre_messages == "pre"
        assert prompt.post_messages == "post"

    def test_frozen(self):
        prompt = FallbackAnswerPrompt(pre_messages="pre", post_messages="post")
        with pytest.raises(ValidationError):
            prompt.pre_messages = "other"

    def test_requires_both_fields(self):
        with pytest.raises(ValidationError):
            FallbackAnswerPrompt(pre_messages="pre")  # type: ignore[call-arg]
        with pytest.raises(ValidationError):
            FallbackAnswerPrompt(post_messages="post")  # type: ignore[call-arg]

    def test_model_dump(self):
        prompt = FallbackAnswerPrompt(pre_messages="pre", post_messages="post")
        assert prompt.model_dump() == {"pre_messages": "pre", "post_messages": "post"}


class TestStreamingToken:
    def test_valid(self):
        token = StreamingToken(wss_url="wss://example.com", sample_rate=16000)
        assert token.wss_url == "wss://example.com"
        assert token.sample_rate == 16000

    def test_tts_defaults(self):
        token = StreamingToken(wss_url="wss://example.com", sample_rate=16000)
        assert token.tts_enabled is False
        assert token.tts_sample_rate == 24000

    def test_tts_enabled(self):
        token = StreamingToken(
            wss_url="wss://example.com", sample_rate=16000, tts_enabled=True
        )
        assert token.tts_enabled is True

    def test_rejects_invalid_sample_rate(self):
        with pytest.raises(ValidationError):
            StreamingToken(wss_url="wss://example.com", sample_rate=0)


class TestVoiceResponse:
    def test_text_only(self):
        resp = VoiceResponse(text="hello")
        assert resp.text == "hello"
        assert resp.steps == []
        assert resp.error is None

    def test_with_steps(self):
        resp = VoiceResponse(text="hello", steps=["Using DuckDuckGoSearchTool"])
        assert resp.steps == ["Using DuckDuckGoSearchTool"]

    def test_with_error(self):
        resp = VoiceResponse(text="hello", error="TTS synthesis failed: timeout")
        assert resp.error == "TTS synthesis failed: timeout"
