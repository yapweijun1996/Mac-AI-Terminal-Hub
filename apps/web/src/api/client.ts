import { z } from "zod";
import {
  agentInfoSchema,
  healthSchema,
  projectSchema,
  sessionPath,
  sessionSchema,
  systemSchema,
  type Agent,
} from "./schema";

export type ErrorKind =
  | "auth"
  | "offline"
  | "contract"
  | "conflict"
  | "request"
  | "csrf";
export class ApiError extends Error {
  constructor(
    public kind: ErrorKind,
    message: string,
  ) {
    super(message);
  }
}
export function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "The operation could not be confirmed. Refresh before trying again.";
}

export class HubApi {
  private csrfToken: string | undefined;
  private identityEpoch = 0;
  constructor(private fetcher: typeof fetch = (...args) => fetch(...args)) {}
  clearIdentity() {
    this.csrfToken = undefined;
    this.identityEpoch++;
  }
  get canMutate() {
    return Boolean(this.csrfToken);
  }

  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    options: RequestInit = {},
  ): Promise<T> {
    const epoch = this.identityEpoch;
    const headers = new Headers(options.headers);
    headers.set("Accept", "application/json");
    if (options.method === "POST") {
      if (!this.csrfToken)
        throw new ApiError(
          "csrf",
          "Session controls are unavailable: the gateway has not supplied CSRF protection.",
        );
      headers.set("Content-Type", "application/json");
      headers.set("X-CSRF-Token", this.csrfToken);
    }
    let response: Response;
    try {
      response = await this.fetcher(path, {
        ...options,
        headers,
        credentials: "same-origin",
        mode: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: options.signal ?? AbortSignal.timeout(12_000),
      });
    } catch {
      throw new ApiError(
        "offline",
        "Gateway unreachable or sign-in redirected. Reauthenticate or retry. Host and task state are unknown.",
      );
    }
    if (response.status === 401 || response.status === 403) {
      this.clearIdentity();
      throw new ApiError(
        "auth",
        "Access denied or sign-in expired. Reauthenticate, then reconnect.",
      );
    }
    if (response.status === 409 || response.status === 423)
      throw new ApiError(
        "conflict",
        "Session is in use or changed on the host. Refresh; another browser may hold the writer.",
      );
    if (response.status >= 500)
      throw new ApiError(
        "offline",
        "The gateway or Mac mini is unavailable. Work may still be running; its state is unknown.",
      );
    if (!response.ok)
      throw new ApiError(
        "request",
        `The gateway rejected this request (${response.status}). No success was confirmed.`,
      );
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw new ApiError(
        "contract",
        "Expected an authenticated JSON response. Sign-in or gateway integration may be required.",
      );
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new ApiError("contract", "The gateway returned invalid JSON.");
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success)
      throw new ApiError(
        "contract",
        "The gateway response does not match the UI contract. No status has been inferred.",
      );
    // Bootstrap proposal: only a validated health response may supply a CSRF token.
    if (path === "/api/v1/health" && epoch === this.identityEpoch) {
      const token = response.headers.get("X-CSRF-Token");
      this.csrfToken =
        token && token.length <= 4096 && !/[\r\n]/.test(token)
          ? token
          : undefined;
    }
    return parsed.data;
  }
  health() {
    return this.request("/api/v1/health", healthSchema);
  }
  system() {
    return this.request("/api/v1/system", systemSchema);
  }
  agents() {
    return this.request("/api/v1/agents", z.array(agentInfoSchema));
  }
  projects() {
    return this.request("/api/v1/projects", z.array(projectSchema));
  }
  sessions() {
    return this.request("/api/v1/sessions", z.array(sessionSchema));
  }
  session(id: string) {
    const sessionId = sessionPath(id);
    return this.request(
      `/api/v1/sessions/${sessionId}`,
      sessionSchema.refine((session) => session.id === sessionId),
    );
  }
  createSession(
    input: { projectId: string; agent: Agent; label?: string },
    key: string,
  ) {
    return this.request(
      "/api/v1/sessions",
      sessionSchema.refine(
        (session) =>
          session.projectId === input.projectId && session.agent === input.agent,
      ),
      {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify(input),
      },
    );
  }
  registerProject(input: { name: string; canonicalPath: string }) {
    return this.request("/api/v1/projects", projectSchema, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }
  action(id: string, action: "detach" | "stop") {
    const sessionId = sessionPath(id);
    return this.request(
      `/api/v1/sessions/${sessionId}/${action}`,
      sessionSchema.refine(
        (session) =>
          session.id === sessionId &&
          session.state === (action === "stop" ? "stopped" : "detached"),
      ),
      { method: "POST", body: "{}" },
    );
  }
  terminalToken(id: string, signal?: AbortSignal) {
    return this.request(
      `/t/${sessionPath(id)}/token`,
      z.object({ token: z.string().max(4096) }),
      { signal },
    );
  }
}
export const api = new HubApi();
