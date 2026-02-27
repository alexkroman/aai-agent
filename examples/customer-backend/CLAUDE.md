# Voice Agent Backend

Only edit `agent.ts`. Never edit `run.ts`.

## agent.ts structure

```typescript
export const config = {
  instructions: "...",  // system prompt — tell the agent who it is
  greeting: "...",      // first thing spoken to the user
  voice: "jess",        // TTS voice
};

export const tools = {
  tool_name: {
    description: "What this tool does (the LLM reads this)",
    parameters: { param: { type: "string", description: "..." } },
    handler: async (args: { param: string }) => {
      // call APIs, query databases, etc.
      // return a string or any JSON-serializable value
      return result;
    },
  },
};
```

## Adding a tool

Add an entry to the `tools` object:

```typescript
  check_order: {
    description: "Look up the status of an order by order ID",
    parameters: {
      order_id: { type: "string", description: "The order ID" },
    },
    handler: async (args: { order_id: string }) => {
      const resp = await fetch(`https://api.example.com/orders/${args.order_id}`);
      return await resp.json();
    },
  },
```

## Parameter types

- Simple: `{ city: "string" }` or optional: `{ limit: "number?" }`
- With description: `{ city: { type: "string", description: "City name" } }`
- With enum: `{ status: { type: "string", enum: ["open", "closed"] } }`

## Handler return values

Return a string or any JSON-serializable value. Objects/arrays are
automatically stringified before being sent to the LLM.

## Running

```
npm run dev    # start with auto-reload
npm start      # start for production
```
