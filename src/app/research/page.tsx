"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ProvenanceBadge, FixtureBadge } from "@/components/Badges";
import { DEMO_COMPETITORS, DEMO_ICP } from "@/lib/mockData";
import { useActiveProjectId, useActiveProjectMode, buildProjectPath } from "@/lib/useActiveProject";
import type { ProvenanceType, ReviewerStatus } from "@/types";
import {
  isPlaceholderEvidence,
  isPlaceholderSource,
  isPlaceholderUrl,
  isVerifiedRealEvidence,
  getEvidenceReviewDisplay,
  getEvidenceConfidenceDisplay,
  PLACEHOLDER_WARNING_TEXT,
} from "@/lib/evidenceValidation";
import {
  generateEvidenceCsv,
  generateEvidenceJson,
  downloadFile,
  sanitizeFilename,
} from "@/lib/exportUtils";

interface SourceRow {
  id: string;
  project_id: string;
  url: string | null;
  title: string;
  publisher: string | null;
  published_at: string | null;
  retrieved_at: string;
  source_type: "web" | "document" | "user_input" | "demo_fixture";
  provider: string | null;
  linked_evidence_count?: number;
}

interface EvidenceRow {
  id: string;
  project_id: string;
  source_id: string | null;
  source_title: string | null;
  source_url: string | null;
  claim: string;
  excerpt: string | null;
  provenance: ProvenanceType;
  confidence: "High" | "Medium" | "Low";
  reviewer_status: ReviewerStatus;
  caveat: string | null;
  created_at: string;
}

const PROVENANCE_FILTER_OPTIONS = [
  "All",
  "REAL_SOURCE",
  "USER_INPUT",
  "AI_INFERENCE",
  "SAMPLE",
] as const;

const REVIEWER_STATUS_OPTIONS = [
  "All",
  "UNREVIEWED",
  "ACCEPTED",
  "EDITED",
  "REJECTED",
] as const;

const CONFIDENCE_COLOR: Record<string, string> = {
  High: "var(--color-success)",
  Medium: "var(--color-warning, #f59e0b)",
  Low: "var(--color-error)",
};

const REVIEWER_COLOR: Record<ReviewerStatus, string> = {
  ACCEPTED: "var(--color-success)",
  UNREVIEWED: "var(--text-muted)",
  EDITED: "var(--color-info)",
  REJECTED: "var(--color-error)",
};

const SOURCE_TYPE_ICON: Record<string, string> = {
  web: "🌐",
  document: "📄",
  user_input: "✏️",
  demo_fixture: "🔷",
};

/**
 * Validates whether a string is a valid web URL (http: or https:)
 */
function isValidHttpUrl(str: string | null | undefined): boolean {
  if (!str) return false;
  try {
    const trimmed = str.trim();
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Returns a valid clickable absolute HTTP/HTTPS href for a given source URL.
 * If user entered domain without protocol, safely prepends https://.
 */
function getClickableHref(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (isValidHttpUrl(trimmed)) return trimmed;
  if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/.*)?$/.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return null;
}

/**
 * Detects whether a domain is an RFC 2606 / RFC 6761 reserved example domain
 * (example.edu, example.org, example.com, example.in, etc.)
 * These domains resolve globally to IANA's "Example Domains" placeholder page.
 */
function isExamplePlaceholderDomain(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const trimmed = url.trim();
    const urlWithProto = trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;
    const hostname = new URL(urlWithProto).hostname.toLowerCase();
    return (
      hostname === "example.com" ||
      hostname.endsWith(".example.com") ||
      hostname === "example.org" ||
      hostname.endsWith(".example.org") ||
      hostname === "example.net" ||
      hostname.endsWith(".example.net") ||
      hostname === "example.edu" ||
      hostname.endsWith(".example.edu") ||
      hostname === "example.in" ||
      hostname.endsWith(".example.in") ||
      hostname === "example" ||
      hostname.endsWith(".example")
    );
  } catch {
    return false;
  }
}

