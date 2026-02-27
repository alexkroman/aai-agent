# Plan: Rewrite as TypeScript Platform with WebSocket Event Protocol

## Goal

Replace the entire Python codebase with a TypeScript platform server. The
platform serves a client library (`client.js`) that handles all WebSocket,
audio, and tool serialization logic. Customers write only their agent config
and tool handlers — no boilerplate.

```
┌──────────────────────────────────────────────────────────┐
│                      Browser                              │
│                                                           │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Customer code: config + tools (~25 lines)        │    │
│  │  (single JS file or inline <script>)              │    │
│  └──────────┬───────────────────────────────────────┘    │
│             │ calls                                       │
│  ┌──────────▼───────────────────────────────────────┐    │
│  │  client.js (served by platform / CDN)             │    │
│  │  WebSocket, PCM16 audio, tool serialization       │    │
│  │  Default UI (or React hook for custom UI)         │    │
│  └──────────┬───────────────────────────────────────┘    │
│             │ Single WebSocket                            │
└─────────────┼────────────────────────────────────────────┘
              │
       ┌──────┴───────┐
       │   Platform    │
       │  STT/LLM/TTS  │
       │  Secret store  │
       │  V8 sandbox    │◄── runs handlers with secrets + fetch injected
       └───────────────┘
```

No backend. No npm. No build tools (unless customer wants React).
Tool handlers are serialized on every session start and executed on the
platform in a V8 sandbox. The sandbox provides `ctx.secrets` (from platform
secret store) and `ctx.fetch` (proxied HTTP, no CORS).

**Most minimal voice agent**: one HTML file, ~30 lines, zero dependencies.
**With custom React UI**: `agent.ts` + `App.tsx`, import hook from platform CDN.


---

## Architecture

### Connection Flow

```
1. Browser opens WebSocket to platform (wss://platform.example.com/session?key=PUBLISHABLE_KEY)
2. Browser sends "configure" message with config, tools (handlers serialized as strings)
3. Platform creates V8 sandbox, loads handler code + injects secrets
4. Platform connects to STT provider, sends "ready" to browser
5. Platform sends greeting (text + TTS audio)

Voice loop:
6.  Browser sends mic audio (binary) → Platform relays to STT
7.  STT returns transcript → Platform sends to browser
8.  STT returns final turn → Platform sends to LLM
9.  LLM requests tool call → Platform runs handler in V8 sandbox
    (handler has access to ctx.secrets and ctx.fetch)
10. Handler returns result → Platform feeds to LLM
11. LLM produces response → Platform sends chat to browser + starts TTS
12. TTS audio streams to browser (binary)
```

Key difference from traditional architectures: **there is no tool_call/tool_result
round-trip to a backend**. The platform executes the handler code directly.
Tool execution is single-digit milliseconds of overhead (V8 isolate startup)
instead of a network round-trip.

### Deployment

```
┌──────────────────────┐          ┌─────────────────────────────┐
│  Customer App        │          │         Platform             │
│  (any static host,   │          │   (managed by us)            │
│   or just localhost)  │          │                              │
│                      │          │  Serves: client.js, react.js │
│  index.html          │◄─ JS ──│  (client library via CDN)     │
│  (or React app)      │         │                               │
│                      │── WS ──►│  STT, LLM, TTS               │
│                      │         │  Secret store                 │
│                      │         │  V8 sandbox for tools          │
└──────────────────────┘          └──────────────────────────────┘
```

- **Customer app**: Static files (even just one HTML file). Deploy anywhere.
- **Platform**: Managed by us. Serves client library. Stores secrets. Runs tool handlers in sandbox.

### WebSocket Protocol (Browser ↔ Platform)

One WebSocket. Browser sends config + audio. Platform sends events + audio.

**Browser sends:**
```typescript
// On connect — configure the agent for this session:
{
  type: "configure",
  instructions: "You are a helpful weather assistant.",
  greeting: "Hey! Ask me about the weather.",
  voice: "jess",
  tools: [
    {
      name: "get_weather",
      description: "Get current weather for a city",
      parameters: { city: { type: "string", description: "City name" } },
      handler: "async (args, ctx) => { ... }"   // serialized function string
    }
  ]
}

// Binary frames: PCM16 LE mic audio

// JSON control messages:
{ type: "cancel" }     // barge-in
{ type: "reset" }      // reset conversation
```

