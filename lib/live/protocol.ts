import type { LiveCapability } from "./constants";

export type InvalidationScope = "messages" | "tree" | "metadata" | "all";

export interface IntegrationVersion {
  piVersion: string;
  piWebVersion: string;
  companionVersion: string;
  protocolVersion: number;
}

export interface AttachmentSnapshot {
  instanceId: string;
  pid: number;
  generation: number;
  sessionId?: string;
  sessionFile?: string;
  cwd: string;
  leafId: string | null;
  entryCount: number;
  baseEntryCount?: number;
  runId: number;
  baseLeafId: string | null;
  busy: boolean;
  messages: unknown[];
  capabilities: LiveCapability[];
  state: Record<string, unknown>;
}

export type CompanionToHubMessage =
  | { type: "hello"; version: IntegrationVersion; instanceId: string; pid: number }
  | { type: "snapshot"; snapshot: AttachmentSnapshot }
  | { type: "event"; instanceId: string; generation: number; runId: number; event: Record<string, unknown> }
  | { type: "invalidation"; instanceId: string; generation: number; sessionId: string; scope: InvalidationScope }
  | { type: "command_result"; instanceId: string; commandId: string; ok: boolean; result?: unknown; error?: string };

export type HubToCompanionMessage =
  | { type: "hello_ok" }
  | { type: "hello_error"; code: "version_mismatch" | "unsupported"; message: string }
  | { type: "attachment_result"; generation: number; accepted: boolean; reason?: string }
  | { type: "command"; commandId: string; sessionId: string; clientId: string; command: Record<string, unknown> }
  | { type: "request_snapshot" };

export interface LivePresence {
  sessionId: string;
  instanceId: string;
  generation: number;
  runId: number;
  leafId: string | null;
  baseLeafId: string | null;
  connected: boolean;
  reserved: boolean;
  busy: boolean;
  interrupted: boolean;
  capabilities: LiveCapability[];
  pid: number;
}
