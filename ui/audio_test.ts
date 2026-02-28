import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createAudioPlayer, startMicCapture } from "./_audio_core.ts";

class MockMediaStreamTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

class MockMediaStream {
  private tracks = [new MockMediaStreamTrack()];
  getTracks() {
    return this.tracks;
  }
}

class MockMessagePort {
  onmessage: ((e: MessageEvent) => void) | null = null;
  posted: unknown[] = [];
  postMessage(data: unknown, _transfer?: Transferable[]) {
    this.posted.push(data);
  }
  simulateMessage(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
}

class MockAudioWorkletNode {
  port = new MockMessagePort();
  connected: MockAudioNode[] = [];
  name: string;
  options: unknown;
  constructor(
    _ctx: MockAudioContext,
    name: string,
    options?: unknown,
  ) {
    this.name = name;
    this.options = options;
  }
  connect(dest: MockAudioNode) {
    this.connected.push(dest);
  }
}

class MockAudioNode {
  connected: (MockAudioNode | MockAudioWorkletNode)[] = [];
  connect(dest: MockAudioNode | MockAudioWorkletNode) {
    this.connected.push(dest);
  }
}

class MockAudioContext {
  sampleRate: number;
  state: AudioContextState = "running";
  destination = new MockAudioNode();
  audioWorklet = {
    modules: [] as string[],
    addModule(url: string) {
      this.modules.push(url);
      return Promise.resolve();
    },
  };
  closed = false;

  constructor(opts?: { sampleRate?: number }) {
    this.sampleRate = opts?.sampleRate ?? 44100;
  }
  resume() {
    return Promise.resolve();
  }
  createMediaStreamSource(_stream: MockMediaStream) {
    return new MockAudioNode();
  }
  close() {
    this.closed = true;
    this.state = "closed";
    return Promise.resolve();
  }
}

class MockWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readyState: number;
  sent: unknown[] = [];

  constructor(readyState = MockWebSocket.OPEN) {
    this.readyState = readyState;
  }
  send(data: unknown) {
    this.sent.push(data);
  }
}

let origAudioContext: typeof globalThis.AudioContext;
let origAudioWorkletNode: typeof globalThis.AudioWorkletNode;
let origGetUserMedia: typeof navigator.mediaDevices.getUserMedia;
let origCreateObjectURL: typeof URL.createObjectURL;
let origRevokeObjectURL: typeof URL.revokeObjectURL;
let origWebSocket: typeof globalThis.WebSocket;

let lastContext: MockAudioContext;
let lastWorkletNode: MockAudioWorkletNode;

beforeEach(() => {
  origAudioContext = globalThis.AudioContext;
  origAudioWorkletNode = globalThis.AudioWorkletNode;
  origWebSocket = globalThis.WebSocket;
  origCreateObjectURL = URL.createObjectURL;
  origRevokeObjectURL = URL.revokeObjectURL;

  // deno-lint-ignore no-explicit-any
  const nav = globalThis.navigator as any;
  origGetUserMedia = nav?.mediaDevices?.getUserMedia;

  // Mock AudioContext
  // deno-lint-ignore no-explicit-any
  (globalThis as any).AudioContext = class extends MockAudioContext {
    constructor(opts?: { sampleRate?: number }) {
      super(opts);
      lastContext = this;
    }
  };

  // Mock AudioWorkletNode
  // deno-lint-ignore no-explicit-any
  (globalThis as any).AudioWorkletNode = class extends MockAudioWorkletNode {
    constructor(ctx: MockAudioContext, name: string, options?: unknown) {
      super(ctx, name, options);
      lastWorkletNode = this;
    }
  };

  // Mock WebSocket constants
  // deno-lint-ignore no-explicit-any
  (globalThis as any).WebSocket = MockWebSocket;

  // Mock getUserMedia
  if (!nav.mediaDevices) nav.mediaDevices = {};
  nav.mediaDevices.getUserMedia = () => Promise.resolve(new MockMediaStream());

  // Mock URL blob methods
  URL.createObjectURL = () => "blob:mock";
  URL.revokeObjectURL = () => {};
});

afterEach(() => {
  globalThis.AudioContext = origAudioContext;
  globalThis.AudioWorkletNode = origAudioWorkletNode;
  globalThis.WebSocket = origWebSocket;
  URL.createObjectURL = origCreateObjectURL;
  URL.revokeObjectURL = origRevokeObjectURL;
  // deno-lint-ignore no-explicit-any
  const nav = globalThis.navigator as any;
  if (origGetUserMedia) {
    nav.mediaDevices.getUserMedia = origGetUserMedia;
  }
});

