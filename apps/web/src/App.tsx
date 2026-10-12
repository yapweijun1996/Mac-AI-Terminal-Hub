import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { api, ApiError, errorMessage } from "./api/client";
import {
  agents,
  agentNames,
  type Agent,
  type HubSession,
  type Project,
} from "./api/schema";
import { useHub, type Resource } from "./hooks/useHub";
import { Dialog } from "./components/Dialog";

const TerminalPane = lazy(() => import("./components/TerminalPane"));
const views = [
  "Overview",
  "Terminal",
  "Sessions",
  "Projects",
  "Monitor",
  "Settings",
] as const;
type View = (typeof views)[number];
const symbols: Record<View, string> = {
  Overview: "▦",
  Terminal: "⌘",
  Sessions: "◷",
  Projects: "▤",
  Monitor: "▥",
  Settings: "⚙",
};
function initialRoute(): { view: View; session?: string } {
  const parts = location.hash.slice(1).split("/");
  const view =
    views.find((item) => item.toLowerCase() === parts[0]) ?? "Overview";
  return {
    view,
    session:
      parts[1] && /^[A-Za-z0-9_-]{1,160}$/.test(parts[1])
        ? parts[1]
        : undefined,
  };
}
function bytes(value: number | null | undefined) {
  return value == null ? "Unknown" : `${(value / 1024 ** 3).toFixed(1)} GB`;
}
function time(value?: string) {
  return value ? new Date(value).toLocaleString() : "Unknown";
}
function StateNotice<T>({
  resource,
  empty,
}: {
  resource: Resource<T>;
  empty?: boolean;
}) {
  if (resource.error)
    return (
      <p className="inline-error" role="status">
        {resource.error.message}
        {resource.data ? " Last observation is stale." : ""}
      </p>
    );
  if (resource.loading && !resource.data)
    return (
      <p className="muted" role="status">
        Loading from gateway…
      </p>
    );
  return empty ? (
    <p className="empty">
      No records yet. Register a project, then start a session.
    </p>
  ) : null;
}

