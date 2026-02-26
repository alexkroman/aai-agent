/**
 * Shared WebSocket helpers used by both STT and TTS hooks.
 */

/** Convert a relative or HTTP URL to a WebSocket URL. */
export function toWsUrl(url: string): string {
  if (url.startsWith("ws://") || url.startsWith("wss://")) return url;
  if (url.startsWith("http")) return url.replace(/^http/, "ws");
  const u = new URL(url, window.location.href);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.href;
}

export interface OpenWSHandlers {
  onMessage?: (evt: MessageEvent) => void;
  onClose?: () => void;
}

/**
 * Open a WebSocket connection. Resolves once the socket is open.
 * Both STT and TTS use this as their connection primitive.
 */
export function openWebSocket(
  url: string,
  handlers: OpenWSHandlers = {},
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(toWsUrl(url));
    ws.binaryType = "arraybuffer";
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(e);
    if (handlers.onMessage) ws.onmessage = handlers.onMessage;
    if (handlers.onClose) ws.onclose = handlers.onClose;
  });
}

/** Cleanly close a WebSocket, suppressing the onclose callback. */
export function closeWebSocket(ws: WebSocket | null): void {
  if (!ws) return;
  ws.onclose = null;
  ws.close();
}
