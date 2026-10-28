"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { ProvenanceBadge } from "@/components/Badges";
import { useActiveProjectId, useActiveProjectMode, buildProjectPath } from "@/lib/useActiveProject";
import {
  formatCompetitorCategory,
  isDifferentiated,
  getDifferentiationMetrics,
  buildDifferentiationMarkdownTable,
} from "@/lib/competitorValidation";
import {
  generateCompetitorCsv,
  generateCompetitorJson,
  downloadFile,
  sanitizeFilename,
} from "@/lib/exportUtils";
import type { CompetitorCategory } from "@/types";

interface CompetitorRecord {
  id: string;
  project_id: string;
  name: string;
  category: CompetitorCategory;
  description: string;
  differentiator: string;
  provenance: string;
  created_at: string;
}

const CATEGORY_LABELS: Record<CompetitorCategory, string> = {
  direct: "Direct Competitor",
  indirect: "Indirect Competitor",
  substitute: "Substitute",
  status_quo: "Status Quo",
};

const CATEGORY_COLOR: Record<CompetitorCategory, string> = {
  direct: "rgba(239,68,68,0.12)",
  indirect: "rgba(245,158,11,0.12)",
  substitute: "rgba(99,102,241,0.12)",
  status_quo: "rgba(107,114,128,0.12)",
};

const CATEGORY_BORDER: Record<CompetitorCategory, string> = {
  direct: "rgba(239,68,68,0.35)",
  indirect: "rgba(245,158,11,0.35)",
  substitute: "rgba(99,102,241,0.35)",
  status_quo: "rgba(107,114,128,0.35)",
};

