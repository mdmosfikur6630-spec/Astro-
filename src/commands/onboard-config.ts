import fs from "node:fs";
import path from "node:path";
import { listAgentEntries } from "../agents/agent-scope-config.js";
import { resolveDefaultAgentWorkspaceDir } from "../agents/workspace-default.js";
import { resolveStateDir } from "../config/paths.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { ToolProfileId } from "../config/types.tools.js";
import { resolveUserPath } from "../utils.js";

const ONBOARDING_DEFAULT_TOOLS_PROFILE: ToolProfileId = "full";
// A fresh local install starts with the `cautious` exec preset (allowlisted commands run,
// anything else asks; the runtime's unanswered-prompt fallback is already deny) and
// workspace-only file tools. Operators who want host-wide access opt in with
// `openclaw exec-policy preset yolo` and `tools.fs.workspaceOnly: false`.
const ONBOARDING_DEFAULT_EXEC_POLICY = { security: "allowlist", ask: "on-miss" } as const;

export type OnboardingWorkspaceConflict = {
  currentWorkspaceDir: string;
  requestedWorkspaceDir: string;
};

function hasExistingAgentState(env: NodeJS.ProcessEnv): boolean {
  const stateDir = resolveStateDir(env);
  const agentsDir = path.join(stateDir, "agents");
  try {
    if (fs.readdirSync(agentsDir, { withFileTypes: true }).some((entry) => entry.isDirectory())) {
      return true;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return true;
    }
  }
  return [path.join(stateDir, "agent"), path.join(stateDir, "sessions")].some((candidate) => {
    try {
      return fs.statSync(candidate).isDirectory();
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ENOENT";
    }
  });
}

export function resolveOnboardingWorkspaceConflict(
  baseConfig: OpenClawConfig,
  requestedWorkspaceDir: string,
  env: NodeJS.ProcessEnv = process.env,
): OnboardingWorkspaceConflict | undefined {
  const configuredWorkspace = baseConfig.agents?.defaults?.workspace?.trim();
  const currentWorkspaceDir = configuredWorkspace
    ? resolveUserPath(configuredWorkspace, env)
    : resolveDefaultAgentWorkspaceDir(env);
  const normalizedCurrent = path.resolve(currentWorkspaceDir);
  const normalizedRequested = path.resolve(resolveUserPath(requestedWorkspaceDir, env));
  if (normalizedCurrent === normalizedRequested) {
    return undefined;
  }

  const hasRoster = listAgentEntries(baseConfig).length > 0;
  if (!hasRoster && !(configuredWorkspace && hasExistingAgentState(env))) {
    return undefined;
  }
  return {
    currentWorkspaceDir: normalizedCurrent,
    requestedWorkspaceDir: normalizedRequested,
  };
}

// Deliberately writes no session.dmScope: the schema default "main" (one rolling
// personal-agent session across channels) is the product default. Multi-user DM
// isolation is opt-in; `openclaw security audit` nudges it when traffic warrants.
export function applyLocalSetupWorkspaceConfig(
  baseConfig: OpenClawConfig,
  workspaceDir: string,
  options: {
    allowWorkspaceChange?: boolean;
    preserveWorkspace?: boolean;
    env?: NodeJS.ProcessEnv;
  } = {},
): OpenClawConfig {
  const shouldUpdateWorkspace =
    !options.preserveWorkspace &&
    (options.allowWorkspaceChange ||
      (listAgentEntries(baseConfig).length === 0 &&
        !resolveOnboardingWorkspaceConflict(baseConfig, workspaceDir, options.env)));
  return {
    ...baseConfig,
    ...(shouldUpdateWorkspace
      ? {
          agents: {
            ...baseConfig.agents,
            defaults: {
              ...baseConfig.agents?.defaults,
              workspace: workspaceDir,
            },
          },
        }
      : {}),
    gateway: {
      ...baseConfig.gateway,
      mode: "local",
    },
    tools: {
      ...baseConfig.tools,
      profile: baseConfig.tools?.profile ?? ONBOARDING_DEFAULT_TOOLS_PROFILE,
      exec: baseConfig.tools?.exec ?? { ...ONBOARDING_DEFAULT_EXEC_POLICY },
      fs: baseConfig.tools?.fs ?? { workspaceOnly: true },
    },
  };
}

export function applySkipBootstrapConfig(cfg: OpenClawConfig): OpenClawConfig {
  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: { ...cfg.agents?.defaults, skipBootstrap: true },
    },
  };
}
