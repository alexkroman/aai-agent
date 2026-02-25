"""Session-aware agent manager with TTL-based cleanup."""

from __future__ import annotations

import threading
from collections.abc import MutableMapping

from cachetools import TTLCache

from .agent import VoiceAgent


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
        **agent_kwargs: Additional keyword arguments forwarded to
            :class:`VoiceAgent` for each new session (e.g. ``model``,
            ``tools``, ``instructions``, ``tts_config``).

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
        **agent_kwargs,
    ):
        self._assemblyai_api_key = assemblyai_api_key
        self._rime_api_key = rime_api_key
        self._agent_kwargs = agent_kwargs
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
