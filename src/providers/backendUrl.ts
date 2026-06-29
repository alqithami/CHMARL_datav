export function backendApiCandidates(path: string) {
  const trimmed = path.trim();
  const candidates = [trimmed];

  if (typeof window === "undefined" || !trimmed.startsWith("/")) return candidates;

  const { protocol, hostname } = window.location;
  if (hostname.includes(".app.github.dev") && hostname.includes("-5173")) {
    candidates.push(`${protocol}//${hostname.replace("-5173", "-8787")}${trimmed}`);
  }

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    candidates.push(`${protocol}//${hostname}:8787${trimmed}`);
  }

  return [...new Set(candidates)];
}

export async function fetchFirstJson<T>(path: string): Promise<T | null> {
  for (const url of backendApiCandidates(path)) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) continue;
      return await response.json() as T;
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}
