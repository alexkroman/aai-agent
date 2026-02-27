// types.ts — Local type declarations for the voice agent platform.
// The platform client is loaded dynamically at runtime, so we declare
// the ToolContext type locally rather than importing from the platform.

/** Context object passed to every tool handler in the V8 sandbox. */
export interface ToolContext {
  secrets: Record<string, string>;
  fetch: (
    url: string,
    init?: RequestInit
  ) => {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    text: () => string;
    json: () => unknown;
  };
}
