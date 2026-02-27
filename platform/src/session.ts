// session.ts — VoiceSession class: orchestrates one voice conversation.

import type WebSocket from "ws";
import type { PlatformConfig } from "./config.js";
import { MSG, MAX_TOOL_ITERATIONS } from "./constants.js";
import { ERR, ERR_INTERNAL } from "./errors.js";
import type { callLLM as callLLMType } from "./llm.js";
import { toolDefsToSchemas } from "./protocol.js";
import type { Sandbox } from "./sandbox.js";
import type { connectStt as connectSttType, SttEvents } from "./stt.js";
import type { TtsClient } from "./tts.js";
import type { normalizeVoiceText as normalizeVoiceTextType } from "./voice-cleaner.js";
import {
  DEFAULT_GREETING,
  DEFAULT_INSTRUCTIONS,
  VOICE_RULES,
  type AgentConfig,
  type ChatMessage,
  type ToolSchema,
} from "./types.js";

/** All external dependencies for VoiceSession — required, no optionals. */
export interface SessionDeps {
  config: PlatformConfig;
  connectStt: typeof connectSttType;
  callLLM: typeof callLLMType;
  ttsClient: TtsClient;
  sandbox: Sandbox;
  normalizeVoiceText: typeof normalizeVoiceTextType;
}

export class VoiceSession {
  private id: string;
  private agentConfig: AgentConfig;
  private deps: SessionDeps;
  private browserWs: WebSocket;
  private stt: {
    send: (audio: Buffer) => void;
    clear: () => void;
    close: () => void;
  } | null = null;
  private chatAbort: AbortController | null = null;
  private ttsAbort: AbortController | null = null;
  private ttsPromise: Promise<void> | null = null;
  private messages: ChatMessage[] = [];
  private toolSchemas: ToolSchema[];
  private stopped = false;

  /** Resolves when the current handleTurn completes. Null when idle. */
  public turnPromise: Promise<void> | null = null;

  constructor(id: string, browserWs: WebSocket, agentConfig: AgentConfig, deps: SessionDeps) {
    this.id = id;
    this.browserWs = browserWs;
    this.agentConfig = agentConfig;
    this.deps = deps;

    // Override TTS voice from agent config
    if (agentConfig.voice) {
      this.deps.config.ttsConfig.voice = agentConfig.voice;
    }

    this.toolSchemas = toolDefsToSchemas(agentConfig.tools);

    // Initialize system message
    const instructions = agentConfig.instructions || DEFAULT_INSTRUCTIONS;
    this.messages.push({
      role: "system",
      content: instructions + VOICE_RULES,
    });
  }

  // ── Logging helpers ───────────────────────────────────────────────

  private log(msg: string): void {
    console.log(`[session:${this.id.slice(0, 8)}] ${msg}`);
  }

  private logError(msg: string, err?: unknown): void {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(`[session:${this.id.slice(0, 8)}] ${msg}: ${detail}`);
  }

  // ── Send helpers (safe for closed WS) ─────────────────────────────

  private trySendJson(data: Record<string, unknown>): void {
    try {
      if (this.browserWs.readyState === this.browserWs.OPEN) {
        this.browserWs.send(JSON.stringify(data));
      }
    } catch (err) {
      this.logError("trySendJson failed", err);
    }
  }

  private trySendBytes(data: Buffer): void {
    try {
      if (this.browserWs.readyState === this.browserWs.OPEN) {
        this.browserWs.send(data);
      }
    } catch (err) {
      this.logError("trySendBytes failed", err);
    }
  }

  /**
   * Start the voice session: connect STT, send ready + greeting.
   */
  async start(): Promise<void> {
    // Connect to STT
    try {
      const events: SttEvents = {
        onTranscript: (text, isFinal) => {
          this.log(`Transcript: "${text}" final=${isFinal}`);
          this.trySendJson({ type: MSG.TRANSCRIPT, text, final: isFinal });
        },
        onTurn: (text) => {
          this.log(`Turn: "${text}"`);
          this.turnPromise = this.handleTurn(text).finally(() => {
            this.turnPromise = null;
          });
        },
        onError: (err) => {
          this.log(`STT error: ${err.message}`);
        },
        onClose: () => {
          this.log("STT closed");
        },
      };

      this.stt = await this.deps.connectStt(
        this.deps.config.apiKey,
        this.deps.config.sttConfig,
        events
      );
    } catch (err) {
      this.log(`Failed to connect STT: ${err}`);
      this.trySendJson({
        type: MSG.ERROR,
        message: ERR.STT_CONNECT_FAILED,
      });
      return;
    }

    // Send ready
    this.trySendJson({
      type: MSG.READY,
      sampleRate: this.deps.config.sttConfig.sampleRate,
      ttsSampleRate: this.deps.config.ttsConfig.sampleRate,
    });

    // Send greeting
    const greeting = this.agentConfig.greeting ?? DEFAULT_GREETING;
    if (greeting) {
      this.trySendJson({ type: MSG.GREETING, text: greeting });
      this.ttsRelay(greeting);
    }
  }

  private audioFrameCount = 0;

