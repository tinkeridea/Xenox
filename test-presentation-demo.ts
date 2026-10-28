/**
 * IdeaProbe — Focused Presentation Demo Mode Test Suite
 *
 * Validates:
 * 1. Presentation mode activation via APP_MODE=demo.
 * 2. Immutable zero-dependency fixtures return correct shapes for all read routes.
 * 3. 404 handling for non-demo projects or runs.
 * 4. Read-only server-side rejection (HTTP 403 DEMO_MODE_READ_ONLY) for write operations.
 * 5. Middleware mutation interception.
 * 6. Provenance metadata and sample/simulated warnings preservation.
 * 7. Normal local development preservation when demo mode is not enabled.
 */

import { NextRequest } from "next/server";
import {
  isPresentationDemoMode,
  presentationReadOnlyResponse,
  getPresentationDemoFixture,
  getDemoReportPayload,
  getDemoSources,
} from "./src/lib/presentationMode";
import { middleware } from "./src/middleware";
import { GET as getRuns } from "./src/app/api/runs/[id]/route";
import { GET as getInsights } from "./src/app/api/projects/[id]/insights/route";
import { GET as getPersonas } from "./src/app/api/projects/[id]/personas/route";
import { GET as getStages, POST as postStages } from "./src/app/api/projects/[id]/stages/route";
import { POST as postChat } from "./src/app/api/personas/[id]/chat/route";
import { POST as postProjects } from "./src/app/api/projects/route";
import { PATCH as patchProject, DELETE as deleteProject } from "./src/app/api/projects/[id]/route";
import { POST as postHealth } from "./src/app/api/health/providers/route";
import { delegateToFastAPI } from "./src/lib/fastapiProxy";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
  }
}

