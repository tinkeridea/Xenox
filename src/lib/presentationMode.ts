/**
 * IdeaProbe — Presentation Demo Mode & Fixtures Provider
 *
 * Provides safe, immutable, zero-dependency data fixtures for public
 * presentation deployment (e.g. Vercel) without requiring local SQLite,
 * FastAPI, Ollama, or TinyFish services.
 *
 * Active ONLY when:
 *  - process.env.APP_MODE === "demo"
 *  - process.env.NEXT_PUBLIC_DEMO_MODE === "true"
 *  - process.env.VERCEL is truthy
 *
 * Outside of demo mode, this module is dormant and normal local development
 * runs 100% untouched.
 */

import { apiSuccess, apiError } from "@/lib/apiResponse";
import {
  DEMO_PROJECT,
  DEMO_PROJECTS_LIST,
  DEMO_RUN,
  DEMO_STAGES,
  DEMO_EVIDENCE_ITEMS,
  DEMO_COMPETITORS,
  DEMO_PERSONAS,
  DEMO_INTERVIEWS,
  DEMO_INSIGHTS,
  DEMO_ASSUMPTIONS,
  DEMO_EXPERIMENTS,
  DEMO_MVP_FEATURES,
  DEMO_REPORT,
} from "@/lib/mockData";

export function isPresentationDemoMode(): boolean {
  return (
    process.env.APP_MODE === "demo" ||
    process.env.NEXT_PUBLIC_DEMO_MODE === "true" ||
    Boolean(process.env.VERCEL)
  );
}

export function presentationReadOnlyResponse(): Response {
  return apiError(
    "DEMO_MODE_READ_ONLY",
    "IdeaProbe is running in read-only presentation demo mode. Project mutations, AI generation, and live web research are disabled for this demonstration.",
    403,
    false
  );
}

// ── Competitor Differentiation Section (Decision D44) ────────────
const DEMO_DIFF_METRICS = {
  total: 5,
  articulated: 5,
  gaps: 0,
  coveragePercent: 100,
};

const DEMO_DIFFERENTIATION_SECTION = {
  id: "sec-differentiation",
  title: "Competitor Differentiation Analysis",
  provenance: "SAMPLE",
  content: `**Total Alternatives Mapped:** 5 | **Articulated Differentiators:** 5 | **Differentiation Gaps:** 0 | **Differentiation Coverage:** 100%

Strategic positioning analysis comparing IdeaProbe study planner against 5 mapped alternatives.

| Alternative | Category | Current Solution / Offer | Our Differentiation Advantage |
|---|---|---|---|
| Notion Study Templates | Direct Competitor | Manual scheduling workspace | Automated rescheduling on missed sessions |
| Google Calendar | Indirect Competitor | Generic time-blocking calendar | Topic-specific diagnostic pacing and fatigue adaptation |
| Forest | Indirect Competitor | Gamified pomodoro timer | Full syllabus curriculum roadmap and exam countdown |
| Quizlet | Substitute | Flashcard and quiz content | Adaptive scheduling rather than rote memorization |
| Manual Study Timetable | Status Quo | Paper wall timetable | Dynamic reallocation without guilt or blank restart |

> ⚠️ *Strategic Positioning Caveat:* Competitor differentiation claims represent strategic hypotheses for demonstration. They have not been independently audited against competitor feature roadmaps.`,
  caveat:
    "Competitor differentiation claims represent strategic hypotheses for demonstration. They have not been independently audited against competitor feature roadmaps.",
  metrics: DEMO_DIFF_METRICS,
  items: DEMO_COMPETITORS.map((c) => ({
    id: c.id,
    name: c.name,
    category: c.category,
    description: c.description,
    differentiator: c.differentiator,
    provenance: c.provenance,
    isDifferentiated: Boolean(c.differentiator && c.differentiator.trim().length > 0),
  })),
};

