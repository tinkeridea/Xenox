"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { ProvenanceBadge, FixtureBadge } from "@/components/Badges";
import { useActiveProjectId, useActiveProjectMode, buildProjectPath } from "@/lib/useActiveProject";
import type { ProvenanceType } from "@/types";
import { normalizeInsightStatement } from "@/lib/insightValidation";

interface InsightRow {
  id: string;
  project_id: string;
  statement: string;
  type: "theme" | "contradiction" | "open_question";
  confidence: "High" | "Medium" | "Low" | "high" | "medium" | "low";
  evidence_for_ids: string[];
  evidence_against_ids?: string[];
  caveat?: string;
  provenance: ProvenanceType;
  created_at: string;
}

interface EvidenceMapItem {
  id: string;
  claim: string;
  provenance: ProvenanceType;
  reviewer_status?: string;
}

const TYPE_CONFIG = {
  theme: {
    icon: "💡",
    label: "Theme / Pattern",
    color: "rgba(99,102,241,0.15)",
    border: "rgba(99,102,241,0.35)",
  },
  contradiction: {
    icon: "⚡",
    label: "Contradiction / Counter-signal",
    color: "rgba(239,68,68,0.1)",
    border: "rgba(239,68,68,0.35)",
  },
  open_question: {
    icon: "❓",
    label: "Open Question",
    color: "rgba(245,158,11,0.1)",
    border: "rgba(245,158,11,0.35)",
  },
};

const CONFIDENCE_COLOR: Record<string, string> = {
  High: "var(--color-success)",
  high: "var(--color-success)",
  Medium: "#f59e0b",
  medium: "#f59e0b",
  Low: "var(--color-error)",
  low: "var(--color-error)",
};

