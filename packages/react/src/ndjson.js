/**
 * Async generator that yields parsed JSON objects from an NDJSON response stream.
 * Replaces manual chunk buffering / string splitting.
 *
 * @param {Response} resp  Fetch response with NDJSON body
 * @yields {object} Parsed JSON message
 */
export async function* parseNDJSON(resp) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line);
    }
  }
  if (buf.trim()) yield JSON.parse(buf);
}
