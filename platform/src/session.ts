// session.ts — VoiceSession class: orchestrates one voice conversation.

import type WebSocket from "ws";
import { callLLM } from "./llm.js";
import { toolDefsToSchemas } from "./protocol.js";
import { Sandbox } from "./sandbox.js";
import { connectStt, type SttEvents } from "./stt.js";
import { synthesize } from "./tts.js";
import { normalizeVoiceText } from "./voice-cleaner.js";
import {
  DEFAULT_GREETING,
  DEFAULT_INSTRUCTIONS,
  DEFAULT_MODEL,
  DEFAULT_STT_CONFIG,
  DEFAULT_TTS_WSS_URL,
  VOICE_RULES,
  type AgentConfig,
  type ChatMessage,
  type STTConfig,
  type TTSConfig,
  type ToolSchema,
} from "./types.js";

interface SessionDeps {
  apiKey: string;
  ttsApiKey: string;
  sttConfig: STTConfig;
  ttsConfig: TTSConfig;
  model: string;
  /** Customer secrets from platform store */
  customerSecrets: Record<string, string>;
}

type SendJson = (data: Record<string, unknown>) => void;
type SendBytes = (data: Buffer) => void;

function createSessionDeps(): SessionDeps {
  return {
    apiKey: process.env.ASSEMBLYAI_API_KEY ?? "",
    ttsApiKey: process.env.ASSEMBLYAI_TTS_API_KEY ?? "",
    sttConfig: { ...DEFAULT_STT_CONFIG },
    ttsConfig: {
      wssUrl: process.env.ASSEMBLYAI_TTS_WSS_URL ?? DEFAULT_TTS_WSS_URL,
      apiKey: process.env.ASSEMBLYAI_TTS_API_KEY ?? "",
      voice: "jess",
      maxTokens: 2000,
      bufferSize: 105,
      repetitionPenalty: 1.2,
      temperature: 0.6,
      topP: 0.9,
      sampleRate: 24000,
    },
    model: process.env.LLM_MODEL ?? DEFAULT_MODEL,
    customerSecrets: {},
  };
}

export class VoiceSession {
  private id: string;
  private config: AgentConfig;
  private deps: SessionDeps;
  private browserWs: WebSocket;
  private sandbox: Sandbox;
  private stt: {
    send: (audio: Buffer) => void;
    clear: () => void;
    close: () => void;
  } | null = null;
  private chatAbort: AbortController | null = null;
  private ttsAbort: AbortController | null = null;
  private messages: ChatMessage[] = [];
  private toolSchemas: ToolSchema[];
  private stopped = false;

  constructor(id: string, browserWs: WebSocket, config: AgentConfig) {
    this.id = id;
    this.browserWs = browserWs;
    this.config = config;

    this.deps = createSessionDeps();

    // Override TTS voice from config
    if (config.voice) {
      this.deps.ttsConfig.voice = config.voice;
    }

    // TODO: Load customer secrets from platform secret store by API key
    // For now, secrets come from environment as a JSON blob
    const secretsEnv = process.env.CUSTOMER_SECRETS;
    if (secretsEnv) {
      try {
        this.deps.customerSecrets = JSON.parse(secretsEnv);
      } catch {
        // ignore
      }
    }

    this.sandbox = new Sandbox(config.tools, this.deps.customerSecrets);
    this.toolSchemas = toolDefsToSchemas(config.tools);

    // Initialize system message
    const instructions = config.instructions || DEFAULT_INSTRUCTIONS;
    this.messages.push({
      role: "system",
      content: instructions + VOICE_RULES,
    });
  }

  private sendJson(data: Record<string, unknown>): void {
    try {
      if (this.browserWs.readyState === this.browserWs.OPEN) {
        this.browserWs.send(JSON.stringify(data));
      }
    } catch {
      // WS closing
    }
  }

  private sendBytes(data: Buffer): void {
    try {
      if (this.browserWs.readyState === this.browserWs.OPEN) {
        this.browserWs.send(data);
      }
    } catch {
      // WS closing
    }
  }

