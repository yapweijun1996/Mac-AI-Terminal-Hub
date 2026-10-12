import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";

// All browser responses below are synthetic test fixtures. No backend or CLI is launched.
const timestamp = "2026-01-01T00:00:00Z";
const project = {
  id: "fixture-project",
  name: "Example repository with a deliberately long display name",
  canonicalPath: "/Users/EXAMPLE/Projects/" + "example-".repeat(40),
  createdAt: timestamp,
  branch: "example-feature",
  dirty: false,
};
const initialSession = {
  id: "fixture-session",
  label: "Example session with a long descriptive title for responsive testing",
  agent: "codex",
  projectId: project.id,
  tmuxName: "fixture-tmux",
  state: "detached",
  createdAt: timestamp,
  tmuxAlive: true,
  browserClients: 0,
};
async function gateway(
  page: Page,
  mode: "ok" | "offline" | "denied" | "no-csrf" = "ok",
) {
  await page.addInitScript(() => {
    const stateTrace: { elapsedMs: number; state: string }[] = [];
    const startedAt = performance.now();
    Object.defineProperty(window, "__terminalStateTrace", {
      value: stateTrace,
    });
    const observeState = () => {
      const state = document.querySelector(
        ".terminal-status .badge",
      )?.textContent?.trim();
      if (state && stateTrace.at(-1)?.state !== state)
        stateTrace.push({
          elapsedMs: Math.round(performance.now() - startedAt),
          state,
        });
    };
    // Init scripts run before documentElement is guaranteed to exist; Document is always a valid Node.
    new MutationObserver(observeState).observe(document, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    document.addEventListener("DOMContentLoaded", () => {
      const banner = document.createElement("div");
      banner.textContent = "SYNTHETIC TEST FIXTURES · No host or CLI connected";
      banner.style.cssText =
        "padding:10px;background:#493718;color:#ffe1a0;font:12px sans-serif;text-align:center";
      document.body.prepend(banner);
    });
  });
  const sessions = [{ ...initialSession }];
  const startedAt = Date.now();
  const timeline: { elapsedMs: number; event: string }[] = [];
  const record = (event: string) =>
    timeline.push({ elapsedMs: Date.now() - startedAt, event });
  const posts: { path: string; key?: string }[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    record(`${request.method()} ${path}`);
    if (mode === "offline") {
      await route.fulfill({ status: 503 });
      return;
    }
    if (mode === "denied") {
      await route.fulfill({ status: 403 });
      return;
    }
    let body: unknown;
    if (request.method() === "POST") {
      posts.push({ path, key: request.headers()["idempotency-key"] });
      expect(request.headers()["x-csrf-token"]).toBe("fixture-csrf");
      if (path.endsWith("/stop")) {
        sessions[0].state = "stopped";
        sessions[0].tmuxAlive = false;
        body = sessions[0];
      } else if (path.endsWith("/detach")) {
        sessions[0].state = "detached";
        body = sessions[0];
      } else if (path.endsWith("/sessions")) {
        const input = request.postDataJSON();
        const item = {
          ...initialSession,
          id: "fixture-created",
          label: input.label || "Example created session",
          agent: input.agent,
        };
        sessions.push(item);
        body = item;
      } else body = project;
    } else if (path.endsWith("/health"))
      body = {
        status: "online",
        checkedAt: timestamp,
        services: {
          gateway: "online",
          cloudflared: "unknown",
          tmux: "online",
          ttyd: "online",
        },
      };
    else if (path.endsWith("/system"))
      body = {
        state: "online",
        observedAt: timestamp,
        cpuPercent: 12.4,
        memoryUsedBytes: 8 * 1024 ** 3,
        memoryTotalBytes: 32 * 1024 ** 3,
        diskFreeBytes: 150 * 1024 ** 3,
        uptimeSeconds: 3600,
      };
    else if (path.endsWith("/agents"))
      body = ["codex", "claude", "pi"].map((agent) => ({
        agent,
        installed: true,
        authenticated: null,
      }));
    else if (path.endsWith("/projects")) body = [project];
    else if (path.endsWith("/sessions")) body = sessions;
    else body = sessions.find((session) => path.endsWith("/" + session.id));
    await route.fulfill({
      json: body,
      headers: mode === "no-csrf" ? {} : { "X-CSRF-Token": "fixture-csrf" },
    });
  });
  await page.route("**/t/*/token", (route) => {
    record("terminal token fulfilled");
    return route.fulfill({ json: { token: "fixture-terminal-only" } });
  });
  const socketMessages: Buffer[] = [];
  const sockets: WebSocketRoute[] = [];
  const handshakes: Promise<void>[] = [];
  await page.routeWebSocket("**/t/*/ws", (socket) => {
    sockets.push(socket);
    record(`WebSocket ${sockets.length} route attached`);
    let resolveHandshake!: () => void;
    handshakes.push(
      new Promise<void>((resolve) => {
        resolveHandshake = resolve;
      }),
    );
    let greeted = false;
    socket.onMessage((message) => {
      const bytes =
        typeof message === "string" ? Buffer.from(message) : message;
      socketMessages.push(bytes);
      if (bytes[0] === 123 && !greeted) {
        let hello: unknown;
        try {
          hello = JSON.parse(bytes.toString("utf8"));
        } catch {
          throw new Error("Terminal fixture received an invalid hello frame");
        }
        expect(hello).toMatchObject({ AuthToken: "fixture-terminal-only" });
        greeted = true;
        record(`WebSocket ${sockets.length} verified client hello`);
        // routeWebSocket delivers only after the browser has installed its
        // message listener; send ttyd binary command frames only after hello.
        socket.send(Buffer.from('2{"disableStdin":false}'));
        record(`WebSocket ${sockets.length} preferences sent`);
        socket.send(
          Buffer.from("0Synthetic test fixture — no real host connected\r\n"),
        );
        record(`WebSocket ${sockets.length} output sent`);
        resolveHandshake();
      }
    });
  });
  return { posts, socketMessages, sockets, handshakes, timeline };
}

