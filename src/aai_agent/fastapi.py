"""Pre-built FastAPI router and app factory for voice agent endpoints."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import secrets
from contextlib import asynccontextmanager
from urllib.parse import urlencode

import websockets
from fastapi import APIRouter, FastAPI, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.websockets import WebSocketDisconnect, WebSocketState

from .manager import VoiceAgentManager
from .voice_cleaner import VoiceCleaner

logger = logging.getLogger(__name__)

DEFAULT_CORS_ORIGINS: tuple[str, ...] = (
    "http://localhost:5173",
    "http://localhost:3000",
)

DEFAULT_TTS_WSS_URL = (
    "wss://model-q844y7pw.api.baseten.co/environments/production/websocket"
)


async def _cancel_task(task: asyncio.Task | None) -> None:
    """Cancel a task and suppress exceptions."""
    if task and not task.done():
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass


def create_voice_router(
    *,
    agent_manager: VoiceAgentManager,
) -> APIRouter:
    """Create a FastAPI router with a single ``/session`` WebSocket endpoint.

    The browser opens one WebSocket and the server proxies everything:
    STT (AssemblyAI), LLM (via agent.chat), and TTS (Orpheus).

    Args:
        agent_manager: A :class:`VoiceAgentManager` that owns per-session agents.

    Returns:
        A :class:`~fastapi.APIRouter` ready to include with
        ``app.include_router()``.
    """
    router = APIRouter()

    # ── TTS config (resolved once at startup) ─────────────────────────
    _tts_api_key = os.environ.get("ASSEMBLYAI_TTS_API_KEY", "")
    _tts_wss_url = os.environ.get("ASSEMBLYAI_TTS_WSS_URL", DEFAULT_TTS_WSS_URL)
    _tts_headers = {"Authorization": f"Api-Key {_tts_api_key}"}
    _tts_voice = os.environ.get("ASSEMBLYAI_TTS_VOICE", "jess")
    _tts_config_json = json.dumps(
        {
            "voice": _tts_voice,
            "max_tokens": 2000,
            "buffer_size": 30,
            "repetition_penalty": 1.3,
            "temperature": 0.6,
            "top_p": 0.9,
        }
    )
    _tts_sample_rate = 24000
    _cleaner = VoiceCleaner()

    async def _send_json(ws: WebSocket, data: dict) -> None:
        """Send JSON to client, ignoring errors if WS is closing."""
        try:
            if ws.client_state == WebSocketState.CONNECTED:
                await ws.send_json(data)
        except Exception:
            pass

    async def _send_bytes(ws: WebSocket, data: bytes) -> None:
        """Send bytes to client, ignoring errors if WS is closing."""
        try:
            if ws.client_state == WebSocketState.CONNECTED:
                await ws.send_bytes(data)
        except Exception:
            pass

    @router.websocket("/session")
    async def session_ws(ws: WebSocket):
        """Single multiplexed WebSocket for a voice session.

        Client sends:
          - binary: PCM16 LE mic audio (relayed to AssemblyAI)
          - JSON ``{type: "cancel"}``: barge-in
          - JSON ``{type: "reset"}``: reset session

        Server sends:
          - binary: PCM16 LE TTS audio
          - JSON messages for UI updates (ready, transcript, turn,
            thinking, chat, greeting, tts_done, error, cancelled, reset)
        """
        await ws.accept()

        sid = secrets.token_hex(16)
        agent = await agent_manager.get_or_create(sid)
        stt = agent.stt
        cfg = stt.config

        logger.info("Session %s connected", sid[:8])

        # ── Connect to AssemblyAI STT ─────────────────────────────────
        stt_ws = None
        # Lock protects chat_task/tts_task which are accessed from
        # concurrent coroutines (STT listener, client command loop).
        task_lock = asyncio.Lock()
        chat_task: asyncio.Task | None = None
        tts_task: asyncio.Task | None = None
        stt_listener_task: asyncio.Task | None = None

        try:
            token = await stt.create_token()
            params = urlencode(
                {
                    "sample_rate": cfg.sample_rate,
                    "speech_model": cfg.speech_model,
                    "token": token,
                    "format_turns": str(cfg.format_turns).lower(),
                    "min_end_of_turn_silence_when_confident": cfg.min_end_of_turn_silence_when_confident,
                    "max_turn_silence": cfg.max_turn_silence,
                }
            )
            stt_ws = await websockets.connect(
                f"{cfg.wss_base}?{params}",
                max_size=None,
                open_timeout=10,
            )
        except Exception:
            logger.exception("Failed to connect to AssemblyAI STT")
            await _send_json(
                ws,
                {"type": "error", "message": "Failed to connect to speech recognition"},
            )
            await ws.close()
            return

        # ── Send ready ────────────────────────────────────────────────
        await _send_json(
            ws,
            {
                "type": "ready",
                "sample_rate": cfg.sample_rate,
                "tts_sample_rate": _tts_sample_rate,
            },
        )

        # ── TTS relay ─────────────────────────────────────────────────
        async def _tts_relay(text: str) -> None:
            """Synthesize text via Orpheus TTS, relay PCM to client."""
            try:
                cleaned = _cleaner.normalize(text)
                logger.info("TTS [%s] connecting", sid[:8])
                async with websockets.connect(
                    _tts_wss_url,
                    additional_headers=_tts_headers,
                    max_size=None,
                    open_timeout=10,
                ) as upstream:
                    await upstream.send(_tts_config_json)
                    for word in cleaned.split():
                        await upstream.send(word)
                    await upstream.send("__END__")
                    logger.info("TTS [%s] sent text, waiting for audio", sid[:8])

                    chunk_count = 0
                    async for msg in upstream:
                        if isinstance(msg, bytes):
                            chunk_count += 1
                            await _send_bytes(ws, msg)

                    logger.info("TTS [%s] done, %d chunks", sid[:8], chunk_count)
                await _send_json(ws, {"type": "tts_done"})
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("TTS relay error [%s]", sid[:8])
                await _send_json(
                    ws, {"type": "error", "message": "TTS synthesis failed"}
                )

        # ── Cancel in-flight work ─────────────────────────────────────
        async def _cancel_inflight() -> None:
            """Snapshot and clear task refs under lock, then cancel."""
            nonlocal chat_task, tts_task
            async with task_lock:
                ct, tt = chat_task, tts_task
                chat_task = None
                tts_task = None
            await asyncio.gather(
                _cancel_task(ct),
                _cancel_task(tt),
                agent.cancel(),
            )

        # ── Handle a completed turn ───────────────────────────────────
        async def _handle_turn(text: str) -> None:
            """Run LLM chat and start TTS. Called as a Task from _stt_listener.

            The caller is responsible for cancelling previous inflight work
            BEFORE creating this task. This function must NOT call
            _cancel_inflight() — doing so would cancel itself.
            """
            nonlocal tts_task

            await _send_json(ws, {"type": "turn", "text": text})
            await _send_json(ws, {"type": "thinking"})

            try:
                result = await agent.chat(text)

                await _send_json(
                    ws,
                    {
                        "type": "chat",
                        "text": result.text,
                        "steps": result.steps,
                    },
                )

                # Start TTS
                if _tts_api_key and result.text:
                    task = asyncio.create_task(
                        _tts_relay(result.text), name=f"tts-{sid[:8]}"
                    )
                    async with task_lock:
                        tts_task = task
                else:
                    await _send_json(ws, {"type": "tts_done"})

            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Chat failed for session %s", sid[:8])
                await _send_json(ws, {"type": "error", "message": "Chat failed"})

        # ── STT listener ──────────────────────────────────────────────
        async def _stt_listener() -> None:
            nonlocal chat_task
            try:
                async for raw_msg in stt_ws:
                    if isinstance(raw_msg, bytes):
                        continue
                    try:
                        msg = json.loads(raw_msg)
                    except json.JSONDecodeError:
                        continue

                    msg_type = msg.get("type")

                    if msg_type == "Transcript":
                        text = msg.get("transcript", "")
                        is_final = msg.get("is_final", False)
                        await _send_json(
                            ws,
                            {
                                "type": "transcript",
                                "text": text,
                                "final": is_final,
                            },
                        )

                    elif msg_type == "Turn":
                        text = (msg.get("transcript") or "").strip()
                        if not text:
                            continue

                        # Partial turn (not formatted yet) — send transcript
                        if not msg.get("turn_is_formatted"):
                            await _send_json(
                                ws,
                                {
                                    "type": "transcript",
                                    "text": text,
                                    "final": False,
                                },
                            )
                            continue

                        # Final formatted turn — cancel inflight, then start new chat
                        await _cancel_inflight()
                        task = asyncio.create_task(
                            _handle_turn(text), name=f"chat-{sid[:8]}"
                        )
                        async with task_lock:
                            chat_task = task

            except websockets.exceptions.ConnectionClosed:
                logger.info("STT WebSocket closed for session %s", sid[:8])
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("STT listener error for session %s", sid[:8])

        # ── Start STT listener ────────────────────────────────────────
        stt_listener_task = asyncio.create_task(_stt_listener(), name=f"stt-{sid[:8]}")

        # ── Send greeting ────────────────────────────────────────────
        greeting = agent.greeting
        if greeting:
            await _send_json(ws, {"type": "greeting", "text": greeting})
            if _tts_api_key:
                tts_task = asyncio.create_task(
                    _tts_relay(greeting), name=f"tts-greeting-{sid[:8]}"
                )

        # ── Main client loop ──────────────────────────────────────────
        try:
            while True:
                msg = await ws.receive()

                if msg.get("type") == "websocket.disconnect":
                    break

                if "bytes" in msg and msg["bytes"]:
                    # Binary frame: mic audio → relay to STT
                    try:
                        if stt_ws:
                            await stt_ws.send(msg["bytes"])
                    except Exception:
                        pass

                elif "text" in msg and msg["text"]:
                    # JSON frame: control message
                    try:
                        data = json.loads(msg["text"])
                    except json.JSONDecodeError:
                        continue

                    cmd = data.get("type")

                    if cmd == "cancel":
                        await _cancel_inflight()
                        # Send clear to AssemblyAI
                        try:
                            if stt_ws:
                                await stt_ws.send(json.dumps({"operation": "clear"}))
                        except Exception:
                            pass
                        await _send_json(ws, {"type": "cancelled"})

                    elif cmd == "reset":
                        await _cancel_inflight()
                        await agent.reset()
                        await _send_json(ws, {"type": "reset"})

        except WebSocketDisconnect:
            pass
        except Exception:
            logger.exception("Session %s error", sid[:8])
        finally:
            logger.info("Session %s disconnecting", sid[:8])
            async with task_lock:
                ct, tt = chat_task, tts_task
                chat_task = None
                tts_task = None
            await asyncio.gather(
                _cancel_task(stt_listener_task),
                _cancel_task(ct),
                _cancel_task(tt),
            )
            if stt_ws:
                try:
                    await stt_ws.close()
                except Exception:
                    pass
            await agent_manager.remove(sid)

    return router


def create_voice_app(
    *,
    tools: list | None = None,
    agent_manager: VoiceAgentManager | None = None,
    cors_origins: list[str] | None = None,
    static_dir: str | None = "static",
    api_prefix: str = "/api",
) -> FastAPI:
    """Create a fully configured FastAPI application for a voice agent.

    Args:
        tools: List of tool callables or ``pydantic_ai.Tool`` instances.
            A :class:`VoiceAgentManager` is created automatically.
            Ignored if ``agent_manager`` is provided.
        agent_manager: A :class:`VoiceAgentManager` that owns per-session
            agents. If not provided, one is created from ``tools``.
        cors_origins: Allowed CORS origins. Defaults to
            ``["http://localhost:5173", "http://localhost:3000"]``.
            Pass an empty list to disable CORS.
        static_dir: Path to a directory of static files to serve at ``/``.
            Defaults to ``"static"``. Pass ``None`` to disable.
        api_prefix: URL prefix for the voice-agent endpoints.
            Defaults to ``"/api"``.

    Returns:
        A ready-to-run :class:`~fastapi.FastAPI` application.
    """
    # Configure logging so SDK logs are visible in the terminal.
    # This runs in the worker process (important for uvicorn --reload).
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s:     %(name)s - %(message)s",
        force=True,
    )

    if agent_manager is None:
        agent_manager = VoiceAgentManager(tools=tools)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        logger.info("Shutting down — closing all agent sessions")
        await agent_manager.aclose_all()

    app = FastAPI(lifespan=lifespan)

    if cors_origins is not None:
        origins = cors_origins
    elif static_dir:
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
        create_voice_router(agent_manager=agent_manager),
        prefix=api_prefix,
    )

    if static_dir:

        @app.middleware("http")
        async def no_cache_static(request: Request, call_next):
            response = await call_next(request)
            if not request.url.path.startswith(api_prefix):
                response.headers["Cache-Control"] = "no-cache"
            return response

        app.mount("/", StaticFiles(directory=static_dir, html=True), name="frontend")

    return app
