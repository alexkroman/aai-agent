import type { PlatformConfig } from "./config.ts";
import { ERR } from "./errors.ts";
import { callLLM as defaultCallLLM, type CallLLMOptions } from "./llm.ts";
import { getLogger, type Logger } from "../_utils/logger.ts";
import type { ExecuteTool } from "./tool_executor.ts";
import {
  connectStt as defaultConnectStt,
  type SttEvents,
  type SttHandle,
} from "./stt.ts";
import { type ITtsClient, TtsClient } from "./tts.ts";
import { executeBuiltinTool as defaultExecuteBuiltinTool } from "./builtin_tools.ts";
import { executeTurn, type TurnContext } from "./turn_handler.ts";
import type {
  AgentConfig,
  ChatMessage,
  LLMResponse,
  STTConfig,
  ToolSchema,
} from "./types.ts";
import { DEFAULT_GREETING, DEFAULT_INSTRUCTIONS } from "./agent_types.ts";

const VOICE_RULES =
  "\n\nCRITICAL OUTPUT RULES — you MUST follow these for EVERY response:\n" +
  "Your response will be spoken aloud by a TTS system and displayed as plain text.\n" +
  "- NEVER use markdown: no **, no *, no _, no #, no `, no [](), no ---\n" +
  "- NEVER use bullet points (-, *, •) or numbered lists (1., 2.)\n" +
  "- NEVER use code blocks or inline code\n" +
  "- NEVER mention tools, search, APIs, or technical failures to the user. " +
  "If a tool returns no results, just answer naturally without explaining why.\n" +
  "- Write exactly as you would say it out loud to a friend\n" +
  '- Use short conversational sentences. To list things, say "First," "Next," "Finally,"\n' +
  "- Keep responses concise — a few sentences max";

export interface SessionTransport {
  send(data: string | ArrayBuffer | Uint8Array): void;
  readonly readyState: number;
}

export interface SessionDeps {
  config: PlatformConfig;
  connectStt(
    apiKey: string,
    config: STTConfig,
    events: SttEvents,
  ): Promise<SttHandle>;
  callLLM(opts: CallLLMOptions): Promise<LLMResponse>;
  ttsClient: ITtsClient;
  executeTool: ExecuteTool;
  executeBuiltinTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string | null>;
}

export class ServerSession {
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
  private audioFrameCount = 0;
  private pendingGreeting: string | null = null;

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
    this.logger = getLogger(`session:${id.slice(0, 8)}`);
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

