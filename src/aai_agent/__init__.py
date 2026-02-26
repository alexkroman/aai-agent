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
from smolagents import CodeAgent, MultiStepAgent, ToolCallingAgent, tool
from smolagents.tools import Tool

from .tools import TOOL_REGISTRY
from .tts import RimeTTS
from .types import (
    FallbackAnswerPrompt,
    STTConfig,
    StreamingToken,
    TTSConfig,
    VoiceResponse,
)
from .voice_cleaner import VoiceCleaner

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
    "CodeAgent",
    "MultiStepAgent",
    "Tool",
    "ToolCallingAgent",
    "tool",
    "TOOL_REGISTRY",
    "VoiceCleaner",
]