**Platform sends to browser:**
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

---

## Platform Server (TypeScript/Node.js)

### Directory Structure

```
platform/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Entry point, starts HTTP + WS server
│   ├── server.ts             # WebSocket server setup (ws library)
│   ├── session.ts            # VoiceSession class — orchestrates one conversation
│   ├── sandbox.ts            # V8 isolate manager for tool handler execution
│   ├── stt.ts                # STT client (AssemblyAI WebSocket + token creation)
│   ├── tts.ts                # TTS client (Orpheus WebSocket relay)
│   ├── llm.ts                # LLM client (AssemblyAI LLM Gateway, OpenAI-compat)
│   ├── voice-cleaner.ts      # Text normalization for TTS
│   ├── types.ts              # All TypeScript interfaces and message types
│   └── protocol.ts           # Message parsing, validation, simplified→JSON Schema conversion
├── client/                   # Client library (served via HTTP)
│   ├── core.ts               # Shared: WS protocol, tool serialization, audio
│   ├── client.ts             # Vanilla JS: VoiceAgent.start() + default UI
│   └── react.ts              # React hook: useVoiceAgent()
```

### Key Dependencies

```json
{
  "dependencies": {
    "ws": "^8.0.0",
    "zod": "^3.0.0",
    "isolated-vm": "^5.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/ws": "^8.0.0",
    "esbuild": "^0.24.0",
    "vitest": "^3.0.0"
  }
}
```

- **`ws`** — WebSocket server and client. Handles browser connections
  and outbound STT/TTS connections.
- **`zod`** — Runtime validation of incoming messages (configure, etc.)
- **`isolated-vm`** — V8 isolate sandbox for running customer tool handlers
  securely with memory/CPU limits. Same isolation model as Cloudflare Workers.
- **`esbuild`** — Bundles `client/` into `client.js` and `react.js` for serving.
- No framework (no Express, no Fastify). Just `ws` + `http.createServer` for
  the health endpoint and client library serving.

### Core Class: `VoiceSession`

Each conversation is a `VoiceSession` instance that manages:

```typescript
class VoiceSession {
  private config: AgentConfig;        // from browser's "configure" message
  private browserWs: WebSocket;       // single WS to browser
  private sandbox: V8Sandbox;         // isolated V8 context for tool handlers
  private sttWs: WebSocket | null;    // outbound to AssemblyAI
  private chatAbort: AbortController | null;
  private ttsAbort: AbortController | null;

  // Lifecycle
  async start(): Promise<void>;       // create sandbox, connect STT, send ready + greeting
  async stop(): Promise<void>;        // cleanup all connections + sandbox

  // Browser message handlers
  private onBrowserAudio(data: Buffer): void;    // relay to STT
  private onBrowserCancel(): Promise<void>;      // barge-in
  private onBrowserReset(): Promise<void>;       // reset conversation

  // STT event handlers
  private onTranscript(text: string, isFinal: boolean): void;
  private onTurn(text: string): Promise<void>;    // trigger LLM

  // LLM + tool orchestration
  private handleTurn(text: string): Promise<void>;
  private callLLM(messages: Message[]): Promise<LLMResponse>;
  private executeTool(name: string, args: object): Promise<string>;  // runs handler in V8 sandbox
  private relayTTS(text: string): Promise<void>;

  // Voice cleaning
  private normalizeForTTS(text: string): string;
}
```

### Tool Execution (Platform-Side V8 Sandbox)

When the LLM returns a tool call, the platform runs the handler directly
in a V8 sandbox — no network round-trip to a backend:

```typescript
// Platform-side execution (inside sandbox.ts):
private async executeTool(name: string, args: object): Promise<string> {
  const tool = this.sandboxedHandlers.get(name);
  if (!tool) return `Unknown tool: ${name}`;

  // Run handler in V8 isolate with injected context
  const ctx = {
    secrets: this.customerSecrets,   // from platform secret store
    fetch: this.proxiedFetch,         // platform-proxied fetch (no CORS)
  };
  const result = await tool(args, ctx);
  return typeof result === "string" ? result : JSON.stringify(result);
}
```

