import { NextRequest } from "next/server";
import { initDb, getDb } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { delegateToFastAPI } from "@/lib/fastapiProxy";
import { reconcileProjectStages } from "@/lib/stageReconciliation";
import {
  isPlaceholderEvidence,
  isPlaceholderSource,
  isVerifiedRealEvidence,
} from "@/lib/evidenceValidation";
import {
  normalizeInsightStatement,
  containsPlaceholderStatistics,
  isPlaceholderBackedInsight,
  sanitizeInsightStatement,
  sanitizeInsightCaveat,
  deduplicateInsights,
} from "@/lib/insightValidation";
import {
  formatCompetitorCategory,
  deduplicateCompetitors,
  getSemanticCompetitorKey,
  isDifferentiated,
  getDifferentiationMetrics,
  buildDifferentiationMarkdownTable,
} from "@/lib/competitorValidation";
import { extractVerdictHeadline } from "@/lib/reportComparison";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * ROLLBACK PATH: Original TypeScript SQLite GET implementation.
 * To rollback Slice 1AE delegation back to direct TypeScript execution:
 * Replace `return await delegateToFastAPI(...)` in GET with `return await getReportFromDb(id);`
 */
export async function getReportFromDb(id: string, version?: number) {
  try {
    await initDb();
    const db = getDb();

    let sql = "SELECT * FROM report_snapshots WHERE project_id = ? ORDER BY version DESC LIMIT 1";
    let args: any[] = [id];

    if (typeof version === "number" && !isNaN(version)) {
      if (version <= 0) {
        return apiError(
          "INVALID_VERSION",
          `Invalid snapshot version '${version}'. Version must be a positive integer.`,
          400
        );
      }
      sql = "SELECT * FROM report_snapshots WHERE project_id = ? AND version = ?";
      args = [id, version];
    }

    const res = await db.execute({
      sql,
      args,
    });

    if (res.rows.length === 0) {
      const msg = typeof version === "number"
        ? `No report snapshot version '${version}' found for project '${id}'.`
        : `No report snapshot found for project '${id}'.`;
      return apiError("REPORT_NOT_FOUND", msg, 404);
    }

    const row: any = res.rows[0];
    const manifest =
      typeof row.provenance_manifest === "string"
        ? JSON.parse(row.provenance_manifest)
        : row.provenance_manifest;
    let content = typeof row.content === "string" ? JSON.parse(row.content) : row.content;
    if (Array.isArray(content)) {
      content = content.map((sec: any) => {
        if (sec.id === "sec-sources") {
          // Normalize legacy/v1 snapshots where sec-sources was erroneously stamped SAMPLE despite 0 sample items
          if (
            sec.provenance === "SAMPLE" &&
            manifest &&
            manifest.SAMPLE === 0 &&
            (manifest.REAL_SOURCE || 0) > 0
          ) {
            return { ...sec, provenance: "REAL_SOURCE" };
          }
          return sec;
        }
        if (sec.id === "sec-experiments") {
          // Normalize legacy snapshots where 0 experiments were designed and erroneously stamped AI_INFERENCE
          if (
            sec.provenance === "AI_INFERENCE" &&
            typeof sec.content === "string" &&
            sec.content.includes("No validation experiments have been designed yet") &&
            manifest &&
            (manifest.AI_INFERENCE || 0) === 0
          ) {
            return { ...sec, provenance: "USER_INPUT" };
          }
          return sec;
        }
        if (sec.id === "sec-personas" && typeof sec.content === "string") {
          const blocks = sec.content.split("\n\n");
          const seenNames = new Set<string>();
          const dedupedBlocks: string[] = [];
          for (const block of blocks) {
            const match = block.match(/^\d+\.\s+([^—]+)—/);
            if (match) {
              const nameKey = match[1].trim().toLowerCase();
              if (seenNames.has(nameKey)) continue;
              seenNames.add(nameKey);
            }
            dedupedBlocks.push(block);
          }
          const renumbered = dedupedBlocks.map((b, idx) => b.replace(/^\d+\.\s+/, `${idx + 1}. `)).join("\n\n");
          return { ...sec, content: renumbered };
        }
        if (sec.id === "sec-insights" && typeof sec.content === "string") {
          const blocks = sec.content.split("\n\n");
          const seenStatements = new Set<string>();
          const dedupedBlocks: string[] = [];
          for (const block of blocks) {
            const match = block.match(/^\d+\.\s+\[[^\]]+\]\s+[^:]+:\s+([\s\S]*?)(?:\s+\(Caveat:|$)/);
            const stmt = match ? match[1] : block;
            const norm = normalizeInsightStatement(stmt);
            if (norm && seenStatements.has(norm)) continue;
            if (norm) seenStatements.add(norm);

            let updatedBlock = block;
            if (containsPlaceholderStatistics(stmt) && !block.includes("[Unverified Sample Claim")) {
              updatedBlock = block.replace(/:\s+/, `: [Unverified Sample Claim — Demo Placeholder Metric] `);
            }
            dedupedBlocks.push(updatedBlock);
          }
          const renumbered = dedupedBlocks.map((b, idx) => b.replace(/^\d+\.\s+/, `${idx + 1}. `)).join("\n\n");

          let updatedCaveat = sec.caveat;
          if (dedupedBlocks.some((b) => containsPlaceholderStatistics(b) || b.includes("[SAMPLE]") || b.includes("Unverified Sample"))) {
            if (!updatedCaveat || !updatedCaveat.includes("unverified sample claims")) {
              updatedCaveat = "⚠️ WARNING: Synthesis includes unverified sample claims or demo placeholder metrics (RFC 2606 example domains). These are illustrative only and CANNOT be cited as established customer evidence or market validation.";
            }
          }
          return { ...sec, content: renumbered, caveat: updatedCaveat };
        }
        if (sec.id === "sec-competitors" && typeof sec.content === "string") {
          const blocks = sec.content.split("\n\n");
          const hasCountHeader = blocks[0] && blocks[0].includes("mapped.");
          const itemBlocks = hasCountHeader ? blocks.slice(1) : blocks;

          const seenKeys = new Set<string>();
          const dedupedBlocks: string[] = [];

          for (const block of itemBlocks) {
            const match = block.match(/^\d+\.\s+\[([^\]]+)\]\s+([^:\n]+)(?::|\n)/);
            const rawCat = match ? match[1] : "";
            const rawName = match ? match[2].replace(/\s+\[(Sample Demo Alternative|AI Inference[^\]]*)\]/g, "").trim() : block;

            const semKey = getSemanticCompetitorKey({ name: rawName, category: rawCat, description: block });
            if (seenKeys.has(semKey)) continue;
            seenKeys.add(semKey);

            // Replace raw category enum like [status_quo] with human-readable [Status Quo]
            const formattedCat = formatCompetitorCategory(rawCat);
            const updatedBlock = block.replace(/^\d+\.\s+\[([^\]]+)\]/, (m: string, p1: string) => m.replace(`[${p1}]`, `[${formattedCat}]`));
            dedupedBlocks.push(updatedBlock);
          }

          const renumbered = dedupedBlocks.map((b, idx) => b.replace(/^\d+\.\s+/, `${idx + 1}. `));
          const finalContent = `${dedupedBlocks.length} alternative(s) / competitor(s) mapped.\n\n${renumbered.join("\n\n")}`;

          let updatedCaveat = sec.caveat;
          if (!updatedCaveat) {
            updatedCaveat = "⚠️ WARNING: Competitive landscape includes illustrative sample fixtures and AI-generated hypotheses. These cannot be cited as verified customer demand or empirical market evidence.";
          }
          return { ...sec, content: finalContent, caveat: updatedCaveat };
        }
        if (sec.id === "sec-experiments" && typeof sec.content === "string") {
          // Normalize misleading [running] status on unstarted concierge study planner in legacy snapshots (Decision D23)
          // Preserves all other experiments, results, and snapshot content exactly
          const updatedContent = sec.content.replace(
            /(WhatsApp-based concierge study planner[^\n]*?)\[running\]/g,
            "$1[planned]"
          );
          return { ...sec, content: updatedContent };
        }
        if (sec.id === "sec-assumptions" && typeof sec.content === "string") {
          // Normalize assumption display status in legacy snapshots (Decision D24):
          // 'unvalidated' -> 'untested' and 'testing' -> 'in progress'
          // Preserves statements, scores, counts, and all other content exactly
          const updatedContent = sec.content
            .replace(/— Status:\s*unvalidated/g, "— Status: untested")
            .replace(/— Status:\s*testing/g, "— Status: in progress");
          return { ...sec, content: updatedContent };
        }
        return sec;
      });
    }

    const report = {
      ...row,
      content,
      provenance_manifest: manifest,
      contains_simulated: Boolean(row.contains_simulated),
      contains_sample: Boolean(row.contains_sample),
    };

    return apiSuccess({ projectId: id, report });
  } catch (err: any) {
    console.error("getReportFromDb error:", err);
    return apiError("DB_QUERY_FAILED", err.message, 500);
  }
}

