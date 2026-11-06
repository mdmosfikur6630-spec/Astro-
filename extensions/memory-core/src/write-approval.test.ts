import { describe, expect, it } from "vitest";
import {
  resolveMemoryWriteApproval,
  resolveMemoryWriteApprovalEnabled,
  resolveMemoryWriteTargets,
} from "./write-approval.js";

const workspaceDir = "/ws";
const enabled = { plugins: { entries: { "memory-core": { config: { writeApproval: true } } } } };

describe("resolveMemoryWriteTargets", () => {
  it("names curated memory artifacts written by file tools, relative or absolute", () => {
    expect(
      resolveMemoryWriteTargets({
        event: { toolName: "write", params: { path: "MEMORY.md", content: "x" } },
        workspaceDir,
      }),
    ).toEqual(["MEMORY.md"]);
    expect(
      resolveMemoryWriteTargets({
        event: { toolName: "edit", params: { path: "/ws/memory/2026-11-06.md" } },
        workspaceDir,
      }),
    ).toEqual(["memory/2026-11-06.md"]);
    expect(
      resolveMemoryWriteTargets({
        event: {
          toolName: "apply_patch",
          params: {},
          derivedPaths: ["/ws/USER.md", "/ws/src/a.ts"],
        },
        workspaceDir,
      }),
    ).toEqual(["USER.md"]);
  });

  it("ignores other files, other tools, and paths outside the workspace", () => {
    expect(
      resolveMemoryWriteTargets({
        event: { toolName: "write", params: { path: "notes.md", content: "x" } },
        workspaceDir,
      }),
    ).toEqual([]);
    expect(
      resolveMemoryWriteTargets({
        event: { toolName: "write", params: { path: "/elsewhere/MEMORY.md", content: "x" } },
        workspaceDir,
      }),
    ).toEqual([]);
    expect(
      resolveMemoryWriteTargets({
        event: { toolName: "exec", params: { command: "echo x >> MEMORY.md" } },
        workspaceDir,
      }),
    ).toEqual([]);
    expect(
      resolveMemoryWriteTargets({
        event: { toolName: "write", params: { path: "memory/dreaming/2026-11-06.md" } },
        workspaceDir,
      }),
    ).toEqual([]);
  });
});

describe("resolveMemoryWriteApproval", () => {
  it("is off unless the operator enables it", () => {
    expect(resolveMemoryWriteApprovalEnabled({})).toBe(false);
    expect(resolveMemoryWriteApprovalEnabled(enabled)).toBe(true);
    expect(
      resolveMemoryWriteApproval({
        config: {},
        agentId: "main",
        event: { toolName: "write", params: { path: "MEMORY.md", content: "x" } },
      }),
    ).toBeUndefined();
  });

  it("asks for approval with a content preview, and only allow-once or deny", () => {
    const decision = resolveMemoryWriteApproval({
      config: { ...enabled, agents: { defaults: { workspace: workspaceDir } } },
      agentId: "main",
      event: {
        toolName: "edit",
        params: { path: "MEMORY.md", oldText: "a", newText: "User prefers tea." },
      },
    });
    expect(decision?.requireApproval).toMatchObject({
      title: "Memory write: MEMORY.md",
      severity: "warning",
      allowedDecisions: ["allow-once", "deny"],
      pluginId: "memory-core",
    });
    expect(decision?.requireApproval.description).toContain("+ User prefers tea.");
  });
});
