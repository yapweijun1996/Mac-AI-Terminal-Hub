import { ApiError, type HubApi } from "../api/client";
import {
  closeState,
  inputFrame,
  resizeFrame,
  retryDelays,
  websocketUrl,
  type TransportState,
} from "./protocol";

export interface TerminalSink {
  size: () => { columns: number; rows: number };
  output: (data: Uint8Array, drained: () => void) => void;
  state: (state: TransportState, detail: string) => void;
  readOnly: (value: boolean) => void;
}
const MAX_BUFFER = 1024 * 1024;
const HIGH_WATER = 256 * 1024;
const LOW_WATER = 64 * 1024;

export class TerminalConnection {
  private socket?: WebSocket;
  private timer?: ReturnType<typeof setTimeout>;
  private handshakeTimer?: ReturnType<typeof setTimeout>;
  private abort?: AbortController;
  private stopped = true;
  private generation = 0;
  private retries = 0;
  private pending = 0;
  private paused = false;
  private ready = false;
  private writable = false;
  private connectedAt = 0;
  constructor(
    private id: string,
    private api: HubApi,
    private sink: TerminalSink,
    private socketFactory: (url: string, protocols: string[]) => WebSocket = (
      url,
      protocols,
    ) => new WebSocket(url, protocols),
    private origin = window.location.origin,
  ) {}

