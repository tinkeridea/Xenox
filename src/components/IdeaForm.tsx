"use client";

import React, { useState, useId, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { IdeaFormValues, IdeaFormErrors, ClarifyingQuestion } from "@/types";
import { DEMO_PROJECT, SAMPLE_CLARIFYING_QUESTIONS } from "@/lib/mockData";
import { ProvenanceBadge } from "@/components/Badges";

const CATEGORY_OPTIONS = [
  "",
  "EdTech",
  "FinTech",
  "HealthTech",
  "AgriTech",
  "B2B SaaS",
  "Consumer App",
  "Marketplace",
  "Developer Tools",
  "DeepTech",
  "Other",
];

const STAGE_OPTIONS = [
  "Raw Idea / Concept",
  "Problem Validation (Talking to users)",
  "Prototype / MVP in progress",
  "Pre-launch / Pilot batch",
  "Early Traction",
];

export function IdeaForm() {
  const router = useRouter();
  const formId = useId();

  // Form Step: 1 = Initial Intake, 2 = Idea Clarification (Decision D12)
  const [step, setStep] = useState<1 | 2>(1);

  const [values, setValues] = useState<IdeaFormValues>({
    title: "",
    problem: "",
    targetCustomer: "",
    solution: "",
    geography: "",
    category: "",
    alternatives: "",
    stage: "Raw Idea / Concept",
    constraints: "",
    goals: "",
  });

  const [clarifyingQuestions, setClarifyingQuestions] = useState<ClarifyingQuestion[]>(
    SAMPLE_CLARIFYING_QUESTIONS
  );

  const [errors, setErrors] = useState<IdeaFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Validation ─────────────────────────────────────────────────────

  function validate(vals: IdeaFormValues): IdeaFormErrors {
    const errs: IdeaFormErrors = {};
    if (!vals.title.trim()) errs.title = "Project / Idea title is required.";
    if (!vals.problem.trim()) errs.problem = "Problem statement is required (min 20 characters).";
    else if (vals.problem.trim().length < 20) errs.problem = "Please describe the problem in at least 20 characters.";

    if (!vals.targetCustomer.trim()) errs.targetCustomer = "Target customer / ICP is required.";
    if (!vals.solution.trim()) errs.solution = "Proposed solution is required.";
    return errs;
  }

  // ── Handlers ───────────────────────────────────────────────────────

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setValues((prev) => ({ ...prev, [name]: value }));
    if (errors[name as keyof IdeaFormValues]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const handleClarificationChange = (id: string, answer: string) => {
    setClarifyingQuestions((prev) =>
      prev.map((q) => (q.id === id ? { ...q, answer } : q))
    );
  };

  const handleLoadDemo = useCallback(() => {
    setValues({
      title: DEMO_PROJECT.title,
      problem: DEMO_PROJECT.problem,
      targetCustomer: DEMO_PROJECT.targetCustomer,
      solution: DEMO_PROJECT.solution,
      geography: DEMO_PROJECT.geography ?? "",
      category: DEMO_PROJECT.category ?? "EdTech",
      alternatives: DEMO_PROJECT.alternatives ?? "",
      stage: DEMO_PROJECT.stage ?? "Problem Validation",
      constraints: DEMO_PROJECT.constraints ?? "",
      goals: DEMO_PROJECT.goals ?? "",
    });
    setErrors({});
  }, []);

  const handleProceedToClarification = (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate(values);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setStep(2);
  };

  const [apiErrorMsg, setApiErrorMsg] = useState<string | null>(null);

  const handleFinalSubmit = async () => {
    setIsSubmitting(true);
    setApiErrorMsg(null);
    try {
      // Append answered clarifications into constraints/goals if present
      const answeredClarifications = clarifyingQuestions
        .filter((q) => q.answer && q.answer.trim().length > 0)
        .map((q) => `[Clarification] ${q.question} -> ${q.answer}`)
        .join("\n");

      const enrichedConstraints = values.constraints
        ? `${values.constraints}\n\n${answeredClarifications}`.trim()
        : answeredClarifications;

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: values.title,
          problem: values.problem,
          target_customer: values.targetCustomer,
          solution: values.solution,
          geography: values.geography,
          category: values.category,
          alternatives: values.alternatives,
          stage: values.stage,
          constraints: enrichedConstraints,
          goals: values.goals,
          mode: "LIVE",
          provenance: "USER_INPUT",
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || "Failed to create project in database.");
      }

      const { projectId, runId } = json.data;
      router.push(`/runs/${runId}?projectId=${projectId}`);
    } catch (err: any) {
      console.error("Submission failed:", err);
      setApiErrorMsg(err.message || "An unexpected error occurred while saving.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="card" style={{ padding: "var(--space-6)" }}>
      {apiErrorMsg && (
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
          <strong>Submission Error:</strong> {apiErrorMsg}
        </div>
      )}
      {/* Top Banner & Demo Loader */}
      <div
        className="flex justify-between items-center"
        style={{
          flexWrap: "wrap",
          gap: "var(--space-3)",
          background: "var(--color-surface-2)",
          padding: "var(--space-4)",
          borderRadius: "var(--radius-md)",
          marginBottom: "var(--space-6)",
        }}
      >
        <div>
          <div style={{ fontSize: "0.875rem", fontWeight: "600", color: "var(--text-primary)" }}>
            Step {step} of 2: {step === 1 ? "Core Validation Intake (F01)" : "Idea Clarification (Decision D12)"}
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "2px" }}>
            {step === 1
              ? "Fields left blank will be explicitly labeled as ASSUMPTIONS in downstream modules."
              : "Refine ambiguous hypotheses with AI-generated clarification prompts."}
          </div>
        </div>

        {step === 1 && (
          <button
            type="button"
            onClick={handleLoadDemo}
            className="btn btn-secondary btn-sm"
            id="btn-load-demo-data"
          >
            📋 Populate with Demo Fixture (Study Planner)
          </button>
        )}
      </div>

      {/* STEP 1: Core Intake Form */}
      {step === 1 && (
        <form onSubmit={handleProceedToClarification} noValidate>
          {/* Idea Title */}
          <div className="form-group mb-4">
            <label htmlFor={`${formId}-title`} className="form-label">
              Project / Idea Title <span className="form-label-required">*</span>
            </label>
            <input
              id={`${formId}-title`}
              name="title"
              type="text"
              className={`form-input ${errors.title ? "error" : ""}`}
              placeholder="e.g. AI Adaptive Study Planner for College Students"
              value={values.title}
              onChange={handleChange}
            />
            {errors.title && <p className="form-error">{errors.title}</p>}
          </div>

          {/* Problem Statement */}
          <div className="form-group mb-4">
            <label htmlFor={`${formId}-problem`} className="form-label">
              Problem Statement <span className="form-label-required">*</span>
            </label>
            <textarea
              id={`${formId}-problem`}
              name="problem"
              className={`form-textarea ${errors.problem ? "error" : ""}`}
              rows={3}
              placeholder="What painful friction or unaddressed need does your customer experience?"
              value={values.problem}
              onChange={handleChange}
            />
            {errors.problem && <p className="form-error">{errors.problem}</p>}
          </div>

          <div className="grid-2 mb-4">
            {/* Target Customer */}
            <div className="form-group">
              <label htmlFor={`${formId}-targetCustomer`} className="form-label">
                Target Customer / ICP <span className="form-label-required">*</span>
              </label>
              <input
                id={`${formId}-targetCustomer`}
                name="targetCustomer"
                type="text"
                className={`form-input ${errors.targetCustomer ? "error" : ""}`}
                placeholder="e.g. Undergrad engineering students with 5+ concurrent exams"
                value={values.targetCustomer}
                onChange={handleChange}
              />
              {errors.targetCustomer && <p className="form-error">{errors.targetCustomer}</p>}
            </div>

            {/* Category */}
            <div className="form-group">
              <label htmlFor={`${formId}-category`} className="form-label">
                Industry / Category
              </label>
              <select
                id={`${formId}-category`}
                name="category"
                className="form-input"
                value={values.category}
                onChange={handleChange}
              >
                {CATEGORY_OPTIONS.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat || "Select a category (optional)"}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Proposed Solution */}
          <div className="form-group mb-4">
            <label htmlFor={`${formId}-solution`} className="form-label">
              Proposed Solution <span className="form-label-required">*</span>
            </label>
            <textarea
              id={`${formId}-solution`}
              name="solution"
              className={`form-textarea ${errors.solution ? "error" : ""}`}
              rows={3}
              placeholder="How does your product solve this problem? What is the core mechanism?"
              value={values.solution}
              onChange={handleChange}
            />
            {errors.solution && <p className="form-error">{errors.solution}</p>}
          </div>

          <div className="grid-2 mb-4">
            {/* Geography / Market */}
            <div className="form-group">
              <label htmlFor={`${formId}-geography`} className="form-label">
                Target Geography / Market
                <span className="text-muted text-xs" style={{ marginLeft: "6px" }}>(Assumed if blank)</span>
              </label>
              <input
                id={`${formId}-geography`}
                name="geography"
                type="text"
                className="form-input"
                placeholder="e.g. India (Tier 1 & Tier 2 university cities)"
                value={values.geography}
                onChange={handleChange}
              />
            </div>

            {/* Current Stage */}
            <div className="form-group">
              <label htmlFor={`${formId}-stage`} className="form-label">
                Current Venture Stage
              </label>
              <select
                id={`${formId}-stage`}
                name="stage"
                className="form-input"
                value={values.stage}
                onChange={handleChange}
              >
                {STAGE_OPTIONS.map((stg) => (
                  <option key={stg} value={stg}>
                    {stg}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Current Alternatives */}
          <div className="form-group mb-4">
            <label htmlFor={`${formId}-alternatives`} className="form-label">
              Current Alternatives / Status Quo
              <span className="text-muted text-xs" style={{ marginLeft: "6px" }}>(Assumed if blank)</span>
            </label>
            <textarea
              id={`${formId}-alternatives`}
              name="alternatives"
              className="form-textarea"
              rows={2}
              placeholder="What do customers use right now instead? (e.g. Notion, Excel, sticky notes, WhatsApp groups)"
              value={values.alternatives}
              onChange={handleChange}
            />
          </div>

          <div className="grid-2 mb-6">
            {/* Constraints & Budget */}
            <div className="form-group">
              <label htmlFor={`${formId}-constraints`} className="form-label">
                Resource &amp; Capital Constraints
                <span className="text-muted text-xs" style={{ marginLeft: "6px" }}>(Assumed if blank)</span>
              </label>
              <input
                id={`${formId}-constraints`}
                name="constraints"
                type="text"
                className="form-input"
                placeholder="e.g. Solo technical founder, zero marketing budget"
                value={values.constraints}
                onChange={handleChange}
              />
            </div>

            {/* Validation Goals */}
            <div className="form-group">
              <label htmlFor={`${formId}-goals`} className="form-label">
                Validation Goals &amp; Metrics
                <span className="text-muted text-xs" style={{ marginLeft: "6px" }}>(Assumed if blank)</span>
              </label>
              <input
                id={`${formId}-goals`}
                name="goals"
                type="text"
                className="form-input"
                placeholder="e.g. 50 pilot signups, 40% 30-day retention"
                value={values.goals}
                onChange={handleChange}
              />
            </div>
          </div>

          {/* Action Row */}
          <div className="flex justify-between items-center" style={{ borderTop: "1px solid var(--color-border)", paddingTop: "var(--space-4)" }}>
            <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
              Data provenance: <ProvenanceBadge type="USER_INPUT" size="sm" />
            </span>

            <button type="submit" className="btn btn-primary" id="btn-next-clarification">
              Proceed to Clarification (Step 2) →
            </button>
          </div>
        </form>
      )}

      {/* STEP 2: Idea Clarification (Decision D12 / J7) */}
      {step === 2 && (
        <div className="animate-fade-in">
          <div style={{ marginBottom: "var(--space-6)" }}>
            <h3 style={{ fontSize: "1.125rem", fontWeight: "600", color: "var(--text-primary)", marginBottom: "var(--space-2)" }}>
              Hypothesis Clarification Prompts
            </h3>
            <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>
              Our clarification engine surfaced key ambiguities in your initial brief. Answering them improves
              downstream research precision; skipping them automatically registers explicit assumptions in your Risk Register.
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", marginBottom: "var(--space-6)" }}>
            {clarifyingQuestions.map((q, idx) => (
              <div
                key={q.id}
                style={{
                  background: "var(--color-surface-2)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)",
                  padding: "var(--space-4)",
                }}
              >
                <div className="flex justify-between items-center mb-2">
                  <span style={{ fontSize: "0.8125rem", fontWeight: "600", color: "var(--color-accent-light)" }}>
                    Question {idx + 1} ({q.category.toUpperCase()})
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    {q.answer ? "Answered" : "Unanswered (Assumption Default)"}
                  </span>
                </div>

                <p style={{ fontSize: "0.875rem", color: "var(--text-primary)", marginBottom: "var(--space-3)", fontWeight: "500" }}>
                  {q.question}
                </p>

                <input
                  type="text"
                  className="form-input"
                  style={{ marginBottom: "var(--space-2)" }}
                  placeholder="Provide your specific answer, or leave blank to accept default assumption..."
                  value={q.answer || ""}
                  onChange={(e) => handleClarificationChange(q.id, e.target.value)}
                />

                <div style={{ fontSize: "0.75rem", color: "var(--badge-assumption)", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>❓ Default Assumption:</span>
                  <span>{q.assumptionIfBlank}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Step 2 Actions */}
          <div className="flex justify-between items-center" style={{ borderTop: "1px solid var(--color-border)", paddingTop: "var(--space-4)" }}>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="btn btn-secondary"
              disabled={isSubmitting}
            >
              ← Back to Intake Form
            </button>

            <button
              type="button"
              onClick={handleFinalSubmit}
              className="btn btn-primary"
              id="btn-launch-validation"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Launching Validation Pipeline..." : "Save Draft & Launch Validation Shell →"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
