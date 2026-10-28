import { NextRequest } from "next/server";
import { initDb, getDb, nowUtc } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { delegateToFastAPI } from "@/lib/fastapiProxy";
import { reconcileProjectStages } from "@/lib/stageReconciliation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const VALID_IMPACT = ["High", "Medium", "Low"] as const;
const VALID_UNCERTAINTY = ["Critical", "High", "Medium", "Low"] as const;
const VALID_STATUS = ["unvalidated", "testing", "validated", "invalidated"] as const;

type AssumptionStatus = typeof VALID_STATUS[number];

const UNCERTAINTY_SCORE: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };
const IMPACT_SCORE: Record<string, number> = { High: 3, Medium: 2, Low: 1 };

function calcPriorityScore(uncertainty: string, impact: string): number {
  return (UNCERTAINTY_SCORE[uncertainty] || 1) * (IMPACT_SCORE[impact] || 1);
}

/**
 * ROLLBACK PATH: Original TypeScript SQLite GET implementation.
 * To rollback Slice 1AA delegation back to direct TypeScript execution:
 * Replace `return await delegateToFastAPI(...)` in GET with `return await getAssumptionsFromDb(id);`
 */
export async function getAssumptionsFromDb(id: string) {
  await initDb();
  const db = getDb();

  const res = await db.execute({
    sql: "SELECT * FROM assumptions WHERE project_id = ? ORDER BY uncertainty DESC, impact DESC",
    args: [id],
  });

  const assumptions = (res.rows as any[]).map((row) => ({
    ...row,
    evidence_ids: row.evidence_ids ? JSON.parse(row.evidence_ids) : [],
    priority_score: calcPriorityScore(row.uncertainty, row.impact),
  }));

  // Count by status for matrix summary
  const statusCounts: Record<string, number> = {};
  for (const a of assumptions) {
    statusCounts[a.status] = (statusCounts[a.status] || 0) + 1;
  }

  return apiSuccess({
    projectId: id,
    assumptions,
    totalCount: assumptions.length,
    statusCounts,
  });
}

// ─── GET /api/projects/[id]/assumptions ─────────────────────────────────────
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    return await delegateToFastAPI(req, `/api/projects/${encodeURIComponent(id)}/assumptions`);
  } catch (err: unknown) {
    console.error("GET /api/projects/[id]/assumptions proxy error:", err);
    return apiError("INTERNAL_ERROR", "Failed to retrieve project assumptions.", 500);
  }
}

