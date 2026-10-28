import React, { Suspense } from "react";
import OverviewPage from "@/app/overview/page";

import { initDb, getDb } from "@/lib/db";

export function generateStaticParams() {
  return [
    { id: "demo-run-001" },
    { id: "proj-study-planner" },
    { id: "proj-agri-iot" },
    { id: "proj-freelance-tax" },
  ];
}

export default async function RunDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ projectId?: string }>;
}) {
  const { id } = await params;
  const sp = searchParams ? await searchParams : {};

  let resolvedProjectId: string | undefined;

  // 1. If the route parameter itself is a project ID
  if (id.startsWith("proj-")) {
    resolvedProjectId = id;
  } else {
    // 2. Resolve the run's true associated project from SQLite
    try {
      await initDb();
      const db = getDb();
      const res = await db.execute({
        sql: "SELECT project_id FROM runs WHERE id = ? LIMIT 1",
        args: [id],
      });
      if (res.rows.length > 0 && res.rows[0].project_id) {
        resolvedProjectId = String(res.rows[0].project_id);
      }
    } catch (err) {
      console.error(`Failed to resolve project for run ${id}:`, err);
    }
  }

  // 3. Fallback to query parameter only if run was not found in DB
  if (!resolvedProjectId && sp.projectId) {
    resolvedProjectId = sp.projectId;
  }

  return (
    <Suspense fallback={<div className="page-container">Loading run {id}...</div>}>
      <OverviewPage initialProjectId={resolvedProjectId} />
    </Suspense>
  );
}
