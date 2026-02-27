# Plan: Rewrite as TypeScript Platform with WebSocket Event Protocol

## Goal

Replace the entire Python codebase with a TypeScript platform server. Customers
write raw TypeScript — no SDK. The architecture uses exactly two WebSocket
connections:

```
┌──────────────┐         WS 1          ┌──────────────┐         WS 2          ┌──────────────┐
│   Customer   │◄──────────────────────►│   Platform   │◄──────────────────────►│   Customer   │
│   Frontend   │  audio + UI events     │   Server     │  config + tool events  │   Backend    │
│  (browser)   │                        │  (Node.js)   │                        │  (any lang)  │
└──────────────┘                        └──────────────┘                        └──────────────┘
```

- **WS 1**: Customer frontend ↔ Platform. Audio (PCM16 binary frames) and UI
  events (transcript, thinking, chat, tts_done, greeting, error).
- **WS 2**: Platform ↔ Customer backend. Configuration, tool calls, tool
  results, and session lifecycle events.

The customer frontend is purely UI + audio capture/playback. The customer backend
configures the agent and handles tool execution. The platform owns everything in
between: STT, LLM orchestration, TTS, session management.

---

## Architecture

### Connection Flow

```
1. Customer backend connects to platform via WS 2
2. Customer backend sends "configure" message with instructions, tools, voice
3. Platform acknowledges with "configured" + session info
4. Customer frontend connects to platform via WS 1 (with session token)
5. Platform connects to STT provider, sends "ready" to frontend
6. Platform sends greeting to frontend (text + TTS audio)

Voice loop:
7.  Frontend sends mic audio (binary) → Platform relays to STT
8.  STT returns transcript → Platform sends to frontend
9.  STT returns final turn → Platform sends to LLM
10. LLM requests tool call → Platform sends tool_call to backend (WS 2)
11. Backend executes tool, sends tool_result → Platform feeds to LLM
12. LLM produces response → Platform sends chat to frontend + starts TTS
13. TTS audio streams to frontend (binary)
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
  model: "claude-haiku-4-5-20251001",
  voiceRules: "Keep responses to 1-2 sentences...",
  sttConfig: {
    sampleRate: 16000,
    speechModel: "u3-pro",
    minEndOfTurnSilenceWhenConfident: 400,
    maxTurnSilence: 1200
  },
  ttsConfig: {
    voice: "jess",
    maxTokens: 2000,
    bufferSize: 105,
    repetitionPenalty: 1.2,
    temperature: 0.6,
    topP: 0.9,
    sampleRate: 24000
  },
  tools: [
    {
      name: "get_weather",
      description: "Get current weather for a city",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "City name" }
        },
        required: ["city"]
      }
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
{ type: "configured", sessionId: "abc...", token: "frontend-auth-token" }
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

## Customer Backend (Raw TypeScript, No SDK)

```typescript
// customer-backend/server.ts
import { WebSocket, WebSocketServer } from "ws";

const PLATFORM_URL = "wss://platform.example.com/agent";
const FRONTEND_PORT = 8080;

// 1. Connect to platform
const platform = new WebSocket(PLATFORM_URL, {
  headers: { Authorization: "Bearer <api-key>" },
});

platform.on("open", () => {
  // 2. Configure the agent
  platform.send(JSON.stringify({
    type: "configure",
    instructions: "You are a helpful weather assistant.",
    greeting: "Hey! Ask me about the weather anywhere in the world.",
    voice: "jess",
    tools: [{
      name: "get_weather",
      description: "Get current weather for a city",
      parameters: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
    }],
  }));
});

// 3. Handle tool calls from platform
platform.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());

  if (msg.type === "tool_call") {
    // Execute tool locally
    const result = handleTool(msg.name, msg.args);
    platform.send(JSON.stringify({
      type: "tool_result",
      callId: msg.callId,
      result,
    }));
  }

  if (msg.type === "configured") {
    console.log(`Session ready. Frontend token: ${msg.token}`);
    // Start frontend WebSocket server, relay to platform
    startFrontendRelay(msg.token);
  }
});

// 4. Tool implementations — plain functions
function handleTool(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "get_weather":
      return `72°F and sunny in ${args.city}`;
    default:
      return `Unknown tool: ${name}`;
  }
}

// 5. Frontend relay — just proxies WS frames between browser and platform
function startFrontendRelay(token: string) {
  const wss = new WebSocketServer({ port: FRONTEND_PORT });
  wss.on("connection", (browserWs) => {
    // Tell platform to connect this frontend
    platform.send(JSON.stringify({ type: "frontend_connect", token }));

    // Relay all messages bidirectionally
    browserWs.on("message", (data, isBinary) => {
      platform.send(data, { binary: isBinary });
    });
    platform.on("message", (data, isBinary) => {
      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(data, { binary: isBinary });
      }
    });
  });
}
```

**Key points:**
- Zero SDK imports. Just `ws` from npm.
- Tools are plain functions in a switch statement.
- The customer backend acts as a relay for the frontend WebSocket — it proxies
  audio and UI events between the browser and the platform, while intercepting
  tool_call/tool_result messages for local execution.

---

## Customer Frontend (Browser, Raw TypeScript)

```typescript
// customer-frontend/app.ts
const ws = new WebSocket("ws://localhost:8080"); // connects to customer backend

const audioCtx = new AudioContext({ sampleRate: 24000 });
let mediaStream: MediaStream;

ws.onmessage = async (event) => {
  if (event.data instanceof Blob) {
    // TTS audio — play it
    const buffer = await event.data.arrayBuffer();
    playAudio(buffer);
    return;
  }

  const msg = JSON.parse(event.data);
  switch (msg.type) {
    case "ready":
      startMic(msg.sampleRate);
      break;
    case "greeting":
      showMessage("assistant", msg.text);
      break;
    case "transcript":
      showTranscript(msg.text, msg.final);
      break;
    case "thinking":
      showThinking();
      break;
    case "chat":
      showMessage("assistant", msg.text);
      showSteps(msg.steps);
      break;
    case "tts_done":
      onTTSDone();
      break;
    case "error":
      showError(msg.message);
      break;
  }
};

function startMic(sampleRate: number) {
  navigator.mediaDevices.getUserMedia({ audio: { sampleRate } })
    .then(stream => {
      mediaStream = stream;
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e) => {
        const pcm = e.inputBuffer.getChannelData(0);
        const int16 = float32ToInt16(pcm);
        ws.send(int16.buffer);
      };
      source.connect(processor);
      processor.connect(audioCtx.destination);
    });
}

function cancelSpeech() {
  ws.send(JSON.stringify({ type: "cancel" }));
}
```

**Key points:**
- Pure browser APIs: `WebSocket`, `AudioContext`, `getUserMedia`.
- No SDK, no framework dependency. Could be used with React, Vue, Svelte, or
  vanilla JS.
- Frontend connects to customer backend (not platform directly). Backend relays.

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
