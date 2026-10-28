import { NextRequest } from "next/server";
import { initDb, getDb, nowUtc } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { delegateToFastAPI } from "@/lib/fastapiProxy";
import { reconcileProjectStages } from "@/lib/stageReconciliation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const VALID_STATUS = ["planned", "running", "completed", "abandoned"] as const;
type ExperimentStatus = typeof VALID_STATUS[number];

/**
 * ROLLBACK PATH: Original TypeScript SQLite GET implementation.
 * To rollback Slice 1AB delegation back to direct TypeScript execution:
 * Replace `return await delegateToFastAPI(...)` in GET with `return await getExperimentsFromDb(id);`
 */
export async function getExperimentsFromDb(id: string) {
  await initDb();
  const db = getDb();

  const res = await db.execute({
    sql: `SELECT e.*, a.statement as assumption_statement, a.uncertainty as assumption_uncertainty, a.impact as assumption_impact
          FROM experiments e
          LEFT JOIN assumptions a ON e.assumption_id = a.id
          WHERE e.project_id = ?
          ORDER BY e.created_at ASC`,
    args: [id],
  });

  const statusCounts: Record<string, number> = {};
  for (const r of res.rows as any[]) {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
  }

  return apiSuccess({
    projectId: id,
    experiments: res.rows,
    totalCount: res.rows.length,
    statusCounts,
  });
}

// ─── GET /api/projects/[id]/experiments ─────────────────────────────────────
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    return await delegateToFastAPI(req, `/api/projects/${encodeURIComponent(id)}/experiments`);
  } catch (err: unknown) {
    console.error("GET /api/projects/[id]/experiments proxy error:", err);
    return apiError("INTERNAL_ERROR", "Failed to retrieve project experiments.", 500);
  }
}

// ─── POST /api/projects/[id]/experiments ────────────────────────────────────
// Body: { hypothesis, method, metric, threshold, assumptionId?, cohort?, duration?, cost_estimate?, decision_rules? }
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    await initDb();
    const { id } = await params;
    const db = getDb();

    const projRes = await db.execute({ sql: "SELECT id FROM projects WHERE id = ?", args: [id] });
    if (projRes.rows.length === 0) return apiError("PROJECT_NOT_FOUND", `Project '${id}' not found.`, 404);

    const body = await req.json().catch(() => ({}));
    const hypothesis: string = typeof body.hypothesis === "string" ? body.hypothesis.trim() : "";
    const method: string = typeof body.method === "string" ? body.method.trim() : "";
    const metric: string = typeof body.metric === "string" ? body.metric.trim() : "";
    const rawThreshold = body.threshold ?? body.target_threshold;
    const threshold: string = typeof rawThreshold === "string" ? rawThreshold.trim() : "";

    if (!hypothesis) return apiError("VALIDATION_FAILED", "hypothesis is required.", 400);
    if (!method) return apiError("VALIDATION_FAILED", "method is required.", 400);
    if (!metric) return apiError("VALIDATION_FAILED", "metric is required.", 400);
    if (!threshold) return apiError("VALIDATION_FAILED", "threshold is required.", 400);

    const rawAssumptionId = body.assumptionId ?? body.assumption_id;
    const assumptionId: string | null = typeof rawAssumptionId === "string" ? rawAssumptionId.trim() : null;
    const cohort: string = typeof body.cohort === "string" ? body.cohort.trim() : "";
    const duration: string = typeof body.duration === "string" ? body.duration.trim() : "";
    const costEstimate: string = typeof body.cost_estimate === "string" ? body.cost_estimate.trim() : "";
    const decisionRules: string = typeof body.decision_rules === "string" ? body.decision_rules.trim() :
      (typeof body.decision_rules === "object" ? JSON.stringify(body.decision_rules) : "");
    const status: string = typeof body.status === "string" ? body.status : "planned";

    if (!VALID_STATUS.includes(status as ExperimentStatus)) {
      return apiError("VALIDATION_FAILED", `status must be one of: ${VALID_STATUS.join(", ")}.`, 400);
    }

    // Validate assumptionId if provided
    if (assumptionId) {
      const asmCheck = await db.execute({ sql: "SELECT id FROM assumptions WHERE id = ? AND project_id = ?", args: [assumptionId, id] });
      if (asmCheck.rows.length === 0) {
        return apiError("VALIDATION_FAILED", `assumptionId '${assumptionId}' not found in this project.`, 400);
      }
    }

    const now = nowUtc();
    const expId = `exp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    await db.execute({
      sql: `INSERT INTO experiments
              (id, project_id, assumption_id, hypothesis, method, cohort, metric, threshold,
               duration, cost_estimate, decision_rules, status, provenance, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USER_INPUT', ?)`,
      args: [expId, id, assumptionId, hypothesis, method, cohort, metric, threshold,
             duration, costEstimate, decisionRules, status, now],
    });

    // Reconcile experiments stage (Phase 3J)
    await reconcileProjectStages(id);

    const created = await db.execute({
      sql: `SELECT e.*, a.statement as assumption_statement FROM experiments e
            LEFT JOIN assumptions a ON e.assumption_id = a.id
            WHERE e.id = ?`,
      args: [expId],
    });

    return apiSuccess({ experiment: created.rows[0] }, "USER_INPUT", 201);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("POST /api/projects/[id]/experiments error:", msg);
    return apiError("DB_INSERT_FAILED", msg, 500);
  }
}

