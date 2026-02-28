// ws-handler.ts — Shared WebSocket session handler used by both
// sdk/server.ts (standalone) and platform/orchestrator.ts (multi-agent).

import { MSG } from "./shared-protocol.ts";
import { createLogger } from "./logger.ts";
import { type AgentConfig, ControlMessageSchema } from "./types.ts";
import { VoiceSession } from "./session.ts";

const log = createLogger("ws");

/** Options for handleSessionWebSocket. */
export interface WsSessionOptions {
  /** Build the VoiceSession — called once on ws.onopen. */
  createSession: (sessionId: string, ws: WebSocket) => {
    session: VoiceSession;
    agentConfig: AgentConfig;
  };
  /** Extra log context (e.g. { slug }) merged into every log call. */
  logContext?: Record<string, string>;
  /** Called on open for session tracking. */
  onOpen?: () => void;
  /** Called on close for session tracking. */
  onClose?: () => void;
}

/**
 * Handle a WebSocket connection for a voice session.
 *
 * Contains all shared logic: sessionId generation, message queuing before
 * ready, ping/pong, binary audio dispatch, control message parsing,
 * close/error logging.
 */
export function handleSessionWebSocket(
  ws: WebSocket,
  sessions: Map<string, VoiceSession>,
  opts: WsSessionOptions,
): void {
  const sessionId = crypto.randomUUID();
  const sid = sessionId.slice(0, 8);
  const ctx = opts.logContext ?? {};

  let session: VoiceSession | null = null;
  let ready = false;
  const pendingMessages: string[] = [];

  // Sequential promise chain ensures control messages are processed in order.
  // All control messages (replay and live) go through this chain so that an
  // awaiting handler (e.g. onCancel/onReset) finishes before the next starts.
  let processingChain: Promise<void> = Promise.resolve();

  /** Process a single control message. Must be called through processingChain. */
  function processControlMessage(raw: string): Promise<void> {
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      return Promise.resolve();
    }
    const parsed = ControlMessageSchema.safeParse(json);
    if (!parsed.success) return Promise.resolve();

    if (parsed.data.type === MSG.AUDIO_READY) {
      session?.onAudioReady();
      return Promise.resolve();
    } else if (parsed.data.type === MSG.CANCEL) {
      return Promise.resolve(session?.onCancel());
    } else if (parsed.data.type === MSG.RESET) {
      return Promise.resolve(session?.onReset());
    }
    return Promise.resolve();
  }

  /** Enqueue a control message onto the sequential processing chain. */
  function enqueueControl(raw: string): void {
    processingChain = processingChain.then(() => processControlMessage(raw));
    processingChain.catch((err) => {
      log.error(
        { ...ctx, sid, error: err },
        "Control message processing error",
      );
    });
  }

  ws.onopen = () => {
    opts.onOpen?.();
    log.info({ ...ctx, sid }, "Session connected");

    const result = opts.createSession(sessionId, ws);
    session = result.session;
    sessions.set(sessionId, session);

    log.info({ ...ctx, sid }, "Session configured");

    session.start();

    // Replay any messages that arrived before the session was ready,
    // then set ready=true. All replay goes through the chain so new
    // messages arriving mid-replay are sequenced after them.
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

    // Queue messages until session is ready
    if (!ready) {
      if (!isBinary) {
        // Check for ping even before ready
        try {
          const json = JSON.parse(event.data as string);
          if (json.type === MSG.PING) {
            ws.send(JSON.stringify({ type: MSG.PONG }));
            return;
          }
        } catch {
          // ignore parse errors
        }
        pendingMessages.push(event.data as string);
      }
      return;
    }

    // Binary audio — fast path, no queuing needed
    if (isBinary) {
      if (event.data instanceof ArrayBuffer) {
        session?.onAudio(new Uint8Array(event.data));
      } else if (event.data instanceof Blob) {
        event.data.arrayBuffer().then((buf) => {
          session?.onAudio(new Uint8Array(buf));
        }).catch((err) => {
          log.warn({ ...ctx, sid, error: err }, "Failed to read Blob audio");
        });
      }
      return;
    }

    // JSON frame
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(event.data as string);
    } catch {
      log.warn({ ...ctx, sid }, "Unparseable JSON from client");
      return;
    }

    // Handle ping → pong (fast path)
    if (data.type === MSG.PING) {
      ws.send(JSON.stringify({ type: MSG.PONG }));
      return;
    }

    // Control commands — sequenced through the processing chain
    enqueueControl(event.data as string);
  };

  ws.onclose = async () => {
    log.info({ ...ctx, sid }, "Session disconnected");
    if (session) {
      await session.stop();
      sessions.delete(sessionId);
    }
    opts.onClose?.();
  };

  ws.onerror = (event) => {
    const msg = event instanceof ErrorEvent ? event.message : "WebSocket error";
    log.error({ ...ctx, sid, error: msg }, "WebSocket error");
  };
}
