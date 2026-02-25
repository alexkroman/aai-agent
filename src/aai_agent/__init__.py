"""aai-agent: A voice agent SDK powered by AssemblyAI, Rime, and smolagents."""

from .agent import (
    DEFAULT_GREETING,
    DEFAULT_INSTRUCTIONS,
    FALLBACK_ANSWER_PROMPT,
    VOICE_RULES,
    VoiceAgent,
)
from .manager import VoiceAgentManager
from .stt import AssemblyAISTT
from .tts import RimeTTS
from .types import STTConfig, TTSConfig, VoiceResponse

__all__ = [
    "DEFAULT_GREETING",
    "DEFAULT_INSTRUCTIONS",
    "VoiceAgent",
    "VoiceAgentManager",
    "AssemblyAISTT",
    "RimeTTS",
    "STTConfig",
    "TTSConfig",
    "VoiceResponse",
    "VOICE_RULES",
    "FALLBACK_ANSWER_PROMPT",
]
