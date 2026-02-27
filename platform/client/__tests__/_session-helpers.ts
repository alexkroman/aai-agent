/**
 * Shared session test helpers.
 * Provides createSession() and lastWs() used across session-*.test.ts files.
 */
import { VoiceSession } from "../core.js";
import { wsInstances, type MockWebSocket } from "./_mocks.js";

export function createSession(opts: Partial<ConstructorParameters<typeof VoiceSession>[0]> = {}) {
  const stateChanges: string[] = [];
  const receivedMessages: any[] = [];
  const transcripts: string[] = [];
  const errors: string[] = [];

  const session = new VoiceSession(
    {
      apiKey: "pk_test",
      platformUrl: "ws://localhost:3000",
      ...opts,
    },
    {
      onStateChange: (state) => stateChanges.push(state),
      onMessage: (msg) => receivedMessages.push(msg),
      onTranscript: (text) => transcripts.push(text),
      onError: (message) => errors.push(message),
    }
  );

  return { session, stateChanges, receivedMessages, transcripts, errors };
}

/** Get the latest MockWebSocket instance */
export function lastWs(): MockWebSocket {
  return wsInstances[wsInstances.length - 1];
}
