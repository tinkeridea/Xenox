/**
 * IdeaProbe — Slice 2D Regression Test Suite: Evidence-Grounded Report Verdict Fix
 *
 * Verifies:
 * 1. Suite 1 — No sources and no evidence yields PRE-VALIDATION.
 * 2. Suite 2 — Placeholder sources only (RFC 2606, demo_fixture, SAMPLE, user_input) yield PRE-VALIDATION.
 * 3. Suite 3 — Real sources only yield active validation status (IN PROGRESS).
 * 4. Suite 4 — Mixture of placeholder and real sources correctly filters placeholders and recognizes real data.
 * 5. Suite 5 — Simulated or sample content without real validation evidence yields PRE-VALIDATION (even with validated assumptions).
 * 6. Suite 6 — Real evidence items qualify hasRealData while placeholder-backed evidence items are quarantined.
 * 7. Suite 7 — Existing valid report-verdict behaviors (HYPOTHESIS CHALLENGED, PARTIAL VALIDATION, IN PROGRESS) remain unchanged.
 * 8. Suite 8 — Production database invariance (229 snapshots, 0 writes).
 */

import { buildVerdict } from "./src/app/api/projects/[id]/report/route";
import { createClient } from "@libsql/client";
import path from "path";

let passed = 0;
let failed = 0;

