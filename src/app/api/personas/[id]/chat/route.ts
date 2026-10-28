import { NextRequest } from "next/server";
import { initDb, getDb, nowUtc } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { reconcileProjectStages } from "@/lib/stageReconciliation";
import {
  runInference,
  validatePersonaChat,
  PERSONA_CHAT_SCHEMA_DESC,
  isAiInference,
  OLLAMA_MODEL,
  PROMPT_VERSION,
} from "@/lib/ollama";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Keyword-matched fixture fallback replies per persona
const PERSONA_REPLIES: Record<string, Record<string, string>> = {
  "persona-01": {
    pay: "₹99 a month is tough on my pocket money. If my marks actually improve, maybe my parents would sponsor it. But I'd need to try it for free first.",
    setup: "Exams are in 18 days. If setup takes more than 2 minutes I'll delete the app immediately. I just want to enter dates and get study blocks.",
    miss: "That's exactly why I gave up on Notion. When I miss one day, everything falls behind and I abandon the plan. An auto-reschedule that doesn't make me feel guilty would actually help.",
    privacy: "I don't really care about cloud servers as long as my friends can't see my mock exam marks.",
    default: "Bro honestly, I'm stressed about clearing my 2 backlogs. If an app genuinely cuts down my panic study sessions at 2am, I'd give it a shot.",
  },
  "persona-02": {
    pay: "I'd pay ₹99/month if it genuinely saved me the 45 minutes I spend every Sunday manually rebuilding my schedule. But I'd want a 30-day trial first.",
    setup: "I'm juggling B.Com and CA Foundation prep. I need to be able to enter two completely different syllabus tracks without them colliding.",
    miss: "When unexpected college submissions come up, my CA study hours take a hit. I need an app that warns me when my weekly CA minimum drops below 15 hours.",
    privacy: "I'm very cautious about data privacy. I don't want my academic records or study habits stored on some third-party cloud database.",
    default: "I already have a working system with Google Calendar and Notion. Any new tool has to be substantially better, not just another flashy timer.",
  },
};

