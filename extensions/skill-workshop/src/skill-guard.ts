// Protects skills the user owns from autonomous edits. Two signals, one sidecar file:
// - lock: the user locked the skill (`/learn lock <name>`); no agent or review may change it.
// - provenance: the SKILL.md hash after the Workshop's last write. A different hash means a
//   human edited the file since, so background reviews leave it alone and draft instead.
// Best-effort bookkeeping: a lost hash fails open (the skill edits as before), a lock is explicit.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";
import { SKILL_FILE } from "openclaw/plugin-sdk/skill-authoring-runtime";
import { isRecord } from "openclaw/plugin-sdk/string-coerce-runtime";
import { workshopLog } from "./runtime.js";
import { ignoreMissingPath } from "./skill-versions.js";
import { resolveWorkshopSkillsDir } from "./skills-root.js";

export const GUARD_FILE = ".guard.json";

type SkillGuardState = {
  locked: Record<string, { atMs: number }>;
  /** sha256 of SKILL.md after the Workshop's last own write, per skill. */
  written: Record<string, string>;
};

export type SkillGuardStatus = {
  locked: boolean;
  /** SKILL.md differs from the Workshop's last own write; absent when never recorded. */
  handEdited: boolean;
};

function resolveGuardPath(config: OpenClawConfig, agentId: string): string {
  return path.join(resolveWorkshopSkillsDir(config, agentId), GUARD_FILE);
}

function emptyState(): SkillGuardState {
  return { locked: {}, written: {} };
}

async function readGuardState(config: OpenClawConfig, agentId: string): Promise<SkillGuardState> {
  const raw = await fs
    .readFile(resolveGuardPath(config, agentId), "utf8")
    .catch((error: unknown) => ignoreMissingPath(error));
  if (!raw) {
    return emptyState();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyState();
  }
  if (!isRecord(parsed)) {
    return emptyState();
  }
  const state = emptyState();
  if (isRecord(parsed.locked)) {
    for (const [name, value] of Object.entries(parsed.locked)) {
      if (isRecord(value) && typeof value.atMs === "number") {
        state.locked[name] = { atMs: value.atMs };
      }
    }
  }
  if (isRecord(parsed.written)) {
    for (const [name, value] of Object.entries(parsed.written)) {
      if (typeof value === "string") {
        state.written[name] = value;
      }
    }
  }
  return state;
}

async function writeGuardState(
  config: OpenClawConfig,
  agentId: string,
  state: SkillGuardState,
): Promise<void> {
  const file = resolveGuardPath(config, agentId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function hashSkillContent(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function readLiveSkillHash(
  config: OpenClawConfig,
  agentId: string,
  name: string,
): Promise<string | undefined> {
  const content = await fs
    .readFile(path.join(resolveWorkshopSkillsDir(config, agentId), name, SKILL_FILE))
    .catch((error: unknown) => ignoreMissingPath(error));
  return content ? hashSkillContent(content) : undefined;
}

/** Records SKILL.md as the Workshop's own work right after one of its writes commits. */
export async function recordWorkshopWrite(
  config: OpenClawConfig,
  agentId: string,
  name: string,
): Promise<void> {
  try {
    const state = await readGuardState(config, agentId);
    const hash = await readLiveSkillHash(config, agentId, name);
    if (hash) {
      state.written[name] = hash;
    } else {
      delete state.written[name];
    }
    await writeGuardState(config, agentId, state);
  } catch (error) {
    workshopLog().warn(`skill provenance record failed: ${formatErrorMessage(error)}`);
  }
}

export async function readSkillGuardStatus(
  config: OpenClawConfig,
  agentId: string,
  name: string,
): Promise<SkillGuardStatus> {
  const state = await readGuardState(config, agentId);
  const recorded = state.written[name];
  const live = recorded ? await readLiveSkillHash(config, agentId, name) : undefined;
  return {
    locked: name in state.locked,
    handEdited: recorded !== undefined && live !== undefined && live !== recorded,
  };
}

export async function listLockedSkills(config: OpenClawConfig, agentId: string): Promise<string[]> {
  return Object.keys((await readGuardState(config, agentId)).locked).toSorted();
}

/** Locks or unlocks one skill for the user; returns whether anything changed. */
export async function setSkillLock(params: {
  config: OpenClawConfig;
  agentId: string;
  name: string;
  locked: boolean;
  nowMs?: number;
}): Promise<boolean> {
  const state = await readGuardState(params.config, params.agentId);
  const already = params.name in state.locked;
  if (already === params.locked) {
    return false;
  }
  if (params.locked) {
    state.locked[params.name] = { atMs: params.nowMs ?? Date.now() };
  } else {
    delete state.locked[params.name];
  }
  await writeGuardState(params.config, params.agentId, state);
  return true;
}

/** The refusal an agent sees for a protected skill, or nothing when the change may proceed. */
export function describeSkillGuardRefusal(params: {
  name: string;
  status: SkillGuardStatus;
  /** The caller is a background review (not a foreground turn the user is watching). */
  review: boolean;
}): string | undefined {
  if (params.status.locked) {
    return `Skill "${params.name}" is locked by the user. Do not change it, retry, or recreate it under another name; the user unlocks it with /learn unlock ${params.name}.`;
  }
  if (params.review && params.status.handEdited) {
    return `Skill "${params.name}" was edited by hand since the last learned change, so background reviews leave it alone. If the lesson still matters, save it with action=draft name=${params.name} for the user to review.`;
  }
  return undefined;
}
