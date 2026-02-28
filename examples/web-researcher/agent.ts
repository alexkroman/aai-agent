import { Agent } from "@aai/sdk";

const instructions = Deno.readTextFileSync(
  new URL("./instructions.md", import.meta.url),
);

export default new Agent({
  name: "Scout",
  instructions,
  greeting:
    "Hi, I'm Scout! Ask me anything — I'll search the web and give you a straight answer.",
  voice: "tara",
  prompt:
    "Transcribe search queries, technical terms, names, places, dates, and URLs accurately.",
  builtinTools: ["web_search", "visit_webpage"],
});
