// types.ts — Agent-level types and defaults for the voice agent SDK.

/** Default system instructions for the voice assistant. */
export const DEFAULT_INSTRUCTIONS = `\
You are a helpful voice assistant. Your goal is to provide accurate, \
research-backed answers using your available tools.

Voice-First Rules:
- Optimize for natural speech. Avoid jargon unless central to the answer. \
Use short, punchy sentences.
- Never mention "search results," "sources," or "the provided text." \
Speak as if the knowledge is your own.
- No visual formatting. Do not say "bullet point," "bold," or "bracketed one." \
If you need to list items, say "First," "Next," and "Finally."
- Start with the most important information. No introductory filler.
- Be concise. For complex topics, provide a high-level summary.
- Be confident. Avoid hedging phrases like "It seems that" or "I believe."
- If you don't have enough information, say so directly rather than guessing.`;

/** Appended to system instructions to enforce voice-friendly output. */
export const VOICE_RULES =
  "\n\nCRITICAL OUTPUT RULES — you MUST follow these for EVERY response:\n" +
  "Your response will be spoken aloud by a TTS system and displayed as plain text.\n" +
  "- NEVER use markdown: no **, no *, no _, no #, no `, no [](), no ---\n" +
  "- NEVER use bullet points (-, *, •) or numbered lists (1., 2.)\n" +
  "- NEVER use code blocks or inline code\n" +
  "- Write exactly as you would say it out loud to a friend\n" +
  '- Use short conversational sentences. To list things, say "First," "Next," "Finally,"\n' +
  "- Keep responses concise — a few sentences max";

/** Default greeting spoken when a session starts. */
export const DEFAULT_GREETING =
  "Hey there! I'm a voice assistant. What can I help you with?";

// ── Agent Configuration (internal, built from Agent class) ──────────

/** Agent configuration used internally by ServerSession. */
export interface AgentConfig {
  /** System prompt / instructions for the LLM. */
  instructions: string;
  /** Initial greeting message spoken to the user. */
  greeting: string;
  /** TTS voice name. */
  voice: string;
  /** Optional transcription prompt to guide STT. */
  prompt?: string;
  /** Names of built-in server-side tools to enable (e.g., ["web_search"]). */
  builtinTools?: string[];
}

// ── Session Lifecycle Types ─────────────────────────────────────────

/** Context passed to lifecycle hooks during a voice session. */
export interface SessionContext {
  /** Unique identifier for this session. */
  sessionId: string;
}

/** Handler called when a new session connects. */
export type ConnectHandler = (ctx: SessionContext) => void | Promise<void>;

/** Handler called when a session disconnects. */
export type DisconnectHandler = (ctx: SessionContext) => void | Promise<void>;

/** Handler called when an error occurs during a session. */
export type ErrorHandler = (error: Error, ctx?: SessionContext) => void;

/** Handler called when a user completes a speech turn. */
export type TurnHandler = (
  text: string,
  ctx: SessionContext,
) => void | Promise<void>;
