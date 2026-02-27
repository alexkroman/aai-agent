// _factories.ts — Shared test factories.

import { vi } from "vitest";
import type { PlatformConfig } from "../config.js";
import type { SessionDeps } from "../session.js";
import type { AgentConfig, LLMResponse } from "../types.js";

/** Build a PlatformConfig with test defaults, override any piece. */
export function createTestConfig(overrides: Partial<PlatformConfig> = {}): PlatformConfig {
  return {
    apiKey: "test-aai-key",
    ttsApiKey: "test-tts-key",
    sttConfig: {
      sampleRate: 16_000,
      speechModel: "u3-pro",
      wssBase: "wss://streaming.assemblyai.com/v3/ws",
      tokenExpiresIn: 480,
      formatTurns: true,
      minEndOfTurnSilenceWhenConfident: 400,
      maxTurnSilence: 1200,
    },
    ttsConfig: {
      wssUrl: "wss://tts.example.com/ws",
      apiKey: "test-tts-key",
      voice: "jess",
      maxTokens: 2000,
      bufferSize: 105,
      repetitionPenalty: 1.2,
      temperature: 0.6,
      topP: 0.9,
      sampleRate: 24_000,
    },
    model: "test-model",
    llmGatewayBase: "https://llm-gateway.example.com/v1",
    ...overrides,
  };
}

/** Captured STT events from the mock connectStt. */
export interface CapturedSttEvents {
  onTranscript: (text: string, isFinal: boolean) => void;
  onTurn: (text: string) => void;
  onError: (err: Error) => void;
  onClose: () => void;
}

/** Build a complete SessionDeps with mocks, override any piece. */
export function createTestDeps(overrides: Partial<SessionDeps> = {}): {
  deps: SessionDeps;
  mocks: {
    connectStt: ReturnType<typeof vi.fn>;
    callLLM: ReturnType<typeof vi.fn>;
    ttsClient: { synthesize: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
    sandbox: { execute: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };
    normalizeVoiceText: ReturnType<typeof vi.fn>;
    sttHandle: {
      send: ReturnType<typeof vi.fn>;
      clear: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };
  };
  /** Gets the STT events captured by the mock connectStt. Set after session.start(). */
  getSttEvents: () => CapturedSttEvents;
} {
  const sttHandle = {
    send: vi.fn(),
    clear: vi.fn(),
    close: vi.fn(),
  };

  let capturedSttEvents: CapturedSttEvents | null = null;

  const mockConnectStt = vi.fn(
    async (_apiKey: string, _config: unknown, events: CapturedSttEvents) => {
      capturedSttEvents = events;
      return sttHandle;
    }
  );

  const mockCallLLM = vi.fn();

  const mockTtsClient = {
    synthesize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  };

  const mockSandbox = {
    execute: vi.fn(),
    dispose: vi.fn(),
  };

  const mockNormalizeVoiceText = vi.fn((text: string) => text);

  const deps: SessionDeps = {
    config: createTestConfig(),
    connectStt: overrides.connectStt ?? mockConnectStt,
    callLLM: overrides.callLLM ?? mockCallLLM,
    ttsClient: overrides.ttsClient ?? (mockTtsClient as any),
    sandbox: overrides.sandbox ?? (mockSandbox as any),
    normalizeVoiceText: overrides.normalizeVoiceText ?? mockNormalizeVoiceText,
    ...overrides,
  };

  return {
    deps,
    mocks: {
      connectStt: mockConnectStt,
      callLLM: mockCallLLM,
      ttsClient: mockTtsClient,
      sandbox: mockSandbox,
      normalizeVoiceText: mockNormalizeVoiceText,
      sttHandle,
    },
    getSttEvents: () => {
      if (!capturedSttEvents)
        throw new Error("STT events not captured yet — call session.start() first");
      return capturedSttEvents;
    },
  };
}

/** Shared default agent config for tests. */
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  instructions: "You are a test assistant.",
  greeting: "Hello!",
  voice: "jess",
  tools: [],
};

/** Build an LLM response with text content. */
export function llmResponse(content: string): LLMResponse {
  return {
    id: "resp-1",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
  };
}

/** Build an LLM response with tool calls. */
export function llmToolCallResponse(
  toolCalls: { name: string; args: Record<string, unknown> }[]
): LLMResponse {
  return {
    id: "resp-tc",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: toolCalls.map((tc, i) => ({
            id: `tc-${i}`,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args),
            },
          })),
        },
        finish_reason: "tool_use",
      },
    ],
  };
}
