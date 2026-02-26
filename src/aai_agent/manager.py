"""Session-aware agent manager with TTL-based cleanup."""

from __future__ import annotations

import os
import threading
from collections.abc import Callable, MutableMapping

from cachetools import TTLCache
from smolagents import MultiStepAgent
from smolagents.memory import MemoryStep
from smolagents.tools import Tool

from .agent import VoiceAgent, _load_dotenv
from .types import FallbackAnswerPrompt, STTConfig, TTSConfig


class VoiceAgentManager:
    """Manages per-session VoiceAgent instances with automatic TTL expiry.

    Creates, retrieves, and garbage-collects agents so callers don't need
    to manage a session dict themselves.

    API keys are resolved in this order:

    1. Explicit arguments (``assemblyai_api_key`` / ``rime_api_key``).
    2. Environment variables ``ASSEMBLYAI_API_KEY`` / ``RIME_API_KEY``.

    Args:
        assemblyai_api_key: AssemblyAI API key. Falls back to the
            ``ASSEMBLYAI_API_KEY`` environment variable.
        rime_api_key: Rime API key. Falls back to the
            ``RIME_API_KEY`` environment variable.
        ttl_seconds: Seconds of inactivity before a session is expired.
            Defaults to 3600 (1 hour). Set to 0 to disable expiry.
        model: LLM model ID forwarded to each :class:`VoiceAgent`.
        tools: List of tools forwarded to each :class:`VoiceAgent`.
        instructions: System prompt forwarded to each :class:`VoiceAgent`.
        max_steps: Maximum agent reasoning steps forwarded to each
            :class:`VoiceAgent`.
        step_callbacks: Step callback functions forwarded to each
            :class:`VoiceAgent`.
        tts_config: TTS configuration forwarded to each :class:`VoiceAgent`.
        stt_config: STT configuration forwarded to each :class:`VoiceAgent`.
        greeting: Greeting text forwarded to each :class:`VoiceAgent`.
        voice_rules: Voice rules forwarded to each :class:`VoiceAgent`.
        fallback_answer_prompt: Fallback prompt forwarded to each
            :class:`VoiceAgent`.
        agent_cls: The smolagents agent class forwarded to each
            :class:`VoiceAgent`.
        max_tool_threads: Max tool threads forwarded to each
            :class:`VoiceAgent`.
        include_ask_user: Whether to include AskUserTool, forwarded to
            each :class:`VoiceAgent`.
        model_kwargs: LLM keyword arguments forwarded to each
            :class:`VoiceAgent`.

    Example::

        from aai_agent import VoiceAgentManager
        from aai_agent.tools import DuckDuckGoSearchTool

        # Keys are read from ASSEMBLYAI_API_KEY and RIME_API_KEY env vars
        manager = VoiceAgentManager(
            tools=[DuckDuckGoSearchTool()],
            ttl_seconds=3600,
        )

        agent = manager.get_or_create("session-123")
        response = await agent.voice_chat("Hello!")
    """

    def __init__(
        self,
        assemblyai_api_key: str | None = None,
        rime_api_key: str | None = None,
        *,
        ttl_seconds: float = 3600,
        model: str | None = None,
        tools: list[Tool | str] | None = None,
        instructions: str | None = None,
        max_steps: int | None = None,
        step_callbacks: list[Callable[[MemoryStep], None]] | None = None,
        tts_config: TTSConfig | None = None,
        stt_config: STTConfig | None = None,
        greeting: str | None = None,
        voice_rules: str | None = None,
        fallback_answer_prompt: FallbackAnswerPrompt | None = None,
        agent_cls: type[MultiStepAgent] | None = None,
        max_tool_threads: int | None = None,
        include_ask_user: bool | None = None,
        model_kwargs: dict | None = None,
    ):
        _load_dotenv()

        # Validate API keys eagerly so config errors surface at startup,
        # not on the first user request.
        self._assemblyai_api_key = assemblyai_api_key or os.environ.get(
            "ASSEMBLYAI_API_KEY"
        )
        if not self._assemblyai_api_key:
            raise ValueError(
                "assemblyai_api_key must be provided or set via the "
                "ASSEMBLYAI_API_KEY environment variable"
            )

        self._rime_api_key = rime_api_key or os.environ.get("RIME_API_KEY")
        if not self._rime_api_key:
            raise ValueError(
                "rime_api_key must be provided or set via the "
                "RIME_API_KEY environment variable"
            )

        # Build kwargs dict for VoiceAgent, only including explicitly set values
        # so that VoiceAgent's own defaults are used for anything not provided.
        self._agent_kwargs: dict = {
            k: v
            for k, v in {
                "model": model,
                "tools": tools,
                "instructions": instructions,
                "max_steps": max_steps,
                "step_callbacks": step_callbacks,
                "tts_config": tts_config,
                "stt_config": stt_config,
                "greeting": greeting,
                "voice_rules": voice_rules,
                "fallback_answer_prompt": fallback_answer_prompt,
                "agent_cls": agent_cls,
                "max_tool_threads": max_tool_threads,
                "include_ask_user": include_ask_user,
                "model_kwargs": model_kwargs,
            }.items()
            if v is not None
        }

        self._lock = threading.Lock()
        self._sessions: MutableMapping[str, VoiceAgent]
        if ttl_seconds > 0:
            self._sessions = TTLCache(maxsize=4096, ttl=ttl_seconds)
        else:
            self._sessions = {}

    def get_or_create(self, session_id: str) -> VoiceAgent:
        """Get an existing agent or create a new one for the given session.

        Accessing a session refreshes its TTL timestamp.

        Args:
            session_id: Unique session identifier.

        Returns:
            VoiceAgent instance for this session.
        """
        with self._lock:
            agent = self._sessions.get(session_id)
            if agent is not None:
                # Re-set to refresh TTL in TTLCache
                self._sessions[session_id] = agent
                return agent

            agent = VoiceAgent(
                assemblyai_api_key=self._assemblyai_api_key,
                rime_api_key=self._rime_api_key,
                **self._agent_kwargs,
            )
            self._sessions[session_id] = agent
            return agent

    def remove(self, session_id: str) -> None:
        """Explicitly remove a session's agent.

        Args:
            session_id: Session to remove.
        """
        with self._lock:
            self._sessions.pop(session_id, None)

    @property
    def active_sessions(self) -> int:
        """Number of currently active (non-expired) sessions."""
        with self._lock:
            if isinstance(self._sessions, TTLCache):
                self._sessions.expire()
            return len(self._sessions)
