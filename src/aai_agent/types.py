"""Shared types for the aai-agent SDK."""

import base64

from pydantic import BaseModel, ConfigDict, Field


class TTSConfig(BaseModel):
    """Configuration for Rime TTS."""

    model_config = ConfigDict(frozen=True)

    speaker: str = "lintel"
    model: str = "arcana"
    sample_rate: int = Field(default=24000, gt=0)
    speed: float = Field(default=1.15, gt=0)
    max_tokens: int = Field(default=1200, gt=0)
    repetition_penalty: float = Field(default=1.5, gt=0)
    temperature: float = Field(default=0.5, ge=0)
    top_p: float = Field(default=1.0, ge=0, le=1)


class STTConfig(BaseModel):
    """Configuration for AssemblyAI streaming STT."""

    model_config = ConfigDict(frozen=True)

    sample_rate: int = Field(default=16000, gt=0)
    speech_model: str = "u3-pro"
    wss_base: str = "wss://streaming.assemblyai.com/v3/ws"
    token_expires_in: int = Field(default=480, gt=0)
    format_turns: bool = True
    min_end_of_turn_silence_when_confident: int = Field(default=400, ge=0)
    max_turn_silence: int = Field(default=1200, ge=0)


class FallbackAnswerPrompt(BaseModel):
    """Template used when the agent gets stuck and needs a fallback answer."""

    model_config = ConfigDict(frozen=True)

    pre_messages: str
    post_messages: str


class StreamingToken(BaseModel):
    """Ephemeral token and WebSocket URL for browser-side STT, plus TTS config."""

    wss_url: str
    sample_rate: int = Field(gt=0)
    tts_enabled: bool = False
    tts_sample_rate: int = Field(default=24000, gt=0)


class VoiceResponse(BaseModel):
    """Response from a voice chat interaction."""

    text: str
    audio: bytes | None = None
    steps: list[str] = Field(default_factory=list)
    error: str | None = None

    @property
    def audio_base64(self) -> str | None:
        """Return audio as a base64-encoded string, or None."""
        if self.audio is None:
            return None
        return base64.b64encode(self.audio).decode()
