"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { ProvenanceBadge, FixtureBadge, SimulationAlert } from "@/components/Badges";
import { useActiveProjectId, useActiveProjectMode, buildProjectPath } from "@/lib/useActiveProject";
import type { ProvenanceType } from "@/types";

interface PersonaItem {
  id: string;
  project_id?: string;
  name: string;
  segment: string;
  context: string;
  jobs: string | string[];
  pains: string | string[];
  goals: string | string[];
  behaviors: string | string[];
  constraints: string | string[];
  objections: string | string[];
  assumptions: string | string[];
  provenance: ProvenanceType;
  caveat?: string;
  created_at?: string;
}

const FIELD_ICONS: Record<string, string> = {
  jobs: "💼",
  pains: "😣",
  goals: "🎯",
  behaviors: "🔄",
  constraints: "⚠️",
  objections: "🚫",
  assumptions: "💭",
};

const FIELD_LABELS: Record<string, string> = {
  jobs: "Jobs to be Done",
  pains: "Pains & Friction",
  goals: "Core Goals",
  behaviors: "Observed Behaviors",
  constraints: "Operational Constraints",
  objections: "Anticipated Objections",
  assumptions: "Underlying Assumptions",
};

function PersonasContent() {
  const projectId = useActiveProjectId();
  const projectMode = useActiveProjectMode(projectId);
  const [personas, setPersonas] = useState<PersonaItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // Draft Persona state
  const [drafting, setDrafting] = useState(false);
  const [showDraftModal, setShowDraftModal] = useState(false);
  const [segmentPrompt, setSegmentPrompt] = useState("");
  const [notification, setNotification] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const notify = (msg: string, type: "success" | "error" = "success") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 5000);
  };

  // Load personas from SQLite
  const loadPersonas = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/personas`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const list: PersonaItem[] = json.data?.personas || [];
      setPersonas(list);
      if (list.length > 0 && !selectedId) {
        setSelectedId(list[0].id);
      }
    } catch (err) {
      console.error("Failed to load personas:", err);
      notify("Failed to load personas from database", "error");
    } finally {
      setLoading(false);
    }
  }, [projectId, selectedId]);

  useEffect(() => {
    loadPersonas();
  }, [loadPersonas]);

  // Handle Draft Persona via Ollama
  const handleDraftPersona = async () => {
    setDrafting(true);
    setShowDraftModal(false);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/personas/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segmentHint: segmentPrompt.trim() || undefined }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error?.message || `Endpoint returned HTTP ${res.status}`);
      }

      const json = await res.json();
      const newPersona = json.data?.persona;
      const inferenceMeta = json.data?.inference;

      if (newPersona) {
        setPersonas((prev) => {
          const filtered = prev.filter(
            (p) => p.id !== newPersona.id && p.name.trim().toLowerCase() !== newPersona.name.trim().toLowerCase()
          );
          return [newPersona, ...filtered];
        });
        setSelectedId(newPersona.id);
        if (inferenceMeta?.provenance === "AI_INFERENCE") {
          notify(`✨ Drafted "${newPersona.name}" via Ollama (${inferenceMeta.latencyMs}ms)`);
        } else {
          notify(`🔷 Drafted via SAMPLE fallback (${inferenceMeta?.reason || "Ollama offline"})`);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      notify(`Persona drafting error: ${msg}`, "error");
    } finally {
      setDrafting(false);
      setSegmentPrompt("");
    }
  };

  const selected = personas.find((p) => p.id === selectedId) || personas[0];

  const renderFieldContent = (val: string | string[]) => {
    if (Array.isArray(val)) {
      return (
        <ul style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
          {val.map((item, idx) => (
            <li key={idx} style={{ marginBottom: "4px" }}>
              {item}
            </li>
          ))}
        </ul>
      );
    }
    if (typeof val === "string" && val.includes(";")) {
      return (
        <ul style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
          {val.split(";").map((item, idx) => (
            <li key={idx} style={{ marginBottom: "4px" }}>
              {item.trim()}
            </li>
          ))}
        </ul>
      );
    }
    return (
      <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
        {val || "—"}
      </p>
    );
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
            <span style={{ color: "var(--color-accent-light)" }}>Personas</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 style={{ fontSize: "1.75rem", fontWeight: "700", color: "var(--text-primary)" }}>
              Customer Persona Hypotheses (F08)
            </h1>
            <FixtureBadge mode={projectMode} />
          </div>
          <p style={{ color: "var(--text-secondary)", marginTop: "var(--space-1)", fontSize: "0.9rem" }}>
            Structured customer archetype hypotheses synthesized from evidence ledger by Ollama local inference.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            className="btn btn-primary"
            onClick={() => setShowDraftModal(true)}
            disabled={drafting}
            id="btn-draft-persona"
          >
            {drafting ? "⏳ Drafting (Ollama)..." : "+ Draft Persona (Ollama)"}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={loadPersonas} title="Refresh">
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

      {/* Simulation Integrity Warning (Decision D03) */}
      <SimulationAlert message="These are SIMULATED personas generated as AI hypotheses. They are not based on real interviews and cannot count as customer validation evidence." />

      {/* Active Drafting Banner */}
      {drafting && (
        <div
          className="card mt-4 mb-4 animate-pulse"
          style={{
            padding: "var(--space-4) var(--space-5)",
            background: "rgba(99,102,241,0.12)",
            border: "1px solid var(--color-accent)",
          }}
        >
          <div className="flex items-center gap-3">
            <span style={{ fontSize: "1.5rem" }}>🤖</span>
            <div>
              <strong style={{ color: "var(--color-accent-light)" }}>Drafting customer segment hypothesis...</strong>
              <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                Extracting pain points, constraints, and objections from project evidence via Ollama.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Layout */}
      {loading ? (
        <div className="card text-center mt-4" style={{ padding: "var(--space-8)" }}>
          <div style={{ color: "var(--text-muted)" }}>Loading personas from SQLite database...</div>
        </div>
      ) : personas.length === 0 ? (
        <div className="card text-center mt-4" style={{ padding: "var(--space-8)" }}>
          <div style={{ fontSize: "2rem", marginBottom: "8px" }}>🎭</div>
          <h3 style={{ color: "var(--text-primary)", marginBottom: "4px" }}>No persona hypotheses created yet</h3>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem", marginBottom: "var(--space-4)" }}>
            Draft your first persona hypothesis using project evidence and Ollama local inference.
          </p>
          <button className="btn btn-primary" onClick={() => setShowDraftModal(true)}>
            + Draft Persona (Ollama)
          </button>
        </div>
      ) : (
        <div className="flex gap-6 mt-4" style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
          {/* Persona Selector Sidebar */}
          <div style={{ minWidth: "240px", maxWidth: "280px", flex: "0 0 auto", width: "100%" }}>
            <div
              style={{
                fontSize: "0.8125rem",
                fontWeight: "600",
                color: "var(--text-muted)",
                marginBottom: "var(--space-2)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              PERSONAS ({personas.length})
            </div>

            {personas.map((p: PersonaItem) => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "var(--space-3) var(--space-4)",
                  marginBottom: "var(--space-2)",
                  borderRadius: "var(--radius-md)",
                  border: `1px solid ${selected?.id === p.id ? "var(--color-accent)" : "var(--color-border)"}`,
                  background: selected?.id === p.id ? "rgba(99,102,241,0.12)" : "var(--color-surface-2)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  display: "block",
                }}
              >
                <div style={{ fontSize: "0.95rem", fontWeight: "600", color: "var(--text-primary)", marginBottom: "3px" }}>
                  {p.name}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.4, marginBottom: "6px" }}>
                  {p.segment.slice(0, 55)}…
                </div>
                <div className="flex items-center gap-2">
                  <ProvenanceBadge type={p.provenance} size="sm" />
                  <span
                    style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
                    title={p.id}
                  >
                    {p.id.startsWith("persona-gen-") ? `gen-${p.id.slice(-6)}` : p.id}
                  </span>
                </div>
              </button>
            ))}

            <div style={{ marginTop: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <Link
                href={buildProjectPath("/chat", projectId)}
                className="btn btn-primary btn-sm"
                style={{ textAlign: "center", display: "block" }}
              >
                💬 Open Persona Chat (F10) →
              </Link>
              <Link
                href={buildProjectPath("/interviews", projectId)}
                className="btn btn-secondary btn-sm"
                style={{ textAlign: "center", display: "block" }}
              >
                🎙 View Simulated Interviews →
              </Link>
            </div>
          </div>

          {/* Persona Detail View */}
          {selected && (
            <div style={{ flex: 1, minWidth: "300px" }}>
              <div className="card" style={{ padding: "var(--space-6)" }}>
                {/* Persona Header */}
                <div className="flex justify-between items-start mb-6" style={{ flexWrap: "wrap", gap: "var(--space-3)" }}>
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <h2 style={{ fontSize: "1.4rem", fontWeight: "700", color: "var(--text-primary)" }}>
                        {selected.name}
                      </h2>
                      <ProvenanceBadge type={selected.provenance} size="sm" />
                    </div>
                    <div style={{ fontSize: "0.9rem", color: "var(--color-accent-light)", fontWeight: "500" }}>
                      {selected.segment}
                    </div>
                    <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginTop: "var(--space-2)", lineHeight: 1.5 }}>
                      {selected.context}
                    </div>
                  </div>

                  <Link
                    href={buildProjectPath("/chat", projectId)}
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: "0.8rem" }}
                  >
                    💬 Stress-Test in Chat →
                  </Link>
                </div>

                {/* Explicit Assumptions Card (Decision D03 Requirement) */}
                <div
                  className="mb-6"
                  style={{
                    padding: "var(--space-4)",
                    borderRadius: "var(--radius-md)",
                    background: "rgba(245,158,11,0.08)",
                    border: "1px solid rgba(245,158,11,0.25)",
                  }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span style={{ fontSize: "1.1rem" }}>💭</span>
                    <strong style={{ fontSize: "0.875rem", color: "#f59e0b" }}>
                      Key Assumptions Inherent to this Persona (Unverified)
                    </strong>
                  </div>
                  <div style={{ color: "var(--text-secondary)" }}>
                    {renderFieldContent(selected.assumptions)}
                  </div>
                </div>

                {/* Persona Profile Grid */}
                <div className="grid-2" style={{ gap: "var(--space-4)" }}>
                  {(["jobs", "pains", "goals", "behaviors", "constraints", "objections"] as const).map((field) => (
                    <div
                      key={field}
                      style={{
                        padding: "var(--space-4)",
                        borderRadius: "var(--radius-md)",
                        background: "var(--color-surface-2)",
                        border: "1px solid var(--color-border)",
                      }}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span style={{ fontSize: "1rem" }}>{FIELD_ICONS[field]}</span>
                        <h4 style={{ fontSize: "0.875rem", fontWeight: "600", color: "var(--text-primary)", margin: 0 }}>
                          {FIELD_LABELS[field]}
                        </h4>
                      </div>
                      {renderFieldContent(selected[field])}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── MODAL: DRAFT PERSONA ── */}
      {showDraftModal && (
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
                <span style={{ fontSize: "1.3rem" }}>🎭</span>
                <h3 style={{ fontSize: "1.15rem", fontWeight: "700", color: "var(--text-primary)" }}>
                  Draft Customer Persona Hypothesis
                </h3>
              </div>
              <button
                onClick={() => setShowDraftModal(false)}
                style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: "1.2rem", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "var(--space-4)", lineHeight: 1.5 }}>
              Ollama will synthesize a persona card from your project brief and evidence ledger. The output is strictly labeled as a hypothesis.
            </p>

            <div style={{ marginBottom: "var(--space-4)" }}>
              <label style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "block", marginBottom: "6px" }}>
                Optional Segment Focus or Persona Angle:
              </label>
              <textarea
                placeholder="e.g. Focus on engineering students who work part-time or carry backlogs..."
                value={segmentPrompt}
                onChange={(e) => setSegmentPrompt(e.target.value)}
                rows={3}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--color-surface-2)",
                  border: "1px solid var(--color-border)",
                  color: "var(--text-primary)",
                  fontSize: "0.85rem",
                }}
              />
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button className="btn btn-secondary" onClick={() => setShowDraftModal(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleDraftPersona}>
                🎭 Generate Persona Card
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PersonasPage() {
  return (
    <Suspense fallback={<div className="page-container">Loading personas...</div>}>
      <PersonasContent />
    </Suspense>
  );
}
