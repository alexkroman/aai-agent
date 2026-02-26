# aai-agent

A voice agent SDK powered by [AssemblyAI](https://www.assemblyai.com/) (STT), [Rime](https://rime.ai/) (TTS), and [smolagents](https://github.com/huggingface/smolagents) (tool-calling LLM).

Build a voice assistant that can search the web, run Python code, and answer questions — in under 20 lines of Python.

## Quickstart

### 1. Scaffold a project

```bash
pip install aai-agent[fastapi]
aai-agent new my-assistant
cd my-assistant
```

This creates a ready-to-run project:

```
my-assistant/
  .env.example    # API key template
  server.py       # FastAPI server
  static/
    index.html                  # Single-page frontend
    aai-voice-agent.iife.js     # Pre-built web component
```

### 2. Add your API keys

```bash
cp .env.example .env
```

```
ASSEMBLYAI_API_KEY=your_assemblyai_key
RIME_API_KEY=your_rime_key
```

Get keys from [assemblyai.com](https://www.assemblyai.com/dashboard/signup) and [rime.ai](https://rime.ai/).

### 3. Run

```bash
python server.py
```

Open [http://localhost:8000](http://localhost:8000), click the microphone, and start talking.

## How it works

```
Browser mic ──▶ AssemblyAI STT (WebSocket) ──▶ Agent (smolagents + LLM)
                                                       │
Browser audio ◀── Rime TTS ◀── spoken response ◀───────┘
```

1. The browser captures audio and streams it to AssemblyAI for real-time transcription.
2. When a complete turn is detected, the transcript is sent to the agent.
3. The agent uses tools (web search, Wikipedia, Python, etc.) to research an answer.
4. The answer is synthesized to speech by Rime and played back in the browser.

## Python SDK

### VoiceAgent

The core class. Wraps STT token creation, LLM tool-calling, and TTS into a single interface.

```python
from aai_agent import VoiceAgent
from aai_agent.tools import DuckDuckGoSearchTool, VisitWebpageTool

agent = VoiceAgent(
    tools=[DuckDuckGoSearchTool(), VisitWebpageTool()],
)

# Text-only response
response = await agent.chat("What is AssemblyAI?")
print(response.text)

# Text + audio
response = await agent.voice_chat("What is AssemblyAI?")
print(response.text)          # "AssemblyAI is a speech-to-text API..."
print(len(response.audio))    # WAV bytes
print(response.audio_base64)  # base64-encoded WAV string
print(response.steps)         # ["Using DuckDuckGoSearchTool", ...]
```

API keys are resolved from arguments first, then from `ASSEMBLYAI_API_KEY` and `RIME_API_KEY` environment variables.

#### Constructor options

| Parameter | Default | Description |
|-----------|---------|-------------|
| `assemblyai_api_key` | `$ASSEMBLYAI_API_KEY` | AssemblyAI API key (STT + LLM Gateway) |
| `rime_api_key` | `$RIME_API_KEY` | Rime API key (TTS) |
| `model` | `claude-sonnet-4-5-20250929` | LLM model via AssemblyAI LLM Gateway |
| `tools` | `[]` | List of smolagents tools |
| `instructions` | Voice-optimized prompt | System prompt / persona |
| `max_steps` | `5` | Max agent reasoning steps per query |
| `step_callbacks` | `[]` | Functions called after each agent step |
| `tts_config` | `TTSConfig()` | Rime TTS settings (voice, speed, etc.) |
| `stt_config` | `STTConfig()` | AssemblyAI STT settings (model, sample rate) |
| `greeting` | `"Hey there! I'm a voice assistant..."` | Spoken on first connect (empty string to disable) |
| `voice_rules` | Rules for speech-friendly output | Appended to instructions |

### VoiceAgentManager

Manages per-session `VoiceAgent` instances with TTL-based cleanup. Use this in multi-user servers.

```python
from aai_agent import VoiceAgentManager

manager = VoiceAgentManager(
    tools=[DuckDuckGoSearchTool()],
    ttl_seconds=3600,  # expire inactive sessions after 1 hour
)

agent = manager.get_or_create("session-123")
response = await agent.voice_chat("Hello!")
```

### Configuration

Customize TTS and STT behavior:

```python
from aai_agent import VoiceAgent, TTSConfig, STTConfig

agent = VoiceAgent(
    tts_config=TTSConfig(
        speaker="luna",       # Rime voice ID
        model="arcana",       # Rime model
        sample_rate=24000,
        speed=1.15,
    ),
    stt_config=STTConfig(
        sample_rate=16000,
        speech_model="u3-pro",
    ),
)
```

### Built-in tools

Re-exported from smolagents for convenience:

```python
from aai_agent.tools import (
    DuckDuckGoSearchTool,     # Web search
    VisitWebpageTool,         # Fetch and read a webpage
    WikipediaSearchTool,      # Wikipedia search
    PythonInterpreterTool,    # Execute Python code
)
```

You can also use any [smolagents-compatible tool](https://huggingface.co/docs/smolagents/en/tools).

## FastAPI integration

### App factory (recommended)

The fastest way to get a server running:

```python
from aai_agent import VoiceAgentManager
from aai_agent.fastapi import create_voice_app
from aai_agent.tools import DuckDuckGoSearchTool

manager = VoiceAgentManager(tools=[DuckDuckGoSearchTool()])

app = create_voice_app(
    agent_manager=manager,
    cors_origins=["http://localhost:5173"],
    static_dir="static",
)
```

This gives you:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /api/tokens` | GET | AssemblyAI streaming token + WebSocket URL |
| `POST /api/greet` | POST | Greeting text + audio |
| `POST /api/chat` | POST | Send message, get reply + audio + steps |
| `GET /health` | GET | Health check (returns `{"status": "ok"}`) |
| `GET /` | GET | Static files (HTML, JS) |

Options: `cors_origins`, `static_dir`, `session_secret`, `api_prefix` (default `"/api"`).

### Router (more control)

If you have an existing FastAPI app and want to mount the voice endpoints alongside your own routes:

```python
from fastapi import FastAPI
from aai_agent import VoiceAgentManager
from aai_agent.fastapi import create_voice_router

manager = VoiceAgentManager(tools=[...])

app = FastAPI()
app.include_router(
    create_voice_router(agent_manager=manager),
    prefix="/api",
)

# Add your own routes alongside the voice endpoints
@app.get("/my-custom-route")
def my_route():
    return {"hello": "world"}
```

### Custom server (no helpers)

If you need full control over the server — custom authentication, different session management, streaming responses, or a non-FastAPI framework — use `VoiceAgent` directly:

```python
from fastapi import FastAPI, Request
from aai_agent import VoiceAgent
from aai_agent.tools import DuckDuckGoSearchTool

app = FastAPI()

# Manage sessions however you want
sessions: dict[str, VoiceAgent] = {}

def get_agent(session_id: str) -> VoiceAgent:
    if session_id not in sessions:
        sessions[session_id] = VoiceAgent(
            tools=[DuckDuckGoSearchTool()],
            instructions="You are a helpful research assistant.",
            greeting="",  # disable greeting
        )
    return sessions[session_id]

@app.get("/api/tokens")
async def tokens(request: Request):
    agent = get_agent(request.cookies.get("session_id", "default"))
    return await agent.create_streaming_token()

@app.post("/api/chat")
async def chat(request: Request):
    data = await request.json()
    agent = get_agent(request.cookies.get("session_id", "default"))

    # Use chat() for text-only, voice_chat() for text + audio
    result = await agent.voice_chat(data["message"])

    return {
        "reply": result.text,
        "audio": result.audio_base64,
        "steps": result.steps,
    }

# Or use the lower-level methods individually:
# text_response = await agent.chat("Hello")       # text only, no TTS
# audio_bytes   = await agent.synthesize("Hello")  # TTS only, no agent
# token_info    = await agent.create_streaming_token()  # STT token only
```

## Frontend

### Web component (simplest)

Drop a single `<script>` tag into any HTML page:

```html
<aai-voice-agent backend-url="/api"></aai-voice-agent>
<script src="/aai-voice-agent.iife.js"></script>
```

Attributes:

| Attribute | Default | Description |
|-----------|---------|-------------|
| `backend-url` | `""` | API base URL |
| `title` | `"Voice Assistant"` | Header title |
| `debounce-ms` | `1500` | Silence debounce before sending a turn (ms) |
| `auto-greet` | `true` | Play greeting when recording starts |

The IIFE bundle is self-contained — React is bundled inside, no dependencies needed.

### React hook (full customization)

For React apps that need a custom UI:

```bash
npm install @aai-agent/react
```

```jsx
import { useVoiceAgent } from "@aai-agent/react";
import "@aai-agent/react/styles.css"; // optional — only if using VoiceWidget

function MyAssistant() {
  const {
    messages,        // Array<{ id, text, role, type, steps }>
    liveTranscript,  // real-time STT text
    showTranscript,  // whether transcript is active
    statusText,      // "Listening...", "Thinking...", "Speaking..."
    statusClass,     // "listening", "processing", "speaking"
    isRecording,     // mic is active
    toggleRecording, // start/stop
  } = useVoiceAgent({
    baseUrl: "/api",
    debounceMs: 1500,
    autoGreet: true,
  });

  return (
    <div>
      <button onClick={toggleRecording}>
        {isRecording ? "Stop" : "Start"}
      </button>

      {liveTranscript && <p><em>{liveTranscript}</em></p>}

      {messages.map((msg) => (
        <div key={msg.id} className={msg.role}>
          {msg.type === "steps"
            ? msg.steps.join(" → ")
            : msg.text}
        </div>
      ))}

      <p>{statusText}</p>
    </div>
  );
}
```

The hook handles everything: mic capture, WebSocket STT, agent chat, TTS playback, barge-in (interrupt), and cleanup on unmount.

### Drop-in React widget

If you don't need a custom UI:

```jsx
import { VoiceWidget } from "@aai-agent/react";
import "@aai-agent/react/styles.css";

function App() {
  return <VoiceWidget baseUrl="/api" title="My Assistant" />;
}
```

### Custom frontend (no helpers)

If you're not using React, or want to build the UI from scratch, here's what the backend API expects:

**1. Get a streaming token:**

```javascript
const { wss_url, sample_rate } = await fetch("/api/tokens").then(r => r.json());
```

**2. Stream audio to AssemblyAI:**

```javascript
const ws = new WebSocket(wss_url);
// Capture mic audio, convert to 16-bit PCM, send as ArrayBuffer
// Listen for JSON messages with type "Turn" and a transcript field
```

**3. Send completed turns to the agent:**

```javascript
const { reply, audio, steps } = await fetch("/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: transcript }),
}).then(r => r.json());

// reply: string — the agent's text response
// audio: string — base64-encoded WAV audio (or null)
// steps: string[] — tool-use steps the agent took
```

**4. Play the audio:**

```javascript
if (audio) {
  const player = new Audio(`data:audio/wav;base64,${audio}`);
  player.play();
}
```

## Knowledge base (RAG)

Add semantic search over your own docs using ChromaDB.

### 1. Install the knowledge extra

```bash
pip install aai-agent[knowledge]
```

### 2. Index your docs

**CLI** — point at any URL (plain text or [llms-full.txt](https://llmstxt.org/) format):

```bash
aai-agent index --url https://www.assemblyai.com/docs/llms-full.txt --db ./chroma_db --collection my_docs
```

**Python** — for more control:

```python
from aai_agent import KnowledgeBaseIndexer

indexer = KnowledgeBaseIndexer(
    path="./chroma_db",
    collection_name="my_docs",
)

# Index from a URL (auto-detects llms-full.txt page separators)
indexer.index_url("https://example.com/docs/llms-full.txt")

# Or index pre-chunked texts directly
indexer.index_texts(["chunk 1", "chunk 2"], metadatas=[{"source": "faq"}] * 2)
```

### 3. Query with KnowledgeBaseTool

```python
from aai_agent import KnowledgeBaseTool, VoiceAgent

docs = KnowledgeBaseTool(
    name="search_docs",
    description="Search the documentation for answers.",
    path="./chroma_db",
    collection_name="my_docs",
)

agent = VoiceAgent(tools=[docs])
```

The indexer handles text cleaning (strips HTML, markdown, converts tables to prose), sentence-aware chunking with overlap, and batched embedding. The `KnowledgeBaseTool` uses the same embedding model at query time for consistent retrieval.

## Deployment

### Generate Fly.io deployment files

```bash
aai-agent deploy
```

This detects your project structure and generates three files:

- **Dockerfile** — installs deps with `uv`, copies source, runs `index_docs.py` if present
- **fly.toml** — app config with auto-stop/auto-start machines
- **.dockerignore** — excludes `.venv`, `.git`, `.env`, `chroma_db`

Options:

```bash
aai-agent deploy --app my-app-name   # custom Fly.io app name (default: directory name)
aai-agent deploy --port 3000         # custom port (default: 8000)
aai-agent deploy --force             # overwrite existing files
```

### Deploy

```bash
flyctl auth login
flyctl apps create my-app-name
flyctl secrets set ASSEMBLYAI_API_KEY=... RIME_API_KEY=...
flyctl deploy
```

### Production mode

`aai-agent start --prod` binds to `0.0.0.0`, disables auto-reload, and reads `PORT` from the environment. It also auto-detects Fly.io and Railway environments:

```bash
aai-agent start --prod              # explicit
# or just set FLY_APP_NAME / PORT   # auto-detected
```

The generated Dockerfile uses `aai-agent start --prod` as its CMD.

## Project structure

```
src/aai_agent/
  __init__.py       # Public API exports
  agent.py          # VoiceAgent — STT + LLM + TTS orchestration
  manager.py        # VoiceAgentManager — per-session agents with TTL
  fastapi.py        # create_voice_router() and create_voice_app()
  types.py          # TTSConfig, STTConfig, VoiceResponse
  stt.py            # AssemblyAI streaming token client
  tts.py            # Rime TTS client
  tools.py          # Re-exported smolagents tools
  indexer.py        # KnowledgeBaseIndexer — build ChromaDB collections
  cli.py            # CLI: init, start, deploy, index
  _template/        # Scaffolding files for new projects

packages/react/
  src/
    useVoiceAgent.js    # React hook — mic, STT, chat, TTS, barge-in
    VoiceWidget.jsx     # Drop-in UI component
    web-component.jsx   # <aai-voice-agent> custom element
    pcm-worklet.js      # AudioWorklet for PCM encoding (inlined as Blob URL)
    styles.css          # Scoped styles (aai-* prefixed)

```

## Installation

```bash
# Core SDK only
pip install aai-agent

# With FastAPI support
pip install aai-agent[fastapi]

# With RAG / knowledge base support
pip install aai-agent[knowledge]

# Everything
pip install aai-agent[fastapi,knowledge]
```

Requires Python 3.11+.

## License

MIT
