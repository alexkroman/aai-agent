export class HttpError extends Error {
  constructor(public status: number, statusText: string) {
    super(`${status} ${statusText}`);
    this.name = "HttpError";
  }
}

export async function fetchJSON(
  fetch: typeof globalThis.fetch,
  url: string,
  init?: RequestInit,
): Promise<unknown> {
  const resp = await fetch(url, init);
  if (!resp.ok) throw new HttpError(resp.status, resp.statusText);
  return resp.json();
}
