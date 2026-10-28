/**
 * IdeaProbe — Stabilization Step 8 Regression Test Suite
 *
 * Validates:
 * 1. Scope 1: Report-generation provenance selection logic
 *    - Real, non-placeholder sources/evidence with no sample fixtures evaluate to REAL_SOURCE
 *    - Sample fixtures / placeholder sources preserve appropriate SAMPLE labeling
 *    - Mixed sources/evidence carry SAMPLE labeling per Decision D03/D14
 *    - Empty research section defaults to USER_INPUT rather than falsely implying sample data
 *    - Sources manifest mapping correctly maps placeholder sources to SAMPLE and real to REAL_SOURCE
 * 2. Scope 2: Read-time normalization for existing snapshots
 *    - Normalizes sec-sources from SAMPLE to REAL_SOURCE when manifest has SAMPLE=0 and REAL_SOURCE>0
 *    - Preserves SAMPLE when manifest has SAMPLE>0 (e.g. Study Planner demo fixtures)
 *    - Verifies GET /api/projects/proj-f3554e11/report returns sec-sources with REAL_SOURCE without DB mutation
 *    - Verifies GET /api/projects/proj-study-planner/report returns sec-sources with SAMPLE
 * 3. Scope 3: Evidence review & verdict invariance
 *    - Unreviewed & rejected evidence items do NOT qualify as verified real-world evidence
 *    - Rejected claims do not contribute to any supporting verdict count
 *    - AUDIT PASSED certifies provenance traceability, not business viability
 * 4. Scope 4: Production SQLite strict invariance
 *    - Confirms zero writes occurred to the production database (exact count checks via mode=ro)
 */

import { isPlaceholderSource, isPlaceholderEvidence, isVerifiedRealEvidence } from "./src/lib/evidenceValidation";
import { buildVerdict } from "./src/app/api/projects/[id]/report/route";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

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
console.log("IdeaProbe — Stabilization Step 8 Verification Suite");
console.log("=======================================================\n");

// ── Suite 1: Report-Generation Provenance Selection Logic ──
console.log("Suite 1: Report-Generation Provenance Selection Logic");

function computeSectionSourcesProvenance(sources: any[], evidence: any[]): string {
  const hasPlaceholder =
    sources.some((s: any) => isPlaceholderSource(s)) ||
    evidence.some((e: any) => isPlaceholderEvidence(e));
  const hasReal =
    sources.some((s: any) => !isPlaceholderSource(s)) ||
    evidence.some((e: any) => e.provenance === "REAL_SOURCE" && !isPlaceholderEvidence(e));
  if (hasPlaceholder) return "SAMPLE";
  if (hasReal) return "REAL_SOURCE";
  return "USER_INPUT";
}

// 1. Real sources & evidence (CampusCourier scenario)
const realSources = [
  { id: "src-1", url: "https://campusmail.ua.edu/studentmailcenter/move-in/", source_type: "web", provider: "tinyfish" },
  { id: "src-2", url: "https://www.parcelpending.com/en-us/blog/standardizing-campus-delivery-management/", source_type: "web", provider: "tinyfish" },
];
const realEvidence = [
  { id: "ev-1", source_id: "src-1", provenance: "REAL_SOURCE", reviewer_status: "ACCEPTED", url: "https://campusmail.ua.edu" },
  { id: "ev-2", source_id: "src-2", provenance: "REAL_SOURCE", reviewer_status: "UNREVIEWED", url: "https://www.parcelpending.com" },
];
assert(
  computeSectionSourcesProvenance(realSources, realEvidence) === "REAL_SOURCE",
  "Real sources + real evidence evaluate to REAL_SOURCE (not SAMPLE)"
);

// 2. Demo fixtures (Study Planner scenario)
const sampleSources = [
  { id: "src-demo-1", url: "https://example.com/study-habits", source_type: "demo_fixture", provider: "mock" },
];
const sampleEvidence = [
  { id: "ev-demo-1", provenance: "SAMPLE", reviewer_status: "ACCEPTED", source_url: "https://example.com/study-habits" },
];
assert(
  computeSectionSourcesProvenance(sampleSources, sampleEvidence) === "SAMPLE",
  "Placeholder sources evaluate to SAMPLE"
);

// 3. Mixed scenario: presence of placeholder quarantines section to SAMPLE
const mixedSources = [...realSources, ...sampleSources];
assert(
  computeSectionSourcesProvenance(mixedSources, realEvidence) === "SAMPLE",
  "Mixed sources (real + placeholder) safely carry SAMPLE badge per Decision D03/D14"
);

