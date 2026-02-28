// session.ts — VoiceSession class: orchestrates one voice conversation.
// Deno-native: standard WebSocket API, ToolExecutor instead of Sandbox, Uint8Array.

import type { PlatformConfig } from "./config.ts";
import { MAX_TOOL_ITERATIONS, MSG } from "../sdk/shared-protocol.ts";
import { ERR } from "../sdk/errors.ts";
import type { CallLLMOptions } from "./llm.ts";
import { createLogger, type Logger } from "../sdk/logger.ts";
import type { IToolExecutor } from "../sdk/tool-executor.ts";
import type {
  connectStt as connectSttType,
  SttEvents,
  SttHandle,
} from "./stt.ts";
import type { ITtsClient } from "./tts.ts";
import type { normalizeVoiceText as normalizeVoiceTextType } from "./voice-cleaner.ts";
import type { executeBuiltinTool as executeBuiltinToolType } from "./builtin-tools.ts";
import {
  type AgentConfig,
  type ChatMessage,
  DEFAULT_GREETING,
  DEFAULT_INSTRUCTIONS,
  type LLMResponse,
  type ToolSchema,
  VOICE_RULES,
} from "../sdk/types.ts";

/**
 * Minimal transport interface used by VoiceSession.
 * A real WebSocket satisfies this.
 */
export interface SessionTransport {
  send(data: string | ArrayBuffer | Uint8Array): void;
  readonly readyState: number;
}

/** All external dependencies for VoiceSession — required, no optionals. */
export interface SessionDeps {
  config: PlatformConfig;
  connectStt: typeof connectSttType;
  callLLM: (opts: CallLLMOptions) => Promise<LLMResponse>;
  ttsClient: ITtsClient;
  toolExecutor: IToolExecutor;
  normalizeVoiceText: typeof normalizeVoiceTextType;
  executeBuiltinTool: typeof executeBuiltinToolType;
}

/**
 * Orchestrates a single voice conversation between a browser client and
 * the STT / LLM / TTS pipeline. One instance per WebSocket connection.
 */
export class VoiceSession {
  private id: string;
  private agentConfig: AgentConfig;
  private deps: SessionDeps;
  private browserWs: SessionTransport;
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

  constructor(
    id: string,
    browserWs: SessionTransport,
    config: AgentConfig,
    toolSchemas: ToolSchema[],
    deps: SessionDeps,
  ) {
    this.id = id;
    this.browserWs = browserWs;
    this.agentConfig = config;
    this.logger = createLogger("session", { sid: id.slice(0, 8) });
    this.deps = {
      ...deps,
      config: {
        ...deps.config,
        sttConfig: {
          ...deps.config.sttConfig,
          ...(config.prompt ? { prompt: config.prompt } : {}),
        },
        ttsConfig: {
          ...deps.config.ttsConfig,
          ...(config.voice ? { voice: config.voice } : {}),
        },
      },
    };

    this.toolSchemas = toolSchemas;

    // Initialize system message
    const instructions = this.agentConfig.instructions || DEFAULT_INSTRUCTIONS;
    this.messages.push({
      role: "system",
      content: instructions + VOICE_RULES,
    });
  }

  // ── Send helpers (safe for closed WS) ─────────────────────────────

  private trySendJson(data: Record<string, unknown>): void {
    try {
      if (this.browserWs.readyState === 1) {
        this.browserWs.send(JSON.stringify(data));
      }
    } catch (err) {
      this.logger.error({ err }, "trySendJson failed");
    }
  }

  private trySendBytes(data: Uint8Array): void {
    try {
      if (this.browserWs.readyState === 1) {
        this.browserWs.send(data);
      }
    } catch (err) {
      this.logger.error({ err }, "trySendBytes failed");
    }
  }

  /**
   * Start the voice session: connect STT, send ready + greeting.
   */
  start(): void {
    // Send READY immediately — don't block on STT connection
    this.trySendJson({
      type: MSG.READY,
      version: 1,
      sampleRate: this.deps.config.sttConfig.sampleRate,
      ttsSampleRate: this.deps.config.ttsConfig.sampleRate,
    });

    // Defer greeting until client signals audio_ready.
    const greeting = this.agentConfig.greeting ?? DEFAULT_GREETING;
    if (greeting) {
      this.pendingGreeting = greeting;
    }

    // Connect STT in background — doesn't block session startup.
    // The .catch() is a safety net: connectStt() has its own try/catch,
    // but this guards against any unhandled rejection that escapes it.
    this.connectStt().catch((err) => {
      this.logger.error({ err }, "Unhandled error in connectStt");
    });
  }

  private audioFrameCount = 0;
  private pendingGreeting: string | null = null;

