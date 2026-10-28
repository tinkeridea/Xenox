import { NextRequest } from "next/server";
import { initDb, getDb, nowUtc } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { delegateToFastAPI } from "@/lib/fastapiProxy";
import { reconcileProjectStages } from "@/lib/stageReconciliation";
import { isPresentationDemoMode, presentationReadOnlyResponse } from "@/lib/presentationMode";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * ROLLBACK PATH: Original TypeScript SQLite GET implementation.
 * To rollback Slice 1V delegation back to direct TypeScript execution:
 * Replace `return await delegateToFastAPI(...)` in GET with `return getProjectFromDb(id);`
 */
export async function getProjectFromDb(id: string) {
  await initDb();
  const db = getDb();

  // 1. Project
  const projRes = await db.execute({
    sql: "SELECT * FROM projects WHERE id = ?",
    args: [id],
  });

  if (projRes.rows.length === 0) {
    return apiError("PROJECT_NOT_FOUND", `Project '${id}' not found.`, 404);
  }
  const project = projRes.rows[0];

  // 2. Latest Brief
  const briefRes = await db.execute({
    sql: "SELECT * FROM idea_briefs WHERE project_id = ? ORDER BY version DESC LIMIT 1",
    args: [id],
  });
  const brief = briefRes.rows[0] || null;

  // 3. Runs
  const runsRes = await db.execute({
    sql: "SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC",
    args: [id],
  });

  // 4. Counts
  const countsRes = await db.execute({
    sql: `
      SELECT 
        (SELECT COUNT(*) FROM evidence WHERE project_id = ?) as evidence_count,
        (SELECT COUNT(*) FROM sources WHERE project_id = ?) as source_count,
        (SELECT COUNT(*) FROM competitors WHERE project_id = ?) as competitor_count,
        (SELECT COUNT(*) FROM personas WHERE project_id = ?) as persona_count,
        (SELECT COUNT(*) FROM interviews WHERE project_id = ?) as interview_count,
        (SELECT COUNT(*) FROM insights WHERE project_id = ?) as insight_count,
        (SELECT COUNT(*) FROM assumptions WHERE project_id = ?) as assumption_count,
        (SELECT COUNT(*) FROM experiments WHERE project_id = ?) as experiment_count,
        (SELECT COUNT(*) FROM mvp_features WHERE project_id = ?) as mvp_count
    `,
    args: [id, id, id, id, id, id, id, id, id],
  });

  return apiSuccess({
    project,
    brief,
    runs: runsRes.rows,
    counts: countsRes.rows[0] || {},
  });
}

