"""Tests for aai_agent.fastapi — /session WebSocket protocol."""

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from aai_agent.fastapi import (
    DEFAULT_CORS_ORIGINS,
    create_voice_app,
)


@pytest.fixture
def client(manager, mock_agent):
    manager.get_or_create = AsyncMock(return_value=mock_agent)
    manager.remove = AsyncMock()
    app = create_voice_app(agent_manager=manager, static_dir=None)
    return TestClient(app)


class TestCreateVoiceApp:
    def test_creates_app(self, manager):
        app = create_voice_app(agent_manager=manager, static_dir=None)
        assert app is not None

    def test_creates_app_with_tools(self, mock_env):
        def my_tool(query: str) -> str:
            """A test tool.

            Args:
                query: The search query.
            """
            return "result"

        app = create_voice_app(tools=[my_tool], static_dir=None)
        assert app is not None

    def test_creates_app_without_manager(self, mock_env):
        app = create_voice_app(static_dir=None)
        assert app is not None

    def test_default_cors_origins(self):
        assert "http://localhost:5173" in DEFAULT_CORS_ORIGINS
        assert "http://localhost:3000" in DEFAULT_CORS_ORIGINS

    def test_custom_api_prefix(self, manager):
        app = create_voice_app(agent_manager=manager, api_prefix="/v1", static_dir=None)
        routes = [getattr(r, "path", None) for r in app.routes]
        assert "/v1/session" in routes

    def test_disable_cors(self, manager):
        app = create_voice_app(agent_manager=manager, cors_origins=[], static_dir=None)
        middleware_classes = [type(m).__name__ for m in app.user_middleware]
        assert "CORSMiddleware" not in str(middleware_classes)

    def test_health_endpoint(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}
