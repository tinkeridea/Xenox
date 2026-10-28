import { NextRequest } from "next/server";
import { initDb, getDb, nowUtc } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { runInference, validateExperiment, EXPERIMENT_SCHEMA_DESC, isAiInference, type ExperimentSchema } from "@/lib/ollama";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const EXPERIMENT_FALLBACKS: ExperimentSchema[] = [
  {
    hypothesis: "If we offer automated 1-click schedule rebalancing via WhatsApp, at least 40% of active college students will complete 3+ study blocks per week.",
    method: "Concierge MVP / WhatsApp Bot",
    cohort: "College undergraduate students preparing for midterms (n=30)",
    metric: "Weekly study block completion rate",
    threshold: ">= 40% completion rate over 14 days",
    duration: "2 weeks",
    cost_estimate: "$0 (manual WhatsApp messaging + Google Sheets)",
    decision_rules: {
      continue: "Completion rate >= 40% and 5+ students request it for finals week",
      pivot: "Completion rate 20-39% — interview dropouts on friction points",
      stop: "Completion rate < 20% or high unsubscribe rate (> 30%)",
    },
    ethical_notes: [
      "Explicit opt-in required for WhatsApp notifications",
      "No academic grades or identifying student IDs collected",
    ],
    linked_assumption_ids: [],
  },
  {
    hypothesis: "If we present a landing page with a 3-minute schedule quiz, >= 15% of visiting students will submit their email to join the private beta.",
    method: "Smoke Test Landing Page",
    cohort: "Student community traffic from Reddit r/studytips and university Discord servers (target n=200 visitors)",
    metric: "Landing page conversion rate (email submissions / unique visitors)",
    threshold: ">= 15% conversion rate",
    duration: "7 days",
    cost_estimate: "$15 (custom domain / basic hosting)",
    decision_rules: {
      continue: "Conversion >= 15% with >= 30 qualified email signups",
      pivot: "Conversion 8-14% — A/B test hero headline focusing on exam panic vs daily organization",
      stop: "Conversion < 8% after 200 visitors — reconsider core value proposition",
    },
    ethical_notes: [
      "Clear disclaimer that product is in development (no fake checkout)",
      "Instant confirmation email explaining timeline",
    ],
    linked_assumption_ids: [],
  },
];

