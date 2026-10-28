"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import { ProvenanceBadge } from "@/components/Badges";
import { useActiveProjectId, useActiveProjectMode, setProjectModeCache, buildProjectPath, KNOWN_PROJECT_TITLES } from "@/lib/useActiveProject";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  exact?: boolean;
  badge?: string;
}

const WORKSPACE_NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "📊", exact: true },
  { href: "/new", label: "New Idea Intake", icon: "✨" },
];

const PROJECT_NAV: NavItem[] = [
  { href: "/overview", label: "Project Overview", icon: "🎯" },
  { href: "/research", label: "Market Research", icon: "🔍" },
  { href: "/alternatives", label: "Alternatives", icon: "⚔️" },
  { href: "/personas", label: "Personas", icon: "🎭" },
  { href: "/interviews", label: "Simulated Interviews", icon: "💬" },
  { href: "/chat", label: "Persona Chat", icon: "🤖" },
  { href: "/insights", label: "Insights & Contradictions", icon: "💡" },
  { href: "/risks", label: "Assumptions & Risks", icon: "⚠️" },
  { href: "/experiments", label: "Experiment Planner", icon: "🧪" },
  { href: "/mvp", label: "MVP Plan", icon: "🚀" },
  { href: "/report", label: "Unified Report", icon: "📄" },
];