function getFixtureReply(personaId: string, message: string): string {
  const lower = message.toLowerCase();
  const replies = PERSONA_REPLIES[personaId] || PERSONA_REPLIES["persona-01"];
  if (lower.includes("pay") || lower.includes("price") || lower.includes("cost") || lower.includes("₹") || lower.includes("money")) return replies.pay;
  if (lower.includes("setup") || lower.includes("configure") || lower.includes("start") || lower.includes("onboard")) return replies.setup;
  if (lower.includes("miss") || lower.includes("skip") || lower.includes("fail") || lower.includes("delay")) return replies.miss;
  if (lower.includes("privacy") || lower.includes("data") || lower.includes("cloud") || lower.includes("secure")) return replies.privacy;
  return replies.default;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    await initDb();
    const { id } = await params;
    const db = getDb();

    // Verify persona exists
    const pRes = await db.execute({
      sql: "SELECT * FROM personas WHERE id = ?",
      args: [id],
    });

    if (pRes.rows.length === 0) {
      return apiError("PERSONA_NOT_FOUND", `Persona '${id}' not found.`, 404);
    }
    const persona = pRes.rows[0];
    const personaProjectId = persona.project_id as string;

    // Verify project exists
    const projRes = await db.execute({
      sql: "SELECT id FROM projects WHERE id = ?",
      args: [personaProjectId],
    });
    if (projRes.rows.length === 0) {
      return apiError("PROJECT_NOT_FOUND", `Project '${personaProjectId}' for persona '${id}' not found.`, 404);
    }

    const body = await req.json().catch(() => ({}));

    // Verify cross-project isolation: if projectId is provided, it must match persona's project
    if (body.projectId) {
      const reqProjectId = String(body.projectId).trim();
      if (reqProjectId && reqProjectId !== personaProjectId) {
        return apiError(
          "PROJECT_MISMATCH",
          `Persona '${id}' belongs to project '${personaProjectId}', not '${reqProjectId}'. Cross-project chat is forbidden.`,
          403
        );
      }
    }

    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      return apiError("VALIDATION_ERROR", "Field 'message' is required and cannot be empty.", 400);
    }

    const conversationId = (
      typeof body.sessionId === "string" && body.sessionId.trim()
        ? body.sessionId.trim()
        : typeof body.conversationId === "string" && body.conversationId.trim()
        ? body.conversationId.trim()
        : `chat-${id}-${Date.now()}`
    );

    // Check if interview session already exists
    const existingIvRes = await db.execute({
      sql: "SELECT id, project_id, persona_id FROM interviews WHERE id = ?",
      args: [conversationId],
    });

    if (existingIvRes.rows.length > 0) {
      const existingIv = existingIvRes.rows[0];
      if (existingIv.project_id !== personaProjectId) {
        return apiError(
          "PROJECT_MISMATCH",
          `Session '${conversationId}' belongs to project '${existingIv.project_id}', not '${personaProjectId}'.`,
          403
        );
      }
    }

    const userTurnId = `turn-u-${Date.now()}`;
    const replyTurnId = `turn-a-${Date.now() + 1}`;

    // Build persona context for Ollama prompt
    const personaContext = `
Persona: ${persona.name}
Segment: ${persona.segment}
Context: ${persona.context || "Student studying for competitive exams"}
`.trim();

    const fixtureFallback = {
      reply: getFixtureReply(id, message),
      sentiment: "skeptical" as const,
      revealed_concern: null,
      simulation_note:
        "SIMULATED — fixture reply. This is NOT real customer evidence. Ollama offline.",
    };

    // Attempt real Ollama inference
    const outcome = await runInference({
      task: "persona-chat",
      systemFragment: `You are roleplaying as a SIMULATED interview subject. 
Persona profile: ${personaContext}
This is a role-play exercise for product validation. You are NOT a real customer. Your responses explore plausible objections.
Never claim to be a real person or to have lived experience. Surface uncertainty. Be concise (2-4 sentences).`,
      userPrompt: `The product founder asks: "${message}"
      
Respond in character as this persona. Be authentic to their profile, surface real concerns, and be honest about objections.`,
      schemaDescription: PERSONA_CHAT_SCHEMA_DESC,
      validate: validatePersonaChat,
      fallback: fixtureFallback,
      fallbackProvenance: "SIMULATED",
      temperature: 0.65,
    });

    // Determine provenance and reply text
    const isLive = isAiInference(outcome);
    const replyText = outcome.data.reply;
    const dbProvenance = isLive ? "AI_INFERENCE" : "SIMULATED";
    const modelUsed = isLive ? OLLAMA_MODEL : "fixture_fallback";

    // Atomically create simulated interview session (if new) and persist turns
    const batchStatements: Array<{ sql: string; args: any[] }> = [];

    if (existingIvRes.rows.length === 0) {
      const scenarioText =
        typeof body.scenario === "string" && body.scenario.trim()
          ? body.scenario.trim()
          : `Interactive simulated interview session with ${persona.name} (${persona.segment || "Target Segment"}).`;

      batchStatements.push({
        sql: `INSERT OR IGNORE INTO interviews (id, project_id, persona_id, scenario, provenance, model, prompt_version, created_at)
              VALUES (?, ?, ?, ?, 'SIMULATED', ?, ?, ?)`,
        args: [
          conversationId,
          personaProjectId,
          id,
          scenarioText,
          modelUsed,
          PROMPT_VERSION,
          nowUtc(),
        ],
      });
    }

    batchStatements.push({
      sql: "INSERT INTO turns (id, conversation_id, role, text, provenance) VALUES (?,?,?,?,?)",
      args: [userTurnId, conversationId, "user", message, "USER_INPUT"],
    });
    batchStatements.push({
      sql: "INSERT INTO turns (id, conversation_id, role, text, provenance) VALUES (?,?,?,?,?)",
      args: [replyTurnId, conversationId, "assistant", replyText, dbProvenance],
    });

    await db.batch(batchStatements);

    // Trigger stage reconciliation for the project
    let reconcileResult = null;
    try {
      reconcileResult = await reconcileProjectStages(personaProjectId);
    } catch (reconcileErr) {
      console.error("Stage reconciliation error during persona chat:", reconcileErr);
    }

    return apiSuccess({
      conversationId,
      interviewId: conversationId,
      userTurn: { id: userTurnId, role: "user", text: message },
      assistantTurn: {
        id: replyTurnId,
        role: "assistant",
        text: replyText,
        personaId: id,
        personaName: persona.name,
        sentiment: outcome.data.sentiment,
        revealed_concern: outcome.data.revealed_concern,
      },
      inference: isLive
        ? {
            provenance: "AI_INFERENCE",
            modelName: OLLAMA_MODEL,
            promptVersion: PROMPT_VERSION,
            latencyMs: (outcome as { latencyMs: number }).latencyMs,
          }
        : {
            provenance: "SIMULATED",
            reason: (outcome as { reason: string }).reason,
            mode: "fixture_fallback",
          },
      reconciledStages: reconcileResult
        ? {
            completedStagesCount: reconcileResult.completedStagesCount,
            runStatus: reconcileResult.runStatus,
          }
        : null,
      caveat:
        "⚠️ SIMULATED ARTIFACT — All dialogue is generated hypothesis exploring customer objections. NEVER use synthetic dialogue as proof of customer demand.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("POST /api/personas/[id]/chat error:", message);
    return apiError("CHAT_ERROR", message, 500);
  }
}