async function waitForHandshake(
  page: Page,
  fixture: Awaited<ReturnType<typeof gateway>>,
  index: number,
) {
  try {
    await expect
      .poll(() => fixture.sockets.length, {
        timeout: 10_000,
        intervals: [50, 100, 250, 500],
        message: `WebSocket ${index + 1} was not routed`,
      })
      .toBe(index + 1);
    await expect
      .poll(() => fixture.handshakes.length, {
        timeout: 2_000,
        intervals: [25, 50, 100],
        message: `WebSocket ${index + 1} hello waiter was not registered`,
      })
      .toBe(index + 1);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        fixture.handshakes[index],
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`WebSocket ${index + 1} hello timed out`)),
            10_000,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  } catch (error) {
    const state = await page
      .locator(".terminal-status .badge")
      .textContent()
      .catch(() => "<no terminal badge>");
    const stateTrace = await page
      .evaluate(
        () =>
          (window as Window & {
            __terminalStateTrace?: { elapsedMs: number; state: string }[];
          }).__terminalStateTrace ?? [],
      )
      .catch(() => []);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; ` +
        `state=${state}; sockets=${fixture.sockets.length}; ` +
        `handshakes=${fixture.handshakes.length}; stateTrace=${JSON.stringify(stateTrace)}; ` +
        `timeline=${JSON.stringify(fixture.timeline)}`,
    );
  }
}

async function waitForConnected(
  page: Page,
  fixture: Awaited<ReturnType<typeof gateway>>,
  index: number,
) {
  try {
    await expect
      .poll(
        () => page.locator(".terminal-status .badge").textContent(),
        {
          timeout: 10_000,
          intervals: [50, 100, 250, 500],
          message: `WebSocket ${index + 1} did not reach connected after hello`,
        },
      )
      .toBe("connected");
  } catch (error) {
    const stateTrace = await page
      .evaluate(
        () =>
          (window as Window & {
            __terminalStateTrace?: { elapsedMs: number; state: string }[];
          }).__terminalStateTrace ?? [],
      )
      .catch(() => []);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; ` +
        `stateTrace=${JSON.stringify(stateTrace)}; ` +
        `timeline=${JSON.stringify(fixture.timeline)}`,
    );
  }
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}
async function navigate(page: Page, view: string) {
  const isMobile = (page.viewportSize()?.width ?? 0) < 768;
  if (isMobile && ["Sessions", "Settings"].includes(view)) {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page
      .getByRole("navigation", { name: "More navigation" })
      .getByRole("button", { name: view, exact: true })
      .click();
  } else
    await page
      .getByRole("navigation", {
        name: isMobile ? "Mobile navigation" : "Main navigation",
      })
      .getByRole("button", { name: view, exact: true })
      .click();
}
for (const viewport of [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 1440, height: 1000 },
]) {
  test(`all screens and real xterm layout fit ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const { socketMessages } = await gateway(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    await page.goto("/");
    await expect(page.getByText("12.4%")).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      path: `/private/tmp/terminal-hub-overview-${viewport.width}.png`,
      fullPage: true,
    });
    for (const view of [
      "Sessions",
      "Projects",
      "Monitor",
      "Settings",
      "Terminal",
    ]) {
      await navigate(page, view);
      await noOverflow(page);
    }
    await page.getByRole("button", { name: initialSession.label }).click();
    await expect(page.locator(".terminal-status .badge")).toHaveText(
      "connected",
    );
    await noOverflow(page);
    await page.getByRole("button", { name: "Ctrl+C", exact: true }).click();
    await expect
      .poll(() =>
        socketMessages.some((bytes) => bytes.equals(Buffer.from([48, 3]))),
      )
      .toBe(true);
    await page.getByRole("button", { name: "Ctrl", exact: true }).click();
    await page.locator(".xterm-helper-textarea").press("c");
    await expect
      .poll(
        () =>
          socketMessages.filter((bytes) => bytes.equals(Buffer.from([48, 3])))
            .length,
      )
      .toBeGreaterThan(1);
    await page.getByRole("button", { name: "Paste", exact: true }).click();
    await page.getByLabel("Paste text (review before sending)").fill("example");
    await noOverflow(page);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `/private/tmp/terminal-hub-terminal-${viewport.width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "New session", exact: false })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await noOverflow(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
test("stop requires confirmation; create is single-shot; hash resumes session after reload", async ({
  page,
}) => {
  const { posts } = await gateway(page);
  await page.goto("/");
  await expect(page.getByText("12.4%")).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  expect(posts).toHaveLength(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Keep running" })
    .click();
  expect(posts).toHaveLength(0);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Stop session", exact: true })
    .click();
  await expect.poll(() => posts.length).toBe(1);
  await expect(
    page.getByText("Stop confirmed by gateway.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "New session", exact: false })
    .first()
    .click();
  await page.getByLabel("Session label (optional)").fill("Example creation");
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .dblclick();
  await expect
    .poll(() => posts.filter((post) => post.path === "/api/v1/sessions").length)
    .toBe(1);
  expect(
    posts.find((post) => post.path === "/api/v1/sessions")?.key,
  ).toBeTruthy();
  await expect(page.locator(".terminal-status .badge")).toHaveText("connected");
  await page.reload();
  await expect(page.locator(".terminal-status .badge")).toHaveText("connected");
  expect(page.url()).toContain("#terminal/fixture-created");
});
for (const mode of ["offline", "denied", "no-csrf"] as const) {
  test(`honest ${mode} state disables session creation without demo fallback`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gateway(page, mode);
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "New session", exact: false }).first(),
    ).toBeDisabled();
    if (mode === "offline")
      await expect(
        page.getByText("Gateway unavailable / status unknown"),
      ).toBeVisible();
    if (mode === "denied")
      await expect(
        page.getByText("Access denied or expired", { exact: true }),
      ).toBeVisible();
    if (mode === "no-csrf")
      await expect(
        page.getByText("Read-only:", { exact: false }),
      ).toBeVisible();
    await noOverflow(page);
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  });
}

test("connection loss resumes the same session and auth revocation removes the terminal", async ({
  page,
}) => {
  const fixture = await gateway(page);
  const { sockets, posts } = fixture;
  await page.goto("/#terminal/fixture-session");
  await waitForHandshake(page, fixture, 0);
  await waitForConnected(page, fixture, 0);
  sockets[0].close({ code: 1011, reason: "Synthetic network interruption" });
  await expect(
    page.getByText("Connection lost. Retry", { exact: false }),
  ).toBeVisible();
  await expect
    .poll(() => sockets.length, {
      timeout: 10_000,
      intervals: [50, 100, 250, 500],
    })
    .toBe(2);
  await waitForHandshake(page, fixture, 1);
  await waitForConnected(page, fixture, 1);
  expect(sockets).toHaveLength(2);
  expect(page.url()).toContain("#terminal/fixture-session");
  expect(posts).toHaveLength(0);
  await expect(
    page.getByText("Host session: detached · Task outcome: unknown"),
  ).toBeVisible();
  sockets[1].close({ code: 1008, reason: "Synthetic Access expiry" });
  await expect(
    page.getByText("Access denied or expired", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".terminal-screen")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "New session", exact: false }).first(),
  ).toBeDisabled();
});