/**
 * ROLLBACK PATH: Pure TypeScript SQLite report history list implementation.
 */
export async function getReportHistoryFromDb(id: string) {
  try {
    await initDb();
    const db = getDb();

    // Verify project exists
    const projRes = await db.execute({
      sql: "SELECT id FROM projects WHERE id = ?",
      args: [id],
    });
    if (projRes.rows.length === 0) {
      return apiError("PROJECT_NOT_FOUND", `Project '${id}' not found.`, 404);
    }

    const res = await db.execute({
      sql: `SELECT id, project_id, run_id, version, generated_at,
                   contains_simulated, contains_sample, provenance_manifest, content
            FROM report_snapshots
            WHERE project_id = ?
            ORDER BY version DESC`,
      args: [id],
    });

    const snapshots = res.rows.map((row: any) => {
      const manifest =
        typeof row.provenance_manifest === "string"
          ? JSON.parse(row.provenance_manifest)
          : (row.provenance_manifest || {});
      const content =
        typeof row.content === "string"
          ? JSON.parse(row.content)
          : (row.content || []);
      const total_items = Object.values(manifest).reduce(
        (a: number, b: any) => a + (Number(b) || 0),
        0
      );
      const verdictSec = Array.isArray(content)
        ? content.find((s: any) => s.id === "sec-verdict")
        : null;
      const verdict =
        verdictSec && typeof verdictSec.content === "string"
          ? extractVerdictHeadline(verdictSec.content)
          : "Status Unknown";
      const section_count = Array.isArray(content) ? content.length : 0;

      return {
        id: row.id,
        project_id: row.project_id,
        run_id: row.run_id,
        version: row.version,
        generated_at: row.generated_at,
        contains_simulated: Boolean(row.contains_simulated),
        contains_sample: Boolean(row.contains_sample),
        provenance_manifest: manifest,
        total_items,
        verdict,
        section_count,
      };
    });

    return apiSuccess({ projectId: id, snapshots });
  } catch (err: any) {
    console.error("getReportHistoryFromDb error:", err);
    return apiError("DB_QUERY_FAILED", err.message, 500);
  }
}

