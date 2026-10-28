/**
 * IdeaProbe — Phase 3M: CSV / JSON Export Test Suite
 *
 * Verifies:
 * 1. Production database baseline pre-execution invariance check.
 * 2. Static code structure audit across exportUtils.ts, alternatives/page.tsx, and research/page.tsx.
 * 3. Isolated test database environment setup (zero mutation of production DB).
 * 4. Pure CSV escaping (RFC 4180), newlines, quotes, commas, and Unicode (UTF-8 BOM).
 * 5. Filename sanitization (filesystem-safe, spaces, invalid chars).
 * 6. Competitor Differentiation CSV Export (headers, rows, status, metrics, provenance).
 * 7. Competitor Differentiation JSON Export (valid JSON, metrics, disclaimer, items).
 * 8. Competitor Differentiation Empty Dataset Export (empty CSV, empty JSON metrics).
 * 9. Evidence Ledger CSV Export (schema fields, source attribution, provenance, missing values).
 * 10. Evidence Ledger JSON Export (metrics breakdown, verified real vs sample counts, explicit nulls).
 * 11. Evidence Ledger Empty Dataset Export (clean header-only CSV, 0-count JSON).
 * 12. Project Isolation & Anti-Leakage (LIVE project exports never leak demo items; zero secret leakage).
 * 13. Existing Markdown export and UI contracts remain functional.
 * 14. Production database baseline post-execution invariance check.
 */

import path from "path";
import fs from "fs";
import { createClient } from "@libsql/client";
import { initDb, getDb, resetDbClient } from "./src/lib/db";
import {
  escapeCsvCell,
  sanitizeFilename,
  generateCompetitorCsv,
  generateCompetitorJson,
  generateEvidenceCsv,
  generateEvidenceJson,
  COMPETITOR_CSV_HEADERS,
  EVIDENCE_CSV_HEADERS,
  CompetitorExportItem,
  EvidenceExportItem,
} from "./src/lib/exportUtils";
import {
  isDifferentiated,
  getDifferentiationMetrics,
  buildDifferentiationMarkdownTable,
} from "./src/lib/competitorValidation";

let totalAssertions = 0;
let passedAssertions = 0;
let failedAssertions = 0;