// GET /api/projects/[id] — Fetch project overview (Delegated to FastAPI via Slice 1V)
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    return await delegateToFastAPI(req, `/api/projects/${encodeURIComponent(id)}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("GET /api/projects/[id] error:", msg);
    return apiError("INTERNAL_ERROR", "Failed to retrieve project details.", 500);
  }
}

// PATCH /api/projects/[id]
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  if (isPresentationDemoMode()) {
    return presentationReadOnlyResponse();
  }

  try {
    await initDb();
    const { id } = await params;
    const db = getDb();

    // Verify project exists
    const projCheck = await db.execute({
      sql: "SELECT id FROM projects WHERE id = ?",
      args: [id],
    });
    if (projCheck.rows.length === 0) {
      return apiError("PROJECT_NOT_FOUND", `Project '${id}' not found.`, 404);
    }

    const body = await req.json().catch(() => ({}));
    const {
      title,
      status,
      mode,
      problem,
      target_customer,
      targetCustomer,
      solution,
      geography,
      category,
      stage,
    } = body;

    const updates: string[] = [];
    const args: any[] = [];

    if (title && typeof title === "string") {
      updates.push("title = ?");
      args.push(title.trim());
    }
    if (status && ["draft", "active", "archived"].includes(status)) {
      updates.push("status = ?");
      args.push(status);
    }
    if (mode && ["DEMO", "LIVE", "MIXED"].includes(mode)) {
      updates.push("mode = ?");
      args.push(mode);
    }

    // Brief fields
    const resolvedTargetCustomer = target_customer || targetCustomer;
    const briefUpdates: string[] = [];
    const briefArgs: any[] = [];

    if (typeof problem === "string" && problem.trim()) {
      briefUpdates.push("problem = ?");
      briefArgs.push(problem.trim());
    }
    if (typeof resolvedTargetCustomer === "string" && resolvedTargetCustomer.trim()) {
      briefUpdates.push("target_customer = ?");
      briefArgs.push(resolvedTargetCustomer.trim());
    }
    if (typeof solution === "string") {
      briefUpdates.push("solution = ?");
      briefArgs.push(solution.trim());
    }
    if (typeof geography === "string") {
      briefUpdates.push("geography = ?");
      briefArgs.push(geography.trim());
    }
    if (typeof category === "string") {
      briefUpdates.push("category = ?");
      briefArgs.push(category.trim());
    }
    if (typeof stage === "string") {
      briefUpdates.push("stage = ?");
      briefArgs.push(stage.trim());
    }

    if (updates.length === 0 && briefUpdates.length === 0) {
      return apiError("NO_FIELDS_TO_UPDATE", "No valid update fields provided.");
    }

    // Update projects table if project fields provided
    if (updates.length > 0) {
      updates.push("updated_at = ?");
      args.push(nowUtc());
      args.push(id);
      await db.execute({
        sql: `UPDATE projects SET ${updates.join(", ")} WHERE id = ?`,
        args,
      });
    }

    // Update latest idea_brief if brief fields provided
    if (briefUpdates.length > 0) {
      const latestBrief = await db.execute({
        sql: "SELECT id FROM idea_briefs WHERE project_id = ? ORDER BY version DESC LIMIT 1",
        args: [id],
      });
      if (latestBrief.rows.length > 0) {
        briefArgs.push(latestBrief.rows[0].id);
        await db.execute({
          sql: `UPDATE idea_briefs SET ${briefUpdates.join(", ")} WHERE id = ?`,
          args: briefArgs,
        });
      }
    }

    // Reconcile stage progression with updated project brief (Phase 3J)
    await reconcileProjectStages(id);

    return apiSuccess({ message: "Project updated successfully", id });
  } catch (err: any) {
    console.error("PATCH /api/projects/[id] error:", err);
    return apiError("UPDATE_FAILED", err.message, 500);
  }
}

// DELETE /api/projects/[id] — Cascade delete (Decision D08)
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  if (isPresentationDemoMode()) {
    return presentationReadOnlyResponse();
  }

  try {
    await initDb();
    const { id } = await params;
    const db = getDb();

    // Verify existence
    const check = await db.execute({
      sql: "SELECT id FROM projects WHERE id = ?",
      args: [id],
    });
    if (check.rows.length === 0) {
      return apiError("PROJECT_NOT_FOUND", `Project '${id}' not found.`, 404);
    }

    // Cascade delete across all tables
    const deleteBatch = [
      { sql: "DELETE FROM turns WHERE conversation_id IN (SELECT id FROM interviews WHERE project_id = ?)", args: [id] },
      { sql: "DELETE FROM stages WHERE run_id IN (SELECT id FROM runs WHERE project_id = ?)", args: [id] },
      { sql: "DELETE FROM report_snapshots WHERE project_id = ?", args: [id] },
      { sql: "DELETE FROM ai_jobs WHERE project_id = ?", args: [id] },
      { sql: "DELETE FROM mvp_features WHERE project_id = ?", args: [id] },
      { sql: "DELETE FROM experiments WHERE project_id = ?", args: [id] },
      { sql: "DELETE FROM assumptions WHERE project_id = ?", args: [id] },
      { sql: "DELETE FROM insights WHERE project_id = ?", args: [id] },
      { sql: "DELETE FROM interviews WHERE project_id = ?", args: [id] },
      { sql: "DELETE FROM personas WHERE project_id = ?", args: [id] },
      { sql: "DELETE FROM competitors WHERE project_id = ?", args: [id] },
      { sql: "DELETE FROM evidence WHERE project_id = ?", args: [id] },
      { sql: "DELETE FROM sources WHERE project_id = ?", args: [id] },
      { sql: "DELETE FROM runs WHERE project_id = ?", args: [id] },
      { sql: "DELETE FROM idea_briefs WHERE project_id = ?", args: [id] },
      { sql: "DELETE FROM projects WHERE id = ?", args: [id] },
    ];

    await db.batch(deleteBatch);

    return apiSuccess({
      deleted: true,
      projectId: id,
      message: `Project '${id}' and all associated runs, briefs, and artifacts were permanently deleted (per Decision D08).`,
    });
  } catch (err: any) {
    console.error("DELETE /api/projects/[id] error:", err);
    return apiError("DELETE_FAILED", err.message, 500);
  }
}