// ── Complete 10-Section Report Payload ────────────────────────────
export function getDemoReportPayload() {
  const sections = [
    DEMO_REPORT.sections[0], // 1. Executive Summary
    DEMO_REPORT.sections[1], // 2. Problem Statement
    DEMO_REPORT.sections[2], // 3. Evidence Summary
    DEMO_REPORT.sections[3], // 4. Competitive Landscape
    DEMO_DIFFERENTIATION_SECTION, // 5. Competitor Differentiation
    DEMO_REPORT.sections[4], // 6. Customer Personas
    DEMO_REPORT.sections[5], // 7. Critical Assumptions & Risks
    DEMO_REPORT.sections[6], // 8. Proposed Experiments
    DEMO_REPORT.sections[7], // 9. MVP Recommendation
    DEMO_REPORT.sections[8], // 10. Validation Verdict
  ];

  return {
    id: DEMO_REPORT.id,
    project_id: DEMO_REPORT.projectId,
    version: DEMO_REPORT.version,
    generated_at: DEMO_REPORT.generatedAt,
    content: sections,
    provenance_manifest: {
      USER_INPUT: 1,
      SAMPLE: 5,
      AI_INFERENCE: 7,
      SIMULATED: 4,
      REAL_SOURCE: 0,
      REAL_EXPERIMENT_RESULT: 0,
    },
    contains_simulated: true,
    contains_sample: true,
    project: {
      id: DEMO_PROJECT.id,
      title: DEMO_PROJECT.title,
      mode: DEMO_PROJECT.mode,
      status: DEMO_PROJECT.status,
    },
    brief: {
      problem: DEMO_PROJECT.problem,
      target_customer: DEMO_PROJECT.targetCustomer,
      solution: DEMO_PROJECT.solution,
      category: DEMO_PROJECT.category,
      stage: DEMO_PROJECT.stage,
      geography: DEMO_PROJECT.geography,
    },
    stats: {
      evidence_count: DEMO_EVIDENCE_ITEMS.length,
      competitor_count: DEMO_COMPETITORS.length,
      persona_count: DEMO_PERSONAS.length,
      assumption_count: DEMO_ASSUMPTIONS.length,
      experiment_count: DEMO_EXPERIMENTS.length,
      mvp_count: DEMO_MVP_FEATURES.length,
    },
  };
}

// ── Sample Sources Extracted from Evidence ────────────────────────
export function getDemoSources() {
  return [
    {
      id: "src-01",
      project_id: "proj-study-planner",
      title: "State of Indian Higher Education & Student Mental Health 2025",
      url: "https://example.edu/research/indian-higher-ed-stress-2025",
      source_type: "web",
      publisher: "EdTech Research Journal India",
      published_at: "2025-08-15T00:00:00Z",
      created_at: "2026-10-24T00:00:00Z",
      evidence_count: 1,
    },
    {
      id: "src-02",
      project_id: "proj-study-planner",
      title: "Undergraduate Study Habits and Planner App Churn Analysis",
      url: "https://sample-market-research.org/reports/edtech-study-habits-india",
      source_type: "web",
      publisher: "Campus Insights India",
      published_at: "2025-11-20T00:00:00Z",
      created_at: "2026-10-24T00:00:00Z",
      evidence_count: 1,
    },
    {
      id: "src-03",
      project_id: "proj-study-planner",
      title: "Student Willingness to Pay for Productivity Tools Survey",
      url: "https://edtech-survey-india.sample/student-willingness-to-pay-2025",
      source_type: "web",
      publisher: "Student Consumer Behavior Lab",
      published_at: "2026-01-10T00:00:00Z",
      created_at: "2026-10-24T00:00:00Z",
      evidence_count: 1,
    },
    {
      id: "src-04",
      project_id: "proj-study-planner",
      title: "Notion for Students Case Study",
      url: "https://notion-study-report.sample/case-study-college-planners",
      source_type: "document",
      publisher: "Independent EdTech Reviewer",
      published_at: "2025-09-01T00:00:00Z",
      created_at: "2026-10-24T00:00:00Z",
      evidence_count: 1,
    },
  ];
}

