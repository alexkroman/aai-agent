# Plan: Rewrite as TypeScript Platform with WebSocket Event Protocol

## Goal

Replace the entire Python codebase with a TypeScript platform server. Customers
write raw TypeScript — no SDK. The architecture uses two WebSocket connections,
both terminating at the platform:

```
┌──────────────┐         WS 1          ┌──────────────┐         WS 2          ┌──────────────┐
│   Customer   │◄──────────────────────►│   Platform   │◄──────────────────────►│   Customer   │
│   Frontend   │  audio + UI events     │   Server     │  config + tool events  │   Backend    │
│  (browser)   │                        │  (Node.js)   │                        │  (Node.js)   │
└──────────────┘                        └──────────────┘                        └──────────────┘
```

- **WS 1**: Customer frontend ↔ Platform (direct). Audio (PCM16 binary frames)
  and UI events (transcript, thinking, chat, tts_done, greeting, error).
  Frontend connects directly to the platform using a `frontendUrl` returned
  by the `configured` response.
- **WS 2**: Customer backend ↔ Platform. Configuration, tool calls, tool
  results, and session lifecycle events.

**Key simplification**: The customer backend does NOT relay frontend traffic.
The frontend connects directly to the platform. This eliminates the backend
WebSocket server, the relay code, and the `lib/voice-agent.ts` boilerplate.
The customer backend is a single ~45-line file.

The customer frontend is purely UI + audio capture/playback. The customer backend
configures the agent and handles tool execution. The platform owns everything in
between: STT, LLM orchestration, TTS, session management.

---

## Architecture

### Connection Flow

```
1. Customer backend connects to platform via WS 2
2. Customer backend sends "configure" message with instructions, tools, voice
3. Platform acknowledges with "configured" + frontendUrl
4. Customer backend logs frontendUrl (or passes it to frontend via any channel)
5. Customer frontend connects directly to platform via WS 1 (using frontendUrl)
6. Platform connects to STT provider, sends "ready" to frontend
7. Platform sends greeting to frontend (text + TTS audio)

Voice loop:
8.  Frontend sends mic audio (binary) → Platform relays to STT
9.  STT returns transcript → Platform sends to frontend
10. STT returns final turn → Platform sends to LLM
11. LLM requests tool call → Platform sends tool_call to backend (WS 2)
12. Backend executes tool, sends tool_result → Platform feeds to LLM
13. LLM produces response → Platform sends chat to frontend + starts TTS
14. TTS audio streams to frontend (binary)
```

### WebSocket 1: Platform ↔ Customer Frontend

The frontend only handles audio and display. No business logic.

**Frontend sends:**
```typescript
// Binary frames: PCM16 LE mic audio

// JSON control messages:
{ type: "cancel" }     // barge-in
{ type: "reset" }      // reset conversation
```

**Platform sends to frontend:**
```typescript
// Binary frames: PCM16 LE TTS audio

{ type: "ready", sampleRate: 16000, ttsSampleRate: 24000 }
{ type: "greeting", text: "Hey there!" }
{ type: "transcript", text: "partial text", final: false }
{ type: "turn", text: "final user text" }
{ type: "thinking" }
{ type: "chat", text: "response text", steps: ["Using get_weather"] }
{ type: "tts_done" }
{ type: "cancelled" }
{ type: "reset" }
{ type: "error", message: "something went wrong" }
```

### WebSocket 2: Platform ↔ Customer Backend

The backend configures the agent and handles tool execution.

**Backend sends:**
```typescript
// Initial configuration (required, sent once after connecting):
{
  type: "configure",
  instructions: "You are a helpful weather assistant.",
  greeting: "Hey! Ask me about the weather.",
  voice: "jess",
  model: "claude-haiku-4-5-20251001",                  // optional, has default
  voiceRules: "Keep responses to 1-2 sentences...",     // optional, has default
  sttConfig: { ... },                                   // optional, has defaults
  ttsConfig: { ... },                                   // optional, has defaults
  tools: [
    {
      name: "get_weather",
      description: "Get current weather for a city",
      parameters: { city: "string" }                    // simplified format
    }
  ]
}

// Tool results (sent in response to tool_call):
{
  type: "tool_result",
  callId: "abc123",
  result: "72°F and sunny in San Francisco"
}
```

