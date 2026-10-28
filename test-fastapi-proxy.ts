/**
 * IdeaProbe — Isolated Unit & Regression Test Suite for FastAPI Proxy Helper (Slice 1R)
 *
 * Verifies:
 * 1. GET is accepted and forwarded to the fixed upstream.
 * 2. Disallowed methods (POST, PUT, DELETE, PATCH) rejected with structured 405 Method Not Allowed.
 * 3. Query parameters are preserved, including repeated parameters and encoding.
 * 4. Fixed upstream origin cannot be overridden through request input or path manipulation.
 * 5. Request ID is forwarded (existing x-request-id preserved, or generated).
 * 6. Hop-by-hop (connection, host, transfer-encoding) and sensitive headers (cookie, auth) not forwarded.
 * 7. Successful responses preserve status, body, and safe headers.
 * 8. Upstream error responses (e.g. 500 DB_QUERY_FAILED) passed through per contract.
 * 9. Connection failure (ECONNREFUSED) returns HTTP 502 with BACKEND_UNAVAILABLE and retryable: true.
 * 10. Timeout returns HTTP 504 with BACKEND_TIMEOUT and retryable: true.
 * 11. No automatic fallback to database occurs on failure.
 * 12. Unsafe/hop-by-hop upstream response headers stripped from client response.
 * 13. Route-level verification: sources GET delegates to helper; POST and DELETE remain pure TypeScript.
 * 14. D33 and D34 routing constraints preserved (next.config.ts untouched).
 */

