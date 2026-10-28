import { NextRequest } from "next/server";
import { initDb, getDb, nowUtc } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { runInference, validateCompetitor, isAiInference, type CompetitorSchema } from "@/lib/ollama";
import { getSemanticCompetitorKey, normalizeCompetitorName } from "@/lib/competitorValidation";
import type { CompetitorCategory } from "@/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const COMPETITOR_FALLBACKS: CompetitorSchema[] = [
  {
    name: "Manual Study Timetable (Paper)",
    category: "status_quo",
    description: "Students hand-write exam schedules on paper or whiteboards. Zero-friction but cannot adapt to missed sessions.",
    differentiation: "IdeaProbe auto-reschedules when a session is skipped; paper requires full manual rewrite. Our app must be as low-friction as writing on paper.",
    source_ids: [],
    confidence: "high",
    caveat: "SAMPLE competitor generated without live AI inference. Verify with real customer conversations.",
  },
  {
    name: "Google Calendar (Study Blocks)",
    category: "substitute",
    description: "Students manually create repeating study events. Popular but zero-intelligence — no adaptive rescheduling.",
    differentiation: "Google Calendar is a generic time container; our planner is subject-aware, tracks adherence, and adjusts automatically.",
    source_ids: [],
    confidence: "medium",
    caveat: "SAMPLE competitor generated without live AI inference. Verify with real customer conversations.",
  },
];