**Platform sends to backend:**
```typescript
{ type: "configured", sessionId: "abc...", frontendUrl: "wss://platform.example.com/session/abc...?token=xyz" }
{ type: "session_started" }
{ type: "tool_call", callId: "abc123", name: "get_weather", args: { city: "SF" } }
{ type: "session_ended", reason: "disconnect" }
{ type: "error", message: "LLM call failed" }
```

---

## Platform Server (TypeScript/Node.js)

### Directory Structure

```
platform/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Entry point, starts WS server
│   ├── server.ts             # WebSocket server setup (ws library)
│   ├── session.ts            # VoiceSession class — orchestrates one conversation
│   ├── stt.ts                # STT client (AssemblyAI WebSocket + token creation)
│   ├── tts.ts                # TTS client (Orpheus WebSocket relay)
│   ├── llm.ts                # LLM client (AssemblyAI LLM Gateway, OpenAI-compat)
│   ├── voice-cleaner.ts      # Text normalization for TTS
│   ├── types.ts              # All TypeScript interfaces and message types
│   └── protocol.ts           # Message parsing, validation (zod schemas)
```

### Key Dependencies

```json
{
  "dependencies": {
    "ws": "^8.0.0",
    "zod": "^3.0.0",
    "undici": "^7.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/ws": "^8.0.0",
    "vitest": "^3.0.0"
  }
}
```

- **`ws`** — WebSocket server and client. Handles both frontend connections
  (WS 1) and outbound STT/TTS connections.
- **`zod`** — Runtime validation of all incoming messages (configure, tool_result)
  and config schemas.
- **`undici`** — HTTP client for LLM Gateway calls and STT token creation.
  Built into Node.js 18+.
- No framework (no Express, no Fastify). Just `ws` + `http.createServer` for
  the health endpoint.

### Core Class: `VoiceSession`

Each conversation is a `VoiceSession` instance that manages:

```typescript
class VoiceSession {
  private config: AgentConfig;        // from customer's "configure" message
  private frontendWs: WebSocket;      // WS 1
  private backendWs: WebSocket;       // WS 2
  private sttWs: WebSocket | null;    // outbound to AssemblyAI
  private chatAbort: AbortController | null;
  private ttsAbort: AbortController | null;

  // Lifecycle
  async start(): Promise<void>;       // connect STT, send ready + greeting
  async stop(): Promise<void>;        // cleanup all connections

  // Frontend message handlers
  private onFrontendAudio(data: Buffer): void;   // relay to STT
  private onFrontendCancel(): Promise<void>;      // barge-in
  private onFrontendReset(): Promise<void>;       // reset conversation

  // STT event handlers
  private onTranscript(text: string, isFinal: boolean): void;
  private onTurn(text: string): Promise<void>;    // trigger LLM

  // LLM + tool orchestration
  private handleTurn(text: string): Promise<void>;
  private callLLM(messages: Message[]): Promise<LLMResponse>;
  private executeTool(name: string, args: object): Promise<string>;  // sends tool_call to backend WS, awaits tool_result
  private relayTTS(text: string): Promise<void>;

  // Voice cleaning
  private normalizeForTTS(text: string): string;
}
```

### Tool Call Flow (Detail)

When the LLM returns a tool call, the platform sends it to the customer
backend over WS 2 and awaits the result:

```typescript
private async executeTool(name: string, args: object): Promise<string> {
  const callId = crypto.randomUUID();

  // Send tool_call to customer backend
  this.backendWs.send(JSON.stringify({
    type: "tool_call",
    callId,
    name,
    args,
  }));

  // Wait for matching tool_result (with timeout)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Tool timeout")), 30000);
    this.pendingToolCalls.set(callId, (result: string) => {
      clearTimeout(timeout);
      resolve(result);
    });
  });
}
```

