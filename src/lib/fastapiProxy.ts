/**
 * IdeaProbe — Reusable Method-Aware FastAPI Proxy Helper
 *
 * Safely delegates authorized HTTP methods (strictly GET in Slice 1R)
 * from Next.js App Router route handlers to the local FastAPI backend.
 *
 * Constraints:
 * 1. Fixed upstream origin: http://127.0.0.1:8000 (cannot be overridden).
 * 2. Method safety: Only GET requests are permitted. Non-GET methods return HTTP 405.
 * 3. Preserves query string names, values, repeated parameters, and URL encoding.
 * 4. Header filtering: Strips hop-by-hop and sensitive headers (cookie, auth) both upstream and downstream.
 * 5. Bounded timeout: 5000ms.
 * 6. Fail-fast error handling:
 *    - Upstream connection refused -> HTTP 502 Bad Gateway (BACKEND_UNAVAILABLE).
 *    - Upstream timeout (>5000ms)   -> HTTP 504 Gateway Timeout (BACKEND_TIMEOUT).
 * 7. Zero automatic fallback to database: does not mask backend failure.
 */

import { NextRequest } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { apiError } from "@/lib/apiResponse";
import { isPresentationDemoMode, getPresentationDemoFixture } from "@/lib/presentationMode";

export const FASTAPI_ORIGIN = "http://127.0.0.1:8000";
export const PROXY_TIMEOUT_MS = 5000;

// Hop-by-hop and connection-specific headers that must NOT be forwarded in either direction
export const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "content-encoding",
]);

// Sensitive client request headers that must NOT be forwarded to upstream
export const SENSITIVE_CLIENT_HEADERS = new Set([
  "cookie",
  "authorization",
  "proxy-authorization",
]);

export interface ProxyOptions {
  /** Explicit method allowlist. Defaults to ['GET']. In Slice 1R, only GET is permitted. */
  allowedMethods?: string[];
  /** Optional custom timeout in milliseconds. Defaults to 5000ms. */
  timeoutMs?: number;
}

/**
 * Builds a strictly validated upstream URL using the fixed FastAPI origin.
 *
 * @param trustedPath Internally constructed endpoint path (e.g. `/api/projects/123/sources`).
 * @param incomingUrlStr The incoming request URL containing query parameters.
 * @returns Fully qualified upstream URL strictly bound to FASTAPI_ORIGIN.
 */
export function buildUpstreamUrl(trustedPath: string, incomingUrlStr: string): URL {
  // Ensure the path is treated as an absolute pathname relative to origin
  let sanitizedPath = trustedPath.trim();
  // Strip any leading forward or backward slashes to prevent protocol-relative or UNC-style host redirection
  while (sanitizedPath.startsWith("/") || sanitizedPath.startsWith("\\")) {
    sanitizedPath = sanitizedPath.slice(1);
  }

  // Construct URL strictly against fixed origin
  const targetUrl = new URL(`/${sanitizedPath}`, FASTAPI_ORIGIN);

  // Preserve all incoming query parameters exactly as received
  try {
    const incomingUrl = new URL(incomingUrlStr, "http://localhost");
    if (incomingUrl.search) {
      targetUrl.search = incomingUrl.search;
    }
  } catch {
    // If incomingUrlStr cannot be parsed as a URL, search remains empty
  }

  return targetUrl;
}

/**
 * Prepares safe upstream headers from the incoming request.
 */
