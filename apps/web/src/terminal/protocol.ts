import { sessionPath } from "../api/schema";

export const retryDelays = [1000, 2000, 4000, 8000, 15000] as const;
export type TransportState =
  | "detached"
  | "connecting"
  | "connected"
  | "retrying"
  | "lost"
  | "auth"
  | "busy"
  | "stopped"
  | "error";
export function websocketUrl(origin: string, id: string): string {
  const url = new URL(`/t/${sessionPath(id)}/ws`, origin);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("Unsupported origin");
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}
export function inputFrame(data: string | Uint8Array): Uint8Array {
  const body = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const frame = new Uint8Array(body.length + 1);
  frame[0] = 48;
  frame.set(body, 1);
  return frame;
}
export function resizeFrame(columns: number, rows: number): Uint8Array {
  return new TextEncoder().encode("1" + JSON.stringify({ columns, rows }));
}
export function controlKey(key: string, ctrl: boolean, alt: boolean): string {
  const special: Record<string, string> = {
    Esc: "\x1b",
    Tab: "\t",
    "←": "\x1b[D",
    "→": "\x1b[C",
    "↑": "\x1b[A",
    "↓": "\x1b[B",
  };
  let data = special[key] ?? key;
  if (ctrl && /^[a-zA-Z@[\]\\^_]$/.test(data))
    data = String.fromCharCode(data.toUpperCase().charCodeAt(0) & 31);
  return (alt ? "\x1b" : "") + data;
}
export function closeState(code: number): TransportState | undefined {
  if ([1008, 4401, 4403].includes(code)) return "auth";
  if (code === 1013) return "busy";
  if (code === 1000) return "lost";
  return undefined;
}