### LLM Integration

Call the AssemblyAI LLM Gateway (OpenAI-compatible) directly via HTTP.
No SDK needed — just `fetch` or `undici`:

```typescript
async function callLLM(
  messages: Message[],
  tools: ToolSchema[],
  config: LLMConfig
): Promise<LLMResponse> {
  const resp = await fetch(`${LLM_GATEWAY_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      tools: tools.map(t => ({ type: "function", function: t })),
    }),
  });
  return patchResponse(await resp.json()); // normalize gateway quirks
}
```

The `patchResponse` function handles the same LLM Gateway normalization that
`_PatchTransport` does in the current Python code (fixing finish_reason,
filling null id/model/usage fields).

---

## Customer Code (TypeScript, No AssemblyAI SDK)

Customers use whatever npm packages they want. We don't publish or maintain
an SDK. There is no boilerplate relay layer. **Claude Code only ever needs to
edit two files: `agent.ts` (backend: config + tools) and `App.tsx` (frontend: UI).**

### Key simplification

The customer backend does NOT act as a relay. The frontend connects directly
to the platform using the `frontendUrl` from the `configured` response. This
means:

- No `WebSocketServer` in customer code
- No `lib/voice-agent.ts` boilerplate
- No `server.ts` entry point
- No relay logic, no message filtering
- The backend is a single file: `agent.ts` (~45 lines)

### Project structure

```
customer-backend/
├── agent.ts               ← CLAUDE CODE EDITS THIS: config + tools (~45 lines)
├── package.json
├── tsconfig.json
└── CLAUDE.md

customer-frontend/
├── App.tsx                ← CLAUDE CODE EDITS THIS: UI components
├── hooks/
│   └── useVoiceAgent.ts   ← Hook: WS state machine + message handling
├── lib/
│   └── audio.ts           ← PCM capture via AudioWorklet, playback buffer
├── package.json
└── tsconfig.json
```

### CLAUDE.md (guides Claude Code)

```markdown
# Voice Agent

## Adding a tool
Edit `agent.ts` and add an entry to the `tools` object. Each tool has:
- `description`: what the tool does (the LLM sees this)
- `parameters`: zod schema for the arguments
- `handler`: async function that returns a string

## Changing the agent's behavior
Edit the config in `agent.ts`: instructions, greeting, voice.

## Changing the UI
Edit `App.tsx`. The `useVoiceAgent` hook provides: state, messages,
transcript, cancel(), reset().
```

### Backend dependencies

```json
{
  "dependencies": {
    "ws": "^8.0.0",
    "zod": "^3.0.0",
    "zod-to-json-schema": "^3.0.0"
  }
}
```

---

### `agent.ts` — the entire customer backend (single file)

This is the only backend file. No entry point, no boilerplate, no relay.
Claude Code edits the `tools` object and config. The rest is ~15 lines of
WebSocket plumbing that never changes.

```typescript
// agent.ts — the entire customer backend
import { WebSocket } from "ws";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// ── Tools ───────────────────────────────────────────────────────────

const tools = {
  get_weather: {
    description: "Get current weather for a city",
    parameters: z.object({
      city: z.string().describe("City name"),
    }),
    handler: async (args: { city: string }) => {
      const resp = await fetch(
        `https://api.weather.com/current?city=${args.city}`
      );
      const data = await resp.json();
      return `${data.temp}°F and ${data.conditions} in ${args.city}`;
    },
  },
};

// ── Connect to platform ─────────────────────────────────────────────

const ws = new WebSocket(process.env.PLATFORM_URL!, {
  headers: { Authorization: `Bearer ${process.env.API_KEY}` },
});