function ResearchPageContent() {
  const projectId = useActiveProjectId();
  const projectMode = useActiveProjectMode(projectId);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [evidence, setEvidence] = useState<EvidenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"evidence" | "sources">("evidence");

  // Filters
  const [filterProvenance, setFilterProvenance] = useState<string>("All");
  const [filterReviewer, setFilterReviewer] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const isDemo = projectMode === "DEMO";
  const [briefTargetCustomer, setBriefTargetCustomer] = useState<string>("");
  const [briefProblem, setBriefProblem] = useState<string>("");
  const [personas, setPersonas] = useState<any[]>([]);
  const [competitors, setCompetitors] = useState<any[]>([]);
  const [queryCustomized, setQueryCustomized] = useState(false);

  // Modals & Forms
  const [showAddSource, setShowAddSource] = useState(false);
  const [showAddEvidence, setShowAddEvidence] = useState(false);
  const [showTinyFishModal, setShowTinyFishModal] = useState(false);
  const [showLiveResearchModal, setShowLiveResearchModal] = useState(false);
  const [researching, setResearching] = useState(false);
  const [liveResearchQuery, setLiveResearchQuery] = useState(
    projectId === "proj-study-planner" ? "college student study planning exam anxiety India" : ""
  );
  const [editItem, setEditItem] = useState<EvidenceRow | null>(null);

  // Form states - Source
  const [newSourceTitle, setNewSourceTitle] = useState("");
  const [newSourceUrl, setNewSourceUrl] = useState("");
  const [newSourcePublisher, setNewSourcePublisher] = useState("");
  const [newSourceType, setNewSourceType] = useState<"web" | "document" | "user_input">("web");
  const [sourceSubmitting, setSourceSubmitting] = useState(false);

  // Form states - Evidence
  const [newClaim, setNewClaim] = useState("");
  const [newExcerpt, setNewExcerpt] = useState("");
  const [newSourceId, setNewSourceId] = useState("");
  const [newConfidence, setNewConfidence] = useState<"High" | "Medium" | "Low">("Medium");
  const [newProvenance, setNewProvenance] = useState<ProvenanceType>("USER_INPUT");
  const [newCaveat, setNewCaveat] = useState("");
  const [evidenceSubmitting, setEvidenceSubmitting] = useState(false);

  // Status message
  const [statusNotice, setStatusNotice] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showNotification = (msg: string, type: "success" | "error" = "success") => {
    setStatusNotice({ msg, type });
    setTimeout(() => setStatusNotice(null), 5000);
  };

  // Clipboard copy handler with user feedback
  const handleCopyUrl = useCallback(async (url: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!url) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else if (typeof document !== "undefined") {
        const textarea = document.createElement("textarea");
        textarea.value = url;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      } else {
        throw new Error("Clipboard API unavailable");
      }
      setCopiedUrl(url);
      showNotification("Source URL copied to clipboard");
      setTimeout(() => {
        setCopiedUrl((curr) => (curr === url ? null : curr));
      }, 2000);
    } catch {
      showNotification("Failed to copy URL to clipboard", "error");
    }
  }, []);

  // Handle Live Research with TinyFish
  const handleRunLiveResearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!liveResearchQuery.trim()) return;
    setResearching(true);
    setShowLiveResearchModal(false);
    try {
      const res = await fetch(`/api/projects/${projectId}/research-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: liveResearchQuery.trim() }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `HTTP ${res.status}`);
      }
      const json = await res.json();
      const newSources = json.data?.sources || [];
      const newEv = json.data?.evidence || [];
      if (newSources.length > 0) {
        setSources((prev) => [...newSources, ...prev]);
      }
      if (newEv.length > 0) {
        setEvidence((prev) => [...newEv, ...prev]);
      }
      showNotification(`✨ Discovered ${newSources.length} web sources and ${newEv.length} candidate evidence items via TinyFish!`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showNotification(`Live research failed: ${msg}`, "error");
    } finally {
      setResearching(false);
    }
  };

  // Fetch live evidence & sources from SQLite API, alongside project personas & competitors
  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setRefreshing(true);
    try {
      const [evRes, projRes, compRes, persRes] = await Promise.all([
        fetch(`/api/projects/${encodeURIComponent(projectId)}/evidence`),
        fetch(`/api/projects/${encodeURIComponent(projectId)}`),
        fetch(`/api/projects/${encodeURIComponent(projectId)}/competitors`),
        fetch(`/api/projects/${encodeURIComponent(projectId)}/personas`),
      ]);

      if (evRes.ok) {
        const evJson = await evRes.json();
        if (evJson.data) {
          setSources(evJson.data.sources || []);
          setEvidence(evJson.data.evidence || []);
        }
      }

      if (projRes.ok) {
        const projJson = await projRes.json();
        const brief = projJson.data?.brief;
        if (brief) {
          if (brief.target_customer) setBriefTargetCustomer(brief.target_customer);
          if (brief.problem) {
            setBriefProblem(brief.problem);
            if (!queryCustomized) {
              const derived = brief.problem.trim().slice(0, 100);
              if (derived) setLiveResearchQuery(derived);
            }
          }
        }
      }

      if (compRes.ok) {
        const compJson = await compRes.json();
        setCompetitors(compJson.data?.competitors || []);
      }

      if (persRes.ok) {
        const persJson = await persRes.json();
        setPersonas(persJson.data?.personas || []);
      }
    } catch (err: unknown) {
      console.error("Failed to load research data:", err);
      showNotification("Could not load research data from local SQLite database.", "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId, queryCustomized]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle Review Actions
  const handleReviewStatus = async (evidenceId: string, status: ReviewerStatus) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/evidence`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: evidenceId, reviewerStatus: status }),
      });
      if (!res.ok) throw new Error(`Failed with HTTP ${res.status}`);
      const json = await res.json();
      const updatedItem = json.data?.evidence;
      
      setEvidence((prev) =>
        prev.map((e) => (e.id === evidenceId ? { ...e, ...(updatedItem || {}), reviewer_status: status } : e))
      );
      const isItemPlaceholder = evidence.find((e) => e.id === evidenceId)?.provenance === "SAMPLE";
      showNotification(
        isItemPlaceholder && status === "ACCEPTED"
          ? `Sample claim ${evidenceId} marked ACCEPTED (Sample Demo — remains unverified)`
          : `Evidence ${evidenceId} marked as ${status}`
      );
    } catch (err) {
      showNotification("Failed to update reviewer status", "error");
    }
  };

  // Handle Evidence Edit Save
  const handleSaveEdit = async () => {
    if (!editItem) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/evidence`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editItem.id,
          claim: editItem.claim,
          excerpt: editItem.excerpt,
          confidence: editItem.confidence,
          caveat: editItem.caveat,
          reviewerStatus: "EDITED",
        }),
      });
      if (!res.ok) throw new Error("Update failed");
      const json = await res.json();
      setEvidence((prev) =>
        prev.map((e) => (e.id === editItem.id ? { ...e, ...editItem, reviewer_status: "EDITED" } : e))
      );
      setEditItem(null);
      showNotification("Evidence claim updated and marked EDITED");
    } catch (err) {
      showNotification("Failed to save changes", "error");
    }
  };

  // Handle Delete Evidence
  const handleDeleteEvidence = async (evidenceId: string) => {
    if (!window.confirm("Are you sure you want to delete this evidence record?")) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/evidence?evidenceId=${encodeURIComponent(evidenceId)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      setEvidence((prev) => prev.filter((e) => e.id !== evidenceId));
      showNotification("Evidence record deleted");
    } catch (err) {
      showNotification("Failed to delete evidence", "error");
    }
  };

  // Handle Create Source
  const handleCreateSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSourceTitle.trim()) return;
    setSourceSubmitting(true);
    let finalUrl = newSourceUrl.trim();
    if (finalUrl && !finalUrl.startsWith("http://") && !finalUrl.startsWith("https://")) {
      finalUrl = `https://${finalUrl}`;
    }

    try {
      const res = await fetch(`/api/projects/${projectId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newSourceTitle.trim(),
          url: finalUrl || undefined,
          publisher: newSourcePublisher.trim() || undefined,
          sourceType: newSourceType,
        }),
      });
      if (!res.ok) throw new Error("Source creation failed");
      const json = await res.json();
      if (json.data?.source) {
        setSources((prev) => [json.data.source, ...prev]);
        showNotification(`Source "${newSourceTitle}" added successfully`);
        setNewSourceTitle("");
        setNewSourceUrl("");
        setNewSourcePublisher("");
        setShowAddSource(false);
      }
    } catch (err) {
      showNotification("Failed to create source", "error");
    } finally {
      setSourceSubmitting(false);
    }
  };

  // Handle Delete Source
  const handleDeleteSource = async (sourceId: string) => {
    if (!window.confirm("Delete this source? Linked evidence items will be unlinked.")) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/sources?sourceId=${encodeURIComponent(sourceId)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      setSources((prev) => prev.filter((s) => s.id !== sourceId));
      setEvidence((prev) =>
        prev.map((e) => (e.source_id === sourceId ? { ...e, source_id: null, source_title: null } : e))
      );
      showNotification("Source deleted");
    } catch (err) {
      showNotification("Failed to delete source", "error");
    }
  };

  // Handle Create Evidence
  const handleCreateEvidence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClaim.trim()) return;
    setEvidenceSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claim: newClaim.trim(),
          excerpt: newExcerpt.trim() || undefined,
          sourceId: newSourceId || undefined,
          confidence: newConfidence,
          provenance: newProvenance,
          caveat: newCaveat.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error("Evidence creation failed");
      const json = await res.json();
      if (json.data?.evidence) {
        setEvidence((prev) => [json.data.evidence, ...prev]);
        showNotification("Evidence claim added to ledger");
        setNewClaim("");
        setNewExcerpt("");
        setNewCaveat("");
        setShowAddEvidence(false);
      }
    } catch (err) {
      showNotification("Failed to add evidence item", "error");
    } finally {
      setEvidenceSubmitting(false);
    }
  };

  // Handle Evidence Export
  const handleExportEvidenceCsv = () => {
    const csv = generateEvidenceCsv(evidence, projectId);
    const filename = `ideaprobe-evidence-ledger-${sanitizeFilename(projectId)}.csv`;
    downloadFile(csv, filename, "text/csv;charset=utf-8;");
    showNotification("Evidence ledger exported as CSV");
  };

  const handleExportEvidenceJson = () => {
    const jsonObj = generateEvidenceJson(evidence, {
      projectId,
      mode: projectMode,
    });
    const filename = `ideaprobe-evidence-ledger-${sanitizeFilename(projectId)}.json`;
    downloadFile(JSON.stringify(jsonObj, null, 2), filename, "application/json;charset=utf-8;");
    showNotification("Evidence ledger exported as JSON");
  };

  // Filter evidence
  const filteredEvidence = evidence.filter((item) => {
    if (filterProvenance !== "All" && item.provenance !== filterProvenance) return false;
    if (filterReviewer !== "All" && item.reviewer_status !== filterReviewer) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchClaim = item.claim.toLowerCase().includes(q);
      const matchExcerpt = item.excerpt?.toLowerCase().includes(q) ?? false;
      const matchSource = item.source_title?.toLowerCase().includes(q) ?? false;
      if (!matchClaim && !matchExcerpt && !matchSource) return false;
    }
    return true;
  });

  // Calculate review metrics with strict real vs placeholder quarantine (Decision D19)
  const verifiedRealCount = evidence.filter((e) => isVerifiedRealEvidence(e)).length;
  const samplePlaceholderCount = evidence.filter((e) => isPlaceholderEvidence(e)).length;
  const sampleAcceptedCount = evidence.filter((e) => isPlaceholderEvidence(e) && e.reviewer_status === "ACCEPTED").length;
  const realAcceptedCount = evidence.filter((e) => !isPlaceholderEvidence(e) && e.reviewer_status === "ACCEPTED").length;
  const unreviewedCount = evidence.filter((e) => e.reviewer_status === "UNREVIEWED").length;
  const editedCount = evidence.filter((e) => e.reviewer_status === "EDITED").length;
  const rejectedCount = evidence.filter((e) => e.reviewer_status === "REJECTED").length;
  const realSourcesCount = sources.filter((s) => !isPlaceholderSource(s)).length;
  const placeholderSourcesCount = sources.filter((s) => isPlaceholderSource(s)).length;

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
            <span style={{ color: "var(--color-accent-light)" }}>Research & Evidence</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 style={{ fontSize: "1.75rem", fontWeight: "700", color: "var(--text-primary)" }}>
              Market Research & Evidence Ledger
            </h1>
            <FixtureBadge mode={projectMode} />
          </div>
          <p style={{ color: "var(--text-secondary)", marginTop: "var(--space-1)", fontSize: "0.9rem" }}>
            F04 / F05 / F06 — Live SQLite Source Registry, Claim Ledger, and Human Review Gate
          </p>
        </div>

        <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setShowLiveResearchModal(true)}
            disabled={researching}
            id="btn-live-research"
          >
            {researching ? "⏳ Crawling Web (TinyFish)..." : "🔍 Live Research (TinyFish)"}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowAddSource(true)}
            id="btn-add-source"
          >
            + Add Source
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowAddEvidence(true)}
            id="btn-add-evidence"
          >
            + Add Evidence Item
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleExportEvidenceCsv}
            id="export-evidence-csv-top-btn"
            title="Export evidence ledger as CSV"
            style={{ display: "flex", alignItems: "center", gap: "5px" }}
          >
            <span>📥</span> Export CSV
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleExportEvidenceJson}
            id="export-evidence-json-top-btn"
            title="Export evidence ledger as JSON"
            style={{ display: "flex", alignItems: "center", gap: "5px" }}
          >
            <span>📥</span> Export JSON
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => loadData(true)}
            disabled={refreshing}
            title="Refresh from SQLite"
          >
            {refreshing ? "↻ Syncing..." : "↻ Refresh"}
          </button>
        </div>
      </div>

      {/* Notification toast */}
      {statusNotice && (
        <div
          className="mb-4"
          style={{
            padding: "var(--space-3) var(--space-4)",
            borderRadius: "var(--radius-md)",
            background: statusNotice.type === "success" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
            border: `1px solid ${statusNotice.type === "success" ? "var(--color-success)" : "var(--color-error)"}`,
            color: statusNotice.type === "success" ? "#86efac" : "#fca5a5",
            fontSize: "0.875rem",
          }}
        >
          {statusNotice.msg}
        </div>
      )}

      {/* Live Research Active Banner */}
      {researching && (
        <div
          className="card mb-6 animate-pulse"
          style={{
            padding: "var(--space-4) var(--space-5)",
            background: "rgba(99,102,241,0.12)",
            border: "1px solid var(--color-accent)",
          }}
        >
          <div className="flex items-center gap-3">
            <span style={{ fontSize: "1.5rem" }}>🌐</span>
            <div>
              <strong style={{ color: "var(--color-accent-light)" }}>TinyFish Live Web Research in Progress...</strong>
              <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                Querying live web across scholarly, news, and market domains. Results will be tagged REAL_SOURCE and placed in the Review Gate.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Provider Status Banner */}
      <div
        className="card mb-6"
        style={{
          padding: "var(--space-4) var(--space-5)",
          background: "var(--color-surface-2)",
          borderLeft: "3px solid var(--color-success)",
        }}
      >
        <div className="flex justify-between items-center" style={{ flexWrap: "wrap", gap: "var(--space-2)" }}>
          <div className="flex items-center gap-3">
            <span style={{ fontSize: "1.2rem" }}>🌐</span>
            <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              <strong style={{ color: "var(--text-primary)" }}>Live Research Provider:</strong> TinyFish Search API active. Discovered web claims tagged{" "}
              <code style={{ color: "var(--color-accent-light)" }}>REAL_SOURCE</code> with{" "}
              <code style={{ color: "var(--color-warning, #f59e0b)" }}>UNREVIEWED</code> human review gate status.
            </div>
          </div>
          <span
            style={{
              fontSize: "0.75rem",
              padding: "2px 8px",
              borderRadius: "var(--radius-sm)",
              background: "rgba(34,197,94,0.12)",
              color: "var(--color-success)",
              fontWeight: "600",
            }}
          >
            ● LIVE TINYFISH ACTIVE
          </span>
        </div>
      </div>

      {/* Metric Cards (Decision D19: Quarantines sample items from verified evidence counts) */}
      <div className="grid-4 mb-6" style={{ gap: "var(--space-3)" }}>
        <div className="card" style={{ padding: "var(--space-4)" }}>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Verified Real Evidence</div>
          <div style={{ fontSize: "1.75rem", fontWeight: "700", color: verifiedRealCount > 0 ? "var(--color-success)" : "var(--text-secondary)" }}>
            {verifiedRealCount}
          </div>
          <div style={{ fontSize: "0.75rem", color: verifiedRealCount > 0 ? "var(--color-success)" : "var(--text-muted)" }}>
            {realSourcesCount} real web source(s) · {unreviewedCount} unreviewed
          </div>
        </div>

        <div className="card" style={{ padding: "var(--space-4)", borderLeft: "3px solid #a855f7" }}>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Illustrative Sample Claims</div>
          <div style={{ fontSize: "1.75rem", fontWeight: "700", color: "#a855f7" }}>
            {samplePlaceholderCount}
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            {sampleAcceptedCount} accepted for demo · 0 verified
          </div>
        </div>

        <div className="card" style={{ padding: "var(--space-4)" }}>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Human Review Gate</div>
          <div style={{ fontSize: "1.75rem", fontWeight: "700", color: realAcceptedCount > 0 ? "var(--color-success)" : "var(--text-primary)" }}>
            {realAcceptedCount} real
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
            {editedCount} edited · {rejectedCount} rejected · {sampleAcceptedCount} demo only
          </div>
        </div>

        <div className="card" style={{ padding: "var(--space-4)" }}>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Registered Sources</div>
          <div style={{ fontSize: "1.75rem", fontWeight: "700", color: "var(--text-primary)" }}>{sources.length}</div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
            {realSourcesCount} real web · {placeholderSourcesCount} demo placeholder
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 mb-6" style={{ borderBottom: "1px solid var(--color-border)", paddingBottom: "var(--space-2)" }}>
        <button
          onClick={() => setActiveTab("evidence")}
          style={{
            background: "transparent",
            border: "none",
            borderBottom: activeTab === "evidence" ? "2px solid var(--color-accent)" : "2px solid transparent",
            color: activeTab === "evidence" ? "var(--color-accent-light)" : "var(--text-muted)",
            fontWeight: "600",
            padding: "8px 16px",
            cursor: "pointer",
            fontSize: "0.95rem",
          }}
        >
          Evidence Ledger ({evidence.length})
        </button>
        <button
          onClick={() => setActiveTab("sources")}
          style={{
            background: "transparent",
            border: "none",
            borderBottom: activeTab === "sources" ? "2px solid var(--color-accent)" : "2px solid transparent",
            color: activeTab === "sources" ? "var(--color-accent-light)" : "var(--text-muted)",
            fontWeight: "600",
            padding: "8px 16px",
            cursor: "pointer",
            fontSize: "0.95rem",
          }}
        >
          Sources Registry ({sources.length})
        </button>
      </div>

      {/* ── TAB 1: EVIDENCE LEDGER ── */}
      {activeTab === "evidence" && (
        <>
          {/* Filter Bar */}
          <div className="card mb-6" style={{ padding: "var(--space-4)" }}>
            <div className="flex justify-between items-center" style={{ flexWrap: "wrap", gap: "var(--space-3)" }}>
              {/* Provenance Filter */}
              <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: "600" }}>Origin:</span>
                {PROVENANCE_FILTER_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setFilterProvenance(opt)}
                    className={`btn btn-sm ${filterProvenance === opt ? "btn-primary" : "btn-secondary"}`}
                    style={{ fontSize: "0.75rem", padding: "3px 10px" }}
                  >
                    {opt}
                  </button>
                ))}
              </div>

              {/* Reviewer Status Filter */}
              <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: "600" }}>Review Gate:</span>
                {REVIEWER_STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setFilterReviewer(opt)}
                    className={`btn btn-sm ${filterReviewer === opt ? "btn-primary" : "btn-secondary"}`}
                    style={{ fontSize: "0.75rem", padding: "3px 10px" }}
                  >
                    {opt}
                  </button>
                ))}
              </div>

              {/* Search */}
              <div style={{ minWidth: "220px", flex: "1 1 200px" }}>
                <input
                  type="text"
                  placeholder="Search claims or excerpts..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "6px 12px",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--color-surface-2)",
                    border: "1px solid var(--color-border)",
                    color: "var(--text-primary)",
                    fontSize: "0.8rem",
                  }}
                />
              </div>

              {/* Export Buttons */}
              <div className="flex items-center gap-2">
                <button
                  id="export-evidence-csv-btn"
                  className="btn btn-secondary btn-sm"
                  onClick={handleExportEvidenceCsv}
                  title="Export evidence ledger as CSV"
                  style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "0.75rem", padding: "4px 10px" }}
                >
                  <span>📥</span> CSV
                </button>
                <button
                  id="export-evidence-json-btn"
                  className="btn btn-secondary btn-sm"
                  onClick={handleExportEvidenceJson}
                  title="Export evidence ledger as JSON"
                  style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "0.75rem", padding: "4px 10px" }}
                >
                  <span>📥</span> JSON
                </button>
              </div>
            </div>
          </div>

          {/* Evidence List */}
          {loading ? (
            <div className="card text-center" style={{ padding: "var(--space-8)" }}>
              <div style={{ color: "var(--text-muted)" }}>Loading evidence from SQLite database...</div>
            </div>
          ) : filteredEvidence.length === 0 ? (
            <div className="card text-center" style={{ padding: "var(--space-8)" }}>
              <div style={{ fontSize: "2rem", marginBottom: "8px" }}>📭</div>
              <h3 style={{ color: "var(--text-primary)", marginBottom: "4px" }}>No evidence items match your filters</h3>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem", marginBottom: "var(--space-4)" }}>
                Try adjusting the provenance or reviewer filter, or add a new evidence claim.
              </p>
              <button className="btn btn-primary btn-sm" onClick={() => setShowAddEvidence(true)}>
                + Add Evidence Item
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
              {filteredEvidence.map((item) => {
                const isExpanded = expandedId === item.id;
                const isEditing = editItem?.id === item.id;
                const isPlaceholder = isPlaceholderEvidence(item);
                const isVerifiedReal = isVerifiedRealEvidence(item);
                const reviewDisplay = getEvidenceReviewDisplay(item);
                const confDisplay = getEvidenceConfidenceDisplay(item);

                return (
                  <div
                    key={item.id}
                    className="card"
                    style={{
                      padding: "var(--space-5)",
                      border: isPlaceholder ? "1px dashed rgba(168,85,247,0.35)" : "1px solid var(--color-border)",
                      borderLeft: isPlaceholder
                        ? "4px solid #a855f7"
                        : `4px solid ${
                            item.reviewer_status === "ACCEPTED"
                              ? "var(--color-success)"
                              : item.reviewer_status === "REJECTED"
                              ? "var(--color-error)"
                              : item.reviewer_status === "EDITED"
                              ? "var(--color-info)"
                              : "var(--color-border)"
                          }`,
                    }}
                  >
                    {/* Top Row: Meta, Provenance, Reviewer Badges */}
                    <div className="flex justify-between items-center mb-3" style={{ flexWrap: "wrap", gap: "var(--space-2)" }}>
                      <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                        <ProvenanceBadge type={item.provenance} size="sm" />
                        
                        {/* Reviewer status badge */}
                        <span
                          title={reviewDisplay.tooltip}
                          style={{
                            fontSize: "0.75rem",
                            fontWeight: "600",
                            padding: "2px 8px",
                            borderRadius: "var(--radius-sm)",
                            background: reviewDisplay.backgroundColor,
                            color: reviewDisplay.color,
                            border: `1px solid ${reviewDisplay.borderColor}`,
                          }}
                        >
                          Review: {reviewDisplay.label}
                        </span>

                        {/* Confidence */}
                        <span
                          title={confDisplay.tooltip}
                          style={{
                            fontSize: "0.75rem",
                            color: confDisplay.color,
                            background: "var(--color-surface-2)",
                            padding: "2px 8px",
                            borderRadius: "var(--radius-sm)",
                            border: `1px solid ${isPlaceholder ? "rgba(245,158,11,0.3)" : "var(--color-border)"}`,
                          }}
                        >
                          {confDisplay.displayLabel}
                        </span>

                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                          {item.id}
                        </span>
                      </div>

                      {/* Review Action Buttons */}
                      <div className="flex items-center gap-2">
                        {item.reviewer_status !== "ACCEPTED" && (
                          <button
                            className="btn btn-secondary btn-sm"
                            style={{ fontSize: "0.75rem", padding: "2px 8px", color: isPlaceholder ? "#a855f7" : "var(--color-success)" }}
                            onClick={() => handleReviewStatus(item.id, "ACCEPTED")}
                            title={isPlaceholder ? "Accept sample for demo pipeline (remains unverified)" : "Mark claim as accepted real evidence"}
                          >
                            {isPlaceholder ? "✓ Accept (Demo)" : "✓ Accept"}
                          </button>
                        )}
                        {item.reviewer_status !== "REJECTED" && (
                          <button
                            className="btn btn-secondary btn-sm"
                            style={{ fontSize: "0.75rem", padding: "2px 8px", color: "var(--color-error)" }}
                            onClick={() => handleReviewStatus(item.id, "REJECTED")}
                            title="Reject claim from downstream synthesis"
                          >
                            ✗ Reject
                          </button>
                        )}
                        <button
                          className="btn btn-secondary btn-sm"
                          style={{ fontSize: "0.75rem", padding: "2px 8px" }}
                          onClick={() => setEditItem(isEditing ? null : item)}
                        >
                          {isEditing ? "Cancel" : "✎ Edit"}
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          style={{ fontSize: "0.75rem", padding: "2px 8px", color: "var(--color-error)" }}
                          onClick={() => handleDeleteEvidence(item.id)}
                          title="Delete from SQLite"
                        >
                          🗑
                        </button>
                      </div>
                    </div>

                    {/* Explicit Warning for Placeholder Citations (Requirement 4) */}
                    {isPlaceholder && (
                      <div
                        className="evidence-placeholder-warning"
                        style={{
                          padding: "8px 12px",
                          borderRadius: "var(--radius-sm)",
                          background: "rgba(245, 158, 11, 0.08)",
                          border: "1px solid rgba(245, 158, 11, 0.25)",
                          color: "#d97706",
                          fontSize: "0.8rem",
                          fontWeight: "500",
                          marginBottom: "var(--space-3)",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <span style={{ fontSize: "1.1rem" }}>⚠️</span>
                        <span>
                          <strong>Unverified sample — source is a placeholder.</strong> This claim is for demonstration only and does NOT count as verified real-world evidence or proof of demand.
                        </span>
                      </div>
                    )}

                    {/* Claim */}
                    {isEditing ? (
                      <div className="mb-3" style={{ background: "var(--color-surface-2)", padding: "var(--space-3)", borderRadius: "var(--radius-sm)" }}>
                        <div style={{ marginBottom: "var(--space-2)" }}>
                          <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
                            Edit Claim Statement:
                          </label>
                          <textarea
                            value={editItem.claim}
                            onChange={(e) => setEditItem({ ...editItem, claim: e.target.value })}
                            rows={2}
                            style={{
                              width: "100%",
                              padding: "6px 10px",
                              borderRadius: "var(--radius-sm)",
                              background: "var(--color-surface)",
                              border: "1px solid var(--color-border)",
                              color: "var(--text-primary)",
                              fontSize: "0.9rem",
                            }}
                          />
                        </div>
                        <div style={{ marginBottom: "var(--space-2)" }}>
                          <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
                            Edit Excerpt / Quote:
                          </label>
                          <textarea
                            value={editItem.excerpt || ""}
                            onChange={(e) => setEditItem({ ...editItem, excerpt: e.target.value })}
                            rows={2}
                            style={{
                              width: "100%",
                              padding: "6px 10px",
                              borderRadius: "var(--radius-sm)",
                              background: "var(--color-surface)",
                              border: "1px solid var(--color-border)",
                              color: "var(--text-primary)",
                              fontSize: "0.85rem",
                            }}
                          />
                        </div>
                        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                          <button className="btn btn-primary btn-sm" onClick={handleSaveEdit}>
                            Save & Mark EDITED
                          </button>
                          <button className="btn btn-secondary btn-sm" onClick={() => setEditItem(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <h3 style={{ fontSize: "1.05rem", fontWeight: "600", color: "var(--text-primary)", marginBottom: "var(--space-2)", lineHeight: "1.4" }}>
                        {item.claim}
                      </h3>
                    )}

                    {/* Excerpt */}
                    {item.excerpt && !isEditing && (
                      <blockquote
                        style={{
                          margin: "0 0 var(--space-3) 0",
                          padding: "var(--space-2) var(--space-4)",
                          borderLeft: "2px solid var(--color-accent)",
                          background: "var(--color-surface-2)",
                          borderRadius: "0 var(--radius-sm) var(--radius-sm) 0",
                          fontSize: "0.85rem",
                          color: "var(--text-secondary)",
                          fontStyle: "italic",
                        }}
                      >
                        "{item.excerpt}"
                      </blockquote>
                    )}

                    {/* Caveat */}
                    {item.caveat && (
                      <div
                        style={{
                          padding: "6px 12px",
                          borderRadius: "var(--radius-sm)",
                          background: "rgba(245,158,11,0.08)",
                          border: "1px solid rgba(245,158,11,0.2)",
                          color: "#f59e0b",
                          fontSize: "0.8rem",
                          marginBottom: "var(--space-3)",
                        }}
                      >
                        ⚠️ <strong>Limitation:</strong> {item.caveat}
                      </div>
                    )}

                    {/* Footer: Linked Source & Details */}
                    <div className="flex justify-between items-center" style={{ flexWrap: "wrap", gap: "var(--space-2)", fontSize: "0.8rem" }}>
                      <div className="flex items-center" style={{ flexWrap: "wrap", gap: "6px", color: "var(--text-muted)" }}>
                        <span>
                          Source:{" "}
                          <strong style={{ color: "var(--text-primary)" }}>
                            {item.source_title || "Unlinked Source (Manual / User Input)"}
                          </strong>
                        </span>
                        {item.source_url && (
                          <span
                            className="source-url-pill"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px",
                              background: "var(--color-surface-2)",
                              border: "1px solid var(--color-border)",
                              borderRadius: "var(--radius-sm)",
                              padding: "2px 8px",
                              maxWidth: "100%",
                            }}
                          >
                            {getClickableHref(item.source_url) ? (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                <a
                                  href={getClickableHref(item.source_url)!}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={`Open source: ${item.source_url}${isExamplePlaceholderDomain(item.source_url) ? " — RFC 2606 example domain resolves to IANA placeholder page" : ""}`}
                                  style={{
                                    color: "var(--color-accent-light)",
                                    textDecoration: "underline",
                                    textUnderlineOffset: "2px",
                                    maxWidth: "260px",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                    display: "inline-block",
                                    verticalAlign: "middle",
                                  }}
                                >
                                  🔗 {item.source_url} ↗
                                </a>
                                {isExamplePlaceholderDomain(item.source_url) && (
                                  <span
                                    title="RFC 2606 Sample Fixture Domain: managed by IANA, resolves to example-domains page"
                                    style={{
                                      fontSize: "0.6875rem",
                                      color: "var(--color-warning, #f59e0b)",
                                      background: "rgba(245, 158, 11, 0.12)",
                                      border: "1px solid rgba(245, 158, 11, 0.3)",
                                      borderRadius: "3px",
                                      padding: "1px 5px",
                                      lineHeight: "14px",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    Fixture Domain (RFC 2606)
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span
                                title={item.source_url}
                                style={{
                                  color: "var(--color-accent-light)",
                                  maxWidth: "260px",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  display: "inline-block",
                                  verticalAlign: "middle",
                                }}
                              >
                                🔗 {item.source_url}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={(e) => handleCopyUrl(item.source_url!, e)}
                              className="btn btn-secondary btn-copy-url"
                              style={{
                                fontSize: "0.6875rem",
                                padding: "1px 6px",
                                height: "20px",
                                lineHeight: "18px",
                                borderRadius: "3px",
                                border: "1px solid var(--color-border)",
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "3px",
                                whiteSpace: "nowrap",
                              }}
                              title="Copy exact source URL to clipboard"
                              aria-label="Copy source URL"
                            >
                              {copiedUrl === item.source_url ? (
                                <span style={{ color: "var(--color-success)", fontWeight: "600" }}>✓ Copied</span>
                              ) : (
                                <span>📋 Copy</span>
                              )}
                            </button>
                          </span>
                        )}
                      </div>

                      <button
                        onClick={() => setExpandedId(isExpanded ? null : item.id)}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "var(--color-accent-light)",
                          cursor: "pointer",
                          fontSize: "0.75rem",
                        }}
                      >
                        {isExpanded ? "▲ Hide metadata" : "▼ Inspect provenance record"}
                      </button>
                    </div>

                    {/* Expanded Metadata */}
                    {isExpanded && (
                      <div
                        style={{
                          marginTop: "var(--space-3)",
                          paddingTop: "var(--space-3)",
                          borderTop: "1px solid var(--color-border)",
                          fontSize: "0.75rem",
                          color: "var(--text-muted)",
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                          gap: "var(--space-2)",
                        }}
                      >
                        <div>
                          <div>Database ID:</div>
                          <code style={{ color: "var(--text-primary)" }}>{item.id}</code>
                        </div>
                        <div>
                          <div>Linked Source ID:</div>
                          <code style={{ color: "var(--text-primary)" }}>{item.source_id || "None"}</code>
                        </div>
                        <div>
                          <div>Record Timestamp:</div>
                          <div style={{ color: "var(--text-primary)" }}>{new Date(item.created_at).toLocaleString()}</div>
                        </div>
                        <div>
                          <div>Integrity Guarantee:</div>
                          <div style={{ color: "var(--color-success)" }}>Recorded in local SQLite (Decision D04)</div>
                        </div>
                        {item.source_url && (
                          <div style={{ gridColumn: "1 / -1", marginTop: "var(--space-1)" }}>
                            <div style={{ marginBottom: "2px" }}>Complete Source URL:</div>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                              {getClickableHref(item.source_url) ? (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                                  <a
                                    href={getClickableHref(item.source_url)!}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={`Open source: ${item.source_url}${isExamplePlaceholderDomain(item.source_url) ? " — RFC 2606 example domain resolves to IANA placeholder page" : ""}`}
                                    style={{
                                      color: "var(--color-accent-light)",
                                      wordBreak: "break-all",
                                      textDecoration: "underline",
                                      textUnderlineOffset: "2px",
                                    }}
                                  >
                                    {item.source_url} ↗
                                  </a>
                                  {isExamplePlaceholderDomain(item.source_url) && (
                                    <span
                                      title="RFC 2606 Sample Fixture Domain: managed by IANA, resolves to example-domains page"
                                      style={{
                                        fontSize: "0.6875rem",
                                        color: "var(--color-warning, #f59e0b)",
                                        background: "rgba(245, 158, 11, 0.12)",
                                        border: "1px solid rgba(245, 158, 11, 0.3)",
                                        borderRadius: "3px",
                                        padding: "1px 5px",
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      Fixture Domain (RFC 2606)
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span style={{ color: "var(--text-primary)", wordBreak: "break-all" }}>
                                  {item.source_url}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={(e) => handleCopyUrl(item.source_url!, e)}
                                className="btn btn-secondary"
                                style={{
                                  fontSize: "0.6875rem",
                                  padding: "2px 7px",
                                  height: "22px",
                                  whiteSpace: "nowrap",
                                  border: "1px solid var(--color-border)",
                                }}
                                title="Copy exact source URL"
                                aria-label="Copy full source URL"
                              >
                                {copiedUrl === item.source_url ? (
                                  <span style={{ color: "var(--color-success)", fontWeight: "600" }}>✓ Copied</span>
                                ) : (
                                  <span>📋 Copy URL</span>
                                )}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── TAB 2: SOURCES REGISTRY ── */}
      {activeTab === "sources" && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 style={{ fontSize: "1.1rem", fontWeight: "600", color: "var(--text-primary)" }}>
              Registered Primary &amp; Secondary Research Sources
            </h2>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAddSource(true)}>
              + Add New Source
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {sources.map((src) => (
              <div
                key={src.id}
                className="card"
                style={{
                  padding: "var(--space-4)",
                  border: "1px solid var(--color-border)",
                }}
              >
                <div className="flex justify-between items-start" style={{ flexWrap: "wrap", gap: "var(--space-2)" }}>
                  <div style={{ flex: 1 }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span>{SOURCE_TYPE_ICON[src.source_type] || "📄"}</span>
                      <h3 style={{ fontSize: "1rem", fontWeight: "600", color: "var(--text-primary)", margin: 0 }}>
                        {src.title}
                      </h3>
                      <span
                        style={{
                          fontSize: "0.7rem",
                          padding: "2px 6px",
                          borderRadius: "var(--radius-sm)",
                          background: "var(--color-surface-2)",
                          color: "var(--text-muted)",
                          border: "1px solid var(--color-border)",
                        }}
                      >
                        {src.source_type}
                      </span>
                      {isPlaceholderSource(src) && (
                        <span
                          style={{
                            fontSize: "0.6875rem",
                            padding: "2px 6px",
                            borderRadius: "var(--radius-sm)",
                            background: "rgba(245, 158, 11, 0.12)",
                            color: "var(--color-warning, #f59e0b)",
                            border: "1px solid rgba(245, 158, 11, 0.3)",
                            fontWeight: "600",
                          }}
                        >
                          ⚠️ Unverified Placeholder Source
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "4px" }}>
                      {src.publisher && <span>Publisher: <strong>{src.publisher}</strong> · </span>}
                      {src.published_at && <span>Published: {new Date(src.published_at).toLocaleDateString()} · </span>}
                      <span>Linked Evidence Claims: <strong style={{ color: "var(--color-accent-light)" }}>{src.linked_evidence_count ?? 0}</strong></span>
                      {isPlaceholderSource(src) && (
                        <span style={{ color: "var(--color-warning, #f59e0b)", marginLeft: "8px" }}>
                          (Demo fixture — excluded from verified evidence)
                        </span>
                      )}
                    </div>

                    {src.url && (
                      <div
                        className="source-url-bar"
                        style={{
                          marginTop: "8px",
                          fontSize: "0.8125rem",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          flexWrap: "wrap",
                          background: "var(--color-surface-2)",
                          padding: "6px 10px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid var(--color-border)",
                          maxWidth: "100%",
                        }}
                      >
                        <span style={{ color: "var(--text-muted)", fontSize: "0.75rem", fontWeight: "600" }}>URL:</span>
                        {getClickableHref(src.url) ? (
                          <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", flex: "1 1 auto", minWidth: 0, flexWrap: "wrap" }}>
                            <a
                              href={getClickableHref(src.url)!}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`Open source: ${src.url}${isExamplePlaceholderDomain(src.url) ? " — RFC 2606 example domain resolves to IANA placeholder page" : ""}`}
                              style={{
                                color: "var(--color-accent-light)",
                                textDecoration: "underline",
                                textUnderlineOffset: "2px",
                                wordBreak: "break-all",
                              }}
                            >
                              {src.url} ↗
                            </a>
                            {isExamplePlaceholderDomain(src.url) && (
                              <span
                                title="RFC 2606 Sample Fixture Domain: managed by IANA, resolves to example-domains page"
                                style={{
                                  fontSize: "0.6875rem",
                                  color: "var(--color-warning, #f59e0b)",
                                  background: "rgba(245, 158, 11, 0.12)",
                                  border: "1px solid rgba(245, 158, 11, 0.3)",
                                  borderRadius: "3px",
                                  padding: "1px 5px",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                Fixture Domain (RFC 2606)
                              </span>
                            )}
                          </div>
                        ) : (
                          <span
                            title={src.url}
                            style={{
                              color: "var(--color-accent-light)",
                              wordBreak: "break-all",
                              flex: "1 1 auto",
                              minWidth: 0,
                            }}
                          >
                            {src.url}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => handleCopyUrl(src.url!, e)}
                          className="btn btn-secondary btn-sm btn-copy-source-url"
                          style={{
                            fontSize: "0.72rem",
                            padding: "2px 8px",
                            borderRadius: "var(--radius-sm)",
                            border: "1px solid var(--color-border)",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                          title="Copy exact source URL to clipboard"
                          aria-label="Copy source URL"
                        >
                          {copiedUrl === src.url ? (
                            <span style={{ color: "var(--color-success)", fontWeight: "600" }}>✓ Copied!</span>
                          ) : (
                            <span>📋 Copy URL</span>
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ fontSize: "0.75rem", color: "var(--color-error)" }}
                      onClick={() => handleDeleteSource(src.id)}
                    >
                      Delete Source
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ICP Quick View */}
      {isDemo ? (
        <div className="card mt-8" style={{ padding: "var(--space-5)", border: "1px solid var(--color-border)" }}>
          <div className="flex justify-between items-center mb-3" style={{ flexWrap: "wrap", gap: "var(--space-2)" }}>
            <div className="flex items-center gap-2">
              <span style={{ fontSize: "1.1rem" }}>🎯</span>
              <h2 style={{ fontSize: "1rem", fontWeight: "600", color: "var(--text-primary)" }}>
                Ideal Customer Profile (Sample Fixture Baseline)
              </h2>
              <ProvenanceBadge type="SAMPLE" size="sm" />
            </div>
            <Link href={buildProjectPath("/personas", projectId)} className="btn btn-secondary btn-sm" style={{ fontSize: "0.8rem" }}>
              View Personas →
            </Link>
          </div>
          <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginBottom: "var(--space-3)" }}>
            <strong>{DEMO_ICP.primarySegment}</strong> — {DEMO_ICP.jobToBeDone}
          </p>
        </div>
      ) : personas.length > 0 ? (
        <div className="card mt-8" style={{ padding: "var(--space-5)", border: "1px solid var(--color-border)" }}>
          <div className="flex justify-between items-center mb-3" style={{ flexWrap: "wrap", gap: "var(--space-2)" }}>
            <div className="flex items-center gap-2">
              <span style={{ fontSize: "1.1rem" }}>🎯</span>
              <h2 style={{ fontSize: "1rem", fontWeight: "600", color: "var(--text-primary)" }}>
                Ideal Customer Profile (Persona Baseline)
              </h2>
              <ProvenanceBadge type={personas[0].provenance || "AI_INFERENCE"} size="sm" />
            </div>
            <Link href={buildProjectPath("/personas", projectId)} className="btn btn-secondary btn-sm" style={{ fontSize: "0.8rem" }}>
              View Personas ({personas.length}) →
            </Link>
          </div>
          <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginBottom: "var(--space-3)" }}>
            <strong>{personas[0].name} ({personas[0].segment || "Target Segment"})</strong> — {personas[0].jobs || personas[0].goals || "Active customer persona"}
          </p>
        </div>
      ) : (
        <div className="card mt-8" style={{ padding: "var(--space-5)", border: "1px solid var(--color-border)" }}>
          <div className="flex justify-between items-center mb-3" style={{ flexWrap: "wrap", gap: "var(--space-2)" }}>
            <div className="flex items-center gap-2">
              <span style={{ fontSize: "1.1rem" }}>🎯</span>
              <h2 style={{ fontSize: "1rem", fontWeight: "600", color: "var(--text-primary)" }}>
                Ideal Customer Profile (Target Customer Baseline)
              </h2>
              <ProvenanceBadge type="USER_INPUT" size="sm" />
            </div>
            <Link href={buildProjectPath("/personas", projectId)} className="btn btn-secondary btn-sm" style={{ fontSize: "0.8rem" }}>
              + Draft Personas →
            </Link>
          </div>
          <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginBottom: "var(--space-2)" }}>
            <strong>Target Customer:</strong> {briefTargetCustomer || "No target customer specified in brief yet."}
          </p>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            No simulated personas have been drafted for this project yet. Use the Personas module to create simulated interviews and ICP profiles.
          </p>
        </div>
      )}

      {/* Alternative Solutions preview */}
      {isDemo ? (
        <div className="card mt-6 mb-8" style={{ padding: "var(--space-5)" }}>
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-2">
              <h2 style={{ fontSize: "1rem", fontWeight: "600", color: "var(--text-primary)" }}>
                Alternative Solutions Mapped ({DEMO_COMPETITORS.length})
              </h2>
              <ProvenanceBadge type="SAMPLE" size="sm" />
            </div>
            <Link href={buildProjectPath("/alternatives", projectId)} className="btn btn-secondary btn-sm" style={{ fontSize: "0.8rem" }}>
              View Full Map →
            </Link>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
            {DEMO_COMPETITORS.map((c) => (
              <span
                key={c.id}
                style={{
                  fontSize: "0.8rem",
                  padding: "4px 10px",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--color-surface-2)",
                  border: "1px solid var(--color-border)",
                  color: "var(--text-secondary)",
                }}
              >
                {c.name}
                <span style={{ marginLeft: "6px", opacity: 0.6, fontSize: "0.7rem" }}>({c.category})</span>
              </span>
            ))}
          </div>
        </div>
      ) : competitors.length > 0 ? (
        <div className="card mt-6 mb-8" style={{ padding: "var(--space-5)" }}>
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-2">
              <h2 style={{ fontSize: "1rem", fontWeight: "600", color: "var(--text-primary)" }}>
                Alternative Solutions Mapped ({competitors.length})
              </h2>
            </div>
            <Link href={buildProjectPath("/alternatives", projectId)} className="btn btn-secondary btn-sm" style={{ fontSize: "0.8rem" }}>
              View Full Map →
            </Link>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
            {competitors.map((c) => (
              <span
                key={c.id}
                style={{
                  fontSize: "0.8rem",
                  padding: "4px 10px",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--color-surface-2)",
                  border: "1px solid var(--color-border)",
                  color: "var(--text-secondary)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span>{c.name}</span>
                <span style={{ opacity: 0.6, fontSize: "0.7rem" }}>({c.category})</span>
                {c.provenance && <ProvenanceBadge type={c.provenance} size="sm" />}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="card mt-6 mb-8" style={{ padding: "var(--space-5)" }}>
          <div className="flex justify-between items-center mb-3">
            <h2 style={{ fontSize: "1rem", fontWeight: "600", color: "var(--text-primary)" }}>
              Alternative Solutions Mapped (0)
            </h2>
            <Link href={buildProjectPath("/alternatives", projectId)} className="btn btn-secondary btn-sm" style={{ fontSize: "0.8rem" }}>
              + Map Competitors →
            </Link>
          </div>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            No alternative solutions or direct/indirect competitors mapped for this project yet. Use the Alternatives module to discover and record substitutes.
          </p>
        </div>
      )}

      {/* ── MODAL: ADD SOURCE ── */}
      {showAddSource && (
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
              maxWidth: "520px",
              width: "100%",
              padding: "var(--space-6)",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              boxShadow: "0 20px 40px rgba(0,0,0,0.4)",
            }}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 style={{ fontSize: "1.2rem", fontWeight: "700", color: "var(--text-primary)" }}>
                + Add Research Source
              </h3>
              <button
                onClick={() => setShowAddSource(false)}
                style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: "1.2rem", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSource}>
              <div style={{ marginBottom: "var(--space-4)" }}>
                <label style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
                  Source Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Higher Education Student Stress Survey 2026"
                  value={newSourceTitle}
                  onChange={(e) => setNewSourceTitle(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--color-surface-2)",
                    border: "1px solid var(--color-border)",
                    color: "var(--text-primary)",
                  }}
                />
              </div>

              <div style={{ marginBottom: "var(--space-4)" }}>
                <label style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
                  Source URL (optional)
                </label>
                <input
                  type="url"
                  placeholder="https://example.com/reports/..."
                  value={newSourceUrl}
                  onChange={(e) => setNewSourceUrl(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--color-surface-2)",
                    border: "1px solid var(--color-border)",
                    color: "var(--text-primary)",
                  }}
                />
              </div>

              <div className="grid-2 mb-4" style={{ gap: "var(--space-3)" }}>
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
                    Publisher / Author
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Journal of Learning"
                    value={newSourcePublisher}
                    onChange={(e) => setNewSourcePublisher(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--color-surface-2)",
                      border: "1px solid var(--color-border)",
                      color: "var(--text-primary)",
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
                    Source Type
                  </label>
                  <select
                    value={newSourceType}
                    onChange={(e) => setNewSourceType(e.target.value as any)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--color-surface-2)",
                      border: "1px solid var(--color-border)",
                      color: "var(--text-primary)",
                    }}
                  >
                    <option value="web">Web Article / Link</option>
                    <option value="document">Report / Document</option>
                    <option value="user_input">Founder / Primary Input</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAddSource(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={sourceSubmitting || !newSourceTitle.trim()}
                >
                  {sourceSubmitting ? "Adding..." : "Add Source"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: ADD EVIDENCE ── */}
      {showAddEvidence && (
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
              maxWidth: "560px",
              width: "100%",
              padding: "var(--space-6)",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              boxShadow: "0 20px 40px rgba(0,0,0,0.4)",
            }}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 style={{ fontSize: "1.2rem", fontWeight: "700", color: "var(--text-primary)" }}>
                + Add Evidence Claim
              </h3>
              <button
                onClick={() => setShowAddEvidence(false)}
                style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: "1.2rem", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateEvidence}>
              <div style={{ marginBottom: "var(--space-4)" }}>
                <label style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
                  Claim Statement *
                </label>
                <textarea
                  required
                  placeholder="e.g. 74% of surveyed students abandon static study apps within 7 days due to rigid rescheduling."
                  value={newClaim}
                  onChange={(e) => setNewClaim(e.target.value)}
                  rows={3}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--color-surface-2)",
                    border: "1px solid var(--color-border)",
                    color: "var(--text-primary)",
                  }}
                />
              </div>

              <div style={{ marginBottom: "var(--space-4)" }}>
                <label style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
                  Excerpt / Direct Quote (optional)
                </label>
                <textarea
                  placeholder="Direct quotation or data extract supporting the claim..."
                  value={newExcerpt}
                  onChange={(e) => setNewExcerpt(e.target.value)}
                  rows={2}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--color-surface-2)",
                    border: "1px solid var(--color-border)",
                    color: "var(--text-primary)",
                  }}
                />
              </div>

              <div className="grid-2 mb-4" style={{ gap: "var(--space-3)" }}>
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
                    Linked Source
                  </label>
                  <select
                    value={newSourceId}
                    onChange={(e) => setNewSourceId(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--color-surface-2)",
                      border: "1px solid var(--color-border)",
                      color: "var(--text-primary)",
                    }}
                  >
                    <option value="">(No Source / Primary Input)</option>
                    {sources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title.slice(0, 36)}…
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
                    Confidence Level
                  </label>
                  <select
                    value={newConfidence}
                    onChange={(e) => setNewConfidence(e.target.value as any)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--color-surface-2)",
                      border: "1px solid var(--color-border)",
                      color: "var(--text-primary)",
                    }}
                  >
                    <option value="High">High Confidence</option>
                    <option value="Medium">Medium Confidence</option>
                    <option value="Low">Low Confidence</option>
                  </select>
                </div>
              </div>

              <div className="grid-2 mb-4" style={{ gap: "var(--space-3)" }}>
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
                    Provenance Label (D04)
                  </label>
                  <select
                    value={newProvenance}
                    onChange={(e) => setNewProvenance(e.target.value as any)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--color-surface-2)",
                      border: "1px solid var(--color-border)",
                      color: "var(--text-primary)",
                    }}
                  >
                    <option value="USER_INPUT">USER_INPUT (Primary input)</option>
                    <option value="REAL_SOURCE">REAL_SOURCE (External verified)</option>
                    <option value="SAMPLE">SAMPLE (Illustrative fixture)</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
                    Caveat / Limitation (optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Sample size was 30 students"
                    value={newCaveat}
                    onChange={(e) => setNewCaveat(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--color-surface-2)",
                      border: "1px solid var(--color-border)",
                      color: "var(--text-primary)",
                    }}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAddEvidence(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={evidenceSubmitting || !newClaim.trim()}
                >
                  {evidenceSubmitting ? "Adding..." : "Add to Evidence Ledger"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: TINYFISH STATUS (Decision D10) ── */}
      {showTinyFishModal && (
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
              maxWidth: "540px",
              width: "100%",
              padding: "var(--space-6)",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              boxShadow: "0 20px 40px rgba(0,0,0,0.4)",
            }}
          >
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <span style={{ fontSize: "1.2rem" }}>🛡️</span>
                <h3 style={{ fontSize: "1.1rem", fontWeight: "700", color: "var(--text-primary)" }}>
                  Decision D10: TinyFish Live Crawler Boundary
                </h3>
              </div>
              <button
                onClick={() => setShowTinyFishModal(false)}
                style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: "1.2rem", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <div style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: "1.6" }}>
              <p className="mb-3">
                <strong>Integrity Policy:</strong> Per authoritative prompt rule and Decision D10, IdeaProbe{" "}
                <strong style={{ color: "var(--color-warning, #f59e0b)" }}>never invents or mocks live TinyFish web scraping endpoints</strong> without official connected MCP or API keys.
              </p>
              <div
                className="mb-3"
                style={{
                  padding: "var(--space-3)",
                  background: "var(--color-surface-2)",
                  borderRadius: "var(--radius-sm)",
                  fontSize: "0.8rem",
                }}
              >
                <div><strong>Current Runtime Mode:</strong> Manual Source Entry + Verified SAMPLE Fixtures</div>
                <div style={{ marginTop: "4px" }}><strong>TinyFish MCP Tool:</strong> Not detected in current session</div>
                <div style={{ marginTop: "4px" }}><strong>Status:</strong> SAFE — Operating honestly with verifiable citations</div>
              </div>
              <p>
                Founders can add primary sources directly using the <strong>+ Add Source</strong> button, link claims with exact quotations, and accept or reject evidence through the Human Review Gate.
              </p>
            </div>

            <div className="flex justify-end mt-6">
              <button className="btn btn-primary btn-sm" onClick={() => setShowTinyFishModal(false)}>
                Understood
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: RUN LIVE RESEARCH (TINYFISH) ── */}
      {showLiveResearchModal && (
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
              maxWidth: "540px",
              width: "100%",
              padding: "var(--space-6)",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              boxShadow: "0 20px 40px rgba(0,0,0,0.4)",
            }}
          >
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <span style={{ fontSize: "1.3rem" }}>🌐</span>
                <h3 style={{ fontSize: "1.15rem", fontWeight: "700", color: "var(--text-primary)" }}>
                  Run Live Web Research (TinyFish)
                </h3>
              </div>
              <button
                onClick={() => setShowLiveResearchModal(false)}
                style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: "1.2rem", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "var(--space-4)", lineHeight: 1.5 }}>
              TinyFish will crawl the live web for structured market findings, journal articles, and competitor signals. Discovered claims will be tagged{" "}
              <strong style={{ color: "var(--color-accent-light)" }}>REAL_SOURCE</strong> and placed into your Human Review Gate with{" "}
              <strong style={{ color: "var(--color-warning, #f59e0b)" }}>UNREVIEWED</strong> status.
            </p>

            <form onSubmit={handleRunLiveResearch}>
              <div style={{ marginBottom: "var(--space-4)" }}>
                <label style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "block", marginBottom: "6px" }}>
                  Search Query:
                </label>
                <input
                  type="text"
                  required
                  value={liveResearchQuery}
                  onChange={(e) => {
                    setLiveResearchQuery(e.target.value);
                    setQueryCustomized(true);
                  }}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--color-surface-2)",
                    border: "1px solid var(--color-border)",
                    color: "var(--text-primary)",
                    fontSize: "0.9rem",
                  }}
                />
              </div>

              <div
                style={{
                  padding: "var(--space-3)",
                  background: "var(--color-surface-2)",
                  borderRadius: "var(--radius-sm)",
                  fontSize: "0.8rem",
                  color: "var(--text-muted)",
                  marginBottom: "var(--space-4)",
                }}
              >
                <div><strong>Provider:</strong> TinyFish Search API (api.search.tinyfish.ai)</div>
                <div style={{ marginTop: "3px" }}><strong>Max Citations:</strong> 4 ranked web sources</div>
                <div style={{ marginTop: "3px" }}><strong>Provenance:</strong> REAL_SOURCE (Decision D04)</div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowLiveResearchModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={researching || !liveResearchQuery.trim()}
                >
                  {researching ? "⏳ Crawling..." : "🚀 Execute Web Search"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ResearchPage() {
  return (
    <Suspense
      fallback={
        <div className="page-container" style={{ padding: "var(--space-8)", textAlign: "center", color: "var(--text-muted)" }}>
          Loading Research &amp; Evidence Ledger...
        </div>
      }
    >
      <ResearchPageContent />
    </Suspense>
  );
}
