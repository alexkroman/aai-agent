// session.ts — VoiceSession class: orchestrates one voice conversation.

import type WebSocket from "ws";
import type { PlatformConfig } from "./config.js";
import { MSG, MAX_TOOL_ITERATIONS } from "./constants.js";
import { ERR } from "./errors.js";
import type { callLLM as callLLMType } from "./llm.js";
import { createLogger, type Logger } from "./logger.js";
import { toolDefsToSchemas, validateToolArgs } from "./protocol.js";
import type { Sandbox } from "./sandbox.js";
import type { connectStt as connectSttType, SttEvents, SttHandle } from "./stt.js";
import type { TtsClient } from "./tts.js";
import type { normalizeVoiceText as normalizeVoiceTextType } from "./voice-cleaner.js";
import {
  DEFAULT_GREETING,
  DEFAULT_INSTRUCTIONS,
  VOICE_RULES,
  type AgentConfig,
  type ChatMessage,
  type LLMResponse,
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

/**
 * Orchestrates a single voice conversation between a browser client and
 * the STT / LLM / TTS pipeline. One instance per WebSocket connection.
 */
export class VoiceSession {
  private id: string;
  private agentConfig: AgentConfig;
  private deps: SessionDeps;
  private browserWs: WebSocket;
  private logger: Logger;
  private stt: SttHandle | null = null;
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
    this.logger = createLogger("session", { sid: id.slice(0, 8) });
    this.deps = {
      ...deps,
      config: {
        ...deps.config,
        sttConfig: {
          ...deps.config.sttConfig,
          ...(agentConfig.prompt ? { prompt: agentConfig.prompt } : {}),
        },
        ttsConfig: {
          ...deps.config.ttsConfig,
          ...(agentConfig.voice ? { voice: agentConfig.voice } : {}),
        },
      },
    };

    this.toolSchemas = toolDefsToSchemas(agentConfig.tools);

    // Initialize system message
    const instructions = agentConfig.instructions || DEFAULT_INSTRUCTIONS;
    this.messages.push({
      role: "system",
      content: instructions + VOICE_RULES,
    });
  }

  // ── Send helpers (safe for closed WS) ─────────────────────────────

  private trySendJson(data: Record<string, unknown>): void {
    try {
      if (this.browserWs.readyState === this.browserWs.OPEN) {
        this.browserWs.send(JSON.stringify(data));
      }
    } catch (err) {
      this.logger.error({ err }, "trySendJson failed");
    }
  }

  private trySendBytes(data: Buffer): void {
    try {
      if (this.browserWs.readyState === this.browserWs.OPEN) {
        this.browserWs.send(data);
      }
    } catch (err) {
      this.logger.error({ err }, "trySendBytes failed");
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
          this.logger.info({ text, isFinal }, "transcript");
          this.trySendJson({ type: MSG.TRANSCRIPT, text, final: isFinal });
        },
        onTurn: (text) => {
          this.logger.info({ text }, "turn");
          this.turnPromise = this.handleTurn(text).finally(() => {
            this.turnPromise = null;
          });
        },
        onError: (err) => {
          this.logger.warn({ err }, "STT error");
        },
        onClose: () => {
          this.logger.info("STT closed");
        },
      };

      this.stt = await this.deps.connectStt(
        this.deps.config.apiKey,
        this.deps.config.sttConfig,
        events
      );
    } catch (err) {
      this.logger.error({ err }, "Failed to connect STT");
      this.trySendJson({
        type: MSG.ERROR,
        message: ERR.STT_CONNECT_FAILED,
      });
      return;
    }

    // Send ready
    this.trySendJson({
      type: MSG.READY,
      version: 1,
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
      this.logger.debug({ frame: this.audioFrameCount, bytes: data.length }, "audio frame");
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
    this.stt?.clear();
    // Keep system message, clear conversation
    this.messages = this.messages.slice(0, 1);
    this.trySendJson({ type: MSG.RESET });

    // Re-send greeting (same logic as start())
    const greeting = this.agentConfig.greeting ?? DEFAULT_GREETING;
    if (greeting) {
      this.trySendJson({ type: MSG.GREETING, text: greeting });
      this.ttsRelay(greeting);
    }
  }

  /**
   * Stop the session and clean up all resources.
   */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;

    const pending = this.ttsPromise;
    this.cancelInflight();
    if (pending) await pending;
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

  private logLlmResponse(response: LLMResponse): void {
    const choice = response.choices[0];
    this.logger.info(
      { finishReason: choice?.finish_reason, toolCalls: choice?.message?.tool_calls?.length ?? 0 },
      "LLM response"
    );
    this.logger.debug(
      { content: choice?.message?.content, toolCalls: choice?.message?.tool_calls },
      "LLM response detail"
    );
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

      this.logger.info(
        { messageCount: this.messages.length, toolCount: this.toolSchemas.length },
        "calling LLM"
      );
      this.logger.debug({ messages: this.messages, model: this.deps.config.model }, "LLM request");

      // LLM tool loop (max 3 iterations)
      let response = await this.deps.callLLM(
        this.messages,
        this.toolSchemas,
        this.deps.config.apiKey,
        this.deps.config.model,
        abort.signal,
        this.deps.config.llmGatewayBase
      );
      this.logLlmResponse(response);

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

          this.logger.info(
            { tools: msg.tool_calls.map((tc) => tc.function.name), iteration: iterations + 1 },
            "executing tools"
          );

          const toolResults = await Promise.allSettled(
            msg.tool_calls.map(async (tc) => {
              let args: Record<string, unknown>;
              try {
                args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
              } catch (err) {
                this.logger.error(
                  { err, tool: tc.function.name },
                  "Failed to parse tool arguments"
                );
                return `Error: Invalid JSON arguments for tool "${tc.function.name}"`;
              }
              const validationError = validateToolArgs(tc.function.name, args, this.toolSchemas);
              if (validationError) return validationError;
              this.logger.debug({ tool: tc.function.name, args }, "tool call");
              const result = await this.deps.sandbox.execute(tc.function.name, args);
              this.logger.debug(
                { tool: tc.function.name, resultLength: result.length },
                "tool result"
              );
              return result;
            })
          );

          // Add tool results to messages in order
          for (let i = 0; i < msg.tool_calls.length; i++) {
            const r = toolResults[i];
            this.messages.push({
              role: "tool",
              content: r.status === "fulfilled" ? r.value : `Error: ${r.reason}`,
              tool_call_id: msg.tool_calls[i].id,
            });
          }

          if (abort.signal.aborted) break;

          this.logger.info(
            { messageCount: this.messages.length, iteration: iterations + 1 },
            "re-calling LLM with tool results"
          );
          this.logger.debug(
            { messages: this.messages, model: this.deps.config.model },
            "LLM request"
          );

          // Call LLM again with tool results
          response = await this.deps.callLLM(
            this.messages,
            this.toolSchemas,
            this.deps.config.apiKey,
            this.deps.config.model,
            abort.signal,
            this.deps.config.llmGatewayBase
          );
          this.logLlmResponse(response);
          iterations++;
        } else {
          // No tool calls — we have the final response
          const responseText = msg.content ?? "Sorry, I couldn't generate a response.";
          this.messages.push({ role: "assistant", content: responseText });

          this.logger.info({ responseLength: responseText.length, steps }, "turn complete");

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
      this.logger.error({ err }, "Chat failed");
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

    const promise = this.deps.ttsClient
      .synthesize(cleaned, (chunk) => this.trySendBytes(chunk), abort.signal)
      .then(() => {
        if (!abort.signal.aborted) {
          this.trySendJson({ type: MSG.TTS_DONE });
        }
      })
      .catch((err) => {
        if (!abort.signal.aborted) {
          this.logger.error({ err }, "TTS error");
          this.trySendJson({ type: MSG.ERROR, message: ERR.TTS_FAILED });
        }
      })
      .finally(() => {
        if (this.ttsAbort === abort) this.ttsAbort = null;
        if (this.ttsPromise === promise) this.ttsPromise = null;
      });
    this.ttsPromise = promise;
  }
}
