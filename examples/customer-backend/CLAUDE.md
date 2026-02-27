# Voice Agent Backend

## Adding a tool
Edit `agent.ts` and add an entry to the `tools` object. Each tool has:
- `description`: what the tool does (the LLM sees this)
- `parameters`: object mapping param names to types
  - Simple: `{ city: "string" }` or `{ limit: "number?" }` (? = optional)
  - With description: `{ city: { type: "string", description: "City name" } }`
  - With enum: `{ status: { type: "string", enum: ["open", "closed"] } }`
- `handler`: async function that takes the parsed args and returns a string

## Changing the agent's behavior
Edit the `config` object at the top of `agent.ts`:
- `instructions`: system prompt
- `greeting`: first message spoken to the user
- `voice`: TTS voice name

## Running
```
cp .env.example .env  # add your API keys
npm install
npm run dev
```

## Deploying
Deploy as a long-running process (NOT a serverless function).
The backend maintains a persistent WebSocket connection to the platform.
Works on: Railway, Fly.io, Render, any VM/Docker host.
