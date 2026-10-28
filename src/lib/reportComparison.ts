/**
 * IdeaProbe — Report Snapshot Comparison Engine
 *
 * Implements deterministic, immutable comparison between two report snapshots.
 * Extracts verdict evolution, provenance deltas, section modifications,
 * and pipeline metric changes strictly grounded in stored snapshot data.
 */

export interface ReportSection {
  id: string;
  title: string;
  provenance: string;
  content: string;
  caveat: string | null;
}

export interface ReportSnapshot {
  id: string;
  project_id: string;
  run_id?: string | null;
  version: number;
  generated_at: string;
  content: ReportSection[] | string;
  provenance_manifest: Record<string, number> | string;
  contains_simulated: boolean | number;
  contains_sample: boolean | number;
  project?: any;
  brief?: any;
  stats?: Record<string, number>;
}

export interface ProvenanceDelta {
  key: string;
  baseCount: number;
  compareCount: number;
  delta: number;
}

export interface SectionComparison {
  sectionId: string;
  title: string;
  status: "identical" | "modified" | "added" | "removed";
  baseProvenance: string | null;
  compareProvenance: string | null;
  provenanceChanged: boolean;
  baseCaveat: string | null;
  compareCaveat: string | null;
  caveatChanged: boolean;
  contentChanged: boolean;
  baseContent: string;
  compareContent: string;
  summary: string;
}

export interface MetricComparison {
  metric: string;
  baseValue: number | string | null;
  compareValue: number | string | null;
  delta?: number;
  note?: string;
}

export interface ReportComparisonResult {
  baseVersion: number;
  compareVersion: number;
  baseGeneratedAt: string;
  compareGeneratedAt: string;
  baseId: string;
  compareId: string;
  isNewer: boolean;
  verdict: {
    baseHeadline: string;
    compareHeadline: string;
    changed: boolean;
    baseFull: string;
    compareFull: string;
  };
  provenance: {
    manifestDeltas: ProvenanceDelta[];
    totalBaseItems: number;
    totalCompareItems: number;
    totalDelta: number;
    containsSimulatedChanged: boolean;
    containsSampleChanged: boolean;
  };
  metrics: MetricComparison[];
  sections: SectionComparison[];
  totalSections: number;
  modifiedSectionsCount: number;
}

export function parseReportSections(content: any): ReportSection[] {
  if (Array.isArray(content)) {
    return content;
  }
  if (typeof content === "string") {
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return [];
    }
  }
  return [];
}

export function parseProvenanceManifest(manifest: any): Record<string, number> {
  if (typeof manifest === "object" && manifest !== null && !Array.isArray(manifest)) {
    return manifest;
  }
  if (typeof manifest === "string") {
    try {
      const parsed = JSON.parse(manifest);
      if (typeof parsed === "object" && parsed !== null) return parsed;
    } catch {
      return {};
    }
  }
  return {};
}

export function extractVerdictHeadline(verdictText?: string): string {
  if (!verdictText || typeof verdictText !== "string") {
    return "Status Unknown";
  }
  const lines = verdictText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const statusLine = lines.find((l) => l.includes("VALIDATION STATUS:"));
  if (statusLine) {
    return statusLine.replace("VALIDATION STATUS:", "").trim();
  }
  return lines[0] || "Status Unknown";
}

const ALL_PROVENANCE_KEYS = [
  "REAL_SOURCE",
  "REAL_EXPERIMENT_RESULT",
  "USER_INPUT",
  "AI_INFERENCE",
  "SIMULATED",
  "SAMPLE",
];

