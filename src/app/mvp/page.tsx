"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { ProvenanceBadge } from "@/components/Badges";
import { useActiveProjectId, buildProjectPath } from "@/lib/useActiveProject";
import type { MVPPriority } from "@/types";

const EFFORT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  Low: { bg: "rgba(34,197,94,0.12)", text: "var(--color-success)", border: "rgba(34,197,94,0.3)" },
  Medium: { bg: "rgba(245,158,11,0.12)", text: "#f59e0b", border: "rgba(245,158,11,0.3)" },
  High: { bg: "rgba(239,68,68,0.12)", text: "var(--color-error)", border: "rgba(239,68,68,0.3)" },
};

const PRIORITY_META: Record<
  MVPPriority,
  { label: string; icon: string; color: string; bg: string; border: string; desc: string }
> = {
  now: {
    label: "NOW — Core Falsifiable MVP Scope",
    icon: "🟢",
    color: "var(--color-success)",
    bg: "rgba(34,197,94,0.06)",
    border: "rgba(34,197,94,0.3)",
    desc: "Essential functionality to execute Experiment 1. If this fails, the core premise fails.",
  },
  later: {
    label: "LATER — Post-Validation Enhancements",
    icon: "🟡",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.06)",
    border: "rgba(245,158,11,0.3)",
    desc: "Valuable extensions deferred until core adherence and retention loops are validated.",
  },
  omit: {
    label: "OMIT — Distractions to Avoid",
    icon: "🔴",
    color: "var(--color-error)",
    bg: "rgba(239,68,68,0.06)",
    border: "rgba(239,68,68,0.3)",
    desc: "Features explicitly excluded to prevent scope creep and maintain test velocity.",
  },
};

interface MVPFeatureRow {
  id: string;
  project_id: string;
  name: string;
  scope: string | null;
  priority: MVPPriority;
  effort: string;
  rationale: string | null;
  experiment_ids: string[];
  dependency_ids: string[];
  status: string;
  provenance: string;
  created_at: string;
}

interface AddFeatureForm {
  name: string;
  scope: string;
  priority: MVPPriority;
  effort: string;
  rationale: string;
}

const EMPTY_FORM: AddFeatureForm = {
  name: "",
  scope: "",
  priority: "later",
  effort: "Medium",
  rationale: "",
};

