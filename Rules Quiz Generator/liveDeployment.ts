export type LiveRule = {
  folderName: string;
  sourceRevision: string;
};

export type LiveDeploymentState = {
  configured: boolean;
  available: boolean;
  manifestUrl: string | null;
  releaseId: string | null;
  publishedAtUtc: string | null;
  verifiedAtUtc: string | null;
  error: string | null;
  rules: Record<string, LiveRule>;
};

type LiveLibraryJson = {
  releaseId?: unknown;
  publishedAtUtc?: unknown;
  releasedAtUtc?: unknown;
  rules?: unknown;
};

const emptyState = (manifestUrl: string | null): LiveDeploymentState => ({
  configured: Boolean(manifestUrl),
  available: false,
  manifestUrl,
  releaseId: null,
  publishedAtUtc: null,
  verifiedAtUtc: null,
  error: null,
  rules: {},
});

function parseRules(value: unknown): Record<string, LiveRule> {
  const entries = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value)
      : [];
  const rules: Record<string, LiveRule> = {};

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const folderName = "folderName" in entry && typeof entry.folderName === "string" ? entry.folderName : null;
    const sourceRevision = "sourceRevision" in entry && typeof entry.sourceRevision === "string" ? entry.sourceRevision : null;
    if (folderName && sourceRevision) {
      rules[folderName] = { folderName, sourceRevision };
    }
  }

  return rules;
}

export async function readLiveDeployment(
  manifestUrl = process.env.RULESREADY_LIVE_MANIFEST_URL?.trim() || null,
  fetchImplementation: typeof fetch = fetch
): Promise<LiveDeploymentState> {
  const state = emptyState(manifestUrl);
  if (!manifestUrl) return state;

  try {
    const response = await fetchImplementation(manifestUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const body = await response.json() as LiveLibraryJson;
    state.available = true;
    state.releaseId = typeof body.releaseId === "string" ? body.releaseId : null;
    state.publishedAtUtc = typeof body.publishedAtUtc === "string"
      ? body.publishedAtUtc
      : typeof body.releasedAtUtc === "string"
        ? body.releasedAtUtc
        : null;
    state.verifiedAtUtc = new Date().toISOString();
    state.rules = parseRules(body.rules);
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  }

  return state;
}
