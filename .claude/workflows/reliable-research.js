/**
 * reliable-research — a global, domain-agnostic Workflow template that bakes in a
 * small ADOPTED reliability ruleset so fact/research-heavy runs stop fabricating.
 *
 * It prevents a known failure: a multi-agent run asserting a confident, load-bearing number
 * that was never actually fetched — it was "found" via web-search narration, and nothing
 * re-checked it before a conclusion was built on top.
 *
 * Adopted from HumanLayer's 12-Factor Agents + Anthropic's Building Effective Agents. The
 * failure, per-rule sourcing, and rationale are in ./RELIABILITY.md.
 *
 * THE 7 RULES (each maps to a failure above; full writeup in ./RELIABILITY.md)
 *   R1  Ground every load-bearing fact in a tool result, not model prose.        (cause 1)
 *   R2  Schema forces a `measured` provenance flag; unmeasurable => say so,
 *       never a confident number. Self-rated "confidence" is NOT provenance.       (cause 2)
 *   R3  An independent verify gate re-pulls load-bearing facts before they are
 *       used downstream (evaluator-optimizer; verifier re-fetches, doesn't trust). (cause 3)
 *   R4  Right-size model/effort to where correctness is load-bearing.             (cause 4)
 *   R5  Carry provenance forward — pass verified/unverified status into the next
 *       stage's context; never flatten an unverified dossier into "facts".        (sources add)
 *   R6  Prefer the simplest pattern; every added agent maps to a distinct failure
 *       it prevents.                                                              (sources add)
 *   R7  Bound the loops and surface the gaps — cap verification fan-out and report
 *       what could NOT be measured/verified instead of hiding it.                 (sources add)
 *
 * USAGE
 *   Run parameterized:   Workflow({ name: 'reliable-research', args: 'your question' })
 *   or:                  Workflow({ scriptPath: '/Users/<you>/.claude/workflows/reliable-research.js',
 *                                   args: { question: '...', maxDimensions: 6, maxVerifyPerDimension: 4 } })
 *   Or copy this file as the starting point for a bespoke workflow and keep R1–R7 intact.
 */

export const meta = {
  name: 'reliable-research',
  description: 'Domain-agnostic research workflow with tool-grounded facts, a measured-provenance schema, and an independent verify gate (anti-fabrication).',
  whenToUse: 'Any fact/number-heavy research or decision workflow where a fabricated value would corrupt the conclusion.',
  phases: [
    { title: 'Plan',       detail: 'decompose the question into dimensions + the specific facts each must MEASURE' },
    { title: 'Gather',     detail: 'parallel researchers; every fact carries measured/method/value/retrieval provenance' },
    { title: 'Verify',     detail: 'independent verifiers RE-FETCH each load-bearing measured fact and vote VERIFIED/REFUTED/UNVERIFIABLE' },
    { title: 'Synthesize', detail: 'report built only on VERIFIED facts; refuted values corrected; gaps surfaced explicitly' },
  ],
}

// ---------------------------------------------------------------------------
// Inputs (R7: explicit bounds, no silent caps)
// ---------------------------------------------------------------------------
// Accept args as a plain question string, an object, OR a JSON-stringified object
// (a common caller mistake — normalize it instead of treating the blob as the question).
let _args = args
if (typeof _args === 'string') {
  const t = _args.trim()
  if (t.startsWith('{') && t.endsWith('}')) {
    try { _args = JSON.parse(t) } catch (e) { /* not JSON — keep as a plain question string */ }
  }
}
const QUESTION = typeof _args === 'string' ? _args : (_args && _args.question)
if (!QUESTION || !String(QUESTION).trim()) {
  throw new Error('reliable-research needs a question: Workflow({ name: "reliable-research", args: "your question" })')
}
const MAX_DIMENSIONS = (typeof _args === 'object' && _args.maxDimensions) || 6
const MAX_VERIFY = (typeof _args === 'object' && _args.maxVerifyPerDimension) || 4