ws.on("open", () => {
  ws.send(
    JSON.stringify({
      type: "configure",
      instructions: "You are a helpful weather assistant. Be concise.",
      greeting: "Hey! Ask me about the weather.",
      voice: "jess",
      tools: Object.entries(tools).map(([name, t]) => ({
        name,
        description: t.description,
        parameters: zodToJsonSchema(t.parameters),
      })),
    })
  );
});

ws.on("message", async (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "tool_call") {
    const tool = tools[msg.name as keyof typeof tools];
    const result = tool
      ? await tool.handler(tool.parameters.parse(msg.args))
      : `Unknown tool: ${msg.name}`;
    ws.send(JSON.stringify({ type: "tool_result", callId: msg.callId, result }));
  }
  if (msg.type === "configured") {
    console.log(`Frontend URL: ${msg.frontendUrl}`);
  }
});
```

### Adding a new tool (what Claude Code generates)

Claude Code adds one entry to the `tools` object. Nothing else changes:

```typescript
  book_appointment: {
    description: "Book an appointment on the user's calendar",
    parameters: z.object({
      date: z.string().describe("Date in YYYY-MM-DD format"),
      time: z.string().describe("Time in HH:MM format"),
      service: z.string().describe("Type of appointment").optional(),
    }),
    handler: async (args: { date: string; time: string; service?: string }) => {
      const result = await calendarApi.book(args);
      return `Booked ${args.service ?? "appointment"} for ${args.date} at ${args.time}`;
    },
  },
```

One entry. Schema, validation, handler — all in one place. Zod validates at
runtime; the type annotation on `args` gives IDE autocomplete.

---

## Customer Frontend (React + TypeScript)

### Frontend dependencies

```json
{
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```

### `App.tsx` — the only frontend file Claude Code edits

The frontend connects directly to the platform using the `frontendUrl`.
In development, this URL can be hardcoded or fetched from the backend.
In production, it's typically passed via an API call or embedded in the page.

```tsx
// App.tsx — UI component. This is the only frontend file you edit.
import { useVoiceAgent } from "./hooks/useVoiceAgent";

// frontendUrl comes from the backend's "configured" response
const FRONTEND_URL = import.meta.env.VITE_FRONTEND_URL ?? "wss://platform.example.com/session/abc?token=xyz";

function App() {
  const { state, messages, transcript, cancel, reset } = useVoiceAgent(FRONTEND_URL);

  return (
    <div className="voice-agent">
      <div className="status">{state}</div>

      <div className="messages">
        {messages.map((m, i) => (
          <div key={i} className={`message ${m.role}`}>
            <span>{m.text}</span>
            {m.steps?.map((s, j) => <span key={j} className="step">{s}</span>)}
          </div>
        ))}
        {transcript && <div className="message user partial">{transcript}</div>}
      </div>

      <div className="controls">
        <button onClick={cancel} disabled={state !== "speaking"}>Stop</button>
        <button onClick={reset}>New Conversation</button>
      </div>
    </div>
  );
}
```

---

### `hooks/useVoiceAgent.ts` — generated once, includes audio

```typescript
// hooks/useVoiceAgent.ts — Voice agent hook with built-in audio handling.
import { useEffect, useRef, useState, useCallback } from "react";
import { startMicCapture, createAudioPlayer } from "../lib/audio";

export type AgentState = "connecting" | "ready" | "listening" | "thinking" | "speaking";

export interface Message {
  role: "user" | "assistant";
  text: string;
  steps?: string[];
}

export function useVoiceAgent(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const micCleanupRef = useRef<(() => void) | null>(null);
  const [state, setState] = useState<AgentState>("connecting");
  const [messages, setMessages] = useState<Message[]>([]);
  const [transcript, setTranscript] = useState("");

  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.binaryType = "arraybuffer";

    ws.onopen = () => setState("ready");

    ws.onmessage = (event) => {
      // Binary frame = TTS audio
      if (event.data instanceof ArrayBuffer) {
        playerRef.current?.enqueue(event.data);
        return;
      }

      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case "ready": {
          // Start mic capture, start audio player
          const player = createAudioPlayer(msg.ttsSampleRate ?? 24000);
          playerRef.current = player;
          startMicCapture(ws, msg.sampleRate ?? 16000).then((cleanup) => {
            micCleanupRef.current = cleanup;
          });
          setState("listening");
          break;
        }
        case "greeting":
          setMessages((m) => [...m, { role: "assistant", text: msg.text }]);
          setState("speaking");
          break;
        case "transcript":
          setTranscript(msg.text);
          if (state !== "thinking") setState("listening");
          break;
        case "turn":
          setMessages((m) => [...m, { role: "user", text: msg.text }]);
          setTranscript("");
          break;
        case "thinking":
          setState("thinking");
          break;
        case "chat":
          setMessages((m) => [...m, { role: "assistant", text: msg.text, steps: msg.steps }]);
          setState("speaking");
          break;
        case "tts_done":
          setState("listening");
          break;
        case "cancelled":
          playerRef.current?.flush();
          setState("listening");
          break;
        case "error":
          console.error("Agent error:", msg.message);
          break;
      }
    };

    ws.onclose = () => setState("connecting");

    return () => {
      micCleanupRef.current?.();
      playerRef.current?.close();
      ws.close();
    };
  }, [url]);

  const cancel = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "cancel" }));
    playerRef.current?.flush();
  }, []);

  const reset = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "reset" }));
    playerRef.current?.flush();
    setMessages([]);
    setTranscript("");
  }, []);

  return { state, messages, transcript, cancel, reset };
}
```

---

### `lib/audio.ts` — audio utilities (generated once)

```typescript
// lib/audio.ts — PCM16 mic capture + audio playback. Do not edit.

