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
  } catch { /* use default */ }

  return {
    slug: env.SLUG,
    dir,
    entryPoint: `${dir}/agent.ts`,
    env,
    clientEntry,
  };
}

// If INIT_CWD is inside examples/<name>/, returns just that agent.
// Otherwise scans examples/ and returns all.
export async function discoverAgents(): Promise<AgentEntry[]> {
  const initCwd = Deno.env.get("INIT_CWD");

  if (initCwd) {
    const examplesAbsolute = Deno.cwd() + "/examples";
    const rel = relative(examplesAbsolute, initCwd);
    // rel looks like "night-owl" or "night-owl/src" — not ".." or absolute
    if (rel && !rel.startsWith("..") && !rel.startsWith("/")) {
      const dir = `examples/${rel.split("/")[0]}`;
      const agent = await loadAgent(dir);
      if (agent) return [agent];
      console.warn(
        `  In ${dir} but no agent.ts + .env with SLUG found, scanning all.`,
      );
    }
  }

  const examples: AgentEntry[] = [];
  for await (
    const entry of walk("examples", {
      maxDepth: 2,
      includeDirs: false,
      match: [/agent\.ts$/],
    })
  ) {
    const dir = entry.path.replace(/\/agent\.ts$/, "");
    const agent = await loadAgent(dir);
    if (agent) examples.push(agent);
    else console.warn(`  Skipping ${dir} — no agent.ts or SLUG`);
  }
  examples.sort((a, b) => a.slug.localeCompare(b.slug));
  return examples;
}
