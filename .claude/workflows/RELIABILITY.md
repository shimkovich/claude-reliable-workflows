# Reliable Workflows — an adopted ruleset for Claude Code Workflow / multi-agent runs

A small, **global, domain-agnostic** set of rules that make fact/research-heavy agent
runs stop fabricating. The rules are **adopted, not invented** — lifted from two proven,
framework-free sources and merely encoded into Claude Code's native `Workflow` + subagent
primitives. They are encoded, ready to use, in [`reliable-research.js`](./reliable-research.js).

## What went wrong (the failure these rules prevent)

A multi-agent research workflow asserted a confident, load-bearing number that was wrong, and a
downstream red-team built its verdict on top of it. The number had been "found" through
web-search narration rather than fetched from the authoritative source — which sat behind an API
the run never called — and nothing re-checked it before it was used. Four general (non-domain)
root causes:

1. Numbers were **"found" by web-search narration** instead of fetched by a deterministic tool. The data lived behind an API nobody called.
2. The agent **asserted a confident number** instead of flagging "couldn't measure." The schema didn't force a measured/unmeasured distinction.
3. **No verification gate** — the red-team was told to attack the conclusion, so it treated a bad input fact as ground truth.
4. **Blanket low-cost model/effort** raised fabrication risk on the load-bearing stage.

## Adopted sources

- **Anthropic, "Building Effective Agents"** — <https://www.anthropic.com/research/building-effective-agents>. Core thesis: *"the simplest solution possible, only increasing complexity when needed."* Gives us the **evaluator-optimizer** pattern (an independent evaluator with clear pass/fail criteria = our verify gate), **parallelization/voting** (independent re-checks), and the principle that an agent must *"gain 'ground truth' from the environment at each step (such as tool call results or code execution)."*
- **HumanLayer, "12-Factor Agents"** — <https://github.com/humanlayer/12-factor-agents>. A set of *principles* (not a framework) for reliable LLM apps. We use: **#1/#4** tools are structured outputs / real data enters via tool execution; **#13** pre-fetch known-needed data deterministically; **#2** own your prompts (versioned, in the script); **#7** declare intent including "couldn't"; **#9** compact errors but **cap retries**; **#10** small focused agents.
- **Anthropic cookbook, `patterns/agents`** — <https://github.com/anthropics/claude-cookbooks/tree/main/patterns/agents>. `evaluator_optimizer.ipynb` gives the concrete evaluator wording: the evaluator is told *"You should be evaluating only and not attempting to solve the task,"* returns an **enum verdict**, and the loop is **bounded** (the reference loop's missing cap is a known bug — we add one). `prompts/research_subagent.md` is Anthropic's own subagent instruction to *"flag these issues when returning your report... rather than blindly presenting all results as established facts."*

## The 7 rules

Rules 1–4 are the direct fixes for the four causes above; rules 5–7 are what the adopted
sources add.

| # | Rule | Fixes | Source | Encoded as |
|---|------|-------|--------|-----------|
| **R1** | **Ground every load-bearing fact in a tool result, not model prose.** A number the conclusion rests on must come from an authoritative deterministic source (API/CLI/query/file) called *this turn* — web-search snippet narration and model memory are not measurements. | Cause 1 | Building Effective Agents ("ground truth from the environment"); 12-Factor #1/#4/#13 | `GROUNDING` prompt block + `retrieval` field required on every fact |
| **R2** | **Schema forces a `measured` provenance flag; unmeasurable ⇒ say so, never a confident number.** Self-rated "confidence" is NOT provenance (the fabricating model sets it). | Cause 2 | 12-Factor #2/#4/#7; cookbook research_subagent ("flag... rather than blindly presenting") | `FINDINGS_SCHEMA`: mandatory `measured` / `method` / `value` / `retrieval` / `reason` |
| **R3** | **An independent verify gate re-pulls load-bearing facts before they're used downstream.** A separate verifier *re-fetches* each claimed-measured fact (doesn't trust the claim) and returns an enum verdict; critics/red-teams verify inputs, not assume them. | Cause 3 | Building Effective Agents (evaluator-optimizer + voting); cookbook ("evaluate only, do not solve" + enum gate) | `Verify` phase: independent re-fetch agent per fact, `VERDICT_SCHEMA` enum `VERIFIED/REFUTED/UNVERIFIABLE` |
| **R4** | **Right-size model/effort to where correctness is load-bearing.** Don't blanket-cheap; spend on verification and load-bearing reasoning, economize on breadth. | Cause 4 | Building Effective Agents (match cost/complexity to task); 12-Factor #10 | Plan/Verify/Synthesize at `effort: 'high'`; Gather at `'medium'` |
| **R5** | **Carry provenance forward.** Pass verified/unverified status into the next stage's context; never flatten an unverified dossier into "facts." | sources add | 12-Factor #2/#3 (own prompts & context) | Synthesize receives `verified` / `refuted` / `unverifiable` / `unmeasured` as separate buckets, not one dossier |
| **R6** | **Prefer the simplest pattern; every added agent maps to a distinct failure it prevents.** A large fan-out without a verify gate is complexity without the reliability that justifies it. | sources add | Building Effective Agents (core thesis); 12-Factor #10 | Single planner; dimensions capped; no agent without a job |
| **R7** | **Bound the loops and surface the gaps.** Cap verification fan-out; report what could NOT be measured/verified instead of hiding it (silent partial coverage reads as "complete"). | sources add | 12-Factor #9 (cap retries); Building Effective Agents (stopping conditions); cookbook (add the missing cap) | `MAX_VERIFY` cap + `log()` of drops; required "Confidence & gaps" report section |

## Settings / hooks decision

The rules live in the workflow script plus a one-line `~/.claude/CLAUDE.md` pointer — not in
`settings.json` hooks. A hook can't enforce them: "did this number come from a real tool call
rather than a hallucination?" is a semantic property, not something a regex over a tool call can
check. With nothing reliable to enforce mechanically, the rules belong in versioned script/prompt
artifacts (12-Factor #2, "own your prompts"), where they're inspectable and testable.

## How to use

- **Run it parameterized:** `Workflow({ name: 'reliable-research', args: 'your question' })`
  (or `args: { question, maxDimensions, maxVerifyPerDimension }`; or
  `Workflow({ scriptPath: '~/.claude/workflows/reliable-research.js', args: ... })` — use an
  absolute path).
- **Adapt it:** copy `reliable-research.js` as the starting point for a bespoke workflow and
  keep R1–R7 intact. The two non-negotiables when adapting: the `measured`-provenance schema
  (R2) and the independent re-fetch verify gate (R3). Everything else can be reshaped.
- **Retrofit an existing workflow:** add the `measured`/`retrieval` fields to your findings
  schema, insert one verify agent between gather and synthesize that re-fetches load-bearing
  numbers, and feed the synthesizer verified-vs-unverified buckets instead of a raw dossier.
