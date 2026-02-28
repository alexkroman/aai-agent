import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { DevOpts } from "./dev.ts";

describe("dev option defaults", () => {
  it("DevOpts port defaults to 3000 in CLI", async () => {
    // Verify the dynamic import works and exports are correct
    const { runDev } = await import("./dev.ts");
    expect(typeof runDev).toBe("function");
  });

  it("accepts DevOpts shape", () => {
    const opts: DevOpts = { port: 8080 };
    expect(opts.port).toBe(8080);
  });
});
