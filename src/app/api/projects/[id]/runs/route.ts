import { NextRequest } from "next/server";
import { initDb, getDb, nowUtc } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { v4 as uuidv4 } from "uuid";
import { delegateToFastAPI } from "@/lib/fastapiProxy";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * ROLLBACK PATH: Original TypeScript SQLite GET implementation.
 * To rollback Slice 1S delegation back to direct TypeScript execution:
 * Replace `return await delegateToFastAPI(...)` in GET with `return getRunsFromDb(id);`
 */
export async function getRunsFromDb(id: string) {
  await initDb();
  const db = getDb();

  const runsRes = await db.execute({
    sql: `
      SELECT r.*, 
        (SELECT COUNT(*) FROM stages s WHERE s.run_id = r.id AND s.status = 'completed') as completed_stages,
        (SELECT COUNT(*) FROM stages s WHERE s.run_id = r.id) as total_stages
      FROM runs r
      WHERE r.project_id = ?
      ORDER BY r.created_at DESC
    `,
    args: [id],
  });

  return apiSuccess(runsRes.rows);
}

// GET /api/projects/[id]/runs — List runs for a project (Delegated to FastAPI via Slice 1S)
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    return await delegateToFastAPI(req, `/api/projects/${encodeURIComponent(id)}/runs`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("GET /api/projects/[id]/runs error:", msg);
    return apiError("INTERNAL_ERROR", "Failed to retrieve project runs.", 500);
  }
}

// POST /api/projects/[id]/runs — Start workflow execution
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    await initDb();
    const { id } = await params;
    const db = getDb();

    // Verify project exists
    const projCheck = await db.execute({
      sql: "SELECT id, mode FROM projects WHERE id = ?",
      args: [id],
    });
    if (projCheck.rows.length === 0) {
      return apiError("PROJECT_NOT_FOUND", `Project '${id}' not found.`, 404);
    }

    const body = await req.json().catch(() => ({}));
    const mode = body.mode || (projCheck.rows[0].mode as string) || "DEMO";
    const requestedStages: string[] = body.stages && Array.isArray(body.stages) && body.stages.length > 0
      ? body.stages
      : [
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

    const runId = `run-${uuidv4().slice(0, 8)}`;
    const timestamp = nowUtc();

    const batch = [
      {
        sql: `INSERT INTO runs (id, project_id, status, mode, prompt_version, started_at, created_at)
              VALUES (?, ?, 'queued', ?, 'phase2-v1', ?, ?)`,
        args: [runId, id, mode, timestamp, timestamp],
      },
      ...requestedStages.map((stageKey) => ({
        sql: `INSERT INTO stages (id, run_id, stage_key, status, attempt) VALUES (?, ?, ?, 'queued', 1)`,
        args: [`stg-${uuidv4().slice(0, 8)}`, runId, stageKey],
      })),
    ];

    await db.batch(batch);

    return apiSuccess(
      {
        runId,
        projectId: id,
        status: "queued",
        mode,
        stages: requestedStages,
        started_at: timestamp,
      },
      mode === "DEMO" ? "SAMPLE" : "AI_INFERENCE",
      201
    );
  } catch (err: any) {
    console.error("POST /api/projects/[id]/runs error:", err);
    return apiError("CREATE_RUN_FAILED", err.message, 500);
  }
}