describe("startMicCapture", () => {
  it("returns a MicCapture with close()", async () => {
    const ws = new MockWebSocket() as unknown as WebSocket;
    const mic = await startMicCapture(ws, 16000, "mock-worklet-source");
    expect(typeof mic.close).toBe("function");
    mic.close();
  });

  it("loads the capture worklet module", async () => {
    const ws = new MockWebSocket() as unknown as WebSocket;
    await startMicCapture(ws, 16000, "mock-worklet-source");
    expect(lastContext.audioWorklet.modules).toHaveLength(1);
  });

  it("creates AudioWorkletNode named 'pcm16'", async () => {
    const ws = new MockWebSocket() as unknown as WebSocket;
    await startMicCapture(ws, 16000, "mock-worklet-source");
    expect(lastWorkletNode.name).toBe("pcm16");
  });

  it("sends worklet audio frames to WebSocket when open", async () => {
    const ws = new MockWebSocket() as unknown as WebSocket;
    await startMicCapture(ws, 16000, "mock-worklet-source");

    const frame = new ArrayBuffer(3200);
    lastWorkletNode.port.simulateMessage(frame);

    expect((ws as unknown as MockWebSocket).sent).toHaveLength(1);
    expect((ws as unknown as MockWebSocket).sent[0]).toBe(frame);
  });

  it("does not send when WebSocket is closed", async () => {
    const ws = new MockWebSocket(MockWebSocket.CLOSED) as unknown as WebSocket;
    await startMicCapture(ws, 16000, "mock-worklet-source");

    lastWorkletNode.port.simulateMessage(new ArrayBuffer(3200));
    expect((ws as unknown as MockWebSocket).sent).toHaveLength(0);
  });

  it("close() stops media tracks and closes AudioContext", async () => {
    const ws = new MockWebSocket() as unknown as WebSocket;
    const mic = await startMicCapture(ws, 16000, "mock-worklet-source");

    mic.close();

    expect(lastContext.closed).toBe(true);
  });

  it("cleans up stream and context on worklet load error", async () => {
    // Override addModule to throw
    // deno-lint-ignore no-explicit-any
    (globalThis as any).AudioContext = class extends MockAudioContext {
      constructor(opts?: { sampleRate?: number }) {
        super(opts);
        lastContext = this;
        this.audioWorklet.addModule = () => Promise.reject(new Error("fail"));
      }
    };

    const ws = new MockWebSocket() as unknown as WebSocket;
    let caught = false;
    try {
      await startMicCapture(ws, 16000, "mock-worklet-source");
    } catch {
      caught = true;
    }
    expect(caught).toBe(true);
    expect(lastContext.closed).toBe(true);
  });

  it("connects source → worklet → destination", async () => {
    const ws = new MockWebSocket() as unknown as WebSocket;
    await startMicCapture(ws, 16000, "mock-worklet-source");

    expect(lastWorkletNode.connected).toContain(lastContext.destination);
  });
});

describe("createAudioPlayer", () => {
  it("returns an AudioPlayer with enqueue, flush, close", async () => {
    const player = await createAudioPlayer(24000, "mock-worklet-source");
    expect(typeof player.enqueue).toBe("function");
    expect(typeof player.flush).toBe("function");
    expect(typeof player.close).toBe("function");
    player.close();
  });

  it("creates AudioWorkletNode named 'pcm16-playback'", async () => {
    const player = await createAudioPlayer(24000, "mock-worklet-source");
    expect(lastWorkletNode.name).toBe("pcm16-playback");
    player.close();
  });

  it("enqueue() posts raw ArrayBuffer to worklet port", async () => {
    const player = await createAudioPlayer(24000, "mock-worklet-source");

    const pcm16 = new Int16Array([100, -200, 300]).buffer;
    player.enqueue(pcm16);

    expect(lastWorkletNode.port.posted).toHaveLength(1);
    expect(lastWorkletNode.port.posted[0]).toBe(pcm16);
    player.close();
  });

  it("enqueue() is a no-op when context is closed", async () => {
    const player = await createAudioPlayer(24000, "mock-worklet-source");
    player.close(); // Closes context

    player.enqueue(new ArrayBuffer(64));
    expect(lastWorkletNode.port.posted).toHaveLength(0);
  });

  it("flush() posts 'flush' string to worklet port", async () => {
    const player = await createAudioPlayer(24000, "mock-worklet-source");

    player.flush();

    expect(lastWorkletNode.port.posted).toHaveLength(1);
    expect(lastWorkletNode.port.posted[0]).toBe("flush");
    player.close();
  });

  it("close() closes the AudioContext", async () => {
    const player = await createAudioPlayer(24000, "mock-worklet-source");
    player.close();
    expect(lastContext.closed).toBe(true);
  });

  it("connects worklet to destination", async () => {
    const player = await createAudioPlayer(24000, "mock-worklet-source");
    expect(lastWorkletNode.connected).toContain(lastContext.destination);
    player.close();
  });
});
