"""Tests for aai_agent.types."""

import base64

from aai_agent.types import STTConfig, TTSConfig, VoiceResponse


class TestTTSConfig:
    def test_defaults(self):
        cfg = TTSConfig()
        assert cfg.speaker == "luna"
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
        decoded = base64.b64decode(resp.audio_base64)
        assert decoded == original
