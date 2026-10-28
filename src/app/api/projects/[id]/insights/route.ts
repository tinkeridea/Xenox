import { NextRequest } from "next/server";
import { initDb, getDb } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { deduplicateInsights } from "@/lib/insightValidation";
import { isPresentationDemoMode, getPresentationDemoFixture } from "@/lib/presentationMode";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  if (isPresentationDemoMode()) {
    const { id } = await params;
    const fixture = getPresentationDemoFixture(`/api/projects/${encodeURIComponent(id)}/insights`);
    if (fixture) return fixture;
    return apiError("PROJECT_NOT_FOUND", `Project '${id}' not found.`, 404);
  }

  try {
    await initDb();
    const { id } = await params;
    const db = getDb();

    const res = await db.execute({
      sql: "SELECT * FROM insights WHERE project_id = ? ORDER BY created_at ASC",
      args: [id],
    });

    const parsedInsights = res.rows.map((row: any) => ({
      ...row,
      evidence_for_ids: row.evidence_for_ids ? JSON.parse(row.evidence_for_ids) : [],
      evidence_against_ids: row.evidence_against_ids ? JSON.parse(row.evidence_against_ids) : [],
    }));

    const dedupedInsights = deduplicateInsights(parsedInsights);

    return apiSuccess({
      projectId: id,
      insights: dedupedInsights,
    });
  } catch (err: any) {
    console.error("GET /api/projects/[id]/insights error:", err);
    return apiError("DB_QUERY_FAILED", err.message, 500);
  }
}
