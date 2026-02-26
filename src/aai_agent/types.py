"""Shared types for the aai-agent SDK."""

from pydantic import BaseModel, ConfigDict, Field


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
    steps: list[str] = Field(default_factory=list)
    error: str | None = None
