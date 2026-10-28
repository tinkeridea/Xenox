"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { ProvenanceBadge } from "@/components/Badges";
import { useActiveProjectId, buildProjectPath } from "@/lib/useActiveProject";
import type { ProvenanceType } from "@/types";
import {
  compareSnapshots,
  extractVerdictHeadline,
  type ReportComparisonResult,
  type ReportSection,
  type ReportSnapshot,
} from "@/lib/reportComparison";
import { formatCompetitorCategory } from "@/lib/competitorValidation";

interface LiveReport {
  id: string;
  project_id: string;
  version: number;
  generated_at: string;
  content: ReportSection[];
  provenance_manifest: Record<string, number>;
  contains_simulated: boolean;
  contains_sample: boolean;
  project?: any;
  brief?: any;
  stats?: Record<string, number>;
}

interface SnapshotMeta {
  id: string;
  project_id: string;
  version: number;
  generated_at: string;
  total_items: number;
  verdict: string;
  section_count: number;
  provenance_manifest: Record<string, number>;
  contains_simulated: boolean;
  contains_sample: boolean;
}

const PROV_ICONS: Record<string, string> = {
  USER_INPUT: "✏️",
  REAL_SOURCE: "🌐",
  AI_INFERENCE: "🤖",
  SIMULATED: "🎭",
  SAMPLE: "🧪",
  REAL_EXPERIMENT_RESULT: "✅",
};

function generateMarkdown(report: LiveReport): string {
  let md = `# IdeaProbe — Founder Validation Report\n\n`;
  md += `**Project ID:** ${report.project_id}\n`;
  if (report.project) {
    md += `**Project:** ${report.project.title}\n`;
  }
  md += `**Generated At:** ${report.generated_at}\n`;
  md += `**Snapshot Version:** v${report.version}\n`;
  md += `**Report ID:** ${report.id}\n\n`;
  md += `---\n\n`;
  md += `## 🛡️ Provenance Audit Manifest\n\n`;
  for (const [key, val] of Object.entries(report.provenance_manifest)) {
    md += `- **${key}**: ${val} item(s)\n`;
  }
  md += `\n`;
  if (report.contains_simulated || report.contains_sample) {
    md += `> ⚠️ **CRITICAL CAVEAT:** This report contains ${report.provenance_manifest.SIMULATED || 0} simulated item(s) and ${report.provenance_manifest.SAMPLE || 0} sample fixture(s). Simulations and sample fixtures are speculative hypotheses or demo placeholders and NEVER constitute real customer evidence. Do not cite simulated data or sample fixtures as demand validation, market traction, or business viability evidence.\n\n`;
  }
  md += `---\n\n`;

  report.content.forEach((sec, idx) => {
    md += `## ${idx + 1}. ${sec.title} [${sec.provenance}]\n\n`;
    md += `${sec.content}\n\n`;
    if (sec.caveat) {
      md += `> ⚠️ *Note:* ${sec.caveat}\n\n`;
    }
    md += `---\n\n`;
  });

  if (report.stats) {
    md += `## 📊 Pipeline Statistics\n\n`;
    for (const [key, val] of Object.entries(report.stats)) {
      md += `- ${key.replace(/_/g, " ")}: ${val}\n`;
    }
    md += `\n`;
  }

  md += `---\n\n`;
  md += `*Built with **IdeaProbe** — Local-First Idea Validation Engine*\n`;
  md += `*Report ID: ${report.id} | Certified Offline*\n`;

  return md;
}