**Sandbox constraints** (same model as Cloudflare Workers):
- Handlers have access to: `ctx.secrets`, `ctx.fetch`, `JSON`, `Math`, `Date`,
  `URL`, `URLSearchParams`, `crypto`, `TextEncoder`/`TextDecoder`, `console`
- No access to: filesystem, `process`, `require`, `import`, raw network
- `ctx.fetch` is proxied through the platform — no CORS restrictions
- `ctx.secrets` comes from the platform's secret store (dashboard/API)
- Execution timeout: 30 seconds per tool call

### LLM Integration

Call the AssemblyAI LLM Gateway (OpenAI-compatible) directly via HTTP.
No SDK needed — just `fetch`:

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
  return patchResponse(await resp.json());
}
```

The `patchResponse` function handles the same LLM Gateway normalization that
`_PatchTransport` does in the current Python code (fixing finish_reason,
filling null id/model/usage fields).

---

## Customer Code

The platform serves `client.js` from its server (and eventually CDN).
This library contains all WebSocket, audio, and tool serialization logic.
Customers never write or manage this code — they just load it.

### Option 1: Vanilla JS — Single HTML File (Zero Dependencies)

The most minimal voice agent possible. No npm, no build tools, no React.

```
voice-agent/
└── index.html     ← THE ONLY FILE (~30 lines)
```

```html
<!DOCTYPE html>
<html>
<head><title>Voice Agent</title></head>
<body>
  <div id="app"></div>
  <script type="module">
    import { VoiceAgent } from "https://platform.example.com/client.js";

    VoiceAgent.start({
      element: "#app",
      apiKey: "pk_your_publishable_key",
      instructions: "You are a helpful order tracking assistant. Be concise.",
      greeting: "Hi! I can help you check your order status.",
      voice: "jess",
      tools: {
        check_order: {
          description: "Look up order status by order ID",
          parameters: { order_id: { type: "string", description: "Order ID" } },
          handler: async (args, ctx) => {
            const resp = await ctx.fetch(
              `https://api.example.com/orders/${args.order_id}`,
              { headers: { Authorization: `Bearer ${ctx.secrets.ORDERS_API_KEY}` } }
            );
            return await resp.json();
          },
        },
      },
    });
  </script>
</body>
</html>
```

That's it. Open the file in a browser. No `npm install`. No build step.

### Option 2: React — Custom UI (Vite Project)

For customers who want custom UI. The React hook is loaded from the platform.

```
voice-agent/
├── src/
│   ├── agent.ts   ← Config + tools (~25 lines)
│   └── App.tsx    ← Custom UI (~35 lines)
├── index.html
├── package.json
├── CLAUDE.md
└── .env
```

**`agent.ts`** — config + tools:

```typescript
// agent.ts — Agent config and tools. This is the only file you edit.

type Ctx = { secrets: Record<string, string>; fetch: typeof fetch };

export const config = {
  instructions: "You are a helpful weather assistant. Be concise.",
  greeting: "Hey! Ask me about the weather.",
  voice: "jess",
};

export const tools = {
  get_weather: {
    description: "Get current weather for a city",
    parameters: { city: { type: "string", description: "City name" } },
    handler: async (args: { city: string }, ctx: Ctx) => {
      const resp = await ctx.fetch(
        `https://api.weather.com/current?city=${encodeURIComponent(args.city)}`,
        { headers: { "X-Api-Key": ctx.secrets.WEATHER_API_KEY } }
      );
      return await resp.json();
    },
  },
};
```

**`App.tsx`** — custom UI:

```tsx
// App.tsx — UI component. This is the only frontend file you edit.
import { useVoiceAgent } from "https://platform.example.com/react.js";
import { config, tools } from "./agent";