/**
 * Capture mic audio as PCM16 LE and send binary frames over WebSocket.
 * Uses AudioWorklet (not deprecated ScriptProcessorNode).
 * Returns a cleanup function to stop capture.
 */
export async function startMicCapture(
  ws: WebSocket,
  sampleRate: number,
): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { sampleRate, echoCancellation: true, noiseSuppression: true },
  });

  const ctx = new AudioContext({ sampleRate });
  const source = ctx.createMediaStreamSource(stream);

  // Register AudioWorklet for PCM16 encoding
  const workletCode = `
    class PCM16Processor extends AudioWorkletProcessor {
      process(inputs) {
        const input = inputs[0][0];
        if (input) {
          const int16 = new Int16Array(input.length);
          for (let i = 0; i < input.length; i++) {
            int16[i] = Math.max(-32768, Math.min(32767, input[i] * 32768));
          }
          this.port.postMessage(int16.buffer, [int16.buffer]);
        }
        return true;
      }
    }
    registerProcessor("pcm16", PCM16Processor);
  `;
  const blob = new Blob([workletCode], { type: "application/javascript" });
  await ctx.audioWorklet.addModule(URL.createObjectURL(blob));

  const worklet = new AudioWorkletNode(ctx, "pcm16");
  worklet.port.onmessage = (e) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(e.data);
    }
  };
  source.connect(worklet);
  worklet.connect(ctx.destination);

  return () => {
    stream.getTracks().forEach((t) => t.stop());
    ctx.close();
  };
}

/**
 * Audio player that buffers PCM16 LE chunks and plays them sequentially.
 */
