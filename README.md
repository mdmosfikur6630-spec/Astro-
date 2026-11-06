# Astro 🌌 — a self-improving OpenClaw that only learns from what actually worked

Astro is an open-source fork of [OpenClaw](https://github.com/openclaw/openclaw) (MIT). It keeps everything OpenClaw does — 20+ chat channels, multi-agent routing, cron, skills, dreaming memory — and fixes the things users of OpenClaw and [Hermes Agent](https://github.com/NousResearch/hermes-agent) complain about most.

| Problem people report | What Astro does |
|---|---|
| "It always thinks it did a good job" — failed runs become skills | **Outcome judge.** Before a background review may learn from a turn, a cheap tool-free judge reads bounded evidence from that turn and must see visible success (command output, test result, file content) or a user correction. Failures and unverified work are never saved as procedures. |
| Self-learning overwrites hand-edited skills | **Locks + hand-edit detection.** `/learn lock <skill>` makes a skill read-only to the agent. Every learned skill keeps a SHA-256 of its last agent write; if a human edited it since, background reviews only draft, never overwrite. |
| No feedback on whether a learned skill helps | **Per-skill outcome tallies.** Every judged turn records success/failure against the skills it used; the reviewer and `skill_workshop list` see `failed 2 of last 5 uses`, so misleading skills get fixed or archived. |
| Memory edits happen silently | **Memory write approval** (opt-in): file-tool writes to `MEMORY.md`, `USER.md`, `memory/*.md` ask the user first, with a preview and allow/deny. |
| Fresh installs run any command with no prompts | **Cautious defaults for new installs:** exec allowlist + ask on miss, workspace-only file tools. Existing configs are untouched. |
| Learning silently never ran on big-context models | **Fixed:** background forks were capped at 16k tokens; they now scale with the model window. |

Everything else is upstream OpenClaw 2026.11.1 — see [UPSTREAM-README.md](UPSTREAM-README.md) and [docs.openclaw.ai](https://docs.openclaw.ai). Config files, state (`~/.openclaw`), plugins and the `openclaw` command all keep working; `astro` is an alias.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/mdmosfikur6630-spec/Astro-/main/install.sh | bash
```

That downloads the prebuilt release tarball and installs it globally (about a minute). Needs Node.js 24.16+ (the script installs it with `mise` or Homebrew if missing). Set `ASTRO_FROM_SOURCE=1` to build from this repository instead (~10 minutes).

Then:

```bash
astro onboard          # first-time setup (model provider, channels)
astro gateway status   # is it running?
astro tui              # chat in the terminal
```

Upgrading an existing OpenClaw install: run the same command. Your `~/.openclaw` config is reused as-is.

## Configuration added by Astro

```jsonc
{
  "plugins": {
    "entries": {
      "skill-workshop": {
        "config": {
          "autonomous": {
            "mode": "auto",        // off | propose | auto (upstream)
            "outcomeGate": true    // Astro: judge the turn before learning from it (default true)
          }
        }
      },
      "memory-core": {
        "config": {
          "writeApproval": false   // Astro: ask before the agent edits memory files (default false)
        }
      }
    }
  }
}
```

Chat commands: `/learn lock <skill>`, `/learn unlock <skill>` (plus upstream `/learn`, `/learn drafts`, `/learn undo <id>`).

Learned skills, their versions, outcome tallies (`.outcomes.json`) and locks (`.guard.json`) live in `~/.openclaw/agents/<agent>/agent/workshop-skills/`.

## Development

```bash
pnpm install
pnpm build                 # full build (~10 min on 4 cores)
pnpm test extensions/skill-workshop/src/outcome-judge.test.ts   # focused tests
node scripts/package-openclaw-for-docker.mjs --allow-unreleased-changelog   # release tarball
```

Astro's changes are five commits on top of the upstream snapshot; `git log` shows them. Upstream history is not carried here — see the base commit for the exact upstream SHA.

## License

MIT, same as OpenClaw. See [LICENSE](LICENSE). Astro is not affiliated with the OpenClaw Foundation or Nous Research.
