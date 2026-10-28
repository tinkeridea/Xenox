"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { StageList } from "@/components/StageList";
import { FixtureBadge, ProvenanceBadge, StatusDot } from "@/components/Badges";
import { DEMO_PROJECT, DEMO_RUN, DEMO_STAGES } from "@/lib/mockData";
import { useActiveProjectId, useActiveProjectMode, buildProjectPath, KNOWN_PROJECT_TITLES } from "@/lib/useActiveProject";
import type { Stage, StageKey } from "@/types";

interface ProjectCounts {
  evidence_count: number;
  source_count: number;
  competitor_count: number;
  persona_count: number;
  interview_count: number;
  insight_count: number;
  assumption_count: number;
  experiment_count: number;
  mvp_count: number;
}

interface ProjectBrief {
  problem: string;
  target_customer: string;
  solution: string;
  geography: string;
  category: string;
  stage: string;
}

function OverviewContent({ initialProjectId }: { initialProjectId?: string }) {
  const projectId = useActiveProjectId(initialProjectId);
  const projectMode = useActiveProjectMode(initialProjectId);
  const isDemo = projectId === "proj-study-planner";

  const [projectTitle, setProjectTitle] = useState(
    isDemo ? DEMO_PROJECT.title : (KNOWN_PROJECT_TITLES[projectId] || `Project ${projectId}`)
  );
  const [brief, setBrief] = useState<ProjectBrief>(() => ({
    problem: isDemo ? DEMO_PROJECT.problem : "",
    target_customer: isDemo ? DEMO_PROJECT.targetCustomer : "",
    solution: isDemo ? DEMO_PROJECT.solution : "",
    geography: isDemo ? (DEMO_PROJECT.geography || "India") : "",
    category: isDemo ? (DEMO_PROJECT.category || "EdTech") : "",
    stage: isDemo ? (DEMO_PROJECT.stage || "Idea / Problem Validation") : "",
  }));

  const [counts, setCounts] = useState<ProjectCounts>(() => (
    isDemo ? {
      evidence_count: 4,
      source_count: 4,
      competitor_count: 5,
      persona_count: 2,
      interview_count: 2,
      insight_count: 4,
      assumption_count: 4,
      experiment_count: 2,
      mvp_count: 7,
    } : {
      evidence_count: 0,
      source_count: 0,
      competitor_count: 0,
      persona_count: 0,
      interview_count: 0,
      insight_count: 0,
      assumption_count: 0,
      experiment_count: 0,
      mvp_count: 0,
    }
  ));

  const [stages, setStages] = useState<Stage[]>(() => isDemo ? DEMO_STAGES : []);
  const [runStatus, setRunStatus] = useState<string>(isDemo ? DEMO_RUN.status : "queued");
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  // Edit Brief Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editProblem, setEditProblem] = useState("");
  const [editTargetCustomer, setEditTargetCustomer] = useState("");
  const [editSolution, setEditSolution] = useState("");
  const [editGeography, setEditGeography] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editStage, setEditStage] = useState("");
  const [isSavingBrief, setIsSavingBrief] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [saveSuccessFeedback, setSaveSuccessFeedback] = useState<string | null>(null);

  const openEditModal = () => {
    setEditTitle(projectTitle);
    setEditProblem(brief.problem);
    setEditTargetCustomer(brief.target_customer);
    setEditSolution(brief.solution || "");
    setEditGeography(brief.geography || "");
    setEditCategory(brief.category || "");
    setEditStage(brief.stage || "");
    setEditError(null);
    setIsEditModalOpen(true);
  };

  // Load live project metadata and entity counts from SQLite
  const loadProjectOverview = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
      if (res.status === 404) {
        setNotFound(true);
        setProjectTitle(`Project Not Found (${projectId})`);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const p = json.data?.project;
      const b = json.data?.brief;
      const c = json.data?.counts;

      if (p?.title) setProjectTitle(p.title);
      if (b) {
        setBrief({
          problem: b.problem || (projectId === "proj-study-planner" ? DEMO_PROJECT.problem : ""),
          target_customer: b.target_customer || (projectId === "proj-study-planner" ? DEMO_PROJECT.targetCustomer : ""),
          solution: b.solution || (projectId === "proj-study-planner" ? DEMO_PROJECT.solution : ""),
          geography: b.geography || (projectId === "proj-study-planner" ? "India" : ""),
          category: b.category || (projectId === "proj-study-planner" ? "EdTech" : ""),
          stage: b.stage || (projectId === "proj-study-planner" ? "Idea / Problem Validation" : ""),
        });
      }

      if (c) {
        const liveCounts: ProjectCounts = {
          evidence_count: Number(c.evidence_count || 0),
          source_count: Number(c.source_count || 0),
          competitor_count: Number(c.competitor_count || 0),
          persona_count: Number(c.persona_count || 0),
          interview_count: Number(c.interview_count || 0),
          insight_count: Number(c.insight_count || 0),
          assumption_count: Number(c.assumption_count || 0),
          experiment_count: Number(c.experiment_count || 0),
          mvp_count: Number(c.mvp_count || 0),
        };
        setCounts(liveCounts);
        // Fetch persisted, reconciled stages directly from SQLite (Phase 3J)
        try {
          const stagesRes = await fetch(`/api/projects/${encodeURIComponent(projectId)}/stages`);
          if (stagesRes.ok) {
            const stagesJson = await stagesRes.json();
            if (stagesJson.data?.stages && Array.isArray(stagesJson.data.stages)) {
              setStages(stagesJson.data.stages);
              if (stagesJson.data.runStatus) {
                setRunStatus(stagesJson.data.runStatus);
              }
            }
          }
        } catch (stgErr) {
          console.warn("Failed to load reconciled stages from SQLite:", stgErr);
        }
      }
    } catch (err) {
      console.error("Failed to load live overview:", err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadProjectOverview();
  }, [loadProjectOverview]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isEditModalOpen && !isSavingBrief) {
        setIsEditModalOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isEditModalOpen, isSavingBrief]);

  const handleSaveBrief = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTitle.trim()) {
      setEditError("Project Title is required.");
      return;
    }
    if (!editProblem.trim()) {
      setEditError("Problem Statement is required.");
      return;
    }
    if (!editTargetCustomer.trim()) {
      setEditError("Target Customer is required.");
      return;
    }

    setIsSavingBrief(true);
    setEditError(null);

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle.trim(),
          problem: editProblem.trim(),
          target_customer: editTargetCustomer.trim(),
          solution: editSolution.trim(),
          geography: editGeography.trim(),
          category: editCategory.trim(),
          stage: editStage.trim(),
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.error?.message || `Failed to update project brief (HTTP ${res.status})`);
      }

      setIsEditModalOpen(false);
      setSaveSuccessFeedback("Project brief updated successfully!");
      setTimeout(() => setSaveSuccessFeedback(null), 3500);
      await loadProjectOverview();
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : "Failed to update project brief");
    } finally {
      setIsSavingBrief(false);
    }
  };

  const completedStagesCount = stages.filter((s) => s.status === "completed").length;

  return (
    <div className="page-container animate-fade-in">
      {/* Header breadcrumb & title */}
      <div className="flex justify-between items-center mb-6" style={{ flexWrap: "wrap", gap: "var(--space-3)" }}>
        <div>
          <div className="flex items-center gap-2 mb-2" style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            <Link href="/" style={{ color: "var(--text-muted)", textDecoration: "none" }}>Dashboard</Link>
            <span>/</span>
            <span>Active Project</span>
            <span>/</span>
            <span style={{ color: "var(--color-accent-light)" }}>Run Overview</span>
          </div>

          <div className="flex items-center gap-3">
            <h1 style={{ fontSize: "1.75rem", fontWeight: "700", color: "var(--text-primary)" }}>
              {projectTitle}
            </h1>
            <FixtureBadge mode={projectMode} />
          </div>
        </div>

        <div className="flex items-center gap-3" style={{ flexWrap: "wrap" }}>
          <button className="btn btn-secondary btn-sm" onClick={loadProjectOverview} title="Sync status with SQLite">
            ↻ Sync SQLite
          </button>
          <Link href={buildProjectPath("/report", projectId)} className="btn btn-primary" id="btn-view-report">
            📄 View Unified Report
          </Link>
          <Link href="/new" className="btn btn-secondary">
            ✨ New Project
          </Link>
        </div>
      </div>

      {notFound && (
        <div className="card text-center mb-6" style={{ padding: "var(--space-8)", border: "1px solid var(--color-error)", background: "rgba(239,68,68,0.06)" }}>
          <div style={{ fontSize: "2rem", marginBottom: "8px" }}>⚠️</div>
          <h2 style={{ fontSize: "1.25rem", color: "var(--text-primary)", marginBottom: "8px" }}>
            Project Not Found ({projectId})
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem", marginBottom: "var(--space-4)" }}>
            The requested project does not exist in the database. Select an existing project from the Dashboard or create a new validation project.
          </p>
          <Link href="/" className="btn btn-primary btn-sm">
            ← Return to Dashboard
          </Link>
        </div>
      )}

      {/* Project Meta Card */}
      <div
        className="card mb-6"
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          padding: "var(--space-5)",
        }}
      >
        <div className="flex justify-between items-center mb-3" style={{ flexWrap: "wrap", gap: "var(--space-2)" }}>
          <div className="flex items-center gap-3">
            <span style={{ fontSize: "1.25rem" }}>💡</span>
            <span style={{ fontSize: "0.875rem", fontWeight: "600", color: "var(--text-primary)" }}>
              Venture Hypotheses &amp; Baseline Intake (F01)
            </span>
            <ProvenanceBadge type="USER_INPUT" size="sm" />
          </div>

          <div className="flex items-center gap-3">
            <StatusDot status={(runStatus as any) || (projectId === "proj-study-planner" ? DEMO_RUN.status : "queued")} label="Pipeline Status" />
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
              Project: {projectId}
            </span>
            <button
              id="edit-brief-btn"
              className="btn btn-secondary btn-sm"
              style={{ fontSize: "0.75rem", padding: "3px 10px", display: "inline-flex", alignItems: "center", gap: "5px" }}
              onClick={openEditModal}
              title="Edit project brief"
            >
              <span>✏️</span> Edit Brief
            </button>
          </div>
        </div>

        {saveSuccessFeedback && (
          <div
            className="card mb-3"
            style={{
              background: "rgba(34,197,94,0.1)",
              border: "1px solid rgba(34,197,94,0.3)",
              color: "var(--color-success)",
              padding: "var(--space-2) var(--space-3)",
              fontSize: "0.85rem",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span>✅</span> {saveSuccessFeedback}
          </div>
        )}

        <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginBottom: "var(--space-4)", lineHeight: "1.5" }}>
          {brief.problem || "No problem statement recorded yet."}
        </p>

        <div className="grid-3" style={{ gap: "var(--space-3)", borderTop: "1px solid var(--color-border)", paddingTop: "var(--space-3)" }}>
          <div style={{ fontSize: "0.8125rem" }}>
            <span style={{ color: "var(--text-muted)" }}>Target Customer: </span>
            <strong style={{ color: "var(--text-primary)" }}>{brief.target_customer || "Not specified"}</strong>
          </div>
          <div style={{ fontSize: "0.8125rem" }}>
            <span style={{ color: "var(--text-muted)" }}>Target Market: </span>
            <strong style={{ color: "var(--text-primary)" }}>{brief.geography || "Not specified"}</strong>
          </div>
          <div style={{ fontSize: "0.8125rem" }}>
            <span style={{ color: "var(--text-muted)" }}>Industry / Stage: </span>
            <strong style={{ color: "var(--text-primary)" }}>{brief.category || "General"} • {brief.stage || "Validation"}</strong>
          </div>
        </div>
      </div>

      {/* Live Entity Count Badges */}
      <div className="grid-4 mb-6" style={{ gap: "var(--space-3)" }}>
        <Link href={buildProjectPath("/research", projectId)} style={{ textDecoration: "none" }}>
          <div className="card" style={{ padding: "var(--space-4)", cursor: "pointer", transition: "all 0.15s ease" }}>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Evidence &amp; Sources</div>
            <div style={{ fontSize: "1.5rem", fontWeight: "700", color: "var(--text-primary)" }}>
              {counts.evidence_count} <span style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: "normal" }}>items</span>
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--color-accent-light)" }}>
              {counts.source_count} registered sources →
            </div>
          </div>
        </Link>

        <Link href={buildProjectPath("/personas", projectId)} style={{ textDecoration: "none" }}>
          <div className="card" style={{ padding: "var(--space-4)", cursor: "pointer", transition: "all 0.15s ease" }}>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Persona Hypotheses</div>
            <div style={{ fontSize: "1.5rem", fontWeight: "700", color: "var(--text-primary)" }}>
              {counts.persona_count} <span style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: "normal" }}>drafts</span>
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--color-accent-light)" }}>
              {counts.interview_count} simulated interviews →
            </div>
          </div>
        </Link>

        <Link href={buildProjectPath("/insights", projectId)} style={{ textDecoration: "none" }}>
          <div className="card" style={{ padding: "var(--space-4)", cursor: "pointer", transition: "all 0.15s ease" }}>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Synthesized Insights</div>
            <div style={{ fontSize: "1.5rem", fontWeight: "700", color: "var(--text-primary)" }}>
              {counts.insight_count} <span style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: "normal" }}>patterns</span>
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--color-accent-light)" }}>
              Ollama AI_INFERENCE ready →
            </div>
          </div>
        </Link>

        <Link href={buildProjectPath("/mvp", projectId)} style={{ textDecoration: "none" }}>
          <div className="card" style={{ padding: "var(--space-4)", cursor: "pointer", transition: "all 0.15s ease" }}>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>MVP Features &amp; Risks</div>
            <div style={{ fontSize: "1.5rem", fontWeight: "700", color: "var(--text-primary)" }}>
              {counts.mvp_count} <span style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: "normal" }}>features</span>
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--color-accent-light)" }}>
              {counts.assumption_count} assumptions · {counts.experiment_count} tests →
            </div>
          </div>
        </Link>
      </div>

      {/* Notice on Simulation Integrity (D03 / D04) */}
      <div
        className="card mb-6"
        style={{
          background: "rgba(167,139,250,0.06)",
          border: "1px solid rgba(167,139,250,0.2)",
          padding: "var(--space-4) var(--space-5)",
        }}
      >
        <div className="flex items-center gap-3">
          <span style={{ fontSize: "1.25rem" }}>🛡️</span>
          <div>
            <div style={{ fontSize: "0.875rem", fontWeight: "600", color: "var(--badge-simulation)" }}>
              IdeaProbe Provenance Guarantee (Decisions D03 &amp; D04)
            </div>
            <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", marginTop: "2px" }}>
              Simulated interviews and personas are speculative stress-testing tools. They do <strong>not</strong> count as customer evidence or proof of demand. All items below are labeled with their origin.
            </p>
          </div>
        </div>
      </div>

      {/* Pipeline Stage List */}
      <div className="mb-8">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 style={{ fontSize: "1.25rem", fontWeight: "600", color: "var(--text-primary)" }}>
              Validation Pipeline Stages
            </h2>
            <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
              Click any stage to expand details or jump directly to its dedicated analysis screen.
            </p>
          </div>

          <span style={{ fontSize: "0.75rem", color: "var(--color-success)", background: "rgba(34,197,94,0.1)", padding: "3px 8px", borderRadius: "4px" }}>
            {completedStagesCount} / 10 Stages Ready
          </span>
        </div>

        <StageList stages={stages} projectId={projectId} />
      </div>

      {/* Edit Project Brief Modal */}
      {isEditModalOpen && (
        <div
          className="modal-backdrop"
          onClick={() => !isSavingBrief && setIsEditModalOpen(false)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.7)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "var(--space-4)",
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-brief-modal-title"
        >
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-lg)",
              padding: "var(--space-6)",
              maxWidth: "620px",
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 20px 40px rgba(0, 0, 0, 0.4)",
            }}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 id="edit-brief-modal-title" style={{ fontSize: "1.25rem", fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>
                ✏️ Edit Project Brief
              </h3>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => !isSavingBrief && setIsEditModalOpen(false)}
                disabled={isSavingBrief}
                style={{ fontSize: "1.1rem", padding: "2px 8px" }}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "var(--space-4)" }}>
              Update the core problem, customer segment, and solution parameters for <strong>{projectId}</strong>. Changes update the latest brief and refresh project overview.
            </p>

            {editError && (
              <div
                className="card mb-4"
                style={{
                  background: "rgba(239,68,68,0.1)",
                  border: "1px solid rgba(239,68,68,0.3)",
                  color: "var(--color-error)",
                  padding: "var(--space-3) var(--space-4)",
                  fontSize: "0.85rem",
                }}
              >
                ⚠️ {editError}
              </div>
            )}

            <form onSubmit={handleSaveBrief}>
              <div className="mb-4">
                <label className="form-label" htmlFor="edit-brief-title">
                  Project Title <span className="form-label-required">*</span>
                </label>
                <input
                  id="edit-brief-title"
                  type="text"
                  className="form-input"
                  required
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="e.g. CampusCourier"
                />
              </div>

              <div className="mb-4">
                <label className="form-label" htmlFor="edit-brief-problem">
                  Problem Statement <span className="form-label-required">*</span>
                </label>
                <textarea
                  id="edit-brief-problem"
                  className="form-textarea"
                  required
                  rows={3}
                  value={editProblem}
                  onChange={(e) => setEditProblem(e.target.value)}
                  placeholder="What friction, pain point, or unmet need are you solving?"
                  style={{ minHeight: "80px" }}
                />
              </div>

              <div className="mb-4">
                <label className="form-label" htmlFor="edit-brief-target-customer">
                  Target Customer <span className="form-label-required">*</span>
                </label>
                <input
                  id="edit-brief-target-customer"
                  type="text"
                  className="form-input"
                  required
                  value={editTargetCustomer}
                  onChange={(e) => setEditTargetCustomer(e.target.value)}
                  placeholder="e.g. University hostel residents ordering parcels"
                />
              </div>

              <div className="mb-4">
                <label className="form-label" htmlFor="edit-brief-solution">
                  Proposed Solution / Value Proposition <span className="form-label-optional">(Optional)</span>
                </label>
                <textarea
                  id="edit-brief-solution"
                  className="form-textarea"
                  rows={2}
                  value={editSolution}
                  onChange={(e) => setEditSolution(e.target.value)}
                  placeholder="e.g. Peer-to-peer delivery concierge network"
                  style={{ minHeight: "60px" }}
                />
              </div>

              <div className="grid-3 mb-5" style={{ gap: "var(--space-3)" }}>
                <div>
                  <label className="form-label" htmlFor="edit-brief-geography">
                    Target Market / Geography
                  </label>
                  <input
                    id="edit-brief-geography"
                    type="text"
                    className="form-input"
                    value={editGeography}
                    onChange={(e) => setEditGeography(e.target.value)}
                    placeholder="e.g. India"
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="edit-brief-category">
                    Category / Industry
                  </label>
                  <input
                    id="edit-brief-category"
                    type="text"
                    className="form-input"
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    placeholder="e.g. Logistics"
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="edit-brief-stage">
                    Validation Stage
                  </label>
                  <input
                    id="edit-brief-stage"
                    type="text"
                    className="form-input"
                    value={editStage}
                    onChange={(e) => setEditStage(e.target.value)}
                    placeholder="e.g. Problem Validation"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2" style={{ borderTop: "1px solid var(--color-border)", paddingTop: "var(--space-4)" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={isSavingBrief}
                  onClick={() => setIsEditModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSavingBrief || !editTitle.trim() || !editProblem.trim() || !editTargetCustomer.trim()}
                >
                  {isSavingBrief ? "Saving Changes..." : "Save Brief"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OverviewPage({ initialProjectId }: { initialProjectId?: string } = {}) {
  return (
    <Suspense fallback={<div className="page-container">Loading project overview...</div>}>
      <OverviewContent initialProjectId={initialProjectId} />
    </Suspense>
  );
}