async function testPresentationDemo() {
  console.log("\n══════════════════════════════════════════════════════════");
  console.log("  IdeaProbe — Presentation Demo Mode Test Suite");
  console.log("══════════════════════════════════════════════════════════\n");

  // ── 1. Inactive Demo Mode Behavior ──────────────────────────────
  console.log("1. Local Development Preservation (when demo mode is unset):");
  delete process.env.APP_MODE;
  delete process.env.NEXT_PUBLIC_DEMO_MODE;
  delete process.env.VERCEL;

  assert(isPresentationDemoMode() === false, "isPresentationDemoMode() is false by default");

  // ── 2. Activation of Demo Mode ──────────────────────────────────
  console.log("\n2. Demo Mode Activation:");
  process.env.APP_MODE = "demo";
  assert(isPresentationDemoMode() === true, "isPresentationDemoMode() is true when APP_MODE=demo");

  // ── 3. Read Endpoints Fixtures & Shapes ──────────────────────────
  console.log("\n3. Presentation API Reads (proj-study-planner):");

  // 3.1 /api/projects
  const reqProjects = new Request("http://localhost:3000/api/projects");
  const resProjects = await delegateToFastAPI(reqProjects, "/api/projects");
  assert(resProjects.status === 200, "GET /api/projects status is 200");
  const jsonProjects = await resProjects.json();
  assert(Array.isArray(jsonProjects.data), "GET /api/projects data is an array");
  assert(
    jsonProjects.data.some((p: any) => p.id === "proj-study-planner" && p.mode === "DEMO"),
    "Contains proj-study-planner with DEMO mode"
  );

  // 3.2 /api/health/providers
  const reqHealth = new Request("http://localhost:3000/api/health/providers");
  const resHealth = await delegateToFastAPI(reqHealth, "/api/health/providers");
  assert(resHealth.status === 200, "GET /api/health/providers status is 200");
  const jsonHealth = await resHealth.json();
  assert(
    jsonHealth.data?.database?.status === "healthy" &&
      jsonHealth.data?.database?.driver?.includes("presentation demo mode"),
    "Health reports healthy presentation demo driver without exposing credentials"
  );
  assert(jsonHealth.data?.inference?.provider === "ollama", "Inference provider is ollama");
  assert(jsonHealth.data?.inference?.status === "unreachable", "Inference status is unreachable (Offline — Fixture Mode)");
  assert(
    jsonHealth.data?.inference?.message?.includes("not running on Vercel") &&
      jsonHealth.data?.inference?.message?.includes("Precomputed validation fixtures"),
    "Inference message clearly states Ollama not running on Vercel and precomputed fixtures served"
  );
  assert(jsonHealth.data?.research?.status === "unconfigured", "Research status is unconfigured");
  assert(jsonHealth.data?.research?.enabled === false, "Research enabled is false");
  assert(jsonHealth.data?.provenance_policy?.strict_enforcement === true, "Strict provenance policy reported");

  // 3.3 /api/projects/:id (overview)
  const reqDetail = new Request("http://localhost:3000/api/projects/proj-study-planner");
  const resDetail = await delegateToFastAPI(reqDetail, "/api/projects/proj-study-planner");
  assert(resDetail.status === 200, "GET /api/projects/proj-study-planner status is 200");
  const jsonDetail = await resDetail.json();
  assert(jsonDetail.data?.project?.id === "proj-study-planner", "Project id matches");
  assert(jsonDetail.data?.brief?.problem?.length > 0, "Brief problem statement present");
  assert(jsonDetail.data?.counts?.evidence_count === 4, "Evidence count is 4");
  assert(jsonDetail.data?.counts?.competitor_count === 5, "Competitor count is 5");
  assert(jsonDetail.data?.counts?.persona_count === 2, "Persona count is 2");

  // 3.4 /api/projects/:id/sources
  const reqSources = new Request("http://localhost:3000/api/projects/proj-study-planner/sources");
  const resSources = await delegateToFastAPI(reqSources, "/api/projects/proj-study-planner/sources");
  assert(resSources.status === 200, "GET /api/projects/proj-study-planner/sources status is 200");
  const jsonSources = await resSources.json();
  assert(jsonSources.data?.sources?.length === 4, "Returns 4 sources");

  // 3.5 /api/projects/:id/evidence
  const reqEvidence = new Request("http://localhost:3000/api/projects/proj-study-planner/evidence");
  const resEvidence = await delegateToFastAPI(reqEvidence, "/api/projects/proj-study-planner/evidence");
  assert(resEvidence.status === 200, "GET /api/projects/proj-study-planner/evidence status is 200");
  const jsonEvidence = await resEvidence.json();
  assert(jsonEvidence.data?.evidence?.length === 4, "Returns 4 evidence items");
  assert(jsonEvidence.data?.metrics?.samplePlaceholderCount === 3, "Metrics show 3 sample placeholder items");
  assert(jsonEvidence.data?.metrics?.verifiedRealCount === 0, "Metrics show 0 real evidence items");

  // 3.6 /api/projects/:id/competitors
  const reqCompetitors = new Request("http://localhost:3000/api/projects/proj-study-planner/competitors");
  const resCompetitors = await delegateToFastAPI(reqCompetitors, "/api/projects/proj-study-planner/competitors");
  assert(resCompetitors.status === 200, "GET /api/projects/proj-study-planner/competitors status is 200");
  const jsonCompetitors = await resCompetitors.json();
  assert(jsonCompetitors.data?.competitors?.length === 5, "Returns 5 competitors");
  assert(jsonCompetitors.data?.totalCount === 5, "totalCount is 5");

  // 3.7 /api/projects/:id/assumptions
  const reqAssumptions = new Request("http://localhost:3000/api/projects/proj-study-planner/assumptions");
  const resAssumptions = await delegateToFastAPI(reqAssumptions, "/api/projects/proj-study-planner/assumptions");
  assert(resAssumptions.status === 200, "GET /api/projects/proj-study-planner/assumptions status is 200");
  const jsonAssumptions = await resAssumptions.json();
  assert(jsonAssumptions.data?.assumptions?.length === 4, "Returns 4 assumptions");

  // 3.8 /api/projects/:id/experiments
  const reqExperiments = new Request("http://localhost:3000/api/projects/proj-study-planner/experiments");
  const resExperiments = await delegateToFastAPI(reqExperiments, "/api/projects/proj-study-planner/experiments");
  assert(resExperiments.status === 200, "GET /api/projects/proj-study-planner/experiments status is 200");
  const jsonExperiments = await resExperiments.json();
  assert(jsonExperiments.data?.experiments?.length === 2, "Returns 2 experiments");

  // 3.9 /api/projects/:id/mvp
  const reqMvp = new Request("http://localhost:3000/api/projects/proj-study-planner/mvp");
  const resMvp = await delegateToFastAPI(reqMvp, "/api/projects/proj-study-planner/mvp");
  assert(resMvp.status === 200, "GET /api/projects/proj-study-planner/mvp status is 200");
  const jsonMvp = await resMvp.json();
  assert(jsonMvp.data?.features?.length === 7, "Returns 7 MVP features");
  assert(jsonMvp.data?.counts?.now === 3, "Now count is 3");

  // 3.10 /api/projects/:id/report
  const reqReport = new Request("http://localhost:3000/api/projects/proj-study-planner/report");
  const resReport = await delegateToFastAPI(reqReport, "/api/projects/proj-study-planner/report");
  assert(resReport.status === 200, "GET /api/projects/proj-study-planner/report status is 200");
  const jsonReport = await resReport.json();
  assert(jsonReport.data?.report?.content?.length === 10, "Report contains 10 unified sections");
  assert(
    jsonReport.data?.report?.content?.some((s: any) => s.id === "sec-differentiation"),
    "Report contains Decision D44 Competitor Differentiation Section"
  );
  assert(jsonReport.data?.report?.contains_simulated === true, "Report flags contains_simulated");
  assert(jsonReport.data?.report?.contains_sample === true, "Report flags contains_sample");

  // 3.11 /api/runs/:id (Route Handler)
  const dummyParamsRun = { params: Promise.resolve({ id: "demo-run-001" }) };
  const resRun = await getRuns(new NextRequest("http://localhost:3000/api/runs/demo-run-001"), dummyParamsRun);
  assert(resRun.status === 200, "GET /api/runs/demo-run-001 status is 200");
  const jsonRun = await resRun.json();
  assert(jsonRun.data?.run?.id === "demo-run-001", "Run id matches");
  assert(jsonRun.data?.stages?.length === 10, "Run contains 10 stages");

  // 3.12 /api/projects/:id/insights (Route Handler)
  const dummyParamsProj = { params: Promise.resolve({ id: "proj-study-planner" }) };
  const resIns = await getInsights(new NextRequest("http://localhost:3000/api/projects/proj-study-planner/insights"), dummyParamsProj);
  assert(resIns.status === 200, "GET /api/projects/proj-study-planner/insights status is 200");
  const jsonIns = await resIns.json();
  assert(jsonIns.data?.insights?.length === 4, "Returns 4 insights");

  // 3.13 /api/projects/:id/personas (Route Handler)
  const resPers = await getPersonas(new NextRequest("http://localhost:3000/api/projects/proj-study-planner/personas"), dummyParamsProj);
  assert(resPers.status === 200, "GET /api/projects/proj-study-planner/personas status is 200");
  const jsonPers = await resPers.json();
  assert(jsonPers.data?.personas?.length === 2, "Returns 2 personas");
  assert(jsonPers.data?.interviews?.length === 2, "Returns 2 interviews");

  // 3.14 /api/projects/:id/stages (Route Handler)
  const resStg = await getStages(new NextRequest("http://localhost:3000/api/projects/proj-study-planner/stages"), dummyParamsProj);
  assert(resStg.status === 200, "GET /api/projects/proj-study-planner/stages status is 200");
  const jsonStg = await resStg.json();
  assert(jsonStg.data?.stages?.length === 10, "Returns 10 stages");

  // ── 4. Unknown Entities & Routing Hardening in Demo Mode ───────
  console.log("\n4. Unknown Resources & Routing Hardening in Demo Mode:");
  const dummyParamsUnknown = { params: Promise.resolve({ id: "non-existent-proj" }) };
  const resUnknownProj = await getInsights(new NextRequest("http://localhost:3000/api/projects/non-existent-proj/insights"), dummyParamsUnknown);
  assert(resUnknownProj.status === 404, "Unknown project returns HTTP 404");

  const dummyParamsUnknownRun = { params: Promise.resolve({ id: "unknown-run" }) };
  const resUnknownRun = await getRuns(new NextRequest("http://localhost:3000/api/runs/unknown-run"), dummyParamsUnknownRun);
  assert(resUnknownRun.status === 404, "Unknown run returns HTTP 404");

  // 4.1 Unsupported subpath under known demo project returns 404 ENDPOINT_NOT_FOUND
  const resUnsupportedSubpath = getPresentationDemoFixture("/api/projects/proj-study-planner/unsupported-endpoint");
  assert(resUnsupportedSubpath !== null && resUnsupportedSubpath.status === 404, "Unsupported endpoint under proj-study-planner returns 404");
  const jsonUnsupportedSubpath = await resUnsupportedSubpath?.json();
  assert(jsonUnsupportedSubpath?.error?.code === "ENDPOINT_NOT_FOUND", "Error code is ENDPOINT_NOT_FOUND");

  // 4.2 Unsupported subpath under known run returns 404 ENDPOINT_NOT_FOUND
  const resUnsupportedRunSubpath = getPresentationDemoFixture("/api/runs/demo-run-001/extra");
  assert(resUnsupportedRunSubpath !== null && resUnsupportedRunSubpath.status === 404, "Unsupported subpath under demo-run-001 returns 404");
  const jsonUnsupportedRunSubpath = await resUnsupportedRunSubpath?.json();
  assert(jsonUnsupportedRunSubpath?.error?.code === "ENDPOINT_NOT_FOUND", "Run error code is ENDPOINT_NOT_FOUND");

  // 4.3 Query strings do not break fixture matching
  const resQueryProjects = getPresentationDemoFixture("/api/projects?search=planner&page=1");
  assert(resQueryProjects !== null && resQueryProjects.status === 200, "Query string on /api/projects preserves 200 fixture");

  const resQueryEvidence = getPresentationDemoFixture("/api/projects/proj-study-planner/evidence?cache=false&v=2");
  assert(resQueryEvidence !== null && resQueryEvidence.status === 200, "Query string on /evidence preserves 200 fixture");

  // ── 5. Server-Side Read-Only Rejection (HTTP 403) ────────────────
  console.log("\n5. Mutation Endpoints Server-Side Rejection (HTTP 403):");

  // 5.1 Middleware write interception
  const middlewarePost = middleware(
    new NextRequest("http://localhost:3000/api/projects", { method: "POST" })
  );
  assert(middlewarePost.status === 403, "Middleware blocks POST with HTTP 403");
  const jsonMidPost = await middlewarePost.json();
  assert(jsonMidPost.error?.code === "DEMO_MODE_READ_ONLY", "Error code is DEMO_MODE_READ_ONLY");
  assert(jsonMidPost.error?.retryable === false, "Error is not retryable");

  const middlewarePatch = middleware(
    new NextRequest("http://localhost:3000/api/projects/proj-study-planner", { method: "PATCH" })
  );
  assert(middlewarePatch.status === 403, "Middleware blocks PATCH with HTTP 403");

  const middlewareDelete = middleware(
    new NextRequest("http://localhost:3000/api/projects/proj-study-planner", { method: "DELETE" })
  );
  assert(middlewareDelete.status === 403, "Middleware blocks DELETE with HTTP 403");

  const middlewareGet = middleware(
    new NextRequest("http://localhost:3000/api/projects", { method: "GET" })
  );
  assert(middlewareGet.status === 200, "Middleware allows GET");

  // 5.2 Direct route handler rejections
  const resPostProj = await postProjects(new NextRequest("http://localhost:3000/api/projects", { method: "POST" }));
  assert(resPostProj.status === 403, "POST /api/projects handler rejects with 403");

  const resPatchProj = await patchProject(
    new NextRequest("http://localhost:3000/api/projects/proj-study-planner", { method: "PATCH" }),
    dummyParamsProj
  );
  assert(resPatchProj.status === 403, "PATCH /api/projects/:id handler rejects with 403");

  const resDeleteProj = await deleteProject(
    new NextRequest("http://localhost:3000/api/projects/proj-study-planner", { method: "DELETE" }),
    dummyParamsProj
  );
  assert(resDeleteProj.status === 403, "DELETE /api/projects/:id handler rejects with 403");

  const resPostChat = await postChat(
    new NextRequest("http://localhost:3000/api/personas/persona-01/chat", { method: "POST" }),
    { params: Promise.resolve({ id: "persona-01" }) }
  );
  assert(resPostChat.status === 403, "POST /api/personas/:id/chat handler rejects with 403");

  const resPostHealth = await postHealth(
    new NextRequest("http://localhost:3000/api/health/providers", { method: "POST" })
  );
  assert(resPostHealth.status === 403, "POST /api/health/providers (reseed) handler rejects with 403");

  const resPostStages = await postStages(
    new NextRequest("http://localhost:3000/api/projects/proj-study-planner/stages", { method: "POST" }),
    dummyParamsProj
  );
  assert(resPostStages.status === 403, "POST /api/projects/:id/stages handler rejects with 403");

  // ── 6. Provenance & Caveat Verification ──────────────────────────
  console.log("\n6. Provenance & Caveat Verification:");
  const reportPayload = getDemoReportPayload();
  assert(reportPayload.contains_simulated === true, "Report metadata marks contains_simulated");
  assert(reportPayload.contains_sample === true, "Report metadata marks contains_sample");

  const diffSection = reportPayload.content.find((s) => s.id === "sec-differentiation");
  assert(
    Boolean(diffSection?.caveat?.includes("strategic hypotheses for demonstration")),
    "Differentiation section caveat is visible and explicit"
  );

  const personaSection = reportPayload.content.find((s) => s.id === "r-personas");
  assert(
    Boolean(personaSection?.caveat?.includes("SIMULATED ARTIFACTS")),
    "Persona section caveat explicitly labels simulated artifacts"
  );

  // ── Summary ──────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`  Tests Completed: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log("══════════════════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  }
}

testPresentationDemo().catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
