import { Agent, tool, z } from "@aai/sdk";

// Safe expression evaluator — recursive descent, no eval()
export function evaluate(input: string): number {
  const s = input.replace(/\s/g, "");
  let pos = 0;

  const funcs: Record<string, (n: number) => number> = {
    sqrt: Math.sqrt,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    abs: Math.abs,
    round: Math.round,
    floor: Math.floor,
    ceil: Math.ceil,
    log: Math.log,
    log10: Math.log10,
  };
  const consts: Record<string, number> = { PI: Math.PI, E: Math.E };

  function parseExpr(): number {
    let left = parseTerm();
    while (s[pos] === "+" || s[pos] === "-") {
      const op = s[pos++];
      left = op === "+" ? left + parseTerm() : left - parseTerm();
    }
    return left;
  }

  function parseTerm(): number {
    let left = parsePower();
    while (
      (s[pos] === "*" && s[pos + 1] !== "*") ||
      s[pos] === "/" ||
      s[pos] === "%"
    ) {
      const op = s[pos++];
      const right = parsePower();
      left = op === "*"
        ? left * right
        : op === "/"
        ? left / right
        : left % right;
    }
    return left;
  }

  function parsePower(): number {
    const base = parseUnary();
    if (s[pos] === "*" && s[pos + 1] === "*") {
      pos += 2;
      return base ** parsePower(); // right-associative
    }
    return base;
  }

  function parseUnary(): number {
    if (s[pos] === "-") {
      pos++;
      return -parseAtom();
    }
    if (s[pos] === "+") pos++;
    return parseAtom();
  }

  function parseAtom(): number {
    if (s[pos] === "(") {
      pos++;
      const val = parseExpr();
      if (s[pos] !== ")") throw new Error("Missing ')'");
      pos++;
      return val;
    }

    // Named identifier — handles both "sqrt(...)" and "Math.sqrt(...)"
    const nameMatch = s.slice(pos).match(/^(?:Math\.)?([a-zA-Z_]\w*)/);
    if (nameMatch) {
      pos += nameMatch[0].length;
      const key = nameMatch[1];
      if (Object.hasOwn(consts, key)) return consts[key];
      if (Object.hasOwn(funcs, key)) {
        if (s[pos] !== "(") throw new Error(`Expected '(' after ${key}`);
        pos++;
        const arg = parseExpr();
        if (s[pos] !== ")") throw new Error("Missing ')'");
        pos++;
        return funcs[key](arg);
      }
      throw new Error(`Unknown: ${key}`);
    }

    // Number literal
    const numMatch = s.slice(pos).match(/^\d+\.?\d*([eE][+-]?\d+)?/);
    if (numMatch) {
      pos += numMatch[0].length;
      return parseFloat(numMatch[0]);
    }

    throw new Error(`Unexpected: '${s[pos] ?? "end of input"}'`);
  }

  const result = parseExpr();
  if (pos < s.length) throw new Error(`Unexpected: '${s[pos]}'`);
  return result;
}

// Unit conversion factors normalized to a base per category
const factors: Record<string, number> = {
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

const temps = new Set(["C", "F", "K"]);

export function convertTemp(value: number, from: string, to: string): number {
  const c = from === "F"
    ? ((value - 32) * 5) / 9
    : from === "K"
    ? value - 273.15
    : value;
  return to === "F" ? (c * 9) / 5 + 32 : to === "K" ? c + 273.15 : c;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export default new Agent({
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
        "Evaluate a mathematical expression. Supports +, -, *, /, **, %, parentheses, and functions: sqrt, sin, cos, tan, abs, round, floor, ceil, log, PI, E.",
      parameters: z.object({
        expression: z
          .string()
          .describe("Math expression, e.g. '(12 + 8) * 3' or 'sqrt(144)'"),
      }),
      handler: ({ expression }) => {
        try {
          const result = evaluate(expression);
          if (!isFinite(result)) {
            return { error: "Result is not a finite number" };
          }
          return { expression, result };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),
    convert_units: tool({
      description:
        "Convert between common units. Length (m/ft/in/cm/km/mi/yd), weight (kg/lb/oz/g/mg), temperature (C/F/K), volume (L/gal/ml/cup/fl_oz).",
      parameters: z.object({
        value: z.number().describe("Numeric value to convert"),
        from: z.string().describe("Source unit, e.g. 'km'"),
        to: z.string().describe("Target unit, e.g. 'mi'"),
      }),
      handler: ({ value, from, to }) => {
        if (temps.has(from) && temps.has(to)) {
          return {
            value,
            from,
            to,
            result: round3(convertTemp(value, from, to)),
          };
        }
        if (!factors[from]) return { error: `Unknown unit: ${from}` };
        if (!factors[to]) return { error: `Unknown unit: ${to}` };
        return {
          value,
          from,
          to,
          result: round3((value * factors[from]) / factors[to]),
        };
      },
    }),
    roll_dice: tool({
      description: "Roll one or more dice with a given number of sides.",
      parameters: z.object({
        count: z.number().int().min(1).max(100).default(1).describe(
          "Number of dice",
        ),
        sides: z.number().int().min(2).max(1000).default(6).describe(
          "Sides per die",
        ),
      }),
      handler: ({ count, sides }) => {
        const rolls = Array.from(
          { length: count },
          () => Math.floor(Math.random() * sides) + 1,
        );
        return {
          dice: `${count}d${sides}`,
          rolls,
          total: rolls.reduce((a, b) => a + b, 0),
        };
      },
    }),
    random_number: tool({
      description: "Generate a random integer between min and max (inclusive).",
      parameters: z.object({
        min: z.number().int().default(1).describe("Minimum value"),
        max: z.number().int().default(100).describe("Maximum value"),
      }),
      handler: ({ min, max }) => {
        if (min > max) return { error: "min must be ≤ max" };
        return {
          min,
          max,
          result: Math.floor(Math.random() * (max - min + 1)) + min,
        };
      },
    }),
  },
});
