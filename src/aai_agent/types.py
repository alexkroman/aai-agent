"""Shared types for the aai-agent SDK."""

import base64
from dataclasses import dataclass, field


@dataclass
class TTSConfig:
    """Configuration for Rime TTS."""

    speaker: str = "luna"
    model: str = "arcana"
    sample_rate: int = 24000
    speed: float = 1.15
    repetition_penalty: float = 1.5
    temperature: float = 0.5
    top_p: float = 1.0
    max_tokens: int = 1200


@dataclass
class STTConfig:
    """Configuration for AssemblyAI streaming STT."""

    sample_rate: int = 16000
    speech_model: str = "u3-pro"
    wss_base: str = "wss://streaming.assemblyai.com/v3/ws"
    token_expires_in: int = 480
    format_turns: bool = True
    end_of_turn_confidence_threshold: float = 0.8


@dataclass
class VoiceResponse:
    """Response from a voice chat interaction."""

    text: str
    audio: bytes | None = None
    steps: list[str] = field(default_factory=list)

    @property
    def audio_base64(self) -> str | None:
        """Return audio as a base64-encoded string, or None."""
        if self.audio is None:
            return None
        return base64.b64encode(self.audio).decode()
