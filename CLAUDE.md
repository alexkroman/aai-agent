# CLAUDE.md — Instructions for AI assistants working on this codebase

## Quick Reference

```bash
cd platform
npm run check      # typecheck + lint + format + test (run this before committing)
npm test           # vitest in watch mode
npm run typecheck  # tsc --noEmit
npm run lint       # eslint src/
npm run format     # prettier --check src/
npm run format:fix # prettier --write src/
npm run dev        # tsx watch src/index.ts (local dev server)
npm run build      # tsc + esbuild client bundles → dist/
```

## Architecture

```
platform/
├── src/              # Server-side (Node.js, TypeScript)
│   ├── index.ts      # Entry point — reads env vars, calls startServer()
│   ├── config.ts     # Centralized configuration and env var loading
│   ├── constants.ts  # Message types, timeouts, paths, sample rates
│   ├── errors.ts     # Error message constants
│   ├── server.ts     # HTTP server + WebSocket endpoint
│   ├── session.ts    # VoiceSession: orchestrates STT → LLM → TTS per connection
│   ├── llm.ts        # LLM client (AssemblyAI gateway, OpenAI-compatible)
│   ├── stt.ts        # STT client (AssemblyAI Streaming v3 WebSocket)
│   ├── tts.ts        # TTS client (Baseten Orpheus WebSocket, connection pre-warming)
│   ├── sandbox.ts    # V8 isolate sandbox for customer tool handlers
│   ├── protocol.ts   # Simplified parameter format → JSON Schema conversion
│   ├── voice-cleaner.ts  # Text normalization for TTS (markdown, numbers, units)
│   ├── secrets.ts    # Per-customer secret store (JSON file on disk)
│   ├── types.ts      # All shared TypeScript interfaces, Zod schemas, defaults
│   └── __tests__/    # Vitest tests (one file per module)
├── client/           # Browser-side (bundled by esbuild, NOT typechecked by tsc)
│   ├── core.ts       # WebSocket protocol, audio capture/playback via AudioWorklet
│   ├── client.ts     # Vanilla JS entry: VoiceAgent.start() with default UI
│   └── react.ts      # React hook: useVoiceAgent()
├── scripts/
│   └── build-client.js  # esbuild bundler for client/ → dist/client.js, dist/react.js
└── tsconfig.json     # Covers src/ only; client/ is excluded (browser APIs)
```

## Module Dependencies (data flow)

```
index.ts → config.ts → server.ts → session.ts → llm.ts
                                                → stt.ts
                                                → tts.ts
                                                → sandbox.ts
                                                → protocol.ts
                                                → voice-cleaner.ts
                                    secrets.ts ←┘
```

All modules import from `types.ts` and `constants.ts` for shared types and constants.

## Key Patterns

### WebSocket Protocol
Messages between server and browser use JSON with a `type` field. All message type
strings are defined in `constants.ts` as `MSG` constants. Binary frames are raw PCM16 audio.

### Tool Execution
Customer tool handlers run in V8 isolates (isolated-vm). Each `execute()` creates a
fresh context. Tools receive `(args, ctx)` where `ctx.secrets` and `ctx.fetch` are injected.
Tool calls from the LLM are executed in parallel via `Promise.all`.

### TTS Connection Pre-warming
Baseten Orpheus is one-shot: connect → config → words → `__END__` → audio → server closes.
`TtsClient` pre-warms the next WebSocket while the current one streams. Don't try to
reuse connections — the server closes them after each synthesis.

### Audio
- Mic capture: AudioWorklet → PCM16 Int16Array → WebSocket binary frames
- TTS playback: WebSocket binary frames → AudioWorklet with internal ring buffer
- STT sample rate: 16000 Hz | TTS sample rate: 24000 Hz

### Testing
- Server-side tests use vitest with `vi.mock()` for external dependencies
- Client code (`client/`) has dedicated tests in `src/__tests__/client-*.test.ts`
- Run `npm run check` before committing — it runs typecheck, lint, format, AND tests

### Configuration
- All environment variables are loaded in `config.ts`
- Runtime defaults are in `types.ts` (DEFAULT_STT_CONFIG, DEFAULT_TTS_CONFIG, etc.)
- Magic numbers and strings are in `constants.ts`

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `CLIENT_DIR` | — | Directory with built client.js/react.js |
| `SECRETS_FILE` | — | Path to per-customer secrets JSON |
| `ASSEMBLYAI_API_KEY` | — | AssemblyAI API key (STT + LLM gateway) |
| `ASSEMBLYAI_TTS_API_KEY` | — | Baseten API key (Orpheus TTS) |
| `ASSEMBLYAI_TTS_WSS_URL` | (Baseten prod) | Custom TTS WebSocket URL |
| `LLM_MODEL` | `claude-haiku-4-5-20251001` | LLM model name |
