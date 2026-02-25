"""Tests for aai_agent.types."""

import base64

import pytest
from pydantic import ValidationError

from aai_agent.types import (
    FallbackAnswerPrompt,
    STTConfig,
    StreamingToken,
    TTSConfig,
    VoiceResponse,
)


class TestTTSConfig:
    def test_defaults(self):
        cfg = TTSConfig()
        assert cfg.speaker == "lintel"
        assert cfg.model == "arcana"
        assert cfg.sample_rate == 24000
        assert cfg.speed == 1.15
        assert cfg.max_tokens == 1200

    def test_custom_values(self):
        cfg = TTSConfig(speaker="aria", model="v2", sample_rate=16000, speed=1.0)
        assert cfg.speaker == "aria"
        assert cfg.model == "v2"
        assert cfg.sample_rate == 16000
        assert cfg.speed == 1.0

    def test_frozen(self):
        cfg = TTSConfig()
        with pytest.raises(ValidationError):
            cfg.speaker = "other"

    def test_rejects_invalid_sample_rate(self):
        with pytest.raises(ValidationError):
            TTSConfig(sample_rate=0)
        with pytest.raises(ValidationError):
            TTSConfig(sample_rate=-1)

    def test_rejects_invalid_speed(self):
        with pytest.raises(ValidationError):
            TTSConfig(speed=0)
        with pytest.raises(ValidationError):
            TTSConfig(speed=-0.5)

    def test_rejects_invalid_max_tokens(self):
        with pytest.raises(ValidationError):
            TTSConfig(max_tokens=0)


class TestSTTConfig:
    def test_defaults(self):
        cfg = STTConfig()
        assert cfg.sample_rate == 16000
        assert cfg.speech_model == "u3-pro"
        assert cfg.wss_base == "wss://streaming.assemblyai.com/v3/ws"
        assert cfg.token_expires_in == 480
        assert cfg.format_turns is True
        assert cfg.end_of_turn_confidence_threshold == 0.8

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

    def test_rejects_invalid_confidence_threshold(self):
        with pytest.raises(ValidationError):
            STTConfig(end_of_turn_confidence_threshold=-0.1)
        with pytest.raises(ValidationError):
            STTConfig(end_of_turn_confidence_threshold=1.1)

    def test_confidence_threshold_boundary_values(self):
        assert STTConfig(end_of_turn_confidence_threshold=0).end_of_turn_confidence_threshold == 0
        assert STTConfig(end_of_turn_confidence_threshold=1).end_of_turn_confidence_threshold == 1


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

    def test_rejects_invalid_sample_rate(self):
        with pytest.raises(ValidationError):
            StreamingToken(wss_url="wss://example.com", sample_rate=0)


class TestVoiceResponse:
    def test_text_only(self):
        resp = VoiceResponse(text="hello")
        assert resp.text == "hello"
        assert resp.audio is None
        assert resp.steps == []
        assert resp.audio_base64 is None

    def test_with_audio(self):
        audio = b"fake-wav-data"
        resp = VoiceResponse(text="hello", audio=audio)
        assert resp.audio is audio
        assert resp.audio_base64 == base64.b64encode(audio).decode()

    def test_with_steps(self):
        resp = VoiceResponse(text="hello", steps=["Using DuckDuckGoSearchTool"])
        assert resp.steps == ["Using DuckDuckGoSearchTool"]

    def test_audio_base64_roundtrip(self):
        original = b"\x00\x01\x02\xff"
        resp = VoiceResponse(text="", audio=original)
        assert resp.audio_base64 is not None
        decoded = base64.b64decode(resp.audio_base64)
        assert decoded == original