  start() {
    this.stop();
    this.stopped = false;
    this.retries = 0;
    void this.connect(this.generation);
  }
  stop() {
    this.stopped = true;
    this.generation++;
    clearTimeout(this.timer);
    clearTimeout(this.handshakeTimer);
    this.abort?.abort();
    if (this.socket) {
      this.socket.onopen =
        this.socket.onclose =
        this.socket.onmessage =
        this.socket.onerror =
          null;
      this.socket.close(1000);
    }
    this.socket = undefined;
    this.ready = this.writable = false;
    this.sink.readOnly(true);
  }
  send(data: string | Uint8Array) {
    if (
      this.ready &&
      this.writable &&
      this.socket?.readyState === WebSocket.OPEN
    ) {
      if (this.socket.bufferedAmount > HIGH_WATER) {
        this.fail(
          "error",
          "Input queue is full. Reconnect before sending more input.",
        );
        return;
      }
      this.socket.send(inputFrame(data));
    }
  }
  resize() {
    if (this.ready && this.socket?.readyState === WebSocket.OPEN) {
      const { columns, rows } = this.sink.size();
      this.socket.send(resizeFrame(columns, rows));
    }
  }
  private fail(state: TransportState, detail: string) {
    if (state === "auth") this.api.clearIdentity();
    this.stop();
    this.sink.state(state, detail);
  }
  private retry(generation: number) {
    if (this.stopped || generation !== this.generation) return;
    this.ready = this.writable = false;
    this.sink.readOnly(true);
    clearTimeout(this.handshakeTimer);
    const delay = retryDelays[this.retries++];
    if (delay === undefined) {
      this.sink.state(
        "lost",
        "Retry limit reached. Reconnect manually. Host session and task state are unknown.",
      );
      return;
    }
    this.sink.state(
      "retrying",
      `Connection lost. Retry ${this.retries}/${retryDelays.length} in ${delay / 1000}s. Work may still be running.`,
    );
    this.timer = setTimeout(() => void this.connect(generation), delay);
  }
  private async connect(generation: number) {
    if (this.stopped || generation !== this.generation) return;
    this.sink.state(
      "connecting",
      "Checking the existing host session and Access identity…",
    );
    this.abort = new AbortController();
    const timeout = setTimeout(() => this.abort?.abort(), 12_000);
    try {
      const session = await this.api.session(this.id);
      if (this.stopped || generation !== this.generation) return;
      if (session.state === "stopped" || session.tmuxAlive === false) {
        this.fail(
          "stopped",
          "The host session is stopped. Start a new session to continue.",
        );
        return;
      }
      if ((session.browserClients ?? 0) > 0) {
        this.fail(
          "busy",
          "Another browser may hold the single writer. Detach there, then reconnect here.",
        );
        return;
      }
      const { token } = await this.api.terminalToken(
        this.id,
        this.abort.signal,
      );
      if (this.stopped || generation !== this.generation) return;
      const socket = this.socketFactory(websocketUrl(this.origin, this.id), [
        "tty",
        `hub-${token}`,
      ]);
      this.socket = socket;
      this.pending = 0;
      this.paused = this.ready = this.writable = false;
      socket.binaryType = "arraybuffer";
      this.handshakeTimer = setTimeout(() => {
        if (!this.ready && this.socket === socket) socket.close(4000);
      }, 12_000);
      socket.onopen = () => {
        socket.send(
          new TextEncoder().encode(
            JSON.stringify({ AuthToken: token, ...this.sink.size() }),
          ),
        );
      };
      socket.onmessage = (event) => {
        if (this.stopped || this.socket !== socket) return;
        if (
          !(event.data instanceof ArrayBuffer) ||
          event.data.byteLength < 1 ||
          event.data.byteLength > MAX_BUFFER
        ) {
          this.fail(
            "error",
            "Unsupported or oversized terminal frame. Connection closed safely.",
          );
          return;
        }
        const bytes = new Uint8Array(event.data);
        const command = bytes[0];
        if (command === 50) {
          let preferences: unknown;
          try {
            preferences = JSON.parse(
              new TextDecoder().decode(bytes.subarray(1)),
            );
          } catch {
            this.fail("error", "Invalid terminal preferences.");
            return;
          }
          if (!preferences || typeof preferences !== "object") {
            this.fail("error", "Invalid terminal preferences.");
            return;
          }
          const disableStdin = (preferences as Record<string, unknown>)
            .disableStdin;
          if (disableStdin !== undefined && typeof disableStdin !== "boolean") {
            this.fail("error", "Invalid writer permission.");
            return;
          }
          this.writable = disableStdin !== true;
          this.sink.readOnly(!this.writable);
          this.markReady();
        } else if (command === 48) {
          // Receiving output alone is not sufficient proof of writer permission.
          this.pending += bytes.length - 1;
          if (this.pending > MAX_BUFFER) {
            this.fail(
              "error",
              "Terminal output exceeded the bounded buffer. Reconnect to resume.",
            );
            return;
          }
          if (this.pending > HIGH_WATER && !this.paused) {
            socket.send(new Uint8Array([50]));
            this.paused = true;
          }
          const length = bytes.length - 1;
          this.sink.output(bytes.subarray(1), () => {
            if (this.socket !== socket || socket.readyState !== WebSocket.OPEN)
              return;
            this.pending = Math.max(0, this.pending - length);
            if (this.paused && this.pending < LOW_WATER) {
              socket.send(new Uint8Array([51]));
              this.paused = false;
            }
          });
        } else if (command !== 49) {
          this.fail("error", "Unsupported terminal protocol.");
        }
      };
      socket.onerror = () => {
        /* Browser hides upgrade errors; session preflight provides actionable HTTP errors. */
      };
      socket.onclose = (event) => {
        if (this.stopped || this.socket !== socket) return;
        if (this.ready && Date.now() - this.connectedAt >= 30_000)
          this.retries = 0;
        const state = closeState(event.code);
        if (state) {
          this.fail(
            state,
            state === "auth"
              ? "Access expired or upgrade denied. Reauthenticate and reconnect."
              : state === "busy"
                ? "The writer is in use. Detach in the other browser before reconnecting."
                : "Terminal transport closed. Task outcome is unknown. Refresh or reconnect.",
          );
        } else this.retry(generation);
      };
    } catch (error) {
      if (this.stopped || generation !== this.generation) return;
      if (error instanceof ApiError && error.kind === "auth")
        this.fail("auth", error.message);
      else if (error instanceof ApiError && error.kind === "conflict")
        this.fail("busy", error.message);
      else if (error instanceof ApiError && error.kind !== "offline")
        this.fail("error", error.message);
      else this.retry(generation);
    } finally {
      clearTimeout(timeout);
    }
  }
  private markReady() {
    clearTimeout(this.handshakeTimer);
    if (!this.ready) {
      this.ready = true;
      this.connectedAt = Date.now();
    }
    this.sink.state(
      "connected",
      this.writable
        ? "Connected · single writer · task outcome unknown"
        : "Connected · read-only · writer unavailable",
    );
  }
}
