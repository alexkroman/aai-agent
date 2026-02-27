// run.ts — Platform connection. Do not edit.
// Connects to the platform, sends config, dispatches tool calls.
// Edit agent.ts instead.

import { WebSocket } from "ws";
import { config, tools } from "./agent";

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
      let result: unknown;
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
            result: typeof result === "string" ? result : JSON.stringify(result),
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
      console.log(`Default UI: ${msg.defaultUrl}`);
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
