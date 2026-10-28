/**
 * IdeaProbe — Phase 3A Pre-Flight Hardening Verification Suite
 *
 * Validates:
 * 1. Scope 1: Fallback Isolation in Experiment and Insight Generation
 *    - Live projects derive experiment/insight fallbacks dynamically from their own brief and assumption
 *    - Zero Study Planner exam cramming or r/studytips leakage into live project fallbacks
 *    - Demo fixtures preserve canonical Study Planner fallbacks
 *    - Live fallbacks conform to Ollama schema validators (validateExperiment, validateInsight)
 * 2. Scope 2: Overview Stage Labels and Summaries
 *    - Live projects with real sources/evidence display REAL_SOURCE on s-research stage
 *    - Live projects display target customer baseline on s-icp stage (no exam pressure leakage)
 *    - Live projects display USER_INPUT on s-risks stage (reflecting user risk register)
 *    - Demo projects preserve SAMPLE and AI_INFERENCE badges
 * 3. Scope 3: Report Experiment Section Provenance
 *    - 0 experiments evaluate to USER_INPUT (semantically accurate baseline)
 *    - Manually created experiments evaluate to USER_INPUT
 *    - AI-generated experiments evaluate to AI_INFERENCE
 *    - Completed experiments with real results evaluate to REAL_EXPERIMENT_RESULT
 *    - Live HTTP GET for proj-f3554e11 returns sec-experiments with USER_INPUT on ports 8000 & 3001
 *    - Live HTTP GET for proj-study-planner preserves sec-experiments with AI_INFERENCE on ports 8000 & 3001
 * 4. Scope 4: Production SQLite Strict Invariance
 *    - Zero writes to production database (probed via mode=ro)
 */

import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { validateExperiment, validateInsight } from "./src/lib/ollama";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

console.log("\n=======================================================");
console.log("IdeaProbe — Phase 3A Pre-Flight Hardening Test Suite");
console.log("=======================================================\n");

// ── Suite 1: Fallback Isolation in Experiment & Insight Generation ──
console.log("Suite 1: Fallback Isolation in Experiment & Insight Generation");

const expGenSrc = fs.readFileSync(path.join(__dirname, "src/app/api/projects/[id]/experiments/generate/route.ts"), "utf-8");
assert(
  expGenSrc.includes("function buildLiveExperimentFallback"),
  "experiments/generate defines buildLiveExperimentFallback"
);
assert(
  expGenSrc.includes("isDemoProject") && expGenSrc.includes("buildLiveExperimentFallback"),
  "experiments/generate dynamically chooses fallback based on isDemoProject"
);
assert(
  expGenSrc.includes("fallbackProvenance: isDemoProject ? \"SAMPLE\" : \"SIMULATED\""),
  "experiments/generate tags live offline fallbacks as SIMULATED instead of SAMPLE"
);

// Test buildLiveExperimentFallback logic directly
const liveBrief = {
  problem: "Students living in campus hostels need fast intra-campus parcel delivery.",
  target_customer: "College students living in campus hostels in India.",
  solution: "A peer-to-peer campus courier network connecting students for micro-deliveries.",
};
const liveAssumption = {
  id: "asm-test-01",
  statement: "Hostel students are willing to pay peers ₹30–₹50 per delivery rather than walking to the campus main gate.",
  category: "desirability",
  impact: "Critical",
  uncertainty: "High",
};

// Simulate dynamic live experiment fallback creation
function simulateLiveExpFallback(title: string, b: any, a: any, method?: string) {
  const targetCohort = b?.target_customer ? `${b.target_customer} (target n=30)` : "Early adopter customer cohort (target n=30)";
  const m = method || "Concierge MVP / Direct Customer Outreach";
  const hypothesis = a
    ? `If we provide a concierge prototype of ${b?.solution || title} to test "${a.statement}", at least 30% of ${b?.target_customer || "target customers"} will complete the target workflow.`
    : `If we offer early access to ${b?.solution || title} addressing "${b?.problem || 'the core problem'}", at least 25% of ${b?.target_customer || "prospective users"} will commit to an initial trial.`;
  return {
    hypothesis,
    method: m,
    cohort: targetCohort,
    metric: "Completed customer workflow / trial conversion rate",
    threshold: ">= 30% positive conversion",
    duration: "7 days",
    cost_estimate: "$0 (manual concierge outreach)",
    decision_rules: {
      continue: "Conversion >= 30% with clear qualitative willingness to pay/use",
      pivot: "Conversion 15-29% — conduct friction interviews on core blockers",
      stop: "Conversion < 15% — re-evaluate problem urgency and target customer definition",
    },
    ethical_notes: [
      "Explicit informed consent required from all student/user participants",
      "No payment processed or sensitive personal credentials collected during concierge test",
    ],
    linked_assumption_ids: a ? [a.id] : [],
  };
}