function AlternativesContent() {
  const projectId = useActiveProjectId();
  const projectMode = useActiveProjectMode();
  const [competitors, setCompetitors] = useState<CompetitorRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>("All");
  const [viewMode, setViewMode] = useState<"grid" | "cards">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [copyToast, setCopyToast] = useState<string | null>(null);

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAnalyzeModal, setShowAnalyzeModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Add form state
  const [addName, setAddName] = useState("");
  const [addCategory, setAddCategory] = useState<CompetitorCategory>("direct");
  const [addDescription, setAddDescription] = useState("");
  const [addDifferentiator, setAddDifferentiator] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Analyze form state
  const [analyzeCategory, setAnalyzeCategory] = useState<string>("");
  const [analyzeFocus, setAnalyzeFocus] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeFeedback, setAnalyzeFeedback] = useState<string | null>(null);

  // Edit form state
  const [editDescription, setEditDescription] = useState("");
  const [editDifferentiator, setEditDifferentiator] = useState("");

  const loadCompetitors = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/projects/${projectId}/competitors`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to load competitors");
      setCompetitors(data.data.competitors || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error loading competitors");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadCompetitors();
  }, [loadCompetitors]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addName.trim()) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/competitors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addName.trim(),
          category: addCategory,
          description: addDescription.trim(),
          differentiator: addDifferentiator.trim(),
          provenance: "USER_INPUT",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to create competitor");
      setShowAddModal(false);
      setAddName("");
      setAddDescription("");
      setAddDifferentiator("");
      await loadCompetitors();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to create competitor");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAnalyzing(true);
    setAnalyzeFeedback(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/competitors/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: analyzeCategory || undefined,
          focusArea: analyzeFocus.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Competitor analysis failed");
      const comp = data.data.competitor;
      const latency = data.data.inference?.latencyMs ? ` in ${data.data.inference.latencyMs}ms` : "";
      setAnalyzeFeedback(`Analyzed "${comp.name}" [${comp.provenance || "AI_INFERENCE"}]${latency}`);
      await loadCompetitors();
      setTimeout(() => {
        setShowAnalyzeModal(false);
        setAnalyzeFeedback(null);
      }, 1200);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const startEdit = (comp: CompetitorRecord) => {
    setEditingId(comp.id);
    setEditDescription(comp.description || "");
    setEditDifferentiator(comp.differentiator || "");
  };

  const handleUpdate = async (id: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/competitors`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          description: editDescription,
          differentiator: editDifferentiator,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to update");
      setEditingId(null);
      await loadCompetitors();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to update");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to remove this competitor record?")) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/competitors?competitorId=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to delete");
      await loadCompetitors();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const handleCopyMatrix = () => {
    const tableMd = buildDifferentiationMarkdownTable(competitors);
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(tableMd);
      setCopyToast("✓ Differentiation Matrix copied to clipboard");
      setTimeout(() => setCopyToast(null), 2500);
    }
  };

  const handleExportCsv = () => {
    const csv = generateCompetitorCsv(competitors, projectId);
    const filename = `ideaprobe-competitor-differentiation-${sanitizeFilename(projectId)}.csv`;
    downloadFile(csv, filename, "text/csv;charset=utf-8;");
    setCopyToast("✓ Competitor matrix exported as CSV");
    setTimeout(() => setCopyToast(null), 2500);
  };

  const handleExportJson = () => {
    const jsonObj = generateCompetitorJson(competitors, {
      projectId,
      mode: projectMode,
    });
    const filename = `ideaprobe-competitor-differentiation-${sanitizeFilename(projectId)}.json`;
    downloadFile(JSON.stringify(jsonObj, null, 2), filename, "application/json;charset=utf-8;");
    setCopyToast("✓ Competitor matrix exported as JSON");
    setTimeout(() => setCopyToast(null), 2500);
  };

  const diffMetrics = getDifferentiationMetrics(competitors);
  const categories: string[] = ["All", "direct", "indirect", "substitute", "status_quo"];

  const filtered = competitors.filter((c) => {
    // Gap / category filter
    if (activeFilter === "gaps") {
      if (isDifferentiated(c)) return false;
    } else if (activeFilter !== "All") {
      if (c.category !== activeFilter) return false;
    }

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchName = (c.name || "").toLowerCase().includes(q);
      const matchDesc = (c.description || "").toLowerCase().includes(q);
      const matchDiff = (c.differentiator || "").toLowerCase().includes(q);
      const matchCat =
        (c.category || "").toLowerCase().includes(q) ||
        formatCompetitorCategory(c.category).toLowerCase().includes(q);
      if (!matchName && !matchDesc && !matchDiff && !matchCat) return false;
    }

    return true;
  });

  const countByCategory: Record<CompetitorCategory, number> = {
    direct: competitors.filter((c) => c.category === "direct").length,
    indirect: competitors.filter((c) => c.category === "indirect").length,
    substitute: competitors.filter((c) => c.category === "substitute").length,
    status_quo: competitors.filter((c) => c.category === "status_quo").length,
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
            <span style={{ color: "var(--color-accent-light)" }}>Alternatives</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 style={{ fontSize: "1.75rem", fontWeight: "700", color: "var(--text-primary)" }}>
              Competitor & Alternative Mapping (F07)
            </h1>
            <span className="badge badge-accent" style={{ fontSize: "0.75rem" }}>SQLite Live</span>
          </div>
          <p style={{ color: "var(--text-secondary)", marginTop: "var(--space-1)", fontSize: "0.9rem" }}>
            Direct, indirect, substitute, and status-quo alternatives mapped against our falsifiable differentiation hypothesis.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowAnalyzeModal(true)}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            <span>⚡</span> Analyze Competitor (AI)
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setShowAddModal(true)}
          >
            + Add Competitor
          </button>
        </div>
      </div>

      {error && (
        <div className="card mb-4" style={{ padding: "var(--space-3) var(--space-4)", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--color-error)" }}>
          ⚠️ {error}
        </div>
      )}

      {/* Differentiation Coverage Metric Bar */}
      <div
        className="card mb-6"
        style={{
          padding: "var(--space-4) var(--space-5)",
          background: "linear-gradient(135deg, rgba(99,102,241,0.06) 0%, rgba(139,92,246,0.06) 100%)",
          border: "1px solid rgba(99,102,241,0.22)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "var(--space-4)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-5)", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)", fontWeight: 600 }}>
              Total Alternatives
            </div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-primary)" }}>
              {diffMetrics.total}
            </div>
          </div>
          <div style={{ width: "1px", height: "36px", background: "var(--border-color)" }} />
          <div>
            <div style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)", fontWeight: 600 }}>
              Differentiated
            </div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--color-success)" }}>
              {diffMetrics.articulated}
            </div>
          </div>
          <div style={{ width: "1px", height: "36px", background: "var(--border-color)" }} />
          <div>
            <div style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)", fontWeight: 600 }}>
              Coverage
            </div>
            <div
              style={{
                fontSize: "1.5rem",
                fontWeight: 700,
                color:
                  diffMetrics.coveragePercent >= 75
                    ? "var(--color-success)"
                    : diffMetrics.coveragePercent >= 50
                    ? "var(--color-warning)"
                    : "var(--color-error)",
              }}
            >
              {diffMetrics.coveragePercent}%
            </div>
          </div>
          <div style={{ width: "1px", height: "36px", background: "var(--border-color)" }} />
          <div>
            <div style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)", fontWeight: 600 }}>
              Differentiation Gaps
            </div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: diffMetrics.gaps > 0 ? "var(--color-warning)" : "var(--text-muted)" }}>
              {diffMetrics.gaps}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          {copyToast && (
            <span style={{ fontSize: "0.8125rem", color: "var(--color-success)", fontWeight: 500, marginRight: "var(--space-2)" }}>
              {copyToast}
            </span>
          )}
          <button
            id="copy-differentiation-matrix-btn"
            className="btn btn-secondary btn-sm"
            onClick={handleCopyMatrix}
            title="Copy differentiation matrix as Markdown table"
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            <span>📋</span> Copy Matrix (.md)
          </button>
          <button
            id="export-competitors-csv-btn"
            className="btn btn-secondary btn-sm"
            onClick={handleExportCsv}
            title="Export competitor differentiation matrix as CSV"
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            <span>📥</span> Export CSV
          </button>
          <button
            id="export-competitors-json-btn"
            className="btn btn-secondary btn-sm"
            onClick={handleExportJson}
            title="Export competitor differentiation matrix as JSON"
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            <span>📥</span> Export JSON
          </button>
        </div>
      </div>

      {/* Differentiation Gap Warning Banner */}
      {diffMetrics.gaps > 0 && (
        <div
          id="differentiation-gap-banner"
          className="card mb-4"
          style={{
            padding: "var(--space-3) var(--space-4)",
            background: "rgba(245,158,11,0.08)",
            border: "1px solid rgba(245,158,11,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "var(--space-3)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "1.25rem" }}>⚠️</span>
            <span style={{ fontSize: "0.875rem", color: "var(--text-primary)" }}>
              <strong>Differentiation Gap Alert:</strong> {diffMetrics.gaps} alternative(s) do not have an articulated differentiation advantage. Without a clear differentiator, customer inertia favors existing habits.
            </span>
          </div>
          <button
            id="filter-gaps-banner-btn"
            className="btn btn-sm"
            style={{
              fontSize: "0.75rem",
              background: activeFilter === "gaps" ? "var(--color-warning)" : "transparent",
              color: activeFilter === "gaps" ? "#000" : "var(--color-warning)",
              border: "1px solid var(--color-warning)",
            }}
            onClick={() => setActiveFilter(activeFilter === "gaps" ? "All" : "gaps")}
          >
            {activeFilter === "gaps" ? "Show All Alternatives" : "Filter Gaps Only"}
          </button>
        </div>
      )}

      {/* Category Summary Cards */}
      <div className="grid-4 mb-6" style={{ gap: "var(--space-3)" }}>
        {(["direct", "indirect", "substitute", "status_quo"] as CompetitorCategory[]).map((cat) => (
          <div
            key={cat}
            className="card"
            style={{
              padding: "var(--space-4)",
              background: CATEGORY_COLOR[cat],
              border: `1px solid ${activeFilter === cat ? "var(--color-accent-light)" : CATEGORY_BORDER[cat]}`,
              cursor: "pointer",
              transition: "transform 0.15s ease",
            }}
            onClick={() => setActiveFilter(activeFilter === cat ? "All" : cat)}
          >
            <div style={{ fontSize: "1.5rem", fontWeight: "700", color: "var(--text-primary)" }}>
              {countByCategory[cat]}
            </div>
            <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", marginTop: "2px" }}>
              {CATEGORY_LABELS[cat]}
            </div>
          </div>
        ))}
      </div>

      {/* Controls & Filter Toolbar */}
      <div className="flex justify-between items-center mb-4" style={{ flexWrap: "wrap", gap: "var(--space-3)" }}>
        <div className="flex gap-2" style={{ flexWrap: "wrap", alignItems: "center" }}>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveFilter(cat)}
              className={`btn btn-sm ${activeFilter === cat ? "btn-primary" : "btn-secondary"}`}
              style={{ fontSize: "0.75rem" }}
            >
              {cat === "All" ? "All" : CATEGORY_LABELS[cat as CompetitorCategory] || cat} (
              {cat === "All" ? competitors.length : countByCategory[cat as CompetitorCategory] || 0})
            </button>
          ))}
          <button
            id="filter-gaps-btn"
            onClick={() => setActiveFilter(activeFilter === "gaps" ? "All" : "gaps")}
            className={`btn btn-sm ${activeFilter === "gaps" ? "btn-primary" : "btn-secondary"}`}
            style={{ fontSize: "0.75rem", borderColor: "rgba(245,158,11,0.5)" }}
          >
            ⚠️ Gaps ({diffMetrics.gaps})
          </button>
        </div>

        <div className="flex gap-3 items-center" style={{ flexWrap: "wrap" }}>
          {/* Search Input */}
          <div style={{ position: "relative" }}>
            <input
              id="competitor-search-input"
              type="text"
              className="input"
              placeholder="Search alternatives or differentiator..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ fontSize: "0.8125rem", padding: "6px 28px 6px 10px", width: "240px" }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                style={{
                  position: "absolute",
                  right: "8px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* View Switcher: Grid vs Cards */}
          <div
            className="btn-group"
            style={{
              display: "inline-flex",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-color)",
              overflow: "hidden",
            }}
          >
            <button
              id="view-grid-btn"
              className={`btn btn-sm ${viewMode === "grid" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setViewMode("grid")}
              style={{ fontSize: "0.75rem", border: "none", borderRadius: 0 }}
              title="Comparative Differentiation Grid View"
            >
              📊 Grid View
            </button>
            <button
              id="view-cards-btn"
              className={`btn btn-sm ${viewMode === "cards" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setViewMode("cards")}
              style={{ fontSize: "0.75rem", border: "none", borderRadius: 0 }}
              title="Detailed Cards View"
            >
              🗂️ Cards View
            </button>
          </div>
        </div>
      </div>

      {/* Main Content: Loading / Empty / Grid / Cards */}
      {loading ? (
        <div className="card text-center" style={{ padding: "var(--space-8)", color: "var(--text-muted)" }}>
          Loading alternatives from SQLite database...
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center" style={{ padding: "var(--space-8)", color: "var(--text-muted)" }}>
          {competitors.length === 0 ? (
            <>No competitors mapped yet. Click "+ Add Competitor" or "⚡ Analyze Competitor (AI)" to begin.</>
          ) : (
            <>
              No alternatives matched your filter or search query.{" "}
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setActiveFilter("All");
                  setSearchQuery("");
                }}
                style={{ marginLeft: "8px" }}
              >
                Reset Filters
              </button>
            </>
          )}
        </div>
      ) : viewMode === "grid" ? (
        /* ─── DIFFERENTIATION GRID VIEW ─────────────────────────────────────── */
        <div
          className="card"
          style={{
            padding: 0,
            overflow: "hidden",
            border: "1px solid var(--border-color)",
          }}
        >
          <div style={{ overflowX: "auto" }}>
            <table
              id="differentiation-grid-table"
              style={{
                width: "100%",
                borderCollapse: "collapse",
                textAlign: "left",
                fontSize: "0.875rem",
              }}
            >
              <thead>
                <tr
                  style={{
                    background: "var(--color-surface-2)",
                    borderBottom: "1px solid var(--border-color)",
                    color: "var(--text-muted)",
                    fontSize: "0.75rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  <th style={{ padding: "var(--space-3) var(--space-4)", width: "22%" }}>Alternative</th>
                  <th style={{ padding: "var(--space-3) var(--space-4)", width: "16%" }}>Category</th>
                  <th style={{ padding: "var(--space-3) var(--space-4)", width: "26%" }}>Current Solution / Offer</th>
                  <th style={{ padding: "var(--space-3) var(--space-4)", width: "26%" }}>Our Differentiation Advantage</th>
                  <th style={{ padding: "var(--space-3) var(--space-4)", width: "10%", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((comp) => {
                  const isEditing = editingId === comp.id;
                  const hasDiff = isDifferentiated(comp);

                  if (isEditing) {
                    return (
                      <tr
                        key={comp.id}
                        style={{
                          background: "rgba(99,102,241,0.06)",
                          borderBottom: "1px solid var(--border-color)",
                        }}
                      >
                        <td style={{ padding: "var(--space-4)", verticalAlign: "top" }}>
                          <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>{comp.name}</div>
                          <div style={{ marginTop: "4px" }}>
                            <ProvenanceBadge type={comp.provenance as any} size="sm" />
                          </div>
                        </td>
                        <td style={{ padding: "var(--space-4)", verticalAlign: "top" }}>
                          <span
                            style={{
                              fontSize: "0.75rem",
                              padding: "2px 8px",
                              borderRadius: "var(--radius-sm)",
                              background: CATEGORY_COLOR[comp.category],
                              border: `1px solid ${CATEGORY_BORDER[comp.category]}`,
                              color: "var(--text-secondary)",
                            }}
                          >
                            {CATEGORY_LABELS[comp.category]}
                          </span>
                        </td>
                        <td style={{ padding: "var(--space-4)", verticalAlign: "top" }}>
                          <textarea
                            id={`grid-edit-desc-${comp.id}`}
                            className="input"
                            rows={3}
                            placeholder="Describe what it offers..."
                            value={editDescription}
                            onChange={(e) => setEditDescription(e.target.value)}
                            style={{ width: "100%", fontSize: "0.8125rem" }}
                          />
                        </td>
                        <td style={{ padding: "var(--space-4)", verticalAlign: "top" }}>
                          <textarea
                            id={`grid-edit-diff-${comp.id}`}
                            className="input"
                            rows={3}
                            placeholder="How does IdeaProbe win or differ fundamentally?"
                            value={editDifferentiator}
                            onChange={(e) => setEditDifferentiator(e.target.value)}
                            style={{ width: "100%", fontSize: "0.8125rem" }}
                          />
                        </td>
                        <td style={{ padding: "var(--space-4)", verticalAlign: "top", textAlign: "right" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-end" }}>
                            <button
                              id={`grid-save-btn-${comp.id}`}
                              className="btn btn-primary btn-sm"
                              onClick={() => handleUpdate(comp.id)}
                              style={{ fontSize: "0.75rem" }}
                            >
                              Save
                            </button>
                            <button
                              id={`grid-cancel-btn-${comp.id}`}
                              className="btn btn-secondary btn-sm"
                              onClick={() => setEditingId(null)}
                              style={{ fontSize: "0.75rem" }}
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr
                      key={comp.id}
                      style={{
                        borderBottom: "1px solid var(--border-color)",
                        background: !hasDiff ? "rgba(245,158,11,0.02)" : "transparent",
                        transition: "background 0.15s ease",
                      }}
                    >
                      <td style={{ padding: "var(--space-4)", verticalAlign: "top" }}>
                        <div style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: "0.9375rem" }}>
                          {comp.name}
                        </div>
                        <div style={{ marginTop: "4px" }}>
                          <ProvenanceBadge type={comp.provenance as any} size="sm" />
                        </div>
                      </td>
                      <td style={{ padding: "var(--space-4)", verticalAlign: "top" }}>
                        <span
                          style={{
                            fontSize: "0.75rem",
                            padding: "2px 8px",
                            borderRadius: "var(--radius-sm)",
                            background: CATEGORY_COLOR[comp.category],
                            border: `1px solid ${CATEGORY_BORDER[comp.category]}`,
                            color: "var(--text-secondary)",
                            display: "inline-block",
                          }}
                        >
                          {CATEGORY_LABELS[comp.category]}
                        </span>
                      </td>
                      <td style={{ padding: "var(--space-4)", verticalAlign: "top", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                        {comp.description || (
                          <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                            No description provided.
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "var(--space-4)", verticalAlign: "top" }}>
                        {hasDiff ? (
                          <div
                            style={{
                              padding: "8px 12px",
                              borderRadius: "var(--radius-sm)",
                              background: "rgba(99,102,241,0.06)",
                              border: "1px solid rgba(99,102,241,0.2)",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                              <span style={{ fontSize: "0.7rem", color: "var(--color-success)", fontWeight: 600 }}>
                                ✓ ARTICULATED
                              </span>
                            </div>
                            <div style={{ color: "var(--text-primary)", lineHeight: 1.5, fontSize: "0.85rem" }}>
                              {comp.differentiator}
                            </div>
                          </div>
                        ) : (
                          <div
                            style={{
                              padding: "8px 12px",
                              borderRadius: "var(--radius-sm)",
                              background: "rgba(245,158,11,0.08)",
                              border: "1px dashed rgba(245,158,11,0.35)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: "8px",
                            }}
                          >
                            <span style={{ color: "var(--color-warning)", fontSize: "0.8125rem", fontWeight: 500 }}>
                              ⚠️ Gap — Unspecified
                            </span>
                            <button
                              id={`grid-define-btn-${comp.id}`}
                              className="btn btn-secondary btn-sm"
                              onClick={() => startEdit(comp)}
                              style={{ fontSize: "0.7rem", padding: "2px 8px" }}
                            >
                              + Define
                            </button>
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "var(--space-4)", verticalAlign: "top", textAlign: "right" }}>
                        <div style={{ display: "flex", gap: "4px", justifyContent: "flex-end" }}>
                          <button
                            id={`grid-edit-btn-${comp.id}`}
                            className="btn btn-secondary btn-sm"
                            onClick={() => startEdit(comp)}
                            style={{ fontSize: "0.75rem", padding: "4px 8px" }}
                            title="Edit alternative"
                          >
                            Edit
                          </button>
                          <button
                            id={`grid-delete-btn-${comp.id}`}
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleDelete(comp.id)}
                            style={{ fontSize: "0.75rem", padding: "4px 8px", color: "var(--color-error)" }}
                            title="Delete alternative"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* ─── CARDS VIEW ─────────────────────────────────────────────────────── */
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {filtered.map((comp) => {
            const isEditing = editingId === comp.id;
            const hasDiff = isDifferentiated(comp);

            return (
              <div
                key={comp.id}
                className="card"
                style={{
                  padding: "var(--space-5)",
                  border: `1px solid ${CATEGORY_BORDER[comp.category]}`,
                  borderLeft: `4px solid ${CATEGORY_BORDER[comp.category].replace("0.35", "0.85")}`,
                }}
              >
                <div className="flex justify-between items-center mb-3" style={{ flexWrap: "wrap", gap: "var(--space-2)" }}>
                  <div className="flex items-center gap-3" style={{ flexWrap: "wrap" }}>
                    <h3 style={{ fontSize: "1.05rem", fontWeight: "600", color: "var(--text-primary)" }}>
                      {comp.name}
                    </h3>
                    <span
                      style={{
                        fontSize: "0.75rem",
                        padding: "2px 8px",
                        borderRadius: "var(--radius-sm)",
                        background: CATEGORY_COLOR[comp.category],
                        border: `1px solid ${CATEGORY_BORDER[comp.category]}`,
                        color: "var(--text-secondary)",
                      }}
                    >
                      {CATEGORY_LABELS[comp.category]}
                    </span>
                    <ProvenanceBadge type={comp.provenance as any} size="sm" />
                    {hasDiff ? (
                      <span className="badge badge-success" style={{ fontSize: "0.7rem" }}>
                        ✓ Articulated
                      </span>
                    ) : (
                      <span className="badge badge-warning" style={{ fontSize: "0.7rem" }}>
                        ⚠️ Gap
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {isEditing ? (
                      <>
                        <button className="btn btn-primary btn-sm" onClick={() => handleUpdate(comp.id)}>
                          Save
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-secondary btn-sm" onClick={() => startEdit(comp)} style={{ fontSize: "0.75rem" }}>
                          Edit
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleDelete(comp.id)}
                          style={{ fontSize: "0.75rem", color: "var(--color-error)" }}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {isEditing ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", marginBottom: "var(--space-3)" }}>
                    <div>
                      <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
                        Description:
                      </label>
                      <textarea
                        className="input"
                        rows={3}
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        style={{ width: "100%", fontSize: "0.875rem" }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
                        Our Differentiation:
                      </label>
                      <textarea
                        className="input"
                        rows={2}
                        value={editDifferentiator}
                        onChange={(e) => setEditDifferentiator(e.target.value)}
                        style={{ width: "100%", fontSize: "0.875rem" }}
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginBottom: "var(--space-4)", lineHeight: 1.6 }}>
                      {comp.description || "No description provided."}
                    </p>

                    <div
                      style={{
                        padding: "var(--space-3) var(--space-4)",
                        borderRadius: "var(--radius-md)",
                        background: hasDiff ? "rgba(99,102,241,0.06)" : "rgba(245,158,11,0.06)",
                        border: `1px solid ${hasDiff ? "rgba(99,102,241,0.18)" : "rgba(245,158,11,0.25)"}`,
                        fontSize: "0.875rem",
                      }}
                    >
                      <div
                        style={{
                          color: hasDiff ? "var(--color-accent-light)" : "var(--color-warning)",
                          fontSize: "0.75rem",
                          marginBottom: "4px",
                          fontWeight: 600,
                        }}
                      >
                        {hasDiff ? "OUR DIFFERENTIATION ADVANTAGE" : "⚠️ DIFFERENTIATION GAP"}
                      </div>
                      <div style={{ color: "var(--text-primary)" }}>
                        {comp.differentiator || (
                          <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                            Not specified. Click &quot;Edit&quot; to articulate how IdeaProbe wins.
                          </span>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Strategic Positioning Note */}
      <div className="card mt-6" style={{ padding: "var(--space-5)", background: "var(--color-surface-2)" }}>
        <h3 style={{ fontSize: "0.9375rem", fontWeight: "600", color: "var(--text-primary)", marginBottom: "var(--space-2)" }}>
          📌 Strategic Positioning Rule
        </h3>
        <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
          The true competitor is the <strong>paper timetable, WhatsApp group, or current habit</strong> (status quo) — not competing SaaS apps. 
          Any new tool must be adopted by habit displacement, not feature comparison. 
          Zero-friction onboarding and forgiveness-by-default design are table stakes before any feature differentiation matters.
        </p>
      </div>

      {/* Add Competitor Modal */}
      {showAddModal && (
        <div className="modal-backdrop" onClick={() => !isSubmitting && setShowAddModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "540px" }}>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: "var(--space-4)" }}>
              + Add Competitor or Alternative
            </h3>
            <form onSubmit={handleCreate}>
              <div className="mb-4">
                <label className="label">Name *</label>
                <input
                  type="text"
                  className="input"
                  required
                  placeholder="e.g. Notion Study Template, Excel, WhatsApp"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>

              <div className="mb-4">
                <label className="label">Category *</label>
                <select
                  className="input"
                  value={addCategory}
                  onChange={(e) => setAddCategory(e.target.value as CompetitorCategory)}
                  style={{ width: "100%" }}
                >
                  <option value="direct">Direct Competitor (Same solution & audience)</option>
                  <option value="indirect">Indirect Competitor (Different solution, same audience)</option>
                  <option value="substitute">Substitute (Workaround / generic tool)</option>
                  <option value="status_quo">Status Quo (No action, paper, spreadsheet)</option>
                </select>
              </div>

              <div className="mb-4">
                <label className="label">Description</label>
                <textarea
                  className="input"
                  rows={3}
                  placeholder="What does it offer and why do customers currently use it?"
                  value={addDescription}
                  onChange={(e) => setAddDescription(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>

              <div className="mb-5">
                <label className="label">Differentiation Hypothesis</label>
                <textarea
                  className="input"
                  rows={2}
                  placeholder="How does IdeaProbe win or differ fundamentally?"
                  value={addDifferentiator}
                  onChange={(e) => setAddDifferentiator(e.target.value)}
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
                <button type="submit" className="btn btn-primary" disabled={isSubmitting || !addName.trim()}>
                  {isSubmitting ? "Saving..." : "Save Competitor"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AI Competitor Analysis Modal */}
      {showAnalyzeModal && (
        <div className="modal-backdrop" onClick={() => !isAnalyzing && setShowAnalyzeModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "540px" }}>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: "var(--space-2)" }}>
              ⚡ AI Competitor Discovery
            </h3>
            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "var(--space-4)" }}>
              Runs structured Ollama inference using project idea brief and reviewed evidence to identify market alternatives. (Falls back to deterministic SAMPLE if Ollama is offline).
            </p>

            {analyzeFeedback ? (
              <div className="card" style={{ padding: "var(--space-4)", background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", color: "var(--color-success)" }}>
                ✅ {analyzeFeedback}
              </div>
            ) : (
              <form onSubmit={handleAnalyze}>
                <div className="mb-4">
                  <label className="label">Category Target (Optional)</label>
                  <select
                    className="input"
                    value={analyzeCategory}
                    onChange={(e) => setAnalyzeCategory(e.target.value)}
                    style={{ width: "100%" }}
                  >
                    <option value="">Auto-detect most critical gap</option>
                    <option value="direct">Direct Competitor</option>
                    <option value="indirect">Indirect Competitor</option>
                    <option value="substitute">Substitute</option>
                    <option value="status_quo">Status Quo</option>
                  </select>
                </div>

                <div className="mb-5">
                  <label className="label">Focus Area / Prompt Hint (Optional)</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. mobile notifications, study timer, calendar sync"
                    value={analyzeFocus}
                    onChange={(e) => setAnalyzeFocus(e.target.value)}
                    style={{ width: "100%" }}
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={isAnalyzing}
                    onClick={() => setShowAnalyzeModal(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={isAnalyzing}>
                    {isAnalyzing ? "Analyzing with Ollama..." : "Run Analysis"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AlternativesPage() {
  return (
    <Suspense fallback={<div className="page-container">Loading alternatives...</div>}>
      <AlternativesContent />
    </Suspense>
  );
}