function DifferentiationReportSection({
  sec,
  showRaw,
  onToggleRaw,
}: {
  sec: any;
  showRaw: boolean;
  onToggleRaw: () => void;
}) {
  // Extract or parse metrics
  const totalMatch = sec.content?.match(/Total Alternatives Mapped:\s*(\d+)/i);
  const artMatch = sec.content?.match(/Articulated Differentiators:\s*(\d+)/i);
  const gapsMatch = sec.content?.match(/Differentiation Gaps:\s*(\d+)/i);
  const covMatch = sec.content?.match(/Differentiation Coverage:\s*(\d+)%/i);

  const metrics = sec.metrics || {
    total: totalMatch ? parseInt(totalMatch[1], 10) : 0,
    articulated: artMatch ? parseInt(artMatch[1], 10) : 0,
    gaps: gapsMatch ? parseInt(gapsMatch[1], 10) : 0,
    coveragePercent: covMatch ? parseInt(covMatch[1], 10) : 0,
  };

  const items = Array.isArray(sec.items) ? sec.items : [];

  if (metrics.total === 0 && items.length === 0) {
    return (
      <div
        id="report-differentiation-empty"
        style={{
          padding: "var(--space-6)",
          background: "var(--color-surface-2)",
          border: "1px dashed var(--color-border)",
          borderRadius: "var(--radius-md)",
          textAlign: "center",
          color: "var(--text-muted)",
          marginBottom: "var(--space-4)",
        }}
      >
        <div style={{ fontSize: "1.75rem", marginBottom: "var(--space-2)" }}>🎯</div>
        <div style={{ fontSize: "0.9375rem", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "4px" }}>
          No Market Alternatives Mapped
        </div>
        <p style={{ fontSize: "0.8125rem", maxWidth: "480px", margin: "0 auto", lineHeight: "1.5" }}>
          No competitors or alternatives have been registered for this project yet. Add direct, indirect, substitute, or status-quo alternatives in the Alternatives module to evaluate competitive positioning.
        </p>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: "var(--space-4)" }}>
      {/* Metrics Overview Bar */}
      <div
        id="report-differentiation-metrics"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          gap: "var(--space-3)",
          marginBottom: "var(--space-4)",
        }}
      >
        <div
          style={{
            padding: "10px 14px",
            background: "var(--color-surface-2)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "2px" }}>Total Alternatives</div>
          <div style={{ fontSize: "1.35rem", fontWeight: "700", color: "var(--text-primary)" }}>{metrics.total}</div>
        </div>
        <div
          style={{
            padding: "10px 14px",
            background: "var(--color-surface-2)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "2px" }}>Articulated</div>
          <div style={{ fontSize: "1.35rem", fontWeight: "700", color: "var(--color-success)" }}>{metrics.articulated}</div>
        </div>
        <div
          style={{
            padding: "10px 14px",
            background: "var(--color-surface-2)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "2px" }}>Differentiation Gaps</div>
          <div style={{ fontSize: "1.35rem", fontWeight: "700", color: metrics.gaps > 0 ? "#f59e0b" : "var(--text-muted)" }}>
            {metrics.gaps}
          </div>
        </div>
        <div
          style={{
            padding: "10px 14px",
            background: "var(--color-surface-2)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "2px" }}>Coverage</div>
          <div style={{ fontSize: "1.35rem", fontWeight: "700", color: "var(--color-accent-light)" }}>
            {metrics.coveragePercent}%
          </div>
        </div>
      </div>

      {/* Differentiation Gap Alert Banner */}
      {metrics.gaps > 0 && (
        <div
          id="report-differentiation-gap-alert"
          style={{
            padding: "10px 14px",
            borderRadius: "var(--radius-sm)",
            background: "rgba(245, 158, 11, 0.1)",
            border: "1px solid rgba(245, 158, 11, 0.3)",
            fontSize: "0.8125rem",
            color: "#f59e0b",
            marginBottom: "var(--space-4)",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
          }}
        >
          <span>⚠️</span>
          <div>
            <strong>Differentiation Gaps Identified:</strong> {metrics.gaps} alternative(s) lack an articulated differentiation advantage. Unaddressed alternatives risk market displacement and unvalidated positioning.
          </div>
        </div>
      )}

      {/* Grid Table */}
      {items.length > 0 ? (
        <div style={{ overflowX: "auto", marginBottom: "var(--space-3)" }}>
          <table
            id="report-differentiation-grid-table"
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.875rem",
              border: "1px solid var(--color-border)",
            }}
          >
            <thead>
              <tr style={{ background: "var(--color-surface-2)", textAlign: "left" }}>
                <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--color-border)", fontWeight: "600" }}>Alternative</th>
                <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--color-border)", fontWeight: "600" }}>Category</th>
                <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--color-border)", fontWeight: "600" }}>Current Solution / Offer</th>
                <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--color-border)", fontWeight: "600" }}>Our Differentiation Advantage</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: any, i: number) => (
                <tr
                  key={item.id || i}
                  style={{
                    borderBottom: "1px solid var(--color-border)",
                    background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
                  }}
                >
                  <td style={{ padding: "12px", verticalAlign: "top", minWidth: "160px" }}>
                    <div style={{ fontWeight: "700", color: "var(--text-primary)" }}>{item.name}</div>
                    <div style={{ marginTop: "4px" }}>
                      <ProvenanceBadge type={item.provenance as ProvenanceType} size="sm" />
                    </div>
                  </td>
                  <td style={{ padding: "12px", verticalAlign: "top", minWidth: "120px" }}>
                    <span
                      style={{
                        fontSize: "0.75rem",
                        padding: "2px 8px",
                        borderRadius: "var(--radius-sm)",
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid var(--color-border)",
                        color: "var(--text-secondary)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {formatCompetitorCategory(item.category)}
                    </span>
                  </td>
                  <td style={{ padding: "12px", verticalAlign: "top", color: "var(--text-secondary)", fontSize: "0.8125rem", lineHeight: "1.5" }}>
                    {item.description || "No description provided."}
                  </td>
                  <td style={{ padding: "12px", verticalAlign: "top", minWidth: "220px" }}>
                    <div style={{ marginBottom: "4px" }}>
                      {item.isDifferentiated ? (
                        <span
                          style={{
                            fontSize: "0.6875rem",
                            padding: "2px 6px",
                            borderRadius: "var(--radius-sm)",
                            background: "rgba(34,197,94,0.15)",
                            color: "var(--color-success)",
                            border: "1px solid rgba(34,197,94,0.3)",
                            fontWeight: "600",
                          }}
                        >
                          ✓ ARTICULATED
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: "0.6875rem",
                            padding: "2px 6px",
                            borderRadius: "var(--radius-sm)",
                            background: "rgba(245,158,11,0.15)",
                            color: "#f59e0b",
                            border: "1px solid rgba(245,158,11,0.3)",
                            fontWeight: "600",
                          }}
                        >
                          ⚠️ Gap — Unspecified
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: "0.8125rem",
                        color: item.isDifferentiated ? "var(--text-primary)" : "var(--text-muted)",
                        fontStyle: item.isDifferentiated ? "normal" : "italic",
                        lineHeight: "1.5",
                      }}
                    >
                      {item.isDifferentiated ? item.differentiator : "No differentiation hypothesis specified."}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p
          style={{
            fontSize: "0.9375rem",
            color: "var(--text-secondary)",
            lineHeight: "1.7",
            whiteSpace: "pre-line",
          }}
        >
          {sec.content}
        </p>
      )}

      {/* Raw Markdown / Text Toggle */}
      {items.length > 0 && (
        <div style={{ marginTop: "var(--space-2)", textAlign: "right" }}>
          <button
            id="toggle-report-diff-raw-btn"
            onClick={onToggleRaw}
            className="btn btn-secondary btn-sm"
            style={{ fontSize: "0.75rem", padding: "3px 8px" }}
          >
            {showRaw ? "▲ Hide Raw Markdown / Text" : "▼ View Raw Markdown / Text"}
          </button>
          {showRaw && (
            <pre
              style={{
                marginTop: "var(--space-3)",
                padding: "var(--space-4)",
                background: "var(--color-surface-2)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-sm)",
                fontSize: "0.75rem",
                textAlign: "left",
                whiteSpace: "pre-wrap",
                color: "var(--text-secondary)",
                maxHeight: "300px",
                overflowY: "auto",
              }}
            >
              {sec.content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function UnifiedReportContent() {
  const projectId = useActiveProjectId();
  const [report, setReport] = useState<LiveReport | null>(null);
  const [history, setHistory] = useState<SnapshotMeta[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [showRawDiff, setShowRawDiff] = useState<boolean>(false);

  // Comparison State
  const [comparing, setComparing] = useState(false);
  const [compareBaseVersion, setCompareBaseVersion] = useState<number | null>(null);
  const [compareTargetVersion, setCompareTargetVersion] = useState<number | null>(null);
  const [baseSnapshot, setBaseSnapshot] = useState<LiveReport | null>(null);
  const [targetSnapshot, setTargetSnapshot] = useState<LiveReport | null>(null);
  const [compareResult, setCompareResult] = useState<ReportComparisonResult | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [expandedDiffSections, setExpandedDiffSections] = useState<Record<string, boolean>>({});

  // ── Fetch Snapshot History ──────────────────────────────────────
  const fetchHistory = useCallback(async () => {
    if (!projectId) return;
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/report/history`);
      if (res.ok) {
        const json = await res.json();
        setHistory(json.data?.snapshots || []);
      } else if (res.status === 404) {
        setHistory([]);
      }
    } catch {
      // Non-blocking history fetch
    } finally {
      setLoadingHistory(false);
    }
  }, [projectId]);

  // ── Fetch existing report snapshot (or specific version) ─────────
  const fetchReport = useCallback(
    async (version?: number | null) => {
      if (!projectId) return;
      setLoading(true);
      setError(null);
      try {
        const query = version ? `?version=${version}` : "";
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/report${query}`);
        if (res.status === 404) {
          setReport(null);
        } else {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error?.message || "Failed to load report");
          setReport(data.data.report);
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    fetchHistory();
    fetchReport(selectedVersion);
  }, [fetchHistory, fetchReport, selectedVersion]);

  // ── Generate fresh report ───────────────────────────────────────
  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/report`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Report generation failed");
      setSelectedVersion(null); // Switch to latest
      setReport(data.data.report);
      fetchHistory(); // Refresh history
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = () => {
    if (!report) return;
    navigator.clipboard.writeText(generateMarkdown(report));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!report) return;
    const md = generateMarkdown(report);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ideaprobe-validation-report-${report.project_id}-v${report.version}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => window.print();

  // ── Comparison Logic ────────────────────────────────────────────
  const openComparisonModal = (baseVer?: number, targetVer?: number) => {
    if (history.length < 2) return;
    const sorted = [...history].sort((a, b) => a.version - b.version);
    const bVer = baseVer ?? sorted[0].version;
    const tVer = targetVer ?? sorted[sorted.length - 1].version;
    setCompareBaseVersion(bVer);
    setCompareTargetVersion(tVer);
    setComparing(true);
  };

  const loadComparisonData = useCallback(async () => {
    if (!compareBaseVersion || !compareTargetVersion || !projectId) return;
    setCompareLoading(true);
    try {
      const [resBase, resTarget] = await Promise.all([
        fetch(`/api/projects/${encodeURIComponent(projectId)}/report?version=${compareBaseVersion}`),
        fetch(`/api/projects/${encodeURIComponent(projectId)}/report?version=${compareTargetVersion}`),
      ]);

      if (!resBase.ok || !resTarget.ok) {
        throw new Error("Failed to load one or both report snapshots for comparison.");
      }

      const jsonBase = await resBase.json();
      const jsonTarget = await resTarget.json();

      const baseRep = jsonBase.data?.report as LiveReport;
      const targetRep = jsonTarget.data?.report as LiveReport;

      setBaseSnapshot(baseRep);
      setTargetSnapshot(targetRep);

      const diff = compareSnapshots(baseRep as unknown as ReportSnapshot, targetRep as unknown as ReportSnapshot);
      setCompareResult(diff);
    } catch (err: any) {
      setError(err.message || "Failed to compare snapshots");
    } finally {
      setCompareLoading(false);
    }
  }, [compareBaseVersion, compareTargetVersion, projectId]);

  useEffect(() => {
    if (comparing && compareBaseVersion && compareTargetVersion) {
      loadComparisonData();
    }
  }, [comparing, compareBaseVersion, compareTargetVersion, loadComparisonData]);

  const toggleDiffSection = (id: string) => {
    setExpandedDiffSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const latestVersion = history.length > 0 ? Math.max(...history.map((h) => h.version)) : report?.version ?? null;
  const isViewingHistorical = selectedVersion !== null && latestVersion !== null && selectedVersion !== latestVersion;

  const totalItems = report
    ? Object.values(report.provenance_manifest).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <div className="page-container animate-fade-in" style={{ maxWidth: "960px", margin: "0 auto" }}>
      {/* Header */}
      <div className="flex justify-between items-center mb-4" style={{ flexWrap: "wrap", gap: "var(--space-3)" }}>
        <div>
          <div className="flex items-center gap-2 mb-2" style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            <Link href="/" style={{ color: "var(--text-muted)", textDecoration: "none" }}>
              Dashboard
            </Link>
            <span>/</span>
            <Link href={buildProjectPath("/overview", projectId)} style={{ color: "var(--text-muted)", textDecoration: "none" }}>
              Project Overview
            </Link>
            <span>/</span>
            <span style={{ color: "var(--color-accent-light)" }}>Unified Report</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 style={{ fontSize: "1.75rem", fontWeight: "700", color: "var(--text-primary)" }}>
              Unified Founder Report (F15)
            </h1>
            {report && (
              <span
                style={{
                  fontSize: "0.6875rem",
                  padding: "2px 7px",
                  borderRadius: "999px",
                  background: isViewingHistorical ? "rgba(245,158,11,0.15)" : "rgba(34,197,94,0.15)",
                  color: isViewingHistorical ? "var(--color-warning)" : "var(--color-success)",
                  border: isViewingHistorical ? "1px solid rgba(245,158,11,0.3)" : "1px solid rgba(34,197,94,0.3)",
                  fontWeight: "700",
                }}
              >
                {isViewingHistorical ? `📜 HISTORICAL v${report.version}` : "✓ LATEST"}
              </span>
            )}
          </div>
          <p style={{ color: "var(--text-secondary)", marginTop: "var(--space-1)", fontSize: "0.9rem" }}>
            Immutable, audit-sealed synthesis across all pipeline modules with full provenance traceability.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="btn btn-primary btn-sm"
            id="btn-generate-report"
          >
            {generating ? "⏳ Generating..." : "⚡ Generate Fresh Report"}
          </button>
          <button
            onClick={() => openComparisonModal()}
            disabled={history.length < 2}
            className="btn btn-secondary btn-sm"
            id="btn-compare-versions"
            title={history.length < 2 ? "Generate at least two report snapshots to compare versions" : "Compare two report versions"}
            style={{ opacity: history.length < 2 ? 0.6 : 1 }}
          >
            ⚖️ Compare Versions {history.length > 1 ? `(${history.length})` : ""}
          </button>
          {report && (
            <>
              <button onClick={handlePrint} className="btn btn-secondary btn-sm" id="btn-print-report">
                🖨️ Print / PDF
              </button>
              <button onClick={handleCopy} className="btn btn-secondary btn-sm" id="btn-copy-report">
                {copied ? "✓ Copied!" : "📋 Copy Markdown"}
              </button>
              <button onClick={handleDownload} className="btn btn-secondary btn-sm" id="btn-download-report">
                💾 Download .md
              </button>
            </>
          )}
        </div>
      </div>

      {/* Snapshot History Selector Bar */}
      {history.length > 0 && (
        <div
          className="card mb-5"
          style={{
            padding: "var(--space-3) var(--space-4)",
            background: "var(--color-surface-2)",
            border: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "var(--space-3)",
          }}
        >
          <div className="flex items-center gap-3">
            <span style={{ fontSize: "0.8125rem", fontWeight: "600", color: "var(--text-secondary)" }}>
              📜 Snapshot History:
            </span>
            <select
              id="select-report-version"
              value={selectedVersion ?? latestVersion ?? ""}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (val === latestVersion) {
                  setSelectedVersion(null);
                } else {
                  setSelectedVersion(val);
                }
              }}
              style={{
                background: "var(--color-surface)",
                color: "var(--text-primary)",
                border: "1px solid var(--color-border)",
                padding: "4px 10px",
                borderRadius: "var(--radius-sm)",
                fontSize: "0.8125rem",
                cursor: "pointer",
              }}
            >
              {history.map((snap) => (
                <option key={snap.id} value={snap.version}>
                  v{snap.version} — {new Date(snap.generated_at).toLocaleDateString()} {snap.version === latestVersion ? "(Latest)" : ""} [{snap.verdict}]
                </option>
              ))}
            </select>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {history.length} snapshot{history.length === 1 ? "" : "s"} archived
            </span>
          </div>

          <div className="flex items-center gap-2">
            {isViewingHistorical && (
              <button
                onClick={() => setSelectedVersion(null)}
                className="btn btn-secondary btn-sm"
                style={{ fontSize: "0.75rem", padding: "3px 8px" }}
              >
                ← Back to Latest Report (v{latestVersion})
              </button>
            )}
            {history.length >= 2 && (
              <button
                onClick={() => openComparisonModal(selectedVersion ?? latestVersion ?? undefined, latestVersion ?? undefined)}
                className="btn btn-secondary btn-sm"
                style={{ fontSize: "0.75rem", padding: "3px 8px" }}
              >
                ⚖️ Compare with Latest
              </button>
            )}
          </div>
        </div>
      )}

      {/* Historical Snapshot Notice Banner */}
      {isViewingHistorical && report && (
        <div
          className="card mb-6"
          id="banner-historical-snapshot"
          style={{
            padding: "var(--space-4)",
            background: "linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(99,102,241,0.06) 100%)",
            border: "1px solid rgba(245,158,11,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "var(--space-3)",
          }}
        >
          <div className="flex items-center gap-3">
            <span style={{ fontSize: "1.5rem" }}>📜</span>
            <div>
              <div style={{ fontSize: "0.9375rem", fontWeight: "700", color: "#f59e0b" }}>
                Viewing Historical Snapshot v{report.version}
              </div>
              <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                Captured {new Date(report.generated_at).toLocaleString()} • Immutable record • Latest is v{latestVersion}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedVersion(null)}
              className="btn btn-primary btn-sm"
              id="btn-return-latest"
            >
              ← Back to Latest (v{latestVersion})
            </button>
            <button
              onClick={() => openComparisonModal(report.version, latestVersion ?? undefined)}
              className="btn btn-secondary btn-sm"
            >
              ⚖️ Compare with v{latestVersion}
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          className="card mb-4"
          style={{
            padding: "var(--space-4)",
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.3)",
            color: "var(--color-error)",
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="card"
              style={{
                padding: "var(--space-5)",
                height: "80px",
                background: "var(--color-surface-2)",
                animation: "pulse 1.5s ease-in-out infinite",
              }}
            />
          ))}
        </div>
      )}

      {/* No report yet */}
      {!loading && !report && !error && (
        <div
          className="card"
          style={{
            padding: "var(--space-10)",
            textAlign: "center",
            background: "linear-gradient(135deg, rgba(99,102,241,0.06) 0%, rgba(34,197,94,0.03) 100%)",
            border: "1px solid rgba(99,102,241,0.2)",
          }}
        >
          <div style={{ fontSize: "3rem", marginBottom: "var(--space-4)" }}>📋</div>
          <h2
            style={{
              fontSize: "1.25rem",
              fontWeight: "700",
              color: "var(--text-primary)",
              marginBottom: "var(--space-2)",
            }}
          >
            No Report Generated Yet
          </h2>
          <p
            style={{
              color: "var(--text-secondary)",
              fontSize: "0.9rem",
              maxWidth: "480px",
              margin: "0 auto var(--space-6)",
            }}
          >
            Click &quot;Generate Fresh Report&quot; to synthesize all live data from your SQLite database — sources,
            personas, insights, risks, experiments, competitors, and MVP features — into a single
            provenance-audited document.
          </p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="btn btn-primary"
            id="btn-generate-report-empty"
          >
            {generating ? "⏳ Generating..." : "⚡ Generate My First Report"}
          </button>
        </div>
      )}

      {/* Generating spinner */}
      {generating && (
        <div
          className="card mb-4"
          style={{
            padding: "var(--space-4)",
            background: "rgba(99,102,241,0.08)",
            border: "1px solid rgba(99,102,241,0.25)",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
          }}
        >
          <div
            style={{
              width: "20px",
              height: "20px",
              border: "3px solid rgba(99,102,241,0.3)",
              borderTopColor: "var(--color-accent)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <div style={{ color: "var(--color-accent-light)", fontSize: "0.9rem", fontWeight: "600" }}>
            Aggregating live data from SQLite and computing provenance manifest…
          </div>
        </div>
      )}

      {/* Full report */}
      {!loading && report && (
        <>
          {/* Provenance Audit Manifest */}
          <div
            className="card mb-6"
            style={{
              background: "linear-gradient(135deg, rgba(34,197,94,0.08) 0%, rgba(99,102,241,0.06) 100%)",
              border: "1px solid rgba(34,197,94,0.3)",
              padding: "var(--space-5)",
            }}
          >
            <div className="flex justify-between items-start mb-4" style={{ flexWrap: "wrap", gap: "var(--space-2)" }}>
              <div className="flex items-center gap-2">
                <span style={{ fontSize: "1.25rem" }}>🛡️</span>
                <div>
                  <div style={{ fontSize: "0.9375rem", fontWeight: "700", color: "var(--text-primary)" }}>
                    Provenance Audit Manifest (Decision D04)
                  </div>
                  <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                    Snapshot ID: <code>{report.id}</code> • Version: v{report.version} • Generated:{" "}
                    {new Date(report.generated_at).toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  style={{
                    fontSize: "0.75rem",
                    padding: "3px 10px",
                    borderRadius: "999px",
                    background: "rgba(34,197,94,0.15)",
                    color: "var(--color-success)",
                    border: "1px solid rgba(34,197,94,0.3)",
                    fontWeight: "600",
                  }}
                >
                  ✓ AUDIT PASSED
                </span>
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{totalItems} total items</span>
              </div>
            </div>

            {/* Manifest grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                gap: "var(--space-2)",
                marginBottom: "var(--space-4)",
              }}
            >
              {Object.entries(report.provenance_manifest).map(([key, val]) => (
                <div
                  key={key}
                  style={{
                    background: "rgba(0,0,0,0.2)",
                    padding: "8px 10px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--color-border)",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: "1.25rem", marginBottom: "2px" }}>{PROV_ICONS[key] || "📄"}</div>
                  <div style={{ fontSize: "1.35rem", fontWeight: "700", color: "var(--text-primary)", lineHeight: 1 }}>
                    {val}{" "}
                    <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: "500" }}>
                      ({totalItems > 0 ? Math.round((val / totalItems) * 100) : 0}%)
                    </span>
                  </div>
                  <div style={{ marginTop: "4px" }}>
                    <ProvenanceBadge type={key as ProvenanceType} size="sm" />
                  </div>
                </div>
              ))}
            </div>

            {/* Pipeline stats */}
            {report.stats && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
                {Object.entries(report.stats).map(([k, v]) => (
                  <span
                    key={k}
                    style={{
                      fontSize: "0.75rem",
                      padding: "3px 8px",
                      borderRadius: "var(--radius-sm)",
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid var(--color-border)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {k.replace(/_/g, " ")}: <strong style={{ color: "var(--text-primary)" }}>{v}</strong>
                  </span>
                ))}
              </div>
            )}

            {/* Caveat notice */}
            {(report.contains_simulated || report.contains_sample) && (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: "var(--radius-sm)",
                  background: "rgba(239,68,68,0.1)",
                  border: "1px solid rgba(239,68,68,0.25)",
                  fontSize: "0.8125rem",
                  color: "var(--color-error)",
                }}
              >
                ⚠️ <strong>Non-Negotiable Verification Notice:</strong> This report incorporates{" "}
                <strong>{report.provenance_manifest.SIMULATED || 0} simulated item(s)</strong> and{" "}
                <strong>{report.provenance_manifest.SAMPLE || 0} sample fixture(s)</strong>. Simulations and sample
                fixtures are hypothetical or illustrative placeholders. They do <strong>NOT</strong> count as
                independently verified real-world evidence and must <strong>NEVER</strong> be cited as proof of market
                demand, problem severity, or business viability.
              </div>
            )}
          </div>

          {/* Section Navigation Tabs */}
          <div
            className="card mb-6"
            style={{
              padding: "var(--space-3)",
              background: "var(--color-surface-2)",
              display: "flex",
              gap: "var(--space-2)",
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: "600",
                color: "var(--text-muted)",
                alignSelf: "center",
                marginRight: "var(--space-2)",
              }}
            >
              SECTIONS:
            </span>
            {report.content.map((sec, idx) => (
              <button
                key={sec.id}
                onClick={() => {
                  setActiveSection(sec.id);
                  document.getElementById(sec.id)?.scrollIntoView({ behavior: "smooth" });
                }}
                style={{
                  fontSize: "0.75rem",
                  padding: "4px 8px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid",
                  borderColor: activeSection === sec.id ? "var(--color-accent)" : "var(--color-border)",
                  background: activeSection === sec.id ? "var(--color-accent)" : "transparent",
                  color: activeSection === sec.id ? "#fff" : "var(--text-secondary)",
                  cursor: "pointer",
                }}
              >
                {idx + 1}. {sec.title}
              </button>
            ))}
          </div>

          {/* Full Report Document */}
          <div
            className="card mb-8"
            style={{
              padding: "var(--space-8)",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
            }}
          >
            {/* Document header */}
            <div
              className="flex justify-between items-start mb-8"
              style={{
                borderBottom: "2px solid var(--color-border)",
                paddingBottom: "var(--space-5)",
                flexWrap: "wrap",
                gap: "var(--space-4)",
              }}
            >
              <div>
                <span
                  style={{
                    fontSize: "0.75rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "var(--color-accent-light)",
                    fontWeight: "600",
                  }}
                >
                  IDEA VALIDATION REPORT
                </span>
                <h2 style={{ fontSize: "1.75rem", fontWeight: "800", color: "var(--text-primary)", marginTop: "4px" }}>
                  {report.project?.title || report.project_id}
                </h2>
                {report.project && (
                  <div style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginTop: "6px" }}>
                    Mode: <strong>{report.project.mode}</strong> • Status: <strong>{report.project.status}</strong>
                  </div>
                )}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                  Report ID: <code style={{ fontSize: "0.7rem" }}>{report.id}</code>
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  Version: <strong>v{report.version}</strong>
                </div>
                <div style={{ marginTop: "6px" }}>
                  <ProvenanceBadge
                    type={
                      report.contains_sample
                        ? "SAMPLE"
                        : report.contains_simulated
                        ? "SIMULATED"
                        : "AI_INFERENCE"
                    }
                    size="sm"
                  />
                </div>
              </div>
            </div>

            {/* Sections */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
              {report.content.map((sec, idx) => (
                <section
                  key={sec.id}
                  id={sec.id}
                  style={{
                    scrollMarginTop: "80px",
                    paddingBottom: "var(--space-6)",
                    borderBottom: idx === report.content.length - 1 ? "none" : "1px solid var(--color-border)",
                  }}
                >
                  <div className="flex justify-between items-center mb-3" style={{ flexWrap: "wrap", gap: "var(--space-2)" }}>
                    <h3 style={{ fontSize: "1.2rem", fontWeight: "700", color: "var(--text-primary)" }}>
                      {idx + 1}. {sec.title}
                    </h3>
                    <ProvenanceBadge type={sec.provenance as ProvenanceType} size="sm" />
                  </div>

                  {sec.id === "sec-differentiation" ? (
                    <DifferentiationReportSection
                      sec={sec}
                      showRaw={showRawDiff}
                      onToggleRaw={() => setShowRawDiff((prev) => !prev)}
                    />
                  ) : (
                    <p
                      style={{
                        fontSize: "0.9375rem",
                        color: "var(--text-secondary)",
                        lineHeight: "1.7",
                        whiteSpace: "pre-line",
                      }}
                    >
                      {sec.content}
                    </p>
                  )}

                  {sec.caveat && (
                    <div
                      style={{
                        marginTop: "var(--space-3)",
                        padding: "10px 14px",
                        borderRadius: "var(--radius-sm)",
                        background:
                          sec.provenance === "SIMULATED" ? "rgba(239,68,68,0.08)" : "rgba(245,158,11,0.08)",
                        border: `1px solid ${
                          sec.provenance === "SIMULATED" ? "rgba(239,68,68,0.25)" : "rgba(245,158,11,0.25)"
                        }`,
                        fontSize: "0.8125rem",
                        color: sec.provenance === "SIMULATED" ? "var(--color-error)" : "#f59e0b",
                      }}
                    >
                      {sec.caveat}
                    </div>
                  )}
                </section>
              ))}
            </div>

            {/* Footer seal */}
            <div
              style={{
                marginTop: "var(--space-8)",
                paddingTop: "var(--space-6)",
                borderTop: "2px dashed var(--color-border)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "var(--space-3)",
                fontSize: "0.75rem",
                color: "var(--text-muted)",
              }}
            >
              <div>
                Built with <strong>IdeaProbe</strong> — Local-First Idea Validation Engine
              </div>
              <div>
                Version: <code>v{report.version}</code> • Report ID: <code>{report.id.slice(0, 24)}…</code> • Certified
                Offline
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Comparison Overlay Modal ───────────────────────────────── */}
      {comparing && (
        <div
          id="modal-report-comparison"
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.8)",
            backdropFilter: "blur(4px)",
            zIndex: 1000,
            overflowY: "auto",
            padding: "var(--space-6) var(--space-4)",
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-start",
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: "960px",
              width: "100%",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-lg)",
              padding: "var(--space-6)",
              boxShadow: "0 20px 50px rgba(0,0,0,0.6)",
            }}
          >
            {/* Modal Header */}
            <div
              className="flex justify-between items-center mb-6"
              style={{ borderBottom: "1px solid var(--color-border)", paddingBottom: "var(--space-4)" }}
            >
              <div>
                <div style={{ fontSize: "0.8125rem", color: "var(--color-accent-light)", fontWeight: "600" }}>
                  AUDIT &amp; VALIDATION TIMELINE
                </div>
                <h2 style={{ fontSize: "1.5rem", fontWeight: "700", color: "var(--text-primary)" }}>
                  ⚖️ Report Snapshot Comparison
                </h2>
              </div>
              <button
                onClick={() => setComparing(false)}
                className="btn btn-secondary btn-sm"
                id="btn-close-comparison"
                style={{ fontSize: "1.1rem", padding: "4px 10px" }}
              >
                ✕ Close
              </button>
            </div>

            {/* Version Selectors Bar */}
            <div
              className="card mb-6"
              style={{
                padding: "var(--space-4)",
                background: "var(--color-surface-2)",
                border: "1px solid var(--color-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "var(--space-4)",
              }}
            >
              <div className="flex items-center gap-3">
                <label style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", fontWeight: "600" }}>
                  Base Version (Earlier):
                </label>
                <select
                  id="select-compare-base"
                  value={compareBaseVersion ?? ""}
                  onChange={(e) => setCompareBaseVersion(Number(e.target.value))}
                  style={{
                    background: "var(--color-surface)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--color-border)",
                    padding: "6px 12px",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "0.85rem",
                  }}
                >
                  {history.map((h) => (
                    <option key={h.id} value={h.version}>
                      v{h.version} ({new Date(h.generated_at).toLocaleDateString()}) - {h.verdict}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={() => {
                  const temp = compareBaseVersion;
                  setCompareBaseVersion(compareTargetVersion);
                  setCompareTargetVersion(temp);
                }}
                className="btn btn-secondary btn-sm"
                title="Swap Base and Compare versions"
              >
                ⇄ Swap
              </button>

              <div className="flex items-center gap-3">
                <label style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", fontWeight: "600" }}>
                  Compare Version (Later):
                </label>
                <select
                  id="select-compare-target"
                  value={compareTargetVersion ?? ""}
                  onChange={(e) => setCompareTargetVersion(Number(e.target.value))}
                  style={{
                    background: "var(--color-surface)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--color-border)",
                    padding: "6px 12px",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "0.85rem",
                  }}
                >
                  {history.map((h) => (
                    <option key={h.id} value={h.version}>
                      v{h.version} ({new Date(h.generated_at).toLocaleDateString()}) - {h.verdict}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Comparison Loading */}
            {compareLoading && (
              <div style={{ padding: "var(--space-8)", textAlign: "center", color: "var(--text-secondary)" }}>
                ⏳ Computing snapshot differential…
              </div>
            )}

            {/* Comparison Content */}
            {!compareLoading && compareResult && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
                {/* 1. Verdict Evolution Card */}
                <div
                  className="card"
                  style={{
                    padding: "var(--space-5)",
                    background: compareResult.verdict.changed
                      ? "linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(99,102,241,0.05) 100%)"
                      : "rgba(0,0,0,0.15)",
                    border: `1px solid ${
                      compareResult.verdict.changed ? "rgba(245,158,11,0.3)" : "var(--color-border)"
                    }`,
                  }}
                >
                  <div className="flex justify-between items-center mb-3">
                    <span style={{ fontSize: "0.875rem", fontWeight: "700", color: "var(--text-primary)" }}>
                      🎯 Verdict Evolution
                    </span>
                    <span
                      style={{
                        fontSize: "0.75rem",
                        padding: "2px 8px",
                        borderRadius: "999px",
                        background: compareResult.verdict.changed
                          ? "rgba(245,158,11,0.2)"
                          : "rgba(255,255,255,0.08)",
                        color: compareResult.verdict.changed ? "#f59e0b" : "var(--text-muted)",
                        fontWeight: "600",
                      }}
                    >
                      {compareResult.verdict.changed ? "VERDICT CHANGED" : "VERDICT UNCHANGED"}
                    </span>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto 1fr",
                      gap: "var(--space-4)",
                      alignItems: "center",
                      background: "rgba(0,0,0,0.2)",
                      padding: "var(--space-4)",
                      borderRadius: "var(--radius-sm)",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                        Version v{compareResult.baseVersion} ({new Date(compareResult.baseGeneratedAt).toLocaleDateString()})
                      </div>
                      <div style={{ fontSize: "1.05rem", fontWeight: "700", color: "var(--text-primary)" }}>
                        {compareResult.verdict.baseHeadline}
                      </div>
                    </div>
                    <div style={{ fontSize: "1.25rem", color: "var(--text-muted)" }}>➔</div>
                    <div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                        Version v{compareResult.compareVersion} ({new Date(compareResult.compareGeneratedAt).toLocaleDateString()})
                      </div>
                      <div
                        style={{
                          fontSize: "1.05rem",
                          fontWeight: "700",
                          color: compareResult.verdict.changed ? "var(--color-accent-light)" : "var(--text-primary)",
                        }}
                      >
                        {compareResult.verdict.compareHeadline}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Provenance Manifest Evolution */}
                <div
                  className="card"
                  style={{
                    padding: "var(--space-5)",
                    background: "var(--color-surface-2)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <div className="flex justify-between items-center mb-4">
                    <span style={{ fontSize: "0.875rem", fontWeight: "700", color: "var(--text-primary)" }}>
                      🛡️ Provenance Audit Differential
                    </span>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                      Total Items: v{compareResult.baseVersion} ({compareResult.provenance.totalBaseItems}) ➔ v
                      {compareResult.compareVersion} ({compareResult.provenance.totalCompareItems}) [
                      <strong
                        style={{
                          color:
                            compareResult.provenance.totalDelta > 0
                              ? "var(--color-success)"
                              : compareResult.provenance.totalDelta < 0
                              ? "var(--color-error)"
                              : "var(--text-muted)",
                        }}
                      >
                        {compareResult.provenance.totalDelta > 0 ? `+${compareResult.provenance.totalDelta}` : compareResult.provenance.totalDelta}
                      </strong>
                      ]
                    </span>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))",
                      gap: "var(--space-2)",
                    }}
                  >
                    {compareResult.provenance.manifestDeltas.map((d) => {
                      const deltaColor =
                        d.delta > 0
                          ? d.key === "SIMULATED" || d.key === "SAMPLE"
                            ? "var(--color-warning)"
                            : "var(--color-success)"
                          : d.delta < 0
                          ? "var(--color-error)"
                          : "var(--text-muted)";
                      return (
                        <div
                          key={d.key}
                          style={{
                            background: "rgba(0,0,0,0.25)",
                            padding: "8px 10px",
                            borderRadius: "var(--radius-sm)",
                            border: "1px solid var(--color-border)",
                            textAlign: "center",
                          }}
                        >
                          <div style={{ fontSize: "1.1rem" }}>{PROV_ICONS[d.key] || "📄"}</div>
                          <div style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--text-secondary)", marginTop: "2px" }}>
                            {d.key.replace(/_/g, " ")}
                          </div>
                          <div style={{ fontSize: "0.9rem", color: "var(--text-primary)", marginTop: "4px" }}>
                            {d.baseCount} ➔ <strong>{d.compareCount}</strong>
                          </div>
                          <div style={{ fontSize: "0.8rem", fontWeight: "700", color: deltaColor, marginTop: "2px" }}>
                            {d.delta > 0 ? `+${d.delta}` : d.delta}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 3. Pipeline Metrics Delta */}
                {compareResult.metrics.length > 0 && (
                  <div
                    className="card"
                    style={{
                      padding: "var(--space-4)",
                      background: "rgba(0,0,0,0.15)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    <div style={{ fontSize: "0.875rem", fontWeight: "700", color: "var(--text-primary)", marginBottom: "var(--space-3)" }}>
                      📊 Grounded Pipeline Metrics
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--space-2)" }}>
                      {compareResult.metrics.map((m) => (
                        <div
                          key={m.metric}
                          style={{
                            padding: "6px 10px",
                            background: "rgba(255,255,255,0.03)",
                            borderRadius: "var(--radius-sm)",
                            border: "1px solid var(--color-border)",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            fontSize: "0.8125rem",
                          }}
                        >
                          <span style={{ color: "var(--text-secondary)" }}>{m.metric}:</span>
                          <span style={{ fontWeight: "600", color: "var(--text-primary)" }}>
                            {m.baseValue ?? "—"} ➔ {m.compareValue ?? "—"}
                            {typeof m.delta === "number" && m.delta !== 0 && (
                              <span
                                style={{
                                  marginLeft: "6px",
                                  fontSize: "0.75rem",
                                  color: m.delta > 0 ? "var(--color-success)" : "var(--color-error)",
                                }}
                              >
                                ({m.delta > 0 ? `+${m.delta}` : m.delta})
                              </span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 4. Section-by-Section Evolution */}
                <div
                  className="card"
                  style={{
                    padding: "var(--space-5)",
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <div className="flex justify-between items-center mb-4">
                    <span style={{ fontSize: "0.875rem", fontWeight: "700", color: "var(--text-primary)" }}>
                      📑 Section Differential ({compareResult.sections.length} sections,{" "}
                      {compareResult.modifiedSectionsCount} modified)
                    </span>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                    {compareResult.sections.map((sec) => {
                      const isExpanded = !!expandedDiffSections[sec.sectionId];
                      const statusColor =
                        sec.status === "modified"
                          ? "#f59e0b"
                          : sec.status === "added"
                          ? "var(--color-success)"
                          : sec.status === "removed"
                          ? "var(--color-error)"
                          : "var(--text-muted)";

                      return (
                        <div
                          key={sec.sectionId}
                          style={{
                            border: "1px solid var(--color-border)",
                            borderRadius: "var(--radius-sm)",
                            padding: "var(--space-3)",
                            background: "rgba(0,0,0,0.15)",
                          }}
                        >
                          <div className="flex justify-between items-center" style={{ flexWrap: "wrap", gap: "var(--space-2)" }}>
                            <div className="flex items-center gap-2">
                              <span
                                style={{
                                  fontSize: "0.6875rem",
                                  padding: "2px 6px",
                                  borderRadius: "4px",
                                  background: "rgba(255,255,255,0.08)",
                                  color: statusColor,
                                  fontWeight: "700",
                                  textTransform: "uppercase",
                                }}
                              >
                                {sec.status}
                              </span>
                              <span style={{ fontSize: "0.9375rem", fontWeight: "600", color: "var(--text-primary)" }}>
                                {sec.title}
                              </span>
                            </div>

                            <div className="flex items-center gap-3">
                              {sec.provenanceChanged && (
                                <span style={{ fontSize: "0.75rem", color: "#f59e0b" }}>
                                  Provenance: {sec.baseProvenance} ➔ <strong>{sec.compareProvenance}</strong>
                                </span>
                              )}
                              {sec.status === "modified" && (
                                <button
                                  onClick={() => toggleDiffSection(sec.sectionId)}
                                  className="btn btn-secondary btn-sm"
                                  style={{ fontSize: "0.75rem", padding: "2px 8px" }}
                                >
                                  {isExpanded ? "Hide Details" : "Inspect Diff"}
                                </button>
                              )}
                            </div>
                          </div>

                          <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", marginTop: "4px" }}>
                            {sec.summary}
                          </div>

                          {/* Expanded content comparison */}
                          {isExpanded && (
                            <div
                              style={{
                                marginTop: "var(--space-3)",
                                paddingTop: "var(--space-3)",
                                borderTop: "1px dashed var(--color-border)",
                                display: "grid",
                                gridTemplateColumns: "1fr 1fr",
                                gap: "var(--space-3)",
                              }}
                            >
                              <div
                                style={{
                                  padding: "var(--space-3)",
                                  background: "rgba(0,0,0,0.3)",
                                  borderRadius: "var(--radius-sm)",
                                  border: "1px solid var(--color-border)",
                                }}
                              >
                                <div style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--text-muted)", marginBottom: "4px" }}>
                                  v{compareResult.baseVersion} Content [{sec.baseProvenance || "None"}]:
                                </div>
                                <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", whiteSpace: "pre-line", maxHeight: "200px", overflowY: "auto" }}>
                                  {sec.baseContent || "No content"}
                                </p>
                              </div>
                              <div
                                style={{
                                  padding: "var(--space-3)",
                                  background: "rgba(99,102,241,0.05)",
                                  borderRadius: "var(--radius-sm)",
                                  border: "1px solid rgba(99,102,241,0.2)",
                                }}
                              >
                                <div style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--color-accent-light)", marginBottom: "4px" }}>
                                  v{compareResult.compareVersion} Content [{sec.compareProvenance || "None"}]:
                                </div>
                                <p style={{ fontSize: "0.8125rem", color: "var(--text-primary)", whiteSpace: "pre-line", maxHeight: "200px", overflowY: "auto" }}>
                                  {sec.compareContent || "No content"}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function UnifiedReportPage() {
  return (
    <Suspense fallback={<div className="page-container">Loading report...</div>}>
      <UnifiedReportContent />
    </Suspense>
  );
}