export default function App() {
  const { data, denied, deny, refresh } = useHub();
  const route = initialRoute();
  const [view, setView] = useState<View>(route.view);
  const [selected, setSelected] = useState<string | undefined>(route.session);
  const [terminalIds, setTerminalIds] = useState<string[]>([]);
  const [agentFilter, setAgentFilter] = useState<Agent>("codex");
  const [menu, setMenu] = useState(false);
  const [newSession, setNewSession] = useState(false);
  const [register, setRegister] = useState(false);
  const [stopTarget, setStopTarget] = useState<HubSession>();
  const [projectId, setProjectId] = useState("");
  const [newAgent, setNewAgent] = useState<Agent>("codex");
  const [label, setLabel] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [notice, setNotice] = useState("");
  const [fontSize, setFontSize] = useState(14);
  const mutationLock = useRef(false);
  const createKey = useRef<string | undefined>(undefined);
  const heading = useRef<HTMLHeadingElement>(null);
  const sessions = data.sessions.data ?? [];
  const projects = data.projects.data ?? [];
  const activeSession = sessions.find((session) => session.id === selected);
  const currentProject = projects.find(
    (project) => project.id === activeSession?.projectId,
  );
  const canControl =
    !denied &&
    api.canMutate &&
    data.health.data?.status === "online" &&
    data.system.data?.state !== "offline" &&
    !data.health.error &&
    !data.sessions.error &&
    !data.projects.error;
  const canAttach =
    !denied &&
    data.health.data?.status === "online" &&
    data.system.data?.state !== "offline" &&
    !data.health.error &&
    !data.sessions.error;
  const hostState = denied
    ? "Access denied"
    : data.system.error
      ? "Unreachable / unknown"
      : (data.system.data?.state ?? "Unknown");
  const loading = Object.values(data).some((resource) => resource.loading);

  const navigate = (next: View, sessionId?: string) => {
    setView(next);
    setMenu(false);
    if (sessionId) setSelected(sessionId);
    location.hash =
      next.toLowerCase() +
      (next === "Terminal" && (sessionId ?? selected)
        ? `/${sessionId ?? selected}`
        : "");
    requestAnimationFrame(() => heading.current?.focus());
  };
  useEffect(() => {
    const change = () => {
      const next = initialRoute();
      setView(next.view);
      if (next.session) setSelected(next.session);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    document.title = `${view} · Mac AI Terminal Hub`;
  }, [view]);
  useEffect(() => {
    if (activeSession) setAgentFilter(activeSession.agent);
    if (
      view === "Terminal" &&
      selected &&
      sessions.some((session) => session.id === selected)
    ) {
      setTerminalIds((previous) =>
        previous.includes(selected)
          ? previous
          : [...previous.slice(-3), selected],
      );
    }
  }, [view, selected, data.sessions.data]);
  useEffect(() => {
    if (denied) {
      setTerminalIds([]);
      setSelected(undefined);
      setNewSession(false);
      setRegister(false);
      setStopTarget(undefined);
    }
  }, [denied]);
  const openNew = (project?: Project) => {
    createKey.current = undefined;
    setLabel("");
    setOperationError("");
    setProjectId(project?.id ?? projects[0]?.id ?? "");
    setNewAgent(agentFilter);
    setNewSession(true);
  };
  const mutate = async (
    operation: () => Promise<unknown>,
    success: (result: unknown) => void,
  ) => {
    if (mutationLock.current || !canControl) return;
    mutationLock.current = true;
    setPending(true);
    setOperationError("");
    setNotice("");
    try {
      const result = await operation();
      success(result);
      await refresh();
    } catch (error) {
      if (error instanceof ApiError && error.kind === "auth") deny();
      setOperationError(errorMessage(error));
    } finally {
      mutationLock.current = false;
      setPending(false);
    }
  };
  const create = (event: FormEvent) => {
    event.preventDefault();
    createKey.current ??= crypto.randomUUID();
    void mutate(
      () =>
        api.createSession(
          {
            projectId,
            agent: newAgent,
            ...(label.trim() ? { label: label.trim() } : {}),
          },
          createKey.current!,
        ),
      (result) => {
        const session = result as HubSession;
        setNewSession(false);
        setAgentFilter(session.agent);
        setNotice(
          "Session creation confirmed by gateway. Connect to inspect CLI state.",
        );
        navigate("Terminal", session.id);
      },
    );
  };
  const sessionRows = (items: HubSession[]) => (
    <div className="session-list">
      {items.map((session) => (
        <article className="session-row" key={session.id}>
          <div>
            <h3>{session.label}</h3>
            <p>
              {agentNames[session.agent]} ·{" "}
              {projects.find((project) => project.id === session.projectId)
                ?.name ?? "Project unknown"}
            </p>
            <small>Started {time(session.createdAt)}</small>
          </div>
          <div className="session-actions">
            <span className="badge">{session.state} · host observation</span>
            <button
              onClick={() => {
                setAgentFilter(session.agent);
                navigate("Terminal", session.id);
              }}
            >
              Open
            </button>
            <button
              className="danger"
              disabled={!canControl || pending || session.state === "stopped"}
              onClick={() => {
                setOperationError("");
                setStopTarget(session);
              }}
            >
              Stop
            </button>
          </div>
        </article>
      ))}
    </div>
  );
  const nav = (items: readonly View[]) =>
    items.map((item) => (
      <button
        key={item}
        aria-current={view === item ? "page" : undefined}
        onClick={() => navigate(item)}
      >
        <span aria-hidden="true">{symbols[item]}</span>
        {item}
      </button>
    ));

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to workspace
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-symbol">⌘</span>
          <div>
            Mac AI Terminal<small>Personal control hub</small>
          </div>
        </div>
        <span className="eyebrow">WORKSPACE</span>
        <nav aria-label="Main navigation">{nav(views)}</nav>
        <div className="sidebar-host">
          <strong>Mac mini</strong>
          <span className="badge">{hostState}</span>
          <small>
            Live observations only
            <br />
            Private runtime · public source
          </small>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button
            className="menu-button"
            aria-label="Open navigation"
            aria-expanded={menu}
            onClick={() => setMenu((value) => !value)}
          >
            ☰
          </button>
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>{view}</strong>
          </div>
          <span
            className={`badge host-badge ${hostState === "online" ? "good" : ""}`}
          >
            {hostState}
          </span>
          <a
            className="access-link"
            href="/cdn-cgi/access/logout"
            aria-label="Sign out of Cloudflare Access"
          >
            Sign out
          </a>
        </header>
        {menu && (
          <nav className="mobile-menu" aria-label="More navigation">
            {nav(views)}
          </nav>
        )}
        <main id="main" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <span className="eyebrow">MAC MINI WORKSPACE</span>
              <h1 ref={heading} tabIndex={-1}>
                {view === "Overview"
                  ? "Your coding workspace"
                  : view === "Terminal"
                    ? "Terminal workspace"
                    : view}
              </h1>
              <p>
                {view === "Overview"
                  ? "Agent sessions, projects and host observations in one place."
                  : view === "Terminal"
                    ? "Resume a host session. Browser transport is separate from task outcome."
                    : "Authenticated gateway data. Unavailable observations stay unknown."}
              </p>
            </div>
            <div className="heading-actions">
              <button
                onClick={() => void refresh()}
                disabled={loading || pending}
              >
                {loading ? "Refreshing…" : "Refresh"}
              </button>
              {view !== "Settings" && (
                <button
                  className="primary"
                  onClick={() => openNew()}
                  disabled={!canControl || projects.length === 0}
                >
                  ＋ New session
                </button>
              )}
            </div>
          </div>
          {denied && (
            <div className="banner error" role="alert">
              <strong>Access denied or expired</strong>
              <p>
                Reauthenticate through Cloudflare Access, then refresh. No
                client-side login or bypass is available.
              </p>
              <a className="button" href="/">
                Reauthenticate
              </a>
            </div>
          )}
          {!denied && data.health.error && (
            <div className="banner error" role="status">
              <strong>Gateway unavailable / status unknown</strong>
              <p>{data.health.error.message}</p>
              <a href="/">Reauthenticate</a>
            </div>
          )}
          {!denied && data.health.data && !api.canMutate && (
            <div className="banner" role="status">
              Read-only: the gateway has not supplied CSRF protection. Launch,
              register, detach and stop are disabled.
            </div>
          )}
          {notice && (
            <div className="banner success" role="status">
              {notice}
            </div>
          )}
          {operationError && !newSession && !register && !stopTarget && (
            <div className="banner error" role="alert">
              {operationError}
            </div>
          )}

          {(view === "Overview" || view === "Monitor") && (
            <>
              <StateNotice resource={data.system} />
              <div
                className={`metric-grid ${data.system.error ? "stale" : ""}`}
              >
                <article className="panel metric">
                  <span>CPU usage</span>
                  <strong>
                    {data.system.data?.cpuPercent == null
                      ? "Unknown"
                      : `${data.system.data.cpuPercent.toFixed(1)}%`}
                  </strong>
                  <small>Host observation</small>
                </article>
                <article className="panel metric">
                  <span>Memory used</span>
                  <strong>{bytes(data.system.data?.memoryUsedBytes)}</strong>
                  <small>
                    of {bytes(data.system.data?.memoryTotalBytes)} ·{" "}
                    {data.system.data?.memoryPressure ?? "pressure unknown"}
                  </small>
                </article>
                <article className="panel metric">
                  <span>Disk available</span>
                  <strong>{bytes(data.system.data?.diskFreeBytes)}</strong>
                  <small>Host observation</small>
                </article>
                <article className="panel metric">
                  <span>Sessions</span>
                  <strong>
                    {data.sessions.data ? sessions.length : "Unknown"}
                  </strong>
                  <small>
                    {data.sessions.error
                      ? "Stale observation"
                      : "Registered sessions · not task count"}
                  </small>
                </article>
              </div>
              <div className="dashboard-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        {view === "Overview"
                          ? "Recent sessions"
                          : "Service health"}
                      </h2>
                      <p>
                        {view === "Overview"
                          ? "Open a terminal to resume. Completion is not inferred."
                          : "From the authenticated gateway; not an external reachability test."}
                      </p>
                    </div>
                    {view === "Overview" && (
                      <button onClick={() => navigate("Sessions")}>
                        View all →
                      </button>
                    )}
                  </div>
                  {view === "Overview" ? (
                    <>
                      <StateNotice
                        resource={data.sessions}
                        empty={sessions.length === 0}
                      />
                      {sessionRows(sessions.slice(0, 4))}
                    </>
                  ) : (
                    <div className="details">
                      <StateNotice resource={data.health} />
                      {["gateway", "cloudflared", "tmux", "ttyd"].map(
                        (service) => (
                          <div key={service}>
                            <span>{service}</span>
                            <strong>
                              {data.health.error
                                ? "Unknown (stale)"
                                : (data.health.data?.services?.[
                                    service as keyof NonNullable<
                                      typeof data.health.data.services
                                    >
                                  ] ?? "Unknown")}
                            </strong>
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </section>
                <aside className="panel">
                  <div className="panel-heading">
                    <h2>
                      {view === "Overview" ? "CLI availability" : "Host status"}
                    </h2>
                  </div>
                  <div className="details">
                    {view === "Overview" ? (
                      <>
                        <StateNotice resource={data.agents} />
                        {agents.map((agent) => {
                          const info = data.agents.data?.find(
                            (item) => item.agent === agent,
                          );
                          return (
                            <div className="agent-observation" key={agent}>
                              <strong>{agentNames[agent]}</strong>
                              <span>
                                {data.agents.error || info?.installed == null
                                  ? "Installation unknown"
                                  : info.installed
                                    ? "Installed"
                                    : "Not installed"}
                                <small>
                                  Auth:{" "}
                                  {data.agents.error ||
                                  info?.authenticated == null
                                    ? "Unknown"
                                    : info.authenticated
                                      ? "Observed authenticated"
                                      : "Setup required"}
                                  {info?.version ? ` · ${info.version}` : ""}
                                </small>
                              </span>
                            </div>
                          );
                        })}
                      </>
                    ) : (
                      <>
                        <div>
                          <span>Device</span>
                          <strong>Mac mini</strong>
                        </div>
                        <div>
                          <span>State</span>
                          <strong>{hostState}</strong>
                        </div>
                        <div>
                          <span>Uptime</span>
                          <strong>
                            {data.system.data?.uptimeSeconds == null
                              ? "Unknown"
                              : `${Math.floor(data.system.data.uptimeSeconds / 3600)} hours`}
                          </strong>
                        </div>
                        <p>
                          Unreachable does not prove sleep, shutdown or task
                          completion. Host restart may lose tmux sessions.
                        </p>
                      </>
                    )}
                  </div>
                </aside>
              </div>
            </>
          )}

          <div hidden={view !== "Terminal"} className="terminal-workspace">
            <section className="panel terminal-panel">
              <div className="agent-tabs" aria-label="Filter sessions by agent">
                {agents.map((agent) => (
                  <button
                    aria-pressed={agentFilter === agent}
                    key={agent}
                    onClick={() => {
                      setAgentFilter(agent);
                      const match = sessions.find(
                        (session) =>
                          session.agent === agent &&
                          session.state !== "stopped",
                      );
                      if (match) navigate("Terminal", match.id);
                      else {
                        setSelected(undefined);
                        location.hash = "terminal";
                      }
                    }}
                  >
                    {agentNames[agent]}{" "}
                    <small>
                      {
                        sessions.filter((session) => session.agent === agent)
                          .length
                      }
                    </small>
                  </button>
                ))}
              </div>
              <div className="session-tabs" aria-label="Session terminals">
                {sessions
                  .filter((session) => session.agent === agentFilter)
                  .map((session) => (
                    <button
                      key={session.id}
                      aria-pressed={selected === session.id}
                      onClick={() => navigate("Terminal", session.id)}
                    >
                      {session.label}
                      <small>{session.state}</small>
                    </button>
                  ))}
              </div>
              <StateNotice resource={data.sessions} />
              {!activeSession && (
                <div className="empty terminal-empty">
                  <span aria-hidden="true">⌘</span>
                  <h2>Choose a session to connect</h2>
                  <p>
                    No simulated terminal output. Register a project and launch
                    an installed agent, or select an existing session.
                  </p>
                  <button
                    disabled={!canControl || !projects.length}
                    onClick={() => openNew()}
                  >
                    New session
                  </button>
                </div>
              )}
              <Suspense
                fallback={<p className="empty">Loading terminal renderer…</p>}
              >
                {terminalIds.map((id) => {
                  const session = sessions.find((item) => item.id === id);
                  return session ? (
                    <div key={id} hidden={selected !== id}>
                      <TerminalPane
                        session={session}
                        active={
                          view === "Terminal" && selected === id && canAttach
                        }
                        fontSize={fontSize}
                        onAuth={deny}
                      />
                    </div>
                  ) : null;
                })}
              </Suspense>
              {activeSession && (
                <div className="terminal-actions">
                  <span>
                    Host session: {activeSession.state} · Task outcome: unknown
                  </span>
                  <button
                    disabled={
                      !canControl ||
                      pending ||
                      activeSession.state === "stopped"
                    }
                    onClick={() => {
                      setSelected(undefined);
                      location.hash = "terminal";
                      void mutate(
                        () => api.action(activeSession.id, "detach"),
                        () =>
                          setNotice(
                            "Detach confirmed. Host tmux session was not stopped.",
                          ),
                      );
                    }}
                  >
                    Detach
                  </button>
                  <button
                    className="danger"
                    disabled={
                      !canControl ||
                      pending ||
                      activeSession.state === "stopped"
                    }
                    onClick={() => {
                      setOperationError("");
                      setStopTarget(activeSession);
                    }}
                  >
                    Stop session
                  </button>
                </div>
              )}
            </section>
            {activeSession && (
              <details className="panel inspector">
                <summary>Session inspector</summary>
                <div className="details">
                  <div>
                    <span>Project</span>
                    <strong>{currentProject?.name ?? "Unknown"}</strong>
                  </div>
                  <p className="path">
                    {currentProject?.canonicalPath ?? "Path unknown"}
                  </p>
                  <div>
                    <span>Branch</span>
                    <strong>{currentProject?.branch ?? "Unknown"}</strong>
                  </div>
                  <div>
                    <span>tmux alive</span>
                    <strong>
                      {activeSession.tmuxAlive == null
                        ? "Unknown"
                        : String(activeSession.tmuxAlive)}
                    </strong>
                  </div>
                  <div>
                    <span>CLI process</span>
                    <strong>{activeSession.cliState ?? "Unknown"}</strong>
                  </div>
                  <div>
                    <span>Browser clients</span>
                    <strong>{activeSession.browserClients ?? "Unknown"}</strong>
                  </div>
                  <div>
                    <span>Last attached</span>
                    <strong>{time(activeSession.lastAttachedAt)}</strong>
                  </div>
                  <p>
                    One writer per session. To switch browsers, detach the
                    current writer first. No automatic takeover.
                  </p>
                  <small>
                    Four recent terminals retained in memory. Switching
                    terminals disconnects the browser socket; tmux continues.
                  </small>
                </div>
              </details>
            )}
          </div>

          {view === "Sessions" && (
            <section className="panel">
              <div className="panel-heading">
                <h2>All sessions</h2>
                <label className="search-label">
                  Search
                  <input
                    type="search"
                    placeholder="Label or agent"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
              </div>
              <StateNotice
                resource={data.sessions}
                empty={sessions.length === 0}
              />
              {sessionRows(
                sessions.filter((session) =>
                  `${session.label} ${session.agent}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                ),
              )}
              {sessions.length > 0 &&
                !sessions.some((session) =>
                  `${session.label} ${session.agent}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                ) && <p className="empty">No matching sessions.</p>}
            </section>
          )}
          {view === "Projects" && (
            <>
              <div className="section-toolbar">
                <h2>Registered repositories</h2>
                <button
                  disabled={!canControl}
                  onClick={() => {
                    setProjectName("");
                    setProjectPath("");
                    setOperationError("");
                    setRegister(true);
                  }}
                >
                  Register project
                </button>
              </div>
              <StateNotice
                resource={data.projects}
                empty={projects.length === 0}
              />
              <div className="project-grid">
                {projects.map((project) => (
                  <article key={project.id} className="panel project-card">
                    <span className="eyebrow">REGISTERED PROJECT</span>
                    <h2>{project.name}</h2>
                    <p className="path">{project.canonicalPath}</p>
                    <div className="details">
                      <div>
                        <span>Branch</span>
                        <strong>{project.branch ?? "Unknown"}</strong>
                      </div>
                      <div>
                        <span>Git status</span>
                        <strong>
                          {project.dirty == null
                            ? "Unknown"
                            : project.dirty
                              ? "Uncommitted changes"
                              : "Clean"}
                        </strong>
                      </div>
                    </div>
                    <small>
                      Last inspected: {time(project.lastInspectedAt)}
                    </small>
                    <button
                      className="primary"
                      disabled={!canControl}
                      onClick={() => openNew(project)}
                    >
                      Launch agent
                    </button>
                  </article>
                ))}
              </div>
            </>
          )}
          {view === "Settings" && (
            <div className="project-grid">
              <section className="panel project-card">
                <h2>Terminal preferences</h2>
                <label>
                  Font size
                  <select
                    value={fontSize}
                    onChange={(event) =>
                      setFontSize(Number(event.target.value))
                    }
                  >
                    {[12, 14, 16, 18].map((size) => (
                      <option key={size} value={size}>
                        {size} px
                      </option>
                    ))}
                  </select>
                </label>
                <p>
                  Preferences apply to this browser page only. Terminal streams
                  and credentials are never saved by this UI.
                </p>
                <p>
                  Dark terminal · 1,500 scrollback lines · up to four cached
                  terminals.
                </p>
              </section>
              <section className="panel project-card">
                <h2>Access and host policy</h2>
                <p>
                  Authentication, project roots and audit retention are
                  controlled on the host. This page does not change security
                  policy.
                </p>
                <a
                  href="https://one.dash.cloudflare.com/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Cloudflare Zero Trust ↗
                </a>
                <div className="details">
                  <div>
                    <span>Access policy</span>
                    <strong>Not exposed by API</strong>
                  </div>
                  <div>
                    <span>Project roots</span>
                    <strong>Host configured</strong>
                  </div>
                  <div>
                    <span>Audit retention</span>
                    <strong>Unknown</strong>
                  </div>
                </div>
              </section>
            </div>
          )}
          <footer className="data-footer">
            Source: authenticated gateway API ·{" "}
            {data.system.error ? "Stale observation" : "Host observed"}:{" "}
            {time(data.system.data?.observedAt)} · Last browser refresh:{" "}
            {time(data.health.receivedAt)}
            <span>No demo data · Host state ≠ task outcome</span>
          </footer>
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Mobile navigation">
        {nav(["Overview", "Terminal", "Projects", "Monitor"])}
      </nav>

      {newSession && (
        <Dialog
          title="New agent session"
          onClose={() => setNewSession(false)}
          locked={pending}
        >
          <form onSubmit={create}>
            <p>
              Launch a real CLI on the selected registered project. A
              disconnected browser does not stop it.
            </p>
            <label>
              Project
              <select
                required
                value={projectId}
                disabled={pending}
                onChange={(event) => {
                  setProjectId(event.target.value);
                  createKey.current = undefined;
                }}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Agent
              <select
                value={newAgent}
                disabled={pending}
                onChange={(event) => {
                  setNewAgent(event.target.value as Agent);
                  createKey.current = undefined;
                }}
              >
                {agents.map((agent) => (
                  <option
                    key={agent}
                    value={agent}
                    disabled={
                      data.agents.data?.find((info) => info.agent === agent)
                        ?.installed !== true
                    }
                  >
                    {agentNames[agent]}
                    {data.agents.data?.find((info) => info.agent === agent)
                      ?.installed === true
                      ? ""
                      : " — unavailable / unknown"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Session label (optional)
              <input
                maxLength={60}
                value={label}
                disabled={pending}
                onChange={(event) => {
                  setLabel(event.target.value);
                  createKey.current = undefined;
                }}
                placeholder="Describe your work"
              />
            </label>
            {operationError && (
              <p role="alert" className="inline-error">
                {operationError} If the response was lost, retry the unchanged
                form with the same request key, or inspect Sessions first.
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                disabled={pending}
                onClick={() => setNewSession(false)}
              >
                Cancel
              </button>
              <button
                className="primary"
                type="submit"
                disabled={
                  pending ||
                  !canControl ||
                  !projects.some((project) => project.id === projectId) ||
                  !!data.agents.error ||
                  data.agents.data?.find((info) => info.agent === newAgent)
                    ?.installed !== true
                }
              >
                {pending ? "Starting…" : "Start session"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {register && (
        <Dialog
          title="Register project"
          onClose={() => setRegister(false)}
          locked={pending}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void mutate(
                () =>
                  api.registerProject({
                    name: projectName.trim(),
                    canonicalPath: projectPath.trim(),
                  }),
                () => {
                  setRegister(false);
                  setNotice("Project registration confirmed by gateway.");
                },
              );
            }}
          >
            <p>
              The gateway must resolve and verify this directory against host
              allowlisted roots. No Git operation is performed.
            </p>
            <label>
              Project name
              <input
                required
                maxLength={200}
                value={projectName}
                disabled={pending}
                onChange={(event) => setProjectName(event.target.value)}
              />
            </label>
            <label>
              Absolute repository directory
              <input
                required
                maxLength={4096}
                value={projectPath}
                disabled={pending}
                onChange={(event) => setProjectPath(event.target.value)}
                placeholder="/Users/LOCAL_USER/Projects/example"
              />
            </label>
            {operationError && (
              <p className="inline-error" role="alert">
                {operationError}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                disabled={pending}
                onClick={() => setRegister(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="primary"
                disabled={
                  pending ||
                  !canControl ||
                  !projectName.trim() ||
                  !projectPath.startsWith("/")
                }
              >
                Register
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {stopTarget && (
        <Dialog
          title="Stop host session?"
          onClose={() => setStopTarget(undefined)}
          locked={pending}
        >
          <p>
            This terminates <strong>{stopTarget.label}</strong> on the Mac mini.
            Unsaved agent work may be interrupted. Use Detach to leave it
            running.
          </p>
          {operationError && (
            <p role="alert" className="inline-error">
              {operationError}
            </p>
          )}
          <div className="dialog-actions">
            <button disabled={pending} onClick={() => setStopTarget(undefined)}>
              Keep running
            </button>
            <button
              className="danger"
              disabled={pending || !canControl}
              onClick={() =>
                void mutate(
                  () => api.action(stopTarget.id, "stop"),
                  () => {
                    setStopTarget(undefined);
                    setNotice(
                      "Stop confirmed by gateway. This does not establish task completion.",
                    );
                  },
                )
              }
            >
              {pending ? "Stopping…" : "Stop session"}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
