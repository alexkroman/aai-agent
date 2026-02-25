"""Pre-built FastAPI router and app factory for voice agent endpoints."""

from __future__ import annotations

import secrets

from fastapi import APIRouter, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from itsdangerous import BadSignature, URLSafeSerializer

from .manager import VoiceAgentManager

COOKIE_NAME = "voice_session_id"


def create_voice_router(
    *,
    agent_manager: VoiceAgentManager,
    session_secret: str | None = None,
) -> APIRouter:
    """Create a FastAPI router with ``/tokens``, ``/greet``, and ``/chat`` endpoints.

    Session IDs are managed via signed cookies so no app-level
    ``SessionMiddleware`` is required.

    Args:
        agent_manager: A :class:`VoiceAgentManager` that owns per-session agents.
        session_secret: Secret key used to sign session cookies.
            Auto-generated if not provided.

    Returns:
        A :class:`~fastapi.APIRouter` ready to include with
        ``app.include_router()``.

    Example::

        from fastapi import FastAPI
        from aai_agent import VoiceAgentManager
        from aai_agent.fastapi import create_voice_router

        manager = VoiceAgentManager(tools=[...])
        app = FastAPI()
        app.include_router(
            create_voice_router(agent_manager=manager),
            prefix="/api",
        )
    """
    router = APIRouter()
    signer = URLSafeSerializer(session_secret or secrets.token_hex(32))

    def _session_id(request: Request, response: Response) -> str:
        """Read or create a signed session cookie."""
        cookie = request.cookies.get(COOKIE_NAME)
        if cookie:
            try:
                return signer.loads(cookie)
            except BadSignature:
                pass
        sid = secrets.token_hex(16)
        response.set_cookie(
            COOKIE_NAME, signer.dumps(sid),
            httponly=True, samesite="lax",
        )
        return sid

    @router.get("/tokens")
    async def tokens(request: Request, response: Response):
        sid = _session_id(request, response)
        agent = agent_manager.get_or_create(sid)
        return await agent.create_streaming_token()

    @router.post("/greet")
    async def greet(request: Request, response: Response):
        sid = _session_id(request, response)
        agent = agent_manager.get_or_create(sid)
        result = await agent.greet()
        return {"reply": result.text, "audio": result.audio_base64}

    @router.post("/chat")
    async def chat(request: Request, response: Response):
        sid = _session_id(request, response)

        data = await request.json()
        message = data.get("message", "").strip()
        if not message:
            raise HTTPException(status_code=400, detail="No message provided")

        agent = agent_manager.get_or_create(sid)
        result = await agent.voice_chat(message)
        return {
            "reply": result.text,
            "audio": result.audio_base64,
            "steps": result.steps,
        }

    return router


def create_voice_app(
    *,
    agent_manager: VoiceAgentManager,
    cors_origins: list[str] | None = None,
    static_dir: str | None = None,
    session_secret: str | None = None,
    api_prefix: str = "/api",
) -> FastAPI:
    """Create a fully configured FastAPI application for a voice agent.

    This is a higher-level alternative to :func:`create_voice_router` that
    handles CORS, the voice-agent router, and optional static file serving.

    Args:
        agent_manager: A :class:`VoiceAgentManager` that owns per-session agents.
        cors_origins: Allowed CORS origins (e.g.
            ``["http://localhost:5173"]``). Omit to disable CORS.
        static_dir: Path to a directory of static files (e.g. a Vite
            ``dist/`` build) to serve at ``/``. Omit to skip.
        session_secret: Secret key for signing session cookies.
            Auto-generated if not provided.
        api_prefix: URL prefix for the voice-agent endpoints.
            Defaults to ``"/api"``.

    Returns:
        A ready-to-run :class:`~fastapi.FastAPI` application.

    Example::

        from aai_agent import VoiceAgentManager
        from aai_agent.fastapi import create_voice_app

        manager = VoiceAgentManager(tools=[...])
        app = create_voice_app(
            agent_manager=manager,
            cors_origins=["http://localhost:5173"],
            static_dir="frontend/dist",
        )
    """
    app = FastAPI()

    if cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    app.include_router(
        create_voice_router(
            agent_manager=agent_manager,
            session_secret=session_secret,
        ),
        prefix=api_prefix,
    )

    if static_dir:
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="frontend")

    return app