function extractMetricsFromSection(secId: string, content: string): Record<string, number> {
  const metrics: Record<string, number> = {};
  if (!content) return metrics;

  if (secId === "sec-assumptions") {
    const regMatch = content.match(/(\d+)\s+assumption\(s\)\s+registered/i);
    if (regMatch) metrics["Assumptions Registered"] = parseInt(regMatch[1], 10);
    const critMatch = content.match(/Critical\/High Priority:\s*(\d+)/i);
    if (critMatch) metrics["Critical Assumptions"] = parseInt(critMatch[1], 10);
    const valMatch = content.match(/(\d+)\s+validated/i);
    if (valMatch) metrics["Validated Assumptions"] = parseInt(valMatch[1], 10);
    const invalMatch = content.match(/(\d+)\s+invalidated/i);
    if (invalMatch) metrics["Invalidated Assumptions"] = parseInt(invalMatch[1], 10);
  } else if (secId === "sec-experiments") {
    const desMatch = content.match(/(\d+)\s+experiment\(s\)\s+designed/i);
    if (desMatch) metrics["Experiments Designed"] = parseInt(desMatch[1], 10);
    const compMatch = content.match(/(\d+)\s+completed/i);
    if (compMatch) metrics["Experiments Completed"] = parseInt(compMatch[1], 10);
    const realMatch = content.match(/(\d+)\s+with real experiment results/i);
    if (realMatch) metrics["Real Results Recorded"] = parseInt(realMatch[1], 10);
  } else if (secId === "sec-competitors") {
    const compMatch = content.match(/(\d+)\s+alternative\(s\)\s+\/\s+competitor\(s\)\s+mapped/i);
    if (compMatch) metrics["Competitors Mapped"] = parseInt(compMatch[1], 10);
  } else if (secId === "sec-differentiation") {
    const artMatch = content.match(/Articulated Differentiators:\s*(\d+)/i);
    if (artMatch) metrics["Articulated Differentiators"] = parseInt(artMatch[1], 10);
    const gapMatch = content.match(/Differentiation Gaps:\s*(\d+)/i);
    if (gapMatch) metrics["Differentiation Gaps"] = parseInt(gapMatch[1], 10);
    const covMatch = content.match(/Differentiation Coverage:\s*(\d+)%/i);
    if (covMatch) metrics["Differentiation Coverage %"] = parseInt(covMatch[1], 10);
  } else if (secId === "sec-mvp") {
    const totalMatch = content.match(/Total features scoped:\s*(\d+)/i);
    if (totalMatch) metrics["MVP Features Scoped"] = parseInt(totalMatch[1], 10);
    const nowMatch = content.match(/NOW\s*\(Core MVP\):\s*(\d+)/i);
    if (nowMatch) metrics["Core MVP Features (Now)"] = parseInt(nowMatch[1], 10);
  }

  return metrics;
}

/**
 * Compare two report snapshots and produce a comprehensive, structured comparison.
 */