// ---------------------------------------------------------------------------
// Schemas — R2 lives here. The provenance fields are MANDATORY, so a model
// cannot return a number without declaring how it got it.
// ---------------------------------------------------------------------------
const PLAN_SCHEMA = {
  type: 'object',
  required: ['dimensions'],
  properties: {
    dimensions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'question', 'factsToMeasure'],
        properties: {
          key: { type: 'string' },
          question: { type: 'string' },
          // The specific load-bearing facts/numbers this dimension MUST fetch from an
          // authoritative deterministic source (drives R1 + the R3 verify gate).
          factsToMeasure: { type: 'array', items: { type: 'string' } },
          authoritativeSources: {
            type: 'array',
            // Where the numbers actually live: a named API/endpoint/CLI/dataset/file.
            items: { type: 'string' },
          },
        },
      },
    },
  },
}

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['dimension', 'facts', 'qualitativeFindings', 'loadBearing'],
  properties: {
    dimension: { type: 'string' },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['claim', 'measured', 'method', 'value', 'retrieval'],
        properties: {
          claim: { type: 'string' },
          // R2: true ONLY if fetched from an authoritative deterministic tool THIS run.
          measured: { type: 'boolean' },
          // How the value was obtained. 'web-search' = read a snippet; it is NOT a measurement.
          method: { type: 'string', enum: ['tool', 'web-search', 'model-prior', 'none'] },
          value: { type: 'string' },              // raw value (with units), or '' if unmeasurable
          // R1: the EXACT API/endpoint/URL/CLI/file used. Required when method='tool'.
          retrieval: { type: 'string' },
          // Required when measured=false: WHY it could not be measured. Never substitute a guess.
          reason: { type: 'string' },
        },
      },
    },
    qualitativeFindings: { type: 'array', items: { type: 'string' } },
    // Which claims the eventual conclusion depends on — these get verified first (R3).
    loadBearing: { type: 'array', items: { type: 'string' } },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['claim', 'verdict', 'independentValue', 'matches', 'severity', 'retrieval'],
  properties: {
    claim: { type: 'string' },
    independentValue: { type: 'string' },        // value from the verifier's OWN fresh fetch
    matches: { type: 'boolean' },
    // Enum gate (cookbook evaluator_optimizer style). UNVERIFIABLE => must not be used as fact.
    verdict: { type: 'string', enum: ['VERIFIED', 'REFUTED', 'UNVERIFIABLE'] },
    severity: { type: 'string', enum: ['low', 'medium', 'high', 'fatal'] }, // impact if the number is wrong
    retrieval: { type: 'string' },               // how the verifier re-fetched (R1, again)
    note: { type: 'string' },
  },
}

// ---------------------------------------------------------------------------
// Shared anti-fabrication scaffolding (R1 + R2). Injected into every researcher.
// Mirrors Anthropic's own research-subagent prompt: "flag these issues when
// returning your report... rather than blindly presenting all results as
// established facts."
// ---------------------------------------------------------------------------
const GROUNDING = `GROUND-TRUTH RULES (non-negotiable):
- Every number/fact your conclusion could rest on MUST come from an authoritative deterministic source you actually call THIS turn — a JSON/REST API, CLI, query, or file. Web-search snippet narration and model memory are NOT measurements. If the data lives behind an API, find and CALL that API.
- To use tools, call ToolSearch first (e.g. "select:WebFetch", "select:Bash", "select:WebSearch") then invoke them. Prefer the API/CLI that returns the raw value over a page that describes it.
- For each fact set measured=true ONLY if you fetched it from such a source this turn; then record the exact \`retrieval\` (endpoint/URL/command) and the raw \`value\`.
- If you could NOT measure it: set measured=false, method='none', value='', and give a \`reason\`. DO NOT output a confident number you did not retrieve — an admitted gap is worth more than a fabricated value.
- Put every claim the conclusion depends on into \`loadBearing\`. Do not restate the question back; return only what you actually found.`

// ===========================================================================
// PHASE 1 — PLAN (orchestrator-workers: decompose only because sub-questions
// for an arbitrary query aren't predictable). R4: planning is load-bearing.
// ===========================================================================
phase('Plan')
const plan = await agent(
  `Decompose this research question into at most ${MAX_DIMENSIONS} independent dimensions.\n\nQUESTION: ${QUESTION}\n\nFor each dimension give: a key, the precise sub-question, the specific FACTS/NUMBERS that must be MEASURED to answer it (be concrete — "X's current value", not "background on X"), and the authoritative source(s) where each number actually lives (named API/endpoint/CLI/dataset/file, if one exists). Favor fewer, sharper dimensions over many vague ones (R6).`,
  { label: 'plan', phase: 'Plan', schema: PLAN_SCHEMA, effort: 'high' },
)
const dimensions = (plan.dimensions || []).slice(0, MAX_DIMENSIONS)
log(`Plan: ${dimensions.length} dimensions — ${dimensions.map(d => d.key).join(', ')}`)