  /**
   * Start the voice session: connect STT, send ready + greeting.
   */
  async start(): Promise<void> {
    const log = (msg: string) =>
      console.log(`[session:${this.id.slice(0, 8)}] ${msg}`);

    // Connect to STT
    try {
      const events: SttEvents = {
        onTranscript: (text, isFinal) => {
          this.sendJson({ type: "transcript", text, final: isFinal });
        },
        onTurn: (text) => {
          this.handleTurn(text);
        },
        onError: (err) => {
          log(`STT error: ${err.message}`);
        },
        onClose: () => {
          log("STT closed");
        },
      };

      this.stt = await connectStt(
        this.deps.apiKey,
        this.deps.sttConfig,
        events
      );
    } catch (err) {
      log(`Failed to connect STT: ${err}`);
      this.sendJson({
        type: "error",
        message: "Failed to connect to speech recognition",
      });
      return;
    }

    // Send ready
    this.sendJson({
      type: "ready",
      sampleRate: this.deps.sttConfig.sampleRate,
      ttsSampleRate: this.deps.ttsConfig.sampleRate,
    });

    // Send greeting
    const greeting = this.config.greeting ?? DEFAULT_GREETING;
    if (greeting) {
      this.sendJson({ type: "greeting", text: greeting });
      if (this.deps.ttsApiKey) {
        this.ttsRelay(greeting);
      }
    }
  }

  /**
   * Handle incoming binary audio from the browser — relay to STT.
   */
  onAudio(data: Buffer): void {
    this.stt?.send(data);
  }

  /**
   * Handle cancel command (barge-in).
   */
  async onCancel(): Promise<void> {
    await this.cancelInflight();
    this.stt?.clear();
    this.sendJson({ type: "cancelled" });
  }

  /**
   * Handle reset command.
   */
  async onReset(): Promise<void> {
    await this.cancelInflight();
    // Keep system message, clear conversation
    this.messages = this.messages.slice(0, 1);
    this.sendJson({ type: "reset" });
  }

  /**
   * Stop the session and clean up all resources.
   */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;

    await this.cancelInflight();
    this.stt?.close();
    this.sandbox.dispose();
  }

  // ── Private methods ────────────────────────────────────────────────

  private async cancelInflight(): Promise<void> {
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
    await this.cancelInflight();

    this.sendJson({ type: "turn", text });
    this.sendJson({ type: "thinking" });

    const abort = new AbortController();
    this.chatAbort = abort;

    try {
      // Add user message
      this.messages.push({ role: "user", content: text });

      // LLM tool loop (max 3 iterations)
      let response = await callLLM(
        this.messages,
        this.toolSchemas,
        this.deps.apiKey,
        this.deps.model,
        abort.signal
      );

      const steps: string[] = [];
      let iterations = 0;
      const MAX_ITERATIONS = 3;

      while (iterations < MAX_ITERATIONS) {
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

          // Execute each tool call
          for (const tc of msg.tool_calls) {
            if (abort.signal.aborted) break;

            const toolName = tc.function.name;
            steps.push(`Using ${toolName}`);

            let args: Record<string, unknown>;
            try {
              args = JSON.parse(tc.function.arguments);
            } catch {
              args = {};
            }

            const result = await this.sandbox.execute(toolName, args);

            // Add tool result message
            this.messages.push({
              role: "tool",
              content: result,
              tool_call_id: tc.id,
            });
          }

          if (abort.signal.aborted) break;

          // Call LLM again with tool results
          response = await callLLM(
            this.messages,
            this.toolSchemas,
            this.deps.apiKey,
            this.deps.model,
            abort.signal
          );
          iterations++;
        } else {
          // No tool calls — we have the final response
          const responseText =
            msg.content ?? "Sorry, I couldn't generate a response.";
          this.messages.push({ role: "assistant", content: responseText });

          this.sendJson({
            type: "chat",
            text: responseText,
            steps,
          });

          // Start TTS
          if (this.deps.ttsApiKey && responseText) {
            this.ttsRelay(responseText);
          } else {
            this.sendJson({ type: "tts_done" });
          }
          break;
        }
      }
    } catch (err) {
      if (abort.signal.aborted) return;
      console.error(`[session:${this.id.slice(0, 8)}] Chat failed:`, err);
      this.sendJson({ type: "error", message: "Chat failed" });
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
    const log = (msg: string) =>
      console.log(`[session:${this.id.slice(0, 8)}] TTS: ${msg}`);

    synthesize(
      cleaned,
      this.deps.ttsConfig,
      (chunk) => this.sendBytes(chunk),
      abort.signal
    )
      .then(() => {
        if (!abort.signal.aborted) {
          this.sendJson({ type: "tts_done" });
        }
      })
      .catch((err) => {
        if (!abort.signal.aborted) {
          log(`error: ${err.message}`);
          this.sendJson({ type: "error", message: "TTS synthesis failed" });
        }
      })
      .finally(() => {
        if (this.ttsAbort === abort) {
          this.ttsAbort = null;
        }
      });
  }
}
