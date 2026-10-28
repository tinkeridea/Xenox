import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isPresentationDemoMode, presentationReadOnlyResponse } from "@/lib/presentationMode";

export function middleware(req: NextRequest) {
  // Enforce read-only presentation demo mode server-side for all mutation endpoints
  if (isPresentationDemoMode()) {
    const method = req.method.toUpperCase();
    if (["POST", "PATCH", "DELETE", "PUT"].includes(method)) {
      if (req.nextUrl.pathname.startsWith("/api/")) {
        return presentationReadOnlyResponse();
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