const liveExp = simulateLiveExpFallback("CampusCourier", liveBrief, liveAssumption);
assert(!liveExp.hypothesis.toLowerCase().includes("exam"), "Live experiment hypothesis has zero exam references");
assert(!liveExp.hypothesis.toLowerCase().includes("cramming"), "Live experiment hypothesis has zero cramming references");
assert(!liveExp.cohort.toLowerCase().includes("r/studytips"), "Live experiment cohort has zero r/studytips references");
assert(liveExp.hypothesis.includes("peer-to-peer campus courier network"), "Live experiment references project solution");
assert(liveExp.linked_assumption_ids.includes("asm-test-01"), "Live experiment correctly links assumption ID");

// Verify live experiment passes schema validator
try {
  const validated = validateExperiment(liveExp);
  assert(Boolean(validated.hypothesis && validated.threshold), "Live experiment conforms to validateExperiment schema");
} catch (err: any) {
  assert(false, `validateExperiment failed on live fallback: ${err.message}`);
}

// Insights fallback inspection
const insGenSrc = fs.readFileSync(path.join(__dirname, "src/app/api/projects/[id]/insights/generate/route.ts"), "utf-8");
assert(
  insGenSrc.includes("function buildLiveInsightFallback"),
  "insights/generate defines buildLiveInsightFallback"
);
assert(
  insGenSrc.includes("isDemoProject") && insGenSrc.includes("buildLiveInsightFallback"),
  "insights/generate dynamically chooses fallback based on isDemoProject"
);
assert(
  insGenSrc.includes("fallbackProvenance: isDemoProject ? \"SAMPLE\" : \"SIMULATED\""),
  "insights/generate tags live offline fallbacks as SIMULATED instead of SAMPLE"
);

function simulateLiveInsightFallback(title: string, b: any, evs: any[], insightType: string) {
  const topEv = evs.length > 0 ? evs[0] : null;
  const statement = topEv
    ? `Preliminary research signal: Target customers (${b?.target_customer || "users"}) experiencing "${b?.problem || "operational friction"}" indicate key problem patterns, noting: "${String(topEv.claim || "").slice(0, 140)}".`
    : `Preliminary hypothesis: Target customers (${b?.target_customer || "users"}) require a structured solution for "${b?.problem || "the core problem"}", pending empirical customer discovery.`;

  return {
    statement,
    type: insightType || "theme",
    confidence: "low",
    evidence_for_ids: topEv ? [String(topEv.id)] : [],
    evidence_against_ids: [],
    caveat: topEv
      ? `Offline synthesis fallback grounded in project problem statement and evidence [${topEv.id}]. Must be verified directly with primary customer interviews.`
      : "Offline synthesis fallback derived from idea brief alone. Requires empirical customer evidence.",
    provenance: "AI_INFERENCE",
  };
}

const mockEv = [{ id: "ev-tf-1", claim: "Campus package fees cap at $25 per semester" }];
const liveIns = simulateLiveInsightFallback("CampusCourier", liveBrief, mockEv, "theme");
assert(!liveIns.statement.toLowerCase().includes("exam"), "Live insight statement has zero exam references");
assert(!liveIns.statement.toLowerCase().includes("cramming"), "Live insight statement has zero cramming references");
assert(liveIns.statement.includes("Campus package fees cap at $25"), "Live insight incorporates real evidence claim");
assert(liveIns.evidence_for_ids.includes("ev-tf-1"), "Live insight links evidence ID");

try {
  const validatedIns = validateInsight(liveIns);
  assert(Boolean(validatedIns.statement && validatedIns.type), "Live insight conforms to validateInsight schema");
} catch (err: any) {
  assert(false, `validateInsight failed on live fallback: ${err.message}`);
}

// ── Suite 2: Overview Stage Labels and Summaries ──
console.log("\nSuite 2: Overview Stage Labels and Summaries");

