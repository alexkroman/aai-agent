// emitter.ts — Typed event emitter base class for VoiceSession.

import type { AgentState, Message } from "./types.js";
import type { SessionError } from "./errors.js";

export interface SessionEventMap {
  stateChange: AgentState;
  message: Message;
  transcript: string;
  error: SessionError;
  connected: void;
  disconnected: { intentional: boolean };
  audioReady: void;
  reset: void;
}

type Handler<T> = T extends void ? () => void : (data: T) => void;

export class TypedEmitter<EventMap extends Record<string, unknown>> {
  private listeners = new Map<keyof EventMap, Set<Handler<any>>>();

  on<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return () => this.off(event, handler);
  }

  once<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): () => void {
    const wrapper = ((...args: any[]) => {
      this.off(event, wrapper as Handler<EventMap[K]>);
      (handler as any)(...args);
    }) as Handler<EventMap[K]>;
    return this.on(event, wrapper);
  }

  off<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): void {
    this.listeners.get(event)?.delete(handler);
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }

  protected emit<K extends keyof EventMap>(
    event: K,
    ...args: EventMap[K] extends void ? [] : [EventMap[K]]
  ): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      (handler as any)(...args);
    }
  }
}
