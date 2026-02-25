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
from .types import FallbackAnswerPrompt, STTConfig, StreamingToken, TTSConfig, VoiceResponse

__all__ = [
    "DEFAULT_GREETING",
    "DEFAULT_INSTRUCTIONS",
    "FALLBACK_ANSWER_PROMPT",
    "FallbackAnswerPrompt",
    "VoiceAgent",
    "VoiceAgentManager",
    "AssemblyAISTT",
    "RimeTTS",
    "STTConfig",
    "StreamingToken",
    "TTSConfig",
    "VoiceResponse",
    "VOICE_RULES",
]
