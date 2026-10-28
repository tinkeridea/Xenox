/**
 * Competitor Validation, Formatting, and Deduplication Utilities
 * Ensures competitive landscape records maintain human-readable categories,
 * semantic deduplication (avoiding duplicate status quo / alternatives),
 * and transparent provenance labeling.
 */

import type { CompetitorCategory } from "@/types";

export const COMPETITOR_CATEGORY_LABELS: Record<string, string> = {
  direct: "Direct Competitor",
  indirect: "Indirect Competitor",
  substitute: "Substitute",
  status_quo: "Status Quo",
};

/**
 * Returns a clean, human-readable label for a competitor category.
 * Prevents raw database enums (e.g. '[status_quo]', '[substitute]') from leaking into reports or UI.
 */
export function formatCompetitorCategory(category: string): string {
  const key = (category || "").toLowerCase().trim();
  return COMPETITOR_CATEGORY_LABELS[key] || category || "Competitor";
}

/**
 * Normalizes competitor name for comparison (lowercased, collapsed whitespace, punctuation stripped).
 */
export function normalizeCompetitorName(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Generates a semantic use-case key for a competitor record.
 * Deduplicates by meaning rather than naive product name, ensuring:
 * 1. Physical paper timetables/notebooks map to the same status quo behavior.
 * 2. General Google Calendar reminder usage is separated from active Study-Block time blocking.
 * 3. General Notion syllabus/task workspace usage is consolidated unless a genuinely different job is specified.
 */
export function getSemanticCompetitorKey(item: {
  id?: string;
  name: string;
  category: string;
  description?: string;
}): string {
  const normName = normalizeCompetitorName(item.name);
  const normDesc = (item.description || "").toLowerCase();
  const cat = (item.category || "").toLowerCase().trim();

  // 1. Physical paper/manual timetable status quo
  if (
    cat === "status_quo" &&
    (normName.includes("manual") || normName.includes("paper") || normName.includes("notebook") || normName.includes("timetable") || normName.includes("physical"))
  ) {
    return "status_quo:paper_timetable";
  }

  // 2. Google Calendar
  if (normName.includes("google calendar") || normName.includes("calendar")) {
    if (normName.includes("study block") || normDesc.includes("study block") || normDesc.includes("time-block") || normDesc.includes("time block")) {
      return `${cat}:google_calendar:study_blocks`;
    }
    return `${cat}:google_calendar:general_deadlines`;
  }

  // 3. Notion
  if (normName.includes("notion")) {
    return `${cat}:notion:workspace_templates`;
  }

  // Default: category + normalized name
  return `${cat}:${normName}`;
}

/**
 * Deduplicates a list of competitors by semantic identity.
 * Prioritizes canonical records (comp-01 to comp-05) and preserves distinct use cases.
 */
export function deduplicateCompetitors<T extends {
  id?: string;
  name: string;
  category: string;
  description?: string;
  provenance?: string;
}>(items: T[]): T[] {
  const seenKeys = new Map<string, T>();
  const seenNames = new Map<string, T>();

  for (const item of items) {
    const key = getSemanticCompetitorKey(item);
    const normName = normalizeCompetitorName(item.name);
    const existing = seenKeys.get(key) || seenNames.get(normName);

    if (!existing) {
      seenKeys.set(key, item);
      seenNames.set(normName, item);
      continue;
    }

    // If existing is not a canonical seed record, but current item IS a canonical record, replace it
    const isCurrentCanonical = Boolean(item.id && item.id.startsWith("comp-0"));
    const isExistingCanonical = Boolean(existing.id && existing.id.startsWith("comp-0"));

    if (isCurrentCanonical && !isExistingCanonical) {
      seenKeys.set(key, item);
      seenNames.set(normName, item);
    }
  }

  return Array.from(new Set(seenKeys.values()));
}

export interface DifferentiationMetrics {
  total: number;
  articulated: number;
  gaps: number;
  coveragePercent: number;
}

/**
 * Checks whether a competitor has an articulated, meaningful differentiation hypothesis.
 * Returns false if differentiator is missing, empty, or placeholder ('Not specified', 'none', 'n/a').
 */
export function isDifferentiated(item: { differentiator?: string | null }): boolean {
  if (!item || typeof item.differentiator !== "string") return false;
  const trimmed = item.differentiator.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (
    lower === "not specified." ||
    lower === "not specified" ||
    lower === "none" ||
    lower === "none." ||
    lower === "n/a" ||
    lower === "tbd"
  ) {
    return false;
  }
  return true;
}

/**
 * Computes differentiation metrics and coverage statistics across a set of competitors.
 */
export function getDifferentiationMetrics(
  items: Array<{ differentiator?: string | null }>
): DifferentiationMetrics {
  const total = items.length;
  const articulated = items.filter(isDifferentiated).length;
  const gaps = total - articulated;
  const coveragePercent = total > 0 ? Math.round((articulated / total) * 100) : 0;
  return { total, articulated, gaps, coveragePercent };
}

/**
 * Formats a list of competitors into a clean, comparative Markdown Differentiation Grid table.
 * Useful for founders copying competitive positioning into pitches, briefs, or validation logs.
 */
export function buildDifferentiationMarkdownTable(
  items: Array<{
    name: string;
    category: string;
    description?: string | null;
    differentiator?: string | null;
    provenance?: string;
  }>
): string {
  if (!items || items.length === 0) {
    return "_No competitors or alternatives mapped._";
  }

  const rows: string[] = [
    "| Alternative | Category | Current Solution / Offer | Our Differentiation Advantage | Status | Provenance |",
    "|---|---|---|---|---|---|",
  ];

  for (const c of items) {
    const name = (c.name || "Unnamed").replace(/\|/g, "\\|");
    const category = formatCompetitorCategory(c.category).replace(/\|/g, "\\|");
    const desc = (c.description || "No description provided.")
      .replace(/\|/g, "\\|")
      .replace(/\r?\n/g, " ")
      .trim();
    const hasDiff = isDifferentiated(c);
    const diff = (c.differentiator || "Not specified.")
      .replace(/\|/g, "\\|")
      .replace(/\r?\n/g, " ")
      .trim();
    const status = hasDiff ? "✓ Articulated" : "⚠️ Gap (Unspecified)";
    const prov = (c.provenance || "USER_INPUT").replace(/\|/g, "\\|");

    rows.push(`| **${name}** | ${category} | ${desc} | ${diff} | ${status} | \`${prov}\` |`);
  }

  return rows.join("\n");
}

