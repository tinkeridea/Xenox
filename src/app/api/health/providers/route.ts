import { NextRequest } from "next/server";
import { initDb, getDb, reseedDemoFixtures } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { checkOllamaHealth } from "@/lib/ollama";
import { checkTinyFishHealth } from "@/lib/tinyfish";
import { delegateToFastAPI } from "@/lib/fastapiProxy";

/**
 * ROLLBACK PATH: Original TypeScript provider health check implementation.
 * To rollback Slice 1AG delegation back to direct TypeScript execution:
 * Replace `return await delegateToFastAPI(...)` in GET with `return await getProvidersHealthFromTs();`
 */
export async function getProvidersHealthFromTs() {
  let dbStatus = "healthy";
  let projectCount = 0;

  try {
    await initDb();
    const db = getDb();
    const res = await db.execute("SELECT COUNT(*) as count FROM projects");
    projectCount = Number(res.rows[0]?.count || 0);
  } catch {
    dbStatus = "error";
  }

  // Use shared Ollama and TinyFish adapters for health detection
  const [ollamaHealth, tinyfishHealth] = await Promise.all([
    checkOllamaHealth(),
    checkTinyFishHealth(),
  ]);

  return apiSuccess({
    database: {
      driver: "@libsql/client (local SQLite)",
      status: dbStatus,
      total_projects: projectCount,
    },
    inference: {
      provider: "ollama",
      baseUrl: ollamaHealth.baseUrl,
      targetModel: ollamaHealth.targetModel,
      status: ollamaHealth.status,
      latencyMs: ollamaHealth.latencyMs,
      availableModels: ollamaHealth.availableModels,
      checkedAt: ollamaHealth.checkedAt,
      note: `Local CPU inference (Decision D09: ${ollamaHealth.targetModel}). Never upload customer prompts to public clouds.`,
    },
    research: tinyfishHealth,
    provenance_policy: {
      strict_enforcement: true,
      simulation_rule: "Simulated interviews/personas are NEVER customer evidence.",
      allowed_types: [
        "USER_INPUT",
        "REAL_SOURCE",
        "AI_INFERENCE",
        "SIMULATED",
        "SAMPLE",
        "REAL_EXPERIMENT_RESULT",
      ],
    },
  });
}

// GET /api/health/providers — Returns availability and configured model labels (no secrets)
export async function GET(req: NextRequest) {
  try {
    return await delegateToFastAPI(req, "/api/health/providers", { timeoutMs: 6000 });
  } catch (err: unknown) {
    console.error("GET /api/health/providers proxy error:", err);
    return apiError("INTERNAL_ERROR", "Failed to retrieve provider health status.", 500);
  }
}

// POST /api/health/providers — Reseed demo fixtures idempotently for live rehearsal
export async function POST(req: NextRequest) {
  try {
    await initDb();
    const body = await req.json().catch(() => ({}));
    if (body.action === "reseed" || body.action === "reset_demo") {
      await reseedDemoFixtures();
      return apiSuccess({ message: "Demo fixtures reseeded successfully.", action: body.action });
    }
    return apiError("INVALID_ACTION", "Supported actions: 'reseed'", 400);
  } catch (err: any) {
    console.error("POST /api/health/providers error:", err);
    return apiError("RESEED_FAILED", err.message, 500);
  }
}

