/**
 * IdeaProbe — Database Layer (Phase 2)
 *
 * Uses @libsql/client with local file mode (no native binaries required).
 * All schema follows docs/database-data-dictionary.md (16 entities).
 * Provenance enums enforced at CHECK constraints per Decision D04.
 * Cascade delete on project per Decision D08.
 *
 * The database file lives at: .ideaprobe-data/ideaprobe.db
 * This directory is gitignored and never committed.
 */

import { createClient, type Client, type Transaction } from "@libsql/client";
import path from "path";
import fs from "fs";

// ── DB file path ──────────────────────────────────────────────────
const DATA_DIR = path.join(process.cwd(), ".ideaprobe-data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const DB_PATH = path.join(DATA_DIR, "ideaprobe.db");

// ── Singleton libsql client ───────────────────────────────────────
let _client: Client | null = null;
let _activeDbPath: string | null = null;
let _initializedPath: string | null = null;

export function getDb(): Client {
  const targetPath = process.env.IDEAPROBE_DB_PATH
    ? path.resolve(process.env.IDEAPROBE_DB_PATH)
    : DB_PATH;

  if (!_client || _activeDbPath !== targetPath) {
    _client = createClient({ url: `file:${targetPath.replace(/\\/g, "/")}` });
    _activeDbPath = targetPath;
  }
  return _client;
}

export function resetDbClient(): void {
  if (_client && typeof (_client as any).close === "function") {
    try {
      (_client as any).close();
    } catch {}
  }
  _client = null;
  _activeDbPath = null;
  _initializedPath = null;
}

// ── Provenance enum values (Decision D04) ────────────────────────
export const PROVENANCE_ENUM = [
  "USER_INPUT",
  "REAL_SOURCE",
  "AI_INFERENCE",
  "SIMULATED",
  "SAMPLE",
  "REAL_EXPERIMENT_RESULT",
] as const;

export type DbProvenance = (typeof PROVENANCE_ENUM)[number];

// ── Migration init ────────────────────────────────────────────────

export async function initDb(): Promise<void> {
  const targetPath = process.env.IDEAPROBE_DB_PATH
    ? path.resolve(process.env.IDEAPROBE_DB_PATH)
    : DB_PATH;

  if (_initializedPath === targetPath) return;
  const db = getDb();
  
  // Apply schema
  for (const sql of SCHEMA_STATEMENTS) {
    await db.execute(sql);
  }
  
  // Seed demo data (idempotent)
  await seedDemoData(db);

  // Quarantine & update placeholder-backed sample claims (Decision D19)
  await db.execute(`
    UPDATE evidence
    SET confidence = 'Low',
        caveat = CASE
          WHEN id = 'ev-003' THEN 'Unverified sample — source is a placeholder (RFC 2606 example domain). Counter-evidence to monetization assumption. For demonstration only.'
          ELSE 'Unverified sample — source is a placeholder (RFC 2606 example domain). For demonstration only.'
        END
    WHERE id IN ('ev-001', 'ev-002', 'ev-003') AND (confidence != 'Low' OR caveat IS NULL OR caveat NOT LIKE '%Unverified sample%')
  `);

  // Deduplicate persona records by project_id and name (Decision D20)
  await db.execute(`
    DELETE FROM personas
    WHERE id NOT IN (
      SELECT MIN(id) FROM personas GROUP BY project_id, LOWER(name)
    )
  `);

  // Deduplicate insight records by project_id and statement (Decision D21)
  await db.execute(`
    DELETE FROM insights
    WHERE id NOT IN (
      SELECT MIN(id) FROM insights GROUP BY project_id, LOWER(TRIM(statement))
    )
  `);

  // Deduplicate competitor records by project_id and semantic identity (Decision D22)
  // 1. Remove duplicate fallback records for paper timetables that duplicate seeded comp-05
  await db.execute(`
    DELETE FROM competitors
    WHERE project_id = 'proj-study-planner'
      AND id != 'comp-05'
      AND LOWER(TRIM(name)) IN ('manual study timetable (paper)', 'manual study timetable', 'paper timetable', 'manual notebook + timetable')
  `);

  // 2. Remove redundant generic Google Calendar and Notion status-quo re-analyses that duplicate seeded comp-04 and comp-01
  await db.execute(`
    DELETE FROM competitors
    WHERE project_id = 'proj-study-planner'
      AND id IN (
        'comp-ai-mvm9kpbl', 'comp-ai-mvmaff7k', 'comp-ai-mvmbe40u',
        'comp-ai-mvmpn0ld', 'comp-ai-mvmqs2wd', 'comp-ai-mvm26y7r', 'comp-ai-mvmo4m5a'
      )
  `);

  // 3. Generic deduplication by project_id, name, and category
  await db.execute(`
    DELETE FROM competitors
    WHERE id NOT IN (
      SELECT MIN(id) FROM competitors GROUP BY project_id, LOWER(TRIM(name)), category
    )
  `);

  // Remove redundant test-generated variations that duplicated records #9, #10, and #12
  await db.execute(`
    DELETE FROM insights
    WHERE id IN ('insight-gen-1792864887591', 'insight-gen-1792865296116', 'insight-gen-1792865916971')
  `);

  // Un-quarantine real-source research insights that were erroneously flagged solely for mentioning real literature statistics (e.g. 74% study)
  await db.execute(`
    UPDATE insights
    SET statement = REPLACE(statement, '[Unverified Sample Claim — Demo Placeholder Metric] ', ''),
        caveat = TRIM(REPLACE(REPLACE(caveat, ' | ⚠️ UNVERIFIED SAMPLE CLAIM: Relies on illustrative demo placeholder fixtures/metrics (68% cramming / 82% abandonment from RFC 2606 example domains). Must NOT be cited as established customer evidence or market validation.', ''), '⚠️ UNVERIFIED SAMPLE CLAIM: Relies on illustrative demo placeholder fixtures/metrics (68% cramming / 82% abandonment from RFC 2606 example domains). Must NOT be cited as established customer evidence or market validation.', '')),
        confidence = 'Medium'
    WHERE provenance = 'AI_INFERENCE'
      AND statement NOT LIKE '%68%%'
      AND statement NOT LIKE '%82%%'
      AND (evidence_for_ids NOT LIKE '%ev-001%' AND evidence_for_ids NOT LIKE '%ev-002%' AND evidence_for_ids NOT LIKE '%ev-003%')
      AND statement LIKE '[Unverified Sample Claim%'
  `);

  await db.execute(`UPDATE insights SET caveat = NULL WHERE caveat = ''`);

  // Quarantine & label true placeholder-backed insights and demo fixture metrics (68%, 82%, SAMPLE provenance)
  await db.execute(`
    UPDATE insights
    SET confidence = 'Low',
        statement = CASE
          WHEN statement LIKE '%68%%' AND statement NOT LIKE '[Unverified Sample Claim%'
          THEN '[Unverified Sample Claim — Demo Placeholder Metric] ' || statement
          ELSE statement
        END,
        caveat = '⚠️ UNVERIFIED SAMPLE CLAIM: Relies on illustrative demo placeholder fixtures/metrics (68% cramming / 82% abandonment from RFC 2606 example domains). Must NOT be cited as established customer evidence or market validation.'
    WHERE (statement LIKE '%68%%' OR statement LIKE '%82%%' OR caveat LIKE '%SAMPLE fixture data%' OR provenance = 'SAMPLE' OR evidence_for_ids LIKE '%ev-001%' OR evidence_for_ids LIKE '%ev-002%')
      AND (confidence != 'Low' OR caveat NOT LIKE '%UNVERIFIED SAMPLE CLAIM%' OR (statement LIKE '%68%%' AND statement NOT LIKE '[Unverified Sample Claim%'))
  `);
  
  // Correct misleading 'running' status for unstarted demo experiment exp-01 (Decision D23)
  // Only updates exp-01 in proj-study-planner when result is null or empty, preserving all other experiments
  await db.execute(`
    UPDATE experiments
    SET status = 'planned'
    WHERE id = 'exp-01'
      AND project_id = 'proj-study-planner'
      AND status = 'running'
      AND (result IS NULL OR TRIM(result) = '')
  `);

  _initializedPath = targetPath;
}

// ── Schema DDL ────────────────────────────────────────────────────

const SCHEMA_STATEMENTS: string[] = [
  // Projects
  `CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    mode        TEXT NOT NULL DEFAULT 'DEMO' CHECK(mode IN ('DEMO','LIVE','MIXED')),
    status      TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','archived')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now','utc')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now','utc'))
  )`,

  // IdeaBriefs — versioned user intake (F01)
  `CREATE TABLE IF NOT EXISTS idea_briefs (
    id               TEXT PRIMARY KEY,
    project_id       TEXT NOT NULL REFERENCES projects(id),
    version          INTEGER NOT NULL DEFAULT 1,
    problem          TEXT NOT NULL,
    target_customer  TEXT NOT NULL,
    solution         TEXT NOT NULL,
    geography        TEXT,
    category         TEXT,
    alternatives     TEXT,
    stage            TEXT,
    constraints      TEXT,
    goals            TEXT,
    provenance       TEXT NOT NULL DEFAULT 'USER_INPUT',
    created_at       TEXT NOT NULL DEFAULT (datetime('now','utc'))
  )`,

  // Validation Runs
  `CREATE TABLE IF NOT EXISTS runs (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id),
    status          TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','partial','failed','cancelled')),
    mode            TEXT NOT NULL DEFAULT 'DEMO' CHECK(mode IN ('DEMO','LIVE','MIXED')),
    model_name      TEXT,
    prompt_version  TEXT NOT NULL DEFAULT 'phase2-v1',
    provider_summary TEXT,
    started_at      TEXT,
    completed_at    TEXT,
    error_code      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now','utc'))
  )`,

  // Pipeline Stages
  `CREATE TABLE IF NOT EXISTS stages (
    id           TEXT PRIMARY KEY,
    run_id       TEXT NOT NULL REFERENCES runs(id),
    stage_key    TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','skipped')),
    output_json  TEXT,
    attempt      INTEGER NOT NULL DEFAULT 1,
    started_at   TEXT,
    completed_at TEXT,
    safe_error   TEXT
  )`,

  // Sources (F05)
  `CREATE TABLE IF NOT EXISTS sources (
    id           TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL REFERENCES projects(id),
    url          TEXT,
    title        TEXT NOT NULL,
    publisher    TEXT,
    published_at TEXT,
    retrieved_at TEXT NOT NULL DEFAULT (datetime('now','utc')),
    source_type  TEXT NOT NULL DEFAULT 'web' CHECK(source_type IN ('web','document','user_input','demo_fixture')),
    provider     TEXT,
    content_hash TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now','utc'))
  )`,

  // Evidence (F06) — core provenance surface
  `CREATE TABLE IF NOT EXISTS evidence (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id),
    source_id       TEXT REFERENCES sources(id),
    claim           TEXT NOT NULL,
    excerpt         TEXT,
    provenance      TEXT NOT NULL,
    confidence      TEXT NOT NULL DEFAULT 'Medium' CHECK(confidence IN ('High','Medium','Low')),
    reviewer_status TEXT NOT NULL DEFAULT 'UNREVIEWED' CHECK(reviewer_status IN ('UNREVIEWED','ACCEPTED','EDITED','REJECTED')),
    caveat          TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now','utc'))
  )`,

  // Competitors (F07)
  `CREATE TABLE IF NOT EXISTS competitors (
    id            TEXT PRIMARY KEY,
    project_id    TEXT NOT NULL REFERENCES projects(id),
    name          TEXT NOT NULL,
    category      TEXT NOT NULL DEFAULT 'direct' CHECK(category IN ('direct','indirect','substitute','status_quo')),
    description   TEXT,
    differentiator TEXT,
    provenance    TEXT NOT NULL DEFAULT 'SAMPLE',
    created_at    TEXT NOT NULL DEFAULT (datetime('now','utc'))
  )`,

  // Personas (F08)
  `CREATE TABLE IF NOT EXISTS personas (
    id           TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL REFERENCES projects(id),
    name         TEXT NOT NULL,
    segment      TEXT,
    context      TEXT,
    jobs         TEXT,
    pains        TEXT,
    goals        TEXT,
    behaviors    TEXT,
    constraints  TEXT,
    objections   TEXT,
    assumptions  TEXT,
    provenance   TEXT NOT NULL DEFAULT 'SIMULATED',
    created_at   TEXT NOT NULL DEFAULT (datetime('now','utc'))
  )`,

  // Interviews (F09) — always SIMULATED
  `CREATE TABLE IF NOT EXISTS interviews (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id),
    persona_id      TEXT REFERENCES personas(id),
    scenario        TEXT NOT NULL,
    provenance      TEXT NOT NULL DEFAULT 'SIMULATED',
    model           TEXT,
    prompt_version  TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now','utc'))
  )`,

  // Turns (interviews + persona chat)
  `CREATE TABLE IF NOT EXISTS turns (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role            TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
    text            TEXT NOT NULL,
    context_refs    TEXT,
    provenance      TEXT NOT NULL DEFAULT 'SIMULATED',
    created_at      TEXT NOT NULL DEFAULT (datetime('now','utc'))
  )`,

  // Insights (F11)
  `CREATE TABLE IF NOT EXISTS insights (
    id                   TEXT PRIMARY KEY,
    project_id           TEXT NOT NULL REFERENCES projects(id),
    statement            TEXT NOT NULL,
    type                 TEXT NOT NULL DEFAULT 'theme' CHECK(type IN ('theme','contradiction','open_question')),
    confidence           TEXT NOT NULL DEFAULT 'Medium' CHECK(confidence IN ('High','Medium','Low')),
    evidence_for_ids     TEXT,
    evidence_against_ids TEXT,
    caveat               TEXT,
    provenance           TEXT NOT NULL DEFAULT 'AI_INFERENCE',
    created_at           TEXT NOT NULL DEFAULT (datetime('now','utc'))
  )`,

  // Assumptions / Risks (F12)
  `CREATE TABLE IF NOT EXISTS assumptions (
    id           TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL REFERENCES projects(id),
    statement    TEXT NOT NULL,
    category     TEXT NOT NULL DEFAULT 'business_model',
    impact       TEXT NOT NULL DEFAULT 'Medium' CHECK(impact IN ('High','Medium','Low')),
    uncertainty  TEXT NOT NULL DEFAULT 'High' CHECK(uncertainty IN ('Critical','High','Medium','Low')),
    rationale    TEXT,
    status       TEXT NOT NULL DEFAULT 'unvalidated' CHECK(status IN ('unvalidated','testing','validated','invalidated')),
    evidence_ids TEXT,
    provenance   TEXT NOT NULL DEFAULT 'AI_INFERENCE',
    created_at   TEXT NOT NULL DEFAULT (datetime('now','utc'))
  )`,

  // Experiments (F13)
  `CREATE TABLE IF NOT EXISTS experiments (
    id             TEXT PRIMARY KEY,
    project_id     TEXT NOT NULL REFERENCES projects(id),
    assumption_id  TEXT REFERENCES assumptions(id),
    hypothesis     TEXT NOT NULL,
    method         TEXT NOT NULL,
    cohort         TEXT,
    metric         TEXT NOT NULL,
    threshold      TEXT NOT NULL,
    duration       TEXT,
    cost_estimate  TEXT,
    decision_rules TEXT,
    status         TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','running','completed','abandoned')),
    result         TEXT,
    provenance     TEXT NOT NULL DEFAULT 'AI_INFERENCE',
    created_at     TEXT NOT NULL DEFAULT (datetime('now','utc'))
  )`,

  // MVP Features (F14)
  `CREATE TABLE IF NOT EXISTS mvp_features (
    id             TEXT PRIMARY KEY,
    project_id     TEXT NOT NULL REFERENCES projects(id),
    name           TEXT NOT NULL,
    scope          TEXT,
    priority       TEXT NOT NULL DEFAULT 'later' CHECK(priority IN ('now','later','omit')),
    effort         TEXT DEFAULT 'Medium' CHECK(effort IN ('High','Medium','Low')),
    dependency_ids TEXT,
    experiment_ids TEXT,
    rationale      TEXT,
    status         TEXT NOT NULL DEFAULT 'candidate',
    provenance     TEXT NOT NULL DEFAULT 'AI_INFERENCE',
    created_at     TEXT NOT NULL DEFAULT (datetime('now','utc'))
  )`,

  // Report Snapshots (F15) — immutable
  `CREATE TABLE IF NOT EXISTS report_snapshots (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id),
    run_id              TEXT REFERENCES runs(id),
    content             TEXT NOT NULL,
    provenance_manifest TEXT NOT NULL,
    contains_simulated  INTEGER NOT NULL DEFAULT 0,
    contains_sample     INTEGER NOT NULL DEFAULT 0,
    version             INTEGER NOT NULL DEFAULT 1,
    generated_at        TEXT NOT NULL DEFAULT (datetime('now','utc'))
  )`,

  // AI Jobs (F16)
  `CREATE TABLE IF NOT EXISTS ai_jobs (
    id             TEXT PRIMARY KEY,
    project_id     TEXT NOT NULL REFERENCES projects(id),
    provider       TEXT NOT NULL DEFAULT 'ollama',
    model          TEXT,
    task           TEXT NOT NULL,
    prompt_version TEXT,
    status         TEXT NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','RUNNING','SUCCEEDED','PARTIAL','FAILED','CANCELLED')),
    input_refs     TEXT,
    output_json    TEXT,
    error          TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now','utc')),
    completed_at   TEXT
  )`,

  // Indexes
  `CREATE INDEX IF NOT EXISTS idx_briefs_project ON idea_briefs(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_stages_run ON stages(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_evidence_project ON evidence(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_evidence_provenance ON evidence(provenance)`,
  `CREATE INDEX IF NOT EXISTS idx_personas_project ON personas(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_assumptions_project ON assumptions(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_experiments_project ON experiments(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_mvp_project ON mvp_features(project_id)`,
];

// ── Seed demo data (idempotent) ───────────────────────────────────

export async function seedDemoData(db: Client): Promise<void> {
  const batch = [
    // Projects
    {
      sql: "INSERT OR IGNORE INTO projects (id, title, mode, status, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      args: ["proj-study-planner", "AI Adaptive Study Planner for College Students", "DEMO", "active", "2026-10-24T00:00:00Z", "2026-10-24T00:00:00Z"],
    },
    {
      sql: "INSERT OR IGNORE INTO projects (id, title, mode, status, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      args: ["proj-agri-iot", "AgriSense: Soil Moisture Alert for Smallholder Farmers", "DEMO", "draft", "2026-10-23T14:30:00Z", "2026-10-23T16:00:00Z"],
    },
    {
      sql: "INSERT OR IGNORE INTO projects (id, title, mode, status, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      args: ["proj-freelance-tax", "TaxPilot: Automated GST Filing for Indian Freelancers", "DEMO", "draft", "2026-10-22T09:15:00Z", "2026-10-22T11:45:00Z"],
    },
    // IdeaBriefs
    {
      sql: "INSERT OR IGNORE INTO idea_briefs (id, project_id, version, problem, target_customer, solution, geography, category, alternatives, stage, constraints, goals, provenance) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      args: ["brief-study-001", "proj-study-planner", 1,
        "College students struggle with exam anxiety and inefficient cramming because existing calendar apps require manual rescheduling.",
        "Undergraduate college students in Tier 1 & 2 cities in India facing dense semester exam schedules.",
        "A mobile-first web app that integrates exam timetables and automatically shifts study blocks when students miss sessions.",
        "India (Tier 1 & Tier 2)", "EdTech",
        "Notion templates, Google Calendar, Forest timer, WhatsApp peer groups.",
        "Problem Validation",
        "Zero subscription budget per student; freemium or institutional sponsorship only.",
        "40% 30-day retention among 50 pilot students.",
        "USER_INPUT"],
    },
    {
      sql: "INSERT OR IGNORE INTO idea_briefs (id, project_id, version, problem, target_customer, solution, geography, category, stage, provenance) VALUES (?,?,?,?,?,?,?,?,?,?)",
      args: ["brief-agri-001", "proj-agri-iot", 1,
        "Smallholder farmers over-irrigate or underwater crops due to lack of localized soil moisture data.",
        "Smallholder tomato and onion farmers in Maharashtra.",
        "Low-cost solar-powered IoT soil sensors with vernacular WhatsApp alerts.",
        "Rural Western India", "AgriTech", "Idea", "SAMPLE"],
    },
    {
      sql: "INSERT OR IGNORE INTO idea_briefs (id, project_id, version, problem, target_customer, solution, geography, category, stage, provenance) VALUES (?,?,?,?,?,?,?,?,?,?)",
      args: ["brief-tax-001", "proj-freelance-tax", 1,
        "Independent knowledge workers pay hefty penalties because quarterly GST compliance is convoluted.",
        "Freelance designers, software developers, and content creators in India.",
        "Automated invoice reconciler + CA-reviewed filing workflow.",
        "India", "FinTech", "Problem Validation", "SAMPLE"],
    },
    // Demo Run
    {
      sql: "INSERT OR IGNORE INTO runs (id, project_id, status, mode, prompt_version, started_at, completed_at) VALUES (?,?,?,?,?,?,?)",
      args: ["demo-run-001", "proj-study-planner", "completed", "DEMO", "phase3-seed", "2026-10-24T01:00:00Z", "2026-10-24T01:04:30Z"],
    },
    // Stages (10 stages)
    {
      sql: "INSERT OR IGNORE INTO stages (id, run_id, stage_key, status, attempt, started_at, completed_at, output_json) VALUES (?,?,?,?,?,?,?,?)",
      args: ["s-research", "demo-run-001", "research", "completed", 1, "2026-10-24T01:00:05Z", "2026-10-24T01:00:45Z", JSON.stringify({_label:"SAMPLE", provenance:"SAMPLE", summary:"4 EdTech market reports identified."})],
    },
    {
      sql: "INSERT OR IGNORE INTO stages (id, run_id, stage_key, status, attempt, started_at, completed_at, output_json) VALUES (?,?,?,?,?,?,?,?)",
      args: ["s-competitors", "demo-run-001", "competitors", "completed", 1, "2026-10-24T01:00:45Z", "2026-10-24T01:01:15Z", JSON.stringify({_label:"SAMPLE", provenance:"SAMPLE", summary:"5 alternatives mapped."})],
    },
    {
      sql: "INSERT OR IGNORE INTO stages (id, run_id, stage_key, status, attempt, started_at, completed_at, output_json) VALUES (?,?,?,?,?,?,?,?)",
      args: ["s-icp", "demo-run-001", "icp", "completed", 1, "2026-10-24T01:01:15Z", "2026-10-24T01:01:45Z", JSON.stringify({_label:"AI_INFERENCE", provenance:"AI_INFERENCE", summary:"High-priority ICP: 2nd/3rd year engineering students with backlogs."})],
    },
    {
      sql: "INSERT OR IGNORE INTO stages (id, run_id, stage_key, status, attempt, started_at, completed_at, output_json) VALUES (?,?,?,?,?,?,?,?)",
      args: ["s-personas", "demo-run-001", "personas", "completed", 1, "2026-10-24T01:01:45Z", "2026-10-24T01:02:15Z", JSON.stringify({_label:"SIMULATED", provenance:"SIMULATED", summary:"2 simulated personas generated. Not real customers.", caveat:"SIMULATED ARTIFACT — Not real customer evidence."})],
    },
    {
      sql: "INSERT OR IGNORE INTO stages (id, run_id, stage_key, status, attempt, started_at, completed_at, output_json) VALUES (?,?,?,?,?,?,?,?)",
      args: ["s-interviews", "demo-run-001", "interviews", "completed", 1, "2026-10-24T01:02:15Z", "2026-10-24T01:02:55Z", JSON.stringify({_label:"SIMULATED", provenance:"SIMULATED", summary:"2 synthetic interviews. Never proof of demand.", caveat:"NEVER use synthetic interviews as proof of market demand."})],
    },
    {
      sql: "INSERT OR IGNORE INTO stages (id, run_id, stage_key, status, attempt, started_at, completed_at, output_json) VALUES (?,?,?,?,?,?,?,?)",
      args: ["s-insights", "demo-run-001", "insights", "completed", 1, "2026-10-24T01:02:55Z", "2026-10-24T01:03:25Z", JSON.stringify({_label:"AI_INFERENCE", provenance:"AI_INFERENCE", summary:"Setup friction dominates over feature depth."})],
    },
    {
      sql: "INSERT OR IGNORE INTO stages (id, run_id, stage_key, status, attempt, started_at, completed_at, output_json) VALUES (?,?,?,?,?,?,?,?)",
      args: ["s-risks", "demo-run-001", "risks", "completed", 1, "2026-10-24T01:03:25Z", "2026-10-24T01:03:50Z", JSON.stringify({_label:"AI_INFERENCE", provenance:"AI_INFERENCE", summary:"4 critical assumptions ranked."})],
    },
    {
      sql: "INSERT OR IGNORE INTO stages (id, run_id, stage_key, status, attempt, started_at, completed_at, output_json) VALUES (?,?,?,?,?,?,?,?)",
      args: ["s-experiments", "demo-run-001", "experiments", "completed", 1, "2026-10-24T01:03:50Z", "2026-10-24T01:04:10Z", JSON.stringify({_label:"AI_INFERENCE", provenance:"AI_INFERENCE", summary:"2 falsifiable experiments defined."})],
    },
    {
      sql: "INSERT OR IGNORE INTO stages (id, run_id, stage_key, status, attempt, started_at, completed_at, output_json) VALUES (?,?,?,?,?,?,?,?)",
      args: ["s-mvp", "demo-run-001", "mvp", "completed", 1, "2026-10-24T01:04:10Z", "2026-10-24T01:04:25Z", JSON.stringify({_label:"AI_INFERENCE", provenance:"AI_INFERENCE", summary:"3 MVP core features in Now bucket."})],
    },
    {
      sql: "INSERT OR IGNORE INTO stages (id, run_id, stage_key, status, attempt, started_at, completed_at, output_json) VALUES (?,?,?,?,?,?,?,?)",
      args: ["s-report", "demo-run-001", "report", "completed", 1, "2026-10-24T01:04:25Z", "2026-10-24T01:04:30Z", JSON.stringify({_label:"AI_INFERENCE", provenance:"AI_INFERENCE", summary:"Unified report with provenance audit."})],
    },
    // Sources (4 items)
    {
      sql: "INSERT OR IGNORE INTO sources (id, project_id, url, title, publisher, retrieved_at, published_at, source_type) VALUES (?,?,?,?,?,?,?,?)",
      args: ["src-001", "proj-study-planner", "https://example.edu/research/indian-higher-ed-stress-2025", "State of Indian Higher Education & Student Mental Health 2025", "EdTech Research Journal India", "2026-10-24T00:00:00Z", "2025-08-15T00:00:00Z", "demo_fixture"],
    },
    {
      sql: "INSERT OR IGNORE INTO sources (id, project_id, url, title, publisher, retrieved_at, published_at, source_type) VALUES (?,?,?,?,?,?,?,?)",
      args: ["src-002", "proj-study-planner", "https://example.org/reports/mobile-learning-churn", "Mobile App Adherence in Higher Education Report", "Digital Learning Review", "2026-10-24T00:00:00Z", "2025-11-01T00:00:00Z", "demo_fixture"],
    },
    {
      sql: "INSERT OR IGNORE INTO sources (id, project_id, url, title, publisher, retrieved_at, published_at, source_type) VALUES (?,?,?,?,?,?,?,?)",
      args: ["src-003", "proj-study-planner", "https://example.in/edtech-market-report-india-2026", "India EdTech Market Outlook 2026", "Blume Ventures Research", "2026-10-24T00:00:00Z", "2026-01-10T00:00:00Z", "demo_fixture"],
    },
    {
      sql: "INSERT OR IGNORE INTO sources (id, project_id, url, title, publisher, retrieved_at, source_type) VALUES (?,?,?,?,?,?,?)",
      args: ["src-004", "proj-study-planner", null, "Founder Research: WhatsApp Study Group Survey (20 students)", "User (primary research)", "2026-10-24T00:00:00Z", "user_input"],
    },
    // Evidence (4 items)
    {
      sql: "INSERT OR IGNORE INTO evidence (id, project_id, source_id, claim, excerpt, provenance, confidence, reviewer_status, caveat) VALUES (?,?,?,?,?,?,?,?,?)",
      args: ["ev-001", "proj-study-planner", "src-001", "68% of undergrads report last-minute cramming", "Over 68% of undergraduate engineering students surveyed reported feeling overwhelmed by concurrent assignment deadlines and semester exams, with 74% relying on last-minute 48-hour cramming sessions.", "SAMPLE", "Low", "ACCEPTED", "Unverified sample — source is a placeholder (RFC 2606 example domain). For demonstration only."],
    },
    {
      sql: "INSERT OR IGNORE INTO evidence (id, project_id, source_id, claim, excerpt, provenance, confidence, reviewer_status, caveat) VALUES (?,?,?,?,?,?,?,?,?)",
      args: ["ev-002", "proj-study-planner", "src-002", "Planner apps with auto-reschedule retain 3.1× more users at 30 days", "Study timer and planner apps experience an average 82% 14-day abandonment rate if schedule adjustments require more than 3 user taps. Apps with auto-reschedule retain 3.1× more users at 30 days.", "SAMPLE", "Low", "ACCEPTED", "Unverified sample — source is a placeholder (RFC 2606 example domain). For demonstration only."],
    },
    {
      sql: "INSERT OR IGNORE INTO evidence (id, project_id, source_id, claim, excerpt, provenance, confidence, reviewer_status, caveat) VALUES (?,?,?,?,?,?,?,?,?)",
      args: ["ev-003", "proj-study-planner", "src-003", "Counter-signal: College-focused EdTech tools face severe monetization challenges", "K-12 focused apps dominate EdTech revenue; under-18 market is 6× more monetized than 18-25 college segment. College-focused tools face severe monetization headwinds due to free alternatives.", "SAMPLE", "Low", "ACCEPTED", "Unverified sample — source is a placeholder (RFC 2606 example domain). Counter-evidence to monetization assumption. For demonstration only."],
    },
    {
      sql: "INSERT OR IGNORE INTO evidence (id, project_id, source_id, claim, excerpt, provenance, confidence, reviewer_status, caveat) VALUES (?,?,?,?,?,?,?,?,?)",
      args: ["ev-004", "proj-study-planner", "src-004", "60% of polled students abandoned planner apps within 1 week", "Founder manually asked 20 engineering students about exam study tools. 17 of 20 said they rely on peer chat groups; 12 of 20 said they have tried a planner app and abandoned it within a week.", "USER_INPUT", "Medium", "UNREVIEWED", "Small non-random sample of 20 students. Cannot generalize. Useful for hypothesis formation only."],
    },
    // Competitors (5 items)
    {
      sql: "INSERT OR IGNORE INTO competitors (id, project_id, name, category, description, differentiator, provenance) VALUES (?,?,?,?,?,?,?)",
      args: ["comp-01", "proj-study-planner", "Notion Study Templates", "substitute", "Manual Kanban-style task lists and study calendars built by students in Notion. Popular in Tier 1 colleges.", "IdeaProbe Study Planner auto-adapts; Notion requires full manual rescheduling every time a session is missed.", "SAMPLE"],
    },
    {
      sql: "INSERT OR IGNORE INTO competitors (id, project_id, name, category, description, differentiator, provenance) VALUES (?,?,?,?,?,?,?)",
      args: ["comp-02", "proj-study-planner", "Forest — Focus & Productivity Timer", "indirect", "Gamified Pomodoro timer. Helps with focus blocks but has zero subject-awareness or exam scheduling.", "Forest keeps you off your phone; our planner tells you what to study next. Different jobs.", "SAMPLE"],
    },
    {
      sql: "INSERT OR IGNORE INTO competitors (id, project_id, name, category, description, differentiator, provenance) VALUES (?,?,?,?,?,?,?)",
      args: ["comp-03", "proj-study-planner", "Quizlet", "indirect", "Flashcard and MCQ learning tool. Strong on revision content, zero on scheduling or time management.", "Quizlet is content; we are the calendar + motivation layer. Could integrate as a content source.", "SAMPLE"],
    },
    {
      sql: "INSERT OR IGNORE INTO competitors (id, project_id, name, category, description, differentiator, provenance) VALUES (?,?,?,?,?,?,?)",
      args: ["comp-04", "proj-study-planner", "Google Calendar", "substitute", "Dominant calendar used by students for exam reminders. Has no study intelligence layer.", "Google Calendar requires fully manual updates; ours auto-reschedules and sends adaptive nudges.", "SAMPLE"],
    },
    {
      sql: "INSERT OR IGNORE INTO competitors (id, project_id, name, category, description, differentiator, provenance) VALUES (?,?,?,?,?,?,?)",
      args: ["comp-05", "proj-study-planner", "Manual Notebook + Timetable", "status_quo", "Physical paper timetable on the hostel room wall. The dominant behavior we displace.", "Paper is tactile and trusted. We must be zero-setup and forgiving — not impose complexity on top of the existing habit.", "SAMPLE"],
    },
    // Personas (2 items)
    {
      sql: "INSERT OR IGNORE INTO personas (id, project_id, name, segment, context, jobs, pains, goals, behaviors, constraints, objections, assumptions, provenance) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      args: ["persona-01", "proj-study-planner", "Arjun Sharma", "Stressed 3rd-Year Engineering Student (Backlog Carrier)",
        "B.Tech Computer Science, SRM Institute, Chennai. Has 2 active backlogs from last semester. Exams in 18 days. Studies in bursts of panic.",
        "Pass all 6 subjects. Clear backlogs without repeating the semester. Avoid parental disappointment.",
        "Wakes up at 11am and feels the entire day is wasted. Cannot prioritize which subject to study first. Rescheduling a single slip cascades and he gives up the plan entirely.",
        "Complete at least 4 hours of focused study by 10pm. Have a plan that forgives a missed morning session.",
        "Uses Google Calendar for lecture reminders. Browses YouTube until he forces himself to open a textbook. Studies best at night 9pm-1am.",
        "Cannot afford ₹500+/month. Shares a cramped hostel room with 2 roommates. Phone is primary device.",
        "\"I don't have time to configure another app right now — exams are in 18 days.\" \"I've tried Notion and it never stuck.\"",
        "Assumes Arjun prefers mobile-first. Assumes late-night study preference is consistent. HYPOTHESIS only.",
        "SIMULATED"],
    },
    {
      sql: "INSERT OR IGNORE INTO personas (id, project_id, name, segment, context, jobs, pains, goals, behaviors, constraints, objections, assumptions, provenance) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      args: ["persona-02", "proj-study-planner", "Priya Nair", "Self-Disciplined Commerce Student (No Backlogs, Targeting 80%+)",
        "B.Com 2nd Year, Christ University, Bengaluru. No backlogs. Preparing for CA Foundation alongside. Uses multiple apps already.",
        "Score above 80% across all subjects. Maintain her CA Foundation prep without falling behind on B.Com. Keep stress levels manageable.",
        "Current tools don't integrate B.Com timetable and CA prep. Every Sunday she rebuilds her weekly schedule from scratch. Feels overwhelmed by CA syllabus density.",
        "One app that holds both academic tracks. Automatic warnings when CA prep time drops below a weekly minimum.",
        "Highly organized. Uses Notion, Google Calendar, and a physical diary. Wakes at 6am. Studies 2 blocks — 7-9am and 8-11pm.",
        "Parents may buy a ₹99/month tool if it shows visible ROI (better marks). Privacy-conscious — doesn't want study data on cloud.",
        "\"Why would I replace a system that already works for me?\" \"What happens to my data if I stop subscribing?\"",
        "Assumes dual-track use case is relevant. Assumes privacy concern drives local-first preference. HYPOTHESIS only.",
        "SIMULATED"],
    },
    // Interviews (2 items)
    {
      sql: "INSERT OR IGNORE INTO interviews (id, project_id, persona_id, scenario, provenance, model, prompt_version) VALUES (?,?,?,?,?,?,?)",
      args: ["interview-01", "proj-study-planner", "persona-01", "Founder cold-DMs Arjun on Instagram after he posts about exam stress. They do a 15-minute casual voice call.", "SIMULATED", "qwen2.5:3b (Target — not yet running)", "v1-demo"],
    },
    {
      sql: "INSERT OR IGNORE INTO interviews (id, project_id, persona_id, scenario, provenance, model, prompt_version) VALUES (?,?,?,?,?,?,?)",
      args: ["interview-02", "proj-study-planner", "persona-02", "Founder meets Priya at a college fest booth. She agrees to a 10-minute structured conversation.", "SIMULATED", "qwen2.5:3b (Target — not yet running)", "v1-demo"],
    },
    // Turns (12 items)
    { sql: "INSERT OR IGNORE INTO turns (id, conversation_id, role, text, provenance) VALUES (?,?,?,?,?)", args: ["t-01-1", "interview-01", "user", "Hey Arjun, I saw your story about exam stress. Quick question — how do you manage your study schedule currently?", "SIMULATED"] },
    { sql: "INSERT OR IGNORE INTO turns (id, conversation_id, role, text, provenance) VALUES (?,?,?,?,?)", args: ["t-01-2", "interview-01", "assistant", "Bro honestly I just open my WhatsApp group and see what others are doing. I made a Notion template once but stopped after 3 days. It's too much work to update when you miss sessions.", "SIMULATED"] },
    { sql: "INSERT OR IGNORE INTO turns (id, conversation_id, role, text, provenance) VALUES (?,?,?,?,?)", args: ["t-01-3", "interview-01", "user", "If an app auto-rescheduled for you when you miss a session — no manual work — would that be useful?", "SIMULATED"] },
    { sql: "INSERT OR IGNORE INTO turns (id, conversation_id, role, text, provenance) VALUES (?,?,?,?,?)", args: ["t-01-4", "interview-01", "assistant", "Sounds good but I've heard that before. The problem is setup takes forever and by the time I figure it out, exams are here. If it took less than 2 minutes I'd try it.", "SIMULATED"] },
    { sql: "INSERT OR IGNORE INTO turns (id, conversation_id, role, text, provenance) VALUES (?,?,?,?,?)", args: ["t-01-5", "interview-01", "user", "Would you pay ₹99/month if it actually helped you stop cramming?", "SIMULATED"] },
    { sql: "INSERT OR IGNORE INTO turns (id, conversation_id, role, text, provenance) VALUES (?,?,?,?,?)", args: ["t-01-6", "interview-01", "assistant", "Hmm. I'm not sure. If it genuinely reduced my anxiety maybe. But I'd want to try it free first. I've paid for apps before and stopped using them after a week.", "SIMULATED"] },

    { sql: "INSERT OR IGNORE INTO turns (id, conversation_id, role, text, provenance) VALUES (?,?,?,?,?)", args: ["t-02-1", "interview-02", "user", "Priya, you seem very organized. What does your study planning system look like?", "SIMULATED"] },
    { sql: "INSERT OR IGNORE INTO turns (id, conversation_id, role, text, provenance) VALUES (?,?,?,?,?)", args: ["t-02-2", "interview-02", "assistant", "I have Google Calendar for lectures and a Notion page for CA prep. Every Sunday I sit and rebuild the week because things always shift. It takes me about 45 minutes which is annoying.", "SIMULATED"] },
    { sql: "INSERT OR IGNORE INTO turns (id, conversation_id, role, text, provenance) VALUES (?,?,?,?,?)", args: ["t-02-3", "interview-02", "user", "What if your CA prep and B.Com timetable were in one app that auto-rebuilt when things shifted?", "SIMULATED"] },
    { sql: "INSERT OR IGNORE INTO turns (id, conversation_id, role, text, provenance) VALUES (?,?,?,?,?)", args: ["t-02-4", "interview-02", "assistant", "That would save me so much time on Sundays. But I'd need to trust it. I've been burned by apps that sync in weird ways. And I don't want my study data on some cloud server.", "SIMULATED"] },
    { sql: "INSERT OR IGNORE INTO turns (id, conversation_id, role, text, provenance) VALUES (?,?,?,?,?)", args: ["t-02-5", "interview-02", "user", "Data stays on your device only. Would ₹99/month be reasonable?", "SIMULATED"] },
    { sql: "INSERT OR IGNORE INTO turns (id, conversation_id, role, text, provenance) VALUES (?,?,?,?,?)", args: ["t-02-6", "interview-02", "assistant", "If it genuinely works, my parents would pay for it if I showed them improved grades. But I'd need at least a month free trial to see real results.", "SIMULATED"] },

    // Insights (4 items)
    {
      sql: "INSERT OR IGNORE INTO insights (id, project_id, statement, type, confidence, evidence_for_ids, provenance) VALUES (?,?,?,?,?,?,?)",
      args: ["ins-01", "proj-study-planner", "The critical UX constraint is zero-configuration onboarding. Students will not invest more than 2 minutes in setup during exam season, regardless of promised benefits.", "theme", "High", JSON.stringify(["ev-02", "ev-04"]), "AI_INFERENCE"],
    },
    {
      sql: "INSERT OR IGNORE INTO insights (id, project_id, statement, type, confidence, evidence_for_ids, provenance) VALUES (?,?,?,?,?,?,?)",
      args: ["ins-02", "proj-study-planner", "Auto-reschedule when sessions are missed is the single differentiating feature worth testing. All other planner apps require manual updates — this is the stated abandonment trigger.", "theme", "High", JSON.stringify(["ev-01", "ev-02"]), "AI_INFERENCE"],
    },
    {
      sql: "INSERT OR IGNORE INTO insights (id, project_id, statement, type, confidence, evidence_for_ids, evidence_against_ids, caveat, provenance) VALUES (?,?,?,?,?,?,?,?,?)",
      args: ["ins-03", "proj-study-planner", "Counter-signal: College-focused EdTech monetization is structurally weak. Students have very high price sensitivity and free alternatives dominate.", "contradiction", "High", JSON.stringify(["ev-03"]), JSON.stringify(["ev-04"]), "This contradicts the direct-subscription revenue model. Institutional licensing to colleges should be primary revenue path.", "AI_INFERENCE"],
    },
    {
      sql: "INSERT OR IGNORE INTO insights (id, project_id, statement, type, confidence, evidence_for_ids, caveat, provenance) VALUES (?,?,?,?,?,?,?,?)",
      args: ["ins-04", "proj-study-planner", "Open question: Is the actual job-to-be-done 'study more efficiently' or 'feel less anxious about exams'? These may require different product interventions.", "open_question", "Medium", JSON.stringify(["ev-01"]), "Needs real user interviews to resolve. Do not assume.", "AI_INFERENCE"],
    },
    // Assumptions / Risks (4 items)
    {
      sql: "INSERT OR IGNORE INTO assumptions (id, project_id, statement, category, impact, uncertainty, rationale, status, provenance) VALUES (?,?,?,?,?,?,?,?,?)",
      args: ["asm-01", "proj-study-planner", "Students will adopt a new tool during the exam season rather than before it.", "customer_behavior", "High", "Critical", "Simulated interviews suggest students are most motivated close to exams, but also most time-constrained. This paradox is unresolved.", "unvalidated", "AI_INFERENCE"],
    },
    {
      sql: "INSERT OR IGNORE INTO assumptions (id, project_id, statement, category, impact, uncertainty, rationale, status, evidence_ids, provenance) VALUES (?,?,?,?,?,?,?,?,?,?)",
      args: ["asm-02", "proj-study-planner", "Students will pay ₹99/month for a study planner app.", "business_model", "High", "Critical", "Counter-evidence (ev-03) suggests college EdTech monetization is structurally weak. Freemium or institutional licensing may be required.", "unvalidated", JSON.stringify(["ev-03"]), "AI_INFERENCE"],
    },
    {
      sql: "INSERT OR IGNORE INTO assumptions (id, project_id, statement, category, impact, uncertainty, rationale, status, provenance) VALUES (?,?,?,?,?,?,?,?,?)",
      args: ["asm-03", "proj-study-planner", "An auto-reschedule algorithm can produce schedules students trust and follow for 30+ days.", "technical", "High", "High", "No evidence yet that algorithmic schedules outperform self-made ones in terms of adherence. Core technical hypothesis.", "unvalidated", "AI_INFERENCE"],
    },
    {
      sql: "INSERT OR IGNORE INTO assumptions (id, project_id, statement, category, impact, uncertainty, rationale, status, provenance) VALUES (?,?,?,?,?,?,?,?,?)",
      args: ["asm-04", "proj-study-planner", "Peer referral via WhatsApp college groups will be sufficient for initial user acquisition.", "distribution", "Medium", "High", "No acquisition experiment run yet. Assumption based on observation that WhatsApp is the dominant communication channel in Indian college students.", "unvalidated", "AI_INFERENCE"],
    },
    // Experiments (2 items)
    {
      sql: "INSERT OR IGNORE INTO experiments (id, project_id, assumption_id, hypothesis, method, cohort, metric, threshold, duration, cost_estimate, decision_rules, status, provenance) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      args: ["exp-01", "proj-study-planner", "asm-01",
        "If we offer a zero-configuration WhatsApp-based concierge study planner (founder manually creates and sends a daily schedule to a WhatsApp group), then at least 30% of enrolled students will follow it for 7+ consecutive days before their exams.",
        "Manual concierge simulation (no code). Founder acts as the AI. Recruit 25 students via a college WhatsApp group 3 weeks before exams.",
        "25 B.Tech 3rd-year students, SRM Chennai, exam in 21 days",
        "% of students who check-in on WhatsApp as 'session done' for 7+ consecutive days",
        "≥ 30% 7-day adherence rate",
        "3 weeks (1 exam cycle)",
        "₹0 — founder time only",
        "≥30% → build lightweight MVP with auto-reschedule. <30% → pivot to anxiety-reduction angle and re-test.",
        "planned",
        "AI_INFERENCE"],
    },
    {
      sql: "INSERT OR IGNORE INTO experiments (id, project_id, assumption_id, hypothesis, method, cohort, metric, threshold, duration, cost_estimate, decision_rules, status, provenance) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      args: ["exp-02", "proj-study-planner", "asm-02",
        "If we show a landing page describing the auto-reschedule feature and ask for ₹99 pre-payment to join a 'beta waitlist', then at least 5% of visitors will pay.",
        "Landing page with Razorpay payment link. Drive 500 visitors from Instagram ads (₹3,000 ad spend) and WhatsApp group shares.",
        "500 Instagram/WhatsApp sourced visitors",
        "Conversion rate to ₹99 pre-payment",
        "≥ 5% conversion (25 paying users out of 500)",
        "2 weeks",
        "₹3,000 (ads) + ₹500 (landing page domain/hosting)",
        "≥5% → pursue D2C subscription model. <5% → pivot to B2B institutional licensing. Full refund if product not built.",
        "planned",
        "AI_INFERENCE"],
    },
    // MVP Features (7 items)
    {
      sql: "INSERT OR IGNORE INTO mvp_features (id, project_id, name, scope, priority, effort, experiment_ids, rationale, status, provenance) VALUES (?,?,?,?,?,?,?,?,?,?)",
      args: ["mvp-01", "proj-study-planner", "Exam Countdown Calendar", "Student enters exam dates → app shows days remaining per subject with auto-computed priority order.", "now", "Low", JSON.stringify(["exp-01"]), "Zero-friction hook that shows immediate value. Creates urgency without requiring full schedule setup.", "candidate", "AI_INFERENCE"],
    },
    {
      sql: "INSERT OR IGNORE INTO mvp_features (id, project_id, name, scope, priority, effort, experiment_ids, rationale, status, provenance) VALUES (?,?,?,?,?,?,?,?,?,?)",
      args: ["mvp-02", "proj-study-planner", "Auto-Reschedule on Missed Session", "Student marks a session as missed → app redistributes remaining hours across remaining days, flags time deficits, and sends WhatsApp nudge.", "now", "Medium", JSON.stringify(["exp-01"]), "The primary differentiator. Directly addresses stated abandonment trigger. Core hypothesis to validate in Experiment 1.", "candidate", "AI_INFERENCE"],
    },
    {
      sql: "INSERT OR IGNORE INTO mvp_features (id, project_id, name, scope, priority, effort, rationale, status, provenance) VALUES (?,?,?,?,?,?,?,?,?)",
      args: ["mvp-03", "proj-study-planner", "Daily 3-Task Push Notification", "Each morning, sends a WhatsApp/notification with exactly 3 study tasks for the day. No more, no less.", "now", "Low", "Decision fatigue reduction. Students report paralysis from long to-do lists. 3-task constraint is psychologically manageable.", "candidate", "AI_INFERENCE"],
    },
    {
      sql: "INSERT OR IGNORE INTO mvp_features (id, project_id, name, scope, priority, effort, rationale, status, provenance) VALUES (?,?,?,?,?,?,?,?,?)",
      args: ["mvp-04", "proj-study-planner", "Syllabus Photo Upload (OCR Parsing)", "Student photographs syllabus sheet → OCR extracts topics → topics loaded as study blocks.", "later", "High", "High demand signal from simulated interviews but technically complex. Defer until core adherence loop is validated.", "candidate", "AI_INFERENCE"],
    },
    {
      sql: "INSERT OR IGNORE INTO mvp_features (id, project_id, name, scope, priority, effort, rationale, status, provenance) VALUES (?,?,?,?,?,?,?,?,?)",
      args: ["mvp-05", "proj-study-planner", "Peer Accountability Groups", "2-5 students share progress on a shared dashboard. Peer visibility as motivation layer.", "later", "High", "WhatsApp study group behavior suggests peer accountability is a strong motivator, but adds social complexity. Phase 2 feature.", "candidate", "AI_INFERENCE"],
    },
    {
      sql: "INSERT OR IGNORE INTO mvp_features (id, project_id, name, scope, priority, effort, rationale, status, provenance) VALUES (?,?,?,?,?,?,?,?,?)",
      args: ["mvp-06", "proj-study-planner", "CA Foundation / Dual-Track Mode", "Separate simultaneous study track for competitive exam prep alongside college coursework.", "later", "Medium", "Validated by Priya persona scenario (dual-track user). But serves a different segment. Defer until primary segment validated.", "candidate", "AI_INFERENCE"],
    },
    {
      sql: "INSERT OR IGNORE INTO mvp_features (id, project_id, name, scope, priority, effort, experiment_ids, rationale, status, provenance) VALUES (?,?,?,?,?,?,?,?,?,?)",
      args: ["mvp-07", "proj-study-planner", "Institutional College Licensing Dashboard", "College admin view: aggregate student progress, batch scheduling, exam schedule import.", "omit", "High", JSON.stringify(["exp-02"]), "Required for B2B revenue model, but premature until D2C vs B2B pivot decision is made post-Experiment 2.", "candidate", "AI_INFERENCE"],
    },
    // Report Snapshot (1 item)
    {
      sql: "INSERT OR IGNORE INTO report_snapshots (id, project_id, run_id, content, provenance_manifest, contains_simulated, contains_sample, version, generated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      args: ["report-snap-001", "proj-study-planner", "demo-run-001",
        JSON.stringify({
          title: "Founder Validation Report — AI Adaptive Study Planner",
          executiveSummary: "AI Adaptive Study Planner targets Indian undergraduate students who abandon exam prep tools due to setup friction and inability to recover from missed sessions. The core hypothesis is that auto-reschedule-on-miss reduces abandonment by 3×.",
          recommendation: "PROCEED TO EXPERIMENTS — Do not write application code before completing both planned experiments.",
        }),
        JSON.stringify({ USER_INPUT: 1, SAMPLE: 4, AI_INFERENCE: 8, SIMULATED: 4, REAL_SOURCE: 0, REAL_EXPERIMENT_RESULT: 0 }),
        1, 1, 1, "2026-10-24T01:04:30Z"],
    },
  ];

  await db.batch(batch);
}

// ── Utility: validate provenance ──────────────────────────────────

export function isValidProvenance(v: string): v is DbProvenance {
  return (PROVENANCE_ENUM as readonly string[]).includes(v);
}

// ── Utility: NOW() UTC ────────────────────────────────────────────

export function nowUtc(): string {
  return new Date().toISOString().replace("T", "T").split(".")[0] + "Z";
}

export async function reseedDemoFixtures(): Promise<void> {
  const db = getDb();
  await seedDemoData(db);
}
