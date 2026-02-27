# Voice Agent — React Example

Customer support agent for TechStore with order lookup, inventory, returns, and escalation.

## Running locally

```bash
# Terminal 1: Start the platform server (serves client bundles + handles WebSocket)
cd platform && npm run dev:serve

# Terminal 2: Start the React frontend
cd examples/react && npm install && npm run dev
```

Open http://localhost:5173 in your browser.

## Editing

Only edit `src/agent.ts` and `src/App.tsx`.

### Adding a tool
Edit `src/agent.ts`, add an entry to the `tools` object:
- `description`: what the tool does (the LLM reads this)
- `parameters`: { paramName: { type: "string", description: "..." } }
- `handler`: async function receiving (args, ctx)
  - ctx.secrets: key-value store from platform dashboard
  - ctx.fetch: HTTP fetch with no CORS restrictions
  - Return any value (string, object, array)
  - Must be self-contained — no imports, no closures

### Changing the agent's behavior
Edit `config` in `src/agent.ts`.

### Changing the UI
Edit `src/App.tsx`.