// ===========================================================================
// PHASES 2+3 — GATHER then VERIFY, pipelined so each dimension verifies as
// soon as its gather completes (no barrier between gather and verify).
// ===========================================================================
const perDimension = await pipeline(
  dimensions,

  // --- Stage GATHER (R1, R2). Moderate effort: breadth, not the load-bearing check.
  (d) => agent(
    `${GROUNDING}\n\nDIMENSION "${d.key}": ${d.question}\nFACTS TO MEASURE: ${(d.factsToMeasure || []).join('; ')}\nLIKELY AUTHORITATIVE SOURCES: ${(d.authoritativeSources || []).join('; ') || '(find them)'}`,
    { label: `gather:${d.key}`, phase: 'Gather', schema: FINDINGS_SCHEMA, agentType: 'general-purpose', effort: 'medium' },
  ),

  // --- Stage VERIFY (R3, R4, R7). Independent re-fetch of each claimed-measured
  // fact, load-bearing ones first. Higher effort: this is where correctness lives.
  (findings, d) => {
    if (!findings) return null
    const lb = new Set(findings.loadBearing || [])
    const ranked = (findings.facts || [])
      .filter(f => f.measured)                                   // only claimed-measured facts can be re-fetched
      .sort((a, b) => (lb.has(b.claim) ? 1 : 0) - (lb.has(a.claim) ? 1 : 0)) // load-bearing first
    const toVerify = ranked.slice(0, MAX_VERIFY)
    if (ranked.length > toVerify.length) {
      log(`verify cap: ${d.key} has ${ranked.length} measured facts, verifying ${toVerify.length} (cap ${MAX_VERIFY}); rest left UNVERIFIED`) // R7: no silent caps
    }
    const unmeasuredLoadBearing = (findings.facts || [])
      .filter(f => !f.measured && lb.has(f.claim))
      .map(f => ({ claim: f.claim, reason: f.reason || 'not measured' }))

    return parallel(toVerify.map(f => () =>
      agent(
        `You are a VERIFIER. Evaluate ONLY — do not try to make the claim true (cookbook: "evaluate only, do not solve").\n\nA prior agent claimed for dimension "${d.key}":\n  claim: ${f.claim}\n  value: ${f.value}\n  it says it used: ${f.method} via ${f.retrieval || '(none given)'}\n\nIndependently RE-FETCH this value yourself from the authoritative deterministic source (ToolSearch -> call the API/CLI/file). Do NOT trust the claimed value or retrieval — reproduce it from scratch.\n\nReturn verdict=VERIFIED only if your independent fetch matches; REFUTED if it differs (put the true number in independentValue); UNVERIFIABLE if no authoritative source can actually be reached (then it must NOT be used as a fact). Rate severity = how badly the conclusion breaks if this number is wrong.`,
        { label: `verify:${d.key}`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high' },
      )
    )).then(vs => ({
      dimension: d.key,
      findings,
      verdicts: vs.filter(Boolean),
      unmeasuredLoadBearing,
    }))
  },
)

const results = perDimension.filter(Boolean)
const allVerdicts = results.flatMap(r => r.verdicts || [])
const verified = allVerdicts.filter(v => v.verdict === 'VERIFIED')
const refuted = allVerdicts.filter(v => v.verdict === 'REFUTED')
const unverifiable = allVerdicts.filter(v => v.verdict === 'UNVERIFIABLE')
const unmeasured = results.flatMap(r => r.unmeasuredLoadBearing || [])
log(`Verify: ${verified.length} VERIFIED, ${refuted.length} REFUTED, ${unverifiable.length} UNVERIFIABLE, ${unmeasured.length} load-bearing facts never measured`)

// Gate (R3): if a fatal load-bearing fact was refuted, the conclusion is already suspect — say so loudly.
const fatalRefuted = refuted.filter(v => v.severity === 'fatal' || v.severity === 'high')
if (fatalRefuted.length) {
  log(`WARNING: ${fatalRefuted.length} high/fatal load-bearing fact(s) were REFUTED on re-fetch — synthesis will treat them as false.`)
}

// ===========================================================================
// PHASE 4 — SYNTHESIZE. R5: provenance is carried forward explicitly; the
// writer is handed VERIFIED / REFUTED / UNVERIFIABLE / UNMEASURED as separate
// buckets, never a flattened "dossier of facts". R7: gaps are a required section.
// ===========================================================================
phase('Synthesize')
const report = await agent(
  `Write a complete, self-contained markdown report answering: ${QUESTION}\n\n` +
  `You are given facts already partitioned by verification status. Obey these rules:\n` +
  `- Build conclusions ONLY on VERIFIED facts.\n` +
  `- For any REFUTED fact, use the verifier's independentValue and treat the original as false.\n` +
  `- NEVER present an UNVERIFIABLE or UNMEASURED value as established. Reference them only inside the gaps section.\n` +
  `- Quote real source URLs/endpoints inline next to each number.\n\n` +
  `VERIFIED FACTS:\n${JSON.stringify(verified, null, 2)}\n\n` +
  `REFUTED (use independentValue, treat claim as false):\n${JSON.stringify(refuted, null, 2)}\n\n` +
  `UNVERIFIABLE (do NOT use as fact):\n${JSON.stringify(unverifiable, null, 2)}\n\n` +
  `LOAD-BEARING FACTS NEVER MEASURED (gaps):\n${JSON.stringify(unmeasured, null, 2)}\n\n` +
  `QUALITATIVE FINDINGS:\n${JSON.stringify(results.map(r => ({ dimension: r.dimension, notes: r.findings && r.findings.qualitativeFindings })), null, 2)}\n\n` +
  `Required sections: (1) Answer/verdict; (2) Supporting evidence (verified numbers with sources); (3) Confidence & gaps — explicitly list what was REFUTED, UNVERIFIABLE, or never measured, and how that limits the answer; (4) Recommended next step. Be decisive where facts are verified and honest where they are not.`,
  { label: 'synthesize', phase: 'Synthesize', effort: 'high' },
)

return { question: QUESTION, plan, results, verified, refuted, unverifiable, unmeasured, report }
