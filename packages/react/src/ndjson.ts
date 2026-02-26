/**
 * Async generator that yields parsed JSON objects from an NDJSON response stream.
 */
export async function* parseNDJSON(resp: Response): AsyncGenerator<unknown> {
  if (!resp.body) return;
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line) as unknown;
    }
  }
  if (buf.trim()) yield JSON.parse(buf) as unknown;
}
