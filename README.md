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
    import { VoiceAgent } from "https://platform.example.com/client.js";

    VoiceAgent.start({
      element: "#app",
      apiKey: "pk_your_publishable_key",
      instructions: "You are a helpful assistant. Be concise.",
      greeting: "Hey! What can I help you with?",
      voice: "jess",
      tools: {
        get_weather: {
          description: "Get current weather for a city",
          parameters: { city: { type: "string", description: "City name" } },
          handler: async (args, ctx) => {
            const resp = await ctx.fetch(
              `https://api.weather.com/current?city=${args.city}`,
              { headers: { "X-Api-Key": ctx.secrets.WEATHER_API_KEY } }
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

Open in a browser. That's it.

## Quickstart — React (custom UI)

```bash
mkdir my-agent && cd my-agent
npm create vite@latest . -- --template react-ts
```

Create `src/agent.ts`:

```typescript
type Ctx = { secrets: Record<string, string>; fetch: typeof fetch };

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
      const resp = await ctx.fetch(
        `https://api.weather.com/current?city=${args.city}`,
        { headers: { "X-Api-Key": ctx.secrets.WEATHER_API_KEY } }
      );
      return await resp.json();
    },
  },
};
```

Create `src/App.tsx`:

```tsx
import { useVoiceAgent } from "https://platform.example.com/react.js";
import { config, tools } from "./agent";

export default function App() {
  const { state, messages, transcript, cancel, reset } = useVoiceAgent({
    apiKey: import.meta.env.VITE_API_KEY,
    config,
    tools,
  });

  return (
    <div>
      <p>{state}</p>
      {messages.map((m, i) => (
        <div key={i}>{m.role}: {m.text}</div>
      ))}
      {transcript && <div>You: {transcript}</div>}
      <button onClick={cancel}>Stop</button>
      <button onClick={reset}>Reset</button>
    </div>
  );
}
```

## Tool handler constraints

Handlers run on the platform in a V8 sandbox. They must be self-contained:

- **Use** `ctx.fetch` — platform-proxied HTTP (no CORS)
- **Use** `ctx.secrets.KEY` — secrets from platform dashboard
- **No imports** — only globals: JSON, Math, Date, URL, console, crypto
- **Return any value** — strings, objects, arrays (auto-stringified for LLM)
- **30-second timeout** per tool call

## Project structure

```
platform/           # TypeScript platform server
├── src/            # Server: WebSocket, STT, LLM, TTS, sandbox
├── client/         # Client library: client.js, react.js
└── scripts/        # Build scripts

examples/
├── vanilla/        # Single HTML file example
└── react/          # Vite + React example
```

## Development

```bash
cd platform
npm install
npm test          # 103 tests
npm run dev       # Start platform server
```

## License

MIT
