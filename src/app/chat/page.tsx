"use client";

import React, { useState, useRef, useEffect, Suspense } from "react";
import Link from "next/link";
import { ProvenanceBadge, FixtureBadge, SimulationAlert } from "@/components/Badges";
import { useActiveProjectId, useActiveProjectMode, buildProjectPath } from "@/lib/useActiveProject";
import { DEMO_PERSONAS } from "@/lib/mockData";

interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
}

const SCRIPTED_RESPONSES: Record<string, string[]> = {
  "default": [
    "I'd need to think about that. Setting up something new during exam season feels risky — exams are in 18 days.",
    "Honestly, if it only takes 2 minutes to set up, I'd give it a try. But I've been burned before.",
    "What happens when I miss a session? That's always where I fall off track.",
    "I don't think I'd pay upfront without seeing it work first. A free week would help.",
  ],
  "pay": [
    "₹99 a month? That's tough. My pocket money is limited. If my marks actually improve, my parents might pay though.",
  ],
  "setup": [
    "If setup is under 2 minutes and I just enter my exam dates, that's actually manageable. Just don't ask me to fill in topics manually.",
  ],
  "miss": [
    "That's exactly the problem — when I miss one session the whole plan falls apart and I give up. If it auto-reschedules, that would be genuinely useful.",
  ],
  "privacy": [
    "I'd want my study data to stay on my device. I don't want some company knowing when I study and when I don't.",
  ],
};

function getScriptedResponse(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("pay") || lower.includes("price") || lower.includes("cost") || lower.includes("₹")) {
    return SCRIPTED_RESPONSES["pay"][0];
  }
  if (lower.includes("setup") || lower.includes("configure") || lower.includes("start")) {
    return SCRIPTED_RESPONSES["setup"][0];
  }
  if (lower.includes("miss") || lower.includes("skip") || lower.includes("fail")) {
    return SCRIPTED_RESPONSES["miss"][0];
  }
  if (lower.includes("privacy") || lower.includes("data") || lower.includes("cloud")) {
    return SCRIPTED_RESPONSES["privacy"][0];
  }
  const pool = SCRIPTED_RESPONSES["default"];
  return pool[Math.floor(Math.random() * pool.length)];
}

interface PersonaItem {
  id: string;
  project_id?: string;
  name: string;
  segment: string;
  context?: string;
  objections?: string | string[];
  provenance?: "SIMULATED" | "SAMPLE" | "AI_INFERENCE" | "USER_INPUT" | "REAL_SOURCE" | "REAL_EXPERIMENT_RESULT";
}

