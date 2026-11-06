// `openclaw memory trust <file>`: re-admit a quarantined MEMORY.md or USER.md to automatic
// context. The operator reviews the file, then vouches for exactly its current content.
import fs from "node:fs/promises";
import path from "node:path";
import { resolveAgentWorkspaceDir } from "openclaw/plugin-sdk/memory-core-host-engine-foundation";
import { defaultRuntime } from "openclaw/plugin-sdk/memory-core-host-runtime-cli";
import {
  normalizeMemoryArtifactRelativePath,
  readMemoryArtifactProvenance,
  trustMemoryArtifact,
} from "openclaw/plugin-sdk/memory-core-host-runtime-core";
import { captureRuntimeConfigAsyncReader } from "openclaw/plugin-sdk/runtime-config-snapshot";
import { terminalText } from "openclaw/plugin-sdk/terminal-safe-text";
import { resolveMemoryAgentIds } from "./cli-runtime-common.js";

export type MemoryTrustCommandOptions = { agent?: string; json?: boolean };

export async function runMemoryTrust(
  fileArg: string,
  opts: MemoryTrustCommandOptions,
): Promise<void> {
  const relativePath = normalizeMemoryArtifactRelativePath(fileArg.trim());
  if (!relativePath) {
    throw new Error(
      `"${fileArg}" is not a tracked memory file. Use MEMORY.md, USER.md, users/<id>/USER.md, or memory/<date>.md.`,
    );
  }
  const cfg = await captureRuntimeConfigAsyncReader({ skipPluginValidation: true })();
  const results: Array<Record<string, unknown>> = [];
  for (const agentId of resolveMemoryAgentIds(cfg, opts.agent)) {
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const absolute = path.join(workspaceDir, relativePath);
    let content: string;
    try {
      content = await fs.readFile(absolute, "utf8");
    } catch {
      results.push({ agentId, relativePath, status: "missing" });
      continue;
    }
    const before = await readMemoryArtifactProvenance({ workspaceDir, relativePath });
    const trusted = await trustMemoryArtifact({
      workspaceDir,
      relativePath,
      content,
      observedAt: Date.now(),
    });
    results.push({
      agentId,
      relativePath,
      status: "trusted",
      previousOrigin: before?.originClass ?? "none",
      fileHash: trusted.fileHash,
    });
  }
  if (opts.json) {
    defaultRuntime.log(JSON.stringify(results, null, 2));
    return;
  }
  for (const result of results) {
    if (result.status === "missing") {
      defaultRuntime.log(
        terminalText`${String(result.agentId)}: ${relativePath} not found; nothing to trust.`,
      );
      continue;
    }
    defaultRuntime.log(
      terminalText`${String(result.agentId)}: ${relativePath} is trusted again (was ${String(result.previousOrigin)}). It returns to automatic context on the next turn.`,
    );
  }
}
