"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ProvenanceBadge } from "@/components/Badges";
import { useActiveProjectId, buildProjectPath } from "@/lib/useActiveProject";
import {
  evaluateExperimentDecision,
  type ExperimentDecision,
  type DecisionOutcome,
} from "@/lib/experimentDecision";

interface ExperimentRecord {
  id: string;
  project_id: string;
  assumption_id: string | null;
  hypothesis: string;
  method: string;
  cohort: string;
  metric: string;
  threshold: string;
  duration: string;
  cost_estimate: string;
  decision_rules: string;
  result: string | null;
  status: "planned" | "running" | "completed" | "abandoned";
  provenance: string;
  created_at: string;
  assumption_statement?: string;
  assumption_uncertainty?: string;
  assumption_impact?: string;
}

interface AssumptionOption {
  id: string;
  statement: string;
  uncertainty: string;
  impact: string;
  status: string;
}

const STATUS_CONFIG: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  planned: { label: "Planned", icon: "📋", color: "#6366f1", bg: "rgba(99,102,241,0.1)" },
  running: { label: "Running", icon: "▶️", color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
  completed: { label: "Completed", icon: "✅", color: "var(--color-success)", bg: "rgba(34,197,94,0.1)" },
  abandoned: { label: "Abandoned", icon: "❌", color: "var(--color-error)", bg: "rgba(239,68,68,0.1)" },
};

const DECISION_CONFIG: Record<DecisionOutcome, { label: string; icon: string; color: string; bg: string; border: string }> = {
  supported: {
    label: "Supported",
    icon: "✅",
    color: "var(--color-success)",
    bg: "rgba(34,197,94,0.12)",
    border: "rgba(34,197,94,0.3)",
  },
  rejected: {
    label: "Rejected",
    icon: "❌",
    color: "var(--color-error)",
    bg: "rgba(239,68,68,0.12)",
    border: "rgba(239,68,68,0.3)",
  },
  inconclusive: {
    label: "Inconclusive",
    icon: "⚠️",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.12)",
    border: "rgba(245,158,11,0.3)",
  },
};