const SYSTEM_NAV: NavItem[] = [
  { href: "/settings", label: "Settings", icon: "⚙️" },
  { href: "/about", label: "About & Scope", icon: "ℹ️" },
];

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const projectId = useActiveProjectId();
  const projectMode = useActiveProjectMode(projectId);
  const [projectTitle, setProjectTitle] = useState<string>(
    () => KNOWN_PROJECT_TITLES[projectId] || projectId
  );

  useEffect(() => {
    if (KNOWN_PROJECT_TITLES[projectId]) {
      setProjectTitle(KNOWN_PROJECT_TITLES[projectId]);
      return;
    }
    let active = true;
    fetch(`/api/projects/${encodeURIComponent(projectId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (active) {
          if (json?.data?.project?.title) {
            setProjectTitle(json.data.project.title);
          }
          if (json?.data?.project?.mode) {
            setProjectModeCache(projectId, json.data.project.mode);
          }
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [projectId]);

  function isActive(item: NavItem): boolean {
    if (item.exact) return pathname === item.href;
    return pathname === item.href || pathname.startsWith(item.href + "/");
  }

  // Determine whether the current route has an active project context
  const isProjectRoute = Boolean(
    pathname?.startsWith("/overview") ||
    pathname?.startsWith("/research") ||
    pathname?.startsWith("/alternatives") ||
    pathname?.startsWith("/personas") ||
    pathname?.startsWith("/interviews") ||
    pathname?.startsWith("/chat") ||
    pathname?.startsWith("/insights") ||
    pathname?.startsWith("/risks") ||
    pathname?.startsWith("/experiments") ||
    pathname?.startsWith("/mvp") ||
    pathname?.startsWith("/report") ||
    pathname?.startsWith("/runs")
  );
  const hasExplicitProject = Boolean(searchParams?.get("projectId"));
  const showProjectBanner = isProjectRoute || hasExplicitProject;

  return (
    <aside className="sidebar" role="navigation" aria-label="Main navigation">
      {/* Header / Logo */}
      <div className="sidebar-header">
        <Link href="/" className="sidebar-logo" aria-label="IdeaProbe home">
          <div className="logo-icon" aria-hidden="true">🔬</div>
          <div>
            <div className="logo-text">IdeaProbe</div>
            <div className="logo-badge">Phase 1 Prototype</div>
          </div>
        </Link>
      </div>

      {/* Global Mode & Health Banner (mode-aware) */}
      {showProjectBanner && projectMode === "DEMO" && (
        <div style={{ padding: "0 var(--space-4) var(--space-3) var(--space-4)" }}>
          <div
            style={{
              background: "rgba(56,189,248,0.08)",
              border: "1px solid rgba(56,189,248,0.25)",
              borderRadius: "var(--radius-sm)",
              padding: "var(--space-2) var(--space-3)",
              fontSize: "0.75rem",
              color: "var(--color-info)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>📋 <strong>Demo Mode Active</strong></span>
            <span
              style={{
                fontSize: "0.625rem",
                background: "rgba(34,197,94,0.15)",
                color: "var(--color-success)",
                padding: "1px 5px",
                borderRadius: "4px",
              }}
            >
              Offline
            </span>
          </div>
        </div>
      )}

      {showProjectBanner && projectMode === "LIVE" && (
        <div style={{ padding: "0 var(--space-4) var(--space-3) var(--space-4)" }}>
          <div
            style={{
              background: "rgba(99,102,241,0.08)",
              border: "1px solid rgba(99,102,241,0.25)",
              borderRadius: "var(--radius-sm)",
              padding: "var(--space-2) var(--space-3)",
              fontSize: "0.75rem",
              color: "var(--color-accent-light)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>✨ <strong>Live Validation Workspace</strong></span>
            <span
              style={{
                fontSize: "0.625rem",
                background: "rgba(99,102,241,0.15)",
                color: "var(--color-accent-light)",
                padding: "1px 5px",
                borderRadius: "4px",
              }}
            >
              Live
            </span>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="sidebar-nav">
        {/* Workspace */}
        <div className="nav-section-label">Workspace</div>
        {WORKSPACE_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-link${isActive(item) ? " active" : ""}`}
            aria-current={isActive(item) ? "page" : undefined}
          >
            <span className="nav-link-icon" aria-hidden="true">{item.icon}</span>
            <span style={{ flex: 1 }}>{item.label}</span>
          </Link>
        ))}

        {/* Current Project Context */}
        <div className="nav-section-label" style={{ marginTop: "var(--space-4)" }}>
          Active Project:{" "}
          <span
            style={{
              color: "var(--color-accent-light)",
              display: "inline-block",
              maxWidth: "140px",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              verticalAlign: "bottom",
            }}
            title={projectTitle}
          >
            {projectTitle}
          </span>
        </div>
        {PROJECT_NAV.map((item) => (
          <Link
            key={item.href}
            href={buildProjectPath(item.href, projectId)}
            className={`nav-link${isActive(item) ? " active" : ""}`}
            aria-current={isActive(item) ? "page" : undefined}
          >
            <span className="nav-link-icon" aria-hidden="true">{item.icon}</span>
            <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {item.label}
            </span>
          </Link>
        ))}

        {/* System */}
        <div className="nav-section-label" style={{ marginTop: "var(--space-4)" }}>
          System &amp; Info
        </div>
        {SYSTEM_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-link${isActive(item) ? " active" : ""}`}
            aria-current={isActive(item) ? "page" : undefined}
          >
            <span className="nav-link-icon" aria-hidden="true">{item.icon}</span>
            <span style={{ flex: 1 }}>{item.label}</span>
          </Link>
        ))}
      </nav>

      {/* Evidence Provenance Legend (D04: 6 Types) */}
      <div className="sidebar-footer">
        <div className="evidence-legend" role="complementary" aria-label="Evidence provenance key">
          <div className="legend-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Provenance Key</span>
            <span style={{ fontSize: "0.6875rem", color: "var(--text-muted)" }}>Policy D04</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", marginTop: "var(--space-2)" }}>
            <ProvenanceBadge type="REAL_SOURCE" size="sm" />
            <ProvenanceBadge type="AI_INFERENCE" size="sm" />
            <ProvenanceBadge type="SIMULATED" size="sm" />
            <ProvenanceBadge type="USER_INPUT" size="sm" />
            <ProvenanceBadge type="REAL_EXPERIMENT_RESULT" size="sm" />
            <ProvenanceBadge type="SAMPLE" size="sm" />
          </div>
        </div>
      </div>
    </aside>
  );
}
