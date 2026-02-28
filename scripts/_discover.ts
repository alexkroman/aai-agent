// _discover.ts — Shared agent discovery logic for scripts.
// If INIT_CWD (set by `deno task`) is inside an agent directory,
// returns only that agent. Otherwise returns all agents.

import { parse as parseDotenv } from "@std/dotenv/parse";
import { relative } from "@std/path";
import { walk } from "@std/fs/walk";

export interface AgentEntry {
  slug: string;
  dir: string;
  entryPoint: string;
  env: Record<string, string>;
  clientEntry: string;
}

/** Try to load a single agent from a directory. */
async function loadAgent(dir: string): Promise<AgentEntry | null> {
  try {
    await Deno.stat(`${dir}/agent.ts`);
  } catch {
    return null;
  }

  const envText = await Deno.readTextFile(`${dir}/.env`).catch(() => "");
  const env = parseDotenv(envText);
  if (!env.SLUG) return null;

  let clientEntry = "ui/client.tsx";
  try {
    await Deno.stat(`${dir}/client.tsx`);
    clientEntry = `${dir}/client.tsx`;
  } catch {
    // default
  }

  return {
    slug: env.SLUG,
    dir,
    entryPoint: `${dir}/agent.ts`,
    env,
    clientEntry,
  };
}

/**
 * Discover agents to operate on.
 * - If INIT_CWD is inside agents/<name>/, return just that agent.
 * - Otherwise, scan agents/ and return all.
 */
export async function discoverAgents(): Promise<AgentEntry[]> {
  const initCwd = Deno.env.get("INIT_CWD");

  // Check if the caller is inside an agent directory
  if (initCwd) {
    const agentsAbsolute = Deno.cwd() + "/agents";
    const rel = relative(agentsAbsolute, initCwd);
    // rel looks like "night-owl" or "night-owl/src" — not ".." or absolute
    if (rel && !rel.startsWith("..") && !rel.startsWith("/")) {
      const agentName = rel.split("/")[0];
      const dir = `agents/${agentName}`;
      const agent = await loadAgent(dir);
      if (agent) return [agent];
      console.warn(
        `  In ${dir} but no agent.ts + .env with SLUG found, scanning all.`,
      );
    }
  }

  // Scan all agent directories
  const agents: AgentEntry[] = [];
  for await (
    const entry of walk("agents", {
      maxDepth: 2,
      includeDirs: false,
      match: [/agent\.ts$/],
    })
  ) {
    const dir = entry.path.replace(/\/agent\.ts$/, "");
    const agent = await loadAgent(dir);
    if (agent) {
      agents.push(agent);
    } else {
      console.warn(`  Skipping ${dir} — no agent.ts or SLUG`);
    }
  }
  agents.sort((a, b) => a.slug.localeCompare(b.slug));
  return agents;
}
