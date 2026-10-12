declare module 'ws' {
  import { EventEmitter } from 'node:events';
  export class WebSocketServer extends EventEmitter {
    constructor(options: { host: string; port: number });
    address(): { address: string; family: string; port: number } | string | null;
    clients: Set<WebSocket>;
    close(callback?: (error?: Error) => void): void;
  }
  export default class WebSocket extends EventEmitter {
    static OPEN: number;
    readyState: number;
    bufferedAmount: number;
    constructor(address: string, protocols?: string[], options?: { headers?: Record<string, string>; origin?: string });
    send(data: string | Buffer | Uint8Array | ArrayBuffer, options?: unknown): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
    on(event: 'message', listener: (data: Buffer, isBinary: boolean) => void): this;
    on(event: 'close', listener: (code: number, reason: Buffer) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
  }
}