function ChatContent() {
  const projectId = useActiveProjectId();
  const projectMode = useActiveProjectMode(projectId);
  const [personas, setPersonas] = useState<PersonaItem[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>("");
  const [loadingPersonas, setLoadingPersonas] = useState<boolean>(true);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState<string>("");
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load project-specific personas from API
  useEffect(() => {
    let isMounted = true;
    async function loadPersonas() {
      setLoadingPersonas(true);
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/personas`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const list: PersonaItem[] = json.data?.personas || [];
        if (isMounted) {
          setPersonas(list);
          if (list.length > 0) {
            setSelectedPersonaId(list[0].id);
          } else {
            setSelectedPersonaId("");
          }
        }
      } catch (err) {
        console.error("Failed to load personas for chat:", err);
        if (isMounted) {
          if (projectId === "proj-study-planner") {
            setPersonas(DEMO_PERSONAS as any);
            setSelectedPersonaId(DEMO_PERSONAS[0].id);
          } else {
            setPersonas([]);
            setSelectedPersonaId("");
          }
        }
      } finally {
        if (isMounted) setLoadingPersonas(false);
      }
    }
    loadPersonas();
    return () => { isMounted = false; };
  }, [projectId]);

  const persona: PersonaItem | undefined = personas.find((p) => p.id === selectedPersonaId) || personas[0];

  useEffect(() => {
    setTurns([]);
  }, [selectedPersonaId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, isTyping]);

  const [sessionId] = useState<string>(() => `chat-session-${Date.now()}`);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isTyping || !selectedPersonaId) return;

    const userTurn: ChatTurn = { id: `u-${Date.now()}`, role: "user", text: trimmed };
    setTurns((prev) => [...prev, userTurn]);
    setInput("");
    setIsTyping(true);

    try {
      const res = await fetch(`/api/personas/${encodeURIComponent(selectedPersonaId)}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, sessionId }),
      });
      if (res.ok) {
        const json = await res.json();
        const assistantText = json.data?.assistantTurn?.text || getScriptedResponse(trimmed);
        const assistantTurn: ChatTurn = { id: json.data?.assistantTurn?.id || `a-${Date.now()}`, role: "assistant", text: assistantText };
        setTurns((prev) => [...prev, assistantTurn]);
      } else {
        const response = getScriptedResponse(trimmed);
        setTurns((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", text: response }]);
      }
    } catch {
      const response = getScriptedResponse(trimmed);
      setTurns((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", text: response }]);
    } finally {
      setIsTyping(false);
    }
  };

  const getPersonaContextText = (p?: PersonaItem) => {
    if (!p) return "Simulated persona";
    if (typeof p.objections === "string" && p.objections.trim().length > 0) {
      return p.objections.split('"')[1] || p.objections.slice(0, 90);
    }
    if (Array.isArray(p.objections) && p.objections.length > 0) {
      return p.objections[0];
    }
    return p.context || "Simulated customer archetype";
  };

  const suggestedQuestions = projectId === "proj-study-planner"
    ? [
        "How do you manage your study plan today?",
        "What happens when you miss a study session?",
        "Would you pay ₹99/month for auto-reschedule?",
        "How important is data privacy to you?",
      ]
    : [
        "What is your biggest daily challenge regarding this problem?",
        "What happens when your current solution fails?",
        "Would you consider paying for a dedicated solution?",
        "What objections would prevent you from adopting this product?",
      ];

  return (
    <div className="page-container animate-fade-in">
      {/* Header */}
      <div className="flex justify-between items-center mb-4" style={{ flexWrap: "wrap", gap: "var(--space-3)" }}>
        <div>
          <div className="flex items-center gap-2 mb-2" style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            <Link href="/" style={{ color: "var(--text-muted)", textDecoration: "none" }}>Dashboard</Link>
            <span>/</span>
            <Link href={buildProjectPath("/personas", projectId)} style={{ color: "var(--text-muted)", textDecoration: "none" }}>Personas</Link>
            <span>/</span>
            <span style={{ color: "var(--color-accent-light)" }}>Persona Chat</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 style={{ fontSize: "1.75rem", fontWeight: "700", color: "var(--text-primary)" }}>
              Persona Chat (F10)
            </h1>
            <FixtureBadge mode={projectMode} />
          </div>
          <p style={{ color: "var(--text-secondary)", marginTop: "var(--space-1)", fontSize: "0.9rem" }}>
            Ask a simulated persona grounded questions to explore objections and assumptions.
          </p>
        </div>
      </div>

      {/* Simulation banner — always visible */}
      <div style={{ padding: "10px 16px", borderRadius: "var(--radius-md)", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--color-error)", marginBottom: "var(--space-4)", fontSize: "0.8125rem" }}>
        🚫 <strong>SIMULATED PERSONA CHAT</strong> — All responses are scripted demo dialogue, not AI inference. In Phase 4, Ollama will generate contextual responses grounded in the persona card. No real person is represented here.
      </div>

      {loadingPersonas ? (
        <div className="card text-center" style={{ padding: "var(--space-8)" }}>
          <div style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
            Loading personas from SQLite database...
          </div>
        </div>
      ) : personas.length === 0 ? (
        <div className="card text-center" style={{ padding: "var(--space-8)" }}>
          <div style={{ fontSize: "2rem", marginBottom: "8px" }}>💬</div>
          <h2 style={{ fontSize: "1.25rem", color: "var(--text-primary)", marginBottom: "8px" }}>
            No Customer Personas for this Project
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem", marginBottom: "var(--space-4)" }}>
            Persona chat requires a simulated customer persona grounded in project evidence. No personas exist for project <code>{projectId}</code> yet.
          </p>
          <Link href={buildProjectPath("/personas", projectId)} className="btn btn-primary btn-sm">
            ← Go to Personas to Draft a Persona
          </Link>
        </div>
      ) : persona ? (
        <div className="flex gap-4" style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
          {/* Persona Picker */}
          <div style={{ minWidth: "200px", maxWidth: "240px", flex: "0 0 auto" }}>
            <div style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--text-muted)", marginBottom: "var(--space-2)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              SELECT PERSONA ({personas.length})
            </div>
            {personas.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedPersonaId(p.id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "var(--space-3) var(--space-4)",
                  marginBottom: "var(--space-2)",
                  borderRadius: "var(--radius-md)",
                  border: `1px solid ${selectedPersonaId === p.id ? "var(--color-accent)" : "var(--color-border)"}`,
                  background: selectedPersonaId === p.id ? "rgba(99,102,241,0.12)" : "var(--color-surface-2)",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: "0.875rem", fontWeight: "600", color: "var(--text-primary)", marginBottom: "2px" }}>
                  {p.name}
                </div>
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                  {(p.segment || "").split("(")[0].slice(0, 40)}…
                </div>
                <ProvenanceBadge type={p.provenance || "SIMULATED"} size="sm" />
              </button>
            ))}

            {/* Persona quick context */}
            <div style={{ marginTop: "var(--space-3)", padding: "var(--space-3)", background: "var(--color-surface-2)", borderRadius: "var(--radius-md)", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
              <div style={{ fontWeight: "600", color: "var(--text-primary)", marginBottom: "4px" }}>Persona Context:</div>
              {getPersonaContextText(persona)}
            </div>

            {/* Suggested questions */}
            <div style={{ marginTop: "var(--space-3)" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--text-muted)", marginBottom: "var(--space-2)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                SUGGESTED QUESTIONS
              </div>
              {suggestedQuestions.map((q) => (
                <button
                  key={q}
                  onClick={() => setInput(q)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "6px 10px",
                    marginBottom: "6px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--color-border)",
                    background: "var(--color-surface-2)",
                    cursor: "pointer",
                    fontSize: "0.75rem",
                    color: "var(--text-secondary)",
                    lineHeight: 1.4,
                  }}
                >
                  "{q}"
                </button>
              ))}
            </div>
          </div>

          {/* Chat window */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <div className="card" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", height: "520px" }}>
              {/* Chat header */}
              <div style={{ padding: "var(--space-4) var(--space-5)", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: "var(--space-3)", background: "var(--color-surface-2)" }}>
                <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "rgba(99,102,241,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem" }}>
                  🧑
                </div>
                <div>
                  <div style={{ fontSize: "0.9375rem", fontWeight: "600", color: "var(--text-primary)" }}>{persona.name}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{(persona.segment || "").split("(")[0].trim()}</div>
                </div>
                <ProvenanceBadge type={persona.provenance || "SIMULATED"} size="sm" />
              </div>

              {/* Messages area */}
              <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                {turns.length === 0 && (
                  <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.875rem", margin: "auto", padding: "var(--space-8)" }}>
                    Ask <strong>{persona.name}</strong> a question about their habits, pain points, or your product idea.
                    <div style={{ marginTop: "var(--space-2)", fontSize: "0.75rem" }}>Select a suggested question on the left to start →</div>
                  </div>
                )}

              {turns.map((turn) => (
                <div
                  key={turn.id}
                  style={{
                    display: "flex",
                    flexDirection: turn.role === "user" ? "row-reverse" : "row",
                    gap: "var(--space-2)",
                    alignItems: "flex-end",
                  }}
                >
                  <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: turn.role === "user" ? "rgba(99,102,241,0.3)" : "rgba(34,197,94,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", flexShrink: 0 }}>
                    {turn.role === "user" ? "👤" : "🧑"}
                  </div>
                  <div
                    style={{
                      maxWidth: "70%",
                      padding: "var(--space-3) var(--space-4)",
                      borderRadius: "var(--radius-md)",
                      background: turn.role === "user" ? "rgba(99,102,241,0.15)" : "var(--color-surface-2)",
                      border: `1px solid ${turn.role === "user" ? "rgba(99,102,241,0.3)" : "var(--color-border)"}`,
                      fontSize: "0.875rem",
                      color: "var(--text-primary)",
                      lineHeight: 1.6,
                    }}
                  >
                    {turn.text}
                  </div>
                </div>
              ))}

              {isTyping && (
                <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                  <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "rgba(34,197,94,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem" }}>🧑</div>
                  <div style={{ padding: "10px 14px", borderRadius: "var(--radius-md)", background: "var(--color-surface-2)", border: "1px solid var(--color-border)", fontSize: "0.875rem", color: "var(--text-muted)" }}>
                    <span style={{ animation: "pulse 1s infinite" }}>• • •</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div style={{ padding: "var(--space-4) var(--space-5)", borderTop: "1px solid var(--color-border)", display: "flex", gap: "var(--space-3)" }}>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
                placeholder={`Ask ${persona.name} a question…`}
                className="form-input"
                style={{ flex: 1, fontSize: "0.875rem" }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isTyping}
                className="btn btn-primary"
                style={{ padding: "var(--space-2) var(--space-4)", fontSize: "0.875rem" }}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    ) : null}
  </div>
);
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="page-container">Loading persona chat...</div>}>
      <ChatContent />
    </Suspense>
  );
}
