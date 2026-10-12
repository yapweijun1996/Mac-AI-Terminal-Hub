import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, type HubApi } from "../api/client";
import { TerminalConnection, type TerminalSink } from "./connection";
import { controlKey, inputFrame, retryDelays, websocketUrl } from "./protocol";

class Socket {
  readyState = WebSocket.OPEN;
  bufferedAmount = 0;
  binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  frame(text: string) {
    const bytes = new TextEncoder().encode(text);
    const data = new ArrayBuffer(bytes.length);
    new Uint8Array(data).set(bytes);
    this.onmessage?.({ data });
  }
}
function setup(overrides: Record<string, unknown> = {}) {
  const api = {
    session: vi
      .fn()
      .mockResolvedValue({ id: "example", state: "detached", ...overrides }),
    terminalToken: vi.fn().mockResolvedValue({ token: "fixture" }),
    clearIdentity: vi.fn(),
  };
  const sink: TerminalSink = {
    size: () => ({ columns: 80, rows: 24 }),
    output: vi.fn((_bytes, drained) => drained()),
    state: vi.fn(),
    readOnly: vi.fn(),
  };
  const sockets: Socket[] = [];
  const factory = vi.fn(() => {
    const socket = new Socket();
    sockets.push(socket);
    return socket as unknown as WebSocket;
  });
  const connection = new TerminalConnection(
    "example",
    api as unknown as HubApi,
    sink,
    factory,
    "https://example.test",
  );
  return { api, sink, sockets, factory, connection };
}
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
afterEach(() => {
  vi.useRealTimers();
});

