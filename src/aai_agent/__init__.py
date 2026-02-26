"""aai-agent: A voice agent SDK powered by AssemblyAI and pydantic-ai."""

from pydantic_ai import Tool as Tool
from pydantic_ai.common_tools.duckduckgo import (
    duckduckgo_search_tool as duckduckgo_search_tool,
)

from .agent import (
    DEFAULT_GREETING,
    DEFAULT_INSTRUCTIONS,
    FALLBACK_ANSWER_PROMPT,
    VOICE_RULES,
    VoiceAgent,
)
from .manager import VoiceAgentManager
from .stt import AssemblyAISTT
from .types import (
    FallbackAnswerPrompt,
    STTConfig,
    StreamingToken,
    VoiceResponse,
)
from .fastapi import create_voice_app, create_voice_router
from .tools import visit_url_tool
from .voice_cleaner import VoiceCleaner

__all__ = [
    "DEFAULT_GREETING",
    "DEFAULT_INSTRUCTIONS",
    "FALLBACK_ANSWER_PROMPT",
    "FallbackAnswerPrompt",
    "Tool",
    "VoiceAgent",
    "VoiceAgentManager",
    "AssemblyAISTT",
    "STTConfig",
    "StreamingToken",
    "VoiceResponse",
    "VOICE_RULES",
    "VoiceCleaner",
    "create_voice_app",
    "create_voice_router",
    "duckduckgo_search_tool",
    "visit_url_tool",
]
