"use client";

import { useState, useEffect } from "react";
import { useSearchParams, usePathname } from "next/navigation";

export const DEFAULT_PROJECT_ID = "proj-study-planner";

export const KNOWN_PROJECT_TITLES: Record<string, string> = {
  "proj-study-planner": "Study Planner",
  "proj-agri-iot": "AgriSense (IoT)",
  "proj-freelance-tax": "TaxPilot (GST)",
};

/**
 * Pure extraction helper to determine the active project ID.
 * Priority:
 * 1. Explicit override (e.g. from parent component prop)
 * 2. URL search parameter `?projectId=...`
 * 3. URL path `/runs/:id` when :id starts with `proj-`
 * 4. Fallback to DEFAULT_PROJECT_ID ("proj-study-planner")
 */
export function extractActiveProjectId(
  pathname: string | null,
  searchParams: { get: (key: string) => string | null } | null,
  overrideId?: string
): string {
  if (overrideId && overrideId.trim()) {
    return overrideId.trim();
  }
  const queryId = searchParams?.get("projectId");
  if (queryId && queryId.trim()) {
    return queryId.trim();
  }
  if (pathname && pathname.startsWith("/runs/")) {
    const rawId = pathname.replace(/^\/runs\//, "").split("/")[0]?.split("?")[0];
    if (rawId && rawId.startsWith("proj-")) {
      return decodeURIComponent(rawId);
    }
  }
  return DEFAULT_PROJECT_ID;
}

/**
 * Client React hook to access the active project ID.
 */
export function useActiveProjectId(overrideId?: string): string {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  return extractActiveProjectId(pathname, searchParams, overrideId);
}

/**
 * Appends or updates the active projectId query param on an internal relative route.
 * Preserves any existing query parameters (e.g. assumptionId=...).
 */
export function buildProjectPath(path: string, projectId: string): string {
  if (!projectId) return path;
  const [base, query] = path.split("?");
  const params = new URLSearchParams(query || "");
  params.set("projectId", projectId);
  const queryString = params.toString();
  return queryString ? `${base}?${queryString}` : base;
}

export const KNOWN_PROJECT_MODES: Record<string, "DEMO" | "LIVE" | "MIXED"> = {
  "proj-study-planner": "DEMO",
  "proj-agri-iot": "DEMO",
  "proj-freelance-tax": "DEMO",
  "proj-c5f5a5e4": "DEMO",
  "proj-d6bd473a": "DEMO",
};

// Client in-memory cache for project modes to avoid duplicate fetches across components
export const projectModeCache = new Map<string, string>();

type ModeSubscriber = () => void;
const modeSubscribers = new Set<ModeSubscriber>();

export function getCachedProjectMode(projectId: string): string | null {
  if (KNOWN_PROJECT_MODES[projectId]) {
    return KNOWN_PROJECT_MODES[projectId];
  }
  return projectModeCache.get(projectId) || null;
}

export function setProjectModeCache(projectId: string, mode: string) {
  projectModeCache.set(projectId, mode);
  modeSubscribers.forEach((cb) => {
    try {
      cb();
    } catch {}
  });
}

/**
 * Client React hook to fetch and return the active project's database mode ('DEMO' | 'LIVE' | 'MIXED' | null).
 * Subscribes to in-memory updates across persistent components (e.g. Sidebar) even if projectId is unchanged.
 */
export function useActiveProjectMode(overrideId?: string): string | null {
  const projectId = useActiveProjectId(overrideId);
  const [mode, setMode] = useState<string | null>(() => getCachedProjectMode(projectId));

  useEffect(() => {
    const cached = getCachedProjectMode(projectId);
    if (cached) {
      setMode(cached);
    }

    const handleUpdate = () => {
      const current = getCachedProjectMode(projectId);
      setMode(current);
    };
    modeSubscribers.add(handleUpdate);

    if (!cached) {
      let active = true;
      fetch(`/api/projects/${encodeURIComponent(projectId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => {
          if (active && json?.data?.project?.mode) {
            setProjectModeCache(projectId, json.data.project.mode);
          }
        })
        .catch(() => {});
      return () => {
        active = false;
        modeSubscribers.delete(handleUpdate);
      };
    }

    return () => {
      modeSubscribers.delete(handleUpdate);
    };
  }, [projectId]);

  return mode;
}
