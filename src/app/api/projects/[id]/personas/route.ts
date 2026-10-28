import { NextRequest } from "next/server";
import { initDb, getDb } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { isPresentationDemoMode, getPresentationDemoFixture } from "@/lib/presentationMode";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  if (isPresentationDemoMode()) {
    const { id } = await params;
    const fixture = getPresentationDemoFixture(`/api/projects/${encodeURIComponent(id)}/personas`);
    if (fixture) return fixture;
    return apiError("PROJECT_NOT_FOUND", `Project '${id}' not found.`, 404);
  }

  try {
    await initDb();
    const { id } = await params;
    const db = getDb();

    const personasRes = await db.execute({
      sql: "SELECT * FROM personas WHERE project_id = ? ORDER BY created_at ASC",
      args: [id],
    });

    const parseField = (val: unknown): string | string[] => {
      if (typeof val === "string") {
        try {
          const parsed = JSON.parse(val);
          if (Array.isArray(parsed)) return parsed;
        } catch {
          // Keep as string
        }
      }
      return (val as string) || "";
    };

    const parsedPersonas = personasRes.rows.map((row: any) => ({
      ...row,
      jobs: parseField(row.jobs),
      pains: parseField(row.pains),
      goals: parseField(row.goals),
      behaviors: parseField(row.behaviors),
      constraints: parseField(row.constraints),
      objections: parseField(row.objections),
      assumptions: parseField(row.assumptions),
    }));

    // Deduplicate personas by ID and case-insensitive name (Decision D20)
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    const deduplicatedPersonas = parsedPersonas.filter((p: any) => {
      const nameKey = (p.name || "").trim().toLowerCase();
      if (seenIds.has(p.id) || (nameKey && seenNames.has(nameKey))) {
        return false;
      }
      seenIds.add(p.id);
      if (nameKey) seenNames.add(nameKey);
      return true;
    });

    const interviewsRes = await db.execute({
      sql: "SELECT * FROM interviews WHERE project_id = ? ORDER BY created_at ASC",
      args: [id],
    });

    // Also fetch turns for each interview
    const interviewsWithTurns = await Promise.all(
      interviewsRes.rows.map(async (iv: any) => {
        const turnsRes = await db.execute({
          sql: "SELECT * FROM turns WHERE conversation_id = ? ORDER BY created_at ASC",
          args: [iv.id],
        });
        return {
          ...iv,
          turns: turnsRes.rows,
        };
      })
    );

    return apiSuccess({
      projectId: id,
      personas: deduplicatedPersonas,
      interviews: interviewsWithTurns,
    });
  } catch (err: any) {
    console.error("GET /api/projects/[id]/personas error:", err);
    return apiError("DB_QUERY_FAILED", err.message, 500);
  }
}
