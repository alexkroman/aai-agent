"""Tests for aai_agent.manager."""

from unittest.mock import patch

import pytest
from cachetools import TTLCache

from aai_agent.agent import VoiceAgent
from aai_agent.manager import VoiceAgentManager


class TestGetOrCreate:
    @pytest.mark.anyio
    async def test_creates_new_agent(self, manager):
        agent = await manager.get_or_create("session-1")
        assert isinstance(agent, VoiceAgent)

    @pytest.mark.anyio
    async def test_returns_same_agent_for_same_session(self, manager):
        agent1 = await manager.get_or_create("session-1")
        agent2 = await manager.get_or_create("session-1")
        assert agent1 is agent2

    @pytest.mark.anyio
    async def test_different_sessions_get_different_agents(self, manager):
        agent1 = await manager.get_or_create("session-1")
        agent2 = await manager.get_or_create("session-2")
        assert agent1 is not agent2

    @pytest.mark.anyio
    async def test_active_sessions_count(self, manager):
        assert await manager.active_sessions() == 0
        await manager.get_or_create("a")
        assert await manager.active_sessions() == 1
        await manager.get_or_create("b")
        assert await manager.active_sessions() == 2
        await manager.get_or_create("a")  # existing session
        assert await manager.active_sessions() == 2


class TestRemove:
    @pytest.mark.anyio
    async def test_remove_existing(self, manager):
        await manager.get_or_create("session-1")
        assert await manager.active_sessions() == 1
        await manager.remove("session-1")
        assert await manager.active_sessions() == 0

    @pytest.mark.anyio
    async def test_remove_nonexistent(self, manager):
        await manager.remove("no-such-session")  # should not raise

    @pytest.mark.anyio
    async def test_remove_then_recreate(self, manager):
        agent1 = await manager.get_or_create("session-1")
        await manager.remove("session-1")
        agent2 = await manager.get_or_create("session-1")
        assert agent1 is not agent2


class TestTTLExpiry:
    @pytest.mark.anyio
    async def test_expired_sessions_evicted(self, mock_env):
        manager = VoiceAgentManager(ttl_seconds=60)
        await manager.get_or_create("old-session")
        assert await manager.active_sessions() == 1

        # Advance the timer past the TTL without sleeping
        with patch.object(
            TTLCache,
            "timer",
            return_value=manager._sessions.timer() + 61,  # type: ignore[union-attr]
        ):
            assert await manager.active_sessions() == 0

    @pytest.mark.anyio
    async def test_ttl_zero_disables_expiry(self, mock_env):
        manager = VoiceAgentManager(ttl_seconds=0)
        await manager.get_or_create("session-1")
        # With ttl=0, sessions use a plain dict and never expire
        assert await manager.active_sessions() == 1

    @pytest.mark.anyio
    async def test_active_session_not_evicted(self, mock_env):
        manager = VoiceAgentManager(ttl_seconds=100)
        await manager.get_or_create("session-1")
        assert await manager.active_sessions() == 1


class TestManagerRejectsUnknownKwargs:
    def test_typo_raises_immediately(self, mock_env):
        with pytest.raises(TypeError):
            VoiceAgentManager(max_stpes=5)  # type: ignore[call-arg]  # intentional typo


class TestAgentKwargsForwarding:
    @pytest.mark.anyio
    async def test_custom_model_forwarded(self, mock_env):
        manager = VoiceAgentManager(model="custom-model")
        agent = await manager.get_or_create("s1")
        assert agent._model_id == "custom-model"

    @pytest.mark.anyio
    async def test_custom_greeting_forwarded(self, mock_env):
        manager = VoiceAgentManager(greeting="Yo!")
        agent = await manager.get_or_create("s1")
        assert agent.greeting == "Yo!"
