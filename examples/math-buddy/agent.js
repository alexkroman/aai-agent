const { VoiceAgent } = await import("/client.js");

VoiceAgent.start({
  element: "#app",
  apiKey: "pk_your_publishable_key",

  prompt:
    "Transcribe mathematical expressions and numbers accurately. Listen for operators like plus, minus, times, divided by, squared, cubed, square root, and unit names like kilometers, miles, pounds, kilograms, Fahrenheit, Celsius, liters, and gallons.",

  instructions: `You are Math Buddy, a friendly math assistant. You help with calculations,
unit conversions, and random number generation. Keep answers short and clear.
When doing multi-step math, show your work briefly.`,

  greeting:
    "Hey! I'm Math Buddy. Ask me to calculate something, convert units, or roll some dice!",

  voice: "jess",

  tools: {
    calculate: {
      description:
        "Evaluate a mathematical expression. Supports +, -, *, /, **, %, parentheses, and Math functions like sqrt, sin, cos, abs, round, floor, ceil, log, PI, E.",
      parameters: {
        expression: {
          type: "string",
          description:
            "Math expression to evaluate, e.g. '(12 + 8) * 3' or 'Math.sqrt(144)'",
        },
      },
      handler: async (args) => {
        const expr = args.expression;
        // Allow only safe math characters and Math.* functions
        if (!/^[\d\s+\-*/().%,eE]+$/.test(expr.replace(/Math\.\w+/g, ""))) {
          return { error: "Expression contains invalid characters" };
        }
        const fn = new Function(`"use strict"; return (${expr})`);
        const result = fn();
        if (typeof result !== "number" || !isFinite(result)) {
          return { error: "Expression did not produce a valid number" };
        }
        return { expression: expr, result };
      },
    },

    convert_units: {
      description:
        "Convert a value between common units. Supports length (m/ft/in/cm/km/mi), weight (kg/lb/oz/g), temperature (C/F/K), and volume (L/gal/ml/cup).",
      parameters: {
        value: {
          type: "number",
          description: "Numeric value to convert",
        },
        from: {
          type: "string",
          description: "Source unit (e.g. 'km', 'lb', 'F')",
        },
        to: {
          type: "string",
          description: "Target unit (e.g. 'mi', 'kg', 'C')",
        },
      },
      handler: async (args) => {
        const conversions = {
          // Length → meters
          m: 1,
          ft: 0.3048,
          in: 0.0254,
          cm: 0.01,
          km: 1000,
          mi: 1609.344,
          yd: 0.9144,
          // Weight → grams
          g: 1,
          kg: 1000,
          lb: 453.592,
          oz: 28.3495,
          mg: 0.001,
          // Volume → liters
          L: 1,
          gal: 3.78541,
          ml: 0.001,
          cup: 0.236588,
          fl_oz: 0.0295735,
        };

        const from = args.from;
        const to = args.to;

        // Temperature special case
        const temps = ["C", "F", "K"];
        if (temps.includes(from) && temps.includes(to)) {
          let celsius = args.value;
          if (from === "F") celsius = ((args.value - 32) * 5) / 9;
          if (from === "K") celsius = args.value - 273.15;

          let result = celsius;
          if (to === "F") result = (celsius * 9) / 5 + 32;
          if (to === "K") result = celsius + 273.15;

          return {
            value: args.value,
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

        const baseValue = args.value * fromFactor;
        const result = baseValue / toFactor;
        return {
          value: args.value,
          from,
          to,
          result: Math.round(result * 1000) / 1000,
        };
      },
    },

    roll_dice: {
      description:
        "Roll one or more dice. Specify the number of dice and sides per die.",
      parameters: {
        count: {
          type: "number",
          description: "Number of dice to roll (default 1)",
        },
        sides: {
          type: "number",
          description: "Number of sides per die (default 6)",
        },
      },
      handler: async (args) => {
        const count = Math.min(Math.max(Math.round(args.count ?? 1), 1), 100);
        const sides = Math.min(Math.max(Math.round(args.sides ?? 6), 2), 1000);
        const rolls = [];
        for (let i = 0; i < count; i++) {
          rolls.push(Math.floor(Math.random() * sides) + 1);
        }
        const total = rolls.reduce((a, b) => a + b, 0);
        return { dice: `${count}d${sides}`, rolls, total };
      },
    },

    random_number: {
      description: "Generate a random integer between min and max (inclusive).",
      parameters: {
        min: { type: "number", description: "Minimum value (default 1)" },
        max: {
          type: "number",
          description: "Maximum value (default 100)",
        },
      },
      handler: async (args) => {
        const min = Math.round(args.min ?? 1);
        const max = Math.round(args.max ?? 100);
        if (min > max)
          return { error: "min must be less than or equal to max" };
        const result = Math.floor(Math.random() * (max - min + 1)) + min;
        return { min, max, result };
      },
    },
  },
});
