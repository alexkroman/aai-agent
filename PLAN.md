# Refactoring Plan: Separate Platform Infrastructure from Customer Code

## Goal
Restructure `fastapi.py` so the WebSocket server, STT/TTS relay, and session
management are platform-owned infrastructure, while customers only provide
agent configuration (tools, instructions, greeting, model, TTS/STT preferences).

Today, `create_voice_app()` bundles everything into one monolith. If a platform
team owned the server, customers would lose control of TTS settings (hardcoded),
session lifecycle, and the streaming protocol. This refactor extracts those
concerns into configurable, injectable pieces.

---

## Steps

### 1. Add `TTSConfig` to `types.py`
Create a `TTSConfig` Pydantic model (like the existing `STTConfig`) to capture
all TTS settings currently hardcoded in `fastapi.py` lines 58-72:

```python
class TTSConfig(BaseModel):
    model_config = ConfigDict(frozen=True)
    voice: str = "jess"
    max_tokens: int = 2000
    buffer_size: int = 105
    repetition_penalty: float = 1.2
    temperature: float = 0.6
    top_p: float = 0.9
    sample_rate: int = 24000
    wss_url: str = DEFAULT_TTS_WSS_URL
```

### 2. Thread `TTSConfig` through `VoiceAgent` and `VoiceAgentManager`
- Add `tts_config: TTSConfig | None = None` parameter to `VoiceAgent.__init__()`
  and store it as `self.tts_config` (defaulting to `TTSConfig()`).
- Add `tts_config` to `VoiceAgentManager.__init__()` and pass it through to
  `VoiceAgent` in `get_or_create()`.

### 3. Extract `VoiceSessionHandler` class from the `session_ws()` closure
Create a new file `src/aai_agent/session.py` containing a `VoiceSessionHandler`
class that encapsulates the 287-line `session_ws()` monolith. The class will:

- Accept injected dependencies: `agent_manager`, `tts_api_key`, `VoiceCleaner`
- Read TTS config from the agent's `tts_config` attribute (per-session)
- Break the monolith into clear methods:
  - `handle(ws)` — main entry point
  - `_connect_stt(agent)` — establish STT WebSocket
  - `_tts_relay(ws, text, tts_config)` — synthesize + relay audio
  - `_cancel_inflight()` — snapshot and cancel tasks
  - `_handle_turn(ws, agent, text)` — LLM chat + start TTS
  - `_stt_listener(ws, stt_ws)` — listen to STT, dispatch turns
  - `_client_loop(ws, stt_ws)` — relay mic audio + handle commands

### 4. Add optional lifecycle hooks to `VoiceAgentManager`
Add optional callback parameters:
```python
on_session_created: Callable[[str, VoiceAgent], Awaitable[None]] | None = None
on_session_destroyed: Callable[[str], Awaitable[None]] | None = None
```
Invoke them in `get_or_create()` (when a new agent is created) and `remove()`.

### 5. Simplify `fastapi.py` — thin wrapper over `VoiceSessionHandler`
- Remove all TTS config hardcoding (read from `agent.tts_config` instead)
- Replace the `session_ws()` closure with instantiation of `VoiceSessionHandler`
- `create_voice_router()` becomes a thin ~30-line function
- Keep `create_voice_app()` as the convenience factory (unchanged API)

### 6. Update `__init__.py` exports
Export `TTSConfig` and `VoiceSessionHandler` so platform teams can use them.

### 7. Verify `_template/server.py` still works unchanged
The customer-facing template should not need any modifications — all new config
is optional with sensible defaults.

---

## Files Changed

| File | Change |
|------|--------|
| `src/aai_agent/types.py` | Add `TTSConfig` |
| `src/aai_agent/agent.py` | Add `tts_config` parameter |
| `src/aai_agent/manager.py` | Add `tts_config` + lifecycle hooks |
| `src/aai_agent/session.py` | **NEW** — `VoiceSessionHandler` class |
| `src/aai_agent/fastapi.py` | Thin wrapper delegating to `VoiceSessionHandler` |
| `src/aai_agent/__init__.py` | Export `TTSConfig`, `VoiceSessionHandler` |
| `src/aai_agent/_template/server.py` | No changes needed |

## What This Enables

After this refactoring, a **platform team** can own the server:
```python
# Platform-owned code
from aai_agent import VoiceSessionHandler, VoiceAgentManager

handler = VoiceSessionHandler(agent_manager=manager)
# Mount their own FastAPI app with custom auth, metrics, middleware
```

While a **customer** just provides config:
```python
# Customer code
from aai_agent import VoiceAgentManager, TTSConfig

manager = VoiceAgentManager(
    tools=[my_tool],
    instructions="You are...",
    tts_config=TTSConfig(voice="aria", temperature=0.8),
)
# Hand manager to platform
```
