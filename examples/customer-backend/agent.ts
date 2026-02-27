// agent.ts — the entire customer backend
//
// Edit the `tools` object to add/remove tools.
// Edit the config in ws.on("open") to change behavior, voice, greeting.
// Everything below "Connect to platform" never changes.

import { WebSocket } from "ws";

// ── Tools ───────────────────────────────────────────────────────────

const tools = {
  get_weather: {
    description: "Get current weather for a city",
    parameters: { city: "string" },
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
    parameters: { query: "string" },
    handler: async (args: { query: string }) => {
      const resp = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(args.query)}&format=json`
      );
      const data = await resp.json();
      return data.AbstractText || "No results found.";
    },
  },
};

// ── Connect to platform ─────────────────────────────────────────────

const ws = new WebSocket(process.env.PLATFORM_URL!, {
  headers: { Authorization: `Bearer ${process.env.API_KEY}` },
});

ws.on("open", () => {
  ws.send(
    JSON.stringify({
      type: "configure",
      instructions: "You are a helpful assistant. Be concise.",
      greeting: "Hey! What can I help you with?",
      voice: "jess",
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
    const tool = tools[msg.name as keyof typeof tools];
    let result: string;
    try {
      result = tool
        ? await tool.handler(msg.args)
        : `Unknown tool: ${msg.name}`;
    } catch (err) {
      result = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
    }
    ws.send(
      JSON.stringify({ type: "tool_result", callId: msg.callId, result })
    );
  }

  if (msg.type === "configured") {
    console.log(`Session: ${msg.sessionId}`);
    console.log(`Frontend URL: ${msg.frontendUrl}`);
  }

  if (msg.type === "error") {
    console.error(`Platform error: ${msg.message}`);
  }
});

ws.on("error", (err) => console.error("Connection error:", err));
ws.on("close", () => {
  console.log("Disconnected from platform");
  process.exit(0);
});