function assert(condition: boolean, message: string) {
  totalAssertions++;
  if (condition) {
    passedAssertions++;
    console.log(`  ✓ ${message}`);
  } else {
    failedAssertions++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

async function getTableCounts(dbPath: string): Promise<Record<string, number>> {
  const client = createClient({ url: `file:${dbPath.replace(/\\/g, "/")}` });
  const tables = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  const counts: Record<string, number> = {};
  for (const t of tables.rows) {
    const tableName = String(t.name);
    const row = await client.execute(`SELECT COUNT(*) as count FROM "${tableName}"`);
    counts[tableName] = Number(row.rows[0].count);
  }
  return counts;
}

async function runTests() {
  console.log("================================================================================");
  console.log("  IdeaProbe — Phase 3M: CSV / JSON Export Automated Test Suite");
  console.log("================================================================================\n");

  const prodDbPath = path.resolve(__dirname, ".ideaprobe-data/ideaprobe.db");
  const isolatedDbPath = path.resolve(__dirname, ".ideaprobe-data/test-phase3m-isolated.db");

  // ── SUITE 1: Production Database Pre-Execution Baseline Check ───────────────
  console.log("Suite 1: Production Database Pre-Execution Baseline Check");
  assert(fs.existsSync(prodDbPath), `Production database exists at ${prodDbPath}`);
  const preCounts = await getTableCounts(prodDbPath);
  assert(preCounts["report_snapshots"] === 230, `Production report snapshots baseline count is exactly 230 (got ${preCounts["report_snapshots"]})`);
  assert(preCounts["experiments"] === 3, `Production experiments baseline count is exactly 3 (got ${preCounts["experiments"]})`);
  assert(preCounts["assumptions"] === 5, `Production assumptions baseline count is exactly 5 (got ${preCounts["assumptions"]})`);
  assert(preCounts["competitors"] === 6, `Production competitors baseline count is exactly 6 (got ${preCounts["competitors"]})`);
  assert(preCounts["evidence"] === 24, `Production evidence baseline count is exactly 24 (got ${preCounts["evidence"]})`);
  console.log();

  // ── SUITE 2: Static Code Structure & Export Audit ───────────────────────────
  console.log("Suite 2: Static Code Structure & Export Audit");
  const exportUtilsPath = path.resolve(__dirname, "src/lib/exportUtils.ts");
  assert(fs.existsSync(exportUtilsPath), `exportUtils.ts exists at ${exportUtilsPath}`);
  const exportUtilsContent = fs.readFileSync(exportUtilsPath, "utf-8");
  assert(exportUtilsContent.includes("export function escapeCsvCell"), "exportUtils exports escapeCsvCell");
  assert(exportUtilsContent.includes("export function sanitizeFilename"), "exportUtils exports sanitizeFilename");
  assert(exportUtilsContent.includes("export function downloadFile"), "exportUtils exports downloadFile");
  assert(exportUtilsContent.includes("export function generateCompetitorCsv"), "exportUtils exports generateCompetitorCsv");
  assert(exportUtilsContent.includes("export function generateCompetitorJson"), "exportUtils exports generateCompetitorJson");
  assert(exportUtilsContent.includes("export function generateEvidenceCsv"), "exportUtils exports generateEvidenceCsv");
  assert(exportUtilsContent.includes("export function generateEvidenceJson"), "exportUtils exports generateEvidenceJson");

  // Alternatives Page audit
  const altPagePath = path.resolve(__dirname, "src/app/alternatives/page.tsx");
  const altPageContent = fs.readFileSync(altPagePath, "utf-8");
  assert(altPageContent.includes('id="export-competitors-csv-btn"'), "alternatives/page.tsx includes export-competitors-csv-btn");
  assert(altPageContent.includes('id="export-competitors-json-btn"'), "alternatives/page.tsx includes export-competitors-json-btn");
  assert(altPageContent.includes('id="copy-differentiation-matrix-btn"'), "alternatives/page.tsx preserves copy-differentiation-matrix-btn");

  // Research Page audit
  const researchPagePath = path.resolve(__dirname, "src/app/research/page.tsx");
  const researchPageContent = fs.readFileSync(researchPagePath, "utf-8");
  assert(researchPageContent.includes('id="export-evidence-csv-btn"'), "research/page.tsx includes export-evidence-csv-btn");
  assert(researchPageContent.includes('id="export-evidence-json-btn"'), "research/page.tsx includes export-evidence-json-btn");
  console.log();

  // ── SUITE 3: Isolated Test Database Setup ──────────────────────────────────
  console.log("Suite 3: Isolated Test Database Setup");
  if (fs.existsSync(isolatedDbPath)) fs.unlinkSync(isolatedDbPath);
  process.env.IDEAPROBE_DB_PATH = isolatedDbPath;
  resetDbClient();
  await initDb();
  assert(fs.existsSync(isolatedDbPath), `Isolated test DB initialized at ${isolatedDbPath}`);
  const db = getDb();
  console.log();

  // ── SUITE 4: Pure CSV Escaping (RFC 4180) & Unicode Handling ────────────────
  console.log("Suite 4: Pure CSV Escaping (RFC 4180) & Unicode Handling");
  assert(escapeCsvCell(null) === "", "escapeCsvCell(null) returns empty string");
  assert(escapeCsvCell(undefined) === "", "escapeCsvCell(undefined) returns empty string");
  assert(escapeCsvCell("") === "", "escapeCsvCell('') returns empty string");
  assert(escapeCsvCell("SimpleText") === "SimpleText", "Plain text does not require quotes");
  assert(escapeCsvCell("Hello, World") === '"Hello, World"', "Commas trigger RFC 4180 quote wrapping");
  assert(escapeCsvCell('He said "Yes"') === '"He said ""Yes"""', "Quotes trigger doubling and wrapping");
  assert(escapeCsvCell("Line 1\nLine 2") === '"Line 1\nLine 2"', "Newlines (\\n) trigger quote wrapping");
  assert(escapeCsvCell("Line 1\r\nLine 2") === '"Line 1\r\nLine 2"', "Carriage returns (\\r\\n) trigger quote wrapping");
  assert(
    escapeCsvCell('A, B\n"C"') === '"A, B\n""C"""',
    "Combined comma, newline, and quotes are properly escaped according to RFC 4180"
  );
  const unicodeSample = "CampusCourier ₹30–₹50 ✓ Articulated ⚠️ Gap Hindi/తెలుగు/தமிழ்";
  assert(escapeCsvCell(unicodeSample) === unicodeSample, "Unicode characters are preserved verbatim");
  console.log();

  // ── SUITE 5: Filename Sanitization ─────────────────────────────────────────
  console.log("Suite 5: Filename Sanitization");
  assert(sanitizeFilename("CampusCourier") === "campuscourier", "Simple name lowercased cleanly");
  assert(sanitizeFilename("IdeaProbe Campus Courier") === "ideaprobe-campus-courier", "Spaces converted to hyphens");
  assert(
    sanitizeFilename('proj/test:01*?"<>|') === "proj-test-01",
    "Invalid filesystem characters (< > : \" / \\ | ? *) stripped/collapsed"
  );
  assert(sanitizeFilename("---messy--name---") === "messy-name", "Leading and trailing hyphens stripped");
  assert(sanitizeFilename("") === "export", "Empty string defaults safely to 'export'");
  console.log();

  // ── SUITE 6: Competitor Differentiation CSV Export ─────────────────────────
  console.log("Suite 6: Competitor Differentiation CSV Export");
  const testCompetitors: CompetitorExportItem[] = [
    {
      id: "comp-01",
      project_id: "proj-sample",
      name: "Chegg Prep / Quizlet",
      category: "direct",
      description: "Flashcard decks, study materials, and crowdsourced study sets.",
      differentiator: "Real-time AI schedule adaptation dynamically restructuring workloads based on syllabus deadlines.",
      provenance: "SAMPLE",
      created_at: "2026-10-24T12:00:00Z",
    },
    {
      id: "comp-02",
      project_id: "proj-sample",
      name: "Paper Notebook / Timetable",
      category: "status_quo",
      description: "Physical paper planner or handwritten syllabus checklists.",
      differentiator: "Not specified.",
      provenance: "SAMPLE",
      created_at: "2026-10-24T12:05:00Z",
    },
    {
      id: "comp-03",
      project_id: "proj-sample",
      name: 'WhatsApp "Study Group"',
      category: "substitute",
      description: "Peer groups for sharing notes, updates, and homework reminders.",
      differentiator: "Automated tracking eliminates noisy group chat scrollback and scattered links.",
      provenance: "USER_INPUT",
      created_at: "2026-10-25T09:30:00Z",
    },
  ];

  const compCsv = generateCompetitorCsv(testCompetitors, "proj-sample");
  assert(compCsv.startsWith("\uFEFF"), "Competitor CSV begins with UTF-8 BOM (\\uFEFF)");
  const cleanCompCsv = compCsv.replace(/^\uFEFF/, "");
  const compLines = cleanCompCsv.split("\r\n");
  assert(compLines.length === 4, `Competitor CSV has 1 header + 3 data rows (got ${compLines.length})`);
  assert(compLines[0] === COMPETITOR_CSV_HEADERS.join(","), "Competitor CSV header matches COMPETITOR_CSV_HEADERS");
  
  // Verify row 1 (Articulated claim)
  assert(compLines[1].includes("comp-01"), "Row 1 contains competitor ID comp-01");
  assert(compLines[1].includes("Direct Competitor"), "Row 1 contains human-readable category 'Direct Competitor'");
  assert(compLines[1].includes("ARTICULATED"), "Row 1 status is marked ARTICULATED");
  assert(compLines[1].includes("SAMPLE"), "Row 1 preserves SAMPLE provenance");

  // Verify row 2 (Gap / Not specified)
  assert(compLines[2].includes("comp-02"), "Row 2 contains competitor ID comp-02");
  assert(compLines[2].includes("Status Quo"), "Row 2 contains human-readable category 'Status Quo'");
  assert(compLines[2].includes("GAP"), "Row 2 status is marked GAP for 'Not specified.' differentiator");

  // Verify row 3 (Quotes & Commas escaped)
  assert(compLines[3].includes('""Study Group""'), "Row 3 correctly escapes inner quotes in competitor name");
  assert(compLines[3].includes("USER_INPUT"), "Row 3 preserves USER_INPUT provenance");
  console.log();

  // ── SUITE 7: Competitor Differentiation JSON Export ─────────────────────────
  console.log("Suite 7: Competitor Differentiation JSON Export");
  const compJson = generateCompetitorJson(testCompetitors, {
    projectId: "proj-sample",
    projectTitle: "AI Study Planner",
    mode: "DEMO",
  });
  const compJsonStr = JSON.stringify(compJson, null, 2);
  const parsedCompJson = JSON.parse(compJsonStr);

  assert(parsedCompJson.export_type === "competitor_differentiation_matrix", "JSON export_type is competitor_differentiation_matrix");
  assert(parsedCompJson.project_id === "proj-sample", "JSON project_id matches");
  assert(parsedCompJson.project_title === "AI Study Planner", "JSON project_title matches");
  assert(parsedCompJson.project_mode === "DEMO", "JSON project_mode matches");
  assert(typeof parsedCompJson.generated_at === "string", "JSON contains generated_at timestamp");
  assert(
    parsedCompJson.disclaimer.includes("NOT validated customer preference"),
    "JSON contains non-negotiable strategic hypothesis disclaimer"
  );
  assert(parsedCompJson.metrics.total_alternatives === 3, "Metrics total_alternatives is 3");
  assert(parsedCompJson.metrics.articulated_differentiators === 2, "Metrics articulated_differentiators is 2");
  assert(parsedCompJson.metrics.differentiation_gaps === 1, "Metrics differentiation_gaps is 1");
  assert(parsedCompJson.metrics.coverage_percent === 67, "Metrics coverage_percent is 67% (2/3 rounded)");
  assert(Array.isArray(parsedCompJson.competitors) && parsedCompJson.competitors.length === 3, "competitors array has 3 items");
  assert(parsedCompJson.competitors[0].differentiation_status === "ARTICULATED", "Item 0 status is ARTICULATED");
  assert(parsedCompJson.competitors[1].differentiation_status === "GAP", "Item 1 status is GAP");
  console.log();

  // ── SUITE 8: Competitor Differentiation Empty Dataset Export ────────────────
  console.log("Suite 8: Competitor Differentiation Empty Dataset Export");
  const emptyCompCsv = generateCompetitorCsv([], "proj-empty");
  const emptyCompLines = emptyCompCsv.replace(/^\uFEFF/, "").split("\r\n");
  assert(emptyCompLines.length === 1, "Empty competitor CSV has exactly 1 header line");
  assert(emptyCompLines[0] === COMPETITOR_CSV_HEADERS.join(","), "Empty competitor CSV header line is intact");

  const emptyCompJson = generateCompetitorJson([], { projectId: "proj-empty" });
  assert(emptyCompJson.metrics.total_alternatives === 0, "Empty JSON total_alternatives is 0");
  assert(emptyCompJson.metrics.articulated_differentiators === 0, "Empty JSON articulated is 0");
  assert(emptyCompJson.metrics.differentiation_gaps === 0, "Empty JSON gaps is 0");
  assert(emptyCompJson.metrics.coverage_percent === 0, "Empty JSON coverage_percent is 0 (no NaN)");
  assert(emptyCompJson.competitors.length === 0, "Empty JSON competitors array is empty");
  console.log();

  // ── SUITE 9: Evidence Ledger CSV Export ─────────────────────────────────────
  console.log("Suite 9: Evidence Ledger CSV Export");
  const testEvidence: EvidenceExportItem[] = [
    {
      id: "ev-001",
      project_id: "proj-campus",
      claim: "Students spend ₹30–₹50 per delivery on peer courier services.",
      excerpt: "Survey indicates 68% of hostel residents would use intra-campus peer delivery.",
      source_id: "src-001",
      source_title: "Campus Move-In Delivery Survey",
      source_url: "https://example.com/survey",
      source_type: "web",
      provenance: "REAL_SOURCE",
      confidence: "High",
      reviewer_status: "ACCEPTED",
      caveat: null,
      created_at: "2026-10-25T14:00:00Z",
    },
    {
      id: "ev-002",
      project_id: "proj-campus",
      claim: 'Hostel guards require "written authorization" for non-student deliveries.',
      excerpt: "University gate policy updated Aug 2025; delivery personnel prohibited past 8 PM.",
      source_id: "src-002",
      source_title: "Campus Gate Policy 2025",
      source_url: null, // missing URL test
      source_type: "document",
      provenance: "USER_INPUT",
      confidence: "Medium",
      reviewer_status: "UNREVIEWED",
      caveat: "Unverified field note from founder observation.",
      created_at: "2026-10-25T15:30:00Z",
    },
  ];

  const evCsv = generateEvidenceCsv(testEvidence, "proj-campus");
  assert(evCsv.startsWith("\uFEFF"), "Evidence CSV begins with UTF-8 BOM (\\uFEFF)");
  const cleanEvCsv = evCsv.replace(/^\uFEFF/, "");
  const evLines = cleanEvCsv.split("\r\n");
  assert(evLines.length === 3, `Evidence CSV has 1 header + 2 data rows (got ${evLines.length})`);
  assert(evLines[0] === EVIDENCE_CSV_HEADERS.join(","), "Evidence CSV header matches EVIDENCE_CSV_HEADERS");

  // Row 1 checks
  assert(evLines[1].includes("ev-001"), "Row 1 contains ev-001");
  assert(evLines[1].includes("₹30–₹50"), "Row 1 preserves currency Unicode symbol");
  assert(evLines[1].includes("REAL_SOURCE"), "Row 1 preserves REAL_SOURCE provenance");
  assert(evLines[1].includes("ACCEPTED"), "Row 1 preserves ACCEPTED review status");
  assert(evLines[1].includes("https://example.com/survey"), "Row 1 contains source URL");

  // Row 2 checks (quotes escaping & null handling)
  assert(evLines[2].includes('""written authorization""'), "Row 2 correctly escapes quotes in claim");
  assert(evLines[2].includes("USER_INPUT"), "Row 2 preserves USER_INPUT provenance");
  assert(evLines[2].includes("UNREVIEWED"), "Row 2 preserves UNREVIEWED reviewer status");
  assert(evLines[2].includes("Unverified field note"), "Row 2 preserves caveat text");
  console.log();

  // ── SUITE 10: Evidence Ledger JSON Export ───────────────────────────────────
  console.log("Suite 10: Evidence Ledger JSON Export");
  const evJson = generateEvidenceJson(testEvidence, {
    projectId: "proj-campus",
    projectTitle: "CampusCourier",
    mode: "LIVE",
  });
  const parsedEvJson = JSON.parse(JSON.stringify(evJson));

  assert(parsedEvJson.export_type === "evidence_ledger", "JSON export_type is evidence_ledger");
  assert(parsedEvJson.project_id === "proj-campus", "JSON project_id matches");
  assert(parsedEvJson.project_title === "CampusCourier", "JSON project_title matches");
  assert(parsedEvJson.project_mode === "LIVE", "JSON project_mode is LIVE");
  assert(parsedEvJson.metrics.total_evidence === 2, "Metrics total_evidence is 2");
  assert(parsedEvJson.metrics.accepted_count === 1, "Metrics accepted_count is 1");
  assert(parsedEvJson.metrics.unreviewed_count === 1, "Metrics unreviewed_count is 1");
  assert(parsedEvJson.metrics.verified_real_count === 1, "Metrics verified_real_count is 1 (REAL_SOURCE)");
  assert(parsedEvJson.metrics.sample_placeholder_count === 0, "Metrics sample_placeholder_count is 0");
  assert(parsedEvJson.evidence[1].source_url === null, "Missing source_url is cleanly represented as null in JSON");
  assert(parsedEvJson.evidence[0].caveat === null, "Missing caveat is cleanly represented as null in JSON");
  console.log();

  // ── SUITE 11: Evidence Ledger Empty Dataset Export ──────────────────────────
  console.log("Suite 11: Evidence Ledger Empty Dataset Export");
  const emptyEvCsv = generateEvidenceCsv([], "proj-empty");
  const emptyEvLines = emptyEvCsv.replace(/^\uFEFF/, "").split("\r\n");
  assert(emptyEvLines.length === 1, "Empty evidence CSV has exactly 1 header line");
  assert(emptyEvLines[0] === EVIDENCE_CSV_HEADERS.join(","), "Empty evidence CSV header line is intact");

  const emptyEvJson = generateEvidenceJson([], { projectId: "proj-empty" });
  assert(emptyEvJson.metrics.total_evidence === 0, "Empty JSON total_evidence is 0");
  assert(emptyEvJson.metrics.accepted_count === 0, "Empty JSON accepted_count is 0");
  assert(emptyEvJson.evidence.length === 0, "Empty JSON evidence array is empty");
  console.log();

  // ── SUITE 12: Project Isolation & Anti-Leakage ──────────────────────────────
  console.log("Suite 12: Project Isolation & Anti-Leakage in Database Queries");
  // Seed two distinct projects into isolated DB
  await db.execute({
    sql: "INSERT INTO projects (id, title, mode, status) VALUES (?, ?, ?, ?)",
    args: ["proj-live-alpha", "Alpha Live Delivery", "LIVE", "active"],
  });
  await db.execute({
    sql: "INSERT INTO projects (id, title, mode, status) VALUES (?, ?, ?, ?)",
    args: ["proj-live-beta", "Beta Live Tutoring", "LIVE", "active"],
  });

  // Seed competitors for Alpha only
  await db.execute({
    sql: "INSERT INTO competitors (id, project_id, name, category, description, differentiator, provenance) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: ["comp-alpha-1", "proj-live-alpha", "Local Hostel Runner", "direct", "Direct competitor", "Guaranteed 15m delivery", "USER_INPUT"],
  });

  // Seed evidence for Alpha only
  await db.execute({
    sql: "INSERT INTO evidence (id, project_id, claim, excerpt, provenance, confidence, reviewer_status) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: ["ev-alpha-1", "proj-live-alpha", "Students complain about 30m gate walks", "Walking excerpt", "REAL_SOURCE", "High", "ACCEPTED"],
  });

  // Query Beta competitors & evidence
  const betaCompRows = (await db.execute({
    sql: "SELECT * FROM competitors WHERE project_id = ?",
    args: ["proj-live-beta"],
  })).rows as unknown as CompetitorExportItem[];

  const betaEvRows = (await db.execute({
    sql: "SELECT * FROM evidence WHERE project_id = ?",
    args: ["proj-live-beta"],
  })).rows as unknown as EvidenceExportItem[];

  assert(betaCompRows.length === 0, "Project Beta has 0 competitors; does NOT inherit Alpha competitors");
  assert(betaEvRows.length === 0, "Project Beta has 0 evidence; does NOT inherit Alpha evidence");

  const betaCompCsv = generateCompetitorCsv(betaCompRows, "proj-live-beta");
  assert(!betaCompCsv.includes("Local Hostel Runner"), "Beta CSV export never contains Alpha competitor");
  assert(!betaCompCsv.includes("Chegg Prep"), "Beta CSV export never falls back to demo competitor");

  const betaEvCsv = generateEvidenceCsv(betaEvRows, "proj-live-beta");
  assert(!betaEvCsv.includes("Students complain"), "Beta evidence CSV export never contains Alpha claim");
  console.log();

  // ── SUITE 13: Existing Markdown Export & UI Compatibility ───────────────────
  console.log("Suite 13: Existing Markdown Export & UI Compatibility");
  const mdTable = buildDifferentiationMarkdownTable(testCompetitors);
  assert(mdTable.includes("| Alternative | Category | Current Solution / Offer | Our Differentiation Advantage | Status | Provenance |"), "Markdown table retains standard header row");
  assert(mdTable.includes("**Chegg Prep / Quizlet**"), "Markdown table formats bold competitor names");
  assert(mdTable.includes("✓ Articulated"), "Markdown table flags articulated status");
  assert(mdTable.includes("⚠️ Gap (Unspecified)"), "Markdown table flags gap status");
  console.log();

  // ── SUITE 14: Production Database Baseline Post-Execution Invariance Check ──
  console.log("Suite 14: Production Database Baseline Post-Execution Invariance Check");
  const postCounts = await getTableCounts(prodDbPath);
  for (const [table, preCount] of Object.entries(preCounts)) {
    const postCount = postCounts[table];
    assert(
      postCount === preCount,
      `Table '${table}' count is invariant: pre=${preCount}, post=${postCount}`
    );
  }

  // Cleanup isolated DB
  try {
    if (fs.existsSync(isolatedDbPath)) {
      fs.unlinkSync(isolatedDbPath);
    }
  } catch {
    // Windows file locks remain active until process exit
  }

  console.log("\n================================================================================");
  console.log(`  Phase 3M Test Results: ${passedAssertions} passed, ${failedAssertions} failed across ${totalAssertions} assertions`);
  console.log("================================================================================\n");

  if (failedAssertions > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Fatal error running Phase 3M test suite:", err);
  process.exit(1);
});
