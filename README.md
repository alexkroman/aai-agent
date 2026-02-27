# aai-agent

A voice agent platform powered by [AssemblyAI](https://www.assemblyai.com/) STT, LLM Gateway, and Orpheus TTS.

Build a voice assistant with tool calling in a single HTML file — no backend, no npm, no build tools.

## How it works

```
Browser                              Platform (managed)
┌──────────────────────┐             ┌────────────────────┐
│ Customer code:       │             │ STT (AssemblyAI)   │
│ config + tools       │── WebSocket ──▶ LLM Gateway      │
│ (~25 lines)          │             │ TTS (Orpheus)      │
│                      │             │ V8 sandbox (tools) │
│ client.js            │◀── audio ───│ Secret store       │
│ (served by platform) │             └────────────────────┘
└──────────────────────┘
```

1. Customer defines agent config and tool handlers in the browser
2. `client.js` (served by the platform) handles WebSocket, audio, and tool serialization
3. Tool handlers are serialized and sent to the platform on every session start
4. Platform runs handlers in a V8 sandbox with `ctx.secrets` and `ctx.fetch` injected
5. No backend needed — deploy as a static site

## Quickstart — Vanilla JS (zero dependencies)

Create a single HTML file:

```html
<!DOCTYPE html>
<html>
<body>
  <div id="app"></div>
  <script type="module">
    const PLATFORM = "http://localhost:3000";
    const { VoiceAgent } = await import(`${PLATFORM}/client.js`);

    VoiceAgent.start({
      element: "#app",
      platformUrl: PLATFORM.replace("http", "ws"),
      apiKey: "pk_your_publishable_key",
      instructions: "You are a helpful assistant. Be concise.",
      greeting: "Hey! What can I help you with?",
      voice: "jess",
      tools: {
        get_weather: {
          description: "Get current weather for a city",
          parameters: { city: { type: "string", description: "City name" } },
          handler: async (args, ctx) => {
            const resp = ctx.fetch(
              `https://api.weather.com/current?city=${args.city}`,
              { headers: { "X-Api-Key": ctx.secrets.WEATHER_API_KEY } }
            );
            return resp.json();
          },
        },
      },
    });
  </script>
</body>
</html>
```

Open in a browser. That's it.

## Quickstart — React (custom UI)

```bash
mkdir my-agent && cd my-agent
npm create vite@latest . -- --template react-ts
```

Create `src/agent.ts`:

```typescript
type Ctx = {
  secrets: Record<string, string>;
  fetch: (url: string, init?: RequestInit) => {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    text: () => string;
    json: () => unknown;
  };
};

export const config = {
  instructions: "You are a helpful assistant. Be concise.",
  greeting: "Hey! What can I help you with?",
  voice: "jess",
};

export const tools = {
  get_weather: {
    description: "Get current weather for a city",
    parameters: { city: { type: "string", description: "City name" } },
    handler: async (args: { city: string }, ctx: Ctx) => {
      const resp = ctx.fetch(
        `https://api.weather.com/current?city=${args.city}`,
        { headers: { "X-Api-Key": ctx.secrets.WEATHER_API_KEY } }
      );
      return resp.json();
    },
  },
};
```

Create `src/App.tsx`:

```tsx
import { useState, useEffect } from "react";
import { config, tools } from "./agent";

const PLATFORM = import.meta.env.VITE_PLATFORM_URL || "http://localhost:3000";

export default function App() {
  const [hook, setHook] = useState<any>(null);

  useEffect(() => {
    import(/* @vite-ignore */ `${PLATFORM}/react.js`).then(setHook);
  }, []);

  if (!hook) return <div>Loading voice agent...</div>;

  return <VoiceUI useVoiceAgent={hook.useVoiceAgent} />;
}

