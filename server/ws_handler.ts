import { getLogger } from "../_utils/logger.ts";
import { ControlMessageSchema } from "./types.ts";

const log = getLogger("ws");

export interface Session {
  start(): void;
  stop(): Promise<void>;
  onAudioReady(): void;
  onAudio(data: Uint8Array): void;
  onCancel(): void;
  onReset(): void;
}

export interface WsSessionOptions {
  createSession: (sessionId: string, ws: WebSocket) => Session;
  logContext?: Record<string, string>;
  onOpen?: () => void;
  onClose?: () => void;
}

export function handleSessionWebSocket(
  ws: WebSocket,
  sessions: Map<string, Session>,
  opts: WsSessionOptions,
): void {
  const sessionId = crypto.randomUUID();
  const sid = sessionId.slice(0, 8);
  const ctx = opts.logContext ?? {};

  let session: Session | null = null;
  let ready = false;
  const pendingMessages: string[] = [];

  let processingChain: Promise<void> = Promise.resolve();

  function processControlMessage(raw: string): void {
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      return;
    }
    const parsed = ControlMessageSchema.safeParse(json);
    if (!parsed.success) return;

    if (parsed.data.type === "audio_ready") {
      session?.onAudioReady();
    } else if (parsed.data.type === "cancel") {
      session?.onCancel();
    } else if (parsed.data.type === "reset") {
      session?.onReset();
    }
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

    session = opts.createSession(sessionId, ws);
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
