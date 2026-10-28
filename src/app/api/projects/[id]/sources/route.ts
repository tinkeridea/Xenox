import { NextRequest } from "next/server";
import { initDb, getDb, nowUtc } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { delegateToFastAPI } from "@/lib/fastapiProxy";
import { reconcileProjectStages } from "@/lib/stageReconciliation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * ROLLBACK PATH: Original TypeScript SQLite GET implementation.
 * To rollback Slice 1R delegation back to direct TypeScript execution:
 * Replace `return await delegateToFastAPI(...)` in GET with `return getSourcesFromDb(id);`
 */
export async function getSourcesFromDb(id: string) {
  await initDb();
  const db = getDb();

  const sourcesRes = await db.execute({
    sql: `SELECT s.*, 
            (SELECT COUNT(*) FROM evidence e WHERE e.source_id = s.id) as linked_evidence_count
          FROM sources s
          WHERE s.project_id = ?
          ORDER BY s.created_at DESC`,
    args: [id],
  });

  return apiSuccess({
    projectId: id,
    sources: sourcesRes.rows,
  });
}

// GET /api/projects/[id]/sources — List all sources for project (Delegated to FastAPI via Slice 1R)
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    return await delegateToFastAPI(req, `/api/projects/${encodeURIComponent(id)}/sources`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("GET /api/projects/[id]/sources error:", msg);
    return apiError("INTERNAL_ERROR", "Failed to retrieve project sources.", 500);
  }
}

// POST /api/projects/[id]/sources — Create a new source (USER_INPUT, web, or document)
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    await initDb();
    const { id } = await params;
    const db = getDb();

    // Verify project exists
    const projRes = await db.execute({
      sql: "SELECT id FROM projects WHERE id = ?",
      args: [id],
    });
    if (projRes.rows.length === 0) {
      return apiError("PROJECT_NOT_FOUND", `Project '${id}' not found.`, 404);
    }

    const body = await req.json().catch(() => ({}));
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return apiError("VALIDATION_ERROR", "Source title is required and cannot be empty.", 400);
    }

    const url = typeof body.url === "string" && body.url.trim() ? body.url.trim() : null;
    const publisher = typeof body.publisher === "string" && body.publisher.trim() ? body.publisher.trim() : null;
    const publishedAt = typeof body.publishedAt === "string" && body.publishedAt.trim() ? body.publishedAt.trim() : null;
    
    // Validate source_type
    const validSourceTypes = ["web", "document", "user_input", "demo_fixture"];
    let sourceType = body.sourceType;
    if (!sourceType || !validSourceTypes.includes(sourceType)) {
      sourceType = url ? "web" : "user_input";
    }

    const provider = typeof body.provider === "string" ? body.provider.trim() : null;
    const sourceId = `src-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const now = nowUtc();

    await db.execute({
      sql: `INSERT INTO sources (id, project_id, url, title, publisher, published_at, retrieved_at, source_type, provider, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [sourceId, id, url, title, publisher, publishedAt, now, sourceType, provider, now],
    });

    // Reconcile research stage with new source (Phase 3J)
    await reconcileProjectStages(id);

    const createdSource = {
      id: sourceId,
      project_id: id,
      url,
      title,
      publisher,
      published_at: publishedAt,
      retrieved_at: now,
      source_type: sourceType,
      provider,
      created_at: now,
      linked_evidence_count: 0,
    };

    return apiSuccess({ source: createdSource }, "USER_INPUT", 201);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("POST /api/projects/[id]/sources error:", msg);
    return apiError("CREATE_SOURCE_FAILED", msg, 500);
  }
}

// DELETE /api/projects/[id]/sources — Delete a source by sourceId
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    await initDb();
    const { id } = await params;
    const db = getDb();

    const { searchParams } = new URL(req.url);
    let sourceId = searchParams.get("sourceId");

    if (!sourceId) {
      const body = await req.json().catch(() => ({}));
      sourceId = body.sourceId;
    }

    if (!sourceId) {
      return apiError("VALIDATION_ERROR", "sourceId is required to delete a source.", 400);
    }

    // Unlink any evidence referencing this source before deleting
    await db.execute({
      sql: "UPDATE evidence SET source_id = NULL WHERE source_id = ? AND project_id = ?",
      args: [sourceId, id],
    });

    const delRes = await db.execute({
      sql: "DELETE FROM sources WHERE id = ? AND project_id = ?",
      args: [sourceId, id],
    });

    if (delRes.rowsAffected === 0) {
      return apiError("NOT_FOUND", `Source '${sourceId}' not found for project '${id}'.`, 404);
    }

    return apiSuccess({ deleted: sourceId, success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("DELETE /api/projects/[id]/sources error:", msg);
    return apiError("DELETE_SOURCE_FAILED", msg, 500);
  }
}