export function createAudioPlayer(sampleRate: number) {
  const ctx = new AudioContext({ sampleRate });
  let nextTime = 0;

  return {
    enqueue(pcm16Buffer: ArrayBuffer) {
      const int16 = new Int16Array(pcm16Buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768;
      }

      const audioBuffer = ctx.createBuffer(1, float32.length, sampleRate);
      audioBuffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      const now = ctx.currentTime;
      const startTime = Math.max(now, nextTime);
      source.start(startTime);
      nextTime = startTime + audioBuffer.duration;
    },
    flush() {
      nextTime = 0;
      // Cancel pending audio by closing and recreating context
      ctx.close();
    },
    close() {
      ctx.close();
    },
  };
}
```

---

### Summary: what Claude Code touches vs. what it doesn't

| File | Claude Code edits? | Purpose |
|---|---|---|
| `agent.ts` | **Yes — always** | Config + tools (entire backend) |
| `App.tsx` | **Yes — for UI changes** | React component |
| `hooks/useVoiceAgent.ts` | Never | WS state machine, message handling |
| `lib/audio.ts` | Never | Mic capture (AudioWorklet), playback |
| `CLAUDE.md` | Never | Instructions for Claude Code |

**Why this structure?**
- `agent.ts` is ~45 lines. Claude Code reads it instantly, knows exactly
  where to add a tool. It's the entire backend — no entry point, no
  boilerplate, no relay.
- No `lib/voice-agent.ts` — the backend doesn't need WS plumbing. It
  connects to the platform and handles tool calls. That's it.
- `lib/audio.ts` uses `AudioWorkletNode` (not deprecated `ScriptProcessorNode`)
  and handles PCM16 encoding/decoding, buffered playback, and flush on barge-in.
- `useVoiceAgent` hook connects directly to the platform (not a local relay)
  and includes audio handling.
- The `CLAUDE.md` tells Claude Code exactly which file to edit for each task.

---

## Migration: Current Python → TypeScript

### What Maps Where

| Current Python File | TypeScript Equivalent | Notes |
|---|---|---|
| `fastapi.py` (467 lines) | `server.ts` + `session.ts` | WebSocket server replaces FastAPI. Session class replaces closure. |
| `agent.py` (378 lines) | `llm.ts` + `session.ts` | LLM Gateway calls via `fetch`. Tool loop in session. pydantic-ai removed. |
| `manager.py` (162 lines) | Part of `server.ts` | `Map<string, VoiceSession>` with TTL. No async lock (single-threaded). |
| `stt.py` (55 lines) | `stt.ts` | Token creation via `fetch`. WebSocket client via `ws`. |
| `voice_cleaner.py` (146 lines) | `voice-cleaner.ts` | Regex + `number-to-words` npm. Most direct port. |
| `types.py` (26 lines) | `types.ts` | TypeScript interfaces + zod schemas. |
| `tools.py` (47 lines) | Removed | Tools are customer-side now, not platform-side. |
| `cli.py` (161 lines) | Removed | No scaffolding CLI. Customers write raw TS. |
| `_template/server.py` (25 lines) | Removed | Replaced by customer backend example above. |
| `_template/static/*` | Removed | Replaced by customer frontend example above. |
| `__init__.py` (41 lines) | Removed | No SDK package. |

### What Gets Deleted

Everything in `src/aai_agent/`. The Python package ceases to exist.

### What Gets Created

The `platform/` directory with the TypeScript server, plus example
`customer-backend/` and `customer-frontend/` directories showing how
customers integrate.

---

## Implementation Order

### Phase 1: Platform Core
1. Set up `platform/` with `package.json`, `tsconfig.json`, `vitest`
2. Implement `types.ts` — all message interfaces + zod schemas
3. Implement `protocol.ts` — message parsing and validation
4. Implement `stt.ts` — AssemblyAI token creation + WebSocket client
5. Implement `llm.ts` — LLM Gateway HTTP client with response patching
6. Implement `tts.ts` — Orpheus TTS WebSocket relay
7. Implement `voice-cleaner.ts` — port text normalization from Python
8. Implement `session.ts` — `VoiceSession` class (core orchestration)
9. Implement `server.ts` — WebSocket server, session management, routing
10. Implement `index.ts` — entry point

### Phase 2: Customer Examples
11. Create `customer-backend/` example with tool handling
12. Create `customer-frontend/` example with audio capture/playback

### Phase 3: Testing & Validation
13. Unit tests for protocol, voice-cleaner, LLM response patching
14. Integration test: backend connects → configures → frontend connects → full voice loop
15. Verify same behavior as current Python implementation
