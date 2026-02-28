import { toFileUrl } from "@std/path";
import * as Comlink from "comlink";
import { loadPlatformConfig, type PlatformConfig } from "./config.ts";
import { createLogger } from "../sdk/logger.ts";
import { getBuiltinToolSchemas } from "./builtin_tools.ts";
import { deadline } from "@std/async/deadline";
import type { IToolExecutor } from "./tool_executor.ts";
import type { AgentConfig } from "../sdk/types.ts";
import type { ToolSchema } from "./types.ts";
import type { WorkerApi } from "./worker_entry.ts";
import type { AgentMetadata } from "./kv_store.ts";

const log = createLogger("worker-pool");

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const TOOL_TIMEOUT_MS = 30_000;

export interface AgentInfo {
  slug: string;
  name: string;
  worker: Worker;
  workerApi: Comlink.Remote<WorkerApi>;
  config: AgentConfig;
  toolSchemas: ToolSchema[];
}

export interface AgentSlot {
  slug: string;
  env: Record<string, string>;
  platformConfig: PlatformConfig;
  live?: AgentInfo;
  initializing?: Promise<AgentInfo>;
  activeSessions: number;
  idleTimer?: ReturnType<typeof setTimeout>;
}

export class ComlinkToolExecutor implements IToolExecutor {
  constructor(private workerApi: Comlink.Remote<WorkerApi>) {}

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    try {
      return await deadline(
        this.workerApi.executeTool(name, args),
        TOOL_TIMEOUT_MS,
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        throw new Error(`Tool "${name}" timed out after 30s`);
      }
      throw err;
    }
  }

  dispose(): void {}
}

export async function spawnAgent(
  slot: AgentSlot,
  bundleDir: string,
): Promise<AgentInfo> {
  const { slug } = slot;
  const workerPath = `${bundleDir}/${slug}/worker.js`;

  log.info({ slug }, "Spawning agent worker");

  // deno-lint-ignore no-explicit-any
  const worker = new (Worker as any)(toFileUrl(workerPath).href, {
    type: "module",
    name: slug,
    deno: {
      permissions: {
        net: true,
        read: false,
        env: false,
        run: false,
        write: false,
        ffi: false,
      },
    },
  });

  worker.addEventListener(
    "error",
    ((event: ErrorEvent) => {
      log.error({ slug, error: event.message }, "Worker error");
      if (slot.live?.worker === worker) slot.live = undefined;
    }) as EventListener,
  );

  const workerApi = Comlink.wrap<WorkerApi>(worker);

  let info;
  try {
    info = await deadline(
      workerApi.getConfig(),
      15_000,
    );
  } catch (err) {
    worker.terminate();
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error(`Worker ${slug} ready timed out`);
    }
    throw err;
  }

  const agentConfig: AgentConfig = {
    instructions: info.config.instructions,
    greeting: info.config.greeting,
    voice: info.config.voice,
    prompt: info.config.prompt,
    builtinTools: info.config.builtinTools,
  };

  const allToolSchemas = [
    ...info.toolSchemas,
    ...getBuiltinToolSchemas(agentConfig.builtinTools ?? []),
  ];

  const agentInfo: AgentInfo = {
    slug,
    name: info.config.name ?? slug,
    worker,
    workerApi,
    config: agentConfig,
    toolSchemas: allToolSchemas,
  };
  log.info({ slug, name: agentInfo.name }, "Agent loaded");
  return agentInfo;
}

export function ensureAgent(
  slot: AgentSlot,
  bundleDir: string,
): Promise<AgentInfo> {
  if (slot.live) return Promise.resolve(slot.live);
  if (slot.initializing) return slot.initializing;

  slot.initializing = spawnAgent(slot, bundleDir).then((info) => {
    slot.live = info;
    slot.initializing = undefined;
    return info;
  }).catch((err) => {
    slot.initializing = undefined;
    throw err;
  });

  return slot.initializing;
}

export function trackSessionOpen(slot: AgentSlot): void {
  slot.activeSessions++;
  if (slot.idleTimer) {
    clearTimeout(slot.idleTimer);
    slot.idleTimer = undefined;
  }
}

export function trackSessionClose(
  slot: AgentSlot,
  agents: AgentInfo[],
): void {
  slot.activeSessions = Math.max(0, slot.activeSessions - 1);
  if (slot.activeSessions === 0 && slot.live) {
    slot.idleTimer = setTimeout(() => {
      if (slot.activeSessions === 0 && slot.live) {
        log.info({ slug: slot.slug }, "Evicting idle agent Worker");
        slot.live.worker.terminate();
        const idx = agents.indexOf(slot.live);
        if (idx !== -1) agents.splice(idx, 1);
        slot.live = undefined;
        slot.idleTimer = undefined;
      }
    }, IDLE_TIMEOUT_MS);
  }
}

export function registerSlot(
  slots: Map<string, AgentSlot>,
  metadata: AgentMetadata,
): boolean {
  let platformConfig;
  try {
    platformConfig = loadPlatformConfig(metadata.env);
  } catch (err) {
    log.warn(
      { slug: metadata.slug, err },
      "Skipping deploy — missing platform config",
    );
    return false;
  }

  slots.set(metadata.slug, {
    slug: metadata.slug,
    env: metadata.env,
    platformConfig,
    activeSessions: 0,
  });
  return true;
}