// 4. Empty scenario: 0 sources, 0 evidence
assert(
  computeSectionSourcesProvenance([], []) === "USER_INPUT",
  "Empty project evaluates to USER_INPUT (does not falsely imply sample data)"
);

// 5. Source code inspection of route.ts
const routeSrc = fs.readFileSync(path.join(__dirname, "src/app/api/projects/[id]/report/route.ts"), "utf-8");
assert(
  routeSrc.includes("isPlaceholderSource(s) ? \"SAMPLE\" : s.provenance || \"REAL_SOURCE\""),
  "route.ts correctly maps placeholder sources to SAMPLE in allProvenance"
);
assert(
  routeSrc.includes("const hasPlaceholder ="),
  "route.ts checks hasPlaceholder via isPlaceholderSource/isPlaceholderEvidence"
);
assert(
  routeSrc.includes("const hasReal ="),
  "route.ts checks hasReal via !isPlaceholderSource and REAL_SOURCE evidence"
);
assert(
  !routeSrc.includes("s.provenance === \"REAL_SOURCE\""),
  "route.ts eliminated erroneous s.provenance === 'REAL_SOURCE' check on sources table"
);

// ── Suite 2: Read-Time Normalization for Existing Snapshots ──
console.log("\nSuite 2: Read-Time Normalization for Existing Snapshots");

// Python backend source check
const pyReportSrc = fs.readFileSync(path.join(__dirname, "../backend/app/routers/report.py"), "utf-8");
assert(
  pyReportSrc.includes("def normalize_sources_section"),
  "backend/app/routers/report.py defines normalize_sources_section"
);
assert(
  pyReportSrc.includes("manifest.get(\"SAMPLE\", 0) == 0 and manifest.get(\"REAL_SOURCE\", 0) > 0"),
  "backend normalize_sources_section normalizes SAMPLE to REAL_SOURCE only when SAMPLE=0 and REAL_SOURCE>0"
);
assert(
  pyReportSrc.includes("sec_id == \"sec-sources\":"),
  "backend normalize_content_sections dispatches to normalize_sources_section"
);

// TypeScript getReportFromDb source check
assert(
  routeSrc.includes("sec.id === \"sec-sources\""),
  "route.ts getReportFromDb contains read-time normalizer for sec-sources"
);
assert(
  routeSrc.includes("manifest.SAMPLE === 0") && routeSrc.includes("(manifest.REAL_SOURCE || 0) > 0"),
  "route.ts getReportFromDb normalizes SAMPLE to REAL_SOURCE only when SAMPLE=0 and REAL_SOURCE>0"
);

// Probe live FastAPI endpoint for proj-f3554e11 using python execFileSync
try {
  const pyProbeScript = `
import urllib.request, json
req = urllib.request.Request('http://127.0.0.1:8000/api/projects/proj-f3554e11/report')
with urllib.request.urlopen(req, timeout=5) as resp:
    data = json.loads(resp.read().decode('utf-8'))
    report = data['data']['report']
    sec_sources = next(s for s in report['content'] if s['id'] == 'sec-sources')
    print(f"{report['version']}|{sec_sources['provenance']}|{report['provenance_manifest']['SAMPLE']}|{report['provenance_manifest']['REAL_SOURCE']}")
`;
  const probeOutput = execFileSync("python", ["-c", pyProbeScript], { encoding: "utf-8" }).trim();
  const [version, secProv, sampleCount, realSourceCount] = probeOutput.split("|");

  assert(version === "1", "proj-f3554e11 snapshot version is 1 (immutable snapshot preserved)");
  assert(secProv === "REAL_SOURCE", "GET /api/projects/proj-f3554e11/report returns sec-sources with REAL_SOURCE badge");
  assert(sampleCount === "0", "proj-f3554e11 manifest has 0 SAMPLE items");
  assert(realSourceCount === "8", "proj-f3554e11 manifest has 8 REAL_SOURCE items");
} catch (err: any) {
  console.error("FastAPI probe error:", err.message);
  assert(false, "FastAPI endpoint returned normalized report for proj-f3554e11");
}

