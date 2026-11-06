// Memory write approval: when enabled, an agent's file-tool write to a curated memory artifact
// (MEMORY.md, USER.md, memory/*.md in its workspace) asks the user first, through the same
// approval surface exec approvals use. Hermes users asked for this gate; it is off by default
// because every memory write would otherwise interrupt chat-channel users. Shell writes are not
// gated here: memory provenance already records them as untrusted and excludes the file.
import path from "node:path";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { resolveAgentWorkspaceDir } from "openclaw/plugin-sdk/memory-core-host-engine-foundation";
import { normalizeMemoryArtifactRelativePath } from "openclaw/plugin-sdk/memory-core-host-runtime-core";
import { isRecord, truncateUtf16Safe } from "openclaw/plugin-sdk/string-coerce-runtime";

/** `plugins.entries.memory-core.config.writeApproval` */
export function resolveMemoryWriteApprovalEnabled(config: OpenClawConfig | undefined): boolean {
  const raw = config?.plugins?.entries?.["memory-core"]?.config;
  return isRecord(raw) && raw.writeApproval === true;
}

const GATED_TOOLS = new Set(["write", "edit", "apply_patch"]);
const MAX_PREVIEW_CHARS = 600;
const APPROVAL_TIMEOUT_MS = 10 * 60_000;

export type MemoryWriteApprovalEvent = {
  toolName: string;
  params: Record<string, unknown>;
  derivedPaths?: readonly string[];
};

export type MemoryWriteApprovalRequest = {
  requireApproval: {
    title: string;
    description: string;
    severity: "warning";
    timeoutMs: number;
    timeoutReason: string;
    allowedDecisions: Array<"allow-once" | "deny">;
    pluginId: string;
  };
};

/** The workspace-relative memory artifacts a file-tool call would write, if any. */
export function resolveMemoryWriteTargets(params: {
  event: MemoryWriteApprovalEvent;
  workspaceDir: string;
}): string[] {
  const { event, workspaceDir } = params;
  if (!GATED_TOOLS.has(event.toolName)) {
    return [];
  }
  const candidates: string[] = [];
  const rawPath = event.params.path;
  if (typeof rawPath === "string" && rawPath.trim()) {
    candidates.push(rawPath.trim());
  }
  for (const derived of event.derivedPaths ?? []) {
    candidates.push(derived);
  }
  const targets = new Set<string>();
  for (const candidate of candidates) {
    const absolute = path.isAbsolute(candidate)
      ? path.normalize(candidate)
      : path.resolve(workspaceDir, candidate);
    const relative = path.relative(workspaceDir, absolute);
    const artifact = normalizeMemoryArtifactRelativePath(relative);
    if (artifact) {
      targets.add(artifact);
    }
  }
  return [...targets].toSorted();
}

function previewOf(event: MemoryWriteApprovalEvent): string {
  const { params } = event;
  let text: string | undefined;
  if (typeof params.content === "string") {
    text = params.content;
  } else if (typeof params.newText === "string") {
    text = `+ ${params.newText}`;
  } else if (Array.isArray(params.edits)) {
    text = params.edits
      .filter(isRecord)
      .map((edit) => (typeof edit.newText === "string" ? `+ ${edit.newText}` : ""))
      .filter(Boolean)
      .join("\n");
  } else if (typeof params.input === "string") {
    text = params.input;
  }
  const flat = (text ?? "").trim();
  if (!flat) {
    return "(no content preview available)";
  }
  return flat.length > MAX_PREVIEW_CHARS ? `${truncateUtf16Safe(flat, MAX_PREVIEW_CHARS)}…` : flat;
}

/**
 * The `before_tool_call` decision: an approval request for a memory artifact write, or nothing.
 * Denied and timed-out requests block the tool call; the agent sees why and can tell the user.
 */
export function resolveMemoryWriteApproval(params: {
  config: OpenClawConfig | undefined;
  agentId: string | undefined;
  event: MemoryWriteApprovalEvent;
}): MemoryWriteApprovalRequest | undefined {
  const { config, agentId, event } = params;
  if (!config || !agentId || !resolveMemoryWriteApprovalEnabled(config)) {
    return undefined;
  }
  const workspaceDir = resolveAgentWorkspaceDir(config, agentId);
  const targets = resolveMemoryWriteTargets({ event, workspaceDir });
  if (targets.length === 0) {
    return undefined;
  }
  return {
    requireApproval: {
      title: `Memory write: ${targets.join(", ")}`,
      description: [
        `The agent wants to change ${targets.length === 1 ? "memory file" : "memory files"} ${targets.join(", ")} with the ${event.toolName} tool.`,
        "Approve to let it remember this, or deny to keep memory unchanged.",
        "",
        previewOf(event),
      ].join("\n"),
      severity: "warning",
      timeoutMs: APPROVAL_TIMEOUT_MS,
      timeoutReason:
        "Memory write not approved in time; memory is unchanged. Ask the user to approve it, or continue without saving.",
      allowedDecisions: ["allow-once", "deny"],
      pluginId: "memory-core",
    },
  };
}