function MvpPlanContent() {
  const projectId = useActiveProjectId();
  const [features, setFeatures] = useState<MVPFeatureRow[]>([]);
  const [counts, setCounts] = useState({ now: 0, later: 0, omit: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [priorityFilter, setPriorityFilter] = useState<string>("All");
  const [effortFilter, setEffortFilter] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Add feature modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState<AddFeatureForm>(EMPTY_FORM);
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Triage in-progress tracking
  const [triagingId, setTriagingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Fetch features ──────────────────────────────────────────────
  const fetchFeatures = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/mvp`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to load features");
      setFeatures(data.data.features);
      setCounts(data.data.counts);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchFeatures();
  }, [fetchFeatures]);

  // ── Triage (change priority) ────────────────────────────────────
  const handleTriage = async (featureId: string, newPriority: MVPPriority) => {
    setTriagingId(featureId);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/mvp`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureId, priority: newPriority }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Triage failed");
      await fetchFeatures();
    } catch (err: any) {
      alert(`Triage error: ${err.message}`);
    } finally {
      setTriagingId(null);
    }
  };

  // ── Delete feature ──────────────────────────────────────────────
  const handleDelete = async (featureId: string, name: string) => {
    if (!confirm(`Delete feature "${name}"? This cannot be undone.`)) return;
    setDeletingId(featureId);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/mvp?featureId=${encodeURIComponent(featureId)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Delete failed");
      await fetchFeatures();
    } catch (err: any) {
      alert(`Delete error: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  // ── Add feature ─────────────────────────────────────────────────
  const handleAdd = async () => {
    if (!addForm.name.trim()) { setAddError("Feature name is required"); return; }
    setAddLoading(true);
    setAddError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/mvp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addForm.name.trim(),
          scope: addForm.scope.trim() || null,
          priority: addForm.priority,
          effort: addForm.effort,
          rationale: addForm.rationale.trim() || null,
          provenance: "USER_INPUT",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Add failed");
      setShowAddModal(false);
      setAddForm(EMPTY_FORM);
      await fetchFeatures();
    } catch (err: any) {
      setAddError(err.message);
    } finally {
      setAddLoading(false);
    }
  };

  // ── Filter ──────────────────────────────────────────────────────
  const filteredFeatures = features.filter((f) => {
    const matchesPriority = priorityFilter === "All" || f.priority === priorityFilter;
    const matchesEffort = effortFilter === "All" || f.effort === effortFilter;
    const matchesSearch =
      searchQuery === "" ||
      f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (f.scope && f.scope.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (f.rationale && f.rationale.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesPriority && matchesEffort && matchesSearch;
  });

  // ── Render ──────────────────────────────────────────────────────
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
            <span style={{ color: "var(--color-accent-light)" }}>MVP Scope</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 style={{ fontSize: "1.75rem", fontWeight: "700", color: "var(--text-primary)" }}>
              MVP Scope &amp; Roadmap (F14)
            </h1>
            <span
              style={{
                fontSize: "0.6875rem",
                padding: "2px 7px",
                borderRadius: "999px",
                background: "rgba(34,197,94,0.15)",
                color: "var(--color-success)",
                border: "1px solid rgba(34,197,94,0.3)",
                fontWeight: "700",
                letterSpacing: "0.04em",
              }}
            >
              ✓ LIVE
            </span>
          </div>
          <p style={{ color: "var(--text-secondary)", marginTop: "var(--space-1)", fontSize: "0.9rem" }}>
            Feature triage into Now, Later, and Omit — backed by live SQLite data, linked to experiments and risks.
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="btn btn-primary btn-sm"
          id="btn-add-mvp-feature"
        >
          + Add Feature
        </button>
      </div>

      {/* Guiding Principle Banner */}
      <div
        className="card mb-6"
        style={{
          padding: "var(--space-4) var(--space-5)",
          background: "linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(34,197,94,0.04) 100%)",
          border: "1px solid rgba(99,102,241,0.25)",
        }}
      >
        <div className="flex items-center gap-3">
          <span style={{ fontSize: "1.25rem" }}>🎯</span>
          <div>
            <div style={{ fontSize: "0.875rem", fontWeight: "600", color: "var(--text-primary)" }}>
              Falsifiable MVP Principle
            </div>
            <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", marginTop: "2px" }}>
              The purpose of an MVP is <strong>not</strong> to ship a smaller version of your ultimate vision — it is to
              conduct the fastest possible falsifiable test of your most dangerous assumption. Every &quot;Now&quot; feature must directly serve a planned experiment.
            </p>
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="card mb-4" style={{ padding: "var(--space-4)", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--color-error)" }}>
          ⚠️ Failed to load features: {error}
          <button onClick={fetchFeatures} style={{ marginLeft: "1rem", textDecoration: "underline", cursor: "pointer", background: "none", border: "none", color: "var(--color-error)" }}>Retry</button>
        </div>
      )}

      {/* KPI Strip */}
      {!loading && (
        <div className="grid-3 mb-6" style={{ gap: "var(--space-3)" }}>
          {(["now", "later", "omit"] as MVPPriority[]).map((pri) => {
            const meta = PRIORITY_META[pri];
            const count = counts[pri];
            const isActive = priorityFilter === pri;
            return (
              <div
                key={pri}
                className="card"
                onClick={() => setPriorityFilter(priorityFilter === pri ? "All" : pri)}
                style={{
                  padding: "var(--space-4)",
                  background: meta.bg,
                  border: `1px solid ${isActive ? meta.color : meta.border}`,
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
              >
                <div className="flex justify-between items-center mb-1">
                  <span style={{ fontSize: "1.2rem" }}>{meta.icon}</span>
                  <span style={{ fontSize: "0.75rem", padding: "2px 8px", borderRadius: "999px", background: "rgba(255,255,255,0.06)", color: meta.color, fontWeight: "600" }}>
                    {pri.toUpperCase()}
                  </span>
                </div>
                <div style={{ fontSize: "1.75rem", fontWeight: "700", color: "var(--text-primary)" }}>{count}</div>
                <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", marginTop: "2px" }}>
                  {pri === "now" ? "Core Launch Scope" : pri === "later" ? "Deferred Backlog" : "Explicitly Excluded"}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <div
        className="card mb-6"
        style={{
          padding: "var(--space-3) var(--space-4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "var(--space-3)",
          background: "var(--color-surface-2)",
        }}
      >
        <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)", fontWeight: "600" }}>Priority:</span>
          {["All", "now", "later", "omit"].map((pri) => (
            <button
              key={pri}
              onClick={() => setPriorityFilter(pri)}
              style={{
                fontSize: "0.75rem", padding: "4px 10px", borderRadius: "var(--radius-sm)", border: "1px solid",
                borderColor: priorityFilter === pri ? "var(--color-accent)" : "var(--color-border)",
                background: priorityFilter === pri ? "var(--color-accent)" : "transparent",
                color: priorityFilter === pri ? "#fff" : "var(--text-secondary)",
                cursor: "pointer", fontWeight: priorityFilter === pri ? "600" : "400", textTransform: "capitalize",
              }}
            >
              {pri === "All" ? "All Priorities" : pri}
            </button>
          ))}
          <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)", fontWeight: "600", marginLeft: "var(--space-2)" }}>Effort:</span>
          {["All", "Low", "Medium", "High"].map((eff) => (
            <button
              key={eff}
              onClick={() => setEffortFilter(eff)}
              style={{
                fontSize: "0.75rem", padding: "4px 8px", borderRadius: "var(--radius-sm)", border: "1px solid",
                borderColor: effortFilter === eff ? "var(--color-accent-light)" : "var(--color-border)",
                background: effortFilter === eff ? "rgba(99,102,241,0.15)" : "transparent",
                color: effortFilter === eff ? "var(--color-accent-light)" : "var(--text-secondary)",
                cursor: "pointer",
              }}
            >
              {eff}
            </button>
          ))}
        </div>
        <div style={{ minWidth: "220px" }}>
          <input
            type="text"
            placeholder="Search features..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input"
            style={{ fontSize: "0.8125rem", padding: "6px 12px", width: "100%" }}
          />
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="card" style={{ padding: "var(--space-5)", height: "100px", background: "var(--color-surface-2)", animation: "pulse 1.5s ease-in-out infinite" }} />
          ))}
        </div>
      )}

      {/* Feature Buckets */}
      {!loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          {(["now", "later", "omit"] as MVPPriority[])
            .filter((pri) => priorityFilter === "All" || priorityFilter === pri)
            .map((pri) => {
              const meta = PRIORITY_META[pri];
              const bucketFeatures = filteredFeatures.filter((f) => f.priority === pri);

              return (
                <div key={pri} className="mb-2">
                  <div className="flex items-center justify-between mb-3" style={{ borderBottom: `2px solid ${meta.color}`, paddingBottom: "var(--space-2)" }}>
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: "1.2rem" }}>{meta.icon}</span>
                      <h2 style={{ fontSize: "1.125rem", fontWeight: "700", color: meta.color }}>{meta.label}</h2>
                      <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>({bucketFeatures.length})</span>
                    </div>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", maxWidth: "340px", textAlign: "right" }}>{meta.desc}</span>
                  </div>

                  {bucketFeatures.length === 0 ? (
                    <div className="card" style={{ padding: "var(--space-6)", textAlign: "center", color: "var(--text-muted)", fontSize: "0.875rem" }}>
                      No features in this bucket match the current filter.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                      {bucketFeatures.map((f) => {
                        const isExpanded = expandedId === f.id;
                        const effortStyle = EFFORT_COLORS[f.effort || "Medium"] || EFFORT_COLORS.Medium;
                        const isBusy = triagingId === f.id || deletingId === f.id;

                        return (
                          <div
                            key={f.id}
                            className="card"
                            style={{
                              padding: "var(--space-4) var(--space-5)",
                              borderLeft: `4px solid ${meta.color}`,
                              transition: "all 0.15s ease",
                              opacity: isBusy ? 0.6 : 1,
                            }}
                          >
                            <div className="flex justify-between items-start" style={{ gap: "var(--space-3)" }}>
                              <div style={{ flex: 1 }}>
                                <div className="flex items-center gap-2 mb-1" style={{ flexWrap: "wrap" }}>
                                  <h3 style={{ fontSize: "1rem", fontWeight: "600", color: "var(--text-primary)" }}>
                                    {f.name}
                                  </h3>
                                  <span style={{ fontSize: "0.6875rem", padding: "2px 6px", borderRadius: "4px", background: effortStyle.bg, color: effortStyle.text, border: `1px solid ${effortStyle.border}`, fontWeight: "600" }}>
                                    Effort: {f.effort}
                                  </span>
                                  <ProvenanceBadge type={f.provenance as any} size="sm" />
                                </div>

                                {f.scope && (
                                  <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: "1.5", marginBottom: "var(--space-2)" }}>
                                    <strong>Scope:</strong> {f.scope}
                                  </p>
                                )}

                                {f.rationale && (
                                  <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: "1.4" }}>
                                    <strong>Rationale:</strong> {f.rationale}
                                  </p>
                                )}

                                {/* Linked experiments pill */}
                                {f.experiment_ids.length > 0 && (
                                  <div style={{ marginTop: "var(--space-2)", display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
                                    <span style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--color-accent-light)" }}>🔬 Linked Experiments:</span>
                                    {f.experiment_ids.map((eid) => (
                                      <Link key={eid} href={buildProjectPath("/experiments", projectId)} style={{ textDecoration: "none", fontSize: "0.75rem", padding: "2px 8px", borderRadius: "var(--radius-sm)", background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.3)", color: "var(--color-accent-light)", fontWeight: "500" }}>
                                        {eid}
                                      </Link>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Action cluster */}
                              <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
                                {/* Priority triage mini-buttons */}
                                <div className="flex items-center gap-1">
                                  {(["now", "later", "omit"] as MVPPriority[]).filter((p) => p !== pri).map((p) => {
                                    const pm = PRIORITY_META[p];
                                    return (
                                      <button
                                        key={p}
                                        onClick={() => handleTriage(f.id, p)}
                                        disabled={isBusy}
                                        title={`Move to ${p.toUpperCase()}`}
                                        style={{
                                          fontSize: "0.6875rem", padding: "2px 6px", borderRadius: "4px",
                                          border: `1px solid ${pm.border}`, background: pm.bg, color: pm.color,
                                          cursor: "pointer", fontWeight: "600",
                                        }}
                                      >
                                        → {p.toUpperCase()}
                                      </button>
                                    );
                                  })}
                                </div>

                                <button
                                  onClick={() => setExpandedId(isExpanded ? null : f.id)}
                                  style={{ background: "none", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", color: "var(--text-muted)", padding: "4px 8px", fontSize: "0.75rem", cursor: "pointer" }}
                                >
                                  {isExpanded ? "Less ▲" : "Details ▼"}
                                </button>

                                <button
                                  onClick={() => handleDelete(f.id, f.name)}
                                  disabled={isBusy}
                                  title="Delete feature"
                                  style={{ background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--radius-sm)", color: "var(--color-error)", padding: "4px 6px", fontSize: "0.75rem", cursor: "pointer" }}
                                >
                                  🗑
                                </button>
                              </div>
                            </div>

                            {/* Expanded detail */}
                            {isExpanded && (
                              <div style={{ marginTop: "var(--space-4)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--color-border)", fontSize: "0.8125rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "var(--space-3)", background: "var(--color-surface-2)", padding: "var(--space-3)", borderRadius: "var(--radius-sm)" }}>
                                <div>
                                  <span style={{ color: "var(--text-muted)" }}>Feature ID:</span>
                                  <div style={{ fontFamily: "monospace", color: "var(--text-primary)", fontSize: "0.75rem" }}>{f.id}</div>
                                </div>
                                <div>
                                  <span style={{ color: "var(--text-muted)" }}>Status:</span>
                                  <div style={{ color: "var(--text-primary)", textTransform: "capitalize" }}>{f.status}</div>
                                </div>
                                <div>
                                  <span style={{ color: "var(--text-muted)" }}>Priority Bucket:</span>
                                  <div style={{ color: meta.color, fontWeight: "600", textTransform: "uppercase" }}>{f.priority}</div>
                                </div>
                                <div>
                                  <span style={{ color: "var(--text-muted)" }}>Provenance:</span>
                                  <div><ProvenanceBadge type={f.provenance as any} size="sm" /></div>
                                </div>
                                <div>
                                  <span style={{ color: "var(--text-muted)" }}>Created:</span>
                                  <div style={{ color: "var(--text-secondary)" }}>{new Date(f.created_at).toLocaleDateString()}</div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {/* ── Add Feature Modal ───────────────────────────────────── */}
      {showAddModal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-4)" }}
          onClick={(e) => { if (e.target === e.currentTarget) { setShowAddModal(false); setAddForm(EMPTY_FORM); setAddError(null); } }}
        >
          <div className="card" style={{ width: "100%", maxWidth: "560px", padding: "var(--space-6)", background: "var(--color-surface)" }}>
            <div className="flex justify-between items-center mb-5">
              <h2 style={{ fontSize: "1.25rem", fontWeight: "700", color: "var(--text-primary)" }}>+ Add MVP Feature</h2>
              <button onClick={() => { setShowAddModal(false); setAddForm(EMPTY_FORM); setAddError(null); }} style={{ background: "none", border: "none", fontSize: "1.25rem", cursor: "pointer", color: "var(--text-muted)" }}>✕</button>
            </div>

            {addError && (
              <div style={{ padding: "10px 14px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--radius-sm)", color: "var(--color-error)", fontSize: "0.875rem", marginBottom: "var(--space-4)" }}>
                {addError}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
              <div>
                <label style={{ fontSize: "0.8125rem", fontWeight: "600", color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>Feature Name *</label>
                <input className="input" value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Smart Session Reminders" style={{ width: "100%" }} />
              </div>

              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
                <div>
                  <label style={{ fontSize: "0.8125rem", fontWeight: "600", color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>Priority Bucket</label>
                  <select className="input" value={addForm.priority} onChange={(e) => setAddForm((f) => ({ ...f, priority: e.target.value as MVPPriority }))} style={{ width: "100%" }}>
                    <option value="now">🟢 NOW</option>
                    <option value="later">🟡 LATER</option>
                    <option value="omit">🔴 OMIT</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "0.8125rem", fontWeight: "600", color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>Build Effort</label>
                  <select className="input" value={addForm.effort} onChange={(e) => setAddForm((f) => ({ ...f, effort: e.target.value }))} style={{ width: "100%" }}>
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: "0.8125rem", fontWeight: "600", color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>Scope Description</label>
                <textarea className="input" rows={2} value={addForm.scope} onChange={(e) => setAddForm((f) => ({ ...f, scope: e.target.value }))} placeholder="What exactly does this feature do?" style={{ width: "100%", resize: "vertical" }} />
              </div>

              <div>
                <label style={{ fontSize: "0.8125rem", fontWeight: "600", color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>Triage Rationale</label>
                <textarea className="input" rows={2} value={addForm.rationale} onChange={(e) => setAddForm((f) => ({ ...f, rationale: e.target.value }))} placeholder="Why is this in this bucket?" style={{ width: "100%", resize: "vertical" }} />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button className="btn btn-secondary btn-sm" onClick={() => { setShowAddModal(false); setAddForm(EMPTY_FORM); setAddError(null); }}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={addLoading} id="btn-confirm-add-feature">
                {addLoading ? "Saving..." : "Add Feature"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MvpPlanPage() {
  return (
    <Suspense fallback={<div className="page-container">Loading MVP scope...</div>}>
      <MvpPlanContent />
    </Suspense>
  );
}
