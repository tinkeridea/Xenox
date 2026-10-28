import { NextRequest } from "next/server";
import { initDb, getDb, nowUtc } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { searchTinyFish } from "@/lib/tinyfish";
import { reconcileProjectStages } from "@/lib/stageReconciliation";
import {
  isValidHttpUrl,
  resolveSourceTitle,
  normalizeSourceUrl,
  normalizeClaimText,
} from "@/lib/sourceValidation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/projects/[id]/research-jobs — Trigger live web research crawl via TinyFish
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    await initDb();
    const { id } = await params;
    const db = getDb();

    // 1. Verify project exists
    const projRes = await db.execute({
      sql: "SELECT id, title FROM projects WHERE id = ?",
      args: [id],
    });
    if (projRes.rows.length === 0) {
      return apiError("PROJECT_NOT_FOUND", `Project '${id}' not found.`, 404);
    }
    const project = projRes.rows[0];

    // 2. Read query from body or build intelligent query from idea brief
    const body = await req.json().catch(() => ({}));
    let query: string = typeof body.query === "string" ? body.query.trim() : "";

    if (!query) {
      const briefRes = await db.execute({
        sql: "SELECT problem, target_customer, category FROM idea_briefs WHERE project_id = ? ORDER BY version DESC LIMIT 1",
        args: [id],
      });
      const brief = briefRes.rows[0] as { problem?: string; target_customer?: string; category?: string } | undefined;

      if (brief?.target_customer && brief?.problem) {
        // Extract 3-5 keywords
        const targetClean = brief.target_customer.split(" ").slice(0, 4).join(" ");
        const problemClean = brief.problem.split(" ").slice(0, 5).join(" ");
        query = `${targetClean} ${problemClean}`;
      } else {
        query = `${project.title} market research`;
      }
    }

    const maxResults = typeof body.maxResults === "number" ? Math.min(body.maxResults, 10) : 4;

    // 3. Execute live TinyFish search
    const searchOutcome = await searchTinyFish(query, maxResults);

    if (!searchOutcome.success) {
      return apiError(
        "TINYFISH_RESEARCH_FAILED",
        searchOutcome.error || "TinyFish search failed to complete.",
        502,
        true,
        { query, latencyMs: searchOutcome.latencyMs }
      );
    }

    const now = nowUtc();
    const createdSources: any[] = [];
    const createdEvidence: any[] = [];
    const batchStatements: Array<{ sql: string; args: any[] }> = [];

    // 4. Ingest and persist results to SQLite with conservative deduplication and title safety
    // Query existing project sources and evidence for project-scoped deduplication
    const existingSourcesRes = await db.execute({
      sql: "SELECT id, url, title, publisher FROM sources WHERE project_id = ?",
      args: [id],
    });

    const sourceByNormUrl = new Map<string, { id: string; url: string; title: string; publisher: string | null }>();
    for (const row of existingSourcesRes.rows) {
      if (typeof row.url === "string" && row.url.trim()) {
        const norm = normalizeSourceUrl(row.url);
        if (norm && !sourceByNormUrl.has(norm)) {
          sourceByNormUrl.set(norm, {
            id: String(row.id),
            url: String(row.url),
            title: String(row.title),
            publisher: row.publisher ? String(row.publisher) : null,
          });
        }
      }
    }

    const existingEvidenceRes = await db.execute({
      sql: "SELECT id, source_id, claim FROM evidence WHERE project_id = ?",
      args: [id],
    });

    const existingEvidenceSet = new Set<string>();
    for (const row of existingEvidenceRes.rows) {
      if (typeof row.claim === "string") {
        const normClaim = normalizeClaimText(row.claim);
        if (normClaim) {
          existingEvidenceSet.add(`${row.source_id}:::${normClaim}`);
        }
      }
    }

    let itemCounter = 0;
    for (let i = 0; i < searchOutcome.results.length; i++) {
      const item = searchOutcome.results[i];
      // Discard items lacking a valid HTTP/HTTPS URL
      if (!item || !isValidHttpUrl(item.url)) {
        continue;
      }

      const rawUrl = String(item.url).trim();
      const normUrl = normalizeSourceUrl(rawUrl);
      const safeTitle = resolveSourceTitle(item.title, rawUrl, item.site_name);
      const siteName = typeof item.site_name === "string" && item.site_name.trim() ? item.site_name.trim() : null;

      let sourceId: string;

      // Check if source already exists for this project or was registered in earlier iteration of this job
      if (sourceByNormUrl.has(normUrl)) {
        sourceId = sourceByNormUrl.get(normUrl)!.id;
      } else {
        sourceId = `src-tf-${Date.now()}-${itemCounter++}`;
        sourceByNormUrl.set(normUrl, {
          id: sourceId,
          url: rawUrl,
          title: safeTitle,
          publisher: siteName,
        });

        // Queue concurrency-safe insert
        batchStatements.push({
          sql: `INSERT INTO sources
                  (id, project_id, url, title, publisher, retrieved_at, source_type, provider, created_at)
                SELECT ?, ?, ?, ?, ?, ?, 'web', 'tinyfish', ?
                WHERE NOT EXISTS (
                  SELECT 1 FROM sources WHERE project_id = ? AND (url = ? OR LOWER(TRIM(url)) = LOWER(TRIM(?)))
                )`,
          args: [sourceId, id, rawUrl, safeTitle, siteName, now, now, id, rawUrl, rawUrl],
        });

        createdSources.push({
          id: sourceId,
          url: rawUrl,
          title: safeTitle,
          publisher: siteName,
          source_type: "web",
          provider: "tinyfish",
        });
      }

      // 5. Evidence claim extraction and deduplication
      const rawSnippet = typeof item.snippet === "string" ? item.snippet.trim() : "";
      const claimText = rawSnippet.length > 10 ? rawSnippet : safeTitle;
      const normClaim = normalizeClaimText(claimText);
      const claimKey = `${sourceId}:::${normClaim}`;

      if (normClaim && !existingEvidenceSet.has(claimKey)) {
        const evidenceId = `ev-tf-${Date.now()}-${itemCounter++}`;
        existingEvidenceSet.add(claimKey);

        batchStatements.push({
          sql: `INSERT INTO evidence
                  (id, project_id, source_id, claim, excerpt, provenance, confidence, reviewer_status, caveat, created_at)
                SELECT ?, ?, ?, ?, ?, 'REAL_SOURCE', 'High', 'UNREVIEWED', ?, ?
                WHERE NOT EXISTS (
                  SELECT 1 FROM evidence WHERE project_id = ? AND source_id = ? AND LOWER(TRIM(claim)) = LOWER(TRIM(?))
                )`,
          args: [
            evidenceId,
            id,
            sourceId,
            claimText,
            rawSnippet || null,
            `Live citation discovered via TinyFish Web Search. Site: ${siteName || safeTitle}. Requires human verification.`,
            now,
            id,
            sourceId,
            claimText,
          ],
        });

        createdEvidence.push({
          id: evidenceId,
          source_id: sourceId,
          source_title: safeTitle,
          source_url: rawUrl,
          claim: claimText,
          excerpt: rawSnippet || null,
          provenance: "REAL_SOURCE",
          confidence: "High",
          reviewer_status: "UNREVIEWED",
        });
      }
    }

    // 6. Execute atomic batch write if any statements queued
    if (batchStatements.length > 0) {
      await db.batch(batchStatements);
    }

    // 7. Reconcile project stages if new entities were created
    if (createdSources.length > 0 || createdEvidence.length > 0) {
      await reconcileProjectStages(id);
    }

    return apiSuccess(
      {
        jobId: `job-tf-${Date.now()}`,
        projectId: id,
        query,
        provider: "tinyfish",
        latencyMs: searchOutcome.latencyMs,
        sourcesCreated: createdSources.length,
        evidenceCreated: createdEvidence.length,
        sources: createdSources,
        evidence: createdEvidence,
      },
      "REAL_SOURCE",
      201
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("POST /api/projects/[id]/research-jobs error:", msg);
    return apiError("RESEARCH_JOB_ERROR", msg, 500);
  }
}
