import { NextRequest } from "next/server";
import { initDb, getDb, nowUtc, PROVENANCE_ENUM } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { delegateToFastAPI } from "@/lib/fastapiProxy";
import { reconcileProjectStages } from "@/lib/stageReconciliation";
import {
  isPlaceholderEvidence,
  isPlaceholderSource,
  isVerifiedRealEvidence,
  isPlaceholderUrl,
  PLACEHOLDER_WARNING_TEXT,
} from "@/lib/evidenceValidation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * ROLLBACK PATH: Original TypeScript SQLite GET implementation.
 * To rollback Slice 1Y delegation back to direct TypeScript execution:
 * Replace `return await delegateToFastAPI(...)` in GET with `return getEvidenceFromDb(id);`
 */
export async function getEvidenceFromDb(id: string) {
  await initDb();
  const db = getDb();

  const sourcesRes = await db.execute({
    sql: `SELECT s.*,
            (SELECT COUNT(*) FROM evidence e WHERE e.source_id = s.id) as linked_evidence_count
          FROM sources s
          WHERE s.project_id = ?
          ORDER BY s.created_at ASC`,
    args: [id],
  });

  const evidenceRes = await db.execute({
    sql: `SELECT e.*, s.title as source_title, s.url as source_url, s.source_type as source_type_resolved
          FROM evidence e
          LEFT JOIN sources s ON s.id = e.source_id
          WHERE e.project_id = ?
          ORDER BY e.created_at ASC`,
    args: [id],
  });

  const evidenceRows = evidenceRes.rows;
  const sourcesRows = sourcesRes.rows;

  const verifiedRealCount = evidenceRows.filter((e: any) => isVerifiedRealEvidence(e)).length;
  const samplePlaceholderCount = evidenceRows.filter((e: any) => isPlaceholderEvidence(e)).length;
  const unreviewedCount = evidenceRows.filter((e: any) => (e.reviewer_status || "").toUpperCase() === "UNREVIEWED").length;
  const acceptedCount = evidenceRows.filter((e: any) => (e.reviewer_status || "").toUpperCase() === "ACCEPTED").length;

  return apiSuccess({
    projectId: id,
    sources: sourcesRows,
    evidence: evidenceRows,
    metrics: {
      totalEvidence: evidenceRows.length,
      verifiedRealCount,
      samplePlaceholderCount,
      unreviewedCount,
      acceptedCount,
      hasUnverifiedPlaceholders: samplePlaceholderCount > 0,
    },
  });
}

// GET /api/projects/[id]/evidence — List all evidence and sources (Delegated to FastAPI via Slice 1Y)
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    return await delegateToFastAPI(req, `/api/projects/${encodeURIComponent(id)}/evidence`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("GET /api/projects/[id]/evidence error:", msg);
    return apiError("INTERNAL_ERROR", "Failed to retrieve project evidence.", 500);
  }
}

// POST /api/projects/[id]/evidence — Add new evidence item
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
    const claim = typeof body.claim === "string" ? body.claim.trim() : "";
    if (!claim) {
      return apiError("VALIDATION_ERROR", "Evidence claim is required and cannot be empty.", 400);
    }

    const excerpt = typeof body.excerpt === "string" && body.excerpt.trim() ? body.excerpt.trim() : null;
    const rawSourceId = body.sourceId ?? body.source_id;
    const sourceId = typeof rawSourceId === "string" && rawSourceId.trim() ? rawSourceId.trim() : null;
    
    // Validate source exists if sourceId provided
    let sourceMeta: any = null;
    if (sourceId) {
      const srcCheck = await db.execute({
        sql: "SELECT id, title, source_type, url FROM sources WHERE id = ? AND project_id = ?",
        args: [sourceId, id],
      });
      if (srcCheck.rows.length > 0) {
        sourceMeta = srcCheck.rows[0];
      }
    }

    // Determine provenance
    const validProvenances = PROVENANCE_ENUM as readonly string[];
    let provenance = body.provenance;
    if (!provenance || !validProvenances.includes(provenance)) {
      if (sourceMeta && sourceMeta.source_type === "web") {
        provenance = "REAL_SOURCE";
      } else {
        provenance = "USER_INPUT";
      }
    }

    // Confidence
    const validConfidences = ["High", "Medium", "Low"];
    let confidence = validConfidences.includes(body.confidence) ? body.confidence : "Medium";

    // Reviewer status (F06: default UNREVIEWED)
    const validReviewerStatuses = ["UNREVIEWED", "ACCEPTED", "EDITED", "REJECTED"];
    const rawReviewerStatus = (body.reviewerStatus || body.reviewer_status || "").toUpperCase();
    const reviewerStatus = validReviewerStatuses.includes(rawReviewerStatus)
      ? rawReviewerStatus
      : "UNREVIEWED";

    let caveat = typeof body.caveat === "string" && body.caveat.trim() ? body.caveat.trim() : null;

    // Quarantine placeholder sources (Decision D19)
    const isPlaceholder = isPlaceholderSource(sourceMeta || {}) || provenance === "SAMPLE";
    if (isPlaceholder) {
      provenance = "SAMPLE";
      confidence = "Low";
      if (!caveat || !caveat.includes("Unverified sample")) {
        caveat = caveat ? `${caveat} | ${PLACEHOLDER_WARNING_TEXT}` : PLACEHOLDER_WARNING_TEXT;
      }
    }

    const evidenceId = `ev-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const now = nowUtc();

    await db.execute({
      sql: `INSERT INTO evidence (id, project_id, source_id, claim, excerpt, provenance, confidence, reviewer_status, caveat, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [evidenceId, id, sourceId, claim, excerpt, provenance, confidence, reviewerStatus, caveat, now],
    });

    // Reconcile research stage with new evidence (Phase 3J)
    await reconcileProjectStages(id);

    const createdEvidence = {
      id: evidenceId,
      project_id: id,
      source_id: sourceId,
      source_title: sourceMeta ? sourceMeta.title : null,
      source_url: sourceMeta ? sourceMeta.url : null,
      claim,
      excerpt,
      provenance,
      confidence,
      reviewer_status: reviewerStatus,
      caveat,
      created_at: now,
    };

    return apiSuccess({ evidence: createdEvidence }, provenance, 201);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("POST /api/projects/[id]/evidence error:", msg);
    return apiError("CREATE_EVIDENCE_FAILED", msg, 500);
  }
}

