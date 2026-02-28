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

## Prerequisites

This project requires **Node.js 22 LTS**. We recommend [fnm](https://github.com/Schniz/fnm) for managing Node versions:

```bash
# Install fnm (macOS)
brew install fnm

# Add to your shell (add this to ~/.zshrc or ~/.bashrc)
eval "$(fnm env --use-on-cd)"

# Install and use Node 22 (auto-detected from .nvmrc)
cd platform
fnm install
fnm use
```

If you already have `nvm`, `fnm use` / `nvm use` will pick up the `.nvmrc` automatically.

## Running locally

```bash
# Start the platform server (builds client bundles and serves them)
cd platform
npm install
npm run dev:serve
```

The server starts on http://localhost:3000 with client bundles served at `/client.js` and `/react.js`.

### Try an example

Open any example in your browser — for instance, `examples/math-buddy/index.html`. It loads `client.js` from the running platform server. No build step needed.

## Examples

### Math Buddy (works out of the box)

A math assistant (`examples/math-buddy/`) that needs **zero API keys**:
- **4 tools**: `calculate`, `convert_units`, `roll_dice`, `random_number`
- All pure computation — runs entirely in the V8 sandbox
- Great starting point for learning the API

### Travel Concierge

A luxury travel concierge (`examples/travel-concierge/`) that demonstrates:
- **6 tools**: flight search, hotel search, weather forecast, currency conversion, local recommendations, itinerary creation
- Multi-step workflows (check weather → recommend activities → book)
- `ctx.secrets` for API key management across multiple services
- `ctx.fetch` for external API calls with auth headers
- Error handling in tool handlers

### TechStore Support

A customer support agent (`examples/techstore-support/`) that demonstrates:
- **6 tools**: customer lookup, order details, inventory check, promotions, returns, escalation
- Identity verification workflow (look up customer before accessing orders)
- POST requests with JSON bodies for mutations (returns, escalations)
- Optional parameters (`zip_code?`, `exchange_sku?`)

### Health Assistant

A health information assistant (`examples/health-assistant/`) that demonstrates:
- **5 tools**: symptom checker, drug info, drug interaction check, BMI calculator, weight-based dosage
- Pure computation tools (BMI, dosage) alongside API-backed tools
- Optional parameters for more accurate results (`age?`, `sex?`)

### Code Interpreter

A problem-solving assistant (`examples/code-interpreter/`) that demonstrates:
- **1 built-in tool**: `run_code` — executes JavaScript in the V8 sandbox
- Dynamic code generation and execution
- `print()` for intermediate output with return value capture

### Web Researcher

A research assistant (`examples/web-researcher/`) that demonstrates:
- **Built-in tools**: `web_search` via `builtinTools: ["web_search"]`
- Zero custom tool handlers — uses platform-provided tools
- Minimal configuration example

## Quickstart — Vanilla JS

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
      platformUrl: PLATFORM,
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

HTTP URLs are auto-converted to WebSocket (`http://` → `ws://`, `https://` → `wss://`).

Open in a browser. That's it.

## Quickstart — React

The platform serves a React hook at `/react.js`. Use the `useVoiceAgent()` hook:

```tsx
import { useVoiceAgent } from "http://localhost:3000/react.js";

function App() {
  const { state, messages, transcript, cancel, reset } = useVoiceAgent({
    apiKey: "pk_...",
    platformUrl: "http://localhost:3000",
    instructions: "You are a helpful assistant. Be concise.",
    greeting: "Hey! What can I help you with?",
    voice: "jess",
    tools: {
      // Add tools here — same format as the vanilla quickstart
    },
  });

  // Render your UI using state, messages, transcript, etc.
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
    "STORE_API_KEY": "sk-xyz789"
  },
  "pk_customer_def": {
    "STRIPE_KEY": "sk-stripe-123"
  }
}
```

Start the server with `SECRETS_FILE`:

```bash
SECRETS_FILE=secrets.json npm run dev:serve
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
│   └── __tests__/        # 263 tests across 19 files
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
├── index.html              # Root index linking to all examples
├── math-buddy/             # Works out of the box, no API keys
│   └── index.html          # 4 tools: calculate, convert_units, roll_dice, random_number
├── travel-concierge/       # Luxury travel planning
│   └── index.html          # 6 tools: flights, hotels, weather, currency, tips, itinerary
├── techstore-support/      # Customer support
│   └── index.html          # 6 tools: customer lookup, orders, inventory, promos, returns, escalation
├── health-assistant/       # Health information
│   └── index.html          # 5 tools: symptoms, drug info, interactions, BMI, dosage
├── code-interpreter/       # Run JavaScript via voice
│   └── index.html          # 1 tool: run_code (V8 sandbox)
└── web-researcher/         # Web search via voice
    └── index.html          # Built-in tool: web_search
```

## Development

```bash
cd platform
npm install
npm run dev:serve  # Build client bundles + start server with hot reload
npm run dev        # Start server only (no client bundles)
npm run build      # Compile server (tsc) + bundle client (esbuild)
npm run check      # Type check + lint + format + tests (263 tests)
npm start          # Run compiled server
```

## License

MIT
