"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { ProvenanceBadge } from "@/components/Badges";
import { useActiveProjectId, buildProjectPath } from "@/lib/useActiveProject";

interface AssumptionRecord {
  id: string;
  project_id: string;
  statement: string;
  category: string;
  impact: "High" | "Medium" | "Low";
  uncertainty: "Critical" | "High" | "Medium" | "Low";
  rationale: string;
  status: "unvalidated" | "testing" | "validated" | "invalidated";
  evidence_ids?: string[];
  priority_score: number;
  provenance: string;
  created_at: string;
}

const UNCERTAINTY_CONFIG: Record<string, { color: string; bg: string; score: number }> = {
  Critical: { color: "#ef4444", bg: "rgba(239,68,68,0.12)", score: 4 },
  High: { color: "#f59e0b", bg: "rgba(245,158,11,0.12)", score: 3 },
  Medium: { color: "#6366f1", bg: "rgba(99,102,241,0.12)", score: 2 },
  Low: { color: "#22c55e", bg: "rgba(34,197,94,0.12)", score: 1 },
};

const IMPACT_SCORE: Record<string, number> = { High: 3, Medium: 2, Low: 1 };

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  unvalidated: { label: "Untested", color: "var(--text-muted)", bg: "rgba(148,163,184,0.1)" },
  testing: { label: "Being Tested", color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
  validated: { label: "Validated", color: "var(--color-success)", bg: "rgba(34,197,94,0.1)" },
  invalidated: { label: "Invalidated", color: "var(--color-error)", bg: "rgba(239,68,68,0.1)" },
};

