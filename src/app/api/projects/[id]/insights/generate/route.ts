/**
 * POST /api/projects/[id]/insights/generate
 *
 * Synthesizes an Insight from project evidence using Ollama local inference.
 * Tags output AI_INFERENCE when live, SAMPLE when Ollama is offline.
 * Stores result in insights table with full provenance metadata.
 *
 * Request body (all optional):
 *   { insightType?: "theme"|"contradiction"|"open_question" }
 */
import { NextRequest } from "next/server";
import { initDb, getDb } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { reconcileProjectStages } from "@/lib/stageReconciliation";
import {
  runInference,
  validateInsight,
  INSIGHT_SCHEMA_DESC,
  isAiInference,
  OLLAMA_MODEL,
  PROMPT_VERSION,
} from "@/lib/ollama";
import { isPlaceholderEvidence } from "@/lib/evidenceValidation";
import {
  normalizeInsightStatement,
  containsPlaceholderStatistics,
  isPlaceholderBackedInsight,
  sanitizeInsightStatement,
  sanitizeInsightCaveat,
} from "@/lib/insightValidation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Sample fallback insight
const FALLBACK_INSIGHT = {
  statement:
    "[Unverified Sample Claim — Demo Placeholder Metric] Students with 2+ concurrent exam tracks are willing to pay for auto-rescheduling but require a 30-day free trial before committing.",
  type: "theme" as const,
  confidence: "low" as const,
  evidence_for_ids: ["ev-001", "ev-002"],
  evidence_against_ids: [],
  caveat:
    "⚠️ UNVERIFIED SAMPLE CLAIM: Relies on illustrative demo placeholder fixtures/metrics (RFC 2606 example domains). Must NOT be cited as established customer evidence or market validation.",
  provenance: "AI_INFERENCE" as const,
};

