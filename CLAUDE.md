# CLAUDE.md — Project reference for AI assistants

## Quick reference

```bash
cd platform
npm run check     # typecheck + lint + format + test (run before every commit)
npm run dev       # start with hot reload
npm run build     # compile server (tsc) + bundle client (esbuild)
npm test -- run   # tests only
```

## Architecture

```
Browser (client/)              Platform (src/)
┌──────────────────┐          ┌─────────────────────┐
│ core.ts          │◀─ WS ──▶│ server.ts            │
│  VoiceSession    │          │  ├─ session.ts       │
│  AudioPlayer     │          │  │   ├─ stt.ts  (AssemblyAI STT)
│  MicCapture      │          │  │   ├─ llm.ts  (LLM Gateway)
│                  │          │  │   ├─ tts.ts  (Orpheus TTS)
│ client.ts        │          │  │   └─ sandbox.ts (V8 isolate)
│  VoiceAgent.start│          │  └─ protocol.ts
│                  │          │
│ react.ts         │          │ types.ts, constants.ts,
│  useVoiceAgent   │          │ errors.ts, config.ts
└──────────────────┘          └─────────────────────┘
```

## Key patterns

### WebSocket protocol (browser ↔ server)
- Browser sends: `configure` (first), then `cancel` | `reset` | binary audio
- Server sends: `ready`, `greeting`, `transcript`, `turn`, `thinking`, `chat`, `tts_done`, `cancelled`, `reset`, `error`
- Binary frames from server = PCM16 TTS audio

### Tool execution
1. Browser serializes handler functions to strings via `serializeTools()`
2. Server receives tools in `configure` message
3. `sandbox.ts` runs handlers in V8 isolate with `ctx.secrets` + `ctx.fetch`
4. 30s timeout, 128MB memory limit per session

### TTS (Orpheus via Baseten)
- One-shot WebSocket: connect → config JSON → words → `__END__` → receive audio → server closes
- Pre-warming not possible (server closes after each synthesis)

### Audio
- Mic capture: AudioWorklet (PCM16Processor) → WebSocket binary frames
- TTS playback: AudioBufferSourceNode queue with scheduled start times

### Testing
- Vitest, all tests in `src/__tests__/`
- Server-side modules mock `fetch` and `ws` via `vi.mock()`
- Client tests mock browser APIs via `vi.stubGlobal()`

### Configuration
- All env vars loaded in `config.ts` via `loadPlatformConfig()`
- Message type strings centralized in `constants.ts` (use `MSG.*`)
- Error strings centralized in `errors.ts` (use `ERR.*`, `ERR_INTERNAL.*`)

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `ASSEMBLYAI_API_KEY` | Yes | AssemblyAI API key for STT |
| `ASSEMBLYAI_TTS_API_KEY` | Yes | TTS API key (Orpheus via Baseten) |
| `ASSEMBLYAI_TTS_WSS_URL` | No | Custom TTS WebSocket URL |
| `LLM_MODEL` | No | LLM model (default: `claude-haiku-4-5-20251001`) |
| `SECRETS_FILE` | No | Path to per-customer secrets JSON |
| `PORT` | No | Server port (default: `3001`) |
| `CLIENT_DIR` | No | Path to built client bundles |

## File conventions

- All source uses `.js` extensions in imports (Node16 module resolution)
- Server code in `platform/src/`, client code in `platform/client/`
- Client files are bundled by `scripts/build-client.js` (esbuild)
- Tests co-located in `src/__tests__/`, named `*.test.ts`