function VoiceUI({ useVoiceAgent }: { useVoiceAgent: any }) {
  const { state, messages, transcript, cancel, reset } = useVoiceAgent({
    apiKey: import.meta.env.VITE_API_KEY,
    platformUrl: PLATFORM.replace("http", "ws"),
    config,
    tools,
  });

  return (
    <div>
      <p>{state}</p>
      {messages.map((m: any, i: number) => (
        <div key={i}>
          <span>{m.role}: {m.text}</span>
          {m.steps?.map((s: string, j: number) => (
            <span key={j}>{s}</span>
          ))}
        </div>
      ))}
      {transcript && <div>You: {transcript}</div>}
      <button onClick={cancel} disabled={state !== "speaking"}>Stop</button>
      <button onClick={reset}>New Conversation</button>
    </div>
  );
}
```

## Tool handler constraints

Handlers run on the platform in a V8 sandbox. They must be self-contained:

- **Use** `ctx.fetch(url, init?)` — platform-proxied HTTP (no CORS issues)
- **Use** `ctx.secrets.KEY` — secrets injected from the platform
- **No imports** — only globals: JSON, Math, Date, URL, console, crypto
- **Return any value** — strings, objects, arrays (auto-stringified for LLM)
- **30-second timeout** per tool call
- **128 MB memory limit** per session isolate

## Secrets

Tool handlers access secrets via `ctx.secrets`. Secrets are injected server-side and never exposed to the browser.

Create a `secrets.json` file with per-customer secrets, keyed by API key:

```json
{
  "pk_customer_abc": {
    "WEATHER_API_KEY": "sk-abc123",
    "ORDERS_API_KEY": "sk-xyz789"
  },
  "pk_customer_def": {
    "STRIPE_KEY": "sk-stripe-123"
  }
}
```

Start the server with `SECRETS_FILE`:

```bash
SECRETS_FILE=secrets.json npm run dev
```

Inside a handler, access them with `ctx.secrets.WEATHER_API_KEY`. Each customer only sees their own secrets.

Secrets are copied into each tool execution via V8's `ExternalCopy` — mutations inside a handler never leak back to the host or to other tool calls.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `ASSEMBLYAI_API_KEY` | Yes | AssemblyAI API key for speech-to-text |
| `ASSEMBLYAI_TTS_API_KEY` | Yes | API key for TTS (Orpheus via Baseten) |
| `ASSEMBLYAI_TTS_WSS_URL` | No | Custom TTS WebSocket URL |
| `LLM_MODEL` | No | LLM model name (default: `claude-haiku-4-5-20251001`) |
| `SECRETS_FILE` | No | Path to JSON file with per-customer secrets |
| `PORT` | No | Server port (default: `3000`) |
| `CLIENT_DIR` | No | Path to built client bundles (e.g., `dist`) |

## Project structure

```
platform/
├── src/
│   ├── index.ts          # Entry point
│   ├── server.ts         # HTTP + WebSocket server
│   ├── session.ts        # Voice session orchestration (STT → LLM → TTS)
│   ├── llm.ts            # LLM Gateway client (OpenAI-compatible)
│   ├── stt.ts            # AssemblyAI streaming STT
│   ├── tts.ts            # Orpheus TTS via WebSocket
│   ├── sandbox.ts        # V8 isolate sandbox for tool execution
│   ├── protocol.ts       # Parameter schema conversion
│   ├── voice-cleaner.ts  # Text normalization for TTS
│   ├── types.ts          # All shared types and defaults
│   └── __tests__/        # 163 tests across 12 files
├── client/
│   ├── core.ts           # WebSocket session, audio capture + playback
│   ├── client.ts         # Vanilla JS entry with default UI
│   └── react.ts          # React hook: useVoiceAgent()
├── scripts/
│   └── build-client.js   # esbuild bundler for client libraries
├── package.json
├── tsconfig.json
└── eslint.config.js

examples/
├── vanilla/              # Single HTML file example
│   └── index.html
└── react/                # Vite + React example
    └── src/
        ├── agent.ts      # Agent config + tools (the only file you edit)
        └── App.tsx       # UI component
```

## Development

```bash
cd platform
npm install
npm run check     # Type check + lint + format + tests (163 tests)
npm run dev       # Start platform server with hot reload
npm run build     # Compile server (tsc) + bundle client (esbuild)
npm start         # Run compiled server
```

To serve client libraries from the platform:

```bash
CLIENT_DIR=dist npm run dev
```

## License

MIT
