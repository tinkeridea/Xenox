/**
 * IdeaProbe — Source & Evidence Validation and Conservative Deduplication
 * Decision D46 / TL-080
 *
 * Enforces:
 * 1. Safe validation of external research items (HTTP/HTTPS URL validation).
 * 2. Graceful title resolution (prevents SQLite NOT NULL crashes on blank/missing titles).
 * 3. Conservative URL normalization for project-scoped source deduplication.
 * 4. Claim text normalization for evidence deduplication.
 */

/**
 * Validates whether a candidate URL string has a valid http: or https: scheme.
 */
export function isValidHttpUrl(urlString: unknown): boolean {
  if (typeof urlString !== "string" || !urlString.trim()) return false;
  try {
    const parsed = new URL(urlString.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Derives a safe, nonempty title from a valid URL and optional site name.
 * Used when upstream research results omit or provide blank titles.
 */
export function deriveSafeTitleFromUrl(urlStr: string, siteName?: unknown): string {
  if (typeof siteName === "string" && siteName.trim().length > 0) {
    return siteName.trim();
  }
  try {
    const parsed = new URL(urlStr.trim());
    const host = parsed.hostname.replace(/^www\./i, "");
    const pathname = parsed.pathname.replace(/\/+$/, "");
    if (pathname && pathname !== "/") {
      const segments = pathname.split("/").filter(Boolean);
      const lastSegment = segments.pop();
      if (lastSegment) {
        // Decode URI component and clean up hyphens/underscores/file extensions
        const cleanSegment = decodeURIComponent(lastSegment)
          .replace(/\.(html?|php|aspx?)$/i, "")
          .replace(/[-_]+/g, " ")
          .trim();
        if (cleanSegment.length > 0) {
          const formatted = cleanSegment.charAt(0).toUpperCase() + cleanSegment.slice(1);
          return `${formatted} (${host})`;
        }
      }
    }
    return host || "Web Source";
  } catch {
    return "Web Source";
  }
}

/**
 * Resolves a safe, non-empty, trimmed title for a source item.
 * If title is valid and non-blank, returns trimmed title.
 * If title is missing or blank, returns a safe URL-based title.
 */
export function resolveSourceTitle(title: unknown, urlStr: string, siteName?: unknown): string {
  if (typeof title === "string" && title.trim().length > 0) {
    return title.trim();
  }
  return deriveSafeTitleFromUrl(urlStr, siteName);
}

/**
 * Normalizes a URL conservatively for comparison:
 * - Lowercases scheme and hostname
 * - Removes default ports (:80 for http, :443 for https)
 * - Normalizes pathname (removes duplicate slashes, removes trailing slash if pathname > 1)
 * - Sorts query parameters deterministically
 * - Strips hash fragment (#...)
 * - Preserves case of path and query parameter values (case-sensitive web servers)
 * - Does NOT merge distinct URLs when meaningful paths or query parameters differ
 */
export function normalizeSourceUrl(rawUrl: string): string {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return "";
  try {
    const parsed = new URL(rawUrl.trim());
    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();

    // Explicit port only if non-default
    let port = parsed.port;
    if ((protocol === "http:" && port === "80") || (protocol === "https:" && port === "443")) {
      port = "";
    }
    const host = port ? `${hostname}:${port}` : hostname;

    // Normalize path: collapse duplicate slashes and remove trailing slash (if length > 1)
    let pathname = parsed.pathname.replace(/\/{2,}/g, "/");
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }

    // Sort search parameters deterministically
    const params = new URLSearchParams(parsed.search);
    params.sort();
    const search = params.toString() ? `?${params.toString()}` : "";

    // Exclude hash fragment
    return `${protocol}//${host}${pathname}${search}`;
  } catch {
    return rawUrl.trim();
  }
}

/**
 * Normalizes an evidence claim for comparison:
 * - Lowercases and trims
 * - Collapses whitespace
 * - Strips leading bracket tags (e.g. "[SAMPLE]")
 * - Strips trailing punctuation (. ! ? ; : ,)
 */
export function normalizeClaimText(claim: unknown): string {
  if (typeof claim !== "string" || !claim.trim()) return "";
  let s = claim.toLowerCase().trim();
  s = s.replace(/^(?:\[[^\]]+\]\s*)+/, "");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/[.!?;:,]+$/, "");
  return s;
}