import fs from "fs";
import path from "path";
import {
  delegateToFastAPI,
  buildUpstreamUrl,
  buildUpstreamHeaders,
  buildClientResponseHeaders,
  FASTAPI_ORIGIN,
  HOP_BY_HOP_HEADERS,
  SENSITIVE_CLIENT_HEADERS,
} from "./src/lib/fastapiProxy";

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${testName}${detail ? `: ${detail}` : ""}`);
    failed++;
  }
}

async function runTests() {
  console.log("=================================================");
  console.log("IdeaProbe — Slice 1R FastAPI Proxy Helper Tests");
  console.log("=================================================\n");

  const originalFetch = globalThis.fetch;

  // -------------------------------------------------------------
  // Test 1: Fixed upstream origin cannot be overridden
  // -------------------------------------------------------------
  console.log("Test Group 1: Fixed Upstream Origin Security");
  {
    const url1 = buildUpstreamUrl("/api/projects/p1/sources", "http://localhost:3001/api/projects/p1/sources");
    assert(url1.origin === FASTAPI_ORIGIN, "Origin is strictly http://127.0.0.1:8000");
    assert(url1.pathname === "/api/projects/p1/sources", "Pathname is /api/projects/p1/sources");

    // Attempting protocol-relative or absolute URL injection in trustedPath
    const url2 = buildUpstreamUrl("//evil.com/pwned", "http://localhost:3001");
    assert(url2.origin === FASTAPI_ORIGIN, "Protocol-relative injection does not override origin");
    assert(url2.hostname === "127.0.0.1", "Hostname remains 127.0.0.1");

    const url3 = buildUpstreamUrl("http://attacker.com/api", "http://localhost:3001");
    assert(url3.origin === FASTAPI_ORIGIN, "Absolute URL injection does not override origin");
    assert(url3.hostname === "127.0.0.1", "Hostname remains 127.0.0.1");

    // Leading backslash normalization tests (Slice 1R.2)
    const url4 = buildUpstreamUrl("\\external-host.org/api", "http://localhost:3001");
    assert(url4.origin === FASTAPI_ORIGIN, "Single leading backslash normalized to fixed origin");
    assert(url4.hostname === "127.0.0.1", "Single backslash hostname remains 127.0.0.1");
    assert(url4.pathname === "/external-host.org/api", "Single backslash path treated as pathname segment");

    const url5 = buildUpstreamUrl("\\\\external-host.org/api", "http://localhost:3001");
    assert(url5.origin === FASTAPI_ORIGIN, "Double leading backslash normalized to fixed origin");
    assert(url5.hostname === "127.0.0.1", "Double backslash hostname remains 127.0.0.1");

    const url6 = buildUpstreamUrl("/\\external-host.org/api", "http://localhost:3001");
    assert(url6.origin === FASTAPI_ORIGIN, "Mixed slash-backslash normalized to fixed origin");
    assert(url6.hostname === "127.0.0.1", "Mixed slash-backslash hostname remains 127.0.0.1");
  }

  // -------------------------------------------------------------
  // Test 2: GET accepted, non-GET methods rejected with 405
  // -------------------------------------------------------------
  console.log("\nTest Group 2: Method Allowlist Enforcement");
  {
    const fetchState = { called: false };
    globalThis.fetch = (async () => {
      fetchState.called = true;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as any;

    const getReq = new Request("http://localhost:3001/api/projects/p1/sources", { method: "GET" });
    const getRes = await delegateToFastAPI(getReq, "/api/projects/p1/sources");
    assert(getRes.status === 200, "GET request is accepted and forwarded");
    assert(fetchState.called === true, "Fetch was called for GET");

    // Test rejection of POST, PATCH, PUT, DELETE
    for (const disallowed of ["POST", "PATCH", "PUT", "DELETE"]) {
      fetchState.called = false;
      const badReq = new Request("http://localhost:3001/api/projects/p1/sources", { method: disallowed });
      const badRes = await delegateToFastAPI(badReq, "/api/projects/p1/sources");
      assert(badRes.status === 405, `${disallowed} is rejected with HTTP 405 Method Not Allowed`);
      assert(fetchState.called === false, `Fetch was NOT called for ${disallowed}`);

      const body = await badRes.json();
      assert(body.error?.code === "METHOD_NOT_ALLOWED", `${disallowed} error code is METHOD_NOT_ALLOWED`);
      assert(body.meta?.schemaVersion === "1.0", `${disallowed} response includes standard meta envelope`);
    }
  }

  // -------------------------------------------------------------
  // Test 3: Query Parameter Preservation
  // -------------------------------------------------------------
  console.log("\nTest Group 3: Query String Preservation");
  {
    let capturedUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = input.toString();
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as any;

    const reqWithParams = new Request(
      "http://localhost:3001/api/projects/p1/sources?filter=primary&filter=secondary&search=market%20share&empty="
    );
    await delegateToFastAPI(reqWithParams, "/api/projects/p1/sources");

    const parsed = new URL(capturedUrl);
    assert(parsed.searchParams.getAll("filter").length === 2, "Repeated query parameters preserved");
    assert(parsed.searchParams.getAll("filter")[0] === "primary", "First repeated parameter matches");
    assert(parsed.searchParams.getAll("filter")[1] === "secondary", "Second repeated parameter matches");
    assert(parsed.searchParams.get("search") === "market share", "URL encoded spaces preserved");
    assert(parsed.searchParams.get("empty") === "", "Empty parameter preserved");
  }

  // -------------------------------------------------------------
  // Test 4: Header Sanitization & Request ID Forwarding
  // -------------------------------------------------------------
  console.log("\nTest Group 4: Header Sanitization & Request ID");
  {
    let capturedHeaders: Headers = new Headers();
    globalThis.fetch = (async (_input: any, init: RequestInit) => {
      capturedHeaders = new Headers(init.headers as any);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as any;

    const reqHeaders = new Headers({
      "x-request-id": "req-custom-12345",
      "x-custom-trace": "trace-abc",
      "cookie": "session_id=secret123",
      "authorization": "Bearer token123",
      "connection": "keep-alive",
      "upgrade": "websocket",
      "host": "malicious-host.com",
    });

    const req = new Request("http://localhost:3001/api/projects/p1/sources", {
      method: "GET",
      headers: reqHeaders,
    });

    await delegateToFastAPI(req, "/api/projects/p1/sources");

    assert(capturedHeaders.get("x-request-id") === "req-custom-12345", "Existing x-request-id forwarded");
    assert(capturedHeaders.get("x-custom-trace") === "trace-abc", "Safe custom trace header forwarded");
    assert(!capturedHeaders.has("cookie"), "Cookie header is NOT forwarded");
    assert(!capturedHeaders.has("authorization"), "Authorization header is NOT forwarded");
    assert(!capturedHeaders.has("connection"), "Connection header is NOT forwarded");
    assert(!capturedHeaders.has("upgrade"), "Upgrade header is NOT forwarded");
    assert(capturedHeaders.get("accept") === "application/json", "Accept application/json is present");
  }

  // -------------------------------------------------------------
  // Test 5: Response Status, Body & Safe Header Pass-Through
  // -------------------------------------------------------------
  console.log("\nTest Group 5: Response Contract & Header Pass-Through");
  {
    const mockPayload = {
      data: { projectId: "proj-123", sources: [{ id: "src-1", title: "Test Source" }] },
      meta: { requestId: "req-fastapi-1", schemaVersion: "1.0", timestamp: "2026-10-25T12:00:00.000Z" },
    };

    const upstreamHeaders = new Headers({
      "content-type": "application/json",
      "x-process-time": "0.002",
      "connection": "close",
      "transfer-encoding": "chunked",
      "keep-alive": "timeout=5",
    });

    globalThis.fetch = (async () => {
      return new Response(JSON.stringify(mockPayload), {
        status: 200,
        headers: upstreamHeaders,
      });
    }) as any;

    const req = new Request("http://localhost:3001/api/projects/proj-123/sources");
    const res = await delegateToFastAPI(req, "/api/projects/proj-123/sources");

    assert(res.status === 200, "Response status 200 preserved");
    const body = await res.json();
    assert(body.data.projectId === "proj-123", "Response data envelope intact");
    assert(body.data.sources.length === 1, "Source record intact");
    assert(body.meta.requestId === "req-fastapi-1", "FastAPI metadata intact");

    assert(!res.headers.has("connection"), "Upstream hop-by-hop 'connection' stripped from response");
    assert(!res.headers.has("transfer-encoding"), "Upstream hop-by-hop 'transfer-encoding' stripped from response");
    assert(!res.headers.has("keep-alive"), "Upstream hop-by-hop 'keep-alive' stripped from response");
    assert(res.headers.get("content-type") === "application/json", "Content-Type header retained");
  }

  // -------------------------------------------------------------
  // Test 6: Upstream 500 Error Pass-Through
  // -------------------------------------------------------------
  console.log("\nTest Group 6: Upstream Error Envelope Pass-Through");
  {
    const errorPayload = {
      error: { code: "DB_QUERY_FAILED", message: "Database query syntax error", retryable: false },
      meta: { requestId: "req-err-1", schemaVersion: "1.0", timestamp: "2026-10-25T12:00:00.000Z" },
    };

    globalThis.fetch = (async () => {
      return new Response(JSON.stringify(errorPayload), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }) as any;

    const req = new Request("http://localhost:3001/api/projects/p1/sources");
    const res = await delegateToFastAPI(req, "/api/projects/p1/sources");

    assert(res.status === 500, "Upstream HTTP 500 status preserved");
    const body = await res.json();
    assert(body.error?.code === "DB_QUERY_FAILED", "Upstream DB_QUERY_FAILED error code preserved");
    assert(body.error?.retryable === false, "Upstream retryable flag preserved");
  }

  // -------------------------------------------------------------
  // Test 7: Fail-Fast Connection Failure -> HTTP 502
  // -------------------------------------------------------------
  console.log("\nTest Group 7: Connection Failure (HTTP 502 Bad Gateway)");
  {
    globalThis.fetch = (async () => {
      const err = new TypeError("fetch failed");
      (err as any).cause = { code: "ECONNREFUSED" };
      throw err;
    }) as any;

    const req = new Request("http://localhost:3001/api/projects/p1/sources");
    const res = await delegateToFastAPI(req, "/api/projects/p1/sources");

    assert(res.status === 502, "Connection failure returns HTTP 502 Bad Gateway");
    const body = await res.json();
    assert(body.error?.code === "BACKEND_UNAVAILABLE", "Error code is BACKEND_UNAVAILABLE");
    assert(body.error?.retryable === true, "retryable is true");
    assert(body.meta?.schemaVersion === "1.0", "meta envelope is present");
  }

  // -------------------------------------------------------------
  // Test 8: Fail-Fast Request Timeout -> HTTP 504
  // -------------------------------------------------------------
  console.log("\nTest Group 8: Request Timeout (HTTP 504 Gateway Timeout)");
  {
    globalThis.fetch = (async () => {
      const err = new DOMException("The operation was aborted due to timeout", "TimeoutError");
      throw err;
    }) as any;

    const req = new Request("http://localhost:3001/api/projects/p1/sources");
    const res = await delegateToFastAPI(req, "/api/projects/p1/sources");

    assert(res.status === 504, "Timeout returns HTTP 504 Gateway Timeout");
    const body = await res.json();
    assert(body.error?.code === "BACKEND_TIMEOUT", "Error code is BACKEND_TIMEOUT");
    assert(body.error?.retryable === true, "retryable is true");
    assert(body.meta?.schemaVersion === "1.0", "meta envelope is present");
  }

  // -------------------------------------------------------------
  // Test 9: Route-Level Regression Verification
  // -------------------------------------------------------------
  console.log("\nTest Group 9: Route-Level Structure & Mutation Protection");
  {
    const routeFilePath = path.join(__dirname, "src/app/api/projects/[id]/sources/route.ts");
    const routeContent = fs.readFileSync(routeFilePath, "utf8");

    assert(routeContent.includes("delegateToFastAPI"), "GET handler references delegateToFastAPI");
    assert(routeContent.includes("getSourcesFromDb"), "Rollback function getSourcesFromDb is present");
    assert(routeContent.includes("ROLLBACK PATH"), "Rollback instructions documented in comments");

    // Verify GET catch block sanitization (Slice 1R.2)
    const getFunctionMatch = routeContent.match(/export async function GET[\s\S]*?(?=export async function POST|$)/);
    const getBody = getFunctionMatch ? getFunctionMatch[0] : "";
    assert(getBody.includes("INTERNAL_ERROR"), "GET catch block uses INTERNAL_ERROR");
    assert(getBody.includes("Failed to retrieve project sources."), "GET catch block returns sanitized client message");
    assert(!getBody.includes("DB_QUERY_FAILED"), "GET catch block does NOT misclassify error as DB_QUERY_FAILED");

    // Verify POST and DELETE are NOT using delegateToFastAPI
    const postFunctionMatch = routeContent.match(/export async function POST[\s\S]*?(?=export async function DELETE|$)/);
    const postBody = postFunctionMatch ? postFunctionMatch[0] : "";
    assert(!postBody.includes("delegateToFastAPI"), "POST handler does NOT invoke delegateToFastAPI");
    assert(postBody.includes("INSERT INTO sources"), "POST handler retains local SQLite INSERT implementation");

    const deleteFunctionMatch = routeContent.match(/export async function DELETE[\s\S]*?$/);
    const deleteBody = deleteFunctionMatch ? deleteFunctionMatch[0] : "";
    assert(!deleteBody.includes("delegateToFastAPI"), "DELETE handler does NOT invoke delegateToFastAPI");
    assert(deleteBody.includes("UPDATE evidence SET source_id = NULL"), "DELETE handler retains evidence unlinking logic");
    assert(deleteBody.includes("DELETE FROM sources"), "DELETE handler retains local SQLite DELETE implementation");

    // Verify next.config.ts has NOT been modified
    const configPath = path.join(__dirname, "next.config.ts");
    const configContent = fs.readFileSync(configPath, "utf8");
    assert(
      !configContent.includes('source: "/api/projects/:id/sources"'),
      "Decision D34 preserved: no real-route rewrite for /api/projects/:id/sources"
    );
    assert(
      !configContent.includes('source: "/api/projects/:id/runs"'),
      "Decision D33 preserved: no real-route rewrite for /api/projects/:id/runs"
    );
  }

  // -------------------------------------------------------------
  // Test 10: Project Runs Route-Level Regression (Slice 1S)
  // -------------------------------------------------------------
  console.log("\nTest Group 10: Project Runs Route-Level Structure & Mutation Protection (Slice 1S)");
  {
    const runsRoutePath = path.join(__dirname, "src/app/api/projects/[id]/runs/route.ts");
    const runsRouteContent = fs.readFileSync(runsRoutePath, "utf8");

    // 1. The runs GET handler delegates using delegateToFastAPI
    assert(runsRouteContent.includes("delegateToFastAPI"), "runs route imports and references delegateToFastAPI");

    const runsGetMatch = runsRouteContent.match(/export async function GET[\s\S]*?(?=export async function POST|$)/);
    const runsGetBody = runsGetMatch ? runsGetMatch[0] : "";
    assert(runsGetBody.includes("delegateToFastAPI"), "runs GET handler calls delegateToFastAPI");

    // 2. The target path includes the safely encoded project ID
    assert(
      runsGetBody.includes("/api/projects/${encodeURIComponent(id)}/runs"),
      "runs GET delegates to /api/projects/${encodeURIComponent(id)}/runs"
    );

    // 3. The original getRunsFromDb(id) rollback function remains present and documented
    assert(runsRouteContent.includes("export async function getRunsFromDb(id: string)"), "Rollback function getRunsFromDb is exported");
    assert(runsRouteContent.includes("ROLLBACK PATH"), "Rollback instructions documented in comments");
    assert(runsRouteContent.includes("return getRunsFromDb(id);"), "Rollback comment specifies replacement return getRunsFromDb(id);");

    // 4. The rollback SQL still contains both stage-count subqueries
    assert(
      runsRouteContent.includes("(SELECT COUNT(*) FROM stages s WHERE s.run_id = r.id AND s.status = 'completed') as completed_stages"),
      "Rollback SQL retains completed_stages subquery"
    );
    assert(
      runsRouteContent.includes("(SELECT COUNT(*) FROM stages s WHERE s.run_id = r.id) as total_stages"),
      "Rollback SQL retains total_stages subquery"
    );

    // 5. The rollback SQL retains the project filter and descending creation-time ordering
    assert(runsRouteContent.includes("WHERE r.project_id = ?"), "Rollback SQL retains WHERE r.project_id = ?");
    assert(runsRouteContent.includes("ORDER BY r.created_at DESC"), "Rollback SQL retains ORDER BY r.created_at DESC");

    // 6. The GET catch block uses INTERNAL_ERROR
    assert(runsGetBody.includes("INTERNAL_ERROR"), "runs GET catch block uses INTERNAL_ERROR");

    // 7. The client-facing message is exactly 'Failed to retrieve project runs.'
    assert(runsGetBody.includes("Failed to retrieve project runs."), "runs GET client message is 'Failed to retrieve project runs.'");

    // 8. The GET catch block does not return raw exception messages
    assert(!runsGetBody.includes("QUERY_FAILED"), "runs GET does NOT return raw QUERY_FAILED error code");
    assert(
      !runsGetBody.match(/apiError\s*\([^,]+,\s*(?:err\.message|msg)/),
      "runs GET catch block does NOT pass raw exception message to apiError"
    );

    // 9. The POST handler does not call delegateToFastAPI
    const runsPostMatch = runsRouteContent.match(/export async function POST[\s\S]*?$/);
    const runsPostBody = runsPostMatch ? runsPostMatch[0] : "";
    assert(!runsPostBody.includes("delegateToFastAPI"), "runs POST handler does NOT call delegateToFastAPI");

    // 10. The POST handler retains run and stage insertion logic
    assert(runsPostBody.includes("INSERT INTO runs"), "runs POST handler retains local SQLite INSERT INTO runs");
    assert(runsPostBody.includes("INSERT INTO stages"), "runs POST handler retains local SQLite INSERT INTO stages");
    assert(runsPostBody.includes("db.batch("), "runs POST handler retains atomic db.batch execution");

    // 11 & 12. next.config.ts does not contain a new production rewrite for /api/projects/:id/runs, D33 preserved
    const configPath = path.join(__dirname, "next.config.ts");
    const configContent = fs.readFileSync(configPath, "utf8");
    assert(
      !configContent.includes('source: "/api/projects/:id/runs"'),
      "Decision D33 preserved: no real-route rewrite for /api/projects/:id/runs in next.config.ts"
    );
    assert(
      !configContent.includes('source: "/api/py/projects/:id/runs"'),
      "Decision D33 preserved: temporary diagnostic proxy /api/py/projects/:id/runs cleanly retired (Slice 2E)"
    );
  }

  // -------------------------------------------------------------
  // Test 11: Project Detail Route-Level Regression (Slice 1V)
  // -------------------------------------------------------------
  console.log("\nTest Group 11: Project Detail Route-Level Structure & Mutation Protection (Slice 1V)");
  {
    const projectRoutePath = path.join(__dirname, "src/app/api/projects/[id]/route.ts");
    const projectRouteContent = fs.readFileSync(projectRoutePath, "utf8");

    // 1. The project GET handler delegates using delegateToFastAPI
    assert(projectRouteContent.includes("delegateToFastAPI"), "project route imports and references delegateToFastAPI");

    const projectGetMatch = projectRouteContent.match(/export async function GET[\s\S]*?(?=export async function PATCH|$)/);
    const projectGetBody = projectGetMatch ? projectGetMatch[0] : "";
    assert(projectGetBody.includes("delegateToFastAPI"), "project GET handler calls delegateToFastAPI");

    // 2. The target path includes the safely encoded project ID
    assert(
      projectGetBody.includes("/api/projects/${encodeURIComponent(id)}"),
      "project GET delegates to /api/projects/${encodeURIComponent(id)}"
    );

    // 3. The original getProjectFromDb(id) rollback function remains present and documented
    assert(projectRouteContent.includes("export async function getProjectFromDb(id: string)"), "Rollback function getProjectFromDb is exported");
    assert(projectRouteContent.includes("ROLLBACK PATH"), "Rollback instructions documented in comments");
    assert(projectRouteContent.includes("return getProjectFromDb(id);"), "Rollback comment specifies replacement return getProjectFromDb(id);");

    // 4. The rollback SQL still contains project, brief, runs, and counts queries
    assert(
      projectRouteContent.includes("SELECT * FROM projects WHERE id = ?"),
      "Rollback SQL retains project query"
    );
    assert(
      projectRouteContent.includes("SELECT * FROM idea_briefs WHERE project_id = ? ORDER BY version DESC LIMIT 1"),
      "Rollback SQL retains latest brief query"
    );
    assert(
      projectRouteContent.includes("SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC"),
      "Rollback SQL retains runs query"
    );
    assert(
      projectRouteContent.includes("evidence_count") && projectRouteContent.includes("mvp_count"),
      "Rollback SQL retains 9-count subqueries"
    );

    // 5. The GET catch block uses INTERNAL_ERROR
    assert(projectGetBody.includes("INTERNAL_ERROR"), "project GET catch block uses INTERNAL_ERROR");

    // 6. The client-facing message is exactly 'Failed to retrieve project details.'
    assert(projectGetBody.includes("Failed to retrieve project details."), "project GET client message is 'Failed to retrieve project details.'");

    // 7. The GET catch block does not return raw DB_QUERY_FAILED error code
    assert(!projectGetBody.includes("DB_QUERY_FAILED"), "project GET does NOT return raw DB_QUERY_FAILED error code");
    assert(
      !projectGetBody.match(/apiError\s*\([^,]+,\s*(?:err\.message|msg)/),
      "project GET catch block does NOT pass raw exception message to apiError"
    );

    // 8. The PATCH handler does not call delegateToFastAPI
    const projectPatchMatch = projectRouteContent.match(/export async function PATCH[\s\S]*?(?=export async function DELETE|$)/);
    const projectPatchBody = projectPatchMatch ? projectPatchMatch[0] : "";
    assert(!projectPatchBody.includes("delegateToFastAPI"), "PATCH handler does NOT call delegateToFastAPI");
    assert(projectPatchBody.includes("UPDATE projects SET"), "PATCH handler retains local SQLite UPDATE implementation");

    // 9. The DELETE handler does not call delegateToFastAPI
    const projectDeleteMatch = projectRouteContent.match(/export async function DELETE[\s\S]*?$/);
    const projectDeleteBody = projectDeleteMatch ? projectDeleteMatch[0] : "";
    assert(!projectDeleteBody.includes("delegateToFastAPI"), "DELETE handler does NOT call delegateToFastAPI");
    assert(projectDeleteBody.includes("db.batch(deleteBatch)"), "DELETE handler retains cascading delete batch execution (D08)");

    // 10 & 11. next.config.ts does not contain a new production rewrite for /api/projects/:id, temporary proxy remains
    const configPath = path.join(__dirname, "next.config.ts");
    const configContent = fs.readFileSync(configPath, "utf8");
    assert(
      !configContent.includes('source: "/api/projects/:id"'),
      "No real-route rewrite for /api/projects/:id in next.config.ts"
    );
    assert(
      !configContent.includes('source: "/api/py/projects/:id"'),
      "Temporary diagnostic proxy /api/py/projects/:id cleanly retired (Slice 2E)"
    );
  }

  // -------------------------------------------------------------
  // Test 12: Route-level verification for /api/projects (Slice 1X)
  // -------------------------------------------------------------
  console.log("\nTest Group 12: Route-Level Integration for /api/projects (Slice 1X)");
  {
    const projectsRoutePath = path.join(__dirname, "src/app/api/projects/route.ts");
    const projectsRouteContent = fs.readFileSync(projectsRoutePath, "utf8");

    // 1. GET handler calls delegateToFastAPI
    const projectsGetMatch = projectsRouteContent.match(/export async function GET[\s\S]*?(?=export async function POST|$)/);
    const projectsGetBody = projectsGetMatch ? projectsGetMatch[0] : "";
    assert(projectsGetBody.includes("delegateToFastAPI(req, \"/api/projects\")"), "GET /api/projects calls delegateToFastAPI");

    // 2. Named rollback function exists and is exported
    assert(
      projectsRouteContent.includes("export async function getProjectsFromDb("),
      "Named rollback function getProjectsFromDb is exported"
    );

    // 3. Rollback SQL query retains exact query
    assert(
      projectsRouteContent.includes("SELECT MAX(version) FROM idea_briefs WHERE project_id = p.id"),
      "Rollback SQL retains MAX(version) idea_briefs join"
    );
    assert(
      projectsRouteContent.includes("ORDER BY p.updated_at DESC"),
      "Rollback SQL retains ORDER BY p.updated_at DESC"
    );

    // 4. The GET catch block uses INTERNAL_ERROR and sanitized message
    assert(projectsGetBody.includes("INTERNAL_ERROR"), "projects GET catch block uses INTERNAL_ERROR");
    assert(
      projectsGetBody.includes("Failed to retrieve projects."),
      "projects GET client message is 'Failed to retrieve projects.'"
    );
    assert(!projectsGetBody.includes("DB_QUERY_FAILED"), "projects GET does NOT return raw DB_QUERY_FAILED");

    // 5. The POST handler does not call delegateToFastAPI and retains full creation batch
    const projectsPostMatch = projectsRouteContent.match(/export async function POST[\s\S]*?$/);
    const projectsPostBody = projectsPostMatch ? projectsPostMatch[0] : "";
    assert(!projectsPostBody.includes("delegateToFastAPI"), "POST handler does NOT call delegateToFastAPI");
    assert(projectsPostBody.includes("INSERT INTO projects"), "POST handler retains local SQLite projects insert");
    assert(projectsPostBody.includes("INSERT INTO idea_briefs"), "POST handler retains idea_briefs insert");
    assert(projectsPostBody.includes("INSERT INTO runs"), "POST handler retains runs insert");
    assert(projectsPostBody.includes("INSERT INTO stages"), "POST handler retains stages insert");

    // 6. next.config.ts does not contain real-route rewrite for /api/projects
    const configPath = path.join(__dirname, "next.config.ts");
    const configContent = fs.readFileSync(configPath, "utf8");
    assert(
      !configContent.includes('source: "/api/projects"') && !configContent.includes('source: "/api/projects"'),
      "No real-route rewrite for /api/projects in next.config.ts"
    );

    // 7. next.config.ts does not contain temporary test proxy for /api/py/projects (retired in Slice 2E)
    assert(
      !configContent.includes('source: "/api/py/projects"'),
      "Temporary diagnostic proxy /api/py/projects cleanly retired (Slice 2E)"
    );
  }

  // -------------------------------------------------------------
  // Test 13: Route-level verification for /api/projects/:id/evidence (Slice 1Y)
  // -------------------------------------------------------------
  console.log("\nTest Group 13: Route-Level Integration for /api/projects/[id]/evidence (Slice 1Y)");
  {
    const evidenceRoutePath = path.join(__dirname, "src/app/api/projects/[id]/evidence/route.ts");
    const evidenceRouteContent = fs.readFileSync(evidenceRoutePath, "utf8");

    // 1. GET handler calls delegateToFastAPI
    const evidenceGetMatch = evidenceRouteContent.match(/export async function GET[\s\S]*?(?=export async function POST|$)/);
    const evidenceGetBody = evidenceGetMatch ? evidenceGetMatch[0] : "";
    assert(
      evidenceGetBody.includes("delegateToFastAPI(req, `/api/projects/${encodeURIComponent(id)}/evidence`)"),
      "GET /api/projects/[id]/evidence calls delegateToFastAPI with encoded ID"
    );

    // 2. Named rollback function exists and is exported
    assert(
      evidenceRouteContent.includes("export async function getEvidenceFromDb("),
      "Named rollback function getEvidenceFromDb is exported"
    );

    // 3. Rollback SQL query retains exact sources and evidence queries
    assert(
      evidenceRouteContent.includes("SELECT s.*,"),
      "Rollback SQL retains sources query with linked_evidence_count"
    );
    assert(
      evidenceRouteContent.includes("SELECT e.*, s.title as source_title"),
      "Rollback SQL retains evidence query with joined source fields"
    );

    // 4. The GET catch block uses INTERNAL_ERROR and sanitized message
    assert(evidenceGetBody.includes("INTERNAL_ERROR"), "evidence GET catch block uses INTERNAL_ERROR");
    assert(
      evidenceGetBody.includes("Failed to retrieve project evidence."),
      "evidence GET client message is 'Failed to retrieve project evidence.'"
    );
    assert(!evidenceGetBody.includes("DB_QUERY_FAILED"), "evidence GET does NOT return raw DB_QUERY_FAILED");

    // 5. POST, PATCH, and DELETE handlers do not call delegateToFastAPI
    const evidencePostMatch = evidenceRouteContent.match(/export async function POST[\s\S]*?(?=export async function PATCH|$)/);
    const evidencePostBody = evidencePostMatch ? evidencePostMatch[0] : "";
    assert(!evidencePostBody.includes("delegateToFastAPI"), "POST handler does NOT call delegateToFastAPI");
    assert(evidencePostBody.includes("INSERT INTO evidence"), "POST handler retains local SQLite evidence insert");

    const evidencePatchMatch = evidenceRouteContent.match(/export async function PATCH[\s\S]*?(?=export async function DELETE|$)/);
    const evidencePatchBody = evidencePatchMatch ? evidencePatchMatch[0] : "";
    assert(!evidencePatchBody.includes("delegateToFastAPI"), "PATCH handler does NOT call delegateToFastAPI");
    assert(
      evidencePatchBody.includes("UPDATE evidence") && evidencePatchBody.includes("reviewer_status = ?"),
      "PATCH handler retains Human Review Gate UPDATE logic"
    );

    const evidenceDeleteMatch = evidenceRouteContent.match(/export async function DELETE[\s\S]*?$/);
    const evidenceDeleteBody = evidenceDeleteMatch ? evidenceDeleteMatch[0] : "";
    assert(!evidenceDeleteBody.includes("delegateToFastAPI"), "DELETE handler does NOT call delegateToFastAPI");
    assert(evidenceDeleteBody.includes("DELETE FROM evidence WHERE id = ?"), "DELETE handler retains local SQLite delete");

    // 6. next.config.ts does not contain real-route rewrite for /api/projects/:id/evidence
    const configPath = path.join(__dirname, "next.config.ts");
    const configContent = fs.readFileSync(configPath, "utf8");
    assert(
      !configContent.includes('source: "/api/projects/:id/evidence"'),
      "No real-route rewrite for /api/projects/:id/evidence in next.config.ts"
    );

    // 7. next.config.ts does not contain temporary test proxy for /api/py/projects/:id/evidence (retired in Slice 2E)
    assert(
      !configContent.includes('source: "/api/py/projects/:id/evidence"'),
      "Temporary diagnostic proxy /api/py/projects/:id/evidence cleanly retired (Slice 2E)"
    );
  }

  // -------------------------------------------------------------
  // Test 14: Route-level verification for /api/projects/:id/competitors (Slice 1Z)
  // -------------------------------------------------------------
  console.log("\nTest Group 14: Route-Level Integration for /api/projects/[id]/competitors (Slice 1Z)");
  {
    const compRoutePath = path.join(__dirname, "src/app/api/projects/[id]/competitors/route.ts");
    const compRouteContent = fs.readFileSync(compRoutePath, "utf8");

    // 1. GET handler calls delegateToFastAPI
    const compGetMatch = compRouteContent.match(/export async function GET[\s\S]*?(?=export async function POST|$)/);
    const compGetBody = compGetMatch ? compGetMatch[0] : "";
    assert(
      compGetBody.includes("delegateToFastAPI(req, `/api/projects/${encodeURIComponent(id)}/competitors`)"),
      "GET /api/projects/[id]/competitors calls delegateToFastAPI with encoded ID"
    );

    // 2. Named rollback function exists and is exported
    assert(
      compRouteContent.includes("export async function getCompetitorsFromDb("),
      "Named rollback function getCompetitorsFromDb is exported"
    );

    // 3. Rollback SQL query retains exact competitors query with semantic deduplication
    assert(
      compRouteContent.includes("SELECT * FROM competitors WHERE project_id = ? ORDER BY category ASC, name ASC"),
      "Rollback SQL retains competitors query ordered by category ASC, name ASC"
    );
    assert(
      compRouteContent.includes("deduplicateCompetitors("),
      "Rollback retains deduplicateCompetitors call (Decision D22)"
    );

    // 4. The GET catch block uses INTERNAL_ERROR and sanitized message
    assert(compGetBody.includes("INTERNAL_ERROR"), "competitors GET catch block uses INTERNAL_ERROR");
    assert(
      compGetBody.includes("Failed to retrieve project competitors."),
      "competitors GET client message is 'Failed to retrieve project competitors.'"
    );
    assert(!compGetBody.includes("DB_QUERY_FAILED"), "competitors GET does NOT return raw DB_QUERY_FAILED");

    // 5. POST, PATCH, and DELETE handlers do not call delegateToFastAPI
    const compPostMatch = compRouteContent.match(/export async function POST[\s\S]*?(?=export async function PATCH|$)/);
    const compPostBody = compPostMatch ? compPostMatch[0] : "";
    assert(!compPostBody.includes("delegateToFastAPI"), "POST handler does NOT call delegateToFastAPI");
    assert(compPostBody.includes("INSERT INTO competitors"), "POST handler retains local SQLite competitors insert");

    const compPatchMatch = compRouteContent.match(/export async function PATCH[\s\S]*?(?=export async function DELETE|$)/);
    const compPatchBody = compPatchMatch ? compPatchMatch[0] : "";
    assert(!compPatchBody.includes("delegateToFastAPI"), "PATCH handler does NOT call delegateToFastAPI");
    assert(compPatchBody.includes("UPDATE competitors SET"), "PATCH handler retains local SQLite UPDATE logic");

    const compDeleteMatch = compRouteContent.match(/export async function DELETE[\s\S]*?$/);
    const compDeleteBody = compDeleteMatch ? compDeleteMatch[0] : "";
    assert(!compDeleteBody.includes("delegateToFastAPI"), "DELETE handler does NOT call delegateToFastAPI");
    assert(compDeleteBody.includes("DELETE FROM competitors WHERE id = ?"), "DELETE handler retains local SQLite delete");

    // 6. next.config.ts does not contain real-route rewrite for /api/projects/:id/competitors
    const configPath = path.join(__dirname, "next.config.ts");
    const configContent = fs.readFileSync(configPath, "utf8");
    assert(
      !configContent.includes('source: "/api/projects/:id/competitors"'),
      "No real-route rewrite for /api/projects/:id/competitors in next.config.ts"
    );

    // 7. next.config.ts does not contain temporary test proxy for /api/py/projects/:id/competitors (retired in Slice 2E)
    assert(
      !configContent.includes('source: "/api/py/projects/:id/competitors"'),
      "Temporary diagnostic proxy /api/py/projects/:id/competitors cleanly retired (Slice 2E)"
    );
  }

  // -------------------------------------------------------------
  // Test 15: Route-level verification for /api/projects/:id/assumptions (Slice 1AA)
  // -------------------------------------------------------------
  console.log("\nTest Group 15: Route-Level Integration for /api/projects/[id]/assumptions (Slice 1AA)");
  {
    const asmRoutePath = path.join(__dirname, "src/app/api/projects/[id]/assumptions/route.ts");
    const asmRouteContent = fs.readFileSync(asmRoutePath, "utf8");

    // 1. GET handler calls delegateToFastAPI
    const asmGetMatch = asmRouteContent.match(/export async function GET[\s\S]*?(?=export async function POST|$)/);
    const asmGetBody = asmGetMatch ? asmGetMatch[0] : "";
    assert(
      asmGetBody.includes("delegateToFastAPI(req, `/api/projects/${encodeURIComponent(id)}/assumptions`)"),
      "GET /api/projects/[id]/assumptions calls delegateToFastAPI with encoded ID"
    );

    // 2. Named rollback function exists and is exported
    assert(
      asmRouteContent.includes("export async function getAssumptionsFromDb("),
      "Named rollback function getAssumptionsFromDb is exported"
    );

    // 3. Rollback SQL query retains exact assumptions query ordered by uncertainty DESC, impact DESC
    assert(
      asmRouteContent.includes("SELECT * FROM assumptions WHERE project_id = ? ORDER BY uncertainty DESC, impact DESC"),
      "Rollback SQL retains assumptions query ordered by uncertainty DESC, impact DESC"
    );
    assert(
      asmRouteContent.includes("calcPriorityScore("),
      "Rollback retains calcPriorityScore call"
    );

    // 4. The GET catch block uses INTERNAL_ERROR and sanitized message
    assert(asmGetBody.includes("INTERNAL_ERROR"), "assumptions GET catch block uses INTERNAL_ERROR");
    assert(
      asmGetBody.includes("Failed to retrieve project assumptions."),
      "assumptions GET client message is 'Failed to retrieve project assumptions.'"
    );
    assert(!asmGetBody.includes("DB_QUERY_FAILED"), "assumptions GET does NOT return raw DB_QUERY_FAILED");

    // 5. POST, PATCH, and DELETE handlers do not call delegateToFastAPI
    const asmPostMatch = asmRouteContent.match(/export async function POST[\s\S]*?(?=export async function PATCH|$)/);
    const asmPostBody = asmPostMatch ? asmPostMatch[0] : "";
    assert(!asmPostBody.includes("delegateToFastAPI"), "POST handler does NOT call delegateToFastAPI");
    assert(asmPostBody.includes("INSERT INTO assumptions"), "POST handler retains local SQLite assumptions insert");

    const asmPatchMatch = asmRouteContent.match(/export async function PATCH[\s\S]*?(?=export async function DELETE|$)/);
    const asmPatchBody = asmPatchMatch ? asmPatchMatch[0] : "";
    assert(!asmPatchBody.includes("delegateToFastAPI"), "PATCH handler does NOT call delegateToFastAPI");
    assert(asmPatchBody.includes("UPDATE assumptions SET"), "PATCH handler retains local SQLite UPDATE logic");

    const asmDeleteMatch = asmRouteContent.match(/export async function DELETE[\s\S]*?$/);
    const asmDeleteBody = asmDeleteMatch ? asmDeleteMatch[0] : "";
    assert(!asmDeleteBody.includes("delegateToFastAPI"), "DELETE handler does NOT call delegateToFastAPI");
    assert(asmDeleteBody.includes("DELETE FROM assumptions WHERE id = ?"), "DELETE handler retains local SQLite delete");
    assert(asmDeleteBody.includes("UPDATE experiments SET assumption_id = NULL"), "DELETE handler retains experiment FK nullification");

    // 6. next.config.ts does not contain real-route rewrite for /api/projects/:id/assumptions
    const configPath = path.join(__dirname, "next.config.ts");
    const configContent = fs.readFileSync(configPath, "utf8");
    assert(
      !configContent.includes('source: "/api/projects/:id/assumptions"'),
      "No real-route rewrite for /api/projects/:id/assumptions in next.config.ts"
    );

    // 7. next.config.ts does not contain temporary test proxy for /api/py/projects/:id/assumptions (retired in Slice 2E)
    assert(
      !configContent.includes('source: "/api/py/projects/:id/assumptions"'),
      "Temporary diagnostic proxy /api/py/projects/:id/assumptions cleanly retired (Slice 2E)"
    );
  }

  // -------------------------------------------------------------
  // Test 16: Route-Level Integration for /api/projects/[id]/experiments (Slice 1AB)
  // -------------------------------------------------------------
  console.log("\nTest Group 16: Route-Level Integration for /api/projects/[id]/experiments (Slice 1AB)");
  {
    const expRoutePath = path.join(__dirname, "src/app/api/projects/[id]/experiments/route.ts");
    const expRouteContent = fs.readFileSync(expRoutePath, "utf8");

    // 1. GET handler calls delegateToFastAPI
    const expGetMatch = expRouteContent.match(/export async function GET[\s\S]*?(?=export async function POST|$)/);
    const expGetBody = expGetMatch ? expGetMatch[0] : "";
    assert(
      expGetBody.includes("delegateToFastAPI(req, `/api/projects/${encodeURIComponent(id)}/experiments`)"),
      "GET /api/projects/[id]/experiments calls delegateToFastAPI with encoded ID"
    );

    // 2. Named rollback function exists and is exported
    assert(
      expRouteContent.includes("export async function getExperimentsFromDb("),
      "Named rollback function getExperimentsFromDb is exported"
    );

    // 3. Rollback SQL query retains exact experiments query joined with assumptions
    assert(
      expRouteContent.includes("SELECT e.*, a.statement as assumption_statement"),
      "Rollback SQL retains experiments query joined with assumption fields"
    );
    assert(
      expRouteContent.includes("LEFT JOIN assumptions a ON e.assumption_id = a.id"),
      "Rollback SQL retains LEFT JOIN assumptions on assumption_id"
    );
    assert(
      expRouteContent.includes("ORDER BY e.created_at ASC"),
      "Rollback SQL retains ORDER BY e.created_at ASC"
    );

    // 4. The GET catch block uses INTERNAL_ERROR and sanitized message
    assert(expGetBody.includes("INTERNAL_ERROR"), "experiments GET catch block uses INTERNAL_ERROR");
    assert(
      expGetBody.includes("Failed to retrieve project experiments."),
      "experiments GET client message is 'Failed to retrieve project experiments.'"
    );
    assert(!expGetBody.includes("DB_QUERY_FAILED"), "experiments GET does NOT return raw DB_QUERY_FAILED");

    // 5. POST, PATCH, and DELETE handlers do not call delegateToFastAPI
    const expPostMatch = expRouteContent.match(/export async function POST[\s\S]*?(?=export async function PATCH|$)/);
    const expPostBody = expPostMatch ? expPostMatch[0] : "";
    assert(!expPostBody.includes("delegateToFastAPI"), "POST handler does NOT call delegateToFastAPI");
    assert(expPostBody.includes("INSERT INTO experiments"), "POST handler retains local SQLite experiments insert");

    const expPatchMatch = expRouteContent.match(/export async function PATCH[\s\S]*?(?=export async function DELETE|$)/);
    const expPatchBody = expPatchMatch ? expPatchMatch[0] : "";
    assert(!expPatchBody.includes("delegateToFastAPI"), "PATCH handler does NOT call delegateToFastAPI");
    assert(expPatchBody.includes("UPDATE experiments SET"), "PATCH handler retains local SQLite UPDATE logic");
    assert(expPatchBody.includes("REAL_EXPERIMENT_RESULT"), "PATCH handler retains REAL_EXPERIMENT_RESULT auto-upgrade");

    const expDeleteMatch = expRouteContent.match(/export async function DELETE[\s\S]*?$/);
    const expDeleteBody = expDeleteMatch ? expDeleteMatch[0] : "";
    assert(!expDeleteBody.includes("delegateToFastAPI"), "DELETE handler does NOT call delegateToFastAPI");
    assert(expDeleteBody.includes("DELETE FROM experiments WHERE id = ?"), "DELETE handler retains local SQLite delete");

    // 6. next.config.ts does not contain real-route rewrite for /api/projects/:id/experiments
    const configPath = path.join(__dirname, "next.config.ts");
    const configContent = fs.readFileSync(configPath, "utf8");
    assert(
      !configContent.includes('source: "/api/projects/:id/experiments"'),
      "No real-route rewrite for /api/projects/:id/experiments in next.config.ts"
    );

    // 7. next.config.ts does not contain temporary test proxy for /api/py/projects/:id/experiments (retired in Slice 2E)
    assert(
      !configContent.includes('source: "/api/py/projects/:id/experiments"'),
      "Temporary diagnostic proxy /api/py/projects/:id/experiments cleanly retired (Slice 2E)"
    );
  }

  // -------------------------------------------------------------
  // Test 17: Route-Level Integration for /api/projects/[id]/mvp (Slice 1AC)
  // -------------------------------------------------------------
  console.log("\nTest Group 17: Route-Level Integration for /api/projects/[id]/mvp (Slice 1AC)");
  {
    const mvpRoutePath = path.join(__dirname, "src/app/api/projects/[id]/mvp/route.ts");
    const mvpRouteContent = fs.readFileSync(mvpRoutePath, "utf8");

    // 1. GET handler calls delegateToFastAPI
    const mvpGetMatch = mvpRouteContent.match(/export async function GET[\s\S]*?(?=export async function POST|$)/);
    const mvpGetBody = mvpGetMatch ? mvpGetMatch[0] : "";
    assert(
      mvpGetBody.includes("delegateToFastAPI(req, `/api/projects/${encodeURIComponent(id)}/mvp`)"),
      "GET /api/projects/[id]/mvp calls delegateToFastAPI with encoded ID"
    );

    // 2. Named rollback function exists and is exported
    assert(
      mvpRouteContent.includes("export async function getMvpFeaturesFromDb("),
      "Named rollback function getMvpFeaturesFromDb is exported"
    );

    // 3. Rollback SQL query retains exact mvp_features query ordered by priority and name
    assert(
      mvpRouteContent.includes("SELECT * FROM mvp_features WHERE project_id = ?"),
      "Rollback SQL retains mvp_features query"
    );
    assert(
      mvpRouteContent.includes("ORDER BY CASE priority WHEN 'now' THEN 1 WHEN 'later' THEN 2 WHEN 'omit' THEN 3 ELSE 4 END, name ASC"),
      "Rollback SQL retains priority and name ordering"
    );

    // 4. The GET catch block uses INTERNAL_ERROR and sanitized message
    assert(mvpGetBody.includes("INTERNAL_ERROR"), "mvp GET catch block uses INTERNAL_ERROR");
    assert(
      mvpGetBody.includes("Failed to retrieve project MVP features."),
      "mvp GET client message is 'Failed to retrieve project MVP features.'"
    );
    assert(!mvpGetBody.includes("DB_QUERY_FAILED"), "mvp GET does NOT return raw DB_QUERY_FAILED");

    // 5. POST, PATCH, and DELETE handlers do not call delegateToFastAPI
    const mvpPostMatch = mvpRouteContent.match(/export async function POST[\s\S]*?(?=export async function PATCH|$)/);
    const mvpPostBody = mvpPostMatch ? mvpPostMatch[0] : "";
    assert(!mvpPostBody.includes("delegateToFastAPI"), "POST handler does NOT call delegateToFastAPI");
    assert(mvpPostBody.includes("INSERT INTO mvp_features"), "POST handler retains local SQLite mvp_features insert");

    const mvpPatchMatch = mvpRouteContent.match(/export async function PATCH[\s\S]*?(?=export async function DELETE|$)/);
    const mvpPatchBody = mvpPatchMatch ? mvpPatchMatch[0] : "";
    assert(!mvpPatchBody.includes("delegateToFastAPI"), "PATCH handler does NOT call delegateToFastAPI");
    assert(mvpPatchBody.includes("UPDATE mvp_features SET"), "PATCH handler retains local SQLite UPDATE logic");

    const mvpDeleteMatch = mvpRouteContent.match(/export async function DELETE[\s\S]*?$/);
    const mvpDeleteBody = mvpDeleteMatch ? mvpDeleteMatch[0] : "";
    assert(!mvpDeleteBody.includes("delegateToFastAPI"), "DELETE handler does NOT call delegateToFastAPI");
    assert(mvpDeleteBody.includes("DELETE FROM mvp_features WHERE id = ?"), "DELETE handler retains local SQLite delete");

    // 6. next.config.ts does not contain real-route rewrite for /api/projects/:id/mvp
    const configPath = path.join(__dirname, "next.config.ts");
    const configContent = fs.readFileSync(configPath, "utf8");
    assert(
      !configContent.includes('source: "/api/projects/:id/mvp"'),
      "No real-route rewrite for /api/projects/:id/mvp in next.config.ts"
    );

    // 7. next.config.ts does not contain temporary test proxy for /api/py/projects/:id/mvp (retired in Slice 2E)
    assert(
      !configContent.includes('source: "/api/py/projects/:id/mvp"'),
      "Temporary diagnostic proxy /api/py/projects/:id/mvp cleanly retired (Slice 2E)"
    );
  }

  // -------------------------------------------------------------
  // Test 18: Route-Level Integration for /api/projects/[id]/report (Slice 1AE)
  // -------------------------------------------------------------
  console.log("\nTest Group 18: Route-Level Integration for /api/projects/[id]/report (Slice 1AE)");
  {
    const reportRoutePath = path.join(__dirname, "src/app/api/projects/[id]/report/route.ts");
    const reportRouteContent = fs.readFileSync(reportRoutePath, "utf8");

    // 1. GET handler calls delegateToFastAPI with encoded ID
    const reportGetMatch = reportRouteContent.match(/export async function GET[\s\S]*?(?=const UNCERTAINTY_SCORE|export async function POST|$)/);
    const reportGetBody = reportGetMatch ? reportGetMatch[0] : "";
    assert(
      reportGetBody.includes("delegateToFastAPI(req, `/api/projects/${encodeURIComponent(id)}/report`)"),
      "GET /api/projects/[id]/report calls delegateToFastAPI with encoded ID"
    );

    // 2. Named rollback function exists and is exported
    assert(
      reportRouteContent.includes("export async function getReportFromDb("),
      "Named rollback function getReportFromDb is exported"
    );

    // 3. Rollback SQL query retains exact report_snapshots query ordered by version DESC LIMIT 1
    assert(
      reportRouteContent.includes("SELECT * FROM report_snapshots WHERE project_id = ? ORDER BY version DESC LIMIT 1"),
      "Rollback SQL retains report_snapshots query"
    );

    // 4. The GET catch block uses INTERNAL_ERROR and sanitized message
    assert(reportGetBody.includes("INTERNAL_ERROR"), "report GET catch block uses INTERNAL_ERROR");
    assert(
      reportGetBody.includes("Failed to retrieve project report snapshot."),
      "report GET client message is 'Failed to retrieve project report snapshot.'"
    );
    assert(!reportGetBody.includes("DB_QUERY_FAILED"), "report GET does NOT return raw DB_QUERY_FAILED in catch");

    // 5. POST handler does NOT call delegateToFastAPI and retains report generation/insertion
    const reportPostMatch = reportRouteContent.match(/export async function POST[\s\S]*?$/);
    const reportPostBody = reportPostMatch ? reportPostMatch[0] : "";
    assert(!reportPostBody.includes("delegateToFastAPI"), "POST handler does NOT call delegateToFastAPI");
    assert(reportPostBody.includes("INSERT INTO report_snapshots"), "POST handler retains local SQLite report_snapshots insert");

    // 6. next.config.ts does not contain real-route rewrite for /api/projects/:id/report
    const configPath = path.join(__dirname, "next.config.ts");
    const configContent = fs.readFileSync(configPath, "utf8");
    assert(
      !configContent.includes('source: "/api/projects/:id/report"'),
      "No real-route rewrite for /api/projects/:id/report in next.config.ts"
    );

    // 7. next.config.ts does not contain temporary test proxy for /api/py/projects/:id/report (retired in Slice 2E)
    assert(
      !configContent.includes('source: "/api/py/projects/:id/report"'),
      "Temporary diagnostic proxy /api/py/projects/:id/report cleanly retired (Slice 2E)"
    );
  }

  // -------------------------------------------------------------
  // Test 19: Route-Level Integration for /api/health/providers (Slice 1AG)
  // -------------------------------------------------------------
  console.log("\nTest Group 19: Route-Level Integration for /api/health/providers (Slice 1AG)");
  {
    const healthRoutePath = path.join(__dirname, "src/app/api/health/providers/route.ts");
    const healthRouteContent = fs.readFileSync(healthRoutePath, "utf8");

    // 1. GET handler calls delegateToFastAPI with /api/health/providers and explicit 6000ms timeout
    const healthGetMatch = healthRouteContent.match(/export async function GET[\s\S]*?(?=export async function POST|$)/);
    const healthGetBody = healthGetMatch ? healthGetMatch[0] : "";
    assert(
      healthGetBody.includes('delegateToFastAPI(req, "/api/health/providers"'),
      "GET /api/health/providers calls delegateToFastAPI"
    );
    assert(
      healthGetBody.includes("timeoutMs: 6000"),
      "GET /api/health/providers uses explicit timeoutMs: 6000"
    );

    // 2. Named rollback function exists and is exported
    assert(
      healthRouteContent.includes("export async function getProvidersHealthFromTs("),
      "Named rollback function getProvidersHealthFromTs is exported"
    );

    // 3. Rollback implementation retains project count query
    assert(
      healthRouteContent.includes("SELECT COUNT(*) as count FROM projects"),
      "Rollback implementation retains projects count query"
    );

    // 4. Rollback implementation retains both checkOllamaHealth and checkTinyFishHealth
    assert(
      healthRouteContent.includes("checkOllamaHealth()") && healthRouteContent.includes("checkTinyFishHealth()"),
      "Rollback implementation retains checkOllamaHealth and checkTinyFishHealth"
    );

    // 5. The GET catch block uses INTERNAL_ERROR and sanitized message
    assert(healthGetBody.includes("INTERNAL_ERROR"), "health GET catch block uses INTERNAL_ERROR");
    assert(
      healthGetBody.includes("Failed to retrieve provider health status."),
      "health GET client message is 'Failed to retrieve provider health status.'"
    );

    // 6. POST handler does NOT call delegateToFastAPI and retains reseedDemoFixtures
    const healthPostMatch = healthRouteContent.match(/export async function POST[\s\S]*?$/);
    const healthPostBody = healthPostMatch ? healthPostMatch[0] : "";
    assert(!healthPostBody.includes("delegateToFastAPI"), "POST handler does NOT call delegateToFastAPI");
    assert(healthPostBody.includes("reseedDemoFixtures()"), "POST handler retains local TypeScript reseedDemoFixtures");

    // 7. next.config.ts does not contain real-route rewrite for /api/health/providers
    const configPath = path.join(__dirname, "next.config.ts");
    const configContent = fs.readFileSync(configPath, "utf8");
    assert(
      !configContent.includes('source: "/api/health/providers"'),
      "No real-route rewrite for /api/health/providers in next.config.ts"
    );

    // 8. next.config.ts contains intentional diagnostic proxy for /api/py/health/providers
    assert(
      configContent.includes('source: "/api/py/health/providers"'),
      "Intentional diagnostic proxy /api/py/health/providers remains registered in next.config.ts"
    );
  }

  // -------------------------------------------------------------
  // Test 20: Slice 2E Diagnostic Rewrite Inventory Audit
  // -------------------------------------------------------------
  console.log("\nTest Group 20: Slice 2E Diagnostic Rewrite Inventory Audit");
  {
    const configPath = path.join(__dirname, "next.config.ts");
    const configContent = fs.readFileSync(configPath, "utf8");

    // 1. Redundant cutover aliases removed
    assert(!configContent.includes('source: "/api/py/runs/:id"'), "/api/py/runs/:id rewrite removed");
    assert(!configContent.includes('source: "/api/py/projects/:id/insights"'), "/api/py/projects/:id/insights rewrite removed");
    assert(!configContent.includes('source: "/api/py/projects/:id/personas"'), "/api/py/projects/:id/personas rewrite removed");
    assert(!configContent.includes('source: "/api/py/projects/:id/sources"'), "/api/py/projects/:id/sources rewrite removed");

    // 2. Real cutover routes preserved
    assert(configContent.includes('source: "/api/runs/:id"'), "Real route /api/runs/:id preserved (Slice 1D, D28)");
    assert(configContent.includes('source: "/api/projects/:id/insights"'), "Real route /api/projects/:id/insights preserved (Slice 1H, D30)");
    assert(configContent.includes('source: "/api/projects/:id/personas"'), "Real route /api/projects/:id/personas preserved (Slice 1L, D32)");

    // 3. Intentional diagnostic health route preserved
    assert(configContent.includes('source: "/api/py/health/providers"'), "Intentional diagnostic health route preserved (Slice 1B, D26)");
  }

  // Restore global fetch
  globalThis.fetch = originalFetch;

  console.log("\n=================================================");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("=================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution threw exception:", err);
  process.exit(1);
});
