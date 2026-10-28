/**
 * IdeaProbe — Stage Status Reconciliation Engine (Phase 3J)
 *
 * Authoritative single source of truth for pipeline stage statuses.
 * Evaluates real project entity counts and metadata from SQLite to
 * determine and persist accurate stage statuses in the `stages` table.
 *
 * Core Principles:
 * 1. Deterministic source of truth for each of the 10 stages.
 * 2. Preserves 'queued', 'running', 'completed', and 'failed' semantics.
 * 3. Does not assume a stage is completed merely because a related record exists.
 * 4. Idempotent: multiple passes do not churn timestamps or corrupt state.
 * 5. Strict project isolation and LIVE vs DEMO separation.
 * 6. Keeps parent `runs` table status in sync with stage progression.
 */

import { initDb, getDb, nowUtc } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import type { StageKey, StageStatus, RunStatus, ProvenanceType } from "@/types";
import { STAGE_KEYS } from "@/types";

export interface StageTargetState {
  status: StageStatus;
  outputJson: Record<string, unknown> | null;
  provenance: ProvenanceType;
}

export interface ReconciledStageRow {
  id: string;
  runId: string;
  stageKey: StageKey;
  status: StageStatus;
  attempt: number;
  outputJson: unknown;
  startedAt?: string | null;
  completedAt?: string | null;
  safeError?: string | null;
}

export interface ProjectEntityCounts {
  evidenceCount: number;
  sourceCount: number;
  competitorCount: number;
  personaCount: number;
  interviewCount: number;
  insightCount: number;
  assumptionCount: number;
  experimentsTotal: number;
  experimentsCompleted: number;
  experimentsAbandoned: number;
  mvpCount: number;
  reportSnapshotCount: number;
  targetCustomer: string | null;
}

export interface ReconcileResult {
  projectId: string;
  runId: string;
  runStatus: RunStatus;
  completedStagesCount: number;
  totalStagesCount: number;
  stages: ReconciledStageRow[];
}

/**
 * Pure evaluation function that determines the target state for a given stage
 * based on project mode, brief, and entity counts.
 */
