"""Tests for aai_agent.fastapi."""

import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from aai_agent.fastapi import (
    DEFAULT_CORS_ORIGINS,
    create_voice_app,
    create_voice_router,
)
from aai_agent.manager import VoiceAgentManager
from aai_agent.types import VoiceResponse


@pytest.fixture
def manager():
    with patch.dict(
        os.environ,
        {"ASSEMBLYAI_API_KEY": "test-key", "RIME_API_KEY": "test-key"},
    ):
        return VoiceAgentManager()


class TestCreateVoiceApp:
    def test_creates_app(self, manager):
        app = create_voice_app(agent_manager=manager, static_dir=None)
        assert app is not None

    def test_creates_app_with_tools(self):
        with patch.dict(
            os.environ,
            {"ASSEMBLYAI_API_KEY": "k", "RIME_API_KEY": "k"},
        ):
            app = create_voice_app(
                tools=["DuckDuckGoSearchTool"],
                static_dir=None,
            )
            assert app is not None

    def test_creates_app_without_manager(self):
        with patch.dict(
            os.environ,
            {"ASSEMBLYAI_API_KEY": "k", "RIME_API_KEY": "k"},
        ):
            app = create_voice_app(static_dir=None)
            assert app is not None

    def test_default_cors_origins(self):
        assert "http://localhost:5173" in DEFAULT_CORS_ORIGINS
        assert "http://localhost:3000" in DEFAULT_CORS_ORIGINS

    def test_custom_api_prefix(self, manager):
        app = create_voice_app(
            agent_manager=manager,
            api_prefix="/v1",
            static_dir=None,
        )
        routes = [r.path for r in app.routes]
        assert "/v1/tokens" in routes
        assert "/v1/greet" in routes
        assert "/v1/chat" in routes

    def test_disable_cors(self, manager):
        app = create_voice_app(
            agent_manager=manager,
            cors_origins=[],
            static_dir=None,
        )
        middleware_classes = [type(m).__name__ for m in app.user_middleware]
        assert "CORSMiddleware" not in str(middleware_classes)


class TestEndpoints:
    """Test endpoints by patching the manager's get_or_create to return a mock agent."""

    @pytest.fixture
    def mock_agent(self):
        agent = MagicMock()
        agent.create_streaming_token = AsyncMock(
            return_value={"wss_url": "wss://example.com", "sample_rate": 16000}
        )
        agent.greet = AsyncMock(
            return_value=VoiceResponse(text="Hello!", audio=b"wav")
        )
        agent.voice_chat = AsyncMock(
            return_value=VoiceResponse(
                text="42", audio=b"wav", steps=["Using DuckDuckGoSearchTool"]
            )
        )
        return agent

    @pytest.fixture
    def client(self, manager, mock_agent):
        manager.get_or_create = MagicMock(return_value=mock_agent)
        app = create_voice_app(agent_manager=manager, static_dir=None)
        return TestClient(app)

    def test_tokens_endpoint(self, client):
        resp = client.get("/api/tokens")
        assert resp.status_code == 200
        data = resp.json()
        assert data["wss_url"] == "wss://example.com"
        assert data["sample_rate"] == 16000

    def test_greet_endpoint(self, client):
        resp = client.post("/api/greet")
        assert resp.status_code == 200
        data = resp.json()
        assert data["reply"] == "Hello!"
        assert data["audio"] is not None

    def test_chat_endpoint(self, client):
        resp = client.post(
            "/api/chat",
            json={"message": "What is the answer?"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["reply"] == "42"
        assert data["audio"] is not None
        assert data["steps"] == ["Using DuckDuckGoSearchTool"]

    def test_chat_empty_message(self, client):
        resp = client.post("/api/chat", json={"message": ""})
        assert resp.status_code == 400

    def test_chat_missing_message(self, client):
        resp = client.post("/api/chat", json={})
        assert resp.status_code == 400


class TestSessionCookies:
    def test_sets_session_cookie(self, manager):
        mock_agent = MagicMock()
        mock_agent.create_streaming_token = AsyncMock(
            return_value={"wss_url": "wss://x", "sample_rate": 16000}
        )
        manager.get_or_create = MagicMock(return_value=mock_agent)

        app = create_voice_app(agent_manager=manager, static_dir=None)
        client = TestClient(app)

        resp = client.get("/api/tokens")
        assert "voice_session_id" in resp.cookies

    def test_reuses_session_cookie(self, manager):
        mock_agent = MagicMock()
        mock_agent.create_streaming_token = AsyncMock(
            return_value={"wss_url": "wss://x", "sample_rate": 16000}
        )
        manager.get_or_create = MagicMock(return_value=mock_agent)

        app = create_voice_app(agent_manager=manager, static_dir=None)
        client = TestClient(app)

        resp1 = client.get("/api/tokens")
        resp2 = client.get("/api/tokens")

        assert resp1.status_code == 200
        assert resp2.status_code == 200