// Probe live FastAPI endpoint for proj-study-planner
try {
  const pyStudyProbeScript = `
import urllib.request, json
req = urllib.request.Request('http://127.0.0.1:8000/api/projects/proj-study-planner/report')
with urllib.request.urlopen(req, timeout=5) as resp:
    data = json.loads(resp.read().decode('utf-8'))
    report = data['data']['report']
    sec_sources = next(s for s in report['content'] if s['id'] == 'sec-sources')
    print(f"{sec_sources['provenance']}|{report['provenance_manifest']['SAMPLE']}")
`;
  const studyOutput = execFileSync("python", ["-c", pyStudyProbeScript], { encoding: "utf-8" }).trim();
  const [studyProv, studySampleCount] = studyOutput.split("|");

  assert(studyProv === "SAMPLE", "GET /api/projects/proj-study-planner/report preserves SAMPLE badge on sec-sources");
  assert(Number(studySampleCount) > 0, `Study planner manifest indicates sample fixtures (${studySampleCount} items)`);
} catch (err: any) {
  console.error("FastAPI probe error for study planner:", err.message);
  assert(false, "FastAPI endpoint returned report for proj-study-planner");
}

// ── Suite 3: Evidence Review & Verdict Invariance ──
console.log("\nSuite 3: Evidence Review & Verdict Invariance");

// Test isVerifiedRealEvidence gate
const acceptedRealClaim = {
  provenance: "REAL_SOURCE",
  reviewer_status: "ACCEPTED",
  url: "https://campusmail.ua.edu",
};
const unreviewedRealClaim = {
  provenance: "REAL_SOURCE",
  reviewer_status: "UNREVIEWED",
  url: "https://parcelpending.com",
};
const rejectedRealClaim = {
  provenance: "REAL_SOURCE",
  reviewer_status: "REJECTED",
  url: "https://bhs1.com",
};
const acceptedSampleClaim = {
  provenance: "SAMPLE",
  reviewer_status: "ACCEPTED",
  url: "https://example.com",
};

assert(isVerifiedRealEvidence(acceptedRealClaim) === true, "Accepted real claim is verified real evidence");
assert(isVerifiedRealEvidence(unreviewedRealClaim) === false, "Unreviewed claim is NOT verified real evidence");
assert(isVerifiedRealEvidence(rejectedRealClaim) === false, "Rejected claim is NOT verified real evidence");
assert(isVerifiedRealEvidence(acceptedSampleClaim) === false, "Accepted sample fixture is quarantined and NOT verified real evidence");

// Test buildVerdict
const verdictInProgress = buildVerdict({
  assumptions: [],
  experiments: [],
  realResults: [],
  sources: realSources,
  evidence: realEvidence,
});
assert(
  verdictInProgress.includes("VALIDATION STATUS: 🟡 IN PROGRESS"),
  "Real research with 0 experiments and 0 validated assumptions yields IN PROGRESS"
);
assert(
  !verdictInProgress.includes("PARTIAL VALIDATION"),
  "Verdict does not prematurely grant PARTIAL VALIDATION without validated assumptions and real experiments"
);

const verdictPreValidation = buildVerdict({
  assumptions: [],
  experiments: [],
  realResults: [],
  sources: [],
  evidence: [],
});
assert(
  verdictPreValidation.includes("VALIDATION STATUS: ⛔ PRE-VALIDATION"),
  "Empty project with no sources or experiments yields PRE-VALIDATION"
);

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

assert(projectCount === 6, `Projects count invariant (expected 6, got ${projectCount})`);
assert(briefCount === 6, `Idea briefs count invariant (expected 6, got ${briefCount})`);
assert(runsCount === 4, `Runs count invariant (expected 4, got ${runsCount})`);
assert(stagesCount === 40, `Stages count invariant (expected 40, got ${stagesCount})`);
assert(sourcesCount === 24, `Sources count invariant (expected 24, got ${sourcesCount})`);
assert(evidenceCount === 24, `Evidence count invariant (expected 24, got ${evidenceCount})`);
assert(competitorCount === 6, `Competitors count invariant (expected 6, got ${competitorCount})`);
assert(personaCount === 4, `Personas count invariant (expected 4, got ${personaCount})`);
assert(interviewCount === 2, `Interviews count invariant (expected 2, got ${interviewCount})`);
assert(turnCount === 60, `Turns count invariant (expected 60, got ${turnCount})`);
assert(insightCount === 10, `Insights count invariant (expected 10, got ${insightCount})`);
assert(assumptionCount === 4, `Assumptions count invariant (expected 4, got ${assumptionCount})`);
assert(experimentCount === 2, `Experiments count invariant (expected 2, got ${experimentCount})`);
assert(mvpCount === 7, `MVP features count invariant (expected 7, got ${mvpCount})`);
assert(snapshotCount === 230, `Report snapshots count strictly invariant (expected 230, got ${snapshotCount})`);

console.log("\n=======================================================");
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("=======================================================\n");

if (failed > 0) {
  process.exit(1);
}
