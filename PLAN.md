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

## Customer Backend (TypeScript, No AssemblyAI SDK)

Customers use whatever npm packages they want — zod, ws, etc. We don't publish
or maintain an SDK. The constraint is: no `npm install @assemblyai/voice-agent`.

The key DX insight is using **zod** so each tool is defined in one place —
schema, types, and handler together. No sync issues between three separate
definitions.

### Customer dependencies

```json
{
  "dependencies": {
    "ws": "^8.0.0",
    "zod": "^3.0.0",
    "zod-to-json-schema": "^3.0.0"
  }
}
```

### Full example

```typescript
// customer-backend/server.ts
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const PLATFORM_URL = "wss://platform.example.com/agent";
const FRONTEND_PORT = 8080;

// ── Define tools ────────────────────────────────────────────────────
// Each tool is ONE object: schema + handler together. Zod gives you
// runtime validation, TypeScript types, and JSON Schema generation.

const tools = {
  get_weather: {
    description: "Get current weather for a city",
    parameters: z.object({
      city: z.string().describe("City name, e.g. San Francisco"),
    }),
    handler: async (args: { city: string }) => {
      const resp = await fetch(`https://api.weather.com/current?city=${args.city}`);
      const data = await resp.json();
      return `${data.temp}°F and ${data.conditions} in ${args.city}`;
    },
  },

  search_web: {
    description: "Search the web for information",
    parameters: z.object({
      query: z.string().describe("Search query"),
    }),
    handler: async (args: { query: string }) => {
      const resp = await fetch(`https://api.duckduckgo.com/?q=${args.query}&format=json`);
      const data = await resp.json();
      return data.AbstractText || "No results found.";
    },
  },
};

// ── Convert tools to wire format ────────────────────────────────────
// zodToJsonSchema generates the JSON Schema the LLM needs.
// This runs once at startup — not per request.

function toolSchemas() {
  return Object.entries(tools).map(([name, tool]) => ({
    name,
    description: tool.description,
    parameters: zodToJsonSchema(tool.parameters),
  }));
}

// ── Handle a tool call from the platform ────────────────────────────

async function handleToolCall(name: string, args: unknown): Promise<string> {
  const tool = tools[name as keyof typeof tools];
  if (!tool) return `Unknown tool: ${name}`;

  // Validate args against the zod schema
  const parsed = tool.parameters.safeParse(args);
  if (!parsed.success) return `Invalid args: ${parsed.error.message}`;

  return tool.handler(parsed.data);
}

// ── Connect to platform ─────────────────────────────────────────────

const platform = new WebSocket(PLATFORM_URL, {
  headers: { Authorization: `Bearer ${process.env.API_KEY}` },
});

platform.on("open", () => {
  platform.send(JSON.stringify({
    type: "configure",
    instructions: "You are a helpful weather assistant. Be concise.",
    greeting: "Hey! Ask me about the weather anywhere in the world.",
    voice: "jess",
    tools: toolSchemas(),
  }));
});

platform.on("message", async (raw) => {
  const msg = JSON.parse(raw.toString());

  if (msg.type === "tool_call") {
    const result = await handleToolCall(msg.name, msg.args);
    platform.send(JSON.stringify({
      type: "tool_result",
      callId: msg.callId,
      result,
    }));
  }

  if (msg.type === "configured") {
    console.log(`Session ready. Frontend token: ${msg.token}`);
    startFrontendRelay(msg.token);
  }
});

// ── Frontend relay ──────────────────────────────────────────────────
// Proxies WS frames between browser and platform. The backend sits in
// the middle so it can intercept tool_call messages while passing
// everything else (audio, transcripts, UI events) straight through.