  /**
   * Handle incoming binary audio from the browser — relay to STT.
   */
  onAudio(data: Buffer): void {
    this.audioFrameCount++;
    if (this.audioFrameCount <= 3) {
      this.log(
        `Audio frame ${this.audioFrameCount}: ${data.length} bytes, isBuffer=${Buffer.isBuffer(data)}`
      );
    }
    this.stt?.send(data);
  }

  /**
   * Handle cancel command (barge-in).
   */
  async onCancel(): Promise<void> {
    this.cancelInflight();
    this.stt?.clear();
    this.trySendJson({ type: MSG.CANCELLED });
  }

  /**
   * Handle reset command.
   */
  async onReset(): Promise<void> {
    this.cancelInflight();
    // Keep system message, clear conversation
    this.messages = this.messages.slice(0, 1);
    this.trySendJson({ type: MSG.RESET });
  }

  /**
   * Stop the session and clean up all resources.
   */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;

    this.cancelInflight();
    if (this.ttsPromise) await this.ttsPromise;
    this.stt?.close();
    this.deps.ttsClient.close();
    this.deps.sandbox.dispose();
  }

  // ── Private methods ────────────────────────────────────────────────

  private cancelInflight(): void {
    this.chatAbort?.abort();
    this.chatAbort = null;
    this.ttsAbort?.abort();
    this.ttsAbort = null;
  }

  /**
   * Handle a completed turn from STT: run LLM + tools + TTS.
   */
  private async handleTurn(text: string): Promise<void> {
    // Cancel any in-flight work
    this.cancelInflight();

    this.trySendJson({ type: MSG.TURN, text });
    this.trySendJson({ type: MSG.THINKING });

    const abort = new AbortController();
    this.chatAbort = abort;

    try {
      // Add user message
      this.messages.push({ role: "user", content: text });

      // LLM tool loop (max 3 iterations)
      let response = await this.deps.callLLM(
        this.messages,
        this.toolSchemas,
        this.deps.config.apiKey,
        this.deps.config.model,
        abort.signal,
        this.deps.config.llmGatewayBase
      );

      const steps: string[] = [];
      let iterations = 0;

      while (iterations < MAX_TOOL_ITERATIONS) {
        const choice = response.choices[0];
        if (!choice) break;

        const msg = choice.message;

        // If the LLM wants to call tools
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          // Add assistant message with tool calls
          this.messages.push({
            role: "assistant",
            content: msg.content,
            tool_calls: msg.tool_calls,
          });

          // Execute all tool calls in parallel
          for (const tc of msg.tool_calls) {
            steps.push(`Using ${tc.function.name}`);
          }

          const toolResults = await Promise.all(
            msg.tool_calls.map(async (tc) => {
              let args: Record<string, unknown>;
              try {
                args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
              } catch (err) {
                this.logError(ERR_INTERNAL.TOOL_ARGS_PARSE_FAILED(tc.function.name), err);
                return `Error: Invalid JSON arguments for tool "${tc.function.name}"`;
              }
              return this.deps.sandbox.execute(tc.function.name, args);
            })
          );

          // Add tool results to messages in order
          for (let i = 0; i < msg.tool_calls.length; i++) {
            this.messages.push({
              role: "tool",
              content: toolResults[i],
              tool_call_id: msg.tool_calls[i].id,
            });
          }

          if (abort.signal.aborted) break;

          // Call LLM again with tool results
          response = await this.deps.callLLM(
            this.messages,
            this.toolSchemas,
            this.deps.config.apiKey,
            this.deps.config.model,
            abort.signal,
            this.deps.config.llmGatewayBase
          );
          iterations++;
        } else {
          // No tool calls — we have the final response
          const responseText = msg.content ?? "Sorry, I couldn't generate a response.";
          this.messages.push({ role: "assistant", content: responseText });

          this.trySendJson({
            type: MSG.CHAT,
            text: responseText,
            steps,
          });

          // Start TTS
          if (responseText) {
            this.ttsRelay(responseText);
          } else {
            this.trySendJson({ type: MSG.TTS_DONE });
          }
          break;
        }
      }
    } catch (err) {
      if (abort.signal.aborted) return;
      this.logError("Chat failed", err);
      this.trySendJson({ type: MSG.ERROR, message: ERR.CHAT_FAILED });
    } finally {
      if (this.chatAbort === abort) {
        this.chatAbort = null;
      }
    }
  }

  /**
   * Synthesize text via TTS and relay audio chunks to the browser.
   */
  private ttsRelay(text: string): void {
    const abort = new AbortController();
    this.ttsAbort = abort;

    const cleaned = this.deps.normalizeVoiceText(text);

    this.ttsPromise = this.deps.ttsClient
      .synthesize(cleaned, (chunk) => this.trySendBytes(chunk), abort.signal)
      .then(() => {
        if (!abort.signal.aborted) {
          this.trySendJson({ type: MSG.TTS_DONE });
        }
      })
      .catch((err) => {
        if (!abort.signal.aborted) {
          this.log(`TTS error: ${err.message}`);
          this.trySendJson({ type: MSG.ERROR, message: ERR.TTS_FAILED });
        }
      })
      .finally(() => {
        if (this.ttsAbort === abort) {
          this.ttsAbort = null;
        }
        this.ttsPromise = null;
      });
  }
}