function ExperimentsContent() {
  const projectId = useActiveProjectId();
  const searchParams = useSearchParams();
  const preselectedAssumptionId = searchParams?.get("assumptionId") || "";

  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);
  const [assumptions, setAssumptions] = useState<AssumptionOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("All");

  // Generate modal
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [selectedAssumptionId, setSelectedAssumptionId] = useState(preselectedAssumptionId);
  const [generateMethod, setGenerateMethod] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateFeedback, setGenerateFeedback] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Manual Add modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [manualAssumptionId, setManualAssumptionId] = useState(preselectedAssumptionId);
  const [manualHypothesis, setManualHypothesis] = useState("");
  const [manualMethod, setManualMethod] = useState("");
  const [manualCohort, setManualCohort] = useState("");
  const [manualMetric, setManualMetric] = useState("");
  const [manualThreshold, setManualThreshold] = useState("");
  const [manualDuration, setManualDuration] = useState("2 weeks");
  const [manualCost, setManualCost] = useState("$0");
  const [ruleContinue, setRuleContinue] = useState("");
  const [rulePivot, setRulePivot] = useState("");
  const [ruleStop, setRuleStop] = useState("");
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);

  // Record Result modal
  const [resultTargetExp, setResultTargetExp] = useState<ExperimentRecord | null>(null);
  const [resultText, setResultText] = useState("");
  const [validateAssumptionChoice, setValidateAssumptionChoice] = useState<"validated" | "invalidated" | "keep">("validated");
  const [isSavingResult, setIsSavingResult] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [expRes, asmRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/experiments`),
        fetch(`/api/projects/${projectId}/assumptions`),
      ]);

      const expData = await expRes.json();
      const asmData = await asmRes.json();

      if (!expRes.ok) throw new Error(expData.error?.message || "Failed to load experiments");
      if (!asmRes.ok) throw new Error(asmData.error?.message || "Failed to load assumptions");

      const exps: ExperimentRecord[] = expData.data.experiments || [];
      setExperiments(exps);
      setAssumptions(asmData.data.assumptions || []);

      if (exps.length > 0 && !expanded) {
        setExpanded(exps[0].id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error loading data");
    } finally {
      setLoading(false);
    }
  }, [projectId, expanded]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (preselectedAssumptionId) {
      setSelectedAssumptionId(preselectedAssumptionId);
      setManualAssumptionId(preselectedAssumptionId);
      setShowGenerateModal(true);
    }
  }, [preselectedAssumptionId]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsGenerating(true);
    setGenerateFeedback(null);
    setGenerateError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/experiments/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assumptionId: selectedAssumptionId || undefined,
          method: generateMethod || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Experiment generation failed");

      setGenerateFeedback(
        `Experiment designed [${data.provenance || "SAMPLE"}] in ${data.data.latencyMs}ms. Linked assumption set to 'testing'.`
      );
      await loadData();
      if (data.data?.experiment?.id) {
        setExpanded(data.data.experiment.id);
      }
      setTimeout(() => {
        setShowGenerateModal(false);
        setGenerateFeedback(null);
      }, 1400);
    } catch (err: unknown) {
      setGenerateError(err instanceof Error ? err.message : "Failed to generate experiment");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCreateManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualHypothesis.trim() || !manualMethod.trim() || !manualMetric.trim() || !manualThreshold.trim()) {
      alert("Hypothesis, Method, Metric, and Threshold are required.");
      return;
    }
    setIsSubmittingManual(true);
    try {
      const decisionRules = JSON.stringify({
        continue: ruleContinue.trim(),
        pivot: rulePivot.trim(),
        stop: ruleStop.trim(),
      });

      const res = await fetch(`/api/projects/${projectId}/experiments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assumptionId: manualAssumptionId || undefined,
          hypothesis: manualHypothesis.trim(),
          method: manualMethod.trim(),
          cohort: manualCohort.trim(),
          metric: manualMetric.trim(),
          threshold: manualThreshold.trim(),
          duration: manualDuration.trim(),
          cost_estimate: manualCost.trim(),
          decision_rules: decisionRules,
          status: "planned",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to create experiment");

      setShowAddModal(false);
      setManualHypothesis("");
      setManualMethod("");
      setManualCohort("");
      setManualMetric("");
      setManualThreshold("");
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to create experiment");
    } finally {
      setIsSubmittingManual(false);
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/experiments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to update status");
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to update status");
    }
  };

  const handleSaveResult = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resultTargetExp || !resultText.trim()) return;
    setIsSavingResult(true);
    try {
      // 1. Update experiment with real result and status=completed
      const res = await fetch(`/api/projects/${projectId}/experiments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: resultTargetExp.id,
          result: resultText.trim(),
          status: "completed",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to save experiment result");

      // 2. If user chose to update linked assumption
      if (resultTargetExp.assumption_id && validateAssumptionChoice !== "keep") {
        const asmRes = await fetch(`/api/projects/${encodeURIComponent(projectId)}/assumptions`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: resultTargetExp.assumption_id,
            status: validateAssumptionChoice,
          }),
        });
        const asmData = await asmRes.json();
        if (!asmRes.ok) {
          throw new Error(asmData.error?.message || "Failed to update linked assumption status");
        }
      }

      setResultTargetExp(null);
      setResultText("");
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to save experiment result");
    } finally {
      setIsSavingResult(false);
    }
  };

  const handleResultTextChange = (text: string) => {
    setResultText(text);
    if (resultTargetExp) {
      const dec = evaluateExperimentDecision(resultTargetExp, text);
      setValidateAssumptionChoice(dec.suggestedAssumptionStatus);
    }
  };

  const handleUpdateLinkedAssumption = async (
    assumptionId: string,
    newStatus: "validated" | "invalidated",
    hypothesis: string
  ) => {
    const label = newStatus === "validated" ? "VALIDATED" : "INVALIDATED";
    const confirmMsg = `Explicit Assumption Transition:\n\nMark linked assumption as ${label} based on the recorded experiment outcome?\n\nHypothesis: "${hypothesis.slice(0, 80)}…"`;
    if (!confirm(confirmMsg)) return;

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/assumptions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: assumptionId, status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to update assumption status");
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to update assumption");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to remove this experiment plan?")) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/experiments?experimentId=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to delete");
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const filtered = experiments.filter((e) => {
    if (statusFilter === "All") return true;
    return e.status === statusFilter;
  });

  const statusCounts = {
    planned: experiments.filter((e) => e.status === "planned").length,
    running: experiments.filter((e) => e.status === "running").length,
    completed: experiments.filter((e) => e.status === "completed").length,
    abandoned: experiments.filter((e) => e.status === "abandoned").length,
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
            <span style={{ color: "var(--color-accent-light)" }}>Experiments</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 style={{ fontSize: "1.75rem", fontWeight: "700", color: "var(--text-primary)" }}>
              Falsifiable Experiment Planner (F13)
            </h1>
            <span className="badge badge-accent" style={{ fontSize: "0.75rem" }}>SQLite Live</span>
          </div>
          <p style={{ color: "var(--text-secondary)", marginTop: "var(--space-1)", fontSize: "0.9rem" }}>
            Design cheap, ethical, rapid tests before writing code. Real experiment outcomes earn REAL_EXPERIMENT_RESULT evidence.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowGenerateModal(true)}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            <span>⚡</span> Generate Plan (Ollama)
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAddModal(true)}>
            + Custom Experiment
          </button>
        </div>
      </div>

      {error && (
        <div className="card mb-4" style={{ padding: "var(--space-3) var(--space-4)", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--color-error)" }}>
          ⚠️ {error}
        </div>
      )}

      {/* Status Counters Strip */}
      <div className="grid-4 mb-6" style={{ gap: "var(--space-3)" }}>
        {(["planned", "running", "completed", "abandoned"] as const).map((st) => {
          const cfg = STATUS_CONFIG[st];
          return (
            <div
              key={st}
              className="card"
              style={{
                padding: "var(--space-3) var(--space-4)",
                background: cfg.bg,
                border: `1px solid ${statusFilter === st ? cfg.color : "var(--color-border)"}`,
                cursor: "pointer",
              }}
              onClick={() => setStatusFilter(statusFilter === st ? "All" : st)}
            >
              <div style={{ fontSize: "1.5rem", fontWeight: "700", color: cfg.color }}>
                {statusCounts[st]}
              </div>
              <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                {cfg.icon} {cfg.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* Principle banner */}
      <div className="card mb-6" style={{ padding: "var(--space-4) var(--space-5)", borderLeft: "3px solid var(--color-accent)" }}>
        <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
          <strong style={{ color: "var(--text-primary)" }}>Non-Negotiable Evidence Rule:</strong> An AI-generated or mock experiment plan is NOT evidence.
          Only recorded user execution observations carry <ProvenanceBadge type="REAL_EXPERIMENT_RESULT" size="sm" />.
        </div>
      </div>

      {/* Experiment cards */}
      {loading ? (
        <div className="card text-center" style={{ padding: "var(--space-8)", color: "var(--text-muted)" }}>
          Loading experiments from SQLite...
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center" style={{ padding: "var(--space-8)", color: "var(--text-muted)" }}>
          No experiments found in this status view. Click &quot;⚡ Generate Plan (Ollama)&quot; or &quot;+ Custom Experiment&quot; to design one.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
          {filtered.map((exp: ExperimentRecord, idx) => {
            const statusConf = STATUS_CONFIG[exp.status] || STATUS_CONFIG.planned;
            const isExpanded = expanded === exp.id;
            const decision = evaluateExperimentDecision(exp);
            const decCfg = DECISION_CONFIG[decision.outcome];

            let parsedRules: { continue?: string; pivot?: string; stop?: string } = {};
            try {
              if (exp.decision_rules) {
                parsedRules = JSON.parse(exp.decision_rules);
              }
            } catch {
              parsedRules = { continue: exp.decision_rules };
            }

            return (
              <div
                key={exp.id}
                className="card"
                style={{ padding: 0, overflow: "hidden", border: "1px solid var(--color-border)" }}
              >
                {/* Header bar */}
                <div
                  style={{
                    padding: "var(--space-4) var(--space-5)",
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-4)",
                    cursor: "pointer",
                    background: "var(--color-surface-2)",
                    flexWrap: "wrap",
                  }}
                  onClick={() => setExpanded(isExpanded ? null : exp.id)}
                >
                  <div
                    style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "50%",
                      background: statusConf.bg,
                      border: `1px solid ${statusConf.color}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "1rem",
                      flexShrink: 0,
                    }}
                  >
                    {idx + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: "240px" }}>
                    <div style={{ fontSize: "0.9375rem", fontWeight: "600", color: "var(--text-primary)", lineHeight: 1.5 }}>
                      {exp.hypothesis.length > 120 ? `${exp.hypothesis.slice(0, 120)}…` : exp.hypothesis}
                    </div>
                    <div className="flex items-center gap-3 mt-1" style={{ flexWrap: "wrap" }}>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          padding: "2px 8px",
                          borderRadius: "var(--radius-sm)",
                          background: statusConf.bg,
                          border: `1px solid ${statusConf.color}`,
                          color: statusConf.color,
                        }}
                      >
                        {statusConf.icon} {statusConf.label}
                      </span>
                      {exp.result && (
                        <span
                          style={{
                            fontSize: "0.75rem",
                            padding: "2px 8px",
                            borderRadius: "var(--radius-sm)",
                            background: decCfg.bg,
                            border: `1px solid ${decCfg.border}`,
                            color: decCfg.color,
                            fontWeight: 600,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          {decCfg.icon} {decCfg.label}
                        </span>
                      )}
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>⏱ {exp.duration || "TBD"}</span>
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>💰 {exp.cost_estimate || "$0"}</span>
                      <ProvenanceBadge type={exp.provenance as any} size="sm" />
                    </div>
                  </div>

                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      className={`btn btn-sm ${exp.status !== "completed" ? "btn-primary" : "btn-secondary"}`}
                      style={{ fontSize: "0.75rem" }}
                      onClick={() => {
                        setResultTargetExp(exp);
                        const initialText = exp.result || "";
                        setResultText(initialText);
                        const initialDec = evaluateExperimentDecision(exp, initialText);
                        setValidateAssumptionChoice(initialDec.suggestedAssumptionStatus);
                      }}
                    >
                      {exp.status !== "completed" ? "📝 Record Result" : "📝 Edit Result"}
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleDelete(exp.id)}
                      style={{ fontSize: "0.75rem", color: "var(--color-error)" }}
                    >
                      ✕
                    </button>
                    <span style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginLeft: "4px" }}>
                      {isExpanded ? "▲" : "▼"}
                    </span>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div style={{ padding: "var(--space-5)" }}>
                    {/* Linked assumption */}
                    {exp.assumption_statement ? (
                      <div
                        style={{
                          marginBottom: "var(--space-4)",
                          padding: "var(--space-3) var(--space-4)",
                          borderRadius: "var(--radius-md)",
                          background: "rgba(245,158,11,0.08)",
                          border: "1px solid rgba(245,158,11,0.25)",
                          fontSize: "0.8125rem",
                        }}
                      >
                        <strong style={{ color: "#f59e0b" }}>Testing Assumption:</strong>{" "}
                        <span style={{ color: "var(--text-secondary)" }}>{exp.assumption_statement}</span>
                        {exp.assumption_uncertainty && (
                          <span style={{ marginLeft: "8px", color: "var(--text-muted)" }}>
                            ({exp.assumption_uncertainty} Uncertainty × {exp.assumption_impact} Impact)
                          </span>
                        )}
                      </div>
                    ) : (
                      <div
                        style={{
                          marginBottom: "var(--space-4)",
                          padding: "var(--space-3) var(--space-4)",
                          borderRadius: "var(--radius-md)",
                          background: "var(--color-surface-2)",
                          border: "1px dashed var(--color-border)",
                          fontSize: "0.8125rem",
                          color: "var(--text-muted)",
                        }}
                      >
                        ℹ️ Unlinked general experiment. Consider linking to a critical risk assumption.
                      </div>
                    )}

                    {/* Full hypothesis */}
                    <div style={{ marginBottom: "var(--space-4)", padding: "var(--space-4)", background: "var(--color-surface-2)", borderRadius: "var(--radius-md)" }}>
                      <div style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--text-muted)", marginBottom: "var(--space-2)" }}>
                        FULL FALSIFIABLE HYPOTHESIS
                      </div>
                      <p style={{ fontSize: "0.875rem", color: "var(--text-primary)", lineHeight: 1.7 }}>
                        {exp.hypothesis}
                      </p>
                    </div>

                    {/* Experiment parameters */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "var(--space-4)", marginBottom: "var(--space-4)" }}>
                      {[
                        { label: "Method", value: exp.method },
                        { label: "Target Cohort", value: exp.cohort || "Early adopters" },
                        { label: "Success Metric", value: exp.metric },
                        { label: "Threshold Target", value: exp.threshold },
                        { label: "Duration", value: exp.duration },
                        { label: "Cost Estimate", value: exp.cost_estimate || "$0" },
                      ].map(({ label, value }) => (
                        <div key={label} style={{ padding: "var(--space-3)", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)" }}>
                          <div style={{ fontSize: "0.7rem", fontWeight: "600", color: "var(--text-muted)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            {label}
                          </div>
                          <div style={{ fontSize: "0.875rem", color: "var(--text-primary)" }}>{value}</div>
                        </div>
                      ))}
                    </div>

                    {/* Decision rules */}
                    <div style={{ padding: "var(--space-4)", borderRadius: "var(--radius-md)", background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)", marginBottom: "var(--space-4)" }}>
                      <div style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--color-success)", marginBottom: "var(--space-2)" }}>
                        🎯 DECISION RULES
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "var(--space-3)", fontSize: "0.85rem" }}>
                        <div>
                          <strong style={{ color: "var(--color-success)" }}>Continue:</strong>{" "}
                          <span style={{ color: "var(--text-secondary)" }}>{parsedRules.continue || "Metric meets threshold."}</span>
                        </div>
                        <div>
                          <strong style={{ color: "#f59e0b" }}>Pivot:</strong>{" "}
                          <span style={{ color: "var(--text-secondary)" }}>{parsedRules.pivot || "Near threshold with specific friction noted."}</span>
                        </div>
                        <div>
                          <strong style={{ color: "var(--color-error)" }}>Stop:</strong>{" "}
                          <span style={{ color: "var(--text-secondary)" }}>{parsedRules.stop || "Clear failure to generate signal."}</span>
                        </div>
                      </div>
                    </div>

                    {/* Status switcher */}
                    <div className="flex items-center gap-3 mb-4" style={{ flexWrap: "wrap" }}>
                      <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Execution Status:</span>
                      {(["planned", "running", "completed", "abandoned"] as const).map((st) => (
                        <button
                          key={st}
                          className={`btn btn-sm ${exp.status === st ? "btn-primary" : "btn-secondary"}`}
                          style={{ fontSize: "0.75rem" }}
                          onClick={() => handleStatusChange(exp.id, st)}
                        >
                          {STATUS_CONFIG[st].icon} {STATUS_CONFIG[st].label}
                        </button>
                      ))}
                    </div>

                    {/* Real Result Display & Falsifiable Decision Loop */}
                    {exp.result ? (
                      <div>
                        {/* Observation Box */}
                        <div style={{ padding: "var(--space-4)", background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: "var(--radius-md)" }}>
                          <div className="flex justify-between items-center mb-2">
                            <span style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--color-success)" }}>
                              REAL EXPERIMENT EXECUTION OBSERVATION
                            </span>
                            <ProvenanceBadge type="REAL_EXPERIMENT_RESULT" size="sm" />
                          </div>
                          <p style={{ fontSize: "0.875rem", color: "var(--text-primary)", lineHeight: 1.6, margin: 0 }}>
                            {exp.result}
                          </p>
                        </div>

                        {/* Evidence-Based Hypothesis Evaluation & Decision Loop Card */}
                        <div
                          style={{
                            marginTop: "var(--space-4)",
                            padding: "var(--space-4) var(--space-5)",
                            background: decCfg.bg,
                            border: `1px solid ${decCfg.border}`,
                            borderRadius: "var(--radius-md)",
                          }}
                        >
                          <div className="flex justify-between items-center mb-3" style={{ flexWrap: "wrap", gap: "8px" }}>
                            <div className="flex items-center gap-2">
                              <span
                                style={{
                                  fontSize: "0.8125rem",
                                  fontWeight: 700,
                                  padding: "3px 10px",
                                  borderRadius: "var(--radius-sm)",
                                  background: decCfg.bg,
                                  border: `1px solid ${decCfg.border}`,
                                  color: decCfg.color,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "6px",
                                }}
                              >
                                <span>{decCfg.icon}</span>
                                <span>Decision Outcome: {decCfg.label}</span>
                              </span>
                              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                                Falsifiable Hypothesis Evaluation
                              </span>
                            </div>
                            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                              Deterministic Comparison (Zero AI Speculation)
                            </span>
                          </div>

                          {/* Predefined Criterion vs Observed Measurement Comparison */}
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "var(--space-3)", marginBottom: "var(--space-3)" }}>
                            <div style={{ padding: "var(--space-3)", background: "var(--color-surface)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)" }}>
                              <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
                                Predefined Success Threshold
                              </div>
                              <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-primary)", marginTop: "2px" }}>
                                {exp.threshold}
                              </div>
                              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "2px" }}>
                                Metric: {exp.metric} ({decision.thresholdCriteria?.direction === "lower_is_better" ? "Lower is better (<=)" : "Higher is better (>=)"})
                              </div>
                            </div>

                            <div style={{ padding: "var(--space-3)", background: "var(--color-surface)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)" }}>
                              <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
                                Observed Measurement
                              </div>
                              <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: decCfg.color, marginTop: "2px" }}>
                                {decision.observedMeasurement.extractedContext || (decision.observedMeasurement.numericValue !== null ? `${decision.observedMeasurement.numericValue}${decision.observedMeasurement.unit || ""}` : "Qualitative observation only")}
                              </div>
                              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "2px" }}>
                                Status: {decision.isQuantitative ? "Quantitative data extracted" : "Non-numeric observation"}
                              </div>
                            </div>
                          </div>

                          {/* Concise Explanation */}
                          <div style={{ fontSize: "0.85rem", color: "var(--text-primary)", lineHeight: 1.6, marginBottom: exp.assumption_id ? "var(--space-3)" : 0 }}>
                            <strong>Decision Rationale:</strong> {decision.explanation}
                          </div>

                          {/* Linked Risk Assumption Traceability & Action */}
                          {exp.assumption_id && (
                            <div
                              style={{
                                padding: "var(--space-3)",
                                background: "rgba(255,255,255,0.03)",
                                border: "1px dashed var(--color-border)",
                                borderRadius: "var(--radius-sm)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                flexWrap: "wrap",
                                gap: "8px",
                                fontSize: "0.8125rem",
                              }}
                            >
                              <div style={{ maxWidth: "480px" }}>
                                <span style={{ color: "var(--text-muted)" }}>Linked Risk Assumption:</span>{" "}
                                <strong style={{ color: "var(--text-secondary)" }}>{exp.assumption_statement || exp.assumption_id}</strong>
                              </div>
                              <div className="flex items-center gap-2">
                                {decision.outcome === "supported" && (
                                  <button
                                    className="btn btn-sm"
                                    style={{ fontSize: "0.75rem", background: "var(--color-success)", color: "#fff", border: "none" }}
                                    onClick={() => handleUpdateLinkedAssumption(exp.assumption_id!, "validated", exp.hypothesis)}
                                  >
                                    Mark Assumption as VALIDATED
                                  </button>
                                )}
                                {decision.outcome === "rejected" && (
                                  <button
                                    className="btn btn-sm"
                                    style={{ fontSize: "0.75rem", background: "var(--color-error)", color: "#fff", border: "none" }}
                                    onClick={() => handleUpdateLinkedAssumption(exp.assumption_id!, "invalidated", exp.hypothesis)}
                                  >
                                    Mark Assumption as INVALIDATED
                                  </button>
                                )}
                                {decision.outcome === "inconclusive" && (
                                  <span style={{ fontSize: "0.75rem", color: "#f59e0b", fontStyle: "italic" }}>
                                    Evidence inconclusive — assumption status unchanged
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div
                        style={{
                          padding: "var(--space-3) var(--space-4)",
                          borderRadius: "var(--radius-md)",
                          background: "var(--color-surface-2)",
                          border: "1px dashed var(--color-border)",
                          fontSize: "0.8125rem",
                          color: "var(--text-muted)",
                          textAlign: "center",
                        }}
                      >
                        ⏳ No execution results recorded yet. Click &quot;📝 Record Result&quot; to log observations and evaluate whether the hypothesis is Supported or Rejected.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* AI Generate Plan Modal */}
      {showGenerateModal && (
        <div className="modal-backdrop" onClick={() => !isGenerating && setShowGenerateModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "560px" }}>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: "var(--space-2)" }}>
              ⚡ AI Experiment Designer (Ollama)
            </h3>
            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "var(--space-4)" }}>
              Generates a rigorous, falsifiable experiment plan with concrete metrics and stop/pivot/continue rules.
            </p>

            {generateError && (
              <div
                className="card mb-4"
                style={{
                  padding: "var(--space-3) var(--space-4)",
                  background: "rgba(239,68,68,0.1)",
                  border: "1px solid rgba(239,68,68,0.3)",
                  color: "var(--color-error)",
                  fontSize: "0.85rem",
                }}
              >
                ⚠️ {generateError}
              </div>
            )}

            {generateFeedback ? (
              <div className="card" style={{ padding: "var(--space-4)", background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", color: "var(--color-success)" }}>
                ✅ {generateFeedback}
              </div>
            ) : (
              <form onSubmit={handleGenerate}>
                <div className="mb-4">
                  <label className="label">Assumption to Test *</label>
                  <select
                    className="input"
                    value={selectedAssumptionId}
                    onChange={(e) => setSelectedAssumptionId(e.target.value)}
                    style={{ width: "100%" }}
                  >
                    <option value="">Auto-select highest risk unvalidated assumption</option>
                    {assumptions.map((a) => (
                      <option key={a.id} value={a.id}>
                        [{a.uncertainty}×{a.impact}] {a.statement.slice(0, 70)}… ({a.status})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mb-5">
                  <label className="label">Preferred Testing Method (Optional)</label>
                  <select
                    className="input"
                    value={generateMethod}
                    onChange={(e) => setGenerateMethod(e.target.value)}
                    style={{ width: "100%" }}
                  >
                    <option value="">Let AI choose optimal low-cost method</option>
                    <option value="Concierge MVP">Concierge MVP (Manual service behind the scenes)</option>
                    <option value="Smoke Test Landing Page">Smoke Test Landing Page (Ad traffic & signup intent)</option>
                    <option value="Wizard of Oz">Wizard of Oz (Simulated backend automation)</option>
                    <option value="Interactive Prototype Walkthrough">Interactive Prototype Walkthrough (Figma test)</option>
                    <option value="Pre-sale / LOI Campaign">Pre-sale / Letter of Intent Campaign (Willingness to pay)</option>
                  </select>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={isGenerating}
                    onClick={() => setShowGenerateModal(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={isGenerating}>
                    {isGenerating ? "Designing Experiment..." : "Generate Experiment"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Manual Custom Experiment Modal */}
      {showAddModal && (
        <div className="modal-backdrop" onClick={() => !isSubmittingManual && setShowAddModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "600px", maxHeight: "90vh", overflowY: "auto" }}>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: "var(--space-4)" }}>
              + Design Custom Experiment
            </h3>
            <form onSubmit={handleCreateManual}>
              <div className="mb-4">
                <label className="label">Linked Assumption</label>
                <select
                  className="input"
                  value={manualAssumptionId}
                  onChange={(e) => setManualAssumptionId(e.target.value)}
                  style={{ width: "100%" }}
                >
                  <option value="">None (General exploration)</option>
                  {assumptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      [{a.uncertainty}] {a.statement.slice(0, 65)}…
                    </option>
                  ))}
                </select>
              </div>

              <div className="mb-4">
                <label className="label">Falsifiable Hypothesis *</label>
                <textarea
                  className="input"
                  rows={2}
                  required
                  placeholder="If we [test action], then [measurable student response]..."
                  value={manualHypothesis}
                  onChange={(e) => setManualHypothesis(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>

              <div className="grid-2 mb-4" style={{ gap: "var(--space-3)" }}>
                <div>
                  <label className="label">Method *</label>
                  <input
                    type="text"
                    className="input"
                    required
                    placeholder="e.g. Concierge MVP, WhatsApp Bot"
                    value={manualMethod}
                    onChange={(e) => setManualMethod(e.target.value)}
                    style={{ width: "100%" }}
                  />
                </div>
                <div>
                  <label className="label">Cohort / Audience</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. 30 midterms students"
                    value={manualCohort}
                    onChange={(e) => setManualCohort(e.target.value)}
                    style={{ width: "100%" }}
                  />
                </div>
              </div>

              <div className="grid-2 mb-4" style={{ gap: "var(--space-3)" }}>
                <div>
                  <label className="label">Primary Metric *</label>
                  <input
                    type="text"
                    className="input"
                    required
                    placeholder="e.g. 7-day retention, click-through %"
                    value={manualMetric}
                    onChange={(e) => setManualMetric(e.target.value)}
                    style={{ width: "100%" }}
                  />
                </div>
                <div>
                  <label className="label">Success Threshold *</label>
                  <input
                    type="text"
                    className="input"
                    required
                    placeholder="e.g. >= 40% active sessions"
                    value={manualThreshold}
                    onChange={(e) => setManualThreshold(e.target.value)}
                    style={{ width: "100%" }}
                  />
                </div>
              </div>

              <div className="grid-2 mb-4" style={{ gap: "var(--space-3)" }}>
                <div>
                  <label className="label">Duration</label>
                  <input
                    type="text"
                    className="input"
                    value={manualDuration}
                    onChange={(e) => setManualDuration(e.target.value)}
                    style={{ width: "100%" }}
                  />
                </div>
                <div>
                  <label className="label">Cost Estimate</label>
                  <input
                    type="text"
                    className="input"
                    value={manualCost}
                    onChange={(e) => setManualCost(e.target.value)}
                    style={{ width: "100%" }}
                  />
                </div>
              </div>

              <div className="mb-4">
                <label className="label">Decision Rules</label>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <input
                    type="text"
                    className="input"
                    placeholder="Continue rule (e.g. >= 40% threshold met)"
                    value={ruleContinue}
                    onChange={(e) => setRuleContinue(e.target.value)}
                    style={{ width: "100%" }}
                  />
                  <input
                    type="text"
                    className="input"
                    placeholder="Pivot rule (e.g. 20-39% with positive qualitative feedback)"
                    value={rulePivot}
                    onChange={(e) => setRulePivot(e.target.value)}
                    style={{ width: "100%" }}
                  />
                  <input
                    type="text"
                    className="input"
                    placeholder="Stop rule (e.g. < 20% engagement after 3 reminders)"
                    value={ruleStop}
                    onChange={(e) => setRuleStop(e.target.value)}
                    style={{ width: "100%" }}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={isSubmittingManual}
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={isSubmittingManual}>
                  {isSubmittingManual ? "Saving..." : "Save Experiment Plan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Result Modal */}
      {resultTargetExp && (
        <div className="modal-backdrop" onClick={() => !isSavingResult && setResultTargetExp(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "560px" }}>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: "var(--space-2)" }}>
              📝 Record Real Experiment Result
            </h3>
            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "var(--space-4)" }}>
              Input observed quantitative data from the experiment. This marks the experiment as Completed and grants it REAL_EXPERIMENT_RESULT provenance.
            </p>

            <form onSubmit={handleSaveResult}>
              <div className="mb-4">
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                  Hypothesis being evaluated:
                </div>
                <div style={{ fontSize: "0.85rem", color: "var(--text-primary)", padding: "var(--space-2) var(--space-3)", background: "var(--color-surface-2)", borderRadius: "var(--radius-sm)" }}>
                  {resultTargetExp.hypothesis}
                </div>
              </div>

              <div className="grid-2 mb-4" style={{ gap: "var(--space-3)" }}>
                <div style={{ padding: "var(--space-2) var(--space-3)", background: "var(--color-surface)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)" }}>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>Success Metric</div>
                  <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-secondary)", marginTop: "2px" }}>{resultTargetExp.metric}</div>
                </div>
                <div style={{ padding: "var(--space-2) var(--space-3)", background: "var(--color-surface)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)" }}>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>Success Threshold</div>
                  <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--color-accent-light)", marginTop: "2px" }}>{resultTargetExp.threshold}</div>
                </div>
              </div>

              <div className="mb-3">
                <label className="label">Observed Results & Data *</label>
                <textarea
                  className="input"
                  rows={4}
                  required
                  placeholder="e.g. Recruited 32 students. 18 completed all 3 study blocks (56% vs 40% threshold). 7 students voluntarily shared the WhatsApp link with peers."
                  value={resultText}
                  onChange={(e) => handleResultTextChange(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>

              {/* Live Decision Preview */}
              {resultText.trim() && (
                (() => {
                  const liveDec = evaluateExperimentDecision(resultTargetExp, resultText);
                  const cfg = DECISION_CONFIG[liveDec.outcome];
                  return (
                    <div
                      style={{
                        marginBottom: "var(--space-4)",
                        padding: "var(--space-3)",
                        borderRadius: "var(--radius-sm)",
                        background: cfg.bg,
                        border: `1px solid ${cfg.border}`,
                      }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span style={{ fontSize: "0.75rem", fontWeight: 700, color: cfg.color, display: "inline-flex", alignItems: "center", gap: "4px" }}>
                          <span>{cfg.icon}</span> Live Decision Preview: {cfg.label}
                        </span>
                        <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                          Threshold: {resultTargetExp.threshold}
                        </span>
                      </div>
                      <p style={{ fontSize: "0.8125rem", color: "var(--text-primary)", margin: 0, lineHeight: 1.5 }}>
                        {liveDec.explanation}
                      </p>
                    </div>
                  );
                })()
              )}

              {resultTargetExp.assumption_id && (
                <div className="mb-4">
                  <label className="label">Update Linked Assumption Status</label>
                  <select
                    className="input"
                    value={validateAssumptionChoice}
                    onChange={(e) => setValidateAssumptionChoice(e.target.value as any)}
                    style={{ width: "100%" }}
                  >
                    <option value="validated">Mark Assumption as VALIDATED</option>
                    <option value="invalidated">Mark Assumption as INVALIDATED (Disproven)</option>
                    <option value="keep">Keep Current Status</option>
                  </select>
                  <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "4px" }}>
                    ℹ️ Assumption updates are explicit and traceable. Recording observations never silently validates an assumption.
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={isSavingResult}
                  onClick={() => setResultTargetExp(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={isSavingResult || !resultText.trim()}>
                  {isSavingResult ? "Saving..." : "Save Result (REAL_EXPERIMENT_RESULT)"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ExperimentsPage() {
  return (
    <Suspense fallback={<div className="page-container">Loading experiments...</div>}>
      <ExperimentsContent />
    </Suspense>
  );
}
