import React from "react";
import { IdeaForm } from "@/components/IdeaForm";

export const metadata = {
  title: "New Validation Intake — IdeaProbe",
  description: "Capture founder idea, problem statement, audience, and constraints for structured validation.",
};

export default function NewIntakePage() {
  return (
    <div className="page-container animate-fade-in" style={{ maxWidth: "800px", margin: "0 auto" }}>
      <div className="flex justify-between items-center mb-6" style={{ flexWrap: "wrap", gap: "var(--space-2)" }}>
        <div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: "700", color: "var(--text-primary)" }}>
            New Idea Validation Intake
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem", marginTop: "var(--space-1)" }}>
            Feature F01: Structured capture of venture hypotheses and baseline constraints.
          </p>
        </div>
      </div>

      <IdeaForm />
    </div>
  );
}
