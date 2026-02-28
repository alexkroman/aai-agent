import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { z } from "zod";
import { Agent } from "../agent.ts";

describe("Agent", () => {
  const baseConfig = {
    name: "TestAgent",
    instructions: "You are a test agent.",
    greeting: "Hello!",
    voice: "jess",
  };

  it("stores config correctly", () => {
    const agent = new Agent(baseConfig);
    expect(agent.config.name).toBe("TestAgent");
    expect(agent.config.instructions).toBe("You are a test agent.");
    expect(agent.config.greeting).toBe("Hello!");
    expect(agent.config.voice).toBe("jess");
  });

  it("uses sensible defaults when optional fields omitted", () => {
    const agent = new Agent({ name: "Minimal" });
    expect(agent.config.name).toBe("Minimal");
    expect(agent.config.instructions.length).toBeGreaterThan(0);
    expect(agent.config.greeting.length).toBeGreaterThan(0);
    expect(agent.config.voice).toBe("jess");
  });

  it("stores optional config fields", () => {
    const agent = new Agent({
      ...baseConfig,
      prompt: "Transcribe accurately",
      builtinTools: ["web_search"],
    });
    expect(agent.config.prompt).toBe("Transcribe accurately");
    expect(agent.config.builtinTools).toEqual(["web_search"]);
  });

  it("starts with empty tools map", () => {
    const agent = new Agent(baseConfig);
    expect(agent.tools.size).toBe(0);
  });

  describe(".tool()", () => {
    it("registers a tool", () => {
      const agent = new Agent(baseConfig);
      agent.tool("greet", {
        description: "Greet someone",
        parameters: z.object({ name: z.string() }),
        handler: ({ name }) => `Hello, ${name}!`,
      });
      expect(agent.tools.size).toBe(1);
      expect(agent.tools.has("greet")).toBe(true);
    });

    it("is chainable", () => {
      const agent = new Agent(baseConfig);
      const result = agent.tool("a", {
        description: "A",
        parameters: z.object({}),
        handler: () => null,
      });
      expect(result).toBe(agent);
    });

    it("throws on duplicate tool name", () => {
      const agent = new Agent(baseConfig).tool("greet", {
        description: "Greet",
        parameters: z.object({ name: z.string() }),
        handler: ({ name }) => `Hello, ${name}!`,
      });
      expect(() =>
        agent.tool("greet", {
          description: "Greet again",
          parameters: z.object({ name: z.string() }),
          handler: ({ name }) => `Hi, ${name}!`,
        })
      ).toThrow('Tool "greet" is already registered');
    });

    it("registers multiple tools", () => {
      const agent = new Agent(baseConfig)
        .tool("a", {
          description: "A",
          parameters: z.object({}),
          handler: () => null,
        })
        .tool("b", {
          description: "B",
          parameters: z.object({ x: z.number() }),
          handler: () => null,
        });
      expect(agent.tools.size).toBe(2);
      expect(agent.tools.has("a")).toBe(true);
      expect(agent.tools.has("b")).toBe(true);
    });
  });

  describe("lifecycle hooks", () => {
    it("onConnect is chainable and stores handler", () => {
      const handler = () => {};
      const agent = new Agent(baseConfig).onConnect(handler);
      expect(agent.hooks.onConnect).toBe(handler);
    });

    it("onDisconnect is chainable and stores handler", () => {
      const handler = () => {};
      const agent = new Agent(baseConfig).onDisconnect(handler);
      expect(agent.hooks.onDisconnect).toBe(handler);
    });

    it("onError is chainable and stores handler", () => {
      const handler = () => {};
      const agent = new Agent(baseConfig).onError(handler);
      expect(agent.hooks.onError).toBe(handler);
    });

    it("onTurn is chainable and stores handler", () => {
      const handler = () => {};
      const agent = new Agent(baseConfig).onTurn(handler);
      expect(agent.hooks.onTurn).toBe(handler);
    });

    it("hooks can be chained together", () => {
      const agent = new Agent(baseConfig)
        .onConnect(() => {})
        .onDisconnect(() => {})
        .onError(() => {})
        .onTurn(() => {});
      expect(agent.hooks.onConnect).toBeDefined();
      expect(agent.hooks.onDisconnect).toBeDefined();
      expect(agent.hooks.onError).toBeDefined();
      expect(agent.hooks.onTurn).toBeDefined();
    });
  });

  describe("getToolHandlers()", () => {
    it("returns Map with schema and handler", () => {
      const handler = () => "result";
      const schema = z.object({ name: z.string() });
      const agent = new Agent(baseConfig).tool("greet", {
        description: "Greet",
        parameters: schema,
        handler,
      });

      const handlers = agent.getToolHandlers();
      expect(handlers.size).toBe(1);
      const toolHandler = handlers.get("greet");
      expect(toolHandler).toBeDefined();
      expect(toolHandler!.schema).toBe(schema);
      expect(toolHandler!.handler).toBe(handler);
    });

    it("returns empty map when no tools registered", () => {
      const agent = new Agent(baseConfig);
      const handlers = agent.getToolHandlers();
      expect(handlers.size).toBe(0);
    });
  });
});
