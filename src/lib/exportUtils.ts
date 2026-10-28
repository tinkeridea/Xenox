/**
 * IdeaProbe Export Utilities (Phase 3M)
 * Robust CSV and JSON generators for:
 * 1. Competitor Differentiation Matrices
 * 2. Evidence Ledgers
 *
 * Implements RFC 4180 CSV escaping, UTF-8 BOM, strict project isolation,
 * and provenance preservation without inventing unverified facts.
 */

import {
  isDifferentiated,
  getDifferentiationMetrics,
  formatCompetitorCategory,
} from "./competitorValidation";

// ── Types ────────────────────────────────────────────────────────

export interface CompetitorExportItem {
  id: string;
  project_id?: string;
  name: string;
  category: string;
  description?: string | null;
  differentiator?: string | null;
  provenance?: string;
  created_at?: string | null;
}

export interface EvidenceExportItem {
  id: string;
  project_id?: string;
  claim: string;
  excerpt?: string | null;
  source_id?: string | null;
  source_title?: string | null;
  source_url?: string | null;
  source_type?: string | null;
  source_type_resolved?: string | null;
  provenance: string;
  confidence?: string;
  reviewer_status?: string;
  caveat?: string | null;
  created_at?: string | null;
}

export interface ExportProjectMeta {
  projectId: string;
  projectTitle?: string | null;
  mode?: string | null;
}

export interface CompetitorExportJson {
  export_type: "competitor_differentiation_matrix";
  project_id: string;
  project_title: string | null;
  project_mode: string | null;
  generated_at: string;
  disclaimer: string;
  metrics: {
    total_alternatives: number;
    articulated_differentiators: number;
    differentiation_gaps: number;
    coverage_percent: number;
  };
  competitors: Array<{
    id: string;
    project_id: string;
    name: string;
    category: string;
    category_display: string;
    current_solution: string;
    articulated_differentiator: string;
    is_differentiated: boolean;
    differentiation_status: "ARTICULATED" | "GAP";
    provenance: string;
    created_at: string | null;
  }>;
}

