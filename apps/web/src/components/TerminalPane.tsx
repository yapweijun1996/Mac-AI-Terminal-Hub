import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { api } from "../api/client";
import type { HubSession } from "../api/schema";
import { TerminalConnection } from "../terminal/connection";
import { controlKey, type TransportState } from "../terminal/protocol";

export default function TerminalPane({
  session,
  active,
  fontSize,
  onAuth,
}: {
  session: HubSession;
  active: boolean;
  fontSize: number;
  onAuth: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const connection = useRef<TerminalConnection | null>(null);
  const auth = useRef(onAuth);
  auth.current = onAuth;
  const [transport, setTransport] = useState<TransportState>("detached");
  const [detail, setDetail] = useState(
    "Attach to resume the existing host session.",
  );
  const [readOnly, setReadOnly] = useState(true);
  const [ctrl, setCtrl] = useState(false);
  const [alt, setAlt] = useState(false);
  const ctrlRef = useRef(false);
  const altRef = useRef(false);
  const [clipboardError, setClipboardError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [pasteText, setPasteText] = useState("");
  const [showPaste, setShowPaste] = useState(false);

  useEffect(() => {
    const term = new Terminal({
      fontSize,
      fontFamily: "SFMono-Regular, Consolas, Liberation Mono, monospace",
      scrollback: 1500,
      cursorBlink: false,
      disableStdin: true,
      convertEol: false,
      allowProposedApi: false,
      screenReaderMode: true,
      theme: {
        background: "#080f18",
        foreground: "#e3eaf3",
        cursor: "#9de4c6",
        selectionBackground: "#33465c",
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    // Defer opening until after React StrictMode has completed its setup/cleanup probe.
    // xterm 5.5 queues a viewport timer in open() that can outlive immediate disposal.
    const element = container.current!;
    const openFrame = requestAnimationFrame(() => {
      term.open(element);
      if (element.clientWidth > 0 && element.clientHeight > 0) fitAddon.fit();
    });
    terminal.current = term;
    fit.current = fitAddon;
    const bridge = new TerminalConnection(session.id, api, {
      size: () => ({ columns: term.cols, rows: term.rows }),
      output: (bytes, drained) => term.write(bytes, drained),
      state: (state, message) => {
        setTransport(state);
        setDetail(message);
        if (state === "auth") auth.current();
      },
      readOnly: (value) => {
        term.options.disableStdin = value;
        setReadOnly(value);
      },
    });
    connection.current = bridge;
    const onData = term.onData((value) => {
      if (ctrlRef.current || altRef.current) {
        value = controlKey(value, ctrlRef.current, altRef.current);
        ctrlRef.current = altRef.current = false;
        setCtrl(false);
        setAlt(false);
      }
      bridge.send(value);
    });
    const onBinary = term.onBinary((value) =>
      bridge.send(
        Uint8Array.from(value, (character) => character.charCodeAt(0)),
      ),
    );
    const onResize = term.onResize(() => bridge.resize());
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (
          container.current &&
          container.current.clientWidth > 0 &&
          container.current.clientHeight > 0
        )
          fitAddon.fit();
      });
    });
    observer.observe(container.current!);
    return () => {
      cancelAnimationFrame(openFrame);
      cancelAnimationFrame(frame);
      observer.disconnect();
      bridge.stop();
      onData.dispose();
      onBinary.dispose();
      onResize.dispose();
      term.dispose();
      terminal.current = null;
      connection.current = null;
    };
    // A session ID owns one ephemeral terminal instance; presentation updates are handled below.
  }, [session.id]);

  useEffect(() => {
    if (terminal.current) {
      terminal.current.options.fontSize = fontSize;
      if (active) fit.current?.fit();
    }
  }, [fontSize, active]);
  useEffect(() => {
    const bridge = connection.current;
    ctrlRef.current = altRef.current = false;
    setCtrl(false);
    setAlt(false);
    if (!active || session.state === "stopped" || session.tmuxAlive === false) {
      bridge?.stop();
      setTransport(
        session.state === "stopped" || session.tmuxAlive === false
          ? "stopped"
          : "detached",
      );
      setDetail(
        session.state === "stopped" || session.tmuxAlive === false
          ? "The host session is stopped. Task outcome remains unknown."
          : "Browser transport detached. This does not stop the host session.",
      );
      return;
    }
    fit.current?.fit();
    bridge?.start();
    return () => bridge?.stop();
  }, [
    active,
    session.id,
    session.state === "stopped",
    session.tmuxAlive === false,
    attempt,
  ]);

  const sendKey = (key: string) => {
    connection.current?.send(controlKey(key, ctrlRef.current, altRef.current));
    ctrlRef.current = altRef.current = false;
    setCtrl(false);
    setAlt(false);
    terminal.current?.focus();
  };
  const copy = async () => {
    const text = terminal.current?.getSelection();
    if (!text) {
      setClipboardError("Select terminal text before copying.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setClipboardError("");
    } catch {
      setClipboardError("Clipboard unavailable. Use your browser copy action.");
    }
  };
  return (
    <section className="terminal-pane" aria-label={`${session.label} terminal`}>
      <div className="terminal-status">
        <span className={`badge ${transport === "connected" ? "good" : ""}`}>
          {transport}
        </span>
        <span>{readOnly ? "Read-only / disconnected" : "Single writer"}</span>
        <button
          onClick={() => {
            connection.current?.stop();
            setAttempt((value) => value + 1);
          }}
          disabled={
            !active ||
            transport === "connecting" ||
            transport === "retrying" ||
            transport === "connected" ||
            transport === "stopped"
          }
        >
          Reconnect
        </button>
      </div>
      <p className="transport-message" role="status">
        {detail}
      </p>
      <div className="terminal-screen" ref={container} />
      <div className="key-row" aria-label="Terminal touch controls">
        {["Esc", "Tab"].map((key) => (
          <button key={key} disabled={readOnly} onClick={() => sendKey(key)}>
            {key}
          </button>
        ))}
        <button
          disabled={readOnly}
          aria-pressed={ctrl}
          onClick={() => {
            ctrlRef.current = !ctrlRef.current;
            setCtrl(ctrlRef.current);
            terminal.current?.focus();
          }}
        >
          Ctrl
        </button>
        <button
          disabled={readOnly}
          aria-pressed={alt}
          onClick={() => {
            altRef.current = !altRef.current;
            setAlt(altRef.current);
            terminal.current?.focus();
          }}
        >
          Alt
        </button>
        <button
          disabled={readOnly}
          onClick={() => {
            connection.current?.send("\x03");
            terminal.current?.focus();
          }}
        >
          Ctrl+C
        </button>
        {["←", "↓", "↑", "→"].map((key, index) => (
          <button
            key={key}
            aria-label={
              ["Left arrow", "Down arrow", "Up arrow", "Right arrow"][index]
            }
            disabled={readOnly}
            onClick={() => sendKey(key)}
          >
            {key}
          </button>
        ))}
        <button onClick={() => void copy()}>Copy</button>
        <button
          disabled={readOnly}
          onClick={() => setShowPaste((value) => !value)}
        >
          Paste
        </button>
      </div>
      {showPaste && (
        <form
          className="paste-form"
          onSubmit={(event) => {
            event.preventDefault();
            terminal.current?.paste(pasteText);
            setPasteText("");
            setShowPaste(false);
            terminal.current?.focus();
          }}
        >
          <label htmlFor={`paste-${session.id}`}>
            Paste text (review before sending)
          </label>
          <textarea
            id={`paste-${session.id}`}
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            maxLength={32_768}
          />
          <p>
            Newlines may execute commands. Send only text you have reviewed.
          </p>
          <button type="submit" disabled={readOnly || !pasteText}>
            Send text
          </button>
          <button
            type="button"
            onClick={() => {
              setPasteText("");
              setShowPaste(false);
            }}
          >
            Cancel
          </button>
        </form>
      )}
      {clipboardError && <p role="status">{clipboardError}</p>}
    </section>
  );
}