// ── GET: Return the latest saved report snapshot ─────────────────
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    return await delegateToFastAPI(req, `/api/projects/${encodeURIComponent(id)}/report`);
  } catch (err: unknown) {
    console.error("GET /api/projects/[id]/report proxy error:", err);
    return apiError("INTERNAL_ERROR", "Failed to retrieve project report snapshot.", 500);
  }
}

const UNCERTAINTY_SCORE: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };
const IMPACT_SCORE: Record<string, number> = { High: 3, Medium: 2, Low: 1 };

function calcPriorityScore(uncertainty: string, impact: string): number {
  return (UNCERTAINTY_SCORE[uncertainty] || 1) * (IMPACT_SCORE[impact] || 1);
}

function formatAssumptionStatus(status: string): string {
  switch (status) {
    case "unvalidated":
      return "untested";
    case "testing":
      return "in progress";
    case "validated":
      return "validated";
    case "invalidated":
      return "invalidated";
    default:
      return status;
  }
}

// ── POST: Generate a live report from all SQLite data ─────────────
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    await initDb();
    const { id } = await params;
    const db = getDb();

    // -- 1. Load project metadata ─────────────────────────────────
    const projRes = await db.execute({
      sql: "SELECT * FROM projects WHERE id = ?",
      args: [id],
    });
    if (projRes.rows.length === 0) {
      return apiError("PROJECT_NOT_FOUND", `Project '${id}' not found`, 404);
    }
    const project: any = projRes.rows[0];

    // -- 2. Load all domain entities ──────────────────────────────
    const [
      briefRes,
      sourcesRes,
      evidenceRes,
      personasRes,
      insightsRes,
      assumptionsRes,
      experimentsRes,
      competitorsRes,
      mvpRes,
    ] = await Promise.all([
      db.execute({ sql: "SELECT * FROM idea_briefs WHERE project_id = ? ORDER BY version DESC LIMIT 1", args: [id] }),
      db.execute({ sql: "SELECT * FROM sources WHERE project_id = ?", args: [id] }),
      db.execute({ sql: "SELECT * FROM evidence WHERE project_id = ?", args: [id] }),
      db.execute({ sql: "SELECT * FROM personas WHERE project_id = ?", args: [id] }),
      db.execute({ sql: "SELECT * FROM insights WHERE project_id = ?", args: [id] }),
      db.execute({ sql: "SELECT * FROM assumptions WHERE project_id = ? ORDER BY uncertainty DESC, impact DESC", args: [id] }),
      db.execute({ sql: "SELECT * FROM experiments WHERE project_id = ?", args: [id] }),
      db.execute({ sql: "SELECT * FROM competitors WHERE project_id = ?", args: [id] }),
      db.execute({ sql: "SELECT * FROM mvp_features WHERE project_id = ? ORDER BY CASE priority WHEN 'now' THEN 1 WHEN 'later' THEN 2 WHEN 'omit' THEN 3 ELSE 4 END", args: [id] }),
    ]);

    const brief: any = briefRes.rows[0] || null;
    const sources = sourcesRes.rows;
    const evidence = evidenceRes.rows;
    
    // Deduplicate personas by ID and name (Decision D20)
    const seenPersonaIds = new Set<string>();
    const seenPersonaNames = new Set<string>();
    const personas = (personasRes.rows as any[]).filter((p: any) => {
      const nameKey = (p.name || "").trim().toLowerCase();
      if (seenPersonaIds.has(p.id) || (nameKey && seenPersonaNames.has(nameKey))) {
        return false;
      }
      seenPersonaIds.add(p.id);
      if (nameKey) seenPersonaNames.add(nameKey);
      return true;
    });

    // Deduplicate insights by ID and normalized statement (Decision D21)
    const insights = deduplicateInsights(insightsRes.rows as any[]);
    const assumptions = assumptionsRes.rows as any[];
    const experiments = experimentsRes.rows as any[];
    // Deduplicate competitors by semantic identity and distinct use cases (Decision D22)
    const competitors = deduplicateCompetitors(competitorsRes.rows as any[]);
    const mvpFeatures = mvpRes.rows as any[];

    // -- 3. Compute provenance manifest ───────────────────────────
    const allProvenance: string[] = [
      ...(brief ? [brief.provenance] : []),
      ...sources.map((s: any) => (isPlaceholderSource(s) ? "SAMPLE" : s.provenance || "REAL_SOURCE")),
      ...evidence.map((e: any) => e.provenance),
      ...personas.map((p: any) => p.provenance),
      ...insights.map((i: any) => i.provenance),
      ...assumptions.map((a: any) => a.provenance),
      ...experiments.map((e: any) => e.provenance),
      ...competitors.map((c: any) => c.provenance),
      ...mvpFeatures.map((m: any) => m.provenance),
    ];

    const provenanceManifest: Record<string, number> = {
      USER_INPUT: 0,
      REAL_SOURCE: 0,
      AI_INFERENCE: 0,
      SIMULATED: 0,
      SAMPLE: 0,
      REAL_EXPERIMENT_RESULT: 0,
    };
    for (const p of allProvenance) {
      if (p in provenanceManifest) provenanceManifest[p]++;
    }

    const containsSimulated = provenanceManifest.SIMULATED > 0;
    const containsSample = provenanceManifest.SAMPLE > 0;

    // -- 4. Build report sections ─────────────────────────────────
    const nowFeatures = mvpFeatures.filter((f) => f.priority === "now");
    const laterFeatures = mvpFeatures.filter((f) => f.priority === "later");
    const omitFeatures = mvpFeatures.filter((f) => f.priority === "omit");

    const criticalAssumptions = assumptions.filter((a) =>
      calcPriorityScore(a.uncertainty, a.impact) >= 6
    );
    const testedAssumptions = assumptions.filter((a) => a.status === "validated" || a.status === "invalidated");

    const completedExperiments = experiments.filter((e) => e.status === "completed");
    const realResults = experiments.filter(
      (e) =>
        e.provenance === "REAL_EXPERIMENT_RESULT" &&
        typeof e.result === "string" &&
        e.result.trim().length > 0
    );

    const sections = [
      {
        id: "sec-brief",
        title: "Idea Brief & Problem Statement",
        provenance: brief?.provenance || "USER_INPUT",
        content: brief
          ? `Problem: ${brief.problem}\n\nTarget Customer: ${brief.target_customer}\n\nProposed Solution: ${brief.solution}${brief.geography ? `\n\nGeography: ${brief.geography}` : ""}${brief.category ? `\n\nCategory: ${brief.category}` : ""}`
          : "No idea brief recorded yet.",
        caveat: null,
      },
      {
        id: "sec-sources",
        title: "Research Sources & Evidence",
        provenance: (() => {
          const hasPlaceholder =
            sources.some((s: any) => isPlaceholderSource(s)) ||
            evidence.some((e: any) => isPlaceholderEvidence(e));
          const hasReal =
            sources.some((s: any) => !isPlaceholderSource(s)) ||
            evidence.some((e: any) => e.provenance === "REAL_SOURCE" && !isPlaceholderEvidence(e));
          if (hasPlaceholder) return "SAMPLE";
          if (hasReal) return "REAL_SOURCE";
          return "USER_INPUT";
        })(),
        content: (() => {
          const realSources = sources.filter((s: any) => !isPlaceholderSource(s));
          const placeholderSources = sources.filter((s: any) => isPlaceholderSource(s));
          const verifiedReal = evidence.filter((e: any) => isVerifiedRealEvidence(e));
          const sampleClaims = evidence.filter((e: any) => isPlaceholderEvidence(e));
          const rejectedClaims = evidence.filter((e: any) => (e.reviewer_status || "").toUpperCase() === "REJECTED");

          if (sources.length === 0) {
            return "No sources or evidence have been indexed in this project.";
          }

          return `${sources.length} source(s) indexed (${realSources.length} real external web, ${placeholderSources.length} demo placeholder).\n\n${sources
            .map(
              (s: any, i: number) =>
                `${i + 1}. [${s.source_type || s.type || "Source"}] ${s.title || s.url || "Untitled"} — ${
                  isPlaceholderSource(s) ? "SAMPLE (Unverified Placeholder)" : (s.provenance || "REAL_SOURCE")
                }`
            )
            .join("\n")}\n\nEvidence Review Summary:\n• Verified Real-World Evidence: ${verifiedReal.length} item(s) independently verified.\n• Illustrative Sample Claims: ${sampleClaims.length} item(s) (unverified demo fixtures — quarantined from evidence counts).\n• Rejected Claims: ${rejectedClaims.length} item(s).`;
        })(),
        caveat: (() => {
          const verifiedReal = evidence.filter((e: any) => isVerifiedRealEvidence(e));
          if (verifiedReal.length === 0) {
            return "⚠️ WARNING: Zero independently verified real-world evidence items recorded in this project. All accepted claims are illustrative demo fixtures backed by placeholder domains (RFC 2606). They do NOT constitute proof of customer demand, market traction, or problem severity.";
          }
          if (containsSimulated) {
            return "⚠️ Some evidence may be derived from simulated personas. Cross-validate against real research.";
          }
          return null;
        })(),
      },
      {
        id: "sec-personas",
        title: "Customer Personas",
        provenance: personas.length > 0 ? (personas[0] as any).provenance : "SIMULATED",
        content: personas.length > 0
          ? personas.map((p: any, i: number) => `${i + 1}. ${p.name} — ${p.segment || "General"}: ${p.context || p.bio || "No description recorded."}`).join("\n\n")
          : "No customer personas have been created yet.",
        caveat:
          personas.some((p: any) => p.provenance === "SIMULATED")
            ? "⚠️ CRITICAL: One or more personas are AI-simulated archetypes. They represent plausible hypotheses, NOT real customer evidence. Never cite simulated personas as demand validation."
            : null,
      },
      {
        id: "sec-insights",
        title: "Research Insights & Synthesis",
        provenance: insights.length > 0 ? insights[0].provenance : "AI_INFERENCE",
        content: insights.length > 0
          ? insights
              .map((ins: any, i: number) => {
                const isPlaceholder = isPlaceholderBackedInsight(ins);
                const stmt = sanitizeInsightStatement(ins.statement, isPlaceholder);
                const cav = sanitizeInsightCaveat(ins.caveat, isPlaceholder);
                return `${i + 1}. [${ins.provenance}] ${ins.type || "theme"}: ${stmt}${cav ? ` (Caveat: ${cav})` : ""}`;
              })
              .join("\n\n")
          : "No research insights have been synthesized yet.",
        caveat: (() => {
          const hasPlaceholder = insights.some((i: any) => isPlaceholderBackedInsight(i));
          const hasAi = insights.some((i: any) => i.provenance === "AI_INFERENCE");
          const caveats: string[] = [];
          if (hasPlaceholder) {
            caveats.push("⚠️ WARNING: Synthesis includes unverified sample claims or demo placeholder metrics (RFC 2606 example domains). These are illustrative only and CANNOT be cited as established customer evidence or market validation.");
          }
          if (hasAi) {
            caveats.push("AI-synthesized insights reflect model inferences from available inputs and must be treated as hypotheses pending primary customer validation.");
          }
          return caveats.length > 0 ? caveats.join(" ") : null;
        })(),
      },
      {
        id: "sec-assumptions",
        title: "Risk Assumption Register",
        provenance: "USER_INPUT",
        content: assumptions.length > 0
          ? `${assumptions.length} assumption(s) registered.\n\nCritical/High Priority: ${criticalAssumptions.length}\nTested: ${testedAssumptions.length} (${assumptions.filter((a) => a.status === "validated").length} validated, ${assumptions.filter((a) => a.status === "invalidated").length} invalidated)\n\nTop Critical Assumptions:\n${criticalAssumptions
              .slice(0, 5)
              .map((a: any, i: number) => `${i + 1}. [Score: ${calcPriorityScore(a.uncertainty, a.impact)}] ${a.statement} — Status: ${formatAssumptionStatus(a.status)}`)
              .join("\n")}`
          : "No risk assumptions have been registered.",
        caveat: null,
      },
      {
        id: "sec-competitors",
        title: "Competitive Landscape",
        provenance: competitors.length > 0 ? competitors[0].provenance : "AI_INFERENCE",
        content: competitors.length > 0
          ? `${competitors.length} alternative(s) / competitor(s) mapped.\n\n${competitors
              .map((c: any, i: number) => {
                const catLabel = formatCompetitorCategory(c.category);
                const provTag = c.provenance === "SAMPLE"
                  ? " [Sample Demo Alternative]"
                  : c.provenance === "AI_INFERENCE"
                  ? " [AI Inference — Hypothesized Alternative]"
                  : "";
                return `${i + 1}. [${catLabel}] ${c.name}${provTag}: ${c.description || "No description."}${c.differentiator ? `\n   Differentiator: ${c.differentiator}` : ""}`;
              })
              .join("\n\n")}`
          : "No competitor mapping has been completed.",
        caveat: (() => {
          const hasSample = competitors.some((c: any) => c.provenance === "SAMPLE");
          const hasAi = competitors.some((c: any) => c.provenance === "AI_INFERENCE");
          const caveats: string[] = [];
          if (hasSample) {
            caveats.push("⚠️ WARNING: Competitive landscape includes illustrative sample fixtures. These are demo placeholders and cannot be cited as real market share, competitor intelligence, or validated customer adoption.");
          }
          if (hasAi) {
            caveats.push("AI-generated competitor entries are model hypotheses and have not been empirically verified against primary market research or actual student behavior.");
          }
          return caveats.length > 0 ? caveats.join(" ") : null;
        })(),
      },
      {
        id: "sec-differentiation",
        title: "Competitor Differentiation Analysis",
        provenance: (() => {
          if (competitors.length === 0) return "USER_INPUT";
          if (competitors.some((c: any) => c.provenance === "SAMPLE")) return "SAMPLE";
          if (competitors.some((c: any) => c.provenance === "AI_INFERENCE")) return "AI_INFERENCE";
          return competitors[0]?.provenance || "USER_INPUT";
        })(),
        content: (() => {
          if (competitors.length === 0) {
            return "No competitors or alternatives mapped for this project. Map market alternatives in the Alternatives module to evaluate competitive positioning and differentiation hypotheses.";
          }
          const diffMetrics = getDifferentiationMetrics(competitors);
          const summary = [
            `Differentiation Overview & Coverage:`,
            `• Total Alternatives Mapped: ${diffMetrics.total}`,
            `• Articulated Differentiators: ${diffMetrics.articulated}`,
            `• Differentiation Gaps: ${diffMetrics.gaps}`,
            `• Differentiation Coverage: ${diffMetrics.coveragePercent}%`,
            "",
            `Competitive Differentiation Breakdown:`,
          ];

          const itemLines = competitors.map((c: any, i: number) => {
            const catLabel = formatCompetitorCategory(c.category);
            const isDiff = isDifferentiated(c);
            const statusLabel = isDiff ? "✓ ARTICULATED" : "⚠️ GAP — Unspecified";
            const diffText = isDiff
              ? c.differentiator.trim()
              : "No distinct differentiation hypothesis articulated (unspecified or generic placeholder).";
            const provTag = c.provenance === "SAMPLE"
              ? " [Sample Demo Alternative]"
              : c.provenance === "AI_INFERENCE"
              ? " [AI Inference — Hypothesized Alternative]"
              : ` [${c.provenance || "USER_INPUT"}]`;

            return `${i + 1}. [${catLabel}] ${c.name}${provTag} — ${statusLabel}\n   • Current Solution: ${c.description || "No description provided."}\n   • Our Differentiation Advantage: ${diffText}`;
          });

          const markdownTable = buildDifferentiationMarkdownTable(competitors);

          return `${summary.join("\n")}\n${itemLines.join("\n\n")}\n\nComparative Differentiation Grid:\n${markdownTable}`;
        })(),
        caveat: (() => {
          if (competitors.length === 0) return null;
          const caveats: string[] = [
            "⚠️ STRATEGIC HYPOTHESIS NOTICE: An articulated differentiation claim represents a founder hypothesis, NOT validated customer preference or empirical market proof. A claimed advantage must be tested through customer discovery interviews and willingness-to-pay experiments before treating it as a true competitive moat.",
          ];
          if (competitors.some((c: any) => c.provenance === "SAMPLE")) {
            caveats.push(
              "⚠️ WARNING: Competitive landscape includes illustrative sample fixtures. These are demo placeholders and cannot be cited as real market intelligence or validated customer adoption."
            );
          }
          if (competitors.some((c: any) => c.provenance === "AI_INFERENCE")) {
            caveats.push(
              "AI-generated differentiation hypotheses reflect model inferences and have not been validated against real customer purchase behavior."
            );
          }
          return caveats.join(" ");
        })(),
        metrics: getDifferentiationMetrics(competitors),
        items: competitors.map((c: any) => ({
          id: c.id,
          name: c.name,
          category: c.category,
          description: c.description || "",
          differentiator: c.differentiator || "",
          provenance: c.provenance || "USER_INPUT",
          isDifferentiated: isDifferentiated(c),
        })),
      },
      {
        id: "sec-experiments",
        title: "Validation Experiments & Results",
        provenance: realResults.length > 0
          ? "REAL_EXPERIMENT_RESULT"
          : experiments.length > 0
          ? (experiments[0]?.provenance || "USER_INPUT")
          : "USER_INPUT",
        content: experiments.length > 0
          ? `${experiments.length} experiment(s) designed.\n${completedExperiments.length} completed.\n${realResults.length} with real experiment results.\n\n${experiments
              .map((e: any, i: number) => {
                return `${i + 1}. ${e.hypothesis} [${e.status}] (Method: ${e.method}, Metric: ${e.metric})${e.result ? `\n   Result: ${e.result}` : ""}`;
              })
              .join("\n\n")}`
          : "No validation experiments have been designed yet.",
        caveat: realResults.length === 0
          ? "⚠️ No real experiment results have been recorded. All validation evidence is theoretical at this stage."
          : null,
      },
      {
        id: "sec-mvp",
        title: "MVP Scope & Feature Triage",
        provenance: "AI_INFERENCE",
        content: mvpFeatures.length > 0
          ? `Total features scoped: ${mvpFeatures.length}\n\n🟢 NOW (Core MVP): ${nowFeatures.length} feature(s)\n${nowFeatures.map((f: any) => `  • ${f.name} [${f.effort}] — ${f.rationale || ""}`).join("\n")}\n\n🟡 LATER (Deferred): ${laterFeatures.length} feature(s)\n${laterFeatures.map((f: any) => `  • ${f.name} [${f.effort}]`).join("\n")}\n\n🔴 OMIT (Excluded): ${omitFeatures.length} feature(s)\n${omitFeatures.map((f: any) => `  • ${f.name}`).join("\n")}`
          : "No MVP features have been scoped.",
        caveat: null,
      },
      {
        id: "sec-verdict",
        title: "Founder Validation Verdict",
        provenance: "AI_INFERENCE",
        content: buildVerdict({ assumptions, experiments, realResults, sources, evidence }),
        caveat:
          "⚠️ This verdict is AI-synthesized from the current state of data. It reflects the logical state of your validation pipeline, NOT a guarantee of business viability. All simulated evidence must be replaced by real customer conversations and experiment data before any investment, development, or go-to-market decisions.",
      },
    ];

    // -- 5. Compute version ───────────────────────────────────────
    const versionRes = await db.execute({
      sql: "SELECT COALESCE(MAX(version), 0) as max_v FROM report_snapshots WHERE project_id = ?",
      args: [id],
    });
    const nextVersion = ((versionRes.rows[0] as any).max_v || 0) + 1;
    const reportId = `report-${id}-v${nextVersion}-${Date.now()}`;
    const generatedAt = new Date().toISOString();

    // -- 6. Persist snapshot ──────────────────────────────────────
    await db.execute({
      sql: `INSERT INTO report_snapshots
              (id, project_id, content, provenance_manifest, contains_simulated, contains_sample, version, generated_at)
            VALUES (?,?,?,?,?,?,?,?)`,
      args: [
        reportId,
        id,
        JSON.stringify(sections),
        JSON.stringify(provenanceManifest),
        containsSimulated ? 1 : 0,
        containsSample ? 1 : 0,
        nextVersion,
        generatedAt,
      ] as any[],
    });

    // Reconcile report stage (Phase 3J)
    await reconcileProjectStages(id);

    const diffMetrics = getDifferentiationMetrics(competitors);

    return apiSuccess({
      projectId: id,
      report: {
        id: reportId,
        project_id: id,
        version: nextVersion,
        generated_at: generatedAt,
        content: sections,
        provenance_manifest: provenanceManifest,
        contains_simulated: containsSimulated,
        contains_sample: containsSample,
        project,
        brief,
        stats: {
          sources: sources.length,
          evidence: evidence.length,
          personas: personas.length,
          insights: insights.length,
          assumptions: assumptions.length,
          experiments: experiments.length,
          competitors: competitors.length,
          mvp_features: mvpFeatures.length,
          real_experiment_results: realResults.length,
          differentiated_competitors: diffMetrics.articulated,
          differentiation_coverage_pct: diffMetrics.coveragePercent,
        },
      },
    }, "AI_INFERENCE", 201);
  } catch (err: any) {
    console.error("POST /api/projects/[id]/report error:", err);
    return apiError("REPORT_GENERATION_FAILED", err.message, 500);
  }
}

