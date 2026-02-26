"""Tests for aai_agent.manager."""

from unittest.mock import patch

import pytest
from cachetools import TTLCache

from aai_agent.agent import VoiceAgent
from aai_agent.manager import VoiceAgentManager


class TestGetOrCreate:
    def test_creates_new_agent(self, manager):
        agent = manager.get_or_create("session-1")
        assert isinstance(agent, VoiceAgent)

    def test_returns_same_agent_for_same_session(self, manager):
        agent1 = manager.get_or_create("session-1")
        agent2 = manager.get_or_create("session-1")
        assert agent1 is agent2

    def test_different_sessions_get_different_agents(self, manager):
        agent1 = manager.get_or_create("session-1")
        agent2 = manager.get_or_create("session-2")
        assert agent1 is not agent2

    def test_active_sessions_count(self, manager):
        assert manager.active_sessions == 0
        manager.get_or_create("a")
        assert manager.active_sessions == 1
        manager.get_or_create("b")
        assert manager.active_sessions == 2
        manager.get_or_create("a")  # existing session
        assert manager.active_sessions == 2


class TestRemove:
    def test_remove_existing(self, manager):
        manager.get_or_create("session-1")
        assert manager.active_sessions == 1
        manager.remove("session-1")
        assert manager.active_sessions == 0

    def test_remove_nonexistent(self, manager):
        manager.remove("no-such-session")  # should not raise

    def test_remove_then_recreate(self, manager):
        agent1 = manager.get_or_create("session-1")
        manager.remove("session-1")
        agent2 = manager.get_or_create("session-1")
        assert agent1 is not agent2


class TestTTLExpiry:
    def test_expired_sessions_evicted(self, mock_env):
        manager = VoiceAgentManager(ttl_seconds=60)
        manager.get_or_create("old-session")
        assert manager.active_sessions == 1

        # Advance the timer past the TTL without sleeping
        with patch.object(
            TTLCache,
            "timer",
            return_value=manager._sessions.timer() + 61,  # type: ignore[union-attr]
        ):
            assert manager.active_sessions == 0

    def test_ttl_zero_disables_expiry(self, mock_env):
        manager = VoiceAgentManager(ttl_seconds=0)
        manager.get_or_create("session-1")
        # With ttl=0, sessions use a plain dict and never expire
        assert manager.active_sessions == 1

    def test_active_session_not_evicted(self, mock_env):
        manager = VoiceAgentManager(ttl_seconds=100)
        manager.get_or_create("session-1")
        assert manager.active_sessions == 1


class TestManagerRejectsUnknownKwargs:
    def test_typo_raises_immediately(self, mock_env):
        with pytest.raises(TypeError):
            VoiceAgentManager(max_stpes=5)  # type: ignore[call-arg]  # intentional typo


class TestAgentKwargsForwarding:
    def test_tools_forwarded(self, mock_env):
        manager = VoiceAgentManager(tools=["DuckDuckGoSearchTool"])
        agent = manager.get_or_create("s1")
        assert len(agent._tools) == 1

    def test_custom_model_forwarded(self, mock_env):
        manager = VoiceAgentManager(model="custom-model")
        agent = manager.get_or_create("s1")
        assert agent._model_id == "custom-model"

    def test_custom_greeting_forwarded(self, mock_env):
        manager = VoiceAgentManager(greeting="Yo!")
        agent = manager.get_or_create("s1")
        assert agent.greeting == "Yo!"