  private async connectStt(): Promise<void> {
    const events: SttEvents = {
      onTranscript: (text, isFinal) => {
        this.logger.info({ text, isFinal }, "transcript");
        this.trySendJson({
          type: MSG.TRANSCRIPT,
          text,
          final: isFinal,
        });
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

    try {
      this.stt = await this.deps.connectStt(
        this.deps.config.apiKey,
        this.deps.config.sttConfig,
        events,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error({ error: msg }, "Failed to connect STT");
      this.trySendJson({
        type: MSG.ERROR,
        message: ERR.STT_CONNECT_FAILED,
      });
    }
  }

  /**
   * Client's audio worklet is ready — safe to send greeting TTS.
   */
  onAudioReady(): void {
    if (this.pendingGreeting) {
      this.trySendJson({ type: MSG.GREETING, text: this.pendingGreeting });
      this.ttsRelay(this.pendingGreeting);
      this.pendingGreeting = null;
    }
  }

  /**
   * Handle incoming binary audio from the browser — relay to STT.
   */
  onAudio(data: Uint8Array): void {
    this.audioFrameCount++;
    if (this.audioFrameCount <= 3) {
      this.logger.debug(
        { frame: this.audioFrameCount, bytes: data.length },
        "audio frame",
      );
    }
    this.stt?.send(data);
  }

  /**
   * Handle cancel command (barge-in).
   */
  onCancel(): void {
    this.cancelInflight();
    this.stt?.clear();
    this.trySendJson({ type: MSG.CANCELLED });
  }

  /**
   * Handle reset command.
   */
  onReset(): void {
    this.cancelInflight();
    this.stt?.clear();
    // Keep system message, clear conversation
    this.messages = this.messages.slice(0, 1);
    this.trySendJson({ type: MSG.RESET });

    // Re-send greeting
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
    this.deps.toolExecutor.dispose();
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
      {
        finishReason: choice?.finish_reason,
        toolCalls: choice?.message?.tool_calls?.length ?? 0,
      },
      "LLM response",
    );
    this.logger.debug(
      {
        content: choice?.message?.content,
        toolCalls: choice?.message?.tool_calls,
      },
      "LLM response detail",
    );
  }

  /**
   * Handle a completed turn from STT: run LLM + tools + TTS.
   */
  private async handleTurn(text: string): Promise<void> {
    this.cancelInflight();

    this.trySendJson({ type: MSG.TURN, text });
    this.trySendJson({ type: MSG.THINKING });

    const abort = new AbortController();
    this.chatAbort = abort;

    try {
      this.messages.push({ role: "user", content: text });

      this.logger.info(
        {
          messageCount: this.messages.length,
          toolCount: this.toolSchemas.length,
        },
        "calling LLM",
      );
      this.logger.debug(
        { messages: this.messages, model: this.deps.config.model },
        "LLM request",
      );

      let response = await this.deps.callLLM({
        messages: this.messages,
        tools: this.toolSchemas,
        apiKey: this.deps.config.apiKey,
        model: this.deps.config.model,
        signal: abort.signal,
        gatewayBase: this.deps.config.llmGatewayBase,
      });
      this.logLlmResponse(response);

      const steps: string[] = [];
      let iterations = 0;

      while (iterations < MAX_TOOL_ITERATIONS) {
        const choice = response.choices[0];
        if (!choice) break;

        const msg = choice.message;

        if (msg.tool_calls && msg.tool_calls.length > 0) {
          this.messages.push({
            role: "assistant",
            content: msg.content,
            tool_calls: msg.tool_calls,
          });

          for (const tc of msg.tool_calls) {
            steps.push(`Using ${tc.function.name}`);
          }

          this.logger.info(
            {
              tools: msg.tool_calls.map((tc) => tc.function.name),
              iteration: iterations + 1,
            },
            "executing tools",
          );

          const toolResults = await Promise.allSettled(
            msg.tool_calls.map(async (tc) => {
              let args: Record<string, unknown>;
              try {
                args = JSON.parse(tc.function.arguments) as Record<
                  string,
                  unknown
                >;
              } catch (err) {
                this.logger.error(
                  { err, tool: tc.function.name },
                  "Failed to parse tool arguments",
                );
                return `Error: Invalid JSON arguments for tool "${tc.function.name}"`;
              }
              this.logger.info({ tool: tc.function.name, args }, "tool call");

              // Try built-in tools first, then fall back to tool executor
              const builtinResult = await this.deps.executeBuiltinTool(
                tc.function.name,
                args,
              );
              const result = builtinResult ??
                (await this.deps.toolExecutor.execute(tc.function.name, args));
              this.logger.info(
                {
                  tool: tc.function.name,
                  resultLength: result.length,
                  result: result.length > 500
                    ? result.slice(0, 500) + "..."
                    : result,
                },
                "tool result",
              );
              return result;
            }),
          );

          for (let i = 0; i < msg.tool_calls.length; i++) {
            const r = toolResults[i];
            this.messages.push({
              role: "tool",
              content: r.status === "fulfilled"
                ? r.value
                : `Error: ${r.reason}`,
              tool_call_id: msg.tool_calls[i].id,
            });
          }

          if (abort.signal.aborted) break;

          this.logger.info(
            {
              messageCount: this.messages.length,
              iteration: iterations + 1,
            },
            "re-calling LLM with tool results",
          );

          response = await this.deps.callLLM({
            messages: this.messages,
            tools: this.toolSchemas,
            apiKey: this.deps.config.apiKey,
            model: this.deps.config.model,
            signal: abort.signal,
            gatewayBase: this.deps.config.llmGatewayBase,
          });
          this.logLlmResponse(response);
          iterations++;
        } else {
          const responseText = msg.content ??
            "Sorry, I couldn't generate a response.";
          this.messages.push({ role: "assistant", content: responseText });

          this.logger.info(
            { responseLength: responseText.length, steps },
            "turn complete",
          );

          this.trySendJson({
            type: MSG.CHAT,
            text: responseText,
            steps,
          });

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
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error({ error: msg }, "Chat failed");
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
