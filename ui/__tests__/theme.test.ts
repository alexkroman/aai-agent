import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { applyTheme, darkTheme, defaultTheme, type Theme } from "../theme.ts";
import type { AgentState } from "../types.ts";

const ALL_STATES: AgentState[] = [
  "connecting",
  "ready",
  "listening",
  "thinking",
  "speaking",
  "error",
];

const THEME_KEYS: (keyof Omit<Theme, "stateColors">)[] = [
  "bg",
  "surface",
  "surfaceLight",
  "primary",
  "text",
  "textMuted",
  "error",
  "font",
  "radius",
];

function assertValidTheme(theme: Theme, name: string) {
  describe(name, () => {
    for (const key of THEME_KEYS) {
      it(`has non-empty ${key}`, () => {
        expect(typeof theme[key]).toBe("string");
        expect(theme[key].length).toBeGreaterThan(0);
      });
    }

    it("has stateColors for every AgentState", () => {
      for (const state of ALL_STATES) {
        expect(typeof theme.stateColors[state]).toBe("string");
        expect(theme.stateColors[state].length).toBeGreaterThan(0);
      }
    });

    it("has no extra stateColors keys", () => {
      const keys = Object.keys(theme.stateColors);
      expect(keys.sort()).toEqual([...ALL_STATES].sort());
    });
  });
}

assertValidTheme(defaultTheme, "defaultTheme");
assertValidTheme(darkTheme, "darkTheme");

describe("applyTheme", () => {
  it("sets all expected CSS custom properties on the element", () => {
    const properties = new Map<string, string>();
    const mockEl = {
      style: {
        setProperty(name: string, value: string) {
          properties.set(name, value);
        },
      },
    } as unknown as HTMLElement;

    applyTheme(mockEl, defaultTheme);

    // Base properties
    expect(properties.get("--aai-bg")).toBe(defaultTheme.bg);
    expect(properties.get("--aai-surface")).toBe(defaultTheme.surface);
    expect(properties.get("--aai-surface-light")).toBe(
      defaultTheme.surfaceLight,
    );
    expect(properties.get("--aai-primary")).toBe(defaultTheme.primary);
    expect(properties.get("--aai-text")).toBe(defaultTheme.text);
    expect(properties.get("--aai-text-muted")).toBe(defaultTheme.textMuted);
    expect(properties.get("--aai-error")).toBe(defaultTheme.error);
    expect(properties.get("--aai-font")).toBe(defaultTheme.font);
    expect(properties.get("--aai-radius")).toBe(defaultTheme.radius);

    // State color properties
    for (const state of ALL_STATES) {
      expect(properties.get(`--aai-state-${state}`)).toBe(
        defaultTheme.stateColors[state],
      );
    }
  });

  it("sets correct total number of CSS properties", () => {
    const properties = new Map<string, string>();
    const mockEl = {
      style: {
        setProperty(name: string, value: string) {
          properties.set(name, value);
        },
      },
    } as unknown as HTMLElement;

    applyTheme(mockEl, defaultTheme);

    // 9 base properties + 6 state colors = 15
    expect(properties.size).toBe(15);
  });

  it("works with darkTheme", () => {
    const properties = new Map<string, string>();
    const mockEl = {
      style: {
        setProperty(name: string, value: string) {
          properties.set(name, value);
        },
      },
    } as unknown as HTMLElement;

    applyTheme(mockEl, darkTheme);

    expect(properties.get("--aai-bg")).toBe(darkTheme.bg);
    expect(properties.get("--aai-primary")).toBe(darkTheme.primary);
    expect(properties.get("--aai-state-speaking")).toBe(
      darkTheme.stateColors.speaking,
    );
  });
});