function InsightsContent() {
  const projectId = useActiveProjectId();
  const projectMode = useActiveProjectMode(projectId);
  const [insights, setInsights] = useState<InsightRow[]>([]);
  const [evidenceMap, setEvidenceMap] = useState<Record<string, EvidenceMapItem>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("All");

  // Synthesis state
  const [synthesizing, setSynthesizing] = useState(false);
  const [showSynthesizeModal, setShowSynthesizeModal] = useState(false);
  const [selectedType, setSelectedType] = useState<"theme" | "contradiction" | "open_question">("theme");
  const [notification, setNotification] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const notify = (msg: string, type: "success" | "error" = "success") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 5000);
  };

  // Load insights & evidence from SQLite
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [insightsRes, evRes] = await Promise.all([
        fetch(`/api/projects/${encodeURIComponent(projectId)}/insights`),
        fetch(`/api/projects/${encodeURIComponent(projectId)}/evidence`),
      ]);

      if (insightsRes.ok) {
        const iJson = await insightsRes.json();
        setInsights(iJson.data?.insights || []);
      }

      if (evRes.ok) {
        const eJson = await evRes.json();
        const map: Record<string, EvidenceMapItem> = {};
        for (const item of eJson.data?.evidence || []) {
          map[item.id] = {
            id: item.id,
            claim: item.claim,
            provenance: item.provenance,
            reviewer_status: item.reviewer_status,
          };
        }
        setEvidenceMap(map);
      }
    } catch (err) {
      console.error("Failed to load insights from SQLite:", err);
      notify("Failed to load insights from database", "error");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Trigger Ollama synthesis
  const handleSynthesize = async () => {
    setSynthesizing(true);
    setShowSynthesizeModal(false);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/insights/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ insightType: selectedType }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        const errMsg = errJson?.error?.message || `Inference endpoint returned HTTP ${res.status}`;
        throw new Error(errMsg);
      }

      const json = await res.json();
      const newInsight = json.data?.insight;
      const inferenceMeta = json.data?.inference;

      if (newInsight) {
        setInsights((prev) => {
          const normNew = normalizeInsightStatement(newInsight.statement);
          const filtered = prev.filter(
            (item) => item.id !== newInsight.id && normalizeInsightStatement(item.statement) !== normNew
          );
          return [newInsight, ...filtered];
        });
        if (inferenceMeta?.provenance === "AI_INFERENCE") {
          notify(`✨ Synthesized new ${newInsight.type} via Ollama (${inferenceMeta.latencyMs}ms)`);
        } else {
          notify(`🔷 Synthesized via SAMPLE fallback (${inferenceMeta?.reason || "Ollama offline"})`);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      notify(`Insight synthesis error: ${msg}`, "error");
    } finally {
      setSynthesizing(false);
    }
  };

  const acceptedEvidenceCount = Object.values(evidenceMap).filter(
    (e) => e.reviewer_status === "ACCEPTED" || e.reviewer_status === "EDITED"
  ).length;

  const filtered = filter === "All" ? insights : insights.filter((i) => i.type === filter);

  return (
    <div className="page-container animate-fade-in">
      {/* Header */}
      <div className="flex justify-between items-center mb-6" style={{ flexWrap: "wrap", gap: "var(--space-3)" }}>
        <div>
          <div className="flex items-center gap-2 mb-2" style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            <Link href="/" style={{ color: "var(--text-muted)", textDecoration: "none" }}>Dashboard</Link>
            <span>/</span>
            <Link href={buildProjectPath("/overview", projectId)} style={{ color: "var(--text-muted)", textDecoration: "none" }}>Project Overview</Link>
            <span>/</span>
            <span style={{ color: "var(--color-accent-light)" }}>Insights</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 style={{ fontSize: "1.75rem", fontWeight: "700", color: "var(--text-primary)" }}>
              Insights &amp; Contradictions (F11)
            </h1>
            <FixtureBadge mode={projectMode} />
          </div>
          <p style={{ color: "var(--text-secondary)", marginTop: "var(--space-1)", fontSize: "0.9rem" }}>
            Patterns, counter-signals, and open questions synthesized from the evidence ledger with Ollama local inference.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            className="btn btn-primary"
            onClick={() => setShowSynthesizeModal(true)}
            disabled={synthesizing}
            id="btn-synthesize-insights"
          >
            {synthesizing ? "⏳ Synthesizing (Ollama)..." : "⚡ Synthesize Insights (Ollama)"}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={loadData} title="Refresh">
            ↻
          </button>
        </div>
      </div>

      {/* Notification Toast */}
      {notification && (
        <div
          className="mb-4 animate-fade-in"
          style={{
            padding: "var(--space-3) var(--space-4)",
            borderRadius: "var(--radius-md)",
            background: notification.type === "success" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
            border: `1px solid ${notification.type === "success" ? "var(--color-success)" : "var(--color-error)"}`,
            color: notification.type === "success" ? "#86efac" : "#fca5a5",
            fontSize: "0.875rem",
          }}
        >
          {notification.msg}
        </div>
      )}

      {/* Synthesis Active Banner */}
      {synthesizing && (
        <div
          className="card mb-6 animate-pulse"
          style={{
            padding: "var(--space-4) var(--space-5)",
            background: "rgba(99,102,241,0.12)",
            border: "1px solid var(--color-accent)",
          }}
        >
          <div className="flex items-center gap-3">
            <span style={{ fontSize: "1.5rem" }}>⚙️</span>
            <div>
              <strong style={{ color: "var(--color-accent-light)" }}>Synthesizing insight from evidence ledger...</strong>
              <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                Checking Ollama health → executing local bounded inference (or graceful fixture fallback).
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary Row */}
      <div className="grid-3 mb-6" style={{ gap: "var(--space-3)" }}>
        {(["theme", "contradiction", "open_question"] as const).map((type) => {
          const conf = TYPE_CONFIG[type];
          const count = insights.filter((i) => i.type === type).length;
          return (
            <div
              key={type}
              className="card"
              style={{
                padding: "var(--space-4)",
                background: conf.color,
                border: `1px solid ${conf.border}`,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              onClick={() => setFilter(filter === type ? "All" : type)}
            >
              <div style={{ fontSize: "1.5rem", marginBottom: "4px" }}>{conf.icon}</div>
              <div style={{ fontSize: "1.5rem", fontWeight: "700", color: "var(--text-primary)" }}>{count}</div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>{conf.label}</div>
            </div>
          );
        })}
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-5" style={{ flexWrap: "wrap" }}>
        {["All", "theme", "contradiction", "open_question"].map((opt) => (
          <button
            key={opt}
            onClick={() => setFilter(opt)}
            className={`btn btn-sm ${filter === opt ? "btn-primary" : "btn-secondary"}`}
            style={{ fontSize: "0.75rem" }}
          >
            {opt === "All" ? `All Insights (${insights.length})` : TYPE_CONFIG[opt as keyof typeof TYPE_CONFIG]?.label || opt}
          </button>
        ))}
      </div>

      {/* Insights List */}
      {loading ? (
        <div className="card text-center" style={{ padding: "var(--space-8)" }}>
          <div style={{ color: "var(--text-muted)" }}>Loading insights from SQLite database...</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center" style={{ padding: "var(--space-8)" }}>
          <div style={{ fontSize: "2rem", marginBottom: "8px" }}>💡</div>
          <h3 style={{ color: "var(--text-primary)", marginBottom: "4px" }}>No insights found for this filter</h3>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem", marginBottom: "var(--space-4)" }}>
            Click the synthesize button above to generate a new insight from your project's evidence ledger.
          </p>
          <button className="btn btn-primary btn-sm" onClick={() => setShowSynthesizeModal(true)}>
            ⚡ Synthesize Insights (Ollama)
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {filtered.map((insight: InsightRow) => {
            const conf = TYPE_CONFIG[insight.type] || TYPE_CONFIG.theme;
            const forIds = insight.evidence_for_ids || [];
            const againstIds = insight.evidence_against_ids || [];

            return (
              <div
                key={insight.id}
                style={{
                  background: "var(--color-surface)",
                  border: `1px solid ${conf.border}`,
                  borderLeft: `4px solid ${conf.border.replace("0.35", "0.8")}`,
                  borderRadius: "var(--radius-md)",
                  padding: "var(--space-5)",
                }}
              >
                <div className="flex justify-between items-center mb-3" style={{ flexWrap: "wrap", gap: "var(--space-2)" }}>
                  <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                    <span style={{ fontSize: "1.1rem" }}>{conf.icon}</span>
                    <span
                      style={{
                        fontSize: "0.75rem",
                        padding: "2px 8px",
                        borderRadius: "var(--radius-sm)",
                        background: conf.color,
                        border: `1px solid ${conf.border}`,
                        color: "var(--text-secondary)",
                      }}
                    >
                      {conf.label}
                    </span>
                    <ProvenanceBadge type={insight.provenance} size="sm" />
                    {(insight.provenance === "SAMPLE" || (insight.caveat && insight.caveat.includes("UNVERIFIED SAMPLE")) || insight.statement.includes("[Unverified Sample Claim")) && (
                      <span
                        style={{
                          fontSize: "0.7rem",
                          padding: "2px 6px",
                          borderRadius: "var(--radius-sm)",
                          background: "rgba(239,68,68,0.12)",
                          border: "1px solid rgba(239,68,68,0.3)",
                          color: "#fca5a5",
                          fontWeight: 600,
                        }}
                      >
                        ⚠️ Unverified Sample Claim
                      </span>
                    )}
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                      {insight.id}
                    </span>
                  </div>
                  <span style={{ fontSize: "0.75rem", color: CONFIDENCE_COLOR[insight.confidence] || "var(--text-muted)" }}>
                    ● {insight.confidence} Confidence
                  </span>
                </div>

                <p style={{ fontSize: "1.05rem", color: "var(--text-primary)", lineHeight: 1.6, marginBottom: "var(--space-4)", fontWeight: 500 }}>
                  {insight.statement}
                </p>

                {insight.caveat && (
                  <div
                    style={{
                      fontSize: "0.8rem",
                      padding: "8px 12px",
                      borderRadius: "var(--radius-sm)",
                      background: "rgba(245,158,11,0.08)",
                      border: "1px solid rgba(245,158,11,0.2)",
                      color: "#f59e0b",
                      marginBottom: "var(--space-3)",
                    }}
                  >
                    ⚠️ <strong>Caveat:</strong> {insight.caveat}
                  </div>
                )}

                {/* Evidence citations */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "var(--space-3)" }}>
                  {forIds.length > 0 && (
                    <div>
                      <div style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--color-success)", marginBottom: "var(--space-2)" }}>
                        ✅ SUPPORTING EVIDENCE ({forIds.length})
                      </div>
                      {forIds.map((id) => {
                        const ev = evidenceMap[id];
                        return (
                          <div
                            key={id}
                            style={{
                              fontSize: "0.8rem",
                              padding: "6px 10px",
                              borderRadius: "var(--radius-sm)",
                              background: "rgba(34,197,94,0.07)",
                              border: "1px solid rgba(34,197,94,0.2)",
                              color: "var(--text-secondary)",
                              marginBottom: "6px",
                              lineHeight: 1.4,
                            }}
                          >
                            <span style={{ color: "var(--color-accent-light)", fontFamily: "var(--font-mono)", marginRight: "6px" }}>
                              [{id}]
                            </span>
                            {ev ? ev.claim : "Project Evidence Record"}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {againstIds.length > 0 && (
                    <div>
                      <div style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--color-error)", marginBottom: "var(--space-2)" }}>
                        ⚡ CONFLICTING EVIDENCE ({againstIds.length})
                      </div>
                      {againstIds.map((id) => {
                        const ev = evidenceMap[id];
                        return (
                          <div
                            key={id}
                            style={{
                              fontSize: "0.8rem",
                              padding: "6px 10px",
                              borderRadius: "var(--radius-sm)",
                              background: "rgba(239,68,68,0.07)",
                              border: "1px solid rgba(239,68,68,0.2)",
                              color: "var(--text-secondary)",
                              marginBottom: "6px",
                              lineHeight: 1.4,
                            }}
                          >
                            <span style={{ color: "var(--color-accent-light)", fontFamily: "var(--font-mono)", marginRight: "6px" }}>
                              [{id}]
                            </span>
                            {ev ? ev.claim : "Counter-evidence"}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── MODAL: SYNTHESIZE INSIGHT ── */}
      {showSynthesizeModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "var(--space-4)",
          }}
        >
          <div
            className="card animate-fade-in"
            style={{
              maxWidth: "500px",
              width: "100%",
              padding: "var(--space-6)",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              boxShadow: "0 20px 40px rgba(0,0,0,0.4)",
            }}
          >
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <span style={{ fontSize: "1.3rem" }}>⚡</span>
                <h3 style={{ fontSize: "1.15rem", fontWeight: "700", color: "var(--text-primary)" }}>
                  Synthesize Research Insight
                </h3>
              </div>
              <button
                onClick={() => setShowSynthesizeModal(false)}
                style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: "1.2rem", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "var(--space-4)", lineHeight: 1.5 }}>
              Ollama will inspect the project's evidence ledger (up to 8 items) and synthesize a structured insight conforming to schema.
            </p>

            <div style={{ marginBottom: "var(--space-4)" }}>
              <label style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "block", marginBottom: "6px" }}>
                Select Insight Synthesis Type:
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                {[
                  { key: "theme", label: "💡 Theme / Recurring Pattern", desc: "Common friction or behavior observed across multiple sources" },
                  { key: "contradiction", label: "⚡ Contradiction / Counter-signal", desc: "Conflicting evidence that challenges core venture hypotheses" },
                  { key: "open_question", label: "❓ Open Question", desc: "Critical unknowns where current evidence is ambiguous or incomplete" },
                ].map((item) => (
                  <label
                    key={item.key}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "var(--space-3)",
                      padding: "var(--space-3)",
                      borderRadius: "var(--radius-sm)",
                      border: `1px solid ${selectedType === item.key ? "var(--color-accent)" : "var(--color-border)"}`,
                      background: selectedType === item.key ? "rgba(99,102,241,0.1)" : "var(--color-surface-2)",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="insightType"
                      checked={selectedType === item.key}
                      onChange={() => setSelectedType(item.key as any)}
                      style={{ marginTop: "3px" }}
                    />
                    <div>
                      <div style={{ fontSize: "0.875rem", fontWeight: "600", color: "var(--text-primary)" }}>{item.label}</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{item.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {projectMode === "LIVE" && acceptedEvidenceCount === 0 && (
              <div
                id="unreviewed-evidence-warning"
                style={{
                  padding: "var(--space-3)",
                  borderRadius: "var(--radius-sm)",
                  background: "rgba(245, 158, 11, 0.12)",
                  border: "1px solid rgba(245, 158, 11, 0.35)",
                  color: "var(--text-primary)",
                  fontSize: "0.825rem",
                  marginBottom: "var(--space-4)",
                  lineHeight: 1.5,
                }}
              >
                <div style={{ fontWeight: 600, color: "#f59e0b", marginBottom: "4px" }}>
                  ⚠️ Human Review Gate: No Accepted Evidence
                </div>
                This project has no accepted evidence yet. In LIVE mode, IdeaProbe requires at least one reviewed and accepted evidence claim before synthesizing insights.
                <div style={{ marginTop: "6px" }}>
                  <Link
                    href={buildProjectPath("/research", projectId)}
                    style={{ color: "var(--color-accent-light)", fontWeight: 600, textDecoration: "underline" }}
                    onClick={() => setShowSynthesizeModal(false)}
                  >
                    Go to Research Ledger to Review Evidence →
                  </Link>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 mt-6">
              <button className="btn btn-secondary" onClick={() => setShowSynthesizeModal(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSynthesize}
                disabled={synthesizing || (projectMode === "LIVE" && acceptedEvidenceCount === 0)}
                title={projectMode === "LIVE" && acceptedEvidenceCount === 0 ? "Review and accept evidence in the Research Ledger first" : undefined}
                id="btn-run-synthesis"
              >
                ⚡ Run Synthesis
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function InsightsPage() {
  return (
    <Suspense fallback={<div className="page-container">Loading insights...</div>}>
      <InsightsContent />
    </Suspense>
  );
}