function startFrontendRelay(token: string) {
  const wss = new WebSocketServer({ port: FRONTEND_PORT });
  wss.on("connection", (browserWs) => {
    platform.send(JSON.stringify({ type: "frontend_connect", token }));

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

### Adding a new tool (what Claude Code would generate)

To add a tool, Claude Code adds one entry to the `tools` object:

```typescript
// Just add to the tools object — schema, types, and handler in one place
const tools = {
  // ... existing tools ...

  book_appointment: {
    description: "Book an appointment on the user's calendar",
    parameters: z.object({
      date: z.string().describe("Date in YYYY-MM-DD format"),
      time: z.string().describe("Time in HH:MM format"),
      service: z.string().describe("Type of appointment").optional(),
    }),
    handler: async (args: { date: string; time: string; service?: string }) => {
      // call calendar API...
      return `Booked ${args.service ?? "appointment"} for ${args.date} at ${args.time}`;
    },
  },
};
```

One place. Schema, validation, types, handler — all together. `toolSchemas()`
and `handleToolCall()` pick it up automatically.

**Why zod?**
- Most popular TS validation library (~25M weekly npm downloads)
- Customers likely already use it
- `z.string().describe()` adds parameter descriptions the LLM can see
- `.optional()` generates correct `required` in JSON Schema
- `.safeParse()` validates args from the platform WebSocket at runtime
- Types are inferred — no manual `args: { city: string }` needed if you use `z.infer`
- `zod-to-json-schema` is a single function call

**Key points:**
- No AssemblyAI SDK. Customer uses `ws` + `zod` (both standard ecosystem deps).
- Tools defined in one place — no schema/handler sync issues.
- Adding a tool = add one entry to the `tools` object.
- Args are validated at runtime before the handler runs.
- Frontend relay is a simple bidirectional proxy.

---

## Customer Frontend (React + TypeScript)

Customers will most likely use React. The frontend is purely UI + audio — no
business logic. Here's a minimal example using standard React patterns:

### Customer dependencies

```json
{
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```

### Hooks (customer writes or Claude Code generates)

```typescript
// hooks/useVoiceAgent.ts
import { useEffect, useRef, useState, useCallback } from "react";

type AgentState = "connecting" | "ready" | "listening" | "thinking" | "speaking";

interface Message {
  role: "user" | "assistant";
  text: string;
  steps?: string[];
}

export function useVoiceAgent(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [state, setState] = useState<AgentState>("connecting");
  const [messages, setMessages] = useState<Message[]>([]);
  const [transcript, setTranscript] = useState("");

  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = async (event) => {
      if (event.data instanceof Blob) {
        playAudio(await event.data.arrayBuffer());
        return;
      }
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case "ready":
          setState("ready");
          startMic(ws, msg.sampleRate);
          break;
        case "greeting":
          setMessages((m) => [...m, { role: "assistant", text: msg.text }]);
          setState("speaking");
          break;
        case "transcript":
          setTranscript(msg.text);
          setState("listening");
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
      }
    };

    return () => ws.close();
  }, [url]);

  const cancel = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "cancel" }));
  }, []);

  const reset = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "reset" }));
    setMessages([]);
  }, []);

  return { state, messages, transcript, cancel, reset };
}
```

### Usage in a component

```tsx
// App.tsx
import { useVoiceAgent } from "./hooks/useVoiceAgent";

function App() {
  const { state, messages, transcript, cancel, reset } = useVoiceAgent("ws://localhost:8080");

  return (
    <div>
      <div>{state}</div>
      {messages.map((m, i) => (
        <div key={i} className={m.role}>{m.text}</div>
      ))}
      {transcript && <div className="transcript">{transcript}</div>}
      <button onClick={cancel}>Cancel</button>
      <button onClick={reset}>Reset</button>
    </div>
  );
}
```

**Key points:**
- Standard React hooks pattern — customers can style and structure however they want.
- No SDK dependency. Just browser APIs (`WebSocket`, `AudioContext`, `getUserMedia`).
- The hook manages state machine transitions (connecting → ready → listening →
  thinking → speaking) so the UI can show the right indicators.
- Audio capture and playback are encapsulated in helper functions.
- Could also be done with Vue composables, Svelte stores, or vanilla JS —
  the WebSocket protocol is the same regardless of framework.

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