export function determineStageState(
  stageKey: StageKey,
  counts: ProjectEntityCounts,
  isDemo: boolean
): StageTargetState {
  switch (stageKey) {
    case "research": {
      if (counts.evidenceCount > 0) {
        const prov: ProvenanceType = isDemo ? "SAMPLE" : "REAL_SOURCE";
        return {
          status: "completed",
          provenance: prov,
          outputJson: {
            _label: prov,
            provenance: prov,
            summary: `${counts.evidenceCount} evidence items linked to ${counts.sourceCount} registered sources in SQLite ledger.`,
            itemCount: counts.evidenceCount,
          },
        };
      }
      if (counts.sourceCount > 0) {
        const prov: ProvenanceType = isDemo ? "SAMPLE" : "REAL_SOURCE";
        return {
          status: "running",
          provenance: prov,
          outputJson: {
            _label: prov,
            provenance: prov,
            summary: `${counts.sourceCount} registered sources identified. Evidence extraction in progress.`,
            itemCount: counts.sourceCount,
          },
        };
      }
      return { status: "queued", provenance: "USER_INPUT", outputJson: null };
    }

    case "competitors": {
      if (counts.competitorCount > 0) {
        const prov: ProvenanceType = isDemo ? "SAMPLE" : "AI_INFERENCE";
        return {
          status: "completed",
          provenance: prov,
          outputJson: {
            _label: prov,
            provenance: prov,
            summary: `${counts.competitorCount} alternative and substitute solutions mapped across direct, indirect, and status quo categories.`,
            itemCount: counts.competitorCount,
          },
        };
      }
      return { status: "queued", provenance: "USER_INPUT", outputJson: null };
    }

    case "icp": {
      const tc = counts.targetCustomer?.trim();
      if (tc && tc.length > 0) {
        const prov: ProvenanceType = isDemo ? "SAMPLE" : "USER_INPUT";
        const summary = isDemo
          ? "High-priority ICP baseline defined: Undergraduate engineering students with active backlog pressure."
          : `Target Customer Baseline defined: ${tc.slice(0, 110)}${tc.length > 110 ? "..." : ""}`;
        return {
          status: "completed",
          provenance: prov,
          outputJson: {
            _label: prov,
            provenance: prov,
            summary,
          },
        };
      }
      return { status: "queued", provenance: "USER_INPUT", outputJson: null };
    }

    case "personas": {
      if (counts.personaCount > 0) {
        return {
          status: "completed",
          provenance: "SIMULATED",
          outputJson: {
            _label: "SIMULATED",
            provenance: "SIMULATED",
            summary: `${counts.personaCount} simulated persona hypotheses drafted. Strictly labeled as assumptions.`,
            caveat: "SIMULATED ARTIFACT — Not real customer evidence.",
            itemCount: counts.personaCount,
          },
        };
      }
      return { status: "queued", provenance: "SIMULATED", outputJson: null };
    }

    case "interviews": {
      if (counts.interviewCount > 0) {
        return {
          status: "completed",
          provenance: "SIMULATED",
          outputJson: {
            _label: "SIMULATED",
            provenance: "SIMULATED",
            summary: `${counts.interviewCount} synthetic interview simulations with interactive chat turns.`,
            caveat: "NEVER use synthetic interviews as proof of market demand.",
            itemCount: counts.interviewCount,
          },
        };
      }
      return { status: "queued", provenance: "SIMULATED", outputJson: null };
    }

    case "insights": {
      if (counts.insightCount > 0) {
        return {
          status: "completed",
          provenance: "AI_INFERENCE",
          outputJson: {
            _label: "AI_INFERENCE",
            provenance: "AI_INFERENCE",
            summary: `${counts.insightCount} insights synthesized from evidence ledger via Ollama inference.`,
            itemCount: counts.insightCount,
          },
        };
      }
      return { status: "queued", provenance: "AI_INFERENCE", outputJson: null };
    }

    case "risks": {
      if (counts.assumptionCount > 0) {
        const prov: ProvenanceType = isDemo ? "SAMPLE" : "AI_INFERENCE";
        return {
          status: "completed",
          provenance: prov,
          outputJson: {
            _label: prov,
            provenance: prov,
            summary: `${counts.assumptionCount} critical assumptions ranked by Impact × Uncertainty.`,
            itemCount: counts.assumptionCount,
          },
        };
      }
      return { status: "queued", provenance: "AI_INFERENCE", outputJson: null };
    }

    case "experiments": {
      if (counts.experimentsTotal === 0) {
        return { status: "queued", provenance: "AI_INFERENCE", outputJson: null };
      }
      if (counts.experimentsCompleted > 0) {
        const prov: ProvenanceType = isDemo ? "SAMPLE" : "REAL_EXPERIMENT_RESULT";
        return {
          status: "completed",
          provenance: prov,
          outputJson: {
            _label: prov,
            provenance: prov,
            summary: `${counts.experimentsCompleted} of ${counts.experimentsTotal} falsifiable experiments completed with recorded outcomes.`,
            itemCount: counts.experimentsCompleted,
          },
        };
      }
      if (counts.experimentsAbandoned === counts.experimentsTotal) {
        const prov: ProvenanceType = isDemo ? "SAMPLE" : "AI_INFERENCE";
        return {
          status: "failed",
          provenance: prov,
          outputJson: {
            _label: prov,
            provenance: prov,
            summary: `All ${counts.experimentsTotal} planned experiments were abandoned without completion.`,
          },
        };
      }
      // Experiments exist, but none completed yet -> running
      const prov: ProvenanceType = isDemo ? "SAMPLE" : "AI_INFERENCE";
      return {
        status: "running",
        provenance: prov,
        outputJson: {
          _label: prov,
          provenance: prov,
          summary: `${counts.experimentsTotal} falsifiable experiments planned/in progress with decision rules.`,
          itemCount: counts.experimentsTotal,
        },
      };
    }

    case "mvp": {
      if (counts.mvpCount > 0) {
        return {
          status: "completed",
          provenance: "AI_INFERENCE",
          outputJson: {
            _label: "AI_INFERENCE",
            provenance: "AI_INFERENCE",
            summary: `${counts.mvpCount} MVP feature candidates triaged into Now / Next / Later.`,
            itemCount: counts.mvpCount,
          },
        };
      }
      return { status: "queued", provenance: "AI_INFERENCE", outputJson: null };
    }

    case "report": {
      if (counts.reportSnapshotCount > 0) {
        return {
          status: "completed",
          provenance: "AI_INFERENCE",
          outputJson: {
            _label: "AI_INFERENCE",
            provenance: "AI_INFERENCE",
            summary: `Unified Founder Validation Report with ${counts.reportSnapshotCount} snapshot version(s).`,
            itemCount: counts.reportSnapshotCount,
          },
        };
      }
      return { status: "queued", provenance: "AI_INFERENCE", outputJson: null };
    }
  }
}

