import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type {
  AgentInfo,
  Health,
  HubSession,
  Project,
  System,
} from "../api/schema";

export interface Resource<T> {
  data?: T;
  error?: ApiError;
  loading: boolean;
  receivedAt?: string;
}
export interface HubData {
  health: Resource<Health>;
  system: Resource<System>;
  agents: Resource<AgentInfo[]>;
  projects: Resource<Project[]>;
  sessions: Resource<HubSession[]>;
}
const empty = (): HubData => ({
  health: { loading: true },
  system: { loading: true },
  agents: { loading: true },
  projects: { loading: true },
  sessions: { loading: true },
});

export function useHub() {
  const [data, setData] = useState<HubData>(empty);
  const [denied, setDenied] = useState(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const busy = useRef(false);
  const deny = useCallback(() => {
    generation.current++;
    busy.current = false;
    api.clearIdentity();
    setDenied(true);
    const error = new ApiError(
      "auth",
      "Access denied or expired. Reauthenticate, then refresh.",
    );
    setData({
      health: { error, loading: false },
      system: { error, loading: false },
      agents: { error, loading: false },
      projects: { error, loading: false },
      sessions: { error, loading: false },
    });
  }, []);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const current = ++generation.current;
    setDenied(false);
    const keys = [
      "health",
      "system",
      "agents",
      "projects",
      "sessions",
    ] as const;
    setData(
      (previous) =>
        Object.fromEntries(
          keys.map((key) => [key, { ...previous[key], loading: true }]),
        ) as unknown as HubData,
    );
    await Promise.all(
      keys.map(async (key) => {
        try {
          const value = await api[key]();
          if (mounted.current && current === generation.current) {
            setData((previous) => ({
              ...previous,
              [key]: {
                data: value,
                loading: false,
                receivedAt: new Date().toISOString(),
              },
            }));
          }
        } catch (error) {
          if (!mounted.current || current !== generation.current) return;
          const failure =
            error instanceof ApiError
              ? error
              : new ApiError("request", "Could not load this resource.");
          if (failure.kind === "auth") {
            deny();
            return;
          }
          setData((previous) => ({
            ...previous,
            [key]: { ...previous[key], error: failure, loading: false },
          }));
        }
      }),
    );
    if (current === generation.current) busy.current = false;
  }, [deny]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted.current = false;
      generation.current++;
      busy.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);
  return { data, denied, deny, refresh };
}