export interface EvidenceExportJson {
  export_type: "evidence_ledger";
  project_id: string;
  project_title: string | null;
  project_mode: string | null;
  generated_at: string;
  metrics: {
    total_evidence: number;
    accepted_count: number;
    unreviewed_count: number;
    edited_count: number;
    rejected_count: number;
    verified_real_count: number;
    sample_placeholder_count: number;
  };
  evidence: Array<{
    id: string;
    project_id: string;
    claim: string;
    excerpt: string | null;
    source_id: string | null;
    source_title: string | null;
    source_url: string | null;
    source_type: string | null;
    provenance: string;
    confidence: string;
    reviewer_status: string;
    caveat: string | null;
    created_at: string | null;
  }>;
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Escapes a cell for RFC 4180 compliant CSV.
 * - Null / undefined become empty string "".
 * - If string contains comma, quote, or newline (\n, \r), wraps in quotes and doubles inner quotes.
 */
export function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Sanitizes a filename string to prevent path traversal or invalid characters.
 */
export function sanitizeFilename(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "export";
}

/**
 * Triggers safe browser download using a temporary Blob URL.
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Competitor Differentiation Exports ───────────────────────────

export const COMPETITOR_CSV_HEADERS = [
  "Competitor ID",
  "Project ID",
  "Name",
  "Category",
  "Category Display",
  "Current Solution / Offer",
  "Articulated Differentiator",
  "Differentiation Status",
  "Provenance",
  "Created At",
] as const;

/**
 * Generates an RFC 4180 CSV string for competitor differentiation matrix.
 * Includes UTF-8 BOM so Excel and spreadsheet applications display UTF-8 without corruption.
 */
export function generateCompetitorCsv(
  items: CompetitorExportItem[],
  projectId: string
): string {
  const headerLine = COMPETITOR_CSV_HEADERS.map(escapeCsvCell).join(",");
  const lines = [headerLine];

  for (const c of items) {
    const isDiff = isDifferentiated(c);
    const catDisplay = formatCompetitorCategory(c.category);
    const row = [
      escapeCsvCell(c.id),
      escapeCsvCell(c.project_id || projectId),
      escapeCsvCell(c.name),
      escapeCsvCell(c.category),
      escapeCsvCell(catDisplay),
      escapeCsvCell(c.description || ""),
      escapeCsvCell(c.differentiator || ""),
      escapeCsvCell(isDiff ? "ARTICULATED" : "GAP"),
      escapeCsvCell(c.provenance || "SAMPLE"),
      escapeCsvCell(c.created_at || ""),
    ];
    lines.push(row.join(","));
  }

  // Prepend UTF-8 BOM
  return "\uFEFF" + lines.join("\r\n");
}

/**
 * Generates structured JSON for competitor differentiation matrix.
 */
export function generateCompetitorJson(
  items: CompetitorExportItem[],
  meta: ExportProjectMeta
): CompetitorExportJson {
  const metrics = getDifferentiationMetrics(items);

  return {
    export_type: "competitor_differentiation_matrix",
    project_id: meta.projectId,
    project_title: meta.projectTitle || null,
    project_mode: meta.mode || null,
    generated_at: new Date().toISOString(),
    disclaimer:
      "An articulated differentiator is a strategic positioning hypothesis, NOT validated customer preference or empirical market proof. Customer willingness to pay and behavioral differentiation require empirical validation.",
    metrics: {
      total_alternatives: metrics.total,
      articulated_differentiators: metrics.articulated,
      differentiation_gaps: metrics.gaps,
      coverage_percent: metrics.coveragePercent,
    },
    competitors: items.map((c) => {
      const isDiff = isDifferentiated(c);
      return {
        id: c.id,
        project_id: c.project_id || meta.projectId,
        name: c.name,
        category: c.category,
        category_display: formatCompetitorCategory(c.category),
        current_solution: c.description || "",
        articulated_differentiator: c.differentiator || "",
        is_differentiated: isDiff,
        differentiation_status: isDiff ? "ARTICULATED" : "GAP",
        provenance: c.provenance || "SAMPLE",
        created_at: c.created_at || null,
      };
    }),
  };
}

// ── Evidence Ledger Exports ──────────────────────────────────────

export const EVIDENCE_CSV_HEADERS = [
  "Evidence ID",
  "Project ID",
  "Claim",
  "Excerpt",
  "Source ID",
  "Source Title",
  "Source URL",
  "Source Type",
  "Provenance",
  "Confidence",
  "Reviewer Status",
  "Caveat",
  "Created At",
] as const;

/**
 * Generates an RFC 4180 CSV string for evidence ledger.
 * Includes UTF-8 BOM so Excel and spreadsheet applications display UTF-8 without corruption.
 */
export function generateEvidenceCsv(
  items: EvidenceExportItem[],
  projectId: string
): string {
  const headerLine = EVIDENCE_CSV_HEADERS.map(escapeCsvCell).join(",");
  const lines = [headerLine];

  for (const e of items) {
    const row = [
      escapeCsvCell(e.id),
      escapeCsvCell(e.project_id || projectId),
      escapeCsvCell(e.claim),
      escapeCsvCell(e.excerpt || ""),
      escapeCsvCell(e.source_id || ""),
      escapeCsvCell(e.source_title || ""),
      escapeCsvCell(e.source_url || ""),
      escapeCsvCell(e.source_type_resolved || e.source_type || ""),
      escapeCsvCell(e.provenance),
      escapeCsvCell(e.confidence || "Medium"),
      escapeCsvCell(e.reviewer_status || "UNREVIEWED"),
      escapeCsvCell(e.caveat || ""),
      escapeCsvCell(e.created_at || ""),
    ];
    lines.push(row.join(","));
  }

  // Prepend UTF-8 BOM
  return "\uFEFF" + lines.join("\r\n");
}

/**
 * Generates structured JSON for evidence ledger.
 */
export function generateEvidenceJson(
  items: EvidenceExportItem[],
  meta: ExportProjectMeta
): EvidenceExportJson {
  const accepted_count = items.filter((e) => (e.reviewer_status || "").toUpperCase() === "ACCEPTED").length;
  const unreviewed_count = items.filter((e) => !e.reviewer_status || (e.reviewer_status || "").toUpperCase() === "UNREVIEWED").length;
  const edited_count = items.filter((e) => (e.reviewer_status || "").toUpperCase() === "EDITED").length;
  const rejected_count = items.filter((e) => (e.reviewer_status || "").toUpperCase() === "REJECTED").length;
  const verified_real_count = items.filter((e) => e.provenance === "REAL_SOURCE" || e.provenance === "REAL_EXPERIMENT_RESULT").length;
  const sample_placeholder_count = items.filter((e) => e.provenance === "SAMPLE" || e.provenance === "SIMULATED").length;

  return {
    export_type: "evidence_ledger",
    project_id: meta.projectId,
    project_title: meta.projectTitle || null,
    project_mode: meta.mode || null,
    generated_at: new Date().toISOString(),
    metrics: {
      total_evidence: items.length,
      accepted_count,
      unreviewed_count,
      edited_count,
      rejected_count,
      verified_real_count,
      sample_placeholder_count,
    },
    evidence: items.map((e) => ({
      id: e.id,
      project_id: e.project_id || meta.projectId,
      claim: e.claim,
      excerpt: e.excerpt || null,
      source_id: e.source_id || null,
      source_title: e.source_title || null,
      source_url: e.source_url || null,
      source_type: e.source_type_resolved || e.source_type || null,
      provenance: e.provenance,
      confidence: e.confidence || "Medium",
      reviewer_status: e.reviewer_status || "UNREVIEWED",
      caveat: e.caveat || null,
      created_at: e.created_at || null,
    })),
  };
}
