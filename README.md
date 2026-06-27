# claude-reliable-workflows

Stop Claude Code research workflows from asserting facts and numbers they never actually retrieved.

A small, domain-agnostic reliability ruleset for `Workflow` and multi-agent runs, encoded into a
reusable template. The rules are adopted from Anthropic's
[Building Effective Agents](https://www.anthropic.com/research/building-effective-agents) and
HumanLayer's [12-Factor Agents](https://github.com/humanlayer/12-factor-agents).

## The problem it fixes

A multi-agent research run produced a confident, load-bearing number that was wrong: it had been
"found" through web-search narration instead of fetched from the authoritative source, and nothing
re-checked it before a conclusion was built on top. The fix is not a framework — it is a few proven
rules wired into Claude Code's native primitives.

## Rules

| # | Rule | Addresses |
|---|------|-----------|
| **R1** | Ground every load-bearing fact in a tool result, not model prose (API/CLI/file called *this turn*; web-search snippets and memory are not measurements). | numbers taken from search narration |
| **R2** | Schema forces a `measured` provenance flag; unmeasurable ⇒ say so, never a confident number. | confident numbers asserted without retrieval |
| **R3** | An independent verify gate re-fetches load-bearing facts before they are used downstream; the verifier does not trust the original claim. | inputs never re-checked before use |
| **R4** | Right-size model/effort to where correctness is load-bearing. | blanket low-cost models on critical work |
| **R5** | Carry provenance forward — pass verified/unverified status to the next stage. | — |
| **R6** | Prefer the simplest pattern; every added agent maps to a distinct failure it prevents. | — |
| **R7** | Bound the loops, surface the gaps — cap fan-out; report what could not be measured/verified. | — |

R1–R4 address the four root causes; R5–R7 are additions from the sources. Full failure → rule →
source → encoding mapping in [`.claude/workflows/RELIABILITY.md`](.claude/workflows/RELIABILITY.md).

## How it works, and its limits

- **Native — nothing to conflict with.** It is a normal Workflow script built on the standard
  `Workflow` and subagent primitives. It does not replace, wrap, or patch anything.
- **Enforced at runtime.** The `measured` provenance schema (R2) and the re-fetch verify gate (R3)
  are part of the script's control flow: a fact cannot enter the output without declaring how it was
  obtained, and load-bearing numbers are re-fetched before synthesis.
- **Advisory.** The `CLAUDE.md` pointer that makes Claude apply these rules by default when authoring
  *new* workflows is a prompt-level default, not a hard gate. A hook cannot tell a fetched number from
  a fabricated one, so this layer is intentionally prompt-level.

## Install

**Via Claude Code** — paste:

> Clone https://github.com/shimkovich/claude-reliable-workflows and follow the "For Claude Code"
> section of its README to install it.

**Manually:**

```
mkdir -p ~/.claude/workflows
cp .claude/workflows/* ~/.claude/workflows/
```

Then append `CLAUDE.snippet.md` to `~/.claude/CLAUDE.md` (create it if absent). To scope it to one
project instead of globally, keep `.claude/workflows/` inside that project and fold the rules into its
`CLAUDE.md`.

## For Claude Code

Agent-executable install steps. Idempotent — safe to re-run.

1. Copy `.claude/workflows/reliable-research.js` and `.claude/workflows/RELIABILITY.md` from this repo
   into `~/.claude/workflows/` (creating the directory if needed; overwriting is fine).
2. Open `~/.claude/CLAUDE.md` (create if absent). If it does not already contain the heading
   `## Authoring Workflows / multi-agent runs`, append a blank line and the full contents of
   `CLAUDE.snippet.md`. Otherwise make no change. Do not modify anything else in the file.

## Sources

- Anthropic — [Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)
- HumanLayer — [12-Factor Agents](https://github.com/humanlayer/12-factor-agents)
- Anthropic — [cookbook `patterns/agents`](https://github.com/anthropics/claude-cookbooks/tree/main/patterns/agents)

## License

MIT — see [LICENSE](LICENSE).