describe("terminal lifetime and wire protocol", () => {
  it("uses same-origin ttyd paths and UTF-8 input frames", () => {
    expect(websocketUrl("https://example.test", "session-1")).toBe(
      "wss://example.test/t/session-1/ws",
    );
    expect(() => websocketUrl("https://example.test", "../evil")).toThrow();
    expect(new TextDecoder().decode(inputFrame("你好"))).toBe("0你好");
    expect(controlKey("c", true, false)).toBe("\x03");
    expect(controlKey("Tab", false, false)).toBe("\t");
    expect(controlKey("Esc", false, false)).toBe("\x1b");
  });
  it("checks session, fetches ephemeral token, waits for writer preferences, and resizes", async () => {
    const { connection, sockets, factory, sink } = setup();
    connection.start();
    await settle();
    expect(factory).toHaveBeenCalledWith("wss://example.test/t/example/ws", [
      "tty",
      "hub-fixture",
    ]);
    sockets[0].onopen?.();
    expect(
      JSON.parse(new TextDecoder().decode(sockets[0].send.mock.calls[0][0])),
    ).toEqual({ AuthToken: "fixture", columns: 80, rows: 24 });
    connection.send("c");
    expect(sockets[0].send).toHaveBeenCalledTimes(1);
    sockets[0].frame('2{"disableStdin":false}');
    connection.send("\x03");
    expect(new TextDecoder().decode(sockets[0].send.mock.calls[1][0])).toBe(
      "0\x03",
    );
    sockets[0].frame("0hello");
    expect(sink.output).toHaveBeenCalled();
    connection.resize();
    expect(new TextDecoder().decode(sockets[0].send.mock.calls[2][0])).toBe(
      '1{"columns":80,"rows":24}',
    );
    connection.stop();
    expect(sockets[0].close).toHaveBeenCalledWith(1000);
  });
  it("accepts preferences returned immediately to the first hello", async () => {
    const { connection, sockets, sink } = setup();
    connection.start();
    await settle();
    const socket = sockets[0];
    socket.send.mockImplementation(() => {
      socket.frame('2{"disableStdin":false}');
    });

    socket.onopen?.();

    expect(sink.readOnly).toHaveBeenLastCalledWith(false);
    expect(sink.state).toHaveBeenLastCalledWith(
      "connected",
      expect.stringContaining("single writer"),
    );
    connection.stop();
  });
  it("stays connecting and read-only until delayed writer preferences arrive", async () => {
    const { connection, sockets, sink } = setup();
    connection.start();
    await settle();
    sockets[0].onopen?.();
    connection.send("must not be sent yet");

    expect(sink.state).toHaveBeenLastCalledWith(
      "connecting",
      expect.any(String),
    );
    expect(sink.readOnly).toHaveBeenLastCalledWith(true);
    expect(sockets[0].send).toHaveBeenCalledTimes(1);

    sockets[0].frame('2{"disableStdin":false}');
    expect(sink.state).toHaveBeenLastCalledWith(
      "connected",
      expect.stringContaining("single writer"),
    );
    connection.stop();
  });
  it("keeps read-only permissions and does not take over another writer", async () => {
    const readOnly = setup();
    readOnly.connection.start();
    await settle();
    readOnly.sockets[0].frame('2{"disableStdin":true}');
    readOnly.connection.send("danger");
    expect(readOnly.sockets[0].send).not.toHaveBeenCalled();
    readOnly.connection.stop();
    const busy = setup({ browserClients: 1 });
    busy.connection.start();
    await settle();
    expect(busy.factory).not.toHaveBeenCalled();
    expect(busy.sink.state).toHaveBeenLastCalledWith(
      "busy",
      expect.any(String),
    );
  });
  it("reconnects only to the same session with five bounded retries, never reports completion", async () => {
    vi.useFakeTimers();
    const { connection, sockets, api, sink } = setup();
    connection.start();
    await settle();
    for (let index = 0; index < retryDelays.length; index++) {
      sockets[index].onclose?.({ code: 1006 });
      await vi.advanceTimersByTimeAsync(retryDelays[index]);
      await settle();
    }
    sockets.at(-1)!.onclose?.({ code: 1006 });
    expect(sockets).toHaveLength(6);
    expect(api.session).toHaveBeenCalledTimes(6);
    expect(api.session.mock.calls.every((call) => call[0] === "example")).toBe(
      true,
    );
    expect(sink.state).toHaveBeenLastCalledWith(
      "lost",
      expect.stringContaining("unknown"),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(6);
    connection.stop();
  });
  it("does not reconnect after auth denial, stopped session, or explicit detach", async () => {
    vi.useFakeTimers();
    const denied = setup();
    denied.api.session.mockRejectedValue(new ApiError("auth", "expired"));
    denied.connection.start();
    await settle();
    expect(denied.sink.state).toHaveBeenLastCalledWith("auth", "expired");
    expect(denied.factory).not.toHaveBeenCalled();
    const stopped = setup({ state: "stopped" });
    stopped.connection.start();
    await settle();
    expect(stopped.factory).not.toHaveBeenCalled();
    const detached = setup();
    detached.connection.start();
    await settle();
    detached.sockets[0].onclose?.({ code: 1006 });
    detached.connection.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(detached.sockets).toHaveLength(1);
  });
  it("closes on denied upgrade, excessive input queue, or excessive output", async () => {
    const denied = setup();
    denied.connection.start();
    await settle();
    denied.sockets[0].onclose?.({ code: 1008 });
    expect(denied.sink.state).toHaveBeenLastCalledWith(
      "auth",
      expect.any(String),
    );
    const queue = setup();
    queue.connection.start();
    await settle();
    queue.sockets[0].frame("2{}");
    queue.sockets[0].bufferedAmount = 300_000;
    queue.connection.send("x");
    expect(queue.sink.state).toHaveBeenLastCalledWith(
      "error",
      expect.stringContaining("queue"),
    );
    const large = setup();
    large.connection.start();
    await settle();
    large.sockets[0].onmessage?.({ data: new ArrayBuffer(2 * 1024 * 1024) });
    expect(large.sink.state).toHaveBeenLastCalledWith(
      "error",
      expect.stringContaining("oversized"),
    );
  });
  it("pauses output until rendered and resumes below the low-water threshold", async () => {
    const sample = setup();
    let drained!: () => void;
    sample.sink.output = vi.fn((_bytes, callback) => {
      drained = callback;
    });
    sample.connection.start();
    await settle();
    sample.sockets[0].frame("0" + "x".repeat(300_000));
    expect(sample.sockets[0].send).toHaveBeenLastCalledWith(
      new Uint8Array([50]),
    );
    drained();
    expect(sample.sockets[0].send).toHaveBeenLastCalledWith(
      new Uint8Array([51]),
    );
    sample.connection.stop();
  });
  it("cancels a pending attach without opening a late socket", async () => {
    const sample = setup();
    let resolve!: (value: { token: string }) => void;
    sample.api.terminalToken.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    sample.connection.start();
    await settle();
    sample.connection.stop();
    resolve({ token: "fixture" });
    await settle();
    expect(sample.factory).not.toHaveBeenCalled();
  });
});
