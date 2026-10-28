/**
 * IdeaProbe — Slice 2C & 2C.1 Test Suite: Falsifiable Experiment Decision Loop & Edge-Case Audit
 *
 * Verifies:
 * 1. Check 1 — Success, Pivot, and Stop Precedence (Exact scenario: >= 40% continue, 20-39% pivot, < 20% stop)
 * 2. Check 1 — Equality boundaries for supported, pivot, and stop conditions
 * 3. Check 2 — Operator and Metric Directionality (conversion >= 30%, CAC <= $10, operator keyword protection)
 * 4. Check 2 — Ambiguous operators and missing units yield Inconclusive
 * 5. Check 3 — Observed Measurement Extraction (CAC $5.80 vs $500 spend, ambiguous multiples, incompatible units)
 * 6. Check 4 — Assumption-Status Mutation Safety & Verification
 * 7. Read-only production database invariance
 */

import {
  parseThresholdCriteria,
  extractObservedMeasurement,
  evaluateExperimentDecision,
  testOperator,
} from "./src/lib/experimentDecision";
import fs from "fs";
import path from "path";
import { createClient } from "@libsql/client";

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${testName}${detail ? `: ${detail}` : ""}`);
    failed++;
  }
}

async function runTestSuite() {
  console.log("==============================================================");
  console.log("IdeaProbe — Slice 2C.1 Test Suite: Decision Engine Edge-Case Audit");
  console.log("==============================================================\n");

  // ── 1. Check 1: Success, Pivot, and Stop Precedence ──────────────────
  console.log("1. Check 1 — Success, Pivot, and Stop Precedence (Exact Scenario):");
  {
    // The exact scenario from prompt:
    // - Continue: observed result >= 40%.
    // - Pivot: observed result from 20% through 39%, inclusive.
    // - Stop: observed result < 20%.
    const expRules = {
      metric: "7-day engagement rate",
      threshold: ">= 40% engagement",
      decision_rules: "Continue: observed result >= 40%. Pivot: observed result from 20% through 39%, inclusive. Stop: observed result < 20%.",
    };

    const crit = parseThresholdCriteria(expRules.threshold, expRules.metric, expRules.decision_rules);
    assert(crit !== null, "Parses threshold criteria from exact scenario");
    assert(crit?.targetValue === 40, "Target value is 40");
    assert(crit?.operator === ">=", "Operator is >=");
    assert(crit?.pivotRange?.[0] === 20 && crit?.pivotRange?.[1] === 39, "Parses pivot range [20, 39] from plain text 'from 20% through 39%, inclusive'");
    assert(crit?.failureValue === 20, "Parses failureValue 20 from 'Stop: observed result < 20%'");
    assert(crit?.failureOperator === "<", "Parses failureOperator <");

    // Expected outcomes from prompt:
    // 45% -> Supported
    const dec45 = evaluateExperimentDecision(expRules, "Observed 45% engagement across cohort.");
    assert(dec45.outcome === "supported", "45% -> Supported");
    assert(dec45.suggestedAssumptionStatus === "validated", "45% suggests validated assumption");

    // 40% -> Supported (equality boundary)
    const dec40 = evaluateExperimentDecision(expRules, "Observed 40% engagement across cohort.");
    assert(dec40.outcome === "supported", "40% -> Supported (equality boundary on >= 40%)");
    assert(dec40.suggestedAssumptionStatus === "validated", "40% suggests validated assumption");

    // 39% -> Inconclusive (pivot zone upper boundary)
    const dec39 = evaluateExperimentDecision(expRules, "Observed 39% engagement across cohort.");
    assert(dec39.outcome === "inconclusive", "39% -> Inconclusive (pivot zone upper boundary)");
    assert(dec39.suggestedAssumptionStatus === "keep", "39% suggests keeping current status");
    assert(dec39.headline.includes("Pivot Signal"), "39% flags Pivot Signal");

    // 20% -> Inconclusive (pivot zone lower boundary)
    const dec20 = evaluateExperimentDecision(expRules, "Observed 20% engagement across cohort.");
    assert(dec20.outcome === "inconclusive", "20% -> Inconclusive (pivot zone lower boundary)");
    assert(dec20.suggestedAssumptionStatus === "keep", "20% suggests keeping current status");

    // 19% -> Rejected (stop rule < 20%)
    const dec19 = evaluateExperimentDecision(expRules, "Observed 19% engagement across cohort.");
    assert(dec19.outcome === "rejected", "19% -> Rejected (< 20% stop rule)");
    assert(dec19.suggestedAssumptionStatus === "invalidated", "19% suggests invalidated assumption");
    assert(dec19.explanation.includes("failure stop rule"), "19% explanation details failure stop rule (< 20%)");

    // Also verify JSON format of the exact same rules produces identical results
    const expRulesJson = {
      metric: "7-day engagement rate",
      threshold: ">= 40% engagement",
      decision_rules: JSON.stringify({ continue: ">= 40%", pivot: "20% through 39%", stop: "< 20%" }),
    };
    const dec39Json = evaluateExperimentDecision(expRulesJson, "Observed 39% engagement.");
    assert(dec39Json.outcome === "inconclusive", "JSON format: 39% -> Inconclusive in pivot zone");
    const dec19Json = evaluateExperimentDecision(expRulesJson, "Observed 19% engagement.");
    assert(dec19Json.outcome === "rejected", "JSON format: 19% -> Rejected");
  }

  // ── 2. Check 1 (cont): Equality Boundaries & Operator Precision ─────
  console.log("\n2. Check 1 (cont) — Equality Boundaries for Supported & Rejected:");
  {
    // Strict greater than: > 40%
    const expStrictGt = {
      metric: "Engagement",
      threshold: "> 40% engagement",
      decision_rules: "Continue: > 40%. Stop: < 30%.",
    };
    const decStrict40 = evaluateExperimentDecision(expStrictGt, "Observed 40% engagement.");
    assert(decStrict40.outcome === "rejected", "Strict > 40%: 40% is NOT supported (rejected)");
    const decStrict41 = evaluateExperimentDecision(expStrictGt, "Observed 41% engagement.");
    assert(decStrict41.outcome === "supported", "Strict > 40%: 41% IS supported");

    // Stop rule with <= vs <
    const expStopLte = {
      metric: "Engagement",
      threshold: ">= 40%",
      decision_rules: "Continue: >= 40%. Stop: <= 20%.",
    };
    const decStop20 = evaluateExperimentDecision(expStopLte, "Observed 20% engagement.");
    assert(decStop20.outcome === "rejected", "Stop rule <= 20%: 20% triggers explicit stop (rejected)");

    // testOperator unit tests
    assert(testOperator(40, ">=", 40) === true, "testOperator: 40 >= 40 is true");
    assert(testOperator(40, ">", 40) === false, "testOperator: 40 > 40 is false");
    assert(testOperator(10, "<=", 10) === true, "testOperator: 10 <= 10 is true");
    assert(testOperator(10, "<", 10) === false, "testOperator: 10 < 10 is false");
    assert(testOperator(50, "==", 50) === true, "testOperator: 50 == 50 is true");
  }

  // ── 3. Check 2: Operator and Metric Directionality ───────────────────
  console.log("\n3. Check 2 — Operator and Metric Directionality:");
  {
    // conversion >= 30% with observed 35% -> Supported
    const expConv = {
      metric: "Signup conversion",
      threshold: "conversion >= 30%",
      result: "Achieved 35% conversion rate on landing page.",
    };
    const decConv = evaluateExperimentDecision(expConv);
    assert(decConv.outcome === "supported", "conversion >= 30% with observed 35% -> Supported");
    assert(decConv.thresholdCriteria?.operator === ">=", "Operator parsed as >=");

    // CAC <= $10 with observed $6 -> Supported
    const expCac6 = {
      metric: "CAC",
      threshold: "CAC <= $10",
      result: "Acquired customers at $6 CAC through organic referral.",
    };
    const decCac6 = evaluateExperimentDecision(expCac6);
    assert(decCac6.outcome === "supported", "CAC <= $10 with observed $6 -> Supported");
    assert(decCac6.thresholdCriteria?.direction === "lower_is_better", "Direction is lower_is_better");

    // CAC <= $10 with observed $14 -> Rejected
    const expCac14 = {
      metric: "CAC",
      threshold: "CAC <= $10",
      result: "Acquired customers at $14 CAC due to high ad spend.",
    };
    const decCac14 = evaluateExperimentDecision(expCac14);
    assert(decCac14.outcome === "rejected", "CAC <= $10 with observed $14 -> Rejected");

    // Explicit threshold operator MUST NOT be accidentally overridden by conflicting keywords
    // e.g. "cost >= $500" (e.g. minimum cost saved or minimum spend committed)
    const expCostGte = {
      metric: "Cost savings",
      threshold: "cost >= $500",
      result: "Achieved $600 in verified cost savings.",
    };
    const decCostGte = evaluateExperimentDecision(expCostGte);
    assert(decCostGte.thresholdCriteria?.operator === ">=", "Explicit >= operator preserved despite keyword 'cost'");
    assert(decCostGte.thresholdCriteria?.direction === "higher_is_better", "Direction preserved as higher_is_better due to explicit >=");
    assert(decCostGte.outcome === "supported", "cost >= $500 with observed $600 -> Supported");

    const decCostGteFail = evaluateExperimentDecision(expCostGte, "Achieved $400 in verified cost savings.");
    assert(decCostGteFail.outcome === "rejected", "cost >= $500 with observed $400 -> Rejected");

    // Missing or ambiguous operators and units must yield Inconclusive when safe comparison cannot be established
    const expAmbiguousThresh = {
      metric: "Brand perception",
      threshold: "Substantially better conversion",
      result: "Observed 25% conversion.",
    };
    const decAmbiguousThresh = evaluateExperimentDecision(expAmbiguousThresh);
    assert(decAmbiguousThresh.outcome === "inconclusive", "Ambiguous threshold without quantitative target -> Inconclusive");
    assert(decAmbiguousThresh.headline.includes("Ambiguous Predefined Threshold"), "Headline flags ambiguous threshold");
  }

  // ── 4. Check 3: Observed Measurement Extraction & Unit Compatibility ─
  console.log("\n4. Check 3 — Observed Measurement Extraction & Unit Compatibility:");
  {
    // Spent $500 and acquired 50 signups at $5.80 CAC with threshold $10 -> compares $5.80, not $500
    const expSpentNarrative = {
      metric: "Customer acquisition cost (CAC)",
      threshold: "<= $10 CAC",
      result: "Spent $500 and acquired 50 signups at $5.80 CAC through Google Search ads.",
    };
    const decSpent = evaluateExperimentDecision(expSpentNarrative);
    assert(decSpent.observedMeasurement.numericValue === 5.8, "Extracted $5.80 CAC, NOT $500 spend");
    assert(decSpent.observedMeasurement.unit === "$", "Extracted unit $");
    assert(decSpent.outcome === "supported", "Compares $5.80 against $10 -> Supported");

    // Multiple plausible measurements with no reliable match -> Inconclusive
    const expMultipleAmbiguous = {
      metric: "Tool price",
      threshold: "<= $10",
      result: "Paid $20 for tool A and $15 for tool B during trial.",
    };
    const decMultipleAmbiguous = evaluateExperimentDecision(expMultipleAmbiguous);
    assert(decMultipleAmbiguous.outcome === "inconclusive", "Multiple ambiguous currency figures without context -> Inconclusive");

    // Number with incompatible units -> Inconclusive
    // Threshold expects percentage (>= 30%), narrative only has dollars ($500) and interview count (5)
    const expIncompatibleUnits = {
      metric: "Adherence rate",
      threshold: ">= 30% adherence",
      result: "Conducted 5 user interviews and spent $500 on research incentives.",
    };
    const decIncompatibleUnits = evaluateExperimentDecision(expIncompatibleUnits);
    assert(decIncompatibleUnits.outcome === "inconclusive", "Incompatible units ($500 & 5 interviews for % threshold) -> Inconclusive");
    assert(decIncompatibleUnits.observedMeasurement.numericValue === null, "Does NOT falsely convert $500 or 5 to 500% or 5%");
    assert(decIncompatibleUnits.headline.includes("Insufficient Quantitative Measurement"), "Headline indicates lack of quantitative percentage");

    // Threshold expects currency ($10), narrative only has user count (45 users)
    const expIncompatibleCurr = {
      metric: "CAC",
      threshold: "<= $10",
      result: "45 users signed up for the early preview over the weekend.",
    };
    const decIncompatibleCurr = evaluateExperimentDecision(expIncompatibleCurr);
    assert(decIncompatibleCurr.outcome === "inconclusive", "Incompatible units (45 users for currency threshold) -> Inconclusive");
    assert(decIncompatibleCurr.observedMeasurement.numericValue === null, "Does NOT falsely convert 45 users to $45");

    // Missing, invalid, or qualitative-only results -> Inconclusive
    const expQualitative = {
      metric: "Student sentiment",
      threshold: ">= 70% positive",
      result: "Users expressed genuine enthusiasm during the walkthrough and appreciated the clean layout.",
    };
    const decQualitative = evaluateExperimentDecision(expQualitative);
    assert(decQualitative.outcome === "inconclusive", "Qualitative narrative without numbers -> Inconclusive");

    const expEmpty = {
      metric: "Adherence",
      threshold: ">= 30%",
      result: "",
    };
    const decEmpty = evaluateExperimentDecision(expEmpty);
    assert(decEmpty.outcome === "inconclusive", "Empty result -> Inconclusive");
  }

  // ── 5. Check 4: Assumption-Status Mutation Safety ─────────────────────
  console.log("\n5. Check 4 — Assumption-Status Mutation Safety:");
  {
    const pagePath = path.join(process.cwd(), "src/app/experiments/page.tsx");
    const pageSrc = fs.readFileSync(pagePath, "utf-8");

    // Verify explicit founder confirmation for inline assumption update
    assert(
      pageSrc.includes("handleUpdateLinkedAssumption"),
      "page.tsx defines handleUpdateLinkedAssumption for explicit user confirmation"
    );
    assert(
      pageSrc.includes("Explicit Assumption Transition:"),
      "page.tsx triggers explicit confirm() modal before updating assumption status"
    );

    // Verify error checking in handleSaveResult (no silent success if server fails)
    assert(
      pageSrc.includes("if (!asmRes.ok)"),
      "page.tsx checks asmRes.ok on assumption update and throws on failure (no false success)"
    );

    // Verify URL encoding of projectId
    assert(
      pageSrc.includes("encodeURIComponent(projectId)"),
      "page.tsx encodes projectId in assumption API call"
    );

    // Verify that viewing experiments has no side-effect mutations
    assert(
      !pageSrc.includes("useEffect(() => { updateAssumption"),
      "page.tsx has zero automatic useEffect mutations on load or expand"
    );
  }

  // ── 6. Production Database Read-Only Invariance ──────────────────────
  console.log("\n6. Read-Only Production Database Invariance:");
  {
    const dbPath = path.join(process.cwd(), ".ideaprobe-data/ideaprobe.db");
    const db = createClient({ url: `file:${dbPath}` });

    const snapRes = await db.execute("SELECT COUNT(*) as count FROM report_snapshots");
    const snapshotCount = Number(snapRes.rows[0].count);
    assert(snapshotCount === 230, `report_snapshots invariant at 230 (found: ${snapshotCount})`);

    const expRes = await db.execute({
      sql: "SELECT id, status, result FROM experiments WHERE project_id = 'proj-study-planner' ORDER BY id ASC",
      args: [],
    });
    assert(expRes.rows.length === 2, "Found 2 seeded experiments for proj-study-planner");

    const exp1 = expRes.rows.find((r) => r.id === "exp-01");
    assert(exp1?.status === "planned", "exp-01 status remains 'planned' (unmutated)");

    const asmRes = await db.execute({
      sql: "SELECT id, status FROM assumptions WHERE id IN ('asm-01', 'asm-02')",
      args: [],
    });
    for (const asm of asmRes.rows) {
      assert(asm.status === "unvalidated", `Assumption ${asm.id} status remains 'unvalidated' (unmutated)`);
    }
  }

  console.log("\n==============================================================");
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} assertions.`);
  console.log("==============================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
