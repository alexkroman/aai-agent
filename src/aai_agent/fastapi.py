"""Pre-built FastAPI router and app factory for voice agent endpoints."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import secrets

from fastapi import APIRouter, FastAPI, HTTPException, Request, Response, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from itsdangerous import BadSignature, URLSafeSerializer
from starlette.websockets import WebSocketDisconnect

from smolagents.tools import Tool

from .manager import VoiceAgentManager
from .voice_cleaner import VoiceCleaner

logger = logging.getLogger(__name__)

COOKIE_NAME = "voice_session_id"
DEFAULT_CORS_ORIGINS: tuple[str, ...] = (
    "http://localhost:5173",
    "http://localhost:3000",
)

DEFAULT_TTS_WSS_URL = (
    "wss://model-q844y7pw.api.baseten.co/environments/production/websocket"
)


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
    # Track in-flight chat tasks per session so barge-in can cancel them.
    _active_tasks: dict[str, asyncio.Task] = {}

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
            COOKIE_NAME,
            signer.dumps(sid),
            httponly=True,
            samesite="lax",
        )
        return sid

    async def _cancel_active(sid: str) -> None:
        """Cancel any in-flight chat task for this session."""
        task = _active_tasks.pop(sid, None)
        if task is not None and not task.done():
            logger.info("Cancelling in-flight task for session %s", sid[:8])
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

    @router.get("/tokens")
    async def tokens(request: Request, response: Response):
        sid = _session_id(request, response)
        agent = agent_manager.get_or_create(sid)
        return await agent.create_streaming_token()

    @router.post("/greet")
    async def greet(request: Request, response: Response):
        sid = _session_id(request, response)
        agent = agent_manager.get_or_create(sid)

        greeting_text = agent.greeting
        if not greeting_text:
            return Response(status_code=204)

        return {"text": greeting_text}

    @router.post("/chat")
    async def chat(request: Request, response: Response):
        sid = _session_id(request, response)

        data = await request.json()
        message = data.get("message", "").strip()
        if not message:
            raise HTTPException(status_code=400, detail="No message provided")

        # Cancel any previous in-flight task for this session (barge-in)
        await _cancel_active(sid)

        agent = agent_manager.get_or_create(sid)

        # Run LLM first (cancellable via task tracking)
        async def _do_chat():
            try:
                return await agent.chat(message)
            finally:
                _active_tasks.pop(sid, None)

        task = asyncio.create_task(_do_chat())
        _active_tasks[sid] = task

        try:
            result = await task
        except asyncio.CancelledError:
            return Response(status_code=499)

        return {"text": result.text, "steps": result.steps}

    @router.post("/cancel")
    async def cancel(request: Request, response: Response):
        """Cancel any in-flight chat task for this session."""
        sid = _session_id(request, response)
        await _cancel_active(sid)
        # Also cancel at the agent level
        agent = agent_manager.get_or_create(sid)
        await agent.cancel()
        return {"status": "cancelled"}

    @router.post("/reset")
    async def reset(request: Request, response: Response):
        """Reset the session, clearing agent conversation history."""
        sid = _session_id(request, response)
        await _cancel_active(sid)
        agent_manager.remove(sid)
        return {"status": "reset"}

    @router.websocket("/tts")
    async def tts_proxy(ws: WebSocket):
        """WebSocket proxy for Assembly TTS.

        Keeps the TTS API key server-side.  The browser sends
        ``{"text": "..."}`` and receives binary PCM audio frames
        followed by ``{"type": "done"}``.  Send ``{"type": "cancel"}``
        to abort an in-flight synthesis.
        """
        import websockets

        api_key = os.environ.get("ASSEMBLY_TTS_API_KEY")
        if not api_key:
            await ws.close(code=1008, reason="TTS not configured")
            return

        tts_base = os.environ.get("ASSEMBLY_TTS_WSS_URL", DEFAULT_TTS_WSS_URL)
        tts_headers = {"Authorization": f"Api-Key {api_key}"}
        tts_voice = os.environ.get("ASSEMBLY_TTS_VOICE", "tara")
        cleaner = VoiceCleaner()
        relay_task: asyncio.Task | None = None

        await ws.accept()

        async def _relay(text: str) -> None:
            """Connect to upstream Orpheus TTS and relay audio chunks.

            Orpheus protocol:
              1. Send JSON config (voice, max_tokens, buffer_size)
              2. Send text word-by-word as individual string messages
              3. Send ``__END__`` sentinel
              4. Receive binary PCM audio frames until connection closes
            """
            try:
                async with websockets.connect(
                    tts_base, additional_headers=tts_headers
                ) as upstream:
                    # Send voice config
                    await upstream.send(
                        json.dumps(
                            {
                                "voice": tts_voice,
                                "max_tokens": 2000,
                                "buffer_size": 5,
                            }
                        )
                    )
                    # Send text word-by-word then sentinel
                    for word in text.split():
                        await upstream.send(word)
                    await upstream.send("__END__")

                    # Relay audio frames
                    async for msg in upstream:
                        if isinstance(msg, bytes):
                            await ws.send_bytes(msg)
                await ws.send_json({"type": "done"})
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("TTS relay error")
                try:
                    await ws.send_json(
                        {"type": "error", "message": "TTS synthesis failed"}
                    )
                except Exception:
                    pass

        try:
            while True:
                data = await ws.receive_json()

                # Handle cancel
                if data.get("type") == "cancel":
                    if relay_task and not relay_task.done():
                        relay_task.cancel()
                        try:
                            await relay_task
                        except (asyncio.CancelledError, Exception):
                            pass
                    continue

                text = data.get("text", "").strip()
                if not text:
                    continue

                # Cancel any in-flight synthesis before starting new one
                if relay_task and not relay_task.done():
                    relay_task.cancel()
                    try:
                        await relay_task
                    except (asyncio.CancelledError, Exception):
                        pass

                text = cleaner.normalize(text)
                relay_task = asyncio.create_task(_relay(text))
        except WebSocketDisconnect:
            pass
        except Exception:
            logger.exception("TTS WebSocket error")
        finally:
            if relay_task and not relay_task.done():
                relay_task.cancel()
                try:
                    await relay_task
                except (asyncio.CancelledError, Exception):
                    pass

    return router


def create_voice_app(
    *,
    tools: list[Tool | str] | None = None,
    agent_manager: VoiceAgentManager | None = None,
    cors_origins: list[str] | None = None,  # None = use defaults
    static_dir: str | None = "static",
    session_secret: str | None = None,
    api_prefix: str = "/api",
) -> FastAPI:
    """Create a fully configured FastAPI application for a voice agent.

    This is a higher-level alternative to :func:`create_voice_router` that
    handles CORS, the voice-agent router, and optional static file serving.

    Args:
        tools: List of tools (instances or string names like
            ``"DuckDuckGoSearchTool"``). A :class:`VoiceAgentManager` is
            created automatically. Ignored if ``agent_manager`` is provided.
        agent_manager: A :class:`VoiceAgentManager` that owns per-session
            agents. If not provided, one is created from ``tools``.
        cors_origins: Allowed CORS origins. Defaults to
            ``["http://localhost:5173", "http://localhost:3000"]``.
            Pass an empty list to disable CORS.
        static_dir: Path to a directory of static files to serve at ``/``.
            Defaults to ``"static"``. Pass ``None`` to disable.
        session_secret: Secret key for signing session cookies.
            Auto-generated if not provided.
        api_prefix: URL prefix for the voice-agent endpoints.
            Defaults to ``"/api"``.

    Returns:
        A ready-to-run :class:`~fastapi.FastAPI` application.

    Example::

        from aai_agent import tool
        from aai_agent.fastapi import create_voice_app

        @tool
        def get_weather(city: str) -> str:
            \"\"\"Get the current weather for a city.

            Args:
                city: The city to get weather for.
            \"\"\"
            return f"72°F and sunny in {city}."

        app = create_voice_app(tools=[get_weather])
    """
    if agent_manager is None:
        agent_manager = VoiceAgentManager(tools=tools)

    app = FastAPI()

    if cors_origins is not None:
        origins = cors_origins
    elif static_dir:
        # Same-origin: static files served from same app, no CORS needed.
        # Auto-detect Fly.io / Railway production URLs as extras.
        origins: list[str] = []
        fly_app = os.environ.get("FLY_APP_NAME")
        if fly_app:
            origins.append(f"https://{fly_app}.fly.dev")
    else:
        origins = list(DEFAULT_CORS_ORIGINS)
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    @app.get("/health")
    async def health():
        return {"status": "ok"}

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