    const agentInstructions = this.agentConfig.instructions
      ? `\n\nAgent-Specific Instructions:\n${this.agentConfig.instructions}`
      : "";
    const toolReminder = this.toolSchemas.length > 0
      ? "\n\nAnswer the user's request using relevant tools (if they are available). " +
        "Before calling a tool, do some analysis. " +
        "First, think about which of the provided tools is the relevant tool to answer the user's request. " +
        "Second, go through each of the required parameters of the relevant tool and determine if the user has directly provided or given enough information to infer a value. " +
        "When deciding if the parameter can be inferred, carefully consider all the context to see if it supports a specific value. " +
        "If all of the required parameters are present or can be reasonably inferred, proceed with the tool call. " +
        "BUT, if one of the values for a required parameter is missing, DO NOT invoke the function (not even with fillers for the missing params) and instead, ask the user to provide the missing parameters. " +
        "DO NOT ask for more information on optional parameters if it is not provided. " +
        "Do not answer from memory alone when a tool can provide accurate, up-to-date information." +
        "\n\nIMPORTANT: You MUST call the final_answer tool to deliver every response. " +
        "Put your complete spoken response in the answer parameter. " +
        "It is the only way to complete the task — otherwise you will be stuck in a loop."
      : "";
    this.messages.push({
      role: "system",
      content: DEFAULT_INSTRUCTIONS + agentInstructions + toolReminder +
        VOICE_RULES,
    });
  }

  private trySendJson(data: Record<string, unknown>): void {
    try {
      if (this.browserWs.readyState === 1) {
        this.browserWs.send(JSON.stringify(data));
      }
    } catch (err) {
      this.logger.error("trySendJson failed", { err });
    }
  }

  private trySendBytes(data: Uint8Array): void {
    try {
      if (this.browserWs.readyState === 1) {
        this.browserWs.send(data);
      }
    } catch (err) {
      this.logger.error("trySendBytes failed", { err });
    }
  }

  start(): void {
    this.trySendJson({
      type: "ready",
      version: 1,
      sampleRate: this.deps.config.sttConfig.sampleRate,
      ttsSampleRate: this.deps.config.ttsConfig.sampleRate,
    });

    const greeting = this.agentConfig.greeting ?? DEFAULT_GREETING;
    if (greeting) this.pendingGreeting = greeting;

    this.connectStt().catch((err) => {
      this.logger.error("Unhandled error in connectStt", { err });
    });
  }

  private async connectStt(): Promise<void> {
    const events: SttEvents = {
      onTranscript: (text, isFinal) => {
        this.logger.info("transcript", { text, isFinal });
        this.trySendJson({ type: "transcript", text, final: isFinal });
      },
      onTurn: (text) => {
        this.logger.info("turn", { text });
        this.turnPromise = this.handleTurn(text).finally(() => {
          this.turnPromise = null;
        });
      },
      onError: (err) => {
        this.logger.error("STT error", { err });
        this.trySendJson({ type: "error", message: ERR.STT_DISCONNECTED });
      },
      onClose: () => {
        this.logger.info("STT closed");
        this.stt = null;
        if (!this.stopped) {
          this.logger.info("Attempting STT reconnect");
          this.connectStt().catch((err) => {
            this.logger.error("STT reconnect failed", { err });
          });
        }
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
      this.logger.error("Failed to connect STT", { error: msg });
      this.trySendJson({ type: "error", message: ERR.STT_CONNECT_FAILED });
    }
  }

  onAudioReady(): void {
    if (this.pendingGreeting) {
      this.trySendJson({ type: "greeting", text: this.pendingGreeting });
      this.ttsRelay(this.pendingGreeting);
      this.pendingGreeting = null;
    }
  }

  onAudio(data: Uint8Array): void {
    this.audioFrameCount++;
    if (this.audioFrameCount <= 3) {
      this.logger.debug("audio frame", {
        frame: this.audioFrameCount,
        bytes: data.length,
      });
    }
    this.stt?.send(data);
  }

  onCancel(): void {
    const pending = this.ttsPromise;
    this.cancelInflight();
    this.stt?.clear();
    if (pending) {
      // Wait for TTS to finish aborting so no audio chunks arrive after "cancelled".
      pending.then(() => this.trySendJson({ type: "cancelled" }));
    } else {
      this.trySendJson({ type: "cancelled" });
    }
  }

  onReset(): void {
    this.cancelInflight();
    this.stt?.clear();
    this.messages = this.messages.slice(0, 1);
    this.trySendJson({ type: "reset" });

    const greeting = this.agentConfig.greeting ?? DEFAULT_GREETING;
    if (greeting) {
      this.trySendJson({ type: "greeting", text: greeting });
      this.ttsRelay(greeting);
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;

    const pending = this.ttsPromise;
    this.cancelInflight();
    if (pending) await pending;
    this.stt?.close();
    this.deps.ttsClient.close();
  }

  private cancelInflight(): void {
    this.chatAbort?.abort();
    this.chatAbort = null;
    this.ttsAbort?.abort();
    this.ttsAbort = null;
  }

  private async handleTurn(text: string): Promise<void> {
    this.cancelInflight();

    this.trySendJson({ type: "turn", text });
    this.trySendJson({ type: "thinking" });

    const abort = new AbortController();
    this.chatAbort = abort;

    try {
      const ctx: TurnContext = {
        messages: this.messages,
        toolSchemas: this.toolSchemas,
        logger: this.logger,
        callLLM: (opts) => this.deps.callLLM(opts),
        executeBuiltinTool: (name, args) =>
          this.deps.executeBuiltinTool(name, args),
        executeUserTool: this.deps.executeTool,
        apiKey: this.deps.config.apiKey,
        model: this.deps.config.model,
        gatewayBase: this.deps.config.llmGatewayBase,
      };

      const result = await executeTurn(text, ctx, abort.signal);

      this.trySendJson({
        type: "chat",
        text: result.text,
        steps: result.steps,
      });

      if (result.text) {
        this.ttsRelay(result.text);
      } else {
        this.trySendJson({ type: "tts_done" });
      }
    } catch (err) {
      if (abort.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error("Chat failed", { error: msg });
      this.trySendJson({ type: "error", message: ERR.CHAT_FAILED });
    } finally {
      if (this.chatAbort === abort) this.chatAbort = null;
    }
  }

  private ttsRelay(text: string): void {
    const abort = new AbortController();
    this.ttsAbort = abort;

    const promise = this.deps.ttsClient
      .synthesize(text, (chunk) => this.trySendBytes(chunk), abort.signal)
      .then(() => {
        if (!abort.signal.aborted) {
          this.trySendJson({ type: "tts_done" });
        }
      })
      .catch((err) => {
        if (!abort.signal.aborted) {
          this.logger.error("TTS error", { err });
          this.trySendJson({ type: "error", message: ERR.TTS_FAILED });
        }
      })
      .finally(() => {
        if (this.ttsAbort === abort) this.ttsAbort = null;
        if (this.ttsPromise === promise) this.ttsPromise = null;
      });
    this.ttsPromise = promise;
  }

  static create(
    sessionId: string,
    ws: SessionTransport,
    agentConfig: AgentConfig,
    toolSchemas: ToolSchema[],
    opts: CreateSessionOptions,
  ): ServerSession {
    const secrets = opts.secrets ?? {};
    const deps: SessionDeps = {
      config: {
        ...opts.platformConfig,
        ttsConfig: { ...opts.platformConfig.ttsConfig },
      },
      connectStt: opts.depsOverride?.connectStt ?? defaultConnectStt,
      callLLM: opts.depsOverride?.callLLM ?? defaultCallLLM,
      ttsClient: opts.depsOverride?.ttsClient ??
        new TtsClient(opts.platformConfig.ttsConfig),
      executeTool: opts.depsOverride?.executeTool ?? opts.executeTool,
      executeBuiltinTool: opts.depsOverride?.executeBuiltinTool ??
        ((name, args) => defaultExecuteBuiltinTool(name, args, secrets)),
    };
    return new ServerSession(sessionId, ws, agentConfig, toolSchemas, deps);
  }
}

export interface CreateSessionOptions {
  platformConfig: PlatformConfig;
  executeTool: ExecuteTool;
  secrets?: Record<string, string | undefined>;
  depsOverride?: Partial<SessionDeps>;
}
