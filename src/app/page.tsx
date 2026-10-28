"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ProvenanceBadge, StatusDot } from "@/components/Badges";
import { DEMO_PROJECTS_LIST, DEMO_RUN } from "@/lib/mockData";
import type { Project } from "@/types";

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>(DEMO_PROJECTS_LIST);
  const [filterCategory, setFilterCategory] = useState<string>("All");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [deleteStatus, setDeleteStatus] = useState<string | null>(null);

  const fetchProjects = async () => {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const json = await res.json();
        if (json.data && Array.isArray(json.data) && json.data.length > 0) {
          const mapped: Project[] = json.data.map((r: any) => ({
            id: r.id,
            title: r.title,
            problem: r.problem || "",
            targetCustomer: r.target_customer || "",
            solution: r.solution || "",
            category: r.category || "General",
            geography: r.geography || "",
            stage: r.idea_stage || "Idea",
            status: r.status || "active",
            mode: r.mode || "LIVE",
            provenance: (r.provenance as any) || (r.mode === "DEMO" ? "SAMPLE" : "USER_INPUT"),
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          }));
          setProjects(mapped);
        }
      }
    } catch (err) {
      console.warn("Could not fetch projects from API, falling back to mock fixtures:", err);
    } finally {
      setIsLoading(false);
    }
  };

  React.useEffect(() => {
    fetchProjects();
  }, []);

  const handleDeleteProject = async (id: string, title: string) => {
    if (!window.confirm(`Permanently delete "${title}" and all associated runs, evidence, and artifacts? (Decision D08 cascade delete)`)) {
      return;
    }
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (res.ok) {
        setDeleteStatus(`Deleted "${title}".`);
        setTimeout(() => setDeleteStatus(null), 4000);
        fetchProjects();
      } else {
        alert("Failed to delete project.");
      }
    } catch {
      alert("Error deleting project.");
    }
  };

  const categories = ["All", ...Array.from(new Set(projects.map((p) => p.category).filter(Boolean)))];

  const filteredProjects =
    filterCategory === "All"
      ? projects
      : projects.filter((p) => p.category === filterCategory);

  return (
    <div className="page-container animate-fade-in">
      {deleteStatus && (
        <div
          style={{
            background: "rgba(239, 68, 68, 0.12)",
            border: "1px solid var(--color-error)",
            color: "var(--color-error)",
            padding: "var(--space-3) var(--space-4)",
            borderRadius: "var(--radius-md)",
            marginBottom: "var(--space-4)",
            fontSize: "0.875rem",
          }}
        >
          🗑️ {deleteStatus}
        </div>
      )}
      {/* Top Welcome / Header */}
      <div className="flex justify-between items-center" style={{ flexWrap: "wrap", gap: "var(--space-4)", marginBottom: "var(--space-6)" }}>
        <div>
          <div className="flex items-center gap-3">
            <h1 style={{ fontSize: "1.75rem", fontWeight: "700", color: "var(--text-primary)" }}>
              IdeaProbe Workspace
            </h1>
          </div>
          <p style={{ color: "var(--text-secondary)", marginTop: "var(--space-1)", fontSize: "0.9375rem" }}>
            Turn assumptions into falsifiable tests before committing code or capital.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/new" className="btn btn-primary" id="btn-new-validation">
            <span aria-hidden="true">✨</span> Start New Validation
          </Link>
          <Link href="/overview" className="btn btn-secondary" id="btn-demo-run">
            <span aria-hidden="true">🎯</span> View Active Demo Run
          </Link>
        </div>
      </div>

      {/* Provider & Health Status Card */}
      <div
        className="card"
        style={{
          background: "linear-gradient(135deg, rgba(22,29,46,0.9), rgba(17,22,34,0.9))",
          border: "1px solid var(--color-border)",
          padding: "var(--space-4) var(--space-5)",
          marginBottom: "var(--space-6)",
        }}
      >
        <div className="flex justify-between items-center" style={{ flexWrap: "wrap", gap: "var(--space-3)" }}>
          <div className="flex items-center gap-3">
            <span style={{ fontSize: "1.25rem" }} aria-hidden="true">⚡</span>
            <div>
              <div style={{ fontSize: "0.875rem", fontWeight: "600", color: "var(--text-primary)" }}>
                Local Inference &amp; Provenance Engine
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                Model Target: <code className="font-mono">qwen3.5:4b</code> (CPU/Local) • Research: Live TinyFish (api.search.tinyfish.ai) / Sample Fallback
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              style={{
                fontSize: "0.75rem",
                padding: "3px 8px",
                borderRadius: "var(--radius-sm)",
                background: "rgba(34,197,94,0.12)",
                color: "var(--color-success)",
                border: "1px solid rgba(34,197,94,0.25)",
              }}
            >
              ● Phase 1 Shell Active
            </span>
            <span
              style={{
                fontSize: "0.75rem",
                padding: "3px 8px",
                borderRadius: "var(--radius-sm)",
                background: "rgba(99,102,241,0.12)",
                color: "var(--color-accent-light)",
                border: "1px solid rgba(99,102,241,0.25)",
              }}
            >
              Zero-Cloud Privacy
            </span>
          </div>
        </div>
      </div>

      {/* Key Metric Summary Cards */}
      <div className="grid-3" style={{ marginBottom: "var(--space-8)" }}>
        <div className="card" style={{ padding: "var(--space-4)" }}>
          <div className="flex justify-between items-center mb-2">
            <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)", fontWeight: "500" }}>SAVED PROJECTS</span>
            <span style={{ fontSize: "1.1rem" }}>📁</span>
          </div>
          <div style={{ fontSize: "1.75rem", fontWeight: "700", color: "var(--text-primary)" }}>
            {projects.length}
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "var(--space-1)" }}>
            {(() => {
              const demoCount = projects.filter((p) => p.mode === "DEMO").length;
              const liveCount = projects.filter((p) => p.mode === "LIVE").length;
              const parts: string[] = [];
              if (demoCount > 0) parts.push(`${demoCount} demo fixture${demoCount === 1 ? "" : "s"}`);
              if (liveCount > 0) parts.push(`${liveCount} live project${liveCount === 1 ? "" : "s"}`);
              const otherCount = projects.length - demoCount - liveCount;
              if (otherCount > 0) parts.push(`${otherCount} other`);
              return parts.length > 0 ? parts.join(", ") : "No saved projects";
            })()}
          </div>
        </div>

        <div className="card" style={{ padding: "var(--space-4)" }}>
          <div className="flex justify-between items-center mb-2">
            <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)", fontWeight: "500" }}>PIPELINE COMPLETION</span>
            <span style={{ fontSize: "1.1rem" }}>🎯</span>
          </div>
          <div style={{ fontSize: "1.75rem", fontWeight: "700", color: "var(--color-success)" }}>
            10 / 10 Stages
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "var(--space-1)" }}>
            Demo run has full end-to-end sample data
          </div>
        </div>

        <div className="card" style={{ padding: "var(--space-4)" }}>
          <div className="flex justify-between items-center mb-2">
            <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)", fontWeight: "500" }}>PROVENANCE INTEGRITY</span>
            <span style={{ fontSize: "1.1rem" }}>🛡️</span>
          </div>
          <div style={{ fontSize: "1.75rem", fontWeight: "700", color: "var(--color-info)" }}>
            100% Labeled
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "var(--space-1)" }}>
            Simulations permanently barred from demand proof
          </div>
        </div>
      </div>

      {/* Project History Section (F02) */}
      <div className="flex justify-between items-center mb-4" style={{ flexWrap: "wrap", gap: "var(--space-2)" }}>
        <div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: "600", color: "var(--text-primary)" }}>
            Recent Validation Projects
          </h2>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            Inspect prior validation runs, hypotheses, and evidence audit trails.
          </p>
        </div>

        {/* Filter categories */}
        <div className="flex gap-2">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat as string)}
              className={`btn btn-sm ${filterCategory === cat ? "btn-primary" : "btn-secondary"}`}
              style={{ fontSize: "0.75rem", padding: "4px 10px" }}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Projects List */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", marginBottom: "var(--space-8)" }}>
        {filteredProjects.map((project) => (
          <div
            key={project.id}
            className="card"
            style={{
              padding: "var(--space-5)",
              border: "1px solid var(--color-border)",
              transition: "border-color 0.2s, transform 0.2s",
            }}
          >
            <div className="flex justify-between items-center" style={{ flexWrap: "wrap", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}>
              <div className="flex items-center gap-3">
                <span style={{ fontSize: "1.25rem" }}>
                  {project.category === "EdTech" ? "📚" : project.category === "AgriTech" ? "🌱" : "💳"}
                </span>
                <h3 style={{ fontSize: "1.1rem", fontWeight: "600", color: "var(--text-primary)" }}>
                  {project.title}
                </h3>
                <ProvenanceBadge type={project.provenance} size="sm" />
                {project.category && (
                  <span
                    style={{
                      fontSize: "0.75rem",
                      background: "var(--color-surface-3)",
                      color: "var(--text-secondary)",
                      padding: "2px 8px",
                      borderRadius: "var(--radius-sm)",
                    }}
                  >
                    {project.category}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <StatusDot status={project.id === "proj-study-planner" ? DEMO_RUN.status : "queued"} />
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  {new Date(project.updatedAt).toLocaleDateString("en-IN", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>
            </div>

            <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginBottom: "var(--space-4)", lineHeight: "1.5" }}>
              {project.problem}
            </p>

            <div className="flex justify-between items-center" style={{ flexWrap: "wrap", gap: "var(--space-3)", borderTop: "1px solid var(--color-border)", paddingTop: "var(--space-3)" }}>
              <div className="flex gap-4" style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                <span>🎯 <strong>Audience:</strong> {project.targetCustomer}</span>
                {project.geography && <span>📍 <strong>Market:</strong> {project.geography}</span>}
              </div>

              <div className="flex gap-2">
                <Link
                  href={`/overview?projectId=${encodeURIComponent(project.id)}`}
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: "0.8125rem" }}
                >
                  Inspect Run Overview →
                </Link>
                <Link
                  href={`/report?projectId=${encodeURIComponent(project.id)}`}
                  className="btn btn-primary btn-sm"
                  style={{ fontSize: "0.8125rem" }}
                >
                  View Unified Report
                </Link>
                <button
                  type="button"
                  onClick={() => handleDeleteProject(project.id, project.title)}
                  className="btn btn-danger btn-sm"
                  style={{ fontSize: "0.8125rem", padding: "4px 8px" }}
                  title="Permanently delete project and all data (D08)"
                >
                  🗑️
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Validation Pipeline Walkthrough Card */}
      <div className="card" style={{ padding: "var(--space-6)" }}>
        <h3 style={{ fontSize: "1.1rem", fontWeight: "600", color: "var(--text-primary)", marginBottom: "var(--space-2)" }}>
          IdeaProbe Validation Architecture
        </h3>
        <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginBottom: "var(--space-4)" }}>
          Every idea progresses through 10 traceable stages. Outputs are labeled with their exact provenance.
        </p>

        <div className="grid-2" style={{ gap: "var(--space-4)" }}>
          <div style={{ background: "var(--color-surface-2)", padding: "var(--space-4)", borderRadius: "var(--radius-md)" }}>
            <h4 style={{ fontSize: "0.9375rem", color: "var(--color-accent-light)", marginBottom: "var(--space-2)" }}>
              Phase 1: Foundation &amp; Intake
            </h4>
            <ul style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", listStyle: "none", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <li>✓ <strong>Structured Intake (F01):</strong> Problem, customer, constraints &amp; assumptions</li>
              <li>✓ <strong>Idea Clarification (D12):</strong> Proactive question prompts to refine the brief</li>
              <li>✓ <strong>Interactive Shell &amp; Navigation:</strong> 13 dedicated workflow sections</li>
            </ul>
          </div>

          <div style={{ background: "var(--color-surface-2)", padding: "var(--space-4)", borderRadius: "var(--radius-md)" }}>
            <h4 style={{ fontSize: "0.9375rem", color: "var(--color-accent-light)", marginBottom: "var(--space-2)" }}>
              Next Phases: Intelligence &amp; Hardening
            </h4>
            <ul style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", listStyle: "none", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <li>⏳ <strong>Local Ollama (Phase 4):</strong> Offline structured inference with bounded schemas</li>
              <li>⏳ <strong>Research Ledger (Phase 5):</strong> External claims with verified citations</li>
              <li>⏳ <strong>Falsifiable Experiments (Phase 6):</strong> Metrics, thresholds, and MVP scoping</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