// ─── POST /api/projects/[id]/assumptions ────────────────────────────────────
// Body: { statement, category?, impact?, uncertainty?, rationale?, status?, evidence_ids? }
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    await initDb();
    const { id } = await params;
    const db = getDb();

    const projRes = await db.execute({ sql: "SELECT id FROM projects WHERE id = ?", args: [id] });
    if (projRes.rows.length === 0) return apiError("PROJECT_NOT_FOUND", `Project '${id}' not found.`, 404);

    const body = await req.json().catch(() => ({}));
    const statement: string = typeof body.statement === "string" ? body.statement.trim() : "";
    if (!statement) return apiError("VALIDATION_FAILED", "statement is required.", 400);

    const category: string = typeof body.category === "string" ? body.category.trim() : "business_model";
    const impact: string = typeof body.impact === "string" ? body.impact : "Medium";
    const uncertainty: string = typeof body.uncertainty === "string" ? body.uncertainty : "High";
    const rationale: string = typeof body.rationale === "string" ? body.rationale.trim() : "";
    const status: string = typeof body.status === "string" ? body.status : "unvalidated";
    const evidenceIds = Array.isArray(body.evidence_ids) ? body.evidence_ids : [];

    if (!VALID_IMPACT.includes(impact as typeof VALID_IMPACT[number])) {
      return apiError("VALIDATION_FAILED", `impact must be one of: ${VALID_IMPACT.join(", ")}.`, 400);
    }
    if (!VALID_UNCERTAINTY.includes(uncertainty as typeof VALID_UNCERTAINTY[number])) {
      return apiError("VALIDATION_FAILED", `uncertainty must be one of: ${VALID_UNCERTAINTY.join(", ")}.`, 400);
    }
    if (!VALID_STATUS.includes(status as AssumptionStatus)) {
      return apiError("VALIDATION_FAILED", `status must be one of: ${VALID_STATUS.join(", ")}.`, 400);
    }

    const now = nowUtc();
    const asmId = `asm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    await db.execute({
      sql: `INSERT INTO assumptions
              (id, project_id, statement, category, impact, uncertainty, rationale, status, evidence_ids, provenance, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'USER_INPUT', ?)`,
      args: [asmId, id, statement, category, impact, uncertainty, rationale, status,
             JSON.stringify(evidenceIds), now],
    });

    // Reconcile risks stage (Phase 3J)
    await reconcileProjectStages(id);

    const created = await db.execute({ sql: "SELECT * FROM assumptions WHERE id = ?", args: [asmId] });
    const row = created.rows[0] as any;

    return apiSuccess({
      assumption: {
        ...row,
        evidence_ids: row.evidence_ids ? JSON.parse(row.evidence_ids) : [],
        priority_score: calcPriorityScore(row.uncertainty, row.impact),
      },
    }, "USER_INPUT", 201);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("POST /api/projects/[id]/assumptions error:", msg);
    return apiError("DB_INSERT_FAILED", msg, 500);
  }
}

// ─── PATCH /api/projects/[id]/assumptions ───────────────────────────────────
// Body: { id, status?, statement?, rationale?, impact?, uncertainty?, evidence_ids? }
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    await initDb();
    const { id } = await params;
    const db = getDb();

    const body = await req.json().catch(() => ({}));
    const asmId: string = typeof body.id === "string" ? body.id.trim() : "";
    if (!asmId) return apiError("VALIDATION_FAILED", "id is required.", 400);

    const check = await db.execute({
      sql: "SELECT id, status FROM assumptions WHERE id = ? AND project_id = ?",
      args: [asmId, id],
    });
    if (check.rows.length === 0) return apiError("NOT_FOUND", `Assumption '${asmId}' not found.`, 404);

    const updates: string[] = [];
    const args: any[] = [];

    if (typeof body.status === "string") {
      if (!VALID_STATUS.includes(body.status as AssumptionStatus)) {
        return apiError("VALIDATION_FAILED", `status must be one of: ${VALID_STATUS.join(", ")}.`, 400);
      }
      updates.push("status = ?");
      args.push(body.status);
    }
    if (typeof body.statement === "string" && body.statement.trim()) {
      updates.push("statement = ?");
      args.push(body.statement.trim());
    }
    if (typeof body.rationale === "string") {
      updates.push("rationale = ?");
      args.push(body.rationale.trim());
    }
    if (typeof body.impact === "string") {
      if (!VALID_IMPACT.includes(body.impact as typeof VALID_IMPACT[number])) {
        return apiError("VALIDATION_FAILED", `impact must be one of: ${VALID_IMPACT.join(", ")}.`, 400);
      }
      updates.push("impact = ?");
      args.push(body.impact);
    }
    if (typeof body.uncertainty === "string") {
      if (!VALID_UNCERTAINTY.includes(body.uncertainty as typeof VALID_UNCERTAINTY[number])) {
        return apiError("VALIDATION_FAILED", `uncertainty must be one of: ${VALID_UNCERTAINTY.join(", ")}.`, 400);
      }
      updates.push("uncertainty = ?");
      args.push(body.uncertainty);
    }
    if (Array.isArray(body.evidence_ids)) {
      updates.push("evidence_ids = ?");
      args.push(JSON.stringify(body.evidence_ids));
    }

    if (updates.length === 0) return apiError("VALIDATION_FAILED", "No updatable fields provided.", 400);

    args.push(asmId);
    await db.execute({ sql: `UPDATE assumptions SET ${updates.join(", ")} WHERE id = ?`, args });

    // Reconcile risks stage (Phase 3J)
    await reconcileProjectStages(id);

    const updated = await db.execute({ sql: "SELECT * FROM assumptions WHERE id = ?", args: [asmId] });
    const row = updated.rows[0] as any;
    return apiSuccess({
      assumption: {
        ...row,
        evidence_ids: row.evidence_ids ? JSON.parse(row.evidence_ids) : [],
        priority_score: calcPriorityScore(row.uncertainty, row.impact),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("PATCH /api/projects/[id]/assumptions error:", msg);
    return apiError("DB_UPDATE_FAILED", msg, 500);
  }
}

// ─── DELETE /api/projects/[id]/assumptions ───────────────────────────────────
// Query: ?assumptionId=xxx
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    await initDb();
    const { id } = await params;
    const db = getDb();

    const { searchParams } = new URL(req.url);
    const asmId = searchParams.get("assumptionId") || "";
    if (!asmId) return apiError("VALIDATION_FAILED", "assumptionId query parameter is required.", 400);

    const check = await db.execute({
      sql: "SELECT id FROM assumptions WHERE id = ? AND project_id = ?",
      args: [asmId, id],
    });
    if (check.rows.length === 0) return apiError("NOT_FOUND", `Assumption '${asmId}' not found.`, 404);

    // Nullify assumption_id on linked experiments (don't cascade delete)
    await db.execute({
      sql: "UPDATE experiments SET assumption_id = NULL WHERE assumption_id = ?",
      args: [asmId],
    });

    await db.execute({ sql: "DELETE FROM assumptions WHERE id = ? AND project_id = ?", args: [asmId, id] });

    // Reconcile risks stage (Phase 3J)
    await reconcileProjectStages(id);
    return apiSuccess({ deleted: asmId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("DELETE /api/projects/[id]/assumptions error:", msg);
    return apiError("DB_DELETE_FAILED", msg, 500);
  }
}
