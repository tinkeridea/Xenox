import { NextRequest } from "next/server";
import { initDb, getDb } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { delegateToFastAPI } from "@/lib/fastapiProxy";
import { reconcileProjectStages } from "@/lib/stageReconciliation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * ROLLBACK PATH: Original TypeScript SQLite GET implementation.
 * To rollback Slice 1AC delegation back to direct TypeScript execution:
 * Replace `return await delegateToFastAPI(...)` in GET with `return await getMvpFeaturesFromDb(id);`
 */
export async function getMvpFeaturesFromDb(id: string) {
  await initDb();
  const db = getDb();

  const res = await db.execute({
    sql: `SELECT * FROM mvp_features WHERE project_id = ?
          ORDER BY CASE priority WHEN 'now' THEN 1 WHEN 'later' THEN 2 WHEN 'omit' THEN 3 ELSE 4 END, name ASC`,
    args: [id],
  });

  const features = res.rows.map((row: any) => ({
    ...row,
    experiment_ids: row.experiment_ids ? JSON.parse(row.experiment_ids) : [],
    dependency_ids: row.dependency_ids ? JSON.parse(row.dependency_ids) : [],
  }));

  const now = features.filter((f: any) => f.priority === "now").length;
  const later = features.filter((f: any) => f.priority === "later").length;
  const omit = features.filter((f: any) => f.priority === "omit").length;

  return apiSuccess({
    projectId: id,
    features,
    counts: { now, later, omit, total: features.length },
  });
}

// ── GET: List all MVP features for a project ─────────────────────
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    return await delegateToFastAPI(req, `/api/projects/${encodeURIComponent(id)}/mvp`);
  } catch (err: unknown) {
    console.error("GET /api/projects/[id]/mvp proxy error:", err);
    return apiError("INTERNAL_ERROR", "Failed to retrieve project MVP features.", 500);
  }
}

// ── POST: Create a new MVP feature ───────────────────────────────
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    await initDb();
    const { id } = await params;
    const db = getDb();
    const body = await req.json();

    const {
      name,
      scope = null,
      priority = "later",
      effort = "Medium",
      rationale = null,
      experiment_ids = [],
      dependency_ids = [],
      provenance = "USER_INPUT",
    } = body;

    if (!name || typeof name !== "string" || name.trim() === "") {
      return apiError("VALIDATION_ERROR", "name is required", 400);
    }
    if (!["now", "later", "omit"].includes(priority)) {
      return apiError("VALIDATION_ERROR", "priority must be 'now', 'later', or 'omit'", 400);
    }
    if (!["Low", "Medium", "High"].includes(effort)) {
      return apiError("VALIDATION_ERROR", "effort must be 'Low', 'Medium', or 'High'", 400);
    }

    const projectCheck = await db.execute({
      sql: "SELECT id FROM projects WHERE id = ?",
      args: [id],
    });
    if (projectCheck.rows.length === 0) {
      return apiError("PROJECT_NOT_FOUND", `Project '${id}' not found`, 404);
    }

    const featureId = `mvp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    await db.execute({
      sql: `INSERT INTO mvp_features
              (id, project_id, name, scope, priority, effort, experiment_ids, dependency_ids, rationale, status, provenance)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        featureId,
        id,
        name.trim(),
        scope,
        priority,
        effort,
        JSON.stringify(experiment_ids),
        JSON.stringify(dependency_ids),
        rationale,
        "candidate",
        provenance,
      ] as any[],
    });

    // Reconcile mvp stage (Phase 3J)
    await reconcileProjectStages(id);

    const created = await db.execute({
      sql: "SELECT * FROM mvp_features WHERE id = ?",
      args: [featureId],
    });

    const feature: any = created.rows[0];
    return apiSuccess(
      {
        feature: {
          ...feature,
          experiment_ids: feature.experiment_ids ? JSON.parse(feature.experiment_ids) : [],
          dependency_ids: feature.dependency_ids ? JSON.parse(feature.dependency_ids) : [],
        },
      },
      "USER_INPUT",
      201
    );
  } catch (err: any) {
    console.error("POST /api/projects/[id]/mvp error:", err);
    return apiError("DB_WRITE_FAILED", err.message, 500);
  }
}

