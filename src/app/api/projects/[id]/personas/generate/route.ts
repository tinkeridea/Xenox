/**
 * POST /api/projects/[id]/personas/generate
 *
 * Drafts a Persona segment hypothesis from project brief + evidence.
 * Tags AI_INFERENCE when Ollama is live, SAMPLE when offline.
 * Stores result in personas table with provenance metadata.
 *
 * Prompt rule: do not infer demographic traits without evidence;
 * represent personas as hypotheses labeled as assumptions.
 */
import { NextRequest } from "next/server";
import { initDb, getDb } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { reconcileProjectStages } from "@/lib/stageReconciliation";
import {
  runInference,
  validatePersona,
  PERSONA_SCHEMA_DESC,
  isAiInference,
  OLLAMA_MODEL,
  PROMPT_VERSION,
} from "@/lib/ollama";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const FALLBACK_PERSONA = {
  name: "Dual-Track Exam Student",
  segment: "Undergraduate students balancing 2+ simultaneous exam preparation tracks",
  context:
    "Preparing for both university exams and competitive exams (e.g. CA Foundation, UPSC) with overlapping deadlines.",
  jobs: [
    "Allocate limited study hours across multiple syllabi",
    "Track progress and coverage per subject",
    "Adapt plans when unexpected deadlines arise",
  ],
  pains: [
    "Manual schedule rebuilding wastes 30-45 min/week",
    "Missing one day cascades into plan abandonment",
    "Existing tools don't support multi-track study plans",
  ],
  goals: [
    "Clear all exams without burnout",
    "Feel in control of preparation timeline",
    "Spend time studying, not planning",
  ],
  behaviors: [
    "Uses Google Calendar + Notion hybrid system",
    "Studies 2-4 hours daily on weekdays, more on weekends",
    "Switches tools when friction is too high",
  ],
  constraints: [
    "Budget: ≤ ₹150/month",
    "Time to onboard: < 5 minutes",
    "Needs offline-capable app",
  ],
  objections: [
    "Will this actually update when I miss a day?",
    "Why not just use a free app?",
    "I don't want another app that collects my data",
  ],
  evidence_ids: ["ev-01", "ev-02"],
  assumptions: [
    "ASSUMPTION: Willingness to pay ₹99/month if value is clear — not verified",
    "ASSUMPTION: 30-day free trial required — inferred from interview patterns",
  ],
  provenance: "AI_INFERENCE" as const,
};

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    await initDb();
    const { id } = await params;
    const db = getDb();

    // Verify project exists
    const projRes = await db.execute({
      sql: "SELECT id, title, mode FROM projects WHERE id = ?",
      args: [id],
    });
    if (projRes.rows.length === 0) {
      return apiError("PROJECT_NOT_FOUND", `Project '${id}' not found.`, 404);
    }
    const project = projRes.rows[0] as unknown as { id: string; title: string; mode?: string };
    const isDemoProject = id === "proj-study-planner" || project.mode === "DEMO";

    // Fetch brief for problem context
    const briefRes = await db.execute({
      sql: "SELECT problem, target_customer FROM idea_briefs WHERE project_id = ? ORDER BY version DESC LIMIT 1",
      args: [id],
    });
    const brief = briefRes.rows[0] as { problem?: string; target_customer?: string } | undefined;

    // Fetch bounded evidence (max 6 items)
    const evRes = await db.execute({
      sql: `SELECT e.id, e.claim, e.excerpt, e.provenance, s.title as source_title
            FROM evidence e
            LEFT JOIN sources s ON s.id = e.source_id
            WHERE e.project_id = ?
            ORDER BY e.created_at DESC LIMIT 6`,
      args: [id],
    });
    const evidenceItems = evRes.rows;

    const evidenceContext =
      evidenceItems.length > 0
        ? evidenceItems
            .map(
              (e) =>
                `[${e.id}] (${e.provenance}) ${e.source_title || "Source"}: ${e.claim}${e.excerpt ? ` — "${e.excerpt}"` : ""}`
            )
            .join("\n")
        : "No evidence items available. Create a persona hypothesis from the idea brief alone.";

    const outcome = await runInference({
      task: "persona-draft",
      systemFragment: `You are creating a segment hypothesis for a product validation study.
Project: "${project.title}"
Problem statement: "${brief?.problem || "Not specified"}"
Target customer (initial claim): "${brief?.target_customer || "Not specified"}"

Rules:
- Label unknowns as assumptions, not facts.
- Do NOT invent named real people, exact quotations, or specific demographics without evidence.
- Represent this persona as a hypothesis to be tested.
- Surface open questions about the segment in the assumptions field.
- This persona is NOT a real customer — it is a structured hypothesis.`,
      userPrompt: `Evidence records:\n${evidenceContext}\n\nCreate a segment persona hypothesis for this product. Label all unverified claims as assumptions.`,
      schemaDescription: PERSONA_SCHEMA_DESC,
      validate: validatePersona,
      fallback: FALLBACK_PERSONA,
      fallbackProvenance: "SAMPLE",
      temperature: 0.5,
    });

    const isLive = isAiInference(outcome);

    // For live customer projects, offline fallbacks are not permitted to masquerade as research
    if (!isDemoProject && !isLive) {
      const reason = (outcome as { reason?: string }).reason || "Inference failed";
      return apiError(
        "INFERENCE_FAILED",
        `Ollama local inference failed for live project '${id}': ${reason}. Fallbacks are not permitted for live customer persona drafting. Start Ollama and retry.`,
        503,
        true
      );
    }

    const dbProvenance = isLive ? "AI_INFERENCE" : "SAMPLE";

    // Persist to personas table — check if persona with same name already exists for this project (Decision D20)
    const existingRes = await db.execute({
      sql: "SELECT id FROM personas WHERE project_id = ? AND LOWER(name) = LOWER(?) LIMIT 1",
      args: [id, outcome.data.name],
    });

    const existingPersona = existingRes.rows[0];
    const personaId = existingPersona ? (existingPersona.id as string) : `persona-gen-${Date.now()}`;
    const now = new Date().toISOString();

    if (existingPersona) {
      await db.execute({
        sql: `UPDATE personas
              SET segment = ?, context = ?, jobs = ?, pains = ?, goals = ?,
                  behaviors = ?, constraints = ?, objections = ?, assumptions = ?,
                  provenance = ?, created_at = ?
              WHERE id = ?`,
        args: [
          outcome.data.segment,
          outcome.data.context,
          JSON.stringify(outcome.data.jobs),
          JSON.stringify(outcome.data.pains),
          JSON.stringify(outcome.data.goals),
          JSON.stringify(outcome.data.behaviors),
          JSON.stringify(outcome.data.constraints),
          JSON.stringify(outcome.data.objections),
          JSON.stringify(outcome.data.assumptions),
          dbProvenance,
          now,
          personaId,
        ],
      });
    } else {
      await db.execute({
        sql: `INSERT OR IGNORE INTO personas
                (id, project_id, name, segment, context, jobs, pains, goals,
                 behaviors, constraints, objections, assumptions, provenance, created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [
          personaId,
          id,
          outcome.data.name,
          outcome.data.segment,
          outcome.data.context,
          JSON.stringify(outcome.data.jobs),
          JSON.stringify(outcome.data.pains),
          JSON.stringify(outcome.data.goals),
          JSON.stringify(outcome.data.behaviors),
          JSON.stringify(outcome.data.constraints),
          JSON.stringify(outcome.data.objections),
          JSON.stringify(outcome.data.assumptions),
          dbProvenance,
          now,
        ],
      });
    }

    // Reconcile personas stage (Phase 3J)
    await reconcileProjectStages(id);

    return apiSuccess({
      persona: {
        id: personaId,
        projectId: id,
        ...outcome.data,
        provenance: dbProvenance,
      },
      inference: isLive
        ? {
            provenance: "AI_INFERENCE",
            modelName: OLLAMA_MODEL,
            promptVersion: PROMPT_VERSION,
            latencyMs: (outcome as { latencyMs: number }).latencyMs,
            evidenceItemsUsed: evidenceItems.length,
          }
        : {
            provenance: "SAMPLE",
            reason: (outcome as { reason: string }).reason,
            mode: "fixture_fallback",
          },
      caveat:
        "⚠️ AI_INFERENCE or SAMPLE ARTIFACT — This persona is a structured hypothesis, not real customer data. Validate with real interviews before making strategic decisions.",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("POST /api/projects/[id]/personas/generate error:", msg);
    return apiError("INFERENCE_ERROR", msg, 500);
  }
}
