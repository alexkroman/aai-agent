import { defineAgent, tool, z } from "@aai/sdk";

export default defineAgent({
  name: "Math Buddy",
  instructions:
    `You are Math Buddy, a friendly math assistant. You help with calculations,
unit conversions, and random number generation. Keep answers short and clear.
When doing multi-step math, show your work briefly.`,
  greeting:
    "Hey! I'm Math Buddy. Ask me to calculate something, convert units, or roll some dice!",
  voice: "jess",
  prompt:
    "Transcribe mathematical expressions and numbers accurately. Listen for operators like plus, minus, times, divided by, squared, cubed, square root, and unit names like kilometers, miles, pounds, kilograms, Fahrenheit, Celsius, liters, and gallons.",
  tools: {
    calculate: tool({
      description:
        "Evaluate a mathematical expression. Supports +, -, *, /, **, %, parentheses, and Math functions like sqrt, sin, cos, abs, round, floor, ceil, log, PI, E.",
      parameters: z.object({
        expression: z
          .string()
          .describe(
            "Math expression to evaluate, e.g. '(12 + 8) * 3' or 'Math.sqrt(144)'",
          ),
      }),
      handler: ({ expression }) => {
        if (
          !/^[\d\s+\-*/().%,eE]+$/.test(expression.replace(/Math\.\w+/g, ""))
        ) {
          return { error: "Expression contains invalid characters" };
        }
        const fn = new Function(`"use strict"; return (${expression})`);
        const result = fn();
        if (typeof result !== "number" || !isFinite(result)) {
          return { error: "Expression did not produce a valid number" };
        }
        return { expression, result };
      },
    }),
    convert_units: tool({
      description:
        "Convert a value between common units. Supports length (m/ft/in/cm/km/mi), weight (kg/lb/oz/g), temperature (C/F/K), and volume (L/gal/ml/cup).",
      parameters: z.object({
        value: z.number().describe("Numeric value to convert"),
        from: z.string().describe("Source unit (e.g. 'km', 'lb', 'F')"),
        to: z.string().describe("Target unit (e.g. 'mi', 'kg', 'C')"),
      }),
      handler: ({ value, from, to }) => {
        const conversions: Record<string, number> = {
          m: 1,
          ft: 0.3048,
          in: 0.0254,
          cm: 0.01,
          km: 1000,
          mi: 1609.344,
          yd: 0.9144,
          g: 1,
          kg: 1000,
          lb: 453.592,
          oz: 28.3495,
          mg: 0.001,
          L: 1,
          gal: 3.78541,
          ml: 0.001,
          cup: 0.236588,
          fl_oz: 0.0295735,
        };

        const temps = ["C", "F", "K"];
        if (temps.includes(from) && temps.includes(to)) {
          let celsius = value;
          if (from === "F") celsius = ((value - 32) * 5) / 9;
          if (from === "K") celsius = value - 273.15;
          let result = celsius;
          if (to === "F") result = (celsius * 9) / 5 + 32;
          if (to === "K") result = celsius + 273.15;
          return {
            value,
            from,
            to,
            result: Math.round(result * 1000) / 1000,
          };
        }

        const fromFactor = conversions[from];
        const toFactor = conversions[to];
        if (!fromFactor || !toFactor) {
          return { error: `Unknown unit: ${!fromFactor ? from : to}` };
        }
        const baseValue = value * fromFactor;
        const result = baseValue / toFactor;
        return {
          value,
          from,
          to,
          result: Math.round(result * 1000) / 1000,
        };
      },
    }),
    roll_dice: tool({
      description:
        "Roll one or more dice. Specify the number of dice and sides per die.",
      parameters: z.object({
        count: z.number().describe("Number of dice to roll (default 1)"),
        sides: z.number().describe("Number of sides per die (default 6)"),
      }),
      handler: ({ count, sides }) => {
        const c = Math.min(Math.max(Math.round(count ?? 1), 1), 100);
        const s = Math.min(Math.max(Math.round(sides ?? 6), 2), 1000);
        const rolls: number[] = [];
        for (let i = 0; i < c; i++) {
          rolls.push(Math.floor(Math.random() * s) + 1);
        }
        const total = rolls.reduce((a, b) => a + b, 0);
        return { dice: `${c}d${s}`, rolls, total };
      },
    }),
    random_number: tool({
      description: "Generate a random integer between min and max (inclusive).",
      parameters: z.object({
        min: z.number().describe("Minimum value (default 1)"),
        max: z.number().describe("Maximum value (default 100)"),
      }),
      handler: ({ min, max }) => {
        const lo = Math.round(min ?? 1);
        const hi = Math.round(max ?? 100);
        if (lo > hi) return { error: "min must be less than or equal to max" };
        const result = Math.floor(Math.random() * (hi - lo + 1)) + lo;
        return { min: lo, max: hi, result };
      },
    }),
  },
});
