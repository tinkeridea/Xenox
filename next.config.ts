import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  async rewrites() {
    return {
      beforeFiles: [
        // Dedicated diagnostic proxy for provider health (Slice 1B / Decision D26).
        // Intentionally retained for direct FastAPI connectivity diagnostics bypassing Next.js route handlers.
        {
          source: "/api/py/health/providers",
          destination: "http://127.0.0.1:8000/api/health/providers",
        },
        // Slice 1D Real-Route Cutover: Route GET /api/runs/:id to FastAPI.
        // Rollback procedure: Remove this object, run `npm run build`, and restart Next.js.
        {
          source: "/api/runs/:id",
          destination: "http://127.0.0.1:8000/api/runs/:id",
        },
        // Slice 1H Real-Route Cutover: Route GET /api/projects/:id/insights to FastAPI.
        // Rollback procedure: Remove this object, run `npm run build`, and restart Next.js.
        {
          source: "/api/projects/:id/insights",
          destination: "http://127.0.0.1:8000/api/projects/:id/insights",
        },
        // Slice 1L Real-Route Cutover: Route GET /api/projects/:id/personas to FastAPI.
        // Rollback procedure: Remove this object, run `npm run build`, and restart Next.js.
        {
          source: "/api/projects/:id/personas",
          destination: "http://127.0.0.1:8000/api/projects/:id/personas",
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;