export default function App() {
  const { state, messages, transcript, cancel, reset } = useVoiceAgent({
    apiKey: import.meta.env.VITE_API_KEY,
    config,
    tools,
  });

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

**Dependencies** — just React:

```json
{
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```

**CLAUDE.md** (guides Claude Code):

```markdown
# Voice Agent

Only edit `src/agent.ts` and `src/App.tsx`.

## Adding a tool
Edit `src/agent.ts`, add an entry to the `tools` object:
- `description`: what the tool does (the LLM reads this)
- `parameters`: { paramName: { type: "string", description: "..." } }
- `handler`: async function receiving (args, ctx)
  - ctx.secrets: key-value store from platform dashboard
  - ctx.fetch: HTTP fetch with no CORS restrictions
  - Return any value (string, object, array)
  - Must be self-contained — no imports, no closures

## Changing the agent's behavior
Edit `config` in `src/agent.ts`.

## Changing the UI
Edit `src/App.tsx`.
```

---

### Handler constraints

Handlers must be self-contained (serialized via `.toString()`):
- **Use** `ctx.fetch` (not bare `fetch`) — platform proxies, no CORS
- **Use** `ctx.secrets.KEY` for API keys — never hardcode secrets
- **No imports** — only sandbox globals: JSON, Math, Date, URL, console, crypto
- **Return any value** — strings, objects, arrays (auto-stringified for LLM)
- **30-second timeout** — platform cancels after 30s

### Adding a new tool (what Claude Code generates)

```typescript
  schedule_callback: {
    description: "Schedule a callback for the customer",
    parameters: {
      phone: { type: "string", description: "Phone number" },
      time: { type: "string?", description: "Preferred time, e.g. '2pm'" },
    },
    handler: async (args, ctx) => {
      const resp = await ctx.fetch("https://api.example.com/callbacks", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ctx.secrets.API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phone: args.phone, time: args.time ?? "next available" }),
      });
      return await resp.json();
    },
  },
```

### Simplified parameter format (platform converts to JSON Schema)

The platform's `protocol.ts` handles the conversion. Three forms are supported:

**1. Simple** — just the type name:
```
{ city: "string" }               →  { type: "object", properties: { city: { type: "string" } }, required: ["city"] }
{ limit: "number?" }             →  { type: "object", properties: { limit: { type: "number" } }, required: [] }
```

**2. Extended** — type + description (and optional enum):
```
{ city: { type: "string",        →  { type: "object",
         description: "Name" } }      properties: { city: { type: "string", description: "Name" } },
                                       required: ["city"] }

{ status: { type: "string",      →  { type: "object",
            enum: ["open",            properties: { status: { type: "string", enum: ["open", "closed"] } },
                   "closed"] } }       required: ["status"] }
```

**3. Raw JSON Schema** — pass-through for complex cases:
```
{ type: "object", properties: { ... } }  →  used as-is (detected by presence of "type" at root level)
```

Supported types: `"string"`, `"number"`, `"boolean"`. Append `?` for optional.
The platform auto-detects which format is being used per-tool.

---

## Platform-Served Client Library

The platform serves two JavaScript bundles:

### `client.js` — Vanilla JS (no framework)

Loaded via `<script type="module">` or ES import. Contains:
- `VoiceAgent.start(opts)` — renders default UI into `opts.element`, manages
  WebSocket connection, audio capture/playback, tool serialization
- Handles all audio via AudioWorklet (PCM16 encoding) and AudioContext (playback)
- Serializes tool handlers via `.toString()` and sends to platform on connect
- Manages state machine: connecting → ready → listening → thinking → speaking

### `react.js` — React hook

Loaded via ES import. Contains:
- `useVoiceAgent(opts)` — React hook returning `{ state, messages, transcript, cancel, reset }`
- Same WebSocket + audio logic as `client.js`, packaged as a React hook
- Uses React as a peer dependency (customer provides React)

Both bundles contain the same core logic (WebSocket protocol, PCM16 audio
capture via AudioWorklet, buffered playback with flush-on-barge-in). The
platform builds them from the same source during its build step.

**Versioning**: Bundles are served with content-hash URLs for caching:
`https://platform.example.com/client.abc123.js`. The bare URL
`/client.js` redirects to the latest version.

---

### Summary: what Claude Code touches

**Vanilla JS** (simplest):
| File | Purpose |
|---|---|
| `index.html` | Everything — config, tools, UI mount (~30 lines) |

**React** (custom UI):
| File | Purpose |
|---|---|
| `src/agent.ts` | Config + tools (~25 lines) |
| `src/App.tsx` | Custom UI (~35 lines) |

**What Claude Code never writes**: WebSocket code, audio code, tool
serialization. All of that lives in `client.js`/`react.js` served by the platform.

**What Claude Code sees when it opens `agent.ts`:**
```
25 lines. Two objects: config and tools.
No imports. No WebSocket code. No boilerplate.
```

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
| `tools.py` (47 lines) | Removed | Tools are customer-defined, run in V8 sandbox. |
| `cli.py` (161 lines) | Removed | No scaffolding CLI. Customers write minimal JS. |
| `_template/server.py` (25 lines) | Removed | No customer backend. |
| `_template/static/*` | `client.js` + `react.js` | Platform-served client library. |
| `__init__.py` (41 lines) | Removed | No SDK package. |

### What Gets Deleted

Everything in `src/aai_agent/`. The Python package ceases to exist.

### What Gets Created

The `platform/` directory with the TypeScript server (including client library
build), plus `examples/` showing both vanilla and React usage.

---

## Implementation Order

### Phase 1: Platform Core
1. Set up `platform/` with `package.json`, `tsconfig.json`, `vitest`
2. Implement `types.ts` — all message interfaces + zod schemas
3. Implement `protocol.ts` — message parsing, validation, simplified→JSON Schema conversion
4. Implement `stt.ts` — AssemblyAI token creation + WebSocket client
5. Implement `llm.ts` — LLM Gateway HTTP client with response patching
6. Implement `tts.ts` — Orpheus TTS WebSocket relay
7. Implement `voice-cleaner.ts` — port text normalization from Python
8. Implement `sandbox.ts` — V8 isolate manager for tool handler execution
9. Implement `session.ts` — `VoiceSession` class (core orchestration)
10. Implement `server.ts` — WebSocket server, session management, routing
11. Implement `index.ts` — entry point

### Phase 2: Client Library
12. Implement `client-core.ts` — shared WebSocket protocol, tool serialization, audio (AudioWorklet + playback)
13. Implement `client.ts` — vanilla JS entry: `VoiceAgent.start()` with default UI
14. Implement `client-react.ts` — React hook: `useVoiceAgent()`
15. Build pipeline: bundle `client.js` and `react.js` for serving via platform HTTP
16. Serve client bundles from platform's HTTP server with content-hash caching

### Phase 3: Examples
17. Create `examples/vanilla/` — single `index.html`
18. Create `examples/react/` — Vite project with `agent.ts` + `App.tsx`

### Phase 4: Testing & Validation
19. Unit tests for protocol, voice-cleaner, LLM response patching, sandbox
20. Integration test: browser connects → configures with tools → full voice loop → tool execution in sandbox
21. Verify same behavior as current Python implementation

---

## Deployment Guide (Customer Code)

Customer code is a static site. No backend, no server, no process to manage.

**Vanilla JS** — just host the HTML file:

| Method | How |
|---|---|
| Open in browser | `open index.html` (for development) |
| Any static host | Upload `index.html` |
| Vercel | `vercel` |
| Netlify | `netlify deploy --prod` |
| GitHub Pages | Push to GitHub |

**React** — standard Vite static site:

| Method | How |
|---|---|
| Local dev | `npm run dev` |
| Build | `npm run build` → static files in `dist/` |
| Deploy | `vercel`, `netlify deploy --prod`, or upload `dist/` anywhere |

**Environment variables** (React only, baked in at build time):
```
VITE_API_KEY=pk_your_publishable_key
```

The `pk_*` publishable key is safe to embed in client code (like Stripe's
publishable key). It identifies the customer account. Secrets stay in the
platform's secret store, injected into handlers at runtime via `ctx.secrets`.

### Claude Code deployability

**Vanilla JS** — Claude Code produces one file and it's done.
No deployment step needed beyond hosting the HTML file.

**React** — Claude Code can:
1. Edit `agent.ts` (add tools, change config)
2. Edit `App.tsx` (change UI)
3. `npm run dev` to test locally
4. `npm run build && vercel` to deploy

**No moving parts**: no backend, no database, no build pipeline configuration,
no infrastructure-as-code. The hardest deployment is a Vite static site.
The easiest is a single HTML file.
