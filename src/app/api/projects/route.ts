import { NextRequest } from "next/server";
import { initDb, getDb, nowUtc, isValidProvenance } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { delegateToFastAPI } from "@/lib/fastapiProxy";
import { v4 as uuidv4 } from "uuid";

/**
 * ROLLBACK PATH: Original TypeScript SQLite GET implementation.
 * To rollback Slice 1X delegation back to direct TypeScript execution:
 * Replace `return await delegateToFastAPI(...)` in GET with `return getProjectsFromDb();`
 */
export async function getProjectsFromDb() {
  await initDb();
  const db = getDb();

  const query = `
    SELECT 
      p.id,
      p.title,
      p.mode,
      p.status,
      p.created_at,
      p.updated_at,
      b.problem,
      b.target_customer,
      b.solution,
      b.category,
      b.stage as idea_stage,
      b.geography,
      (SELECT r.id FROM runs r WHERE r.project_id = p.id ORDER BY r.created_at DESC LIMIT 1) as latest_run_id,
      (SELECT r.status FROM runs r WHERE r.project_id = p.id ORDER BY r.created_at DESC LIMIT 1) as latest_run_status
    FROM projects p
    LEFT JOIN idea_briefs b ON b.project_id = p.id AND b.version = (
      SELECT MAX(version) FROM idea_briefs WHERE project_id = p.id
    )
    ORDER BY p.updated_at DESC
  `;

  const res = await db.execute(query);
  return apiSuccess(res.rows, "MIXED");
}

// GET /api/projects — List all projects with brief summary & latest run (Delegated to FastAPI via Slice 1X)
export async function GET(req: NextRequest) {
  try {
    return await delegateToFastAPI(req, "/api/projects");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("GET /api/projects error:", msg);
    return apiError("INTERNAL_ERROR", "Failed to retrieve projects.", 500);
  }
}

// POST /api/projects — Create project + versioned IdeaBrief
export async function POST(req: NextRequest) {
  try {
    await initDb();
    const db = getDb();

    const body = await req.json();
    const {
      title,
      problem,
      target_customer,
      solution,
      geography = "",
      category = "",
      alternatives = "",
      stage = "Idea",
      constraints = "",
      goals = "",
      mode = "LIVE",
      provenance = "USER_INPUT",
    } = body;

    // Strict validation
    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return apiError("VALIDATION_ERROR", "Field 'title' is required.");
    }
    if (!problem || typeof problem !== "string" || problem.trim().length === 0) {
      return apiError("VALIDATION_ERROR", "Field 'problem' is required.");
    }
    if (!target_customer || typeof target_customer !== "string" || target_customer.trim().length === 0) {
      return apiError("VALIDATION_ERROR", "Field 'target_customer' is required.");
    }
    if (!solution || typeof solution !== "string" || solution.trim().length === 0) {
      return apiError("VALIDATION_ERROR", "Field 'solution' is required.");
    }
    if (provenance && !isValidProvenance(provenance)) {
      return apiError("INVALID_PROVENANCE", `Provenance '${provenance}' is invalid.`);
    }

    const projectId = `proj-${uuidv4().slice(0, 8)}`;
    const briefId = `brief-${uuidv4().slice(0, 8)}`;
    const runId = `run-${uuidv4().slice(0, 8)}`;
    const timestamp = nowUtc();

    // 10 pipeline stages
    const stageKeys = [
      "research",
      "competitors",
      "icp",
      "personas",
      "interviews",
      "insights",
      "risks",
      "experiments",
      "mvp",
      "report",
    ];

    const batch = [
      // 1. Project
      {
        sql: "INSERT INTO projects (id, title, mode, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        args: [projectId, title.trim(), mode, "active", timestamp, timestamp],
      },
      // 2. Brief
      {
        sql: `INSERT INTO idea_briefs (
          id, project_id, version, problem, target_customer, solution, 
          geography, category, alternatives, stage, constraints, goals, provenance, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          briefId,
          projectId,
          1,
          problem.trim(),
          target_customer.trim(),
          solution.trim(),
          geography.trim(),
          category.trim(),
          alternatives.trim(),
          stage,
          constraints.trim(),
          goals.trim(),
          provenance,
          timestamp,
        ],
      },
      // 3. Initial Run
      {
        sql: `INSERT INTO runs (id, project_id, status, mode, prompt_version, started_at, created_at)
              VALUES (?, ?, 'queued', ?, 'phase2-v1', ?, ?)`,
        args: [runId, projectId, mode, timestamp, timestamp],
      },
      // 4. Initial 10 Stages
      ...stageKeys.map((stageKey) => ({
        sql: `INSERT INTO stages (id, run_id, stage_key, status, attempt) VALUES (?, ?, ?, 'queued', 1)`,
        args: [`stg-${uuidv4().slice(0, 8)}`, runId, stageKey],
      })),
    ];

    await db.batch(batch);

    return apiSuccess(
      {
        projectId,
        briefId,
        runId,
        title: title.trim(),
        mode,
        status: "active",
        created_at: timestamp,
      },
      provenance,
      201
    );
  } catch (err: any) {
    console.error("POST /api/projects error:", err);
    return apiError("CREATE_PROJECT_FAILED", err.message || "Failed to create project", 500);
  }
}
