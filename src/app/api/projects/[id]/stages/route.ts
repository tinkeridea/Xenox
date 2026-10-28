import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { reconcileProjectStages } from "@/lib/stageReconciliation";
import {
  isPresentationDemoMode,
  getPresentationDemoFixture,
  presentationReadOnlyResponse,
} from "@/lib/presentationMode";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/projects/[id]/stages — Reconcile and return persisted stages for a project
export async function GET(req: NextRequest, { params }: RouteParams) {
  if (isPresentationDemoMode()) {
    const { id } = await params;
    const fixture = getPresentationDemoFixture(`/api/projects/${encodeURIComponent(id)}/stages`);
    if (fixture) return fixture;
    return apiError("PROJECT_NOT_FOUND", `Project '${id}' not found.`, 404);
  }

  try {
    const { id } = await params;
    const result = await reconcileProjectStages(id);
    return apiSuccess(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) {
      return apiError("PROJECT_NOT_FOUND", msg, 404);
    }
    console.error("GET /api/projects/[id]/stages error:", msg);
    return apiError("STAGE_RECONCILIATION_FAILED", msg, 500);
  }
}

// POST /api/projects/[id]/stages — Explicit reconciliation trigger
export async function POST(req: NextRequest, { params }: RouteParams) {
  if (isPresentationDemoMode()) {
    return presentationReadOnlyResponse();
  }

  try {
    const { id } = await params;
    const result = await reconcileProjectStages(id);
    return apiSuccess(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) {
      return apiError("PROJECT_NOT_FOUND", msg, 404);
    }
    console.error("POST /api/projects/[id]/stages error:", msg);
    return apiError("STAGE_RECONCILIATION_FAILED", msg, 500);
  }
}
