# Voice Agent Project

This project was scaffolded with `aai-agent init`. It's a voice-first AI assistant powered by AssemblyAI (STT), smolagents (LLM agent), and Rime (TTS).

## Project Structure

- `server.py` — The main file. All customization happens here.
- `.env` — API keys (ASSEMBLYAI_API_KEY, RIME_API_KEY). Never commit this.
- `static/` — Pre-built frontend. Do not edit these files.

## How to Customize

Everything is configured by passing arguments to `create_voice_app()` or by creating a `VoiceAgentManager` with custom parameters.

### Add Tools

Use the `@tool` decorator to create custom tools:

```python
from aai_agent import tool
from aai_agent.fastapi import create_voice_app

@tool
def get_weather(city: str) -> str:
    """Get the current weather for a city.

    Args:
        city: The city to get weather for, e.g. "San Francisco".
    """
    return f"The weather in {city} is 72°F and sunny."

app = create_voice_app(tools=[get_weather])
```

You can also pass built-in tools by name: `"DuckDuckGoSearchTool"`, `"VisitWebpageTool"`, `"WikipediaSearchTool"`, `"PythonInterpreterTool"`.

### Create a Custom Tool

```python
from aai_agent import tool
from aai_agent.fastapi import create_voice_app

@tool
def get_weather(city: str) -> str:
    """Get the current weather for a city.

    Args:
        city: The city to get weather for, e.g. "San Francisco".
    """
    return f"The weather in {city} is 72°F and sunny."

app = create_voice_app(tools=[get_weather])
```

### Change Personality, Voice, Greeting, or Model

For full control, create a `VoiceAgentManager` and pass it to `create_voice_app`:

```python
from aai_agent import VoiceAgentManager
from aai_agent.types import TTSConfig, STTConfig
from aai_agent.fastapi import create_voice_app

manager = VoiceAgentManager(
    instructions="You are a pirate assistant. Always respond in pirate speak.",
    greeting="Ahoy! What can I help ye with?",
    model="claude-haiku-4-5-20251001",
    max_steps=3,
    tts_config=TTSConfig(speaker="cove", speed=1.0),
    tools=["DuckDuckGoSearchTool"],
)

app = create_voice_app(agent_manager=manager)
```

### VoiceAgentManager / VoiceAgent Parameters

| Parameter | Default | What it does |
|-----------|---------|-------------|
| `instructions` | See "Overridable Prompts" below | System prompt / persona |
| `greeting` | `"Hey there! I'm a voice assistant. What can I help you with?"` | Spoken on first connect. Set to `""` to disable. |
| `tools` | `[]` | Tools the agent can call |
| `model` | `"claude-haiku-4-5-20251001"` | LLM model via AssemblyAI LLM Gateway |
| `max_steps` | `3` | Max reasoning steps per query |
| `tts_config` | `TTSConfig()` | Voice settings — see below |
| `stt_config` | `STTConfig()` | Speech-to-text settings — see below |
| `voice_rules` | See below | Appended to instructions. Pass `""` to disable. |
| `fallback_answer_prompt` | See below | Used when agent exhausts max_steps |
| `step_callbacks` | `[]` | Functions called after each agent step |

### TTSConfig Options (Voice)

**Do not change the Rime TTS defaults** (`model="arcana"`, `sample_rate=24000`, `speed=1.15`, `max_tokens=1200`). These are tuned for low-latency voice agent use. The only setting you should change is `speaker` to pick a different voice.

```python
TTSConfig(speaker="celeste")  # just change the voice
```

#### Rime Arcana Voices

Flagship English voices (pass any of these as the `speaker` value):

| Voice | Gender | Age | Accent |
|-------|--------|-----|--------|
| `lintel` (default) | Female | Young adult | American |
| `luna` | Female | Young adult | American |
| `lyra` | Female | Young adult | American |
| `celeste` | Female | Young adult | American |
| `estelle` | Female | Young adult | American |
| `oculus` | Female | Young adult | American |
| `transom` | Female | Young adult | American |
| `astra` | Female | Young adult | American |
| `moss` | Female | Adult | Singaporean |
| `vashti` | Female | Adult | British |
| `eucalyptus` | Female | Young adult | Australian |
| `fern` | Male | Young adult | American |
| `sirius` | Male | Young adult | American |
| `eliphas` | Male | Young adult | American |
| `walnut` | Male | Young adult | American |
| `stucco` | Male | Young adult | American |
| `truss` | Male | Young adult | American |
| `bond` | Male | Adult | American |
| `cupola` | Male | Adult | American |
| `atrium` | Male | Adult | American |
| `parapet` | Male | Adult | American |
| `masonry` | Male | Adult | American |
| `pilaster` | Male | Adult | American |
| `marlu` | Male | Adult | Australian |

There are 200+ additional voices available. See the full list at https://docs.rime.ai/api-reference/voices

### STTConfig Options (Speech-to-Text)

```python
STTConfig(
    sample_rate=16000,
    speech_model="u3-pro",
    token_expires_in=480,
    format_turns=True,
    end_of_turn_confidence_threshold=0.8,
)
```

## Overridable Prompts

The SDK and the underlying smolagents framework expose several prompts you can override. All are importable from the `aai_agent` package.

### SDK-Level Prompts

These are passed as parameters to `VoiceAgent` / `VoiceAgentManager`:

