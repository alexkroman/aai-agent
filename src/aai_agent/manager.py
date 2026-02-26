"""Session-aware agent manager with TTL-based cleanup."""

from __future__ import annotations

import asyncio
import os
from collections.abc import MutableMapping
from typing import Any

from cachetools import TTLCache
from pydantic_ai import ModelSettings

from .agent import VoiceAgent, _load_dotenv
from .types import FallbackAnswerPrompt, STTConfig


class VoiceAgentManager:
    """Manages per-session VoiceAgent instances with automatic TTL expiry.

    Creates, retrieves, and garbage-collects agents so callers don't need
    to manage a session dict themselves.

    API keys are resolved in this order:

    1. Explicit argument (``assemblyai_api_key``).
    2. Environment variable ``ASSEMBLYAI_API_KEY``.

    Args:
        assemblyai_api_key: AssemblyAI API key. Falls back to the
            ``ASSEMBLYAI_API_KEY`` environment variable.
        ttl_seconds: Seconds of inactivity before a session is expired.
            Defaults to 3600 (1 hour). Set to 0 to disable expiry.
        model: LLM model ID forwarded to each :class:`VoiceAgent`.
        tools: List of tools forwarded to each :class:`VoiceAgent`.
        instructions: System prompt forwarded to each :class:`VoiceAgent`.
        max_steps: Maximum agent reasoning steps forwarded to each
            :class:`VoiceAgent`.
        model_settings: pydantic-ai ``ModelSettings`` forwarded to each
            :class:`VoiceAgent`.
        stt_config: STT configuration forwarded to each :class:`VoiceAgent`.
        greeting: Greeting text forwarded to each :class:`VoiceAgent`.
        voice_rules: Voice rules forwarded to each :class:`VoiceAgent`.
        fallback_answer_prompt: Fallback prompt forwarded to each
            :class:`VoiceAgent`.
        include_ask_user: Whether to include AskUserTool, forwarded to
            each :class:`VoiceAgent`.

    Example::

        from aai_agent import VoiceAgentManager, duckduckgo_search_tool

        manager = VoiceAgentManager(
            tools=[duckduckgo_search_tool()],
            ttl_seconds=3600,
        )

        agent = manager.get_or_create("session-123")
        response = await agent.chat("Hello!")
    """

    def __init__(
        self,
        assemblyai_api_key: str | None = None,
        *,
        ttl_seconds: float = 3600,
        model: str | None = None,
        tools: list[Any] | None = None,
        instructions: str | None = None,
        max_steps: int | None = None,
        model_settings: ModelSettings | None = None,
        stt_config: STTConfig | None = None,
        greeting: str | None = None,
        voice_rules: str | None = None,
        fallback_answer_prompt: FallbackAnswerPrompt | None = None,
        include_ask_user: bool | None = None,
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

        if not os.environ.get("ASSEMBLYAI_TTS_API_KEY"):
            raise ValueError(
                "ASSEMBLYAI_TTS_API_KEY environment variable must be set to enable Orpheus TTS"
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
                "model_settings": model_settings,
                "stt_config": stt_config,
                "greeting": greeting,
                "voice_rules": voice_rules,
                "fallback_answer_prompt": fallback_answer_prompt,
                "include_ask_user": include_ask_user,
            }.items()
            if v is not None
        }

        self._lock = asyncio.Lock()
        self._sessions: MutableMapping[str, VoiceAgent]
        if ttl_seconds > 0:
            self._sessions = TTLCache(maxsize=4096, ttl=ttl_seconds)
        else:
            self._sessions = {}

    async def get_or_create(self, session_id: str) -> VoiceAgent:
        """Get an existing agent or create a new one for the given session.

        Accessing a session refreshes its TTL timestamp.

        Args:
            session_id: Unique session identifier.

        Returns:
            VoiceAgent instance for this session.
        """
        async with self._lock:
            agent = self._sessions.get(session_id)
            if agent is not None:
                # Re-set to refresh TTL in TTLCache
                self._sessions[session_id] = agent
                return agent

            agent = VoiceAgent(
                assemblyai_api_key=self._assemblyai_api_key,
                **self._agent_kwargs,
            )
            self._sessions[session_id] = agent
            return agent

    async def remove(self, session_id: str) -> None:
        """Explicitly remove a session's agent and close its resources.

        Args:
            session_id: Session to remove.
        """
        async with self._lock:
            agent = self._sessions.pop(session_id, None)
        if agent is not None:
            await agent.aclose()

    async def active_sessions(self) -> int:
        """Number of currently active (non-expired) sessions."""
        async with self._lock:
            if isinstance(self._sessions, TTLCache):
                self._sessions.expire()
            return len(self._sessions)

    async def aclose_all(self) -> None:
        """Close all active agents. Called during graceful shutdown."""
        async with self._lock:
            agents = list(self._sessions.values())
            self._sessions.clear()
        await asyncio.gather(*(a.aclose() for a in agents), return_exceptions=True)