// ── PATCH: Update an MVP feature (priority triage or field edits) ─
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    await initDb();
    const { id } = await params;
    const db = getDb();
    const body = await req.json();

    const { featureId, priority, effort, name, scope, rationale, experiment_ids, dependency_ids } = body;

    if (!featureId) {
      return apiError("VALIDATION_ERROR", "featureId is required", 400);
    }

    // Verify ownership
    const existing = await db.execute({
      sql: "SELECT * FROM mvp_features WHERE id = ? AND project_id = ?",
      args: [featureId, id],
    });
    if (existing.rows.length === 0) {
      return apiError("NOT_FOUND", `Feature '${featureId}' not found in project '${id}'`, 404);
    }

    const updates: string[] = [];
    const args: any[] = [];

    if (priority !== undefined) {
      if (!["now", "later", "omit"].includes(priority)) {
        return apiError("VALIDATION_ERROR", "priority must be 'now', 'later', or 'omit'", 400);
      }
      updates.push("priority = ?");
      args.push(priority);
    }
    if (effort !== undefined) {
      if (!["Low", "Medium", "High"].includes(effort)) {
        return apiError("VALIDATION_ERROR", "effort must be 'Low', 'Medium', or 'High'", 400);
      }
      updates.push("effort = ?");
      args.push(effort);
    }
    if (name !== undefined) { updates.push("name = ?"); args.push(name); }
    if (scope !== undefined) { updates.push("scope = ?"); args.push(scope); }
    if (rationale !== undefined) { updates.push("rationale = ?"); args.push(rationale); }
    if (experiment_ids !== undefined) { updates.push("experiment_ids = ?"); args.push(JSON.stringify(experiment_ids)); }
    if (dependency_ids !== undefined) { updates.push("dependency_ids = ?"); args.push(JSON.stringify(dependency_ids)); }

    if (updates.length === 0) {
      return apiError("VALIDATION_ERROR", "No updatable fields provided", 400);
    }

    args.push(featureId, id);
    await db.execute({
      sql: `UPDATE mvp_features SET ${updates.join(", ")} WHERE id = ? AND project_id = ?`,
      args,
    });

    const updated = await db.execute({
      sql: "SELECT * FROM mvp_features WHERE id = ?",
      args: [featureId],
    });

    const feature: any = updated.rows[0];
    return apiSuccess({
      feature: {
        ...feature,
        experiment_ids: feature.experiment_ids ? JSON.parse(feature.experiment_ids) : [],
        dependency_ids: feature.dependency_ids ? JSON.parse(feature.dependency_ids) : [],
      },
    });
  } catch (err: any) {
    console.error("PATCH /api/projects/[id]/mvp error:", err);
    return apiError("DB_WRITE_FAILED", err.message, 500);
  }
}

// ── DELETE: Remove an MVP feature ────────────────────────────────
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    await initDb();
    const { id } = await params;
    const db = getDb();
    const { searchParams } = new URL(req.url);
    const featureId = searchParams.get("featureId");

    if (!featureId) {
      return apiError("VALIDATION_ERROR", "featureId query param is required", 400);
    }

    const existing = await db.execute({
      sql: "SELECT id FROM mvp_features WHERE id = ? AND project_id = ?",
      args: [featureId, id],
    });
    if (existing.rows.length === 0) {
      return apiError("NOT_FOUND", `Feature '${featureId}' not found in project '${id}'`, 404);
    }

    await db.execute({
      sql: "DELETE FROM mvp_features WHERE id = ? AND project_id = ?",
      args: [featureId, id],
    });

    // Reconcile mvp stage (Phase 3J)
    await reconcileProjectStages(id);

    return apiSuccess({ deleted: featureId });
  } catch (err: any) {
    console.error("DELETE /api/projects/[id]/mvp error:", err);
    return apiError("DB_WRITE_FAILED", err.message, 500);
  }
}
