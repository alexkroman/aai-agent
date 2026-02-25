"""Tests for aai_agent.manager."""

import os
import time
from unittest.mock import patch

import pytest

from aai_agent.agent import VoiceAgent
from aai_agent.manager import VoiceAgentManager


@pytest.fixture
def manager():
    with patch.dict(
        os.environ,
        {"ASSEMBLYAI_API_KEY": "test-key", "RIME_API_KEY": "test-key"},
    ):
        return VoiceAgentManager(ttl_seconds=3600)


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
    def test_expired_sessions_evicted(self):
        with patch.dict(
            os.environ,
            {"ASSEMBLYAI_API_KEY": "k", "RIME_API_KEY": "k"},
        ):
            manager = VoiceAgentManager(ttl_seconds=1)
            manager.get_or_create("old-session")
            assert manager.active_sessions == 1

            # Simulate time passing by manipulating the stored timestamp
            with manager._lock:
                agent, _ = manager._sessions["old-session"]
                manager._sessions["old-session"] = (agent, time.monotonic() - 2)

            assert manager.active_sessions == 0

    def test_ttl_zero_disables_expiry(self):
        with patch.dict(
            os.environ,
            {"ASSEMBLYAI_API_KEY": "k", "RIME_API_KEY": "k"},
        ):
            manager = VoiceAgentManager(ttl_seconds=0)
            manager.get_or_create("session-1")

            # Manipulate timestamp to be very old
            with manager._lock:
                agent, _ = manager._sessions["session-1"]
                manager._sessions["session-1"] = (agent, 0)

            assert manager.active_sessions == 1

    def test_active_session_not_evicted(self):
        with patch.dict(
            os.environ,
            {"ASSEMBLYAI_API_KEY": "k", "RIME_API_KEY": "k"},
        ):
            manager = VoiceAgentManager(ttl_seconds=100)
            manager.get_or_create("session-1")
            assert manager.active_sessions == 1


class TestAgentKwargsForwarding:
    def test_tools_forwarded(self):
        with patch.dict(
            os.environ,
            {"ASSEMBLYAI_API_KEY": "k", "RIME_API_KEY": "k"},
        ):
            manager = VoiceAgentManager(
                tools=["DuckDuckGoSearchTool"],
            )
            agent = manager.get_or_create("s1")
            assert len(agent._tools) == 1

    def test_custom_model_forwarded(self):
        with patch.dict(
            os.environ,
            {"ASSEMBLYAI_API_KEY": "k", "RIME_API_KEY": "k"},
        ):
            manager = VoiceAgentManager(model="custom-model")
            agent = manager.get_or_create("s1")
            assert agent._model_id == "custom-model"

    def test_custom_greeting_forwarded(self):
        with patch.dict(
            os.environ,
            {"ASSEMBLYAI_API_KEY": "k", "RIME_API_KEY": "k"},
        ):
            manager = VoiceAgentManager(greeting="Yo!")
            agent = manager.get_or_create("s1")
            assert agent._greeting == "Yo!"
