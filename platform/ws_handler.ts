import { getLogger } from "../sdk/logger.ts";
import type { AgentConfig } from "./types.ts";
import { ControlMessageSchema } from "./types.ts";
import { ServerSession } from "./session.ts";

const log = getLogger("ws");

export interface WsSessionOptions {
  createSession: (sessionId: string, ws: WebSocket) => {
    session: ServerSession;
    agentConfig: AgentConfig;
  };
  logContext?: Record<string, string>;
  onOpen?: () => void;
  onClose?: () => void;
}

export function handleSessionWebSocket(
  ws: WebSocket,
  sessions: Map<string, ServerSession>,
  opts: WsSessionOptions,
): void {
  const sessionId = crypto.randomUUID();
  const sid = sessionId.slice(0, 8);
  const ctx = opts.logContext ?? {};

  let session: ServerSession | null = null;
  let ready = false;
  const pendingMessages: string[] = [];

  let processingChain: Promise<void> = Promise.resolve();

  function processControlMessage(raw: string): Promise<void> {
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      return Promise.resolve();
    }
    const parsed = ControlMessageSchema.safeParse(json);
    if (!parsed.success) return Promise.resolve();

    if (parsed.data.type === "audio_ready") {
      session?.onAudioReady();
      return Promise.resolve();
    } else if (parsed.data.type === "cancel") {
      return Promise.resolve(session?.onCancel());
    } else if (parsed.data.type === "reset") {
      return Promise.resolve(session?.onReset());
    }
    return Promise.resolve();
  }

  function enqueueControl(raw: string): void {
    processingChain = processingChain
      .then(() => processControlMessage(raw))
      .catch((err) => {
        log.error("Control message processing error", {
          ...ctx,
          sid,
          error: err,
        });
      });
  }

  ws.onopen = () => {
    opts.onOpen?.();
    log.info("Session connected", { ...ctx, sid });

    const result = opts.createSession(sessionId, ws);
    session = result.session;
    sessions.set(sessionId, session);

    log.info("Session configured", { ...ctx, sid });
    session.start();

    for (const msg of pendingMessages) {
      enqueueControl(msg);
    }
    pendingMessages.length = 0;
    processingChain = processingChain.then(() => {
      ready = true;
    });
  };

  ws.onmessage = (event) => {
    const isBinary = event.data instanceof ArrayBuffer ||
      event.data instanceof Blob;

    if (!ready) {
      if (!isBinary) {
        try {
          const json = JSON.parse(event.data as string);
          if (json.type === "ping") {
            ws.send(JSON.stringify({ type: "pong" }));
            return;
          }
        } catch {
          // ignore parse errors
        }
        pendingMessages.push(event.data as string);
      }
      return;
    }

    if (isBinary) {
      if (event.data instanceof ArrayBuffer) {
        session?.onAudio(new Uint8Array(event.data));
      } else if (event.data instanceof Blob) {
        event.data.arrayBuffer().then((buf) => {
          session?.onAudio(new Uint8Array(buf));
        }).catch((err) => {
          log.warn("Failed to read Blob audio", { ...ctx, sid, error: err });
        });
      }
      return;
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(event.data as string);
    } catch {
      log.warn("Unparseable JSON from client", { ...ctx, sid });
      return;
    }

    if (data.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
      return;
    }

    enqueueControl(event.data as string);
  };

  ws.onclose = async () => {
    log.info("Session disconnected", { ...ctx, sid });
    if (session) {
      await session.stop();
      sessions.delete(sessionId);
    }
    opts.onClose?.();
  };

  ws.onerror = (event) => {
    const msg = event instanceof ErrorEvent ? event.message : "WebSocket error";
    log.error("WebSocket error", { ...ctx, sid, error: msg });
  };
}
