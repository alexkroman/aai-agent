/// <reference lib="deno.unstable" />
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { loadSlots } from "./orchestrator.ts";
import { listAgents, setAgent } from "./kv_store.ts";

const VALID_ENV = {
  ASSEMBLYAI_API_KEY: "test-key",
  ASSEMBLYAI_TTS_API_KEY: "test-tts-key",
};

async function writeManifest(
  bundleDir: string,
  slug: string,
  env: Record<string, string> = VALID_ENV,
): Promise<void> {
  const dir = `${bundleDir}/${slug}`;
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(
    `${dir}/manifest.json`,
    JSON.stringify({ slug, env }),
  );
}

describe("loadSlots", () => {
  let bundleDir: string;
  let kv: Deno.Kv;

  beforeEach(async () => {
    bundleDir = await Deno.makeTempDir();
    kv = await Deno.openKv(":memory:");
  });

  afterEach(async () => {
    kv.close();
    await Deno.remove(bundleDir, { recursive: true });
  });

  it("returns empty map when KV and disk are both empty", async () => {
    const slots = await loadSlots(kv, bundleDir);
    expect(slots.size).toBe(0);
  });

  it("loads agent present in both KV and disk", async () => {
    await setAgent(kv, { slug: "hello", env: VALID_ENV });
    await writeManifest(bundleDir, "hello");

    const slots = await loadSlots(kv, bundleDir);
    expect(slots.has("hello")).toBe(true);
    expect(slots.get("hello")!.slug).toBe("hello");
  });

  it("skips KV agent missing from disk", async () => {
    await setAgent(kv, { slug: "ghost", env: VALID_ENV });

    const slots = await loadSlots(kv, bundleDir);
    expect(slots.has("ghost")).toBe(false);
  });

  it("backfills disk-only agent into KV", async () => {
    await writeManifest(bundleDir, "orphan");

    const slots = await loadSlots(kv, bundleDir);
    expect(slots.has("orphan")).toBe(true);

    const kvAgents = await listAgents(kv);
    expect(kvAgents.some((a) => a.slug === "orphan")).toBe(true);
  });

  it("does not duplicate agent already in KV when also on disk", async () => {
    await setAgent(kv, { slug: "both", env: VALID_ENV });
    await writeManifest(bundleDir, "both");

    const slots = await loadSlots(kv, bundleDir);
    expect(slots.size).toBe(1);
  });

  it("skips disk dirs without valid manifest", async () => {
    await Deno.mkdir(`${bundleDir}/bad`, { recursive: true });
    await Deno.writeTextFile(`${bundleDir}/bad/manifest.json`, "not json");

    const slots = await loadSlots(kv, bundleDir);
    expect(slots.has("bad")).toBe(false);
  });

  it("skips agents with invalid platform config", async () => {
    await writeManifest(bundleDir, "no-keys", {});

    const slots = await loadSlots(kv, bundleDir);
    expect(slots.has("no-keys")).toBe(false);
  });
});
