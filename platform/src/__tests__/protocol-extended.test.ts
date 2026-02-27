import { describe, it, expect } from "vitest";
import { toJsonSchema, toolDefsToSchemas } from "../protocol.js";

describe("toJsonSchema — edge cases", () => {
  it("handles boolean type", () => {
    const result = toJsonSchema({ active: "boolean" });
    expect(result).toEqual({
      type: "object",
      properties: { active: { type: "boolean" } },
      required: ["active"],
    });
  });

  it("handles optional boolean", () => {
    const result = toJsonSchema({ verbose: "boolean?" });
    expect(result).toEqual({
      type: "object",
      properties: { verbose: { type: "boolean" } },
      required: [],
    });
  });

  it("handles empty parameters object", () => {
    const result = toJsonSchema({});
    expect(result).toEqual({
      type: "object",
      properties: {},
      required: [],
    });
  });

  it("handles multiple parameters with mixed required/optional", () => {
    const result = toJsonSchema({
      name: "string",
      age: "number?",
      email: { type: "string", description: "Email address" },
      active: "boolean?",
    });
    expect(result).toEqual({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
        email: { type: "string", description: "Email address" },
        active: { type: "boolean" },
      },
      required: ["name", "email"],
    });
  });

  it("preserves enum in extended format", () => {
    const result = toJsonSchema({
      color: { type: "string", enum: ["red", "green", "blue"] },
    });
    expect(result).toEqual({
      type: "object",
      properties: {
        color: { type: "string", enum: ["red", "green", "blue"] },
      },
      required: ["color"],
    });
  });

  it("passes through complex raw JSON Schema", () => {
    const raw = {
      type: "object",
      properties: {
        address: {
          type: "object",
          properties: {
            street: { type: "string" },
            city: { type: "string" },
            zip: { type: "string" },
          },
          required: ["street", "city"],
        },
      },
      required: ["address"],
    };
    expect(toJsonSchema(raw)).toEqual(raw);
  });

  it("detects raw JSON Schema by root-level type", () => {
    const raw = { type: "object", properties: { x: { type: "number" } } };
    // Should return as-is because "type" exists at root
    expect(toJsonSchema(raw)).toEqual(raw);
  });

  it("does not treat extended format with type key as raw schema", () => {
    // This has "type" at the value level, not root level
    const result = toJsonSchema({
      status: { type: "string", enum: ["a", "b"] },
    });
    // Should be converted, not passed through
    expect(result).toEqual({
      type: "object",
      properties: { status: { type: "string", enum: ["a", "b"] } },
      required: ["status"],
    });
  });
});

describe("toolDefsToSchemas — multiple tools", () => {
  it("converts multiple tool definitions", () => {
    const schemas = toolDefsToSchemas([
      {
        name: "tool_a",
        description: "Tool A",
        parameters: { x: "string" },
        handler: "async () => {}",
      },
      {
        name: "tool_b",
        description: "Tool B",
        parameters: {
          y: "number?",
          z: { type: "boolean", description: "Flag" },
        },
        handler: "async () => {}",
      },
    ]);

    expect(schemas).toHaveLength(2);
    expect(schemas[0]).toEqual({
      name: "tool_a",
      description: "Tool A",
      parameters: {
        type: "object",
        properties: { x: { type: "string" } },
        required: ["x"],
      },
    });
    expect(schemas[1]).toEqual({
      name: "tool_b",
      description: "Tool B",
      parameters: {
        type: "object",
        properties: {
          y: { type: "number" },
          z: { type: "boolean", description: "Flag" },
        },
        required: ["z"],
      },
    });
  });

  it("handles empty tool list", () => {
    expect(toolDefsToSchemas([])).toEqual([]);
  });
});