// ─── PATCH /api/projects/[id]/experiments ────────────────────────────────────
// Body: { id, status?, result?, hypothesis?, method?, metric?, threshold?, decision_rules? }
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    await initDb();
    const { id } = await params;
    const db = getDb();

    const body = await req.json().catch(() => ({}));
    const expId: string = typeof body.id === "string" ? body.id.trim() : "";
    if (!expId) return apiError("VALIDATION_FAILED", "id is required.", 400);

    const check = await db.execute({
      sql: "SELECT id, status FROM experiments WHERE id = ? AND project_id = ?",
      args: [expId, id],
    });
    if (check.rows.length === 0) return apiError("NOT_FOUND", `Experiment '${expId}' not found.`, 404);

    const updates: string[] = [];
    const args: any[] = [];

    if (typeof body.status === "string") {
      if (!VALID_STATUS.includes(body.status as ExperimentStatus)) {
        return apiError("VALIDATION_FAILED", `status must be one of: ${VALID_STATUS.join(", ")}.`, 400);
      }
      updates.push("status = ?");
      args.push(body.status);
    }
    if (typeof body.result === "string") { updates.push("result = ?"); args.push(body.result.trim()); }
    if (typeof body.hypothesis === "string" && body.hypothesis.trim()) { updates.push("hypothesis = ?"); args.push(body.hypothesis.trim()); }
    if (typeof body.method === "string" && body.method.trim()) { updates.push("method = ?"); args.push(body.method.trim()); }
    if (typeof body.metric === "string" && body.metric.trim()) { updates.push("metric = ?"); args.push(body.metric.trim()); }
    if (typeof body.threshold === "string" && body.threshold.trim()) { updates.push("threshold = ?"); args.push(body.threshold.trim()); }
    if (typeof body.decision_rules === "string") { updates.push("decision_rules = ?"); args.push(body.decision_rules.trim()); }
    if (typeof body.cohort === "string") { updates.push("cohort = ?"); args.push(body.cohort.trim()); }

    if (updates.length === 0) return apiError("VALIDATION_FAILED", "No updatable fields provided.", 400);

    // Provenance becomes REAL_EXPERIMENT_RESULT when completed with a result
    if (body.status === "completed" && body.result) {
      updates.push("provenance = ?");
      args.push("REAL_EXPERIMENT_RESULT");
    }

    args.push(expId);
    await db.execute({ sql: `UPDATE experiments SET ${updates.join(", ")} WHERE id = ?`, args });

    // Reconcile experiments stage (Phase 3J)
    await reconcileProjectStages(id);

    const updated = await db.execute({
      sql: `SELECT e.*, a.statement as assumption_statement FROM experiments e
            LEFT JOIN assumptions a ON e.assumption_id = a.id
            WHERE e.id = ?`,
      args: [expId],
    });
    return apiSuccess({ experiment: updated.rows[0] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("PATCH /api/projects/[id]/experiments error:", msg);
    return apiError("DB_UPDATE_FAILED", msg, 500);
  }
}

// ─── DELETE /api/projects/[id]/experiments ───────────────────────────────────
// Query: ?experimentId=xxx
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    await initDb();
    const { id } = await params;
    const db = getDb();

    const { searchParams } = new URL(req.url);
    const expId = searchParams.get("experimentId") || "";
    if (!expId) return apiError("VALIDATION_FAILED", "experimentId query parameter is required.", 400);

    const check = await db.execute({
      sql: "SELECT id FROM experiments WHERE id = ? AND project_id = ?",
      args: [expId, id],
    });
    if (check.rows.length === 0) return apiError("NOT_FOUND", `Experiment '${expId}' not found.`, 404);

    await db.execute({ sql: "DELETE FROM experiments WHERE id = ? AND project_id = ?", args: [expId, id] });

    // Reconcile experiments stage (Phase 3J)
    await reconcileProjectStages(id);
    return apiSuccess({ deleted: expId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("DELETE /api/projects/[id]/experiments error:", msg);
    return apiError("DB_DELETE_FAILED", msg, 500);
  }
}