export function compareSnapshots(
  baseReport: ReportSnapshot,
  compareReport: ReportSnapshot
): ReportComparisonResult {
  const baseSections = parseReportSections(baseReport.content);
  const compareSections = parseReportSections(compareReport.content);

  const baseManifest = parseProvenanceManifest(baseReport.provenance_manifest);
  const compareManifest = parseProvenanceManifest(compareReport.provenance_manifest);

  // 1. Verdict comparison
  const baseVerdictSec = baseSections.find((s) => s.id === "sec-verdict");
  const compareVerdictSec = compareSections.find((s) => s.id === "sec-verdict");

  const baseFullVerdict = baseVerdictSec?.content || "Not Recorded";
  const compareFullVerdict = compareVerdictSec?.content || "Not Recorded";

  const baseHeadline = extractVerdictHeadline(baseFullVerdict);
  const compareHeadline = extractVerdictHeadline(compareFullVerdict);

  const verdictChanged = baseHeadline !== compareHeadline || baseFullVerdict !== compareFullVerdict;

  // 2. Provenance Manifest deltas
  const manifestDeltas: ProvenanceDelta[] = ALL_PROVENANCE_KEYS.map((key) => {
    const bCount = Number(baseManifest[key]) || 0;
    const cCount = Number(compareManifest[key]) || 0;
    return {
      key,
      baseCount: bCount,
      compareCount: cCount,
      delta: cCount - bCount,
    };
  });

  const totalBaseItems = Object.values(baseManifest).reduce((acc, v) => acc + (Number(v) || 0), 0);
  const totalCompareItems = Object.values(compareManifest).reduce((acc, v) => acc + (Number(v) || 0), 0);
  const totalDelta = totalCompareItems - totalBaseItems;

  const containsSimulatedChanged =
    Boolean(baseReport.contains_simulated) !== Boolean(compareReport.contains_simulated);
  const containsSampleChanged =
    Boolean(baseReport.contains_sample) !== Boolean(compareReport.contains_sample);

  // 3. Section-by-Section comparison
  const allSectionIds = Array.from(
    new Set([...baseSections.map((s) => s.id), ...compareSections.map((s) => s.id)])
  );

  const baseSectionMap = new Map<string, ReportSection>(baseSections.map((s) => [s.id, s]));
  const compareSectionMap = new Map<string, ReportSection>(compareSections.map((s) => [s.id, s]));

  const sectionComparisons: SectionComparison[] = allSectionIds.map((secId) => {
    const bSec = baseSectionMap.get(secId);
    const cSec = compareSectionMap.get(secId);

    const title = cSec?.title || bSec?.title || secId;
    const baseProvenance = bSec?.provenance || null;
    const compareProvenance = cSec?.provenance || null;
    const baseCaveat = bSec?.caveat || null;
    const compareCaveat = cSec?.caveat || null;
    const baseContent = bSec?.content || "";
    const compareContent = cSec?.content || "";

    const provenanceChanged = baseProvenance !== compareProvenance;
    const caveatChanged = baseCaveat !== compareCaveat;
    const contentChanged = baseContent.trim() !== compareContent.trim();

    let status: "identical" | "modified" | "added" | "removed" = "identical";
    let summary = "Unchanged";

    if (!bSec && cSec) {
      status = "added";
      summary = `Section added in v${compareReport.version} [${compareProvenance}]`;
    } else if (bSec && !cSec) {
      status = "removed";
      summary = `Section removed from v${compareReport.version}`;
    } else if (contentChanged || provenanceChanged || caveatChanged) {
      status = "modified";
      const changes: string[] = [];
      if (provenanceChanged) changes.push(`Provenance: ${baseProvenance} → ${compareProvenance}`);
      if (contentChanged) changes.push("Content updated");
      if (caveatChanged) changes.push("Caveat updated");
      summary = changes.join("; ");
    }

    return {
      sectionId: secId,
      title,
      status,
      baseProvenance,
      compareProvenance,
      provenanceChanged,
      baseCaveat,
      compareCaveat,
      caveatChanged,
      contentChanged,
      baseContent,
      compareContent,
      summary,
    };
  });

  const modifiedSectionsCount = sectionComparisons.filter((s) => s.status !== "identical").length;

  // 4. Grounded Pipeline Metrics delta
  const allBaseMetrics: Record<string, number> = {};
  const allCompareMetrics: Record<string, number> = {};

  for (const bSec of baseSections) {
    Object.assign(allBaseMetrics, extractMetricsFromSection(bSec.id, bSec.content));
  }
  for (const cSec of compareSections) {
    Object.assign(allCompareMetrics, extractMetricsFromSection(cSec.id, cSec.content));
  }

  const metricKeys = Array.from(new Set([...Object.keys(allBaseMetrics), ...Object.keys(allCompareMetrics)]));
  const metrics: MetricComparison[] = metricKeys.map((key) => {
    const bVal = allBaseMetrics[key] ?? null;
    const cVal = allCompareMetrics[key] ?? null;
    const delta = bVal !== null && cVal !== null ? cVal - bVal : undefined;
    return {
      metric: key,
      baseValue: bVal,
      compareValue: cVal,
      delta,
    };
  });

  return {
    baseVersion: baseReport.version,
    compareVersion: compareReport.version,
    baseGeneratedAt: baseReport.generated_at,
    compareGeneratedAt: compareReport.generated_at,
    baseId: baseReport.id,
    compareId: compareReport.id,
    isNewer: compareReport.version > baseReport.version,
    verdict: {
      baseHeadline,
      compareHeadline,
      changed: verdictChanged,
      baseFull: baseFullVerdict,
      compareFull: compareFullVerdict,
    },
    provenance: {
      manifestDeltas,
      totalBaseItems,
      totalCompareItems,
      totalDelta,
      containsSimulatedChanged,
      containsSampleChanged,
    },
    metrics,
    sections: sectionComparisons,
    totalSections: allSectionIds.length,
    modifiedSectionsCount,
  };
}
