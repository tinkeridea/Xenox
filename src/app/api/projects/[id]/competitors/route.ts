import { NextRequest } from "next/server";
import { initDb, getDb, nowUtc } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { delegateToFastAPI } from "@/lib/fastapiProxy";
import { runInference } from "@/lib/ollama";
import { validateCompetitor, type CompetitorSchema } from "@/lib/ollama";
import type { CompetitorCategory } from "@/types";
import { reconcileProjectStages } from "@/lib/stageReconciliation";

import { deduplicateCompetitors, getSemanticCompetitorKey, normalizeCompetitorName } from "@/lib/competitorValidation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * ROLLBACK PATH: Original TypeScript SQLite GET implementation.
 * To rollback Slice 1Z delegation back to direct TypeScript execution:
 * Replace `return await delegateToFastAPI(...)` in GET with `return await getCompetitorsFromDb(id);`
 */
export async function getCompetitorsFromDb(id: string) {
  await initDb();
  const db = getDb();

  const res = await db.execute({
    sql: "SELECT * FROM competitors WHERE project_id = ? ORDER BY category ASC, name ASC",
    args: [id],
  });

  const competitors = deduplicateCompetitors(res.rows as any[]);

  const byCategory: Record<string, number> = {
    direct: 0,
    indirect: 0,
    substitute: 0,
    status_quo: 0,
  };
  for (const row of competitors) {
    byCategory[row.category] = (byCategory[row.category] || 0) + 1;
  }

  return apiSuccess({
    projectId: id,
    competitors,
    totalCount: competitors.length,
    byCategory,
  });
}

// ─── GET /api/projects/[id]/competitors ────────────────────────────────────
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    return await delegateToFastAPI(req, `/api/projects/${encodeURIComponent(id)}/competitors`);
  } catch (err: unknown) {
    console.error("GET /api/projects/[id]/competitors proxy error:", err);
    return apiError("INTERNAL_ERROR", "Failed to retrieve project competitors.", 500);
  }
}

// ─── POST /api/projects/[id]/competitors ───────────────────────────────────
// Body: { name, category, description?, differentiator?, provenance? }
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    await initDb();
    const { id } = await params;
    const db = getDb();

    // Verify project
    const projRes = await db.execute({ sql: "SELECT id FROM projects WHERE id = ?", args: [id] });
    if (projRes.rows.length === 0) return apiError("PROJECT_NOT_FOUND", `Project '${id}' not found.`, 404);

    const body = await req.json().catch(() => ({}));
    const name: string = typeof body.name === "string" ? body.name.trim() : "";
    const category: string = typeof body.category === "string" ? body.category.trim() : "direct";

    if (!name) return apiError("VALIDATION_FAILED", "name is required.", 400);
    const validCategories: CompetitorCategory[] = ["direct", "indirect", "substitute", "status_quo"];
    if (!validCategories.includes(category as CompetitorCategory)) {
      return apiError("VALIDATION_FAILED", `category must be one of: ${validCategories.join(", ")}.`, 400);
    }

    const description: string = typeof body.description === "string" ? body.description.trim() : "";
    const differentiator: string = typeof body.differentiator === "string" ? body.differentiator.trim() : "";
    const provenance: string = typeof body.provenance === "string" ? body.provenance : "USER_INPUT";
    const now = nowUtc();

    // Check for existing competitor by exact normalized name and category
    const existing = await db.execute({
      sql: "SELECT id, name, category, description FROM competitors WHERE project_id = ?",
      args: [id],
    });
    const normName = normalizeCompetitorName(name);
    const match = (existing.rows as any[]).find(
      (c) => normalizeCompetitorName(c.name) === normName && c.category === category
    );

    if (match) {
      await db.execute({
        sql: "UPDATE competitors SET description = ?, differentiator = ?, provenance = ? WHERE id = ?",
        args: [description, differentiator, provenance, match.id],
      });
      const updated = await db.execute({ sql: "SELECT * FROM competitors WHERE id = ?", args: [match.id] });
      return apiSuccess({ competitor: updated.rows[0] }, "USER_INPUT", 200);
    }

    const compId = `comp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    await db.execute({
      sql: `INSERT INTO competitors (id, project_id, name, category, description, differentiator, provenance, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [compId, id, name, category, description, differentiator, provenance, now],
    });

    // Reconcile competitors stage (Phase 3J)
    await reconcileProjectStages(id);

    const created = await db.execute({ sql: "SELECT * FROM competitors WHERE id = ?", args: [compId] });

    return apiSuccess({ competitor: created.rows[0] }, "USER_INPUT", 201);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("POST /api/projects/[id]/competitors error:", msg);
    return apiError("DB_INSERT_FAILED", msg, 500);
  }
}

// ─── PATCH /api/projects/[id]/competitors ──────────────────────────────────
// Body: { id, name?, category?, description?, differentiator? }
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    await initDb();
    const { id } = await params;
    const db = getDb();

    const body = await req.json().catch(() => ({}));
    const compId: string = typeof body.id === "string" ? body.id.trim() : "";
    if (!compId) return apiError("VALIDATION_FAILED", "id is required.", 400);

    const check = await db.execute({ sql: "SELECT id FROM competitors WHERE id = ? AND project_id = ?", args: [compId, id] });
    if (check.rows.length === 0) return apiError("NOT_FOUND", `Competitor '${compId}' not found.`, 404);

    const updates: string[] = [];
    const args: any[] = [];

    if (typeof body.name === "string" && body.name.trim()) { updates.push("name = ?"); args.push(body.name.trim()); }
    if (typeof body.category === "string" && body.category.trim()) { updates.push("category = ?"); args.push(body.category.trim()); }
    if (typeof body.description === "string") { updates.push("description = ?"); args.push(body.description.trim()); }
    if (typeof body.differentiator === "string") { updates.push("differentiator = ?"); args.push(body.differentiator.trim()); }

    if (updates.length === 0) return apiError("VALIDATION_FAILED", "No updatable fields provided.", 400);

    args.push(compId);
    await db.execute({ sql: `UPDATE competitors SET ${updates.join(", ")} WHERE id = ?`, args });

    // Reconcile competitors stage (Phase 3J)
    await reconcileProjectStages(id);

    const updated = await db.execute({ sql: "SELECT * FROM competitors WHERE id = ?", args: [compId] });
    return apiSuccess({ competitor: updated.rows[0] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("PATCH /api/projects/[id]/competitors error:", msg);
    return apiError("DB_UPDATE_FAILED", msg, 500);
  }
}

// ─── DELETE /api/projects/[id]/competitors ─────────────────────────────────
// Query: ?competitorId=xxx
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    await initDb();
    const { id } = await params;
    const db = getDb();

    const { searchParams } = new URL(req.url);
    const compId = searchParams.get("competitorId") || "";
    if (!compId) return apiError("VALIDATION_FAILED", "competitorId query parameter is required.", 400);

    const check = await db.execute({ sql: "SELECT id FROM competitors WHERE id = ? AND project_id = ?", args: [compId, id] });
    if (check.rows.length === 0) return apiError("NOT_FOUND", `Competitor '${compId}' not found.`, 404);

    await db.execute({ sql: "DELETE FROM competitors WHERE id = ? AND project_id = ?", args: [compId, id] });

    // Reconcile competitors stage (Phase 3J)
    await reconcileProjectStages(id);
    return apiSuccess({ deleted: compId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("DELETE /api/projects/[id]/competitors error:", msg);
    return apiError("DB_DELETE_FAILED", msg, 500);
  }
}