function buildLiveExperimentFallback(
  projectTitle: string,
  brief: { problem?: string; target_customer?: string; solution?: string } | undefined,
  assumption: { id: string; statement: string; category: string; impact: string; uncertainty: string } | null,
  requestedMethod?: string
): ExperimentSchema {
  const targetCohort = brief?.target_customer
    ? `${brief.target_customer} (target n=30)`
    : "Early adopter customer cohort (target n=30)";
  const method = requestedMethod || "Concierge MVP / Direct Customer Outreach";

  const hypothesis = assumption
    ? `If we provide a concierge prototype of ${brief?.solution || projectTitle} to test "${assumption.statement}", at least 30% of ${brief?.target_customer || "target customers"} will complete the target workflow.`
    : `If we offer early access to ${brief?.solution || projectTitle} addressing "${brief?.problem || 'the core problem'}", at least 25% of ${brief?.target_customer || "prospective users"} will commit to an initial trial.`;

  return {
    hypothesis,
    method,
    cohort: targetCohort,
    metric: "Completed customer workflow / trial conversion rate",
    threshold: ">= 30% positive conversion",
    duration: "7 days",
    cost_estimate: "$0 (manual concierge outreach)",
    decision_rules: {
      continue: "Conversion >= 30% with clear qualitative willingness to pay/use",
      pivot: "Conversion 15-29% — conduct friction interviews on core blockers",
      stop: "Conversion < 15% — re-evaluate problem urgency and target customer definition",
    },
    ethical_notes: [
      "Explicit informed consent required from all student/user participants",
      "No payment processed or sensitive personal credentials collected during concierge test",
    ],
    linked_assumption_ids: assumption ? [assumption.id] : [],
  };
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    await initDb();
    const { id } = await params;
    const db = getDb();

    // Verify project exists
    const projRes = await db.execute({
      sql: "SELECT title, mode FROM projects WHERE id = ?",
      args: [id],
    });
    if (projRes.rows.length === 0) {
      return apiError("PROJECT_NOT_FOUND", `Project '${id}' not found.`, 404);
    }
    const project = projRes.rows[0] as unknown as { title: string; mode?: string };
    const isDemoProject = id === "proj-study-planner" || project.mode === "DEMO";

    const body = await req.json().catch(() => ({}));
    const requestedAssumptionId: string = typeof body.assumptionId === "string" ? body.assumptionId.trim() : "";
    const requestedMethod: string = typeof body.method === "string" ? body.method.trim() : "";

    // Find linked assumption if provided, or pick highest risk unvalidated assumption
    let assumption: { id: string; statement: string; category: string; impact: string; uncertainty: string } | null = null;

    if (requestedAssumptionId) {
      const asmRes = await db.execute({
        sql: "SELECT id, statement, category, impact, uncertainty FROM assumptions WHERE id = ? AND project_id = ?",
        args: [requestedAssumptionId, id],
      });
      if (asmRes.rows.length > 0) {
        assumption = asmRes.rows[0] as any;
      }
    }

    if (!assumption) {
      const topAsmRes = await db.execute({
        sql: `SELECT id, statement, category, impact, uncertainty
              FROM assumptions
              WHERE project_id = ? AND status = 'unvalidated'
              ORDER BY
                CASE uncertainty WHEN 'Critical' THEN 4 WHEN 'High' THEN 3 WHEN 'Medium' THEN 2 ELSE 1 END DESC,
                CASE impact WHEN 'High' THEN 3 WHEN 'Medium' THEN 2 ELSE 1 END DESC
              LIMIT 1`,
        args: [id],
      });
      if (topAsmRes.rows.length > 0) {
        assumption = topAsmRes.rows[0] as any;
      }
    }

    // Load idea brief for context
    const briefRes = await db.execute({
      sql: "SELECT problem, target_customer, solution, category FROM idea_briefs WHERE project_id = ? ORDER BY version DESC LIMIT 1",
      args: [id],
    });
    const brief = briefRes.rows[0] as { problem?: string; target_customer?: string; solution?: string } | undefined;

    const systemFragment = `You are a lean startup experimental design specialist.
Your goal is to design a high-signal, falsifiable experiment with explicit quantitative thresholds and actionable decision rules.
A plan is not a result — never fabricate experimental results.
Focus on cheap, ethical, fast testing methods (concierge, smoke test, Wizard of Oz, interviews, prototype walkthrough).`;

    const assumptionContext = assumption
      ? `Critical Assumption to test: "${assumption.statement}" (Category: ${assumption.category}, Impact: ${assumption.impact}, Uncertainty: ${assumption.uncertainty})`
      : `General Idea Validation: Test whether customers genuinely experience "${brief?.problem || 'the core problem'}"`;

    const userPrompt = `Project: ${project.title}
Problem: ${brief?.problem || "not specified"}
Target customer: ${brief?.target_customer || "not specified"}
Proposed solution: ${brief?.solution || "not specified"}

${assumptionContext}
${requestedMethod ? `Preferred experiment method: ${requestedMethod}` : ""}

Design a concrete, falsifiable experiment to test this assumption.
Requirements:
1. Hypothesis must follow "If we [action/test], then [expected user behavior/signal]".
2. Method must be realistic and cheap to run before writing production code.
3. Metric and threshold must be unambiguous quantitative targets.
4. Decision rules must have clear continue, pivot, and stop conditions.

Return a JSON object conforming exactly to the schema.`;

    const fallbackIndex = Math.floor(Math.random() * EXPERIMENT_FALLBACKS.length);
    const chosenFallback: ExperimentSchema = isDemoProject
      ? {
          ...EXPERIMENT_FALLBACKS[fallbackIndex],
          linked_assumption_ids: assumption ? [assumption.id] : [],
        }
      : buildLiveExperimentFallback(project.title, brief, assumption, requestedMethod);

    const outcome = await runInference<ExperimentSchema>({
      task: "experiment-planner",
      systemFragment,
      userPrompt,
      schemaDescription: EXPERIMENT_SCHEMA_DESC,
      validate: validateExperiment,
      fallback: chosenFallback,
      fallbackProvenance: "SAMPLE",
    });

    const isLive = isAiInference(outcome);

    // For live customer projects, offline fallbacks are not permitted to masquerade as research or planning
    if (!isDemoProject && !isLive) {
      const reason = (outcome as { reason?: string }).reason || "Inference failed";
      return apiError(
        "INFERENCE_FAILED",
        `Ollama local inference failed for live project '${id}': ${reason}. Fallbacks are not permitted for live customer experiment planning. Start Ollama and retry.`,
        503,
        true
      );
    }

    const dbProvenance = isLive ? "AI_INFERENCE" : "SAMPLE";
    const exp = outcome.data;
    const now = nowUtc();
    const expId = `exp-ai-${Date.now().toString(36)}`;
    const linkedAssumptionId = assumption?.id || null;

    const decisionRulesJson = typeof exp.decision_rules === "object"
      ? JSON.stringify(exp.decision_rules)
      : JSON.stringify({ continue: "", pivot: "", stop: "" });

    // Persist to SQLite
    await db.execute({
      sql: `INSERT INTO experiments
              (id, project_id, assumption_id, hypothesis, method, cohort, metric, threshold,
               duration, cost_estimate, decision_rules, status, provenance, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?)`,
      args: [
        expId,
        id,
        linkedAssumptionId,
        exp.hypothesis,
        exp.method || "Prototype Test",
        exp.cohort || "Early adopters",
        exp.metric || "Conversion rate",
        exp.threshold || ">= 30%",
        exp.duration || "2 weeks",
        exp.cost_estimate || "$0",
        decisionRulesJson,
        dbProvenance,
        now,
      ],
    });

    // If linked to an assumption and that assumption was unvalidated, update assumption status to 'testing'
    if (linkedAssumptionId) {
      await db.execute({
        sql: "UPDATE assumptions SET status = 'testing' WHERE id = ? AND status = 'unvalidated'",
        args: [linkedAssumptionId],
      });
    }

    const created = await db.execute({
      sql: `SELECT e.*, a.statement as assumption_statement
            FROM experiments e
            LEFT JOIN assumptions a ON e.assumption_id = a.id
            WHERE e.id = ?`,
      args: [expId],
    });

    return apiSuccess({
      experiment: created.rows[0],
      linkedAssumption: assumption,
      provenance: dbProvenance,
      latencyMs: isLive ? outcome.latencyMs : null,
      inference: {
        provenance: outcome.provenance,
        latencyMs: isLive ? outcome.latencyMs : null,
        reason: !isLive ? (outcome as any).reason : null,
        fallbackAt: !isLive ? (outcome as any).fallbackAt : null,
      },
    }, dbProvenance, 201);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("POST /api/projects/[id]/experiments/generate error:", msg);
    return apiError("EXPERIMENT_GENERATE_FAILED", msg, 500);
  }
}