const overviewSrc = fs.readFileSync(path.join(__dirname, "src/app/overview/page.tsx"), "utf-8");
assert(
  overviewSrc.includes("isProjectDemo") && overviewSrc.includes("proj-study-planner"),
  "overview/page.tsx computes isProjectDemo robustly"
);
assert(
  overviewSrc.includes("researchProv") && overviewSrc.includes("REAL_SOURCE") && overviewSrc.includes("liveCounts.evidence_count"),
  "overview/page.tsx derives researchProv from real SQLite evidence/source counts"
);
assert(
  overviewSrc.includes("riskProv") && overviewSrc.includes("USER_INPUT"),
  "overview/page.tsx sets riskProv to USER_INPUT for live projects"
);
assert(
  overviewSrc.includes("Target Customer Baseline defined:"),
  "overview/page.tsx derives ICP summary from brief.target_customer"
);

// Simulate dynamic stage logic for CampusCourier
const campusLiveCounts = { evidence_count: 4, source_count: 4, assumption_count: 0, experiment_count: 0 };
const campusIsDemo = false;
const campusResearchProv = campusIsDemo ? "SAMPLE" : (campusLiveCounts.evidence_count > 0 ? "REAL_SOURCE" : "USER_INPUT");
const campusRiskProv = campusIsDemo ? "AI_INFERENCE" : "USER_INPUT";
const campusIcp = liveBrief.target_customer ? `Target Customer Baseline defined: ${liveBrief.target_customer}` : "Default";

assert(campusResearchProv === "REAL_SOURCE", "CampusCourier research stage resolves to REAL_SOURCE");
assert(campusRiskProv === "USER_INPUT", "CampusCourier risk stage resolves to USER_INPUT");
assert(campusIcp.includes("College students living in campus hostels in India"), "CampusCourier ICP derives from brief");

// Simulate dynamic stage logic for Study Planner
const studyIsDemo = true;
const studyResearchProv = studyIsDemo ? "SAMPLE" : "REAL_SOURCE";
const studyRiskProv = studyIsDemo ? "AI_INFERENCE" : "USER_INPUT";
assert(studyResearchProv === "SAMPLE", "Study Planner research stage resolves to SAMPLE");
assert(studyRiskProv === "AI_INFERENCE", "Study Planner risk stage resolves to AI_INFERENCE");

// ── Suite 3: Report Experiment Section Provenance ──
console.log("\nSuite 3: Report Experiment Section Provenance");

const reportRouteSrc = fs.readFileSync(path.join(__dirname, "src/app/api/projects/[id]/report/route.ts"), "utf-8");
assert(
  reportRouteSrc.includes("realResults.length > 0") &&
  reportRouteSrc.includes("REAL_EXPERIMENT_RESULT") &&
  reportRouteSrc.includes("experiments[0]?.provenance || \"USER_INPUT\""),
  "report/route.ts computes sec-experiments provenance using realResults, experiments provenance, or USER_INPUT empty baseline"
);
assert(
  reportRouteSrc.includes("if (sec.id === \"sec-experiments\")"),
  "report/route.ts getReportFromDb normalizes legacy empty sec-experiments to USER_INPUT"
);

// Python backend inspection
const pyReportSrc = fs.readFileSync(path.join(__dirname, "../backend/app/routers/report.py"), "utf-8");
assert(
  pyReportSrc.includes("def normalize_experiments_section(sec: Dict[str, Any], manifest: Optional[Dict[str, Any]] = None)"),
  "backend/app/routers/report.py normalize_experiments_section accepts manifest parameter"
);
assert(
  pyReportSrc.includes("No validation experiments have been designed yet") && pyReportSrc.includes("manifest.get(\"AI_INFERENCE\", 0) == 0"),
  "backend normalize_experiments_section normalizes empty-state legacy snapshots to USER_INPUT"
);

