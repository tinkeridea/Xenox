"use client";

import React, { useState } from "react";
import Link from "next/link";
import type { Stage, StageKey } from "@/types";
import { STAGE_KEYS, STAGE_LABELS } from "@/types";
import { StatusDot, ProvenanceBadge } from "@/components/Badges";
import { useActiveProjectId, buildProjectPath } from "@/lib/useActiveProject";

interface StageListProps {
  stages: Stage[];
  projectId?: string;
}

const STAGE_ICONS: Record<StageKey, string> = {
  research:    "🔍",
  competitors: "⚔️",
  icp:         "🎯",
  personas:    "🎭",
  interviews:  "💬",
  insights:    "💡",
  risks:       "⚠️",
  experiments: "🧪",
  mvp:         "🚀",
  report:      "📄",
};

const STAGE_DESCRIPTION: Record<StageKey, string> = {
  research:    "Market signals and evidence collection with source links (F04/F05)",
  competitors: "Alternative and substitute solution mapping (F07)",
  icp:         "Ideal customer profile and buyer archetype definition",
  personas:    "Simulated customer personas — strictly hypothesis only (F08)",
  interviews:  "Synthetic interview simulations — not real participants (F09)",
  insights:    "Pattern extraction and counter-signal review (F11)",
  risks:       "Assumptions register & Impact × Uncertainty prioritization (F12)",
  experiments: "Falsifiable hypothesis test planner with metrics (F13)",
  mvp:         "Feature prioritization into Now / Next / Later (F14)",
  report:      "Unified Founder Validation Report with provenance audit (F15)",
};

const STAGE_ROUTE_MAP: Record<StageKey, string> = {
  research:    "/research",
  competitors: "/alternatives",
  icp:         "/personas",
  personas:    "/personas",
  interviews:  "/interviews",
  insights:    "/insights",
  risks:       "/risks",
  experiments: "/experiments",
  mvp:         "/mvp",
  report:      "/report",
};

function formatTime(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function StageList({ stages, projectId }: StageListProps) {
  const activeProjectId = useActiveProjectId(projectId);
  const [expandedKey, setExpandedKey] = useState<StageKey | null>(null);

  // Build lookup map
  const stageByKey: Partial<Record<StageKey, Stage>> = {};
  for (const s of stages) {
    stageByKey[s.stageKey] = s;
  }

  const toggleExpand = (key: StageKey) => {
    setExpandedKey((prev) => (prev === key ? null : key));
  };

  return (
    <div className="stage-list" role="list" aria-label="Validation pipeline stages">
      {STAGE_KEYS.map((key, idx) => {
        const stage = stageByKey[key];
        const status = stage?.status ?? "queued";
        const isExpanded = expandedKey === key;
        const out = stage?.outputJson as Record<string, unknown> | undefined;

        return (
          <div
            key={key}
            className={`card stage-item ${status}`}
            style={{
              marginBottom: "var(--space-3)",
              padding: "var(--space-4)",
              border: isExpanded ? "1px solid var(--color-accent)" : "1px solid var(--color-border)",
              background: "var(--color-surface)",
              cursor: "pointer",
            }}
            onClick={() => toggleExpand(key)}
          >
            <div className="flex justify-between items-center" style={{ flexWrap: "wrap", gap: "var(--space-2)" }}>
              <div className="flex items-center gap-3">
                <span style={{ fontSize: "1.25rem" }} aria-hidden="true">
                  {STAGE_ICONS[key]}
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: "0.9375rem", fontWeight: "600", color: "var(--text-primary)" }}>
                      {idx + 1}. {STAGE_LABELS[key]}
                    </span>
                    {(key === "personas" || key === "interviews") && (
                      <ProvenanceBadge type="SIMULATED" size="sm" />
                    )}
                    {Boolean(out?.provenance) && key !== "personas" && key !== "interviews" && (
                      <ProvenanceBadge type={out?.provenance as any} size="sm" />
                    )}
                  </div>
                  <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", marginTop: "2px" }}>
                    {STAGE_DESCRIPTION[key]}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
                <StatusDot status={status} />
                {stage?.completedAt && (
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                    {formatTime(stage.completedAt)}
                  </span>
                )}
                <Link
                  href={buildProjectPath(STAGE_ROUTE_MAP[key], activeProjectId)}
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: "0.75rem", padding: "3px 8px" }}
                >
                  Inspect Module →
                </Link>
                <button
                  type="button"
                  onClick={() => toggleExpand(key)}
                  className="btn btn-sm"
                  style={{ background: "transparent", color: "var(--text-muted)", border: "none", cursor: "pointer" }}
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? "▲" : "▼"}
                </button>
              </div>
            </div>

            {/* Expandable Output Drawer */}
            {isExpanded && (
              <div
                className="animate-fade-in"
                style={{
                  marginTop: "var(--space-4)",
                  paddingTop: "var(--space-3)",
                  borderTop: "1px solid var(--color-border)",
                  fontSize: "0.8125rem",
                  color: "var(--text-secondary)",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ marginBottom: "var(--space-2)" }}>
                  <strong style={{ color: "var(--text-primary)" }}>Stage Output Summary:</strong>{" "}
                  {out?.summary ? String(out.summary) : "Ready for execution in Phase 2/4."}
                </div>

                {Boolean(out?.caveat) && (
                  <div
                    style={{
                      background: "rgba(167,139,250,0.1)",
                      border: "1px solid rgba(167,139,250,0.25)",
                      borderRadius: "var(--radius-sm)",
                      padding: "var(--space-2) var(--space-3)",
                      color: "var(--badge-simulation)",
                      marginTop: "var(--space-2)",
                      fontSize: "0.75rem",
                    }}
                  >
                    ⚠️ <strong>Audit Caveat:</strong> {String(out?.caveat)}
                  </div>
                )}

                <div className="flex justify-between items-center" style={{ marginTop: "var(--space-3)" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Attempt: {stage?.attempt ?? 1} • Key: <code className="font-mono">{key}</code>
                  </span>
                  <Link href={buildProjectPath(STAGE_ROUTE_MAP[key], activeProjectId)} className="btn btn-sm btn-primary" style={{ fontSize: "0.75rem" }}>
                    Open Dedicated {STAGE_LABELS[key]} Screen
                  </Link>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