/**
 * Reconciles the stage statuses and parent run for a given project in SQLite.
 *
 * Idempotent: If no stage status or output changes, no database updates occur.
 * Preserves existing completed_at timestamps for completed stages.
 */
export async function reconcileProjectStages(projectId: string): Promise<ReconcileResult> {
  await initDb();
  const db = getDb();

  // 1. Fetch project to ensure it exists and get mode
  const projRes = await db.execute({
    sql: "SELECT id, title, mode, status FROM projects WHERE id = ?",
    args: [projectId],
  });

  if (projRes.rows.length === 0) {
    throw new Error(`Project '${projectId}' not found.`);
  }
  const project = projRes.rows[0];
  const isDemo = project.mode === "DEMO" || projectId === "proj-study-planner";

  // 2. Resolve latest run for project (or create initial run if none exists)
  let runRes = await db.execute({
    sql: "SELECT id, status, mode, started_at, completed_at FROM runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
    args: [projectId],
  });

  let runId: string;
  let currentRunStatus: RunStatus;
  let runStartedAt: string | null = null;
  let runCompletedAt: string | null = null;

  if (runRes.rows.length === 0) {
    runId = `run-${uuidv4().slice(0, 8)}`;
    currentRunStatus = "queued";
    const now = nowUtc();
    await db.execute({
      sql: `INSERT INTO runs (id, project_id, status, mode, prompt_version, created_at)
            VALUES (?, ?, 'queued', ?, 'phase2-v1', ?)`,
      args: [runId, projectId, project.mode as string, now],
    });

    // Create 10 initial queued stages
    const batchStages = STAGE_KEYS.map((k) => ({
      sql: `INSERT INTO stages (id, run_id, stage_key, status, attempt) VALUES (?, ?, ?, 'queued', 1)`,
      args: [`stg-${uuidv4().slice(0, 8)}`, runId, k],
    }));
    await db.batch(batchStages);
  } else {
    runId = String(runRes.rows[0].id);
    currentRunStatus = runRes.rows[0].status as RunStatus;
    runStartedAt = (runRes.rows[0].started_at as string) || null;
    runCompletedAt = (runRes.rows[0].completed_at as string) || null;
  }

  // 3. Collect project entity counts strictly scoped to this project
  const briefRes = await db.execute({
    sql: "SELECT target_customer FROM idea_briefs WHERE project_id = ? ORDER BY version DESC LIMIT 1",
    args: [projectId],
  });
  const targetCustomer = briefRes.rows.length > 0 ? (briefRes.rows[0].target_customer as string) : null;

  const countsRes = await db.execute({
    sql: `
      SELECT
        (SELECT COUNT(*) FROM evidence WHERE project_id = ?) as evidence_count,
        (SELECT COUNT(*) FROM sources WHERE project_id = ?) as source_count,
        (SELECT COUNT(*) FROM competitors WHERE project_id = ?) as competitor_count,
        (SELECT COUNT(*) FROM personas WHERE project_id = ?) as persona_count,
        (SELECT COUNT(*) FROM interviews WHERE project_id = ?) as interview_count,
        (SELECT COUNT(*) FROM insights WHERE project_id = ?) as insight_count,
        (SELECT COUNT(*) FROM assumptions WHERE project_id = ?) as assumption_count,
        (SELECT COUNT(*) FROM mvp_features WHERE project_id = ?) as mvp_count,
        (SELECT COUNT(*) FROM report_snapshots WHERE project_id = ?) as report_snapshot_count
    `,
    args: [projectId, projectId, projectId, projectId, projectId, projectId, projectId, projectId, projectId],
  });
  const rowCounts = countsRes.rows[0] || {};

  const expRes = await db.execute({
    sql: "SELECT status, result FROM experiments WHERE project_id = ?",
    args: [projectId],
  });
  const experiments = expRes.rows as unknown as Array<{ status: string; result: string | null }>;

  const entityCounts: ProjectEntityCounts = {
    evidenceCount: Number(rowCounts.evidence_count || 0),
    sourceCount: Number(rowCounts.source_count || 0),
    competitorCount: Number(rowCounts.competitor_count || 0),
    personaCount: Number(rowCounts.persona_count || 0),
    interviewCount: Number(rowCounts.interview_count || 0),
    insightCount: Number(rowCounts.insight_count || 0),
    assumptionCount: Number(rowCounts.assumption_count || 0),
    experimentsTotal: experiments.length,
    experimentsCompleted: experiments.filter(
      (e) => e.status === "completed" || (typeof e.result === "string" && e.result.trim().length > 0)
    ).length,
    experimentsAbandoned: experiments.filter((e) => e.status === "abandoned").length,
    mvpCount: Number(rowCounts.mvp_count || 0),
    reportSnapshotCount: Number(rowCounts.report_snapshot_count || 0),
    targetCustomer,
  };

  // 4. Fetch existing stages for this run
  const existingStagesRes = await db.execute({
    sql: "SELECT * FROM stages WHERE run_id = ? ORDER BY id ASC",
    args: [runId],
  });

  const existingStagesMap = new Map<StageKey, any>();
  for (const stg of existingStagesRes.rows) {
    existingStagesMap.set(stg.stage_key as StageKey, stg);
  }

  const now = nowUtc();
  const stagesToReturn: ReconciledStageRow[] = [];
  const dbUpdates: Array<{ sql: string; args: any[] }> = [];

  // 5. Reconcile each of the 10 stages
  for (const key of STAGE_KEYS) {
    const existing = existingStagesMap.get(key);
    const target = determineStageState(key, entityCounts, isDemo);

    let stageId: string;
    let attempt = 1;
    let existingStatus: StageStatus = "queued";
    let existingCompletedAt: string | null = null;
    let existingStartedAt: string | null = null;
    let existingOutputJsonStr: string | null = null;

    if (!existing) {
      // Missing stage row: create one
      stageId = `stg-${uuidv4().slice(0, 8)}`;
      dbUpdates.push({
        sql: `INSERT INTO stages (id, run_id, stage_key, status, attempt) VALUES (?, ?, ?, 'queued', 1)`,
        args: [stageId, runId, key],
      });
    } else {
      stageId = String(existing.id);
      attempt = Number(existing.attempt || 1);
      existingStatus = existing.status as StageStatus;
      existingCompletedAt = (existing.completed_at as string) || null;
      existingStartedAt = (existing.started_at as string) || null;
      existingOutputJsonStr = (existing.output_json as string) || null;
    }

    // Determine new status, respecting regression protections (Requirement 3: completed stages do not regress)
    let newStatus = target.status;
    let newCompletedAt = existingCompletedAt;
    let newStartedAt = existingStartedAt;
    let newOutputJson = target.outputJson;

    if (existingStatus === "completed") {
      newStatus = "completed";
      newCompletedAt = existingCompletedAt || now;
      if (!newStartedAt) newStartedAt = existingStartedAt || now;
      // Preserve existing output if target has none (or keep existing summary)
      if (!newOutputJson && existingOutputJsonStr) {
        try {
          newOutputJson = JSON.parse(existingOutputJsonStr);
        } catch {
          newOutputJson = target.outputJson;
        }
      }
    } else if (newStatus === "completed") {
      // Preserve existing completedAt if stage was already completed
      newCompletedAt = existingCompletedAt || now;
      if (!newStartedAt) newStartedAt = existingStartedAt || now;
    } else if (newStatus === "running") {
      newStartedAt = existingStartedAt || now;
      newCompletedAt = null;
    } else if (newStatus === "failed") {
      newCompletedAt = existingCompletedAt || now;
    } else {
      // queued
      newCompletedAt = null;
      newStartedAt = null;
    }

    const newOutputJsonStr = newOutputJson ? JSON.stringify(newOutputJson) : null;

    // Check if stage row changed
    const statusChanged = existingStatus !== newStatus;
    const outputChanged = existingOutputJsonStr !== newOutputJsonStr;
    const completedAtChanged = existingCompletedAt !== newCompletedAt;
    const startedAtChanged = existingStartedAt !== newStartedAt;

    if (statusChanged || outputChanged || completedAtChanged || startedAtChanged) {
      dbUpdates.push({
        sql: `UPDATE stages
              SET status = ?, output_json = ?, started_at = ?, completed_at = ?
              WHERE id = ?`,
        args: [newStatus, newOutputJsonStr, newStartedAt, newCompletedAt, stageId],
      });
    }

    stagesToReturn.push({
      id: stageId,
      runId,
      stageKey: key,
      status: newStatus,
      attempt,
      outputJson: newOutputJson,
      startedAt: newStartedAt,
      completedAt: newCompletedAt,
      safeError: existing?.safe_error || null,
    });
  }

  // 6. Execute stage updates in a batch if any changed
  if (dbUpdates.length > 0) {
    await db.batch(dbUpdates);
  }

  // 7. Reconcile parent run status
  const completedStagesCount = stagesToReturn.filter((s) => s.status === "completed").length;
  const runningStagesCount = stagesToReturn.filter((s) => s.status === "running").length;
  const failedStagesCount = stagesToReturn.filter((s) => s.status === "failed").length;

  let targetRunStatus: RunStatus = "queued";
  let targetRunCompletedAt = runCompletedAt;
  let targetRunStartedAt = runStartedAt;

  if (completedStagesCount === 10) {
    targetRunStatus = "completed";
    targetRunCompletedAt = runCompletedAt || now;
    if (!targetRunStartedAt) targetRunStartedAt = now;
  } else if (runningStagesCount > 0 || completedStagesCount > 0) {
    targetRunStatus = "running";
    targetRunCompletedAt = null;
    if (!targetRunStartedAt) targetRunStartedAt = now;
  } else if (failedStagesCount > 0) {
    targetRunStatus = "partial";
  } else {
    targetRunStatus = "queued";
    targetRunCompletedAt = null;
  }

  if (
    currentRunStatus !== targetRunStatus ||
    runCompletedAt !== targetRunCompletedAt ||
    runStartedAt !== targetRunStartedAt
  ) {
    await db.execute({
      sql: "UPDATE runs SET status = ?, started_at = ?, completed_at = ? WHERE id = ?",
      args: [targetRunStatus, targetRunStartedAt, targetRunCompletedAt, runId],
    });
  }

  return {
    projectId,
    runId,
    runStatus: targetRunStatus,
    completedStagesCount,
    totalStagesCount: 10,
    stages: stagesToReturn,
  };
}