**`instructions`** — The main system prompt. Default (`DEFAULT_INSTRUCTIONS`):
```
You are a helpful voice assistant. Your goal is to provide accurate,
research-backed answers using your available tools.

Voice-First Rules:
- Optimize for natural speech. Avoid jargon unless central to the answer.
  Use short, punchy sentences.
- Never mention "search results," "sources," or "the provided text."
  Speak as if the knowledge is your own.
- No visual formatting. Do not say "bullet point," "bold," or "bracketed one."
  If you need to list items, say "First," "Next," and "Finally."
- Start with the most important information. No introductory filler.
- Be concise. For complex topics, provide a high-level summary.
- Be confident. Avoid hedging phrases like "It seems that" or "I believe."
- If you don't have enough information, say so directly rather than guessing.
```

**`voice_rules`** — Appended after instructions. Default (`VOICE_RULES`):
```
CRITICAL: When you call final_answer, your answer will be spoken aloud by a
TTS system. Write your answer exactly as you would say it out loud to a friend.
One to two sentences max. No markdown, no bullet points, no numbered lists,
no code. Sound like a human talking, not a document.

TTS Text Formatting Rules (follow these exactly):
- Use commas for slight pauses, periods for longer pauses.
- Write numbers as digits: 123, $7.95, 70°F, 100%.
- Write dates as: October 12, 2024. Write times as: 10:30 AM.
- Write phone numbers with dashes: 555-772-9140.
- ALWAYS spell out acronyms letter by letter with periods and spaces.
  SDK → S. D. K., API → A. P. I., USA → U. S. A., AI → A. I.
  Never write bare acronyms.
- Common abbreviations like Dr., St., Rd. are fine as-is.
- Never use markdown symbols: no *, #, [], (), >, or ```. No URLs.
- Use punctuation expressively: ? for questions, ?! for excited questions,
  ... for trailing off.
```
Pass `voice_rules=""` to disable.

**`greeting`** — Spoken when a user first connects. Default (`DEFAULT_GREETING`):
```
Hey there! I'm a voice assistant. What can I help you with?
```
Pass `greeting=""` to disable.

**`fallback_answer_prompt`** — Used when the agent exhausts `max_steps` without a final answer. Default (`FALLBACK_ANSWER_PROMPT`):
```python
{
    "pre_messages": "An agent tried to answer a user query but got stuck. "
                    "You must provide a spoken answer instead. Here is the agent's memory:",
    "post_messages": "Answer the following as if you're speaking to someone in conversation:\n"
                     "{{task}}\n\n"
                     "Your answer will be read aloud by a text-to-speech system. "
                     "Keep it to two or three sentences. Talk like a real person would — "
                     "no lists, no formatting, no jargon. Just give them the answer directly.",
}
```

### smolagents Prompt Templates (Advanced)

The SDK uses smolagents' `ToolCallingAgent` under the hood. Its `prompt_templates` dict has four top-level keys you can override by subclassing or by accessing `agent.prompt_templates` after creation:

**`system_prompt`** — The base agent system prompt. Defines tool-calling behavior, few-shot examples, and rules. The SDK's `instructions` parameter is injected into this via the `{{custom_instructions}}` Jinja2 variable.

**`planning`** — Multi-step planning prompts (used when `planning_interval` is set):
- `planning.initial_plan` — First planning step: survey facts, create a plan.
- `planning.update_plan_pre_messages` — Preamble for subsequent plan updates.
- `planning.update_plan_post_messages` — Instructions for writing updated plan. Has `{{remaining_steps}}`.

**`managed_agent`** — For hierarchical agent setups:
- `managed_agent.task` — Wraps the task when called by a parent agent. Has `{{name}}`, `{{task}}`.
- `managed_agent.report` — Formats the result back to the parent. Has `{{name}}`, `{{final_answer}}`.

**`final_answer`** — Fallback when agent gets stuck (the SDK overrides this with `fallback_answer_prompt`):
- `final_answer.pre_messages` — Preamble before showing agent memory.
- `final_answer.post_messages` — Instructions for generating a final answer. Has `{{task}}`.

To override smolagents templates directly:
```python
from aai_agent import VoiceAgent

agent = VoiceAgent(tools=["DuckDuckGoSearchTool"])
# After creation, modify the underlying prompt templates:
# agent._agent.prompt_templates["system_prompt"] = "..."
```

### Import All Default Prompts

```python
from aai_agent import (
    DEFAULT_INSTRUCTIONS,
    DEFAULT_GREETING,
    VOICE_RULES,
    FALLBACK_ANSWER_PROMPT,
)
```

## Add Custom API Endpoints

`create_voice_app()` returns a standard FastAPI app:

```python
app = create_voice_app(tools=["DuckDuckGoSearchTool"])

@app.get("/health")
async def health():
    return {"status": "ok"}
```

## Built-in API Endpoints

The app serves these under the `/api` prefix:

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/tokens` | GET | Get AssemblyAI streaming STT token + WebSocket URL |
| `/api/greet` | POST | Get greeting text + audio |
| `/api/chat` | POST | Send `{"message": "..."}`, get `{"reply", "audio", "steps"}` |

## Override CORS Origins

```python
app = create_voice_app(cors_origins=["https://myapp.com"])
```

Default origins: `http://localhost:5173`, `http://localhost:3000`.

## Running

```
aai-agent start                              # localhost:8000 with auto-reload
aai-agent start --port 3000 --host 0.0.0.0   # custom host/port
```

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `ASSEMBLYAI_API_KEY` | Yes | Speech-to-text + LLM Gateway |
| `RIME_API_KEY` | Yes | Text-to-speech |
| `AGENT_MODEL` | No | Override the default LLM model |
