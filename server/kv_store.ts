/// <reference lib="deno.unstable" />

export interface AgentMetadata {
  slug: string;
  env: Record<string, string>;
}

let cachedKv: Deno.Kv | null = null;

export async function openKv(): Promise<Deno.Kv> {
  if (!cachedKv) {
    const path = Deno.env.get("AAI_DEV") === "1" ? ":memory:" : undefined;
    cachedKv = await Deno.openKv(path);
  }
  return cachedKv;
}

export function closeKv(): void {
  cachedKv?.close();
  cachedKv = null;
}

export async function listAgents(kv: Deno.Kv): Promise<AgentMetadata[]> {
  const agents: AgentMetadata[] = [];
  for await (const entry of kv.list<AgentMetadata>({ prefix: ["agents"] })) {
    agents.push(entry.value);
  }
  return agents;
}

export async function setAgent(
  kv: Deno.Kv,
  metadata: AgentMetadata,
): Promise<void> {
  await kv.set(["agents", metadata.slug], metadata);
}
