import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import agent from "../agent.ts";

describe("web-researcher agent", () => {
  it("has correct config", () => {
    expect(agent.config.name).toBe("Scout");
    expect(agent.config.voice).toBe("tara");
    expect(agent.config.builtinTools).toEqual(["web_search", "visit_webpage"]);
  });

  it("has no custom tools", () => {
    expect(agent.tools.size).toBe(0);
  });
});
