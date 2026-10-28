import React from "react";
import type { ProvenanceType, RunStatus, StageStatus, EvidenceBasis } from "@/types";

// ── ProvenanceBadge (D04: 6 Types) ─────────────────────────────────

interface ProvenanceBadgeProps {
  type: ProvenanceType | EvidenceBasis;
  size?: "sm" | "md";
  showIcon?: boolean;
}

const PROVENANCE_CONFIG: Record<
  string,
  { label: string; className: string; icon: string; description: string }
> = {
  SAMPLE: {
    label: "SAMPLE",
    className: "badge badge-fixture",
    icon: "📋",
    description: "Prepared demo fixture — not freshly researched",
  },
  SIMULATED: {
    label: "SIMULATED",
    className: "badge badge-simulation",
    icon: "🎭",
    description: "Synthetic AI simulation — hypothesis only, not real customer evidence",
  },
  REAL_SOURCE: {
    label: "REAL SOURCE",
    className: "badge badge-evidence",
    icon: "🔗",
    description: "Retrieved from identifiable external source",
  },
  USER_INPUT: {
    label: "USER INPUT",
    className: "badge badge-assumption",
    icon: "✍️",
    description: "Provided directly by the user / founder",
  },
  REAL_EXPERIMENT_RESULT: {
    label: "EXPERIMENT RESULT",
    className: "badge badge-evidence",
    icon: "🧪",
    description: "Measured data from actual experiment execution",
  },
  AI_INFERENCE: {
    label: "AI INFERENCE",
    className: "badge badge-inference",
    icon: "⚡",
    description: "Generated interpretation or synthesis from model",
  },
  // Compatibility mappings
  evidence: {
    label: "REAL SOURCE",
    className: "badge badge-evidence",
    icon: "🔗",
    description: "Retrieved from external source",
  },
  inference: {
    label: "AI INFERENCE",
    className: "badge badge-inference",
    icon: "⚡",
    description: "AI-generated synthesis",
  },
  simulation: {
    label: "SIMULATED",
    className: "badge badge-simulation",
    icon: "🎭",
    description: "Synthetic simulation — not real evidence",
  },
  user_input: {
    label: "USER INPUT",
    className: "badge badge-assumption",
    icon: "✍️",
    description: "Input provided by founder",
  },
  assumption: {
    label: "ASSUMPTION",
    className: "badge badge-assumption",
    icon: "❓",
    description: "Unverified assumption",
  },
};

export function ProvenanceBadge({ type, size = "md", showIcon = true }: ProvenanceBadgeProps) {
  const config = PROVENANCE_CONFIG[type] || PROVENANCE_CONFIG.SAMPLE;
  const sizeStyle = size === "sm" ? { fontSize: "0.625rem", padding: "2px 7px" } : undefined;

  return (
    <span
      className={config.className}
      style={sizeStyle}
      title={config.description}
      aria-label={`Provenance: ${config.label}`}
    >
      {showIcon && <span style={{ marginRight: "4px" }}>{config.icon}</span>}
      {config.label}
    </span>
  );
}

// Alias for backwards compatibility
export function EvidenceBadge({ basis, size }: { basis: EvidenceBasis; size?: "sm" | "md" }) {
  return <ProvenanceBadge type={basis} size={size} />;
}

// ── FixtureBadge ───────────────────────────────────────────────────

export interface FixtureBadgeProps {
  mode?: "DEMO" | "LIVE" | "MIXED" | string | null;
  isDemo?: boolean;
}

export function FixtureBadge({ mode, isDemo }: FixtureBadgeProps = {}) {
  const showDemo = mode === "DEMO" || isDemo === true;
  if (!showDemo) {
    return null;
  }

  return (
    <span
      className="badge badge-fixture"
      role="note"
      aria-label="Prepared demo data — not freshly researched"
      title="This is prepared demo data, not freshly researched."
    >
      📋 Prepared demo data
    </span>
  );
}

// ── SimulationAlert ────────────────────────────────────────────────

export function SimulationAlert({ what = "persona", message }: { what?: string; message?: string }) {
  return (
    <div
      className="banner banner-simulation"
      role="note"
      aria-live="polite"
      style={{ margin: "var(--space-4) 0" }}
    >
      <span className="banner-icon" aria-hidden="true">⚠️</span>
      <span>
        {message ? (
          <span>{message}</span>
        ) : (
          <>
            <strong>Simulated {what} — hypothesis, not a real customer.</strong>{" "}
            Synthetic interviews and simulated personas are generated to surface objections and blindspots.
            Per product policy, simulations NEVER count as customer evidence or proof of demand.
          </>
        )}
      </span>
    </div>
  );
}

// ── StatusDot ──────────────────────────────────────────────────────

interface StatusDotProps {
  status: RunStatus | StageStatus;
  label?: string;
}

const STATUS_LABEL: Record<string, string> = {
  queued:    "Queued",
  running:   "Running",
  completed: "Completed",
  failed:    "Failed",
  partial:   "Partial",
  skipped:   "Skipped",
  cancelled: "Cancelled",
};

export function StatusDot({ status, label }: StatusDotProps) {
  const text = label ?? STATUS_LABEL[status] ?? status;
  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}
      aria-label={`Status: ${text}`}
    >
      <span className={`status-dot ${status}`} aria-hidden="true" />
      <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
        {text}
      </span>
    </span>
  );
}

// ── RunModeBadge ───────────────────────────────────────────────────

export function RunModeBadge({ mode }: { mode: "live" | "demo_fixture" }) {
  return (
    <span
      className={mode === "live" ? "badge badge-live" : "badge badge-demo"}
      aria-label={mode === "live" ? "Live run mode" : "Prepared demo fixture mode"}
      title={
        mode === "demo_fixture"
          ? "This run uses prepared demo data. Not live model output."
          : "This run uses live model generation."
      }
    >
      {mode === "live" ? "⚡ Live" : "📋 Demo fixture"}
    </span>
  );
}