// ── Verdict synthesizer ───────────────────────────────────────────
export function buildVerdict({
  assumptions,
  experiments,
  realResults,
  sources,
  evidence,
}: {
  assumptions: any[];
  experiments: any[];
  realResults: any[];
  sources: any[];
  evidence: any[];
}): string {
  const validatedAssumptions = assumptions.filter((a) => a.status === "validated").length;
  const invalidatedAssumptions = assumptions.filter((a) => a.status === "invalidated").length;
  const criticalUntested = assumptions.filter(
    (a) => calcPriorityScore(a.uncertainty, a.impact) >= 6 && (a.status === "unvalidated" || a.status === "testing")
  ).length;

  const validRealResults = (realResults || []).filter(
    (e: any) =>
      e &&
      e.provenance === "REAL_EXPERIMENT_RESULT" &&
      typeof e.result === "string" &&
      e.result.trim().length > 0
  );

  const realSources = (sources || []).filter(
    (s: any) =>
      s &&
      !isPlaceholderSource(s) &&
      s.provenance !== "SIMULATED" &&
      s.provenance !== "SAMPLE" &&
      s.provenance !== "AI_INFERENCE" &&
      s.provenance !== "USER_INPUT" &&
      s.source_type !== "user_input"
  );

  const realEvidence = (evidence || []).filter(
    (e: any) =>
      e &&
      !isPlaceholderEvidence(e) &&
      (e.provenance === "REAL_SOURCE" || isVerifiedRealEvidence(e)) &&
      e.provenance !== "SIMULATED" &&
      e.provenance !== "SAMPLE" &&
      e.provenance !== "AI_INFERENCE" &&
      e.provenance !== "USER_INPUT"
  );

  const hasRealData = validRealResults.length > 0 || realSources.length > 0 || realEvidence.length > 0;

  if (!hasRealData) {
    return `VALIDATION STATUS: ⛔ PRE-VALIDATION\n\nNo real customer data, experiment results, or verified sources have been collected. The idea is currently at the hypothesis stage.\n\nRequired next actions:\n1. Conduct ${criticalUntested} untested critical assumption interview(s) with real customers\n2. Execute the designed experiment(s) with measurable success criteria\n3. Replace all SIMULATED personas with real interview transcripts\n\nThe core premise has not been falsified yet, but it has also not been confirmed. Do not build until Experiment 1 passes its defined threshold.`;
  }

  if (invalidatedAssumptions > validatedAssumptions) {
    return `VALIDATION STATUS: 🔴 HYPOTHESIS CHALLENGED\n\n${invalidatedAssumptions} assumption(s) have been invalidated vs ${validatedAssumptions} validated. The current direction requires a pivot or deeper investigation.\n\nReview invalidated assumptions and determine if the core problem statement still holds, or if a significant pivot is required.`;
  }

  if (validRealResults.length > 0 && validatedAssumptions > 0) {
    return `VALIDATION STATUS: 🟡 PARTIAL VALIDATION\n\n${validRealResults.length} real experiment result(s) recorded. ${validatedAssumptions} assumption(s) validated.\n\n${criticalUntested > 0 ? `${criticalUntested} critical/high assumptions still untested — continue validation before committing to full build.` : "All critical assumptions have been tested. Consider progressing to MVP build phase."}`;
  }

  return `VALIDATION STATUS: 🟡 IN PROGRESS\n\nValidation pipeline is active. ${experiments.length} experiment(s) designed, ${validatedAssumptions} assumption(s) validated.\n\nContinue executing experiments and collecting real customer evidence before drawing conclusions.`;
}

