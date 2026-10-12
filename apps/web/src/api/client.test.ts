import { describe, expect, it, vi } from "vitest";
import { HubApi } from "./client";
import { sessionSchema } from "./schema";

const session = {
  id: "fixture-1",
  label: "Example work",
  agent: "codex",
  projectId: "example",
  tmuxName: "hub-example",
  state: "detached",
  createdAt: "2026-01-01T00:00:00Z",
};
const health = { status: "online", checkedAt: "2026-01-01T00:00:00Z" };
const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", ...headers },
  });

describe("authenticated same-origin API boundary", () => {
  it("uses same-origin credentials, no redirects, and no cache", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json([session]));
    expect(await new HubApi(fetcher).sessions()).toEqual([session]);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/sessions",
      expect.objectContaining({
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
        cache: "no-store",
      }),
    );
  });
  it("fails closed on auth denial and does not display server text", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("private diagnostic", { status: 403 }));
    await expect(new HubApi(fetcher).sessions()).rejects.toMatchObject({
      kind: "auth",
    });
  });
  it("rejects HTML, malformed JSON, and malformed sessions", async () => {
    for (const response of [
      new Response("<html>login</html>"),
      new Response("{", { headers: { "Content-Type": "application/json" } }),
      json([{ ...session, state: "completed" }]),
    ]) {
      await expect(
        new HubApi(
          vi.fn<typeof fetch>().mockResolvedValue(response),
        ).sessions(),
      ).rejects.toMatchObject({ kind: "contract" });
    }
  });
  it("never infers completion and strips uncontracted fields", () => {
    expect(
      sessionSchema.safeParse({ ...session, state: "completed" }).success,
    ).toBe(false);
    expect(
      sessionSchema.parse({ ...session, transcript: "not retained" }),
    ).not.toHaveProperty("transcript");
  });
  it("refuses mutations without server-issued CSRF protection", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      new HubApi(fetcher).createSession(
        { projectId: "example", agent: "codex" },
        "example-key",
      ),
    ).rejects.toMatchObject({ kind: "csrf" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sends CSRF and a stable idempotency key, and never retries POST automatically", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(health, { "X-CSRF-Token": "fixture-only" }))
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(json(session));
    const api = new HubApi(fetcher);
    await api.health();
    await expect(
      api.createSession({ projectId: "example", agent: "codex" }, "request-1"),
    ).rejects.toMatchObject({ kind: "offline" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await api.createSession(
      { projectId: "example", agent: "codex" },
      "request-1",
    );
    const headers = fetcher.mock.calls[2][1]?.headers as Headers;
    expect(headers.get("X-CSRF-Token")).toBe("fixture-only");
    expect(headers.get("Idempotency-Key")).toBe("request-1");
  });
  it("clears CSRF after a denial and cannot be re-enabled by a stale health response", async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValueOnce(new Response("", { status: 401 }));
    const api = new HubApi(fetcher);
    const inflight = api.health();
    await expect(api.sessions()).rejects.toMatchObject({ kind: "auth" });
    resolve(json(health, { "X-CSRF-Token": "fixture-only" }));
    await inflight;
    expect(api.canMutate).toBe(false);
  });
  it("rejects route traversal and mismatched stop confirmations", async () => {
    const api = new HubApi(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(json(health, { "X-CSRF-Token": "fixture-only" })),
    );
    expect(() => api.session("../other")).toThrow();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(health, { "X-CSRF-Token": "fixture-only" }))
      .mockResolvedValueOnce(json(session));
    const other = new HubApi(fetcher);
    await other.health();
    await expect(other.action("fixture-1", "stop")).rejects.toMatchObject({
      kind: "contract",
    });
  });
  it("classifies conflict and offline failures without sensitive response content", async () => {
    for (const [status, kind] of [
      [409, "conflict"],
      [503, "offline"],
    ] as const) {
      await expect(
        new HubApi(
          vi
            .fn<typeof fetch>()
            .mockResolvedValue(new Response("secret details", { status })),
        ).sessions(),
      ).rejects.toMatchObject({ kind });
    }
  });
  it("rejects another session's detail instead of attaching to it", async () => {
    const api = new HubApi(vi.fn<typeof fetch>().mockResolvedValue(
      json({ ...session, id: "another-session" }),
    ));
    await expect(api.session(session.id)).rejects.toMatchObject({ kind: "contract" });
  });
  it("rejects another session's stop or detach confirmation", async () => {
    for (const action of ["stop", "detach"] as const) {
      const fetcher = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(json(health, { "X-CSRF-Token": "fixture-only" }))
        .mockResolvedValueOnce(json({
          ...session,
          id: "another-session",
          state: action === "stop" ? "stopped" : "detached",
        }));
      const api = new HubApi(fetcher);
      await api.health();
      await expect(api.action(session.id, action)).rejects.toMatchObject({ kind: "contract" });
    }
  });
  it("rejects session creation for a different project or agent", async () => {
    for (const mismatch of [{ projectId: "another-project" }, { agent: "claude" }]) {
      const fetcher = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(json(health, { "X-CSRF-Token": "fixture-only" }))
        .mockResolvedValueOnce(json({ ...session, ...mismatch }));
      const api = new HubApi(fetcher);
      await api.health();
      await expect(api.createSession({ projectId: "example", agent: "codex" }, "example-key"))
        .rejects.toMatchObject({ kind: "contract" });
    }
  });
});