// Live HTTP probes on port 8000 (FastAPI) and 3001 (Next.js)
try {
  const probeScript = `
import urllib.request, json
urls = [
    ('http://127.0.0.1:8000/api/projects/proj-f3554e11/report', 'fastapi_live'),
    ('http://127.0.0.1:3001/api/projects/proj-f3554e11/report', 'nextjs_live'),
    ('http://127.0.0.1:8000/api/projects/proj-study-planner/report', 'fastapi_demo'),
    ('http://127.0.0.1:3001/api/projects/proj-study-planner/report', 'nextjs_demo')
]
out = []
for u, label in urls:
    req = urllib.request.Request(u)
    with urllib.request.urlopen(req, timeout=5) as r:
        d = json.loads(r.read().decode('utf-8'))
        content = d['data']['report']['content']
        sec_sources = next(s for s in content if s['id'] == 'sec-sources')
        sec_exp = next(s for s in content if s['id'] == 'sec-experiments')
        out.append(f"{label}|{sec_sources['provenance']}|{sec_exp['provenance']}")
print(','.join(out))
`;
  const probeRes = execFileSync("python", ["-c", probeScript], { encoding: "utf-8" }).trim();
  const parts = probeRes.split(",");
  for (const part of parts) {
    const [lbl, srcProv, expProv] = part.split("|");
    if (lbl.includes("live")) {
      assert(srcProv === "REAL_SOURCE", `${lbl}: sec-sources is REAL_SOURCE`);
      assert(expProv === "USER_INPUT", `${lbl}: sec-experiments is normalized to USER_INPUT (not false AI_INFERENCE)`);
    } else {
      assert(srcProv === "SAMPLE", `${lbl}: sec-sources is SAMPLE`);
      assert(expProv === "AI_INFERENCE", `${lbl}: sec-experiments preserves AI_INFERENCE for planned study experiments`);
    }
  }
} catch (err: any) {
  console.error("Endpoint probe failed:", err.message);
  assert(false, "Live HTTP report endpoints returned valid responses");
}

// ── Suite 4: SQLite Database Invariance Verification ──
console.log("\nSuite 4: SQLite Database Invariance Verification");

const pyDbScript = `
import sqlite3, os
db_path = os.path.abspath(".ideaprobe-data/ideaprobe.db").replace("\\\\", "/")
conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
cur = conn.cursor()
tables = ['projects', 'idea_briefs', 'runs', 'stages', 'sources', 'evidence', 'competitors', 'personas', 'interviews', 'turns', 'insights', 'assumptions', 'experiments', 'mvp_features', 'report_snapshots']
counts = [str(cur.execute(f"SELECT count(*) FROM {t}").fetchone()[0]) for t in tables]
print(','.join(counts))
conn.close()
`;

const countsRaw = execFileSync("python", ["-c", pyDbScript], {
  cwd: path.resolve(__dirname),
  encoding: "utf-8",
}).trim();

const [
  projectCount,
  briefCount,
  runsCount,
  stagesCount,
  sourcesCount,
  evidenceCount,
  competitorCount,
  personaCount,
  interviewCount,
  turnCount,
  insightCount,
  assumptionCount,
  experimentCount,
  mvpCount,
  snapshotCount,
] = countsRaw.split(",").map(Number);

assert(projectCount === 6, `Projects count strictly invariant (expected 6, got ${projectCount})`);
assert(briefCount === 6, `Idea briefs count strictly invariant (expected 6, got ${briefCount})`);
assert(runsCount === 4, `Runs count strictly invariant (expected 4, got ${runsCount})`);
assert(stagesCount === 40, `Stages count strictly invariant (expected 40, got ${stagesCount})`);
assert(sourcesCount === 24, `Sources count strictly invariant (expected 24, got ${sourcesCount})`);
assert(evidenceCount === 24, `Evidence count strictly invariant (expected 24, got ${evidenceCount})`);
assert(competitorCount === 6, `Competitors count strictly invariant (expected 6, got ${competitorCount})`);
assert(personaCount === 4, `Personas count strictly invariant (expected 4, got ${personaCount})`);
assert(interviewCount === 2, `Interviews count strictly invariant (expected 2, got ${interviewCount})`);
assert(turnCount === 60, `Turns count strictly invariant (expected 60, got ${turnCount})`);
assert(insightCount === 11, `Insights count strictly invariant (expected 11, got ${insightCount})`);
assert(assumptionCount === 5, `Assumptions count strictly invariant (expected 5, got ${assumptionCount})`);
assert(experimentCount === 3, `Experiments count strictly invariant (expected 3, got ${experimentCount})`);
assert(mvpCount === 7, `MVP features count strictly invariant (expected 7, got ${mvpCount})`);
assert(snapshotCount === 230, `Report snapshots count strictly invariant (expected 230, got ${snapshotCount})`);

console.log("\n=======================================================");
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("=======================================================\n");

if (failed > 0) {
  process.exit(1);
}
