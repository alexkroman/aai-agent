"""Tests for aai_agent.types."""

import pytest
from pydantic import ValidationError

from aai_agent.types import (
    STTConfig,
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
