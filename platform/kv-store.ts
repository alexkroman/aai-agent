/// <reference lib="deno.unstable" />
// kv-store.ts — Deno KV access layer for agent slot metadata.
// Stores deployed agent info so the orchestrator can restore state across restarts.

/** Metadata stored in KV for each deployed agent. */
export interface AgentMetadata {
  slug: string;
  env: Record<string, string>;
}

let cachedKv: Deno.Kv | null = null;

/** Open (or return cached) Deno KV instance. */
export async function openKv(): Promise<Deno.Kv> {
  if (!cachedKv) {
    cachedKv = await Deno.openKv();
  }
  return cachedKv;
}

/** Close the cached KV instance (for graceful shutdown). */
export function closeKv(): void {
  cachedKv?.close();
  cachedKv = null;
}

/** List all agents stored in KV under ["agents", slug]. */
export async function listAgents(kv: Deno.Kv): Promise<AgentMetadata[]> {
  const agents: AgentMetadata[] = [];
  for await (const entry of kv.list<AgentMetadata>({ prefix: ["agents"] })) {
    agents.push(entry.value);
  }
  return agents;
}

/** Upsert an agent's metadata in KV. */
export async function setAgent(
  kv: Deno.Kv,
  metadata: AgentMetadata,
): Promise<void> {
  await kv.set(["agents", metadata.slug], metadata);
}