// ── Match incoming trusted path to demo fixture response ─────────
export function getPresentationDemoFixture(
  trustedPath: string,
  _incomingUrlStr?: string
): Response | null {
  // Strip query strings and fragments so query parameters never break fixture matching
  const pathWithoutQuery = trustedPath.split("?")[0].split("#")[0];
  const cleanPath = pathWithoutQuery.startsWith("/") ? pathWithoutQuery : `/${pathWithoutQuery}`;

  // 1. GET /api/projects
  if (cleanPath === "/api/projects") {
    const list = [
      {
        id: DEMO_PROJECT.id,
        title: DEMO_PROJECT.title,
        mode: DEMO_PROJECT.mode,
        status: DEMO_PROJECT.status,
        created_at: DEMO_PROJECT.createdAt,
        updated_at: DEMO_PROJECT.updatedAt,
        problem: DEMO_PROJECT.problem,
        target_customer: DEMO_PROJECT.targetCustomer,
        solution: DEMO_PROJECT.solution,
        category: DEMO_PROJECT.category,
        idea_stage: DEMO_PROJECT.stage,
        geography: DEMO_PROJECT.geography,
        latest_run_id: DEMO_RUN.id,
        latest_run_status: DEMO_RUN.status,
      },
      ...DEMO_PROJECTS_LIST.filter((p) => p.id !== DEMO_PROJECT.id).map((p) => ({
        id: p.id,
        title: p.title,
        mode: p.mode,
        status: p.status,
        created_at: p.createdAt,
        updated_at: p.updatedAt,
        problem: p.problem,
        target_customer: p.targetCustomer,
        solution: p.solution,
        category: p.category,
        idea_stage: p.stage,
        geography: p.geography || "",
        latest_run_id: null,
        latest_run_status: null,
      })),
    ];
    return apiSuccess(list, "SAMPLE");
  }

  // 2. GET /api/health/providers — reports accurate offline demo status without claiming live connections
  if (cleanPath === "/api/health/providers") {
    return apiSuccess(
      {
        database: {
          status: "healthy",
          driver: "@libsql/client (presentation demo mode)",
          total_projects: 3,
        },
        inference: {
          status: "unreachable",
          provider: "ollama",
          targetModel: "qwen3.5:4b (demo fixture mode)",
          availableModels: [],
          message:
            "Local Ollama inference is not running on Vercel. Precomputed validation fixtures are being served for this presentation demonstration.",
        },
        research: {
          status: "unconfigured",
          provider: "tinyfish",
          enabled: false,
          message:
            "TinyFish live web research is disabled in presentation demo mode. Manual/sample evidence fixtures are active.",
        },
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
      },
      "SAMPLE"
    );
  }

  // 3. GET /api/runs/:id
  const matchRun = cleanPath.match(/^\/api\/runs\/([^/]+)(\/.*)?$/);
  if (matchRun) {
    const runId = decodeURIComponent(matchRun[1]);
    const subPath = matchRun[2] || "";
    if (runId !== "demo-run-001") {
      return apiError("RUN_NOT_FOUND", `Run '${runId}' not found in demo mode.`, 404);
    }
    if (!subPath || subPath === "/") {
      return apiSuccess({
        run: {
          ...DEMO_RUN,
          project_id: DEMO_RUN.projectId,
          project_title: DEMO_PROJECT.title,
          project_mode: DEMO_PROJECT.mode,
          completed_stages: 10,
          total_stages: 10,
        },
        stages: DEMO_STAGES.map((s) => ({
          ...s,
          stage_key: s.stageKey,
          run_id: s.runId,
          output: s.outputJson,
        })),
      });
    }
    return apiError(
      "ENDPOINT_NOT_FOUND",
      `Endpoint '${cleanPath}' is not supported in presentation demo mode.`,
      404
    );
  }

  // 4. Project-scoped routes: /api/projects/:id...
  const matchProject = cleanPath.match(/^\/api\/projects\/([^/]+)(\/.*)?$/);
  if (matchProject) {
    const projectId = decodeURIComponent(matchProject[1]);
    const subPath = matchProject[2] || "";

    // In demo mode, only proj-study-planner is supported for detail views
    if (projectId !== "proj-study-planner") {
      return apiError("PROJECT_NOT_FOUND", `Project '${projectId}' not found in demo mode.`, 404);
    }

    // GET /api/projects/:id (overview detail)
    if (!subPath || subPath === "/") {
      return apiSuccess({
        project: {
          id: DEMO_PROJECT.id,
          title: DEMO_PROJECT.title,
          mode: DEMO_PROJECT.mode,
          status: DEMO_PROJECT.status,
          created_at: DEMO_PROJECT.createdAt,
          updated_at: DEMO_PROJECT.updatedAt,
        },
        brief: {
          id: "brief-demo-001",
          project_id: DEMO_PROJECT.id,
          version: 1,
          problem: DEMO_PROJECT.problem,
          target_customer: DEMO_PROJECT.targetCustomer,
          solution: DEMO_PROJECT.solution,
          geography: DEMO_PROJECT.geography,
          category: DEMO_PROJECT.category,
          alternatives: DEMO_PROJECT.alternatives,
          stage: DEMO_PROJECT.stage,
          constraints: DEMO_PROJECT.constraints,
          goals: DEMO_PROJECT.goals,
          provenance: "SAMPLE",
          created_at: DEMO_PROJECT.createdAt,
        },
        runs: [
          {
            ...DEMO_RUN,
            project_id: DEMO_RUN.projectId,
            completed_stages: 10,
            total_stages: 10,
          },
        ],
        counts: {
          evidence_count: DEMO_EVIDENCE_ITEMS.length,
          source_count: 4,
          competitor_count: DEMO_COMPETITORS.length,
          persona_count: DEMO_PERSONAS.length,
          interview_count: DEMO_INTERVIEWS.length,
          insight_count: DEMO_INSIGHTS.length,
          assumption_count: DEMO_ASSUMPTIONS.length,
          experiment_count: DEMO_EXPERIMENTS.length,
          mvp_count: DEMO_MVP_FEATURES.length,
        },
      });
    }

    // GET /api/projects/:id/runs
    if (subPath === "/runs") {
      return apiSuccess([
        {
          ...DEMO_RUN,
          project_id: DEMO_RUN.projectId,
          completed_stages: 10,
          total_stages: 10,
        },
      ]);
    }

    // GET /api/projects/:id/sources
    if (subPath === "/sources") {
      return apiSuccess({
        projectId,
        sources: getDemoSources(),
      });
    }

    // GET /api/projects/:id/evidence
    if (subPath === "/evidence") {
      const evidence = DEMO_EVIDENCE_ITEMS.map((e) => ({
        ...e,
        source_title: e.title,
        source_url: e.url,
        source_type_resolved: e.sourceType,
      }));
      return apiSuccess({
        projectId,
        sources: getDemoSources(),
        evidence,
        metrics: {
          totalEvidence: evidence.length,
          verifiedRealCount: 0,
          samplePlaceholderCount: 3,
          unreviewedCount: 1,
          acceptedCount: 3,
        },
      });
    }

    // GET /api/projects/:id/competitors
    if (subPath === "/competitors") {
      const competitors = DEMO_COMPETITORS.map((c) => ({
        id: c.id,
        project_id: c.projectId,
        name: c.name,
        category: c.category,
        description: c.description,
        differentiator: c.differentiator,
        provenance: c.provenance,
        created_at: (c as any).createdAt || "2026-10-24T00:00:00Z",
      }));
      const byCategory: Record<string, number> = {
        direct: 0,
        indirect: 0,
        substitute: 0,
        status_quo: 0,
      };
      for (const c of competitors) {
        byCategory[c.category] = (byCategory[c.category] || 0) + 1;
      }
      return apiSuccess({
        projectId,
        competitors,
        totalCount: competitors.length,
        byCategory,
      });
    }

    // GET /api/projects/:id/personas
    if (subPath === "/personas") {
      return apiSuccess({
        projectId,
        personas: DEMO_PERSONAS,
        interviews: DEMO_INTERVIEWS,
      });
    }

    // GET /api/projects/:id/insights
    if (subPath === "/insights") {
      return apiSuccess({
        projectId,
        insights: DEMO_INSIGHTS,
      });
    }

    // GET /api/projects/:id/stages
    if (subPath === "/stages") {
      return apiSuccess({
        stages: DEMO_STAGES,
        runStatus: "completed",
      });
    }

    // GET /api/projects/:id/assumptions
    if (subPath === "/assumptions") {
      const assumptions = DEMO_ASSUMPTIONS.map((a) => ({
        ...a,
        evidence_ids: a.evidenceIds || [],
        priority_score: (a as any).priorityScore || 9,
      }));
      return apiSuccess({
        projectId,
        assumptions,
        totalCount: assumptions.length,
        statusCounts: {
          unvalidated: 4,
          testing: 0,
          validated: 0,
          invalidated: 0,
        },
      });
    }

    // GET /api/projects/:id/experiments
    if (subPath === "/experiments") {
      const experiments = DEMO_EXPERIMENTS.map((exp) => {
        const linkedAsm = DEMO_ASSUMPTIONS.find((a) => a.id === exp.assumptionId);
        return {
          ...exp,
          assumption_statement: linkedAsm?.statement || "",
          assumption_uncertainty: linkedAsm?.uncertainty || "High",
          assumption_impact: linkedAsm?.impact || "High",
        };
      });
      return apiSuccess({
        projectId,
        experiments,
        totalCount: experiments.length,
        statusCounts: {
          planned: 2,
          running: 0,
          completed: 0,
          abandoned: 0,
        },
      });
    }

    // GET /api/projects/:id/mvp
    if (subPath === "/mvp") {
      const features = DEMO_MVP_FEATURES.map((f) => ({
        ...f,
        experiment_ids: f.experimentIds || [],
        dependency_ids: f.dependencyIds || [],
      }));
      return apiSuccess({
        projectId,
        features,
        counts: {
          now: 3,
          later: 3,
          omit: 1,
          total: 7,
        },
      });
    }

    // GET /api/projects/:id/report
    if (subPath === "/report") {
      return apiSuccess({ projectId, report: getDemoReportPayload() });
    }

    // GET /api/projects/:id/report/history
    if (subPath === "/report/history") {
      const report = getDemoReportPayload();
      return apiSuccess({
        projectId,
        snapshots: [
          {
            id: report.id,
            project_id: report.project_id,
            version: report.version,
            generated_at: report.generated_at,
            total_items: 17,
            verdict: "PROCEED TO EXPERIMENTS",
            section_count: report.content.length,
            provenance_manifest: report.provenance_manifest,
            contains_simulated: true,
            contains_sample: true,
          },
        ],
      });
    }

    // Any unsupported sub-path under the known demo project returns a clear 404
    return apiError(
      "ENDPOINT_NOT_FOUND",
      `Endpoint '${cleanPath}' is not supported in presentation demo mode.`,
      404
    );
  }

  return null;
}
