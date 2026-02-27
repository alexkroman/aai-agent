# Voice Agent Backend

## Adding a tool
Edit `agent.ts` and add an entry to the `tools` object. Each tool has:
- `description`: what the tool does (the LLM sees this)
- `parameters`: object mapping param names to types ("string", "number", "boolean", append "?" for optional)
- `handler`: async function that takes the parsed args and returns a string

## Changing the agent's behavior
Edit the config object inside `ws.on("open")` in `agent.ts`:
- `instructions`: system prompt
- `greeting`: first message spoken to the user
- `voice`: TTS voice name

## Running
```
cp .env.example .env  # add your API keys
npm install
npm run dev
```