export function buildUpstreamHeaders(req: Request | NextRequest): { headers: Headers; requestId: string } {
  const requestId = req.headers.get("x-request-id") || uuidv4();
  const upstreamHeaders = new Headers();

  // Set mandatory tracing and content negotiation headers
  upstreamHeaders.set("x-request-id", requestId);
  upstreamHeaders.set("accept", "application/json");

  // Propagate safe incoming headers, skipping hop-by-hop and sensitive headers
  req.headers.forEach((val, key) => {
    const lower = key.toLowerCase();
    if (
      !HOP_BY_HOP_HEADERS.has(lower) &&
      !SENSITIVE_CLIENT_HEADERS.has(lower) &&
      lower !== "accept" &&
      lower !== "x-request-id"
    ) {
      // Allow tracing headers (e.g. traceparent, baggage)
      if (lower.startsWith("x-") || lower.startsWith("trace")) {
        upstreamHeaders.set(key, val);
      }
    }
  });

  return { headers: upstreamHeaders, requestId };
}

/**
 * Sanitizes upstream response headers before returning to the client.
 */
export function buildClientResponseHeaders(upstreamHeaders: Headers): Headers {
  const clientHeaders = new Headers();
  upstreamHeaders.forEach((val, key) => {
    const lower = key.toLowerCase();
    if (!HOP_BY_HOP_HEADERS.has(lower)) {
      clientHeaders.set(key, val);
    }
  });

  if (!clientHeaders.has("content-type")) {
    clientHeaders.set("content-type", "application/json");
  }

  return clientHeaders;
}

/**
 * Delegates a request to the fixed FastAPI backend.
 *
 * @param req Incoming Request or NextRequest.
 * @param trustedPath Trusted endpoint path to delegate to (e.g. `/api/projects/${id}/sources`).
 * @param options Optional proxy options.
 * @returns Response to return to the client.
 */
export async function delegateToFastAPI(
  req: Request | NextRequest,
  trustedPath: string,
  options: ProxyOptions = {}
): Promise<Response> {
  const method = (req.method || "GET").toUpperCase();
  const allowed = options.allowedMethods || ["GET"];

  // Step 0: In presentation demo mode, serve safe immutable fixtures directly
  if (isPresentationDemoMode()) {
    const fixture = getPresentationDemoFixture(trustedPath, req.url);
    if (fixture) {
      return fixture;
    }
  }

  // Step 1: Enforce GET-only allowlist (Slice 1R constraint)
  if (method !== "GET" || !allowed.includes(method)) {
    return apiError(
      "METHOD_NOT_ALLOWED",
      `Method ${method} is not permitted for FastAPI proxy delegation. Only GET is allowed.`,
      405,
      false
    );
  }

  // Step 2: Build fixed upstream destination URL
  const destinationUrl = buildUpstreamUrl(trustedPath, req.url);

  // Verification: ensure origin was never modified
  if (destinationUrl.origin !== FASTAPI_ORIGIN) {
    return apiError("INVALID_PROXY_PATH", "Invalid proxy destination origin.", 400, false);
  }

  // Step 3: Build sanitized upstream headers and extract request ID
  const { headers: upstreamHeaders, requestId } = buildUpstreamHeaders(req);

  // Step 4: Configure timeout signal (5 seconds default)
  const timeoutMs = options.timeoutMs ?? PROXY_TIMEOUT_MS;
  const signal =
    typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(timeoutMs)
      : (() => {
          const controller = new AbortController();
          setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), timeoutMs);
          return controller.signal;
        })();

  // Step 5: Execute upstream request
  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(destinationUrl.toString(), {
      method: "GET",
      headers: upstreamHeaders,
      signal,
    });
  } catch (err: unknown) {
    const isTimeout =
      signal.aborted ||
      (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError"));

    if (isTimeout) {
      return apiError(
        "BACKEND_TIMEOUT",
        `FastAPI backend request timed out after ${timeoutMs / 1000} seconds.`,
        504,
        true,
        { requestId }
      );
    }

    return apiError(
      "BACKEND_UNAVAILABLE",
      "FastAPI backend service is unavailable.",
      502,
      true,
      { requestId }
    );
  }

  // Step 6: Sanitize response headers and return stream/body directly
  const clientHeaders = buildClientResponseHeaders(upstreamRes.headers);

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: clientHeaders,
  });
}