// PATCH /api/projects/[id]/evidence — Review and edit evidence (F06 Review Gate)
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    await initDb();
    const { id } = await params;
    const db = getDb();

    const body = await req.json().catch(() => ({}));
    const evidenceId = typeof body.id === "string" ? body.id.trim() : "";
    if (!evidenceId) {
      return apiError("VALIDATION_ERROR", "evidence ID is required for PATCH.", 400);
    }

    // Verify evidence exists
    const existingRes = await db.execute({
      sql: "SELECT * FROM evidence WHERE id = ? AND project_id = ?",
      args: [evidenceId, id],
    });
    if (existingRes.rows.length === 0) {
      return apiError("NOT_FOUND", `Evidence '${evidenceId}' not found for project '${id}'.`, 404);
    }
    const current = existingRes.rows[0];

    // Fetch linked source metadata to check placeholder status
    let srcMeta: any = null;
    if (current.source_id) {
      const srcCheck = await db.execute({
        sql: "SELECT id, title, source_type, url FROM sources WHERE id = ?",
        args: [current.source_id],
      });
      if (srcCheck.rows.length > 0) srcMeta = srcCheck.rows[0];
    }

    const isPlaceholder = isPlaceholderEvidence({
      provenance: current.provenance as string,
      source_url: srcMeta?.url as string | null,
      source_type: srcMeta?.source_type as string | null,
    });

    // Allowed updates: reviewer_status, claim, excerpt, confidence, caveat
    const validReviewerStatuses = ["UNREVIEWED", "ACCEPTED", "EDITED", "REJECTED"];
    const incomingStatus = (body.reviewerStatus || body.reviewer_status || "").toUpperCase();
    const reviewerStatus = incomingStatus && validReviewerStatuses.includes(incomingStatus)
      ? incomingStatus
      : (current.reviewer_status as string);

    const claim = typeof body.claim === "string" && body.claim.trim()
      ? body.claim.trim()
      : (current.claim as string);

    const excerpt = body.excerpt !== undefined
      ? (typeof body.excerpt === "string" && body.excerpt.trim() ? body.excerpt.trim() : null)
      : (current.excerpt as string | null);

    const validConfidences = ["High", "Medium", "Low"];
    let confidence = body.confidence && validConfidences.includes(body.confidence)
      ? body.confidence
      : (current.confidence as string);

    let caveat = body.caveat !== undefined
      ? (typeof body.caveat === "string" && body.caveat.trim() ? body.caveat.trim() : null)
      : (current.caveat as string | null);

    // Quarantine placeholder evidence: enforce Low confidence & explicit caveat
    if (isPlaceholder) {
      confidence = "Low";
      if (!caveat || !caveat.includes("Unverified sample")) {
        caveat = caveat ? `${caveat} | ${PLACEHOLDER_WARNING_TEXT}` : PLACEHOLDER_WARNING_TEXT;
      }
    }

    await db.execute({
      sql: `UPDATE evidence
            SET claim = ?, excerpt = ?, reviewer_status = ?, confidence = ?, caveat = ?
            WHERE id = ? AND project_id = ?`,
      args: [claim, excerpt, reviewerStatus, confidence, caveat, evidenceId, id],
    });

    // Reconcile stage progression (Phase 3J)
    await reconcileProjectStages(id);

    const updatedRes = await db.execute({
      sql: `SELECT e.*, s.title as source_title, s.url as source_url
            FROM evidence e
            LEFT JOIN sources s ON s.id = e.source_id
            WHERE e.id = ? AND e.project_id = ?`,
      args: [evidenceId, id],
    });

    return apiSuccess({ evidence: updatedRes.rows[0] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("PATCH /api/projects/[id]/evidence error:", msg);
    return apiError("UPDATE_EVIDENCE_FAILED", msg, 500);
  }
}

// DELETE /api/projects/[id]/evidence — Delete an evidence item
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    await initDb();
    const { id } = await params;
    const db = getDb();

    const { searchParams } = new URL(req.url);
    let evidenceId = searchParams.get("evidenceId");

    if (!evidenceId) {
      const body = await req.json().catch(() => ({}));
      evidenceId = body.evidenceId;
    }

    if (!evidenceId) {
      return apiError("VALIDATION_ERROR", "evidenceId is required to delete evidence.", 400);
    }

    const delRes = await db.execute({
      sql: "DELETE FROM evidence WHERE id = ? AND project_id = ?",
      args: [evidenceId, id],
    });

    if (delRes.rowsAffected === 0) {
      return apiError("NOT_FOUND", `Evidence '${evidenceId}' not found for project '${id}'.`, 404);
    }

    return apiSuccess({ deleted: evidenceId, success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("DELETE /api/projects/[id]/evidence error:", msg);
    return apiError("DELETE_EVIDENCE_FAILED", msg, 500);
  }
}
