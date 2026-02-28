import { Agent, z } from "@aai/sdk";

export const agent = new Agent({
  name: "Coda",
  instructions:
    `You are Coda, a problem-solving assistant who answers questions by writing and running JavaScript code.

CRITICAL RULES:
- You MUST use the run_code tool for ANY question involving math, counting, string manipulation, data processing, logic, or anything that benefits from exact computation.
- NEVER do mental math or estimate. Always write code and report the exact result.
- When you run code, use print() to output intermediate steps and return the final answer.
- If the code throws an error, fix it and try again.
- Explain what the code does briefly, then give the answer.
- Keep your spoken responses short — just say what the code found.

Examples of questions you MUST use code for:
- "What is 127 times 849?" → run_code
- "How many prime numbers are there below 1000?" → run_code
- "Reverse the string 'hello world'" → run_code
- "What's the 50th fibonacci number?" → run_code
- "Sort these numbers: 42, 17, 93, 8, 55" → run_code
- "What day of the week was January 1st, 2000?" → run_code
- "Convert 255 to binary" → run_code`,
  greeting:
    "Hi, I'm Coda! I solve problems by writing and running code. Ask me anything — math, data, puzzles, string tricks — and I'll write JavaScript to get you the exact answer.",
  voice: "dan",
  prompt:
    "Transcribe numbers, mathematical expressions, variable names, and programming terms accurately. Listen for keywords like factorial, fibonacci, prime, sort, reverse, encrypt, decode, base64, hex, binary, regex, and JSON.",
}).tool("run_code", {
  description:
    "Execute JavaScript code and return the result. Use print() to log output. The return value of the last expression is captured as the result. Available globals: print() for logging, standard JavaScript built-ins (Math, Date, JSON, Array, Object, String, Number, RegExp, Map, Set, etc). No network access or filesystem access.",
  parameters: z.object({
    code: z
      .string()
      .describe(
        "JavaScript code to execute. Use print() for output. The value of the last expression is returned as the result.",
      ),
  }),
  handler: ({ code }) => {
    const logs: string[] = [];
    const print = (...items: unknown[]) => {
      logs.push(
        items
          .map((i) => (typeof i === "object" ? JSON.stringify(i) : String(i)))
          .join(" "),
      );
    };

    try {
      const fn = new Function("print", code);
      const result = fn(print);
      const output = logs.length ? logs.join("\n") : "";
      const resultStr = result !== undefined
        ? typeof result === "object"
          ? JSON.stringify(result, null, 2)
          : String(result)
        : "";
      if (output && resultStr) {
        return { output, result: resultStr };
      }
      return output || resultStr || "Code ran successfully (no output)";
    } catch (e) {
      return {
        error: (e as Error).message,
        output: logs.length ? logs.join("\n") : undefined,
      };
    }
  },
});