// POST /api/projects/[id]/competitors/analyze
// Body: { category?, focusArea? }
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    await initDb();
    const { id } = await params;
    const db = getDb();

    const projRes = await db.execute({
      sql: "SELECT id, title, mode FROM projects WHERE id = ?",
      args: [id],
    });
    if (projRes.rows.length === 0) {
      return apiError("PROJECT_NOT_FOUND", `Project '${id}' not found.`, 404);
    }
    const project = projRes.rows[0] as unknown as { id: string; title: string; mode?: string };
    const isDemoProject = id === "proj-study-planner" || project.mode === "DEMO";

    const body = await req.json().catch(() => ({}));
    const focusCategory: string = typeof body.category === "string" ? body.category : "";
    const focusArea: string = typeof body.focusArea === "string" ? body.focusArea.trim() : "";

    // Load idea brief for context
    const briefRes = await db.execute({
      sql: "SELECT problem, target_customer, category FROM idea_briefs WHERE project_id = ? ORDER BY version DESC LIMIT 1",
      args: [id],
    });
    const brief = briefRes.rows[0] as { problem?: string; target_customer?: string; category?: string } | undefined;

    // Load existing evidence for grounding
    const evidenceRes = await db.execute({
      sql: "SELECT claim FROM evidence WHERE project_id = ? AND reviewer_status IN ('ACCEPTED','EDITED') LIMIT 5",
      args: [id],
    });
    const evidenceSummary = (evidenceRes.rows as any[])
      .map((r) => `- ${r.claim}`)
      .join("\n") || "No reviewed evidence yet.";

    // Load existing competitors to prevent duplicate re-analysis
    const existingCompsRes = await db.execute({
      sql: "SELECT id, name, category, description, differentiator, provenance FROM competitors WHERE project_id = ?",
      args: [id],
    });
    const existingComps = existingCompsRes.rows as unknown as Array<{
      id: string;
      name: string;
      category: string;
      description?: string;
      differentiator?: string;
      provenance: string;
    }>;
    const existingNames = existingComps.map((c) => `"${c.name}" [${c.category}]`).join(", ");

    const systemFragment = `You are a startup market analyst specializing in competitor research for early-stage ideas.
Focus exclusively on factual competitor profiling. Never fabricate funding data, market share, or pricing unless specified.
Distinguish clearly between what is verifiable and what is hypothesized.`;

    const categoryConstraint = focusCategory
      ? `Focus on the "${focusCategory}" competitor category.`
      : "Identify the most important uncovered competitor gap across all categories: direct, indirect, substitute, or status_quo.";

    const userPrompt = `Project: ${project.title}
Problem being solved: ${brief?.problem || "not specified"}
Target customer: ${brief?.target_customer || "not specified"}
${focusArea ? `Focus area: ${focusArea}` : ""}

Existing accepted evidence:
${evidenceSummary}

Already mapped alternatives for this project:
${existingNames || "None recorded yet."}

${categoryConstraint}

CRITICAL INTEGRITY RULES:
1. Identify ONE competitor or alternative the customer might currently use.
2. Do NOT duplicate or repeat any of the already mapped alternatives listed above unless addressing a genuinely distinct, separate use case.
3. Be concise, realistic, and evidence-grounded. Do NOT invent student adoption rates, market share numbers, or funding figures.
Return a JSON object exactly matching this schema.`;

    // Pick fallback that doesn't duplicate existing items if possible
    let fallback = COMPETITOR_FALLBACKS[0];
    for (const fb of COMPETITOR_FALLBACKS) {
      const fbKey = getSemanticCompetitorKey({ name: fb.name, category: fb.category, description: fb.description });
      const alreadyHas = existingComps.some((c) => getSemanticCompetitorKey(c) === fbKey);
      if (!alreadyHas) {
        fallback = fb;
        break;
      }
    }

    const outcome = await runInference<CompetitorSchema>({
      task: "competitor-analysis",
      systemFragment,
      userPrompt,
      schemaDescription: `{
  "name": "string — competitor name",
  "category": "'direct' | 'indirect' | 'substitute' | 'status_quo'",
  "description": "string — what they offer and who uses them",
  "differentiation": "string — how our idea differs or where we win",
  "source_ids": "string[] — empty array (no auto-sourcing)",
  "confidence": "'low' | 'medium' | 'high'",
  "caveat": "string — honest statement of uncertainty"
}`,
      validate: validateCompetitor,
      fallback,
      fallbackProvenance: "SAMPLE",
    });

    const isLive = isAiInference(outcome);

    // For live customer projects, offline fallbacks are not permitted to masquerade as research
    if (!isDemoProject && !isLive) {
      const reason = (outcome as { reason?: string }).reason || "Inference failed";
      return apiError(
        "INFERENCE_FAILED",
        `Ollama local inference failed for live project '${id}': ${reason}. Fallbacks are not permitted for live customer competitor discovery. Start Ollama and retry.`,
        503,
        true
      );
    }

    const now = nowUtc();
    const comp = outcome.data;

    // Check if matching semantic alternative already exists
    const semKey = getSemanticCompetitorKey({ name: comp.name, category: comp.category, description: comp.description });
    const normName = normalizeCompetitorName(comp.name);
    const existingMatch = existingComps.find(
      (c) => getSemanticCompetitorKey(c) === semKey || normalizeCompetitorName(c.name) === normName
    );

    let compId: string;
    let finalProvenance: "AI_INFERENCE" | "SIMULATED" | "SAMPLE" = outcome.provenance;

    if (existingMatch) {
      // Idempotent update: update in-place rather than inserting duplicate record
      compId = existingMatch.id;
      if (existingMatch.provenance === "SAMPLE" || existingMatch.provenance === "AI_INFERENCE" || existingMatch.provenance === "SIMULATED") {
        finalProvenance = existingMatch.provenance;
      }
      await db.execute({
        sql: `UPDATE competitors
              SET description = ?, differentiator = ?, created_at = ?
              WHERE id = ?`,
        args: [comp.description, comp.differentiation, now, compId],
      });
    } else {
      compId = `comp-ai-${Date.now().toString(36)}`;
      await db.execute({
        sql: `INSERT INTO competitors (id, project_id, name, category, description, differentiator, provenance, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          compId, id, comp.name,
          comp.category as CompetitorCategory,
          comp.description,
          comp.differentiation,
          finalProvenance,
          now,
        ],
      });
    }

    return apiSuccess({
      competitor: {
        id: compId,
        project_id: id,
        name: comp.name,
        category: comp.category,
        description: comp.description,
        differentiator: comp.differentiation,
        provenance: finalProvenance,
        created_at: now,
      },
      confidence: comp.confidence,
      caveat: comp.caveat,
      inference: {
        provenance: outcome.provenance,
        latencyMs: outcome.provenance === "AI_INFERENCE" ? outcome.latencyMs : null,
        reason: outcome.provenance !== "AI_INFERENCE" ? outcome.reason : null,
        fallbackAt: outcome.provenance !== "AI_INFERENCE" ? outcome.fallbackAt : null,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("POST /api/projects/[id]/competitors/analyze error:", msg);
    return apiError("COMPETITOR_ANALYSIS_ERROR", msg, 500);
  }
}
