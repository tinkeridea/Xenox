import { NextRequest } from "next/server";
import { apiError } from "@/lib/apiResponse";
import { delegateToFastAPI } from "@/lib/fastapiProxy";
import { getReportHistoryFromDb } from "../route";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export { getReportHistoryFromDb };

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    return await delegateToFastAPI(req, `/api/projects/${encodeURIComponent(id)}/report/history`);
  } catch (err: unknown) {
    console.error("GET /api/projects/[id]/report/history proxy error:", err);
    return apiError("INTERNAL_ERROR", "Failed to retrieve project report history.", 500);
  }
}
