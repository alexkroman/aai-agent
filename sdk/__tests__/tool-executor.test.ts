import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { z } from "zod";
import { executeToolCall, ToolExecutor } from "../tool-executor.ts";
import type { ToolHandler } from "../tool-executor.ts";

function makeTools(
  ...entries: [string, ToolHandler][]
): Map<string, ToolHandler> {
  return new Map(entries);
}

describe("ToolExecutor", () => {
  const emptySecrets = {};

  it("executes a valid tool with valid args", async () => {
    const tools = makeTools(["greet", {
      schema: z.object({ name: z.string() }),
      handler: ({ name }) => `Hello, ${name}!`,
    }]);
    const executor = new ToolExecutor(tools, emptySecrets);
    const result = await executor.execute("greet", { name: "World" });
    expect(result).toBe("Hello, World!");
  });

  it("returns error for unknown tool", async () => {
    const executor = new ToolExecutor(new Map(), emptySecrets);
    const result = await executor.execute("nonexistent", {});
    expect(result).toContain("Error");
    expect(result).toContain("nonexistent");
  });

  it("returns error for invalid args (Zod failure)", async () => {
    const tools = makeTools(["greet", {
      schema: z.object({ name: z.string() }),
      handler: () => "hi",
    }]);
    const executor = new ToolExecutor(tools, emptySecrets);
    const result = await executor.execute("greet", { name: 123 });
    expect(result).toContain("Error");
    expect(result).toContain("Invalid arguments");
  });

  it("returns error when handler throws", async () => {
    const tools = makeTools(["fail", {
      schema: z.object({}),
      handler: () => {
        throw new Error("boom");
      },
    }]);
    const executor = new ToolExecutor(tools, emptySecrets);
    const result = await executor.execute("fail", {});
    expect(result).toContain("Error");
    expect(result).toContain("boom");
  });

  it("returns 'null' when handler returns null", async () => {
    const tools = makeTools(["nullTool", {
      schema: z.object({}),
      handler: () => null,
    }]);
    const executor = new ToolExecutor(tools, emptySecrets);
    const result = await executor.execute("nullTool", {});
    expect(result).toBe("null");
  });

  it("returns 'null' when handler returns undefined", async () => {
    const tools = makeTools(["undefinedTool", {
      schema: z.object({}),
      handler: () => undefined,
    }]);
    const executor = new ToolExecutor(tools, emptySecrets);
    const result = await executor.execute("undefinedTool", {});
    expect(result).toBe("null");
  });

  it("returns JSON string when handler returns object", async () => {
    const tools = makeTools(["obj", {
      schema: z.object({}),
      handler: () => ({ key: "value" }),
    }]);
    const executor = new ToolExecutor(tools, emptySecrets);
    const result = await executor.execute("obj", {});
    expect(JSON.parse(result)).toEqual({ key: "value" });
  });

  it("passes ctx with secrets and fetch to handler", async () => {
    let capturedCtx: Record<string, unknown> = {};
    const tools = makeTools(["capture", {
      schema: z.object({}),
      handler: (_args, ctx) => {
        capturedCtx = { secrets: ctx.secrets, hasFetch: !!ctx.fetch };
        return "ok";
      },
    }]);
    const executor = new ToolExecutor(tools, { API_KEY: "secret" });
    await executor.execute("capture", {});
    expect(capturedCtx.secrets).toEqual({ API_KEY: "secret" });
    expect(capturedCtx.hasFetch).toBe(true);
  });

  it("dispose does not throw", () => {
    const executor = new ToolExecutor(new Map(), emptySecrets);
    expect(() => executor.dispose()).not.toThrow();
  });
});

describe("executeToolCall", () => {
  it("validates and executes with parsed data", async () => {
    const tool: ToolHandler = {
      schema: z.object({ name: z.string() }),
      handler: ({ name }) => `Hello, ${name}!`,
    };
    const result = await executeToolCall("greet", { name: "World" }, tool, {});
    expect(result).toBe("Hello, World!");
  });

  it("applies Zod defaults from schema", async () => {
    const tool: ToolHandler = {
      schema: z.object({ count: z.number().default(5) }),
      handler: ({ count }) => `count=${count}`,
    };
    const result = await executeToolCall("counter", {}, tool, {});
    expect(result).toBe("count=5");
  });

  it("returns validation error for invalid args", async () => {
    const tool: ToolHandler = {
      schema: z.object({ name: z.string() }),
      handler: () => "ok",
    };
    const result = await executeToolCall("greet", { name: 123 }, tool, {});
    expect(result).toContain("Error");
    expect(result).toContain("Invalid arguments");
  });

  it("serializes object results to JSON", async () => {
    const tool: ToolHandler = {
      schema: z.object({}),
      handler: () => ({ key: "value" }),
    };
    const result = await executeToolCall("obj", {}, tool, {});
    expect(JSON.parse(result)).toEqual({ key: "value" });
  });

  it("returns 'null' for null/undefined results", async () => {
    const tool: ToolHandler = {
      schema: z.object({}),
      handler: () => null,
    };
    const result = await executeToolCall("noop", {}, tool, {});
    expect(result).toBe("null");
  });

  it("returns error string when handler throws", async () => {
    const tool: ToolHandler = {
      schema: z.object({}),
      handler: () => {
        throw new Error("boom");
      },
    };
    const result = await executeToolCall("fail", {}, tool, {});
    expect(result).toContain("Error");
    expect(result).toContain("boom");
  });
});
