import { defineAgent, tool, z } from "@aai/sdk";

const TIMEOUT_MS = 5_000;

export default defineAgent({
  name: "Coda",
  instructions:
    `You are Coda, a problem-solving assistant who answers questions by writing and running JavaScript code.

CRITICAL RULES:
- You MUST use the run_code tool for ANY question involving math, counting, string manipulation, data processing, logic, or anything that benefits from exact computation.
- NEVER do mental math or estimate. Always write code and report the exact result.
- Use console.log() to output intermediate steps. The last expression is captured automatically.
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
  tools: {
    run_code: tool({
      description:
        "Execute JavaScript in a sandboxed Deno subprocess with no permissions. Use console.log() for output. No network or filesystem access.",
      parameters: z.object({
        code: z
          .string()
          .describe(
            "JavaScript code to execute. Use console.log() for output.",
          ),
      }),
      handler: async ({ code }) => {
        const cmd = new Deno.Command("deno", {
          args: [
            "run",
            "--deny-net",
            "--deny-read",
            "--deny-write",
            "--deny-env",
            "--deny-sys",
            "--deny-run",
            "--deny-ffi",
            "-",
          ],
          stdin: "piped",
          stdout: "piped",
          stderr: "piped",
        });

        const proc = cmd.spawn();
        const writer = proc.stdin.getWriter();
        await writer.write(new TextEncoder().encode(code));
        await writer.close();

        const timer = setTimeout(() => proc.kill(), TIMEOUT_MS);

        try {
          const { code: exit, stdout, stderr } = await proc.output();
          clearTimeout(timer);

          const out = new TextDecoder().decode(stdout).trim();
          const err = new TextDecoder().decode(stderr).trim();

          if (exit !== 0) return { error: err || "Execution failed" };
          return out || "Code ran successfully (no output)";
        } catch {
          return { error: "Execution timed out" };
        }
      },
    }),
  },
});