function assert(testName: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${testName}${detail ? `: ${detail}` : ""}`);
    failed++;
  }
}

async function runTestSuite() {
  console.log("==================================================================");
  console.log("IdeaProbe — Slice 2D Test Suite: Evidence-Grounded Report Verdict Fix");
  console.log("==================================================================\n");

  // ── Suite 1: No sources and no evidence ────────────────────────────
  console.log("── Suite 1: No sources and no evidence ──");
  {
    const verdict = buildVerdict({
      assumptions: [{ status: "unvalidated", uncertainty: "Critical", impact: "High" }],
      experiments: [{ id: "exp-001" }],
      realResults: [],
      sources: [],
      evidence: [],
    });

    assert("Empty project yields PRE-VALIDATION status", verdict.includes("VALIDATION STATUS: ⛔ PRE-VALIDATION"));
    assert("Includes warning about zero real customer data", verdict.includes("No real customer data, experiment results, or verified sources have been collected."));
    assert("Counts critical untested assumptions correctly", verdict.includes("Conduct 1 untested critical assumption interview(s) with real customers"));
    assert("Instructs not to build until Experiment 1 passes", verdict.includes("Do not build until Experiment 1 passes its defined threshold."));
  }

  // ── Suite 2: Placeholder sources only ──────────────────────────────
  console.log("\n── Suite 2: Placeholder sources only ──");
  {
    // 2a: RFC 2606 example domain
    const verdictRfc = buildVerdict({
      assumptions: [{ status: "unvalidated", uncertainty: "High", impact: "High" }],
      experiments: [{ id: "exp-1" }],
      realResults: [],
      sources: [
        { id: "s-1", url: "https://example.com/edtech-study", title: "Example Study", source_type: "web" },
      ],
      evidence: [],
    });
    assert("RFC 2606 domain source (example.com) alone yields PRE-VALIDATION", verdictRfc.includes("VALIDATION STATUS: ⛔ PRE-VALIDATION"));

    // 2b: Demo fixture source_type
    const verdictFixture = buildVerdict({
      assumptions: [{ status: "unvalidated", uncertainty: "Critical", impact: "High" }],
      experiments: [{ id: "exp-1" }],
      realResults: [],
      sources: [
        { id: "s-2", url: "https://study-platform.io/fixture", title: "Demo Fixture", source_type: "demo_fixture" },
      ],
      evidence: [],
    });
    assert("source_type 'demo_fixture' alone yields PRE-VALIDATION", verdictFixture.includes("VALIDATION STATUS: ⛔ PRE-VALIDATION"));

    // 2c: Explicit SAMPLE provenance
    const verdictSample = buildVerdict({
      assumptions: [{ status: "unvalidated", uncertainty: "Critical", impact: "High" }],
      experiments: [{ id: "exp-1" }],
      realResults: [],
      sources: [
        { id: "s-3", url: "https://custom-domain.org/data", title: "Sample Survey", provenance: "SAMPLE" },
      ],
      evidence: [],
    });
    assert("provenance 'SAMPLE' source alone yields PRE-VALIDATION", verdictSample.includes("VALIDATION STATUS: ⛔ PRE-VALIDATION"));

    // 2d: Default seed project setup (3 demo fixtures with RFC 2606 domains)
    const verdictSeed = buildVerdict({
      assumptions: [
        { status: "unvalidated", uncertainty: "Critical", impact: "High" },
        { status: "unvalidated", uncertainty: "High", impact: "Medium" },
      ],
      experiments: [{ id: "exp-concierge" }],
      realResults: [],
      sources: [
        { id: "src-001", url: "https://example.edu/research/indian-higher-ed-stress-2025", title: "State of Indian Higher Education", source_type: "demo_fixture" },
        { id: "src-002", url: "https://example.org/reports/mobile-learning-churn", title: "Mobile App Adherence", source_type: "demo_fixture" },
        { id: "src-003", url: "https://example.in/edtech-market-report-india-2026", title: "India EdTech Market", source_type: "demo_fixture" },
      ],
      evidence: [],
    });
    assert("Multiple seed demo fixtures (sources.length == 3) yield PRE-VALIDATION instead of false IN PROGRESS", verdictSeed.includes("VALIDATION STATUS: ⛔ PRE-VALIDATION"));

    // 2e: User input notes without external research
    const verdictUserInput = buildVerdict({
      assumptions: [{ status: "unvalidated", uncertainty: "Critical", impact: "High" }],
      experiments: [],
      realResults: [],
      sources: [
        { id: "src-note", url: null, title: "Founder Scratchpad Note", source_type: "user_input", provenance: "USER_INPUT" },
      ],
      evidence: [],
    });
    assert("USER_INPUT / user_input source notes alone yield PRE-VALIDATION", verdictUserInput.includes("VALIDATION STATUS: ⛔ PRE-VALIDATION"));
  }

  // ── Suite 3: Real sources only ──
  console.log("\n── Suite 3: Real sources only ──");
  {
    // 3a: Real external web source
    const verdictRealWeb = buildVerdict({
      assumptions: [{ status: "unvalidated", uncertainty: "Critical", impact: "High" }],
      experiments: [{ id: "exp-1" }],
      realResults: [],
      sources: [
        { id: "src-tc", url: "https://techcrunch.com/2026/01/edtech-funding-analysis", title: "TechCrunch EdTech Funding", source_type: "web", provenance: "REAL_SOURCE" },
      ],
      evidence: [],
    });
    assert("Real external web source qualifies hasRealData -> IN PROGRESS", verdictRealWeb.includes("VALIDATION STATUS: 🟡 IN PROGRESS"));
    assert("Real web source does NOT say PRE-VALIDATION", !verdictRealWeb.includes("⛔ PRE-VALIDATION"));

    // 3b: Real document source
    const verdictRealDoc = buildVerdict({
      assumptions: [{ status: "unvalidated", uncertainty: "Medium", impact: "Medium" }],
      experiments: [{ id: "exp-1" }],
      realResults: [],
      sources: [
        { id: "src-doc", url: "https://arxiv.org/pdf/2501.99999.pdf", title: "ArXiv Preprint Study", source_type: "document" },
      ],
      evidence: [],
    });
    assert("Real document source qualifies hasRealData -> IN PROGRESS", verdictRealDoc.includes("VALIDATION STATUS: 🟡 IN PROGRESS"));
  }

  // ── Suite 4: Mixture of placeholder and real sources ────────────────
  console.log("\n── Suite 4: Mixture of placeholder and real sources ──");
  {
    const mixedSources = [
      { id: "s-demo-1", url: "https://example.edu/demo", title: "Placeholder Demo", source_type: "demo_fixture" },
      { id: "s-demo-2", url: "https://example.org/fake", title: "Sample", provenance: "SAMPLE" },
      { id: "s-real-1", url: "https://wsj.com/articles/student-productivity-2026", title: "WSJ Student Survey", source_type: "web" },
    ];

    const verdictMixed = buildVerdict({
      assumptions: [{ status: "unvalidated", uncertainty: "Critical", impact: "High" }],
      experiments: [{ id: "exp-1" }],
      realResults: [],
      sources: mixedSources,
      evidence: [],
    });

    assert("Mixture containing 1 real source and 2 placeholders qualifies hasRealData -> IN PROGRESS", verdictMixed.includes("VALIDATION STATUS: 🟡 IN PROGRESS"));

    // Verify removing the 1 real source causes immediate fallback to PRE-VALIDATION
    const placeholdersOnly = mixedSources.filter((s) => s.id !== "s-real-1");
    const verdictWithoutReal = buildVerdict({
      assumptions: [{ status: "unvalidated", uncertainty: "Critical", impact: "High" }],
      experiments: [{ id: "exp-1" }],
      realResults: [],
      sources: placeholdersOnly,
      evidence: [],
    });

    assert("Removing real source reverts verdict immediately to PRE-VALIDATION", verdictWithoutReal.includes("VALIDATION STATUS: ⛔ PRE-VALIDATION"));
  }

  // ── Suite 5: Simulated or sample content without real validation evidence ──
  console.log("\n── Suite 5: Simulated or sample content without real validation evidence ──");
  {
    // A project with simulated personas, simulated experiment results, and sample claims:
    // Founder marked assumption as "validated" in hypothetical draft, but NO real evidence exists
    const verdictSimulated = buildVerdict({
      assumptions: [
        { id: "asm-1", statement: "Students will pay $10/mo", status: "validated", uncertainty: "Critical", impact: "High" },
      ],
      experiments: [
        { id: "exp-sim", hypothesis: "Price test", status: "completed", provenance: "SIMULATED", result: "Simulated persona said they would pay" },
      ],
      realResults: [
        { id: "exp-sim", provenance: "SIMULATED", result: "Simulated persona said they would pay" },
      ],
      sources: [
        { id: "src-sim", url: "https://example.com/simulated-interview", title: "Simulated Transcripts", source_type: "demo_fixture" },
      ],
      evidence: [
        { id: "ev-sample", claim: "Simulated interview claim", provenance: "SAMPLE", source_url: "https://example.com/sim" },
        { id: "ev-sim", claim: "AI generated persona quote", provenance: "SIMULATED" },
      ],
    });

    assert("Simulated content with 'validated' assumption still yields PRE-VALIDATION", verdictSimulated.includes("VALIDATION STATUS: ⛔ PRE-VALIDATION"));
    assert("Does not falsely claim PARTIAL VALIDATION from simulated results", !verdictSimulated.includes("🟡 PARTIAL VALIDATION"));
    assert("Preserves prompt warning that premise has not been confirmed", verdictSimulated.includes("The core premise has not been falsified yet, but it has also not been confirmed."));
  }

  // ── Suite 6: Evidence item qualification and placeholder quarantine ──
  console.log("\n── Suite 6: Evidence item qualification and placeholder quarantine ──");
  {
    // 6a: Independently verified real evidence item
    const verdictVerifiedReal = buildVerdict({
      assumptions: [{ status: "unvalidated", uncertainty: "Critical", impact: "High" }],
      experiments: [{ id: "exp-1" }],
      realResults: [],
      sources: [],
      evidence: [
        {
          id: "ev-real-1",
          provenance: "REAL_SOURCE",
          source_url: "https://nature.com/articles/edtech-study",
          reviewer_status: "ACCEPTED",
          claim: "Verified study finding",
        },
      ],
    });
    assert("Independently verified real evidence item qualifies hasRealData -> IN PROGRESS", verdictVerifiedReal.includes("VALIDATION STATUS: 🟡 IN PROGRESS"));

    // 6b: Evidence item tagged REAL_SOURCE but backed by RFC 2606 domain (quarantined)
    const verdictQuarantined = buildVerdict({
      assumptions: [{ status: "unvalidated", uncertainty: "Critical", impact: "High" }],
      experiments: [{ id: "exp-1" }],
      realResults: [],
      sources: [],
      evidence: [
        {
          id: "ev-fake-1",
          provenance: "REAL_SOURCE",
          source_url: "https://example.com/fake-evidence",
          reviewer_status: "ACCEPTED",
          claim: "Unverified placeholder claim masquerading as real",
        },
      ],
    });
    assert("Evidence item tagged REAL_SOURCE on example.com domain is quarantined -> PRE-VALIDATION", verdictQuarantined.includes("VALIDATION STATUS: ⛔ PRE-VALIDATION"));

    // 6c: Evidence item with AI_INFERENCE or USER_INPUT provenance
    const verdictAiEvidence = buildVerdict({
      assumptions: [{ status: "unvalidated", uncertainty: "Critical", impact: "High" }],
      experiments: [],
      realResults: [],
      sources: [],
      evidence: [
        { id: "ev-ai", provenance: "AI_INFERENCE", claim: "Model synthesized claim" },
        { id: "ev-ui", provenance: "USER_INPUT", claim: "User stated belief" },
      ],
    });
    assert("AI_INFERENCE and USER_INPUT evidence items alone yield PRE-VALIDATION", verdictAiEvidence.includes("VALIDATION STATUS: ⛔ PRE-VALIDATION"));
  }

  // ── Suite 7: Existing valid report-verdict behaviors preserved ──────
  console.log("\n── Suite 7: Existing valid report-verdict behaviors preserved ──");
  {
    const realSourceFixture = [
      { id: "src-tc", url: "https://bloomberg.com/reports/edtech", title: "Bloomberg EdTech", source_type: "web" },
    ];

    // 7a: HYPOTHESIS CHALLENGED (invalidated > validated)
    const verdictChallenged = buildVerdict({
      assumptions: [
        { id: "a-1", status: "invalidated", uncertainty: "High", impact: "High" },
        { id: "a-2", status: "invalidated", uncertainty: "Medium", impact: "High" },
        { id: "a-3", status: "validated", uncertainty: "Low", impact: "Low" },
      ],
      experiments: [{ id: "exp-1" }],
      realResults: [],
      sources: realSourceFixture,
      evidence: [],
    });
    assert("Invalidated > validated assumptions yields HYPOTHESIS CHALLENGED", verdictChallenged.includes("VALIDATION STATUS: 🔴 HYPOTHESIS CHALLENGED"));
    assert("Includes exact count of invalidated vs validated", verdictChallenged.includes("2 assumption(s) have been invalidated vs 1 validated."));
    assert("Includes pivot guidance", verdictChallenged.includes("The current direction requires a pivot or deeper investigation."));

    // 7b: PARTIAL VALIDATION (realResults > 0 and validated > 0) with untested critical assumptions
    const verdictPartialUntested = buildVerdict({
      assumptions: [
        { id: "a-1", status: "validated", uncertainty: "Low", impact: "Low" },
        { id: "a-2", status: "unvalidated", uncertainty: "Critical", impact: "High" }, // score 12 >= 6
      ],
      experiments: [{ id: "exp-1" }],
      realResults: [
        { id: "exp-1", provenance: "REAL_EXPERIMENT_RESULT", result: "35% conversion achieved" },
      ],
      sources: realSourceFixture,
      evidence: [],
    });
    assert("Real results > 0 and validated > 0 yields PARTIAL VALIDATION", verdictPartialUntested.includes("VALIDATION STATUS: 🟡 PARTIAL VALIDATION"));
    assert("Mentions count of real experiment results and validated assumptions", verdictPartialUntested.includes("1 real experiment result(s) recorded. 1 assumption(s) validated."));
    assert("Warns about untested critical assumptions", verdictPartialUntested.includes("1 critical/high assumptions still untested — continue validation before committing to full build."));

    // 7c: PARTIAL VALIDATION (realResults > 0 and validated > 0) with ALL critical assumptions tested
    const verdictPartialComplete = buildVerdict({
      assumptions: [
        { id: "a-1", status: "validated", uncertainty: "Critical", impact: "High" },
        { id: "a-2", status: "validated", uncertainty: "High", impact: "High" },
      ],
      experiments: [{ id: "exp-1" }],
      realResults: [
        { id: "exp-1", provenance: "REAL_EXPERIMENT_RESULT", result: "Achieved threshold" },
      ],
      sources: realSourceFixture,
      evidence: [],
    });
    assert("All critical assumptions tested recommends progressing to MVP", verdictPartialComplete.includes("All critical assumptions have been tested. Consider progressing to MVP build phase."));

    // 7d: IN PROGRESS (validation pipeline active)
    const verdictInProgress = buildVerdict({
      assumptions: [
        { id: "a-1", status: "unvalidated", uncertainty: "Low", impact: "Low" },
      ],
      experiments: [{ id: "exp-1" }, { id: "exp-2" }],
      realResults: [],
      sources: realSourceFixture,
      evidence: [],
    });
    assert("Real data with experiments designed yields IN PROGRESS", verdictInProgress.includes("VALIDATION STATUS: 🟡 IN PROGRESS"));
    assert("Mentions designed experiments and validated assumptions", verdictInProgress.includes("Validation pipeline is active. 2 experiment(s) designed, 0 assumption(s) validated."));
  }

  // ── Suite 8: Production database invariance check ──────────────────
  console.log("\n── Suite 8: Production Database Invariance ──");
  {
    const dbPath = path.resolve(__dirname, ".ideaprobe-data", "ideaprobe.db");
    const client = createClient({
      url: `file:${dbPath.replace(/\\/g, "/")}`,
    });

    try {
      const res = await client.execute("SELECT COUNT(*) as count, MAX(version) as max_version FROM report_snapshots");
      const row: any = res.rows[0];
      assert("Production database report_snapshots count remains 230", row.count === 230, `Got ${row.count}`);
      assert("Production database report_snapshots max_version remains 229", row.max_version === 229, `Got ${row.max_version}`);
    } catch (err: any) {
      console.error("  [FAIL] Database invariance query failed:", err.message);
      failed++;
    }
  }

  console.log("\n==================================================================");
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} assertions.`);
  console.log("==================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test runner threw unexpected exception:", err);
  process.exit(1);
});
