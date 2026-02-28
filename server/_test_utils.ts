import type { SessionDeps, SessionTransport } from "./session.ts";
import type { SttHandle } from "./stt.ts";
import type { ExecuteTool } from "./tool_executor.ts";
import type { PlatformConfig } from "./config.ts";
import type { CallLLMOptions } from "./llm.ts";
import type { ChatMessage, LLMResponse, ToolSchema } from "./types.ts";
import { DEFAULT_STT_CONFIG, DEFAULT_TTS_CONFIG } from "./types.ts";

export function createMockTransport(): SessionTransport & {
  sent: (string | ArrayBuffer | Uint8Array)[];
} {
  const sent: (string | ArrayBuffer | Uint8Array)[] = [];
  return {
    sent,
    readyState: 1,
    send(data: string | ArrayBuffer | Uint8Array) {
      sent.push(data);
    },
  };
}

export function getSentJson(
  transport: ReturnType<typeof createMockTransport>,
): Record<string, unknown>[] {
  return transport.sent
    .filter((d): d is string => typeof d === "string")
    .map((s) => JSON.parse(s));
}

export function createMockSttHandle(): SttHandle & {
  sentData: Uint8Array[];
  clearCalled: boolean;
  closeCalled: boolean;
} {
  const sentData: Uint8Array[] = [];
  return {
    sentData,
    clearCalled: false,
    closeCalled: false,
    send(audio: Uint8Array) {
      sentData.push(audio);
    },
    clear() {
      this.clearCalled = true;
    },
    close() {
      this.closeCalled = true;
    },
  };
}

export interface MockTtsClient {
  synthesizeCalls: { text: string }[];
  closeCalled: boolean;
  synthesize(
    text: string,
    onAudio: (chunk: Uint8Array) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  close(): void;
}

export function createMockTtsClient(): MockTtsClient {
  return {
    synthesizeCalls: [],
    closeCalled: false,
    synthesize(
      text: string,
      _onAudio: (chunk: Uint8Array) => void,
      _signal?: AbortSignal,
    ): Promise<void> {
      this.synthesizeCalls.push({ text });
      return Promise.resolve();
    },
    close() {
      this.closeCalled = true;
    },
  };
}

export function createMockExecuteTool(): ExecuteTool & {
  calls: { name: string; args: Record<string, unknown> }[];
  mockResult: string;
} {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let mockResult = '"tool result"';
  const fn = ((name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return Promise.resolve(mockResult);
  }) as ExecuteTool & {
    calls: { name: string; args: Record<string, unknown> }[];
    mockResult: string;
  };
  Object.defineProperty(fn, "calls", { get: () => calls });
  Object.defineProperty(fn, "mockResult", {
    get: () => mockResult,
    set: (v: string) => mockResult = v,
  });
  return fn;
}

export function createMockPlatformConfig(): PlatformConfig {
  return {
    apiKey: "test-api-key",
    ttsApiKey: "test-tts-key",
    sttConfig: { ...DEFAULT_STT_CONFIG },
    ttsConfig: { ...DEFAULT_TTS_CONFIG, apiKey: "test-tts-key" },
    model: "test-model",
    llmGatewayBase: "https://test-gateway.example.com/v1",
  };
}

export function createMockLLMResponse(
  content: string | null,
  toolCalls?: {
    id: string;
    name: string;
    arguments: string;
  }[],
): LLMResponse {
  const message: ChatMessage = {
    role: "assistant",
    content,
  };
  if (toolCalls) {
    message.tool_calls = toolCalls.map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.arguments },
    }));
  }
  return {
    choices: [
      {
        message,
        finish_reason: toolCalls ? "tool_calls" : "stop",
      },
    ],
  };
}

export function createMockSessionDeps(overrides?: Partial<SessionDeps>): {
  deps: SessionDeps;
  sttHandle: ReturnType<typeof createMockSttHandle>;
  ttsClient: ReturnType<typeof createMockTtsClient>;
  executeTool: ReturnType<typeof createMockExecuteTool>;
  llmCalls: {
    messages: ChatMessage[];
    tools: ToolSchema[];
  }[];
  llmResponses: LLMResponse[];
} {
  const sttHandle = createMockSttHandle();
  const ttsClient = createMockTtsClient();
  const executeTool = createMockExecuteTool();
  const llmCalls: { messages: ChatMessage[]; tools: ToolSchema[] }[] = [];
  const llmResponses: LLMResponse[] = [
    createMockLLMResponse("Hello from LLM"),
  ];
  let llmCallIndex = 0;

  const deps: SessionDeps = {
    config: createMockPlatformConfig(),
    connectStt: () => Promise.resolve(sttHandle),
    callLLM: (opts: CallLLMOptions) => {
      llmCalls.push({ messages: [...opts.messages], tools: opts.tools });
      const response = llmResponses[llmCallIndex] ??
        createMockLLMResponse("Default response");
      llmCallIndex++;
      return Promise.resolve(response);
    },
    ttsClient,
    executeTool,
    executeBuiltinTool: () => Promise.resolve(null),
    ...overrides,
  };

  return { deps, sttHandle, ttsClient, executeTool, llmCalls, llmResponses };
}

export class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  sentData: (string | ArrayBuffer | Uint8Array)[] = [];
  binaryType = "arraybuffer";
  url: string;

  constructor(
    url: string | URL,
    _protocols?: string | string[] | Record<string, unknown>,
  ) {
    this.url = typeof url === "string" ? url : url.toString();
    queueMicrotask(() => {
      if (this.readyState === MockWebSocket.CONNECTING) {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.(new Event("open"));
      }
    });
  }

  send(data: string | ArrayBuffer | Uint8Array) {
    this.sentData.push(data);
  }

  close(code?: number, _reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close", { code: code ?? 1000 }));
  }
}

export function installMockWebSocket(): {
  restore: () => void;
  created: MockWebSocket[];
} {
  const original = globalThis.WebSocket;
  const created: MockWebSocket[] = [];

  const MockWsCtor = class extends MockWebSocket {
    constructor(
      url: string | URL,
      protocols?: string | string[] | Record<string, unknown>,
    ) {
      super(url, protocols);
      created.push(this);
    }
  };

  Object.defineProperty(globalThis, "WebSocket", {
    value: MockWsCtor,
    writable: true,
    configurable: true,
  });

  return {
    created,
    restore: () => {
      Object.defineProperty(globalThis, "WebSocket", {
        value: original,
        writable: true,
        configurable: true,
      });
    },
  };
}

export function stubFetch(
  handler: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = original;
  };
}
