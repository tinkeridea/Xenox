"use client";

import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { ProvenanceBadge, FixtureBadge, SimulationAlert } from "@/components/Badges";
import { useActiveProjectId, useActiveProjectMode, buildProjectPath } from "@/lib/useActiveProject";
import { DEMO_INTERVIEWS, DEMO_PERSONAS } from "@/lib/mockData";
import type { Interview, Persona } from "@/types";

function InterviewsContent() {
  const projectId = useActiveProjectId();
  const projectMode = useActiveProjectMode(projectId);
  const [interviews, setInterviews] = useState<any[]>([]);
  const [personas, setPersonas] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [expandedTurns, setExpandedTurns] = useState<boolean>(true);

  // Load project-specific interviews and personas from API
  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      setLoading(true);
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/personas`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const ivs = json.data?.interviews || [];
        const ps = json.data?.personas || [];
        if (isMounted) {
          setInterviews(ivs);
          setPersonas(ps);
          if (ivs.length > 0) {
            setSelectedId(ivs[0].id);
          } else {
            setSelectedId("");
          }
        }
      } catch (err) {
        console.error("Failed to load interviews:", err);
        if (isMounted) {
          if (projectId === "proj-study-planner") {
            setInterviews(DEMO_INTERVIEWS);
            setPersonas(DEMO_PERSONAS);
            setSelectedId(DEMO_INTERVIEWS[0].id);
          } else {
            setInterviews([]);
            setPersonas([]);
            setSelectedId("");
          }
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadData();
    return () => { isMounted = false; };
  }, [projectId]);

  const interview = interviews.find((i) => i.id === selectedId) || interviews[0];
  const personaId = interview ? (interview.persona_id || interview.personaId) : undefined;
  const persona = personas.find((p) => p.id === personaId);
  const personaName = persona?.name || interview?.persona_name || interview?.personaName || "Simulated Persona";

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
            <span style={{ color: "var(--color-accent-light)" }}>Interviews</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 style={{ fontSize: "1.75rem", fontWeight: "700", color: "var(--text-primary)" }}>
              Synthetic Interview Transcripts (F09)
            </h1>
            <FixtureBadge mode={projectMode} />
          </div>
          <p style={{ color: "var(--text-secondary)", marginTop: "var(--space-1)", fontSize: "0.9rem" }}>
            AI-generated interview dialogues to explore likely objections — not customer validation.
          </p>
        </div>
        <Link
          id="open-persona-chat-btn"
          href={buildProjectPath("/chat", projectId)}
          className="btn btn-secondary btn-sm"
          style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
          title="Open interactive Persona Chat Simulator"
        >
          <span>💬</span> Open Persona Chat Simulator
        </Link>
      </div>

      {/* Mandatory simulation warning */}
      <SimulationAlert message="These are SIMULATED interview transcripts generated entirely by AI. They represent plausible but invented dialogue. They are NOT real customer interviews and CANNOT be cited as proof of market demand or willingness to pay." />

      {loading ? (
        <div className="card text-center mt-4" style={{ padding: "var(--space-8)" }}>
          <div style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
            Loading synthetic interviews from SQLite database...
          </div>
        </div>
      ) : interviews.length === 0 ? (
        <div className="card text-center mt-4" style={{ padding: "var(--space-8)" }}>
          <div style={{ fontSize: "2rem", marginBottom: "8px" }}>🎙</div>
          <h2 style={{ fontSize: "1.25rem", color: "var(--text-primary)", marginBottom: "8px" }}>
            No Synthetic Interviews for this Project
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem", marginBottom: "var(--space-4)" }}>
            Synthetic interview transcripts explore hypothetical customer objections and require customer personas to be created first. No interviews found for project <code>{projectId}</code>.
          </p>
          <div className="flex gap-3 justify-center">
            <Link href={buildProjectPath("/personas", projectId)} className="btn btn-primary btn-sm">
              ← View Project Personas
            </Link>
            <Link href={buildProjectPath("/chat", projectId)} className="btn btn-secondary btn-sm">
              💬 Open Persona Chat
            </Link>
          </div>
        </div>
      ) : interview ? (
        <div className="flex gap-6 mt-4" style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
          {/* Interview Selector */}
          <div style={{ minWidth: "220px", maxWidth: "260px", flex: "0 0 auto" }}>
            <div style={{ fontSize: "0.8125rem", fontWeight: "600", color: "var(--text-muted)", marginBottom: "var(--space-2)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              INTERVIEWS ({interviews.length})
            </div>
            {interviews.map((iv: any) => {
              const ivPersonaId = iv.persona_id || iv.personaId;
              const ivPersona = personas.find((p) => p.id === ivPersonaId);
              const ivPersonaName = ivPersona?.name || iv.persona_name || iv.personaName || "Simulated Persona";
              const turnCount = iv.turns?.length || 0;

              return (
                <button
                  key={iv.id}
                  onClick={() => setSelectedId(iv.id)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "var(--space-3) var(--space-4)",
                    marginBottom: "var(--space-2)",
                    borderRadius: "var(--radius-md)",
                    border: `1px solid ${selectedId === iv.id ? "var(--color-accent)" : "var(--color-border)"}`,
                    background: selectedId === iv.id ? "rgba(99,102,241,0.12)" : "var(--color-surface-2)",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  <div style={{ fontSize: "0.875rem", fontWeight: "600", color: "var(--text-primary)", marginBottom: "3px" }}>
                    {ivPersonaName}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
                    {turnCount} turns
                  </div>
                  <div style={{ marginTop: "6px" }}>
                    <ProvenanceBadge type={iv.provenance || "SIMULATED"} size="sm" />
                  </div>
                </button>
              );
            })}

            <Link href={buildProjectPath("/personas", projectId)} className="btn btn-secondary btn-sm" style={{ width: "100%", textAlign: "center", marginTop: "var(--space-3)", display: "block" }}>
              ← View Personas
            </Link>
            <Link href={buildProjectPath("/chat", projectId)} className="btn btn-primary btn-sm" style={{ width: "100%", textAlign: "center", marginTop: "var(--space-2)", display: "block" }}>
              💬 Persona Chat →
            </Link>
          </div>

          {/* Interview Detail */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="card" style={{ padding: "var(--space-5)" }}>
              {/* Interview meta */}
              <div style={{ marginBottom: "var(--space-4)", padding: "var(--space-4)", background: "var(--color-surface-2)", borderRadius: "var(--radius-md)" }}>
                <div className="flex items-center gap-3 mb-2" style={{ flexWrap: "wrap" }}>
                  <ProvenanceBadge type={interview.provenance || "SIMULATED"} size="sm" />
                  <span style={{ fontSize: "0.875rem", fontWeight: "600", color: "var(--text-primary)" }}>
                    Synthetic Interview: {personaName}
                  </span>
                </div>
                <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", marginBottom: "var(--space-2)" }}>
                  <strong>Scenario:</strong> {interview.scenario}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  Model: {interview.model || "Not yet configured"} · Created: {interview.created_at || interview.createdAt ? new Date(interview.created_at || interview.createdAt).toLocaleDateString("en-IN") : "Recent"}
                </div>
              </div>

              {/* Mandatory caveat */}
              <div style={{ fontSize: "0.8125rem", padding: "10px 14px", borderRadius: "var(--radius-md)", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--color-error)", marginBottom: "var(--space-4)" }}>
                🚫 {interview.caveat || "⚠️ SIMULATED ARTIFACT — All dialogue is generated hypothesis. NEVER use synthetic dialogue as proof of customer demand."}
              </div>

              {/* Persona context */}
              {persona && (
                <div style={{ marginBottom: "var(--space-4)", fontSize: "0.8125rem", padding: "var(--space-3)", background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.18)", borderRadius: "var(--radius-md)" }}>
                  <strong style={{ color: "var(--color-accent-light)" }}>Persona Context:</strong>{" "}
                  <span style={{ color: "var(--text-secondary)" }}>{persona.context}</span>
                </div>
              )}

              {/* Turn toggle */}
              <div className="flex justify-between items-center mb-3">
                <h3 style={{ fontSize: "1rem", fontWeight: "600", color: "var(--text-primary)" }}>
                  Conversation Transcript ({interview.turns?.length || 0} turns)
                </h3>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setExpandedTurns(!expandedTurns)}
                  style={{ fontSize: "0.75rem" }}
                >
                  {expandedTurns ? "Collapse" : "Expand"}
                </button>
              </div>

              {/* Turns */}
              {expandedTurns && (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                  {(interview.turns || []).map((turn: any) => (
                    <div
                      key={turn.id}
                      style={{
                        display: "flex",
                        flexDirection: turn.role === "user" ? "row-reverse" : "row",
                        gap: "var(--space-3)",
                        alignItems: "flex-start",
                      }}
                    >
                      <div
                        style={{
                          width: "32px",
                          height: "32px",
                          borderRadius: "50%",
                          background: turn.role === "user" ? "rgba(99,102,241,0.3)" : "rgba(34,197,94,0.2)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "0.75rem",
                          flexShrink: 0,
                        }}
                      >
                        {turn.role === "user" ? "👤" : "🧑"}
                      </div>
                      <div
                        style={{
                          maxWidth: "75%",
                          padding: "var(--space-3) var(--space-4)",
                          borderRadius: "var(--radius-md)",
                          background: turn.role === "user" ? "rgba(99,102,241,0.12)" : "var(--color-surface-2)",
                          border: `1px solid ${turn.role === "user" ? "rgba(99,102,241,0.25)" : "var(--color-border)"}`,
                          fontSize: "0.875rem",
                          color: "var(--text-primary)",
                          lineHeight: 1.6,
                        }}
                      >
                        <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                          {turn.role === "user" ? "Founder" : personaName}
                        </div>
                        {turn.text}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Analyst note */}
              <div style={{ marginTop: "var(--space-5)", padding: "var(--space-4)", borderRadius: "var(--radius-md)", background: "var(--color-surface-2)", borderLeft: "3px solid var(--color-accent)" }}>
                <div style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--color-accent-light)", marginBottom: "var(--space-2)" }}>
                  ANALYST NOTE — HOW TO USE THIS TRANSCRIPT
                </div>
                <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                  Use this simulated dialogue to <strong>prepare questions for real user interviews</strong> and to anticipate objections worth stress-testing. Do not cite this as evidence that real users feel this way. The objections raised here (e.g., "I don't have time to configure an app during exams") should be validated with actual people before making product decisions.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function InterviewsPage() {
  return (
    <Suspense fallback={<div className="page-container">Loading interviews...</div>}>
      <InterviewsContent />
    </Suspense>
  );
}
