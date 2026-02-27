// agent.ts — the entire customer backend
//
// Edit `config` to change the agent's behavior, voice, greeting.
// Edit `tools` to add/remove tools.
// Everything below "Platform connection" never changes.

import { WebSocket } from "ws";

// ── Agent config ────────────────────────────────────────────────────

const config = {
  instructions: "You are a helpful assistant. Be concise.",
  greeting: "Hey! What can I help you with?",
  voice: "jess",
};

// ── Tools ───────────────────────────────────────────────────────────

const tools = {
  get_weather: {
    description: "Get current weather for a city",
    parameters: { city: { type: "string", description: "City name" } },
    handler: async (args: { city: string }) => {
      const resp = await fetch(
        `https://api.weather.com/current?city=${encodeURIComponent(args.city)}`
      );
      const data = await resp.json();
      return `${data.temp}°F and ${data.conditions} in ${args.city}`;
    },
  },

  search_web: {
    description: "Search the web for information",
    parameters: { query: { type: "string", description: "Search query" } },
    handler: async (args: { query: string }) => {
      const resp = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(args.query)}&format=json`
      );
      const data = await resp.json();
      return data.AbstractText || "No results found.";
    },
  },
};

// ── Platform connection (reconnects automatically) ──────────────────

const pendingCalls = new Map<string, AbortController>();

function connect() {
  const ws = new WebSocket(process.env.PLATFORM_URL!, {
    headers: { Authorization: `Bearer ${process.env.API_KEY}` },
  });

  let reconnectDelay = 1000;

  ws.on("open", () => {
    reconnectDelay = 1000;
    ws.send(
      JSON.stringify({
        type: "configure",
        ...config,
        tools: Object.entries(tools).map(([name, t]) => ({
          name,
          description: t.description,
          parameters: t.parameters,
        })),
      })
    );
  });

  ws.on("message", async (raw) => {
    const msg = JSON.parse(raw.toString());

    if (msg.type === "tool_call") {
      const abort = new AbortController();
      pendingCalls.set(msg.callId, abort);
      let result: string;
      try {
        const tool = tools[msg.name as keyof typeof tools];
        if (!tool) throw new Error(`Unknown tool: ${msg.name}`);
        result = await tool.handler(msg.args);
      } catch (err) {
        result = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
      pendingCalls.delete(msg.callId);
      if (!abort.signal.aborted) {
        ws.send(
          JSON.stringify({
            type: "tool_result",
            callId: msg.callId,
            sessionId: msg.sessionId,
            result,
          })
        );
      }
    }

    if (msg.type === "tool_timeout") {
      pendingCalls.get(msg.callId)?.abort();
      pendingCalls.delete(msg.callId);
    }

    if (msg.type === "configured") {
      console.log(`Agent ready. ID: ${msg.agentId}`);
    }

    if (msg.type === "session_started") {
      console.log(`Session started: ${msg.sessionId}`);
    }

    if (msg.type === "session_ended") {
      console.log(`Session ended: ${msg.sessionId}`);
    }

    if (msg.type === "error") {
      console.error(`Error: ${msg.message}`);
    }
  });

  ws.on("close", () => {
    console.log(`Disconnected. Reconnecting in ${reconnectDelay}ms...`);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  });

  ws.on("error", (err) => console.error("Connection error:", err.message));
}

connect();
