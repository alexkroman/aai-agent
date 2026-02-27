// session.ts — VoiceSession class: orchestrates one voice conversation.

import type WebSocket from "ws";
import { loadPlatformConfig, type PlatformConfig } from "./config.js";
import { MSG, MAX_TOOL_ITERATIONS } from "./constants.js";
import { ERR, ERR_INTERNAL } from "./errors.js";
import { callLLM } from "./llm.js";
import { toolDefsToSchemas } from "./protocol.js";
import { Sandbox } from "./sandbox.js";
import { connectStt, type SttEvents } from "./stt.js";
import { TtsClient } from "./tts.js";
import { normalizeVoiceText } from "./voice-cleaner.js";
import {
  DEFAULT_GREETING,
  DEFAULT_INSTRUCTIONS,
  VOICE_RULES,
  type AgentConfig,
  type ChatMessage,
  type ToolSchema,
} from "./types.js";

interface SessionDeps extends PlatformConfig {
  /** Customer secrets from platform store */
  customerSecrets: Record<string, string>;
}

/** Injectable overrides for testing. */
export interface SessionOverrides {
  connectStt?: typeof connectStt;
  ttsClient?: TtsClient;
  callLLM?: typeof callLLM;
}

export class VoiceSession {
  private id: string;
  private config: AgentConfig;
  private deps: SessionDeps;
  private browserWs: WebSocket;
  private sandbox: Sandbox;
  private overrides: SessionOverrides;
  private stt: {
    send: (audio: Buffer) => void;
    clear: () => void;
    close: () => void;
  } | null = null;
  private ttsClient: TtsClient;
  private chatAbort: AbortController | null = null;
  private ttsAbort: AbortController | null = null;
  private ttsPromise: Promise<void> | null = null;
  private messages: ChatMessage[] = [];
  private toolSchemas: ToolSchema[];
  private stopped = false;

  constructor(
    id: string,
    browserWs: WebSocket,
    config: AgentConfig,
    customerSecrets: Record<string, string> = {},
    overrides: SessionOverrides = {}
  ) {
    this.id = id;
    this.browserWs = browserWs;
    this.config = config;
    this.overrides = overrides;

    this.deps = { ...loadPlatformConfig(), customerSecrets };

    // Override TTS voice from config
    if (config.voice) {
      this.deps.ttsConfig.voice = config.voice;
    }

    this.sandbox = new Sandbox(config.tools, customerSecrets);
    this.ttsClient = overrides.ttsClient ?? new TtsClient(this.deps.ttsConfig);
    this.toolSchemas = toolDefsToSchemas(config.tools);

    // Initialize system message
    const instructions = config.instructions || DEFAULT_INSTRUCTIONS;
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
          this.handleTurn(text);
        },
        onError: (err) => {
          this.log(`STT error: ${err.message}`);
        },
        onClose: () => {
          this.log("STT closed");
        },
      };

      const sttConnect = this.overrides.connectStt ?? connectStt;
      this.stt = await sttConnect(this.deps.apiKey, this.deps.sttConfig, events);
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
      sampleRate: this.deps.sttConfig.sampleRate,
      ttsSampleRate: this.deps.ttsConfig.sampleRate,
    });

    // Send greeting
    const greeting = this.config.greeting ?? DEFAULT_GREETING;
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
    this.ttsClient.close();
    this.sandbox.dispose();
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
      const llm = this.overrides.callLLM ?? callLLM;
      let response = await llm(
        this.messages,
        this.toolSchemas,
        this.deps.apiKey,
        this.deps.model,
        abort.signal,
        this.deps.llmGatewayBase
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
              return this.sandbox.execute(tc.function.name, args);
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
          response = await llm(
            this.messages,
            this.toolSchemas,
            this.deps.apiKey,
            this.deps.model,
            abort.signal,
            this.deps.llmGatewayBase
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

    const cleaned = normalizeVoiceText(text);

    this.ttsPromise = this.ttsClient
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
