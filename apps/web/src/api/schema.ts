import { z } from "zod";

export const agentSchema = z.enum(["codex", "claude", "pi"]);
const id = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9_-]+$/);
const timestamp = z.iso.datetime({ offset: true });
const observed = z.enum(["online", "offline", "unknown"]);
const optionalMetric = z.number().finite().nonnegative().nullable().optional();

export const projectSchema = z.object({
  id,
  name: z.string().min(1).max(200),
  canonicalPath: z.string().min(1).max(4096),
  createdAt: timestamp,
  lastInspectedAt: timestamp.optional(),
  branch: z.string().max(200).nullable().optional(),
  dirty: z.boolean().nullable().optional(),
});
export const sessionSchema = z.object({
  id,
  label: z.string().min(1).max(200),
  agent: agentSchema,
  projectId: id,
  tmuxName: z.string().min(1).max(200),
  state: z.enum(["created", "attached", "detached", "stopped", "unknown"]),
  createdAt: timestamp,
  lastAttachedAt: timestamp.optional(),
  stoppedAt: timestamp.optional(),
  tmuxAlive: z.boolean().nullable().optional(),
  browserClients: z.number().int().nonnegative().optional(),
  cliState: z.enum(["running", "exited", "unknown"]).optional(),
});
// These telemetry shapes are isolated proposals: the route contract does not define them yet.
export const healthSchema = z.object({
  status: observed,
  checkedAt: timestamp,
  services: z
    .object({
      gateway: observed,
      cloudflared: observed,
      tmux: observed,
      ttyd: observed,
    })
    .partial()
    .optional(),
});
export const systemSchema = z.object({
  state: observed,
  observedAt: timestamp,
  cpuPercent: z.number().finite().min(0).max(100).nullable().optional(),
  memoryUsedBytes: optionalMetric,
  memoryTotalBytes: optionalMetric,
  diskFreeBytes: optionalMetric,
  uptimeSeconds: optionalMetric,
  memoryPressure: z
    .enum(["normal", "warning", "critical", "unknown"])
    .optional(),
});
export const agentInfoSchema = z.object({
  agent: agentSchema,
  installed: z.boolean().nullable(),
  version: z.string().max(200).nullable().optional(),
  authenticated: z.boolean().nullable().optional(),
});
export type Agent = z.infer<typeof agentSchema>;
export type Project = z.infer<typeof projectSchema>;
export type HubSession = z.infer<typeof sessionSchema>;
export type Health = z.infer<typeof healthSchema>;
export type System = z.infer<typeof systemSchema>;
export type AgentInfo = z.infer<typeof agentInfoSchema>;
export const agents: Agent[] = ["codex", "claude", "pi"];
export const agentNames: Record<Agent, string> = {
  codex: "Codex",
  claude: "Claude",
  pi: "Pi",
};
export function sessionPath(sessionId: string) {
  return id.parse(sessionId);
}