function buildLiveInsightFallback(
  projectTitle: string,
  brief: { problem?: string; target_customer?: string } | undefined,
  evidenceItems: any[],
  insightType: string
) {
  const topEv = evidenceItems.length > 0 ? evidenceItems[0] : null;
  const statement = topEv
    ? `Preliminary research signal: Target customers (${brief?.target_customer || "users"}) experiencing "${brief?.problem || "operational friction"}" indicate key problem patterns, noting: "${String(topEv.claim || "").slice(0, 140)}".`
    : `Preliminary hypothesis: Target customers (${brief?.target_customer || "users"}) require a structured solution for "${brief?.problem || "the core problem"}", pending empirical customer discovery.`;

  const validTypes = ["theme", "contradiction", "open_question"] as const;
  const safeType = validTypes.includes(insightType as any) ? (insightType as (typeof validTypes)[number]) : "theme";

  return {
    statement,
    type: safeType,
    confidence: "low" as const,
    evidence_for_ids: topEv ? [String(topEv.id)] : [],
    evidence_against_ids: [],
    caveat: topEv
      ? `Offline synthesis fallback grounded in project problem statement and evidence [${topEv.id}]. Must be verified directly with primary customer interviews.`
      : "Offline synthesis fallback derived from idea brief alone. Requires empirical customer evidence.",
    provenance: "AI_INFERENCE" as const,
  };
}

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

    const body = await req.json().catch(() => ({}));
    const rawType = String(body.insightType || "theme").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const insightType: "theme" | "contradiction" | "open_question" =
      rawType === "contradiction" || rawType === "open_question" ? rawType : "theme";

    // Fetch bounded evidence context (max 8 items to keep prompt size bounded)
    // Filter to eligible evidence under the Human Review Gate (F06: ACCEPTED or EDITED)
    const evRes = await db.execute({
      sql: `SELECT e.id, e.claim, e.excerpt, e.provenance, e.confidence, e.reviewer_status,
                   s.title as source_title, s.url as source_url, s.source_type as source_type_resolved
            FROM evidence e
            LEFT JOIN sources s ON s.id = e.source_id
            WHERE e.project_id = ? AND e.reviewer_status IN ('ACCEPTED', 'EDITED')
            ORDER BY e.created_at DESC LIMIT 8`,
      args: [id],
    });
    const evidenceItems = evRes.rows;

    if (!isDemoProject && evidenceItems.length === 0) {
      return apiError(
        "NO_ELIGIBLE_EVIDENCE",
        `Project '${id}' has no accepted evidence under the human review gate. Review and accept evidence before generating insights.`,
        400
      );
    }

    const hasOnlyPlaceholders = evidenceItems.length > 0 && evidenceItems.every((e: any) => isPlaceholderEvidence(e));

    const evidenceContext =
      evidenceItems.length > 0
        ? evidenceItems
            .map((e: any) => {
              const placeholderTag = isPlaceholderEvidence(e) ? " [SAMPLE - UNVERIFIED PLACEHOLDER FIXTURE (NOT EMPIRICAL FACT)]" : "";
              return `[${e.id}] (${e.provenance}${placeholderTag}) ${e.source_title || "Source"}: ${e.claim}${e.excerpt ? ` — "${e.excerpt}"` : ""}`;
            })
            .join("\n")
        : "No evidence items found for this project. Reason about the idea brief alone.";

    const evidenceIds = evidenceItems.map((e) => String(e.id));

    // Attempt Ollama inference
    const chosenFallback = isDemoProject
      ? FALLBACK_INSIGHT
      : buildLiveInsightFallback(project.title, brief, evidenceItems, insightType);

    const outcome = await runInference({
      task: "insight-synthesis",
      systemFragment: `You are synthesizing a research insight for a product validation study.
Project: "${project.title}"
Problem statement: "${brief?.problem || "Not specified"}"
Target customer: "${brief?.target_customer || "Not specified"}"

Insight type requested: ${insightType}

Rules:
- Use ONLY the supplied evidence records listed below. Do not create sources.
- Separate source facts from your interpretation.
- Include disagreements, gaps, and evidence IDs.
- Return a single ${insightType} insight, not a list.
- CRITICAL STATISTIC INTEGRITY RULE: Any numbers, percentages, or metrics from [SAMPLE - UNVERIFIED PLACEHOLDER FIXTURE] sources (e.g. 68% cramming, 82% abandonment, 6x monetization) are fictional demo placeholders, NOT established facts.
- DO NOT use or cite placeholder fixture metrics as factual premises in your insight statement.
- Where possible, separate supportable qualitative findings from unsupported numerical claims without changing their meaning.
- If referencing findings from real academic studies (e.g. 74% anxiety in board exam students), accurately qualify the demographic cohort in the caveat rather than generalizing prematurely.
- If evidence is insufficient or backed by placeholder sources, set confidence to "Low" and state caveat clearly.`,
      userPrompt: `Evidence records:\n${evidenceContext}\n\nSynthesize one "${insightType}" insight from this evidence. Prioritize verified real evidence and supportable qualitative findings.`,
      schemaDescription: INSIGHT_SCHEMA_DESC,
      validate: validateInsight,
      fallback: chosenFallback,
      fallbackProvenance: isDemoProject ? "SAMPLE" : "SIMULATED",
      temperature: 0.35,
    });

    const isLive = isAiInference(outcome);
    const dbProvenance = outcome.provenance;

    // For live customer projects, offline fallbacks are not permitted to masquerade as synthesis
    if (!isDemoProject && !isLive) {
      const reason = (outcome as { reason?: string }).reason || "Inference failed";
      return apiError(
        "INFERENCE_FAILED",
        `Ollama local inference failed for live project '${id}': ${reason}. Fallbacks are not permitted for live customer synthesis.`,
        503,
        true
      );
    }

    const validEvidenceIds = new Set(evidenceItems.map((e: any) => String(e.id)));
    let evidenceForIds = isLive
      ? (outcome.data as { evidence_for_ids: string[] }).evidence_for_ids.filter((eid: string) => validEvidenceIds.has(eid))
      : (chosenFallback.evidence_for_ids || evidenceIds);
    if (evidenceForIds.length === 0 && evidenceItems.length > 0) {
      evidenceForIds = evidenceItems.map((e: any) => String(e.id));
    }
    const evidenceAgainstIds = isLive
      ? (outcome.data as { evidence_against_ids: string[] }).evidence_against_ids.filter((eid: string) => validEvidenceIds.has(eid))
      : [];

    const isPlaceholder = isDemoProject
      ? (!isLive ||
         hasOnlyPlaceholders ||
         isPlaceholderBackedInsight({
           provenance: dbProvenance,
           evidence_for_ids: evidenceForIds,
           statement: outcome.data.statement,
           caveat: outcome.data.caveat,
         }))
      : (hasOnlyPlaceholders ||
         isPlaceholderBackedInsight({
           provenance: dbProvenance,
           evidence_for_ids: evidenceForIds,
           statement: outcome.data.statement,
           caveat: outcome.data.caveat,
         }));

    const sanitizedStatement = sanitizeInsightStatement(outcome.data.statement, isPlaceholder);
    const rawConf = String(outcome.data.confidence || "Medium").toLowerCase();
    const dbConfidence = isPlaceholder ? "Low" : (rawConf === "high" ? "High" : rawConf === "low" ? "Low" : "Medium");
    const dbCaveat = sanitizeInsightCaveat(outcome.data.caveat, isPlaceholder);

    // Persist to insights table — check if matching normalized statement or matching generated slot exists (Decision D21)
    const existingInsightsRes = await db.execute({
      sql: "SELECT id, type, statement, evidence_for_ids FROM insights WHERE project_id = ?",
      args: [id],
    });

    const normNew = normalizeInsightStatement(sanitizedStatement);
    let existingRow = existingInsightsRes.rows.find((r: any) =>
      normalizeInsightStatement(String(r.statement)) === normNew
    );

    // If no exact statement match, check if there is an existing generated insight of the same type and matching evidence set to update in-place
    if (!existingRow && outcome.data.type) {
      const newEvStr = JSON.stringify(evidenceForIds);
      existingRow = existingInsightsRes.rows.find((r: any) => {
        if (!String(r.id).startsWith("insight-gen-")) return false;
        if (r.type !== outcome.data.type) return false;
        return r.evidence_for_ids === newEvStr;
      });
    }

    const insightId = existingRow ? (existingRow.id as string) : `insight-gen-${Date.now()}`;
    const now = new Date().toISOString();

    if (existingRow) {
      await db.execute({
        sql: `UPDATE insights
              SET statement = ?, type = ?, confidence = ?, evidence_for_ids = ?,
                  evidence_against_ids = ?, caveat = ?, provenance = ?, created_at = ?
              WHERE id = ?`,
        args: [
          sanitizedStatement,
          outcome.data.type,
          dbConfidence,
          JSON.stringify(evidenceForIds),
          JSON.stringify(evidenceAgainstIds),
          dbCaveat,
          dbProvenance,
          now,
          insightId,
        ],
      });
    } else {
      await db.execute({
        sql: `INSERT INTO insights
                (id, project_id, statement, type, confidence, evidence_for_ids,
                 evidence_against_ids, caveat, provenance, created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)`,
        args: [
          insightId,
          id,
          sanitizedStatement,
          outcome.data.type,
          dbConfidence,
          JSON.stringify(evidenceForIds),
          JSON.stringify(evidenceAgainstIds),
          dbCaveat,
          dbProvenance,
          now,
        ],
      });
    }

    // Reconcile insights stage (Phase 3J)
    await reconcileProjectStages(id);

    return apiSuccess({
      insight: {
        id: insightId,
        projectId: id,
        ...outcome.data,
        statement: sanitizedStatement,
        confidence: dbConfidence,
        caveat: dbCaveat,
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
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("POST /api/projects/[id]/insights/generate error:", msg);
    return apiError("INFERENCE_ERROR", msg, 500);
  }
}
