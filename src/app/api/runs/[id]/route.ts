import { NextRequest } from "next/server";
import { initDb, getDb } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { reconcileProjectStages } from "@/lib/stageReconciliation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/runs/[id] — Fetch run details and stage progression
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    await initDb();
    const { id } = await params;
    const db = getDb();

    // 1. Fetch Run
    const runRes = await db.execute({
      sql: `
        SELECT r.*, p.title as project_title, p.mode as project_mode
        FROM runs r
        JOIN projects p ON p.id = r.project_id
        WHERE r.id = ?
      `,
      args: [id],
    });

    if (runRes.rows.length === 0) {
      return apiError("RUN_NOT_FOUND", `Run '${id}' not found.`, 404);
    }
    const initialRun = runRes.rows[0];

    // Reconcile stage and run progression with real SQLite data (Phase 3J)
    await reconcileProjectStages(initialRun.project_id as string);

    // Re-fetch Run to get updated status and timestamps
    const updatedRunRes = await db.execute({
      sql: `
        SELECT r.*, p.title as project_title, p.mode as project_mode
        FROM runs r
        JOIN projects p ON p.id = r.project_id
        WHERE r.id = ?
      `,
      args: [id],
    });
    const run = updatedRunRes.rows[0] || initialRun;

    // 2. Fetch Stages
    const stagesRes = await db.execute({
      sql: "SELECT * FROM stages WHERE run_id = ? ORDER BY id ASC",
      args: [id],
    });

    // Parse output_json if present
    const stages = stagesRes.rows.map((row: any) => {
      let parsedOutput = null;
      if (row.output_json) {
        try {
          parsedOutput = JSON.parse(row.output_json as string);
        } catch {
          parsedOutput = row.output_json;
        }
      }
      return {
        ...row,
        output: parsedOutput,
      };
    });

    return apiSuccess({
      run,
      stages,
    });
  } catch (err: any) {
    console.error("GET /api/runs/[id] error:", err);
    return apiError("QUERY_FAILED", err.message, 500);
  }
}
