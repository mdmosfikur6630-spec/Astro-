// Skill Workshop's /learn contribution: skill guidance plus the drafts and undo subcommands.
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { listWorkshopDrafts, type WorkshopDraft } from "./drafts.js";
import { EXISTING_SKILL_NAME_PATTERN, listWorkshopSkills, WorkshopWriteError } from "./library.js";
import {
  describeWorkshopReviewUndo,
  undoWorkshopReview,
  WorkshopReviewNotFoundError,
  workshopReviewRunId,
} from "./review-undo.js";
import {
  SKILL_AUTHORING_STANDARDS_PROMPT,
  SKILL_DO_NOT_CAPTURE_PROMPT,
  SKILL_LEARNING_METHOD_PROMPT,
} from "./skill-authoring-standards.js";
import { listLockedSkills, setSkillLock } from "./skill-guard.js";

type LearnContribution = Parameters<OpenClawPluginApi["registerLearnContribution"]>[0];

// Only "undo <id>" with whitespace undoes; any other "/learn undo ..." text stays a learn request.
const UNDO_ARGS_PATTERN = /^\s+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Builds the /learn drafts turn over the drafts the command selected. The agent proposes and
 * the user approves: nothing is saved until the user answers, and undecided drafts stay.
 */
function buildDraftReviewPrompt(drafts: readonly WorkshopDraft[], focus: string): string {
  const listed = drafts.map((draft) => ({ id: draft.id, skill: draft.skillName }));
  return [
    "The user asked you to review Skill Workshop drafts: changes background reviews proposed but did not apply.",
    `Drafts to review (JSON): ${JSON.stringify(listed)}. Review only these.`,
    ...(focus ? [`User focus (JSON string): ${JSON.stringify(focus)}`] : []),
    "",
    "View each draft with skill_workshop action=view draft=<id>, and view the live skill it would change. Judge the drafts together by the method below: most are local fixes, and related drafts merge into one change.",
    SKILL_LEARNING_METHOD_PROMPT,
    "Do not save anything yet. Show the user each change you would make (the skill, what changes, which drafts it uses) and each draft you would drop and why, then ask which to save.",
    "When the user answers, save the approved changes with create or patch and a short reason, discard the drafts the user approved or rejected, and leave drafts the user did not decide on for a later review.",
    "",
    SKILL_AUTHORING_STANDARDS_PROMPT,
  ].join("\n");
}

/**
 * "/learn lock <skill>" and "/learn unlock <skill>": a locked skill belongs to the user; no
 * agent turn or background review may change, archive, or restore it until it is unlocked.
 */
function lockSubcommands(): NonNullable<LearnContribution["subcommands"]> {
  return (["lock", "unlock"] as const).map((name) => ({
    name,
    matchArgs: (args: string) => /^\s+\S+\s*$/.test(args),
    direct: true,
    handle: async ({ config, agentId, args }) => {
      const skill = args.trim();
      if (!EXISTING_SKILL_NAME_PATTERN.test(skill)) {
        return { text: `⚠️ "${skill}" is not a skill name.` };
      }
      const known = (await listWorkshopSkills(config, agentId)).some(
        (entry) => entry.name === skill,
      );
      const locked = await listLockedSkills(config, agentId);
      if (!known && !locked.includes(skill)) {
        return { text: `No learned skill named "${skill}".` };
      }
      const changed = await setSkillLock({ config, agentId, name: skill, locked: name === "lock" });
      if (name === "lock") {
        return {
          text: changed
            ? `🔒 Locked "${skill}": the agent will not change it until you run /learn unlock ${skill}.`
            : `"${skill}" is already locked.`,
        };
      }
      return {
        text: changed ? `🔓 Unlocked "${skill}".` : `"${skill}" is not locked.`,
      };
    },
  }));
}

export const workshopLearnContribution: LearnContribution = {
  medium: "skills",
  toolNames: ["skill_workshop"],
  unavailableText:
    "Skill workshop is not available on this agent. Use a non-sandboxed agent where the skill_workshop tool is available, or use the openclaw skills workshop CLI.",
  buildGuidance: ({ media }) => ({
    lines: [
      `Write ${media.has("memory") ? "skills " : ""}with skill_workshop: list and view related skills first, and make the fewest changes that cover what you found. Put reusable scripts under scripts/ and reference them from the step that runs them. Pass a short reason.`,
      SKILL_LEARNING_METHOD_PROMPT,
    ],
    appendix: [SKILL_AUTHORING_STANDARDS_PROMPT, SKILL_DO_NOT_CAPTURE_PROMPT],
  }),
  subcommands: [
    ...lockSubcommands(),
    {
      // "/learn drafts [skill] [focus]": a first word naming a drafted skill narrows the review.
      name: "drafts",
      handle: async ({ config, agentId, args }) => {
        const drafts = await listWorkshopDrafts(config, agentId);
        const [first = ""] = args.split(/\s+/, 1);
        const skill = drafts.some((draft) => draft.skillName === first) ? first : undefined;
        const selected = skill ? drafts.filter((draft) => draft.skillName === skill) : drafts;
        if (selected.length === 0) {
          return { text: "No Skill Workshop drafts are waiting for review." };
        }
        const focus = (skill ? args.slice(first.length) : args).replace(/^[\s;:,]+/, "").trim();
        return { prompt: buildDraftReviewPrompt(selected, focus) };
      },
    },
    {
      // Reverts one background review's skill changes, as the Undo button on its notice asks.
      name: "undo",
      matchArgs: (args) => UNDO_ARGS_PATTERN.test(args),
      direct: true,
      handle: async ({ config, agentId, sessionKey, assertOwnerCurrent, args }) => {
        try {
          const result = await undoWorkshopReview(
            {
              config,
              agentId,
              actor: "user",
              ...(sessionKey ? { sessionKey } : {}),
              ...(assertOwnerCurrent ? { assertLive: assertOwnerCurrent } : {}),
            },
            { runId: workshopReviewRunId(args.toLowerCase()) },
          );
          return {
            text:
              result.status === "undone"
                ? `↩️ Undid the skill change: ${describeWorkshopReviewUndo(result.changes)}.`
                : "That skill change was already undone.",
          };
        } catch (error) {
          if (error instanceof WorkshopReviewNotFoundError) {
            return { text: "No skill change found for that id." };
          }
          if (error instanceof WorkshopWriteError) {
            return { text: `⚠️ ${error.message}` };
          }
          throw error;
        }
      },
    },
  ],
};