function RisksContent() {
  const projectId = useActiveProjectId();
  const [assumptions, setAssumptions] = useState<AssumptionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"list" | "matrix">("list");
  const [statusFilter, setStatusFilter] = useState<string>("All");

  // Add modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [statement, setStatement] = useState("");
  const [category, setCategory] = useState("desirability");
  const [impact, setImpact] = useState<"High" | "Medium" | "Low">("High");
  const [uncertainty, setUncertainty] = useState<"Critical" | "High" | "Medium" | "Low">("Critical");
  const [rationale, setRationale] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadAssumptions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/assumptions`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to load assumptions");
      setAssumptions(data.data.assumptions || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error loading assumptions");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadAssumptions();
  }, [loadAssumptions]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statement.trim()) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/assumptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          statement: statement.trim(),
          category,
          impact,
          uncertainty,
          rationale: rationale.trim(),
          status: "unvalidated",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to create assumption");
      setShowAddModal(false);
      setStatement("");
      setRationale("");
      await loadAssumptions();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to create assumption");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/assumptions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to update status");
      await loadAssumptions();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to update status");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to remove this assumption? Linked experiments will be unlinked.")) return;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/assumptions?assumptionId=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to delete");
      await loadAssumptions();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const filtered = assumptions.filter((a) => {
    if (statusFilter === "All") return true;
    return a.status === statusFilter;
  });

  const sorted = [...filtered].sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0));

  const statusCounts = {
    unvalidated: assumptions.filter((a) => a.status === "unvalidated").length,
    testing: assumptions.filter((a) => a.status === "testing").length,
    validated: assumptions.filter((a) => a.status === "validated").length,
    invalidated: assumptions.filter((a) => a.status === "invalidated").length,
  };

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
            <span style={{ color: "var(--color-accent-light)" }}>Risks</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 style={{ fontSize: "1.75rem", fontWeight: "700", color: "var(--text-primary)" }}>
              Assumption Register & Risk Matrix (F12)
            </h1>
            <span className="badge badge-accent" style={{ fontSize: "0.75rem" }}>SQLite Live</span>
          </div>
          <p style={{ color: "var(--text-secondary)", marginTop: "var(--space-1)", fontSize: "0.9rem" }}>
            Critical assumptions ranked by Uncertainty × Impact. High-risk items must be falsified with experiments before coding.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setActiveTab(activeTab === "list" ? "matrix" : "list")}
          >
            {activeTab === "list" ? "📊 View 2×2 Matrix" : "📋 View Ranked List"}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAddModal(true)}>
            + Add Assumption
          </button>
        </div>
      </div>

      {error && (
        <div className="card mb-4" style={{ padding: "var(--space-3) var(--space-4)", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--color-error)" }}>
          ⚠️ {error}
        </div>
      )}

      {/* Status Counters Strip */}
      <div className="grid-4 mb-6" style={{ gap: "var(--space-3)" }}>
        {(["unvalidated", "testing", "validated", "invalidated"] as const).map((st) => {
          const cfg = STATUS_CONFIG[st];
          return (
            <div
              key={st}
              className="card"
              style={{
                padding: "var(--space-3) var(--space-4)",
                background: cfg.bg,
                border: `1px solid ${statusFilter === st ? cfg.color : "var(--color-border)"}`,
                cursor: "pointer",
              }}
              onClick={() => setStatusFilter(statusFilter === st ? "All" : st)}
            >
              <div style={{ fontSize: "1.5rem", fontWeight: "700", color: cfg.color }}>
                {statusCounts[st]}
              </div>
              <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                {cfg.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* Priority formula note */}
      <div className="card mb-6" style={{ padding: "var(--space-4) var(--space-5)", background: "var(--color-surface-2)" }}>
        <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
          <strong>Priority = Uncertainty × Impact.</strong> Score range 1 to 12. Critical×High = 12 (must test immediately). Low×Low = 1 (monitor later).
          Click on any status pill to transition it across its validation lifecycle.
        </div>
      </div>

      {loading ? (
        <div className="card text-center" style={{ padding: "var(--space-8)", color: "var(--text-muted)" }}>
          Loading assumptions from SQLite...
        </div>
      ) : activeTab === "matrix" ? (
        /* 2×2 Matrix View */
        <div className="card mb-6" style={{ padding: "var(--space-5)" }}>
          <h3 style={{ fontSize: "1.1rem", fontWeight: "600", color: "var(--text-primary)", marginBottom: "var(--space-4)" }}>
            2×2 Prioritization Matrix (Impact × Uncertainty)
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
            {/* Top Left: Critical & High Uncertainty x High Impact */}
            <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--radius-md)", padding: "var(--space-4)" }}>
              <div style={{ fontSize: "0.875rem", fontWeight: "700", color: "#ef4444", marginBottom: "8px" }}>
                🚨 QUADRANT 1: TEST IMMEDIATELY (High Impact × Critical/High Uncertainty)
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "12px" }}>
                Failure here kills the venture. Run rapid falsifiable tests before MVP code.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {assumptions
                  .filter((a) => a.impact === "High" && (a.uncertainty === "Critical" || a.uncertainty === "High"))
                  .map((a) => (
                    <div key={a.id} style={{ padding: "8px 12px", background: "var(--color-surface)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", fontSize: "0.8125rem" }}>
                      <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>{a.statement}</div>
                      <div className="flex justify-between items-center mt-2">
                        <span style={{ fontSize: "0.7rem", color: "#ef4444" }}>Score: {a.priority_score} | {STATUS_CONFIG[a.status]?.label || a.status}</span>
                        <Link href={buildProjectPath(`/experiments?assumptionId=${a.id}`, projectId)} className="btn btn-primary btn-sm" style={{ fontSize: "0.7rem", padding: "2px 8px" }}>
                          🧪 Test
                        </Link>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* Top Right: Low/Med Uncertainty x High Impact */}
            <div style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: "var(--radius-md)", padding: "var(--space-4)" }}>
              <div style={{ fontSize: "0.875rem", fontWeight: "700", color: "#f59e0b", marginBottom: "8px" }}>
                ⚠️ QUADRANT 2: OPERATIONAL RISKS (High Impact × Low/Med Uncertainty)
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "12px" }}>
                Well-understood factors with major consequences. Manage via standard engineering and clear policies.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {assumptions
                  .filter((a) => a.impact === "High" && (a.uncertainty === "Medium" || a.uncertainty === "Low"))
                  .map((a) => (
                    <div key={a.id} style={{ padding: "8px 12px", background: "var(--color-surface)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", fontSize: "0.8125rem" }}>
                      <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>{a.statement}</div>
                      <div className="flex justify-between items-center mt-2">
                        <span style={{ fontSize: "0.7rem", color: "#f59e0b" }}>Score: {a.priority_score} | {STATUS_CONFIG[a.status]?.label || a.status}</span>
                        <Link href={buildProjectPath(`/experiments?assumptionId=${a.id}`, projectId)} className="btn btn-secondary btn-sm" style={{ fontSize: "0.7rem", padding: "2px 8px" }}>
                          🧪 Test
                        </Link>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* Bottom Left: Critical/High Uncertainty x Low/Med Impact */}
            <div style={{ background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: "var(--radius-md)", padding: "var(--space-4)" }}>
              <div style={{ fontSize: "0.875rem", fontWeight: "700", color: "#818cf8", marginBottom: "8px" }}>
                🔍 QUADRANT 3: WATCHLIST (Med/Low Impact × High/Critical Uncertainty)
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "12px" }}>
                Unknown factors with moderate blast radius. Revisit after core hypotheses are proven.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {assumptions
                  .filter((a) => a.impact !== "High" && (a.uncertainty === "Critical" || a.uncertainty === "High"))
                  .map((a) => (
                    <div key={a.id} style={{ padding: "8px 12px", background: "var(--color-surface)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", fontSize: "0.8125rem" }}>
                      <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>{a.statement}</div>
                      <div className="flex justify-between items-center mt-2">
                        <span style={{ fontSize: "0.7rem", color: "#818cf8" }}>Score: {a.priority_score} | {STATUS_CONFIG[a.status]?.label || a.status}</span>
                        <Link href={buildProjectPath(`/experiments?assumptionId=${a.id}`, projectId)} className="btn btn-secondary btn-sm" style={{ fontSize: "0.7rem", padding: "2px 8px" }}>
                          🧪 Test
                        </Link>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* Bottom Right: Low Uncertainty x Low Impact */}
            <div style={{ background: "rgba(148,163,184,0.06)", border: "1px solid rgba(148,163,184,0.3)", borderRadius: "var(--radius-md)", padding: "var(--space-4)" }}>
              <div style={{ fontSize: "0.875rem", fontWeight: "700", color: "var(--text-muted)", marginBottom: "8px" }}>
                💤 QUADRANT 4: DEPRIORITIZED (Low/Med Impact × Low/Med Uncertainty)
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "12px" }}>
                Known and low risk. Do not spend precious experiment cycles here.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {assumptions
                  .filter((a) => a.impact !== "High" && a.uncertainty !== "Critical" && a.uncertainty !== "High")
                  .map((a) => (
                    <div key={a.id} style={{ padding: "8px 12px", background: "var(--color-surface)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", fontSize: "0.8125rem" }}>
                      <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>{a.statement}</div>
                      <div className="flex justify-between items-center mt-2">
                        <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Score: {a.priority_score} | {STATUS_CONFIG[a.status]?.label || a.status}</span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Ranked List View */
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {sorted.map((asm: AssumptionRecord, idx) => {
            const uConf = UNCERTAINTY_CONFIG[asm.uncertainty] || UNCERTAINTY_CONFIG.Medium;
            const statusCfg = STATUS_CONFIG[asm.status] || STATUS_CONFIG.unvalidated;
            const isExpanded = expanded === asm.id;

            return (
              <div
                key={asm.id}
                style={{
                  background: "var(--color-surface)",
                  border: `1px solid var(--color-border)`,
                  borderLeft: `4px solid ${uConf.color}`,
                  borderRadius: "var(--radius-md)",
                  overflow: "hidden",
                }}
              >
                {/* Main Row */}
                <div
                  style={{
                    padding: "var(--space-4) var(--space-5)",
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-4)",
                    flexWrap: "wrap",
                  }}
                >
                  {/* Priority rank */}
                  <div
                    style={{
                      width: "32px",
                      height: "32px",
                      borderRadius: "50%",
                      background: uConf.bg,
                      border: `1px solid ${uConf.color}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.875rem",
                      fontWeight: "700",
                      color: uConf.color,
                      flexShrink: 0,
                    }}
                  >
                    {idx + 1}
                  </div>

                  {/* Statement */}
                  <div style={{ flex: 1, minWidth: "240px", cursor: "pointer" }} onClick={() => setExpanded(isExpanded ? null : asm.id)}>
                    <div style={{ fontSize: "0.9375rem", fontWeight: "600", color: "var(--text-primary)", lineHeight: 1.5 }}>
                      {asm.statement}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "4px" }}>
                      Category: {asm.category.replace("_", " ")}
                    </div>
                  </div>

                  {/* Metadata & Controls */}
                  <div className="flex items-center gap-3" style={{ flexShrink: 0, flexWrap: "wrap" }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>UNCERTAINTY</div>
                      <span style={{ fontSize: "0.8rem", fontWeight: "600", color: uConf.color }}>{asm.uncertainty}</span>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>IMPACT</div>
                      <span style={{ fontSize: "0.8rem", fontWeight: "600", color: "var(--text-primary)" }}>{asm.impact}</span>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>SCORE</div>
                      <span style={{ fontSize: "1rem", fontWeight: "700", color: uConf.color }}>{asm.priority_score}</span>
                    </div>

                    {/* Status dropdown */}
                    <div>
                      <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>STATUS</div>
                      <select
                        value={asm.status}
                        onChange={(e) => handleStatusChange(asm.id, e.target.value)}
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          padding: "3px 8px",
                          borderRadius: "var(--radius-sm)",
                          background: statusCfg.bg,
                          color: statusCfg.color,
                          border: `1px solid ${statusCfg.color}`,
                          cursor: "pointer",
                        }}
                      >
                        <option value="unvalidated">Untested</option>
                        <option value="testing">Being Tested</option>
                        <option value="validated">Validated</option>
                        <option value="invalidated">Invalidated</option>
                      </select>
                    </div>

                    <ProvenanceBadge type={asm.provenance as any} size="sm" />

                    <Link
                      href={buildProjectPath(`/experiments?assumptionId=${asm.id}`, projectId)}
                      className="btn btn-secondary btn-sm"
                      style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "4px" }}
                    >
                      🧪 Test
                    </Link>

                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleDelete(asm.id)}
                      style={{ fontSize: "0.75rem", color: "var(--color-error)" }}
                    >
                      ✕
                    </button>

                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setExpanded(isExpanded ? null : asm.id)}
                      style={{ fontSize: "0.75rem" }}
                    >
                      {isExpanded ? "▲" : "▼"}
                    </button>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div style={{ padding: "0 var(--space-5) var(--space-4)", borderTop: "1px solid var(--color-border)" }}>
                    <div style={{ paddingTop: "var(--space-4)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
                      <div>
                        <div style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--text-muted)", marginBottom: "var(--space-1)" }}>
                          RATIONALE
                        </div>
                        <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                          {asm.rationale || "No specific rationale documented."}
                        </p>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--text-muted)", marginBottom: "var(--space-1)" }}>
                          RECOMMENDED NEXT ACTION
                        </div>
                        <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                          {asm.uncertainty === "Critical"
                            ? "Design and run a falsifiable experiment BEFORE writing any product code."
                            : asm.uncertainty === "High"
                            ? "Plan an experiment for this assumption in the next 2-4 weeks."
                            : "Monitor and validate during MVP rollout."}
                        </p>
                        <Link
                          href={buildProjectPath(`/experiments?assumptionId=${asm.id}`, projectId)}
                          className="btn btn-primary btn-sm"
                          style={{ marginTop: "var(--space-2)", fontSize: "0.8rem", display: "inline-block" }}
                        >
                          → Design Experiment for this Assumption
                        </Link>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Assumption Modal */}
      {showAddModal && (
        <div className="modal-backdrop" onClick={() => !isSubmitting && setShowAddModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "540px" }}>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: "var(--space-4)" }}>
              + Add Risky Assumption
            </h3>
            <form onSubmit={handleCreate}>
              <div className="mb-4">
                <label className="label">Assumption Statement *</label>
                <textarea
                  className="input"
                  rows={3}
                  required
                  placeholder="e.g. Students will check a WhatsApp bot daily even without mobile app push notifications."
                  value={statement}
                  onChange={(e) => setStatement(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>

              <div className="grid-2 mb-4" style={{ gap: "var(--space-3)" }}>
                <div>
                  <label className="label">Category *</label>
                  <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: "100%" }}>
                    <option value="desirability">Desirability (Do they want it?)</option>
                    <option value="viability">Viability (Will they pay / unit economics?)</option>
                    <option value="feasibility">Feasibility (Can we build it?)</option>
                    <option value="usability">Usability (Can they figure it out?)</option>
                    <option value="distribution">Distribution (How do we reach them?)</option>
                    <option value="compliance">Compliance (Legal / privacy / ethics)</option>
                  </select>
                </div>

                <div>
                  <label className="label">Uncertainty *</label>
                  <select className="input" value={uncertainty} onChange={(e) => setUncertainty(e.target.value as any)} style={{ width: "100%" }}>
                    <option value="Critical">Critical (Zero data, venture-killing)</option>
                    <option value="High">High (Little data, major doubt)</option>
                    <option value="Medium">Medium (Some precedent, unproven here)</option>
                    <option value="Low">Low (Well documented / standard)</option>
                  </select>
                </div>
              </div>

              <div className="mb-4">
                <label className="label">Impact *</label>
                <select className="input" value={impact} onChange={(e) => setImpact(e.target.value as any)} style={{ width: "100%" }}>
                  <option value="High">High (Venture fails if wrong)</option>
                  <option value="Medium">Medium (Requires major pivot or rework)</option>
                  <option value="Low">Low (Minor inconvenience / fixable)</option>
                </select>
              </div>

              <div className="mb-5">
                <label className="label">Rationale / Risk Description</label>
                <textarea
                  className="input"
                  rows={3}
                  placeholder="Why is this assumption precarious? What evidence makes you question it?"
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={isSubmitting}
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={isSubmitting || !statement.trim()}>
                  {isSubmitting ? "Saving..." : "Save Assumption"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RisksPage() {
  return (
    <Suspense fallback={<div className="page-container">Loading risk matrix...</div>}>
      <RisksContent />
    </Suspense>
  );
}
