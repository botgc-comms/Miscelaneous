function parseTimestamp(value) {
    const parsed = Date.parse(typeof value === 'string' ? value : '');
    return Number.isFinite(parsed) ? parsed : 0;
}

function isArtworkSource(value) {
    return typeof value === 'string' && (
        value.startsWith('data:image/') ||
        value.startsWith('/api/poster/artwork?')
    );
}

function countRestorableArtwork(stored) {
    const generatedCount = stored?.artworkByOutput && typeof stored.artworkByOutput === 'object'
        ? Object.values(stored.artworkByOutput).filter(isArtworkSource).length
        : 0;
    const conceptCount = Array.isArray(stored?.concepts)
        ? stored.concepts.filter(concept => isArtworkSource(concept?.artworkSource)).length
        : 0;
    const sourceDesignCount = isArtworkSource(stored?.sourceDesign?.artworkSource) ? 1 : 0;
    return generatedCount + conceptCount + sourceDesignCount;
}

export function getSessionContentTimestamp(stored) {
    if (!stored || typeof stored !== 'object') return 0;

    // savedAt describes a storage write, not a user change. In particular, an
    // old browser tab is saved again when it mounts. Prefer timestamps that
    // describe actual campaign work so that mount-time saves cannot make an
    // old concept batch appear newer than the batch that produced the current
    // catalogue artwork.
    const semanticTimestamps = [
        stored.contentUpdatedAt,
        stored.generationSnapshot?.generatedAt,
        stored.sourceDesign?.uploadedAt,
        stored.screenPublication?.updatedAt,
        stored.screenPublishOperation?.updatedAt,
        stored.diaryPublication?.updatedAt,
        stored.emailPublication?.sentAt
    ].map(parseTimestamp).filter(Boolean);

    return semanticTimestamps.length > 0
        ? Math.max(...semanticTimestamps)
        : parseTimestamp(stored.savedAt);
}

export function chooseNewestStoredSession(serverStored, browserStored) {
    if (!serverStored) return browserStored;
    if (!browserStored) return serverStored;

    const serverGenerationId = String(serverStored.generationSnapshot?.id ?? '');
    const browserGenerationId = String(browserStored.generationSnapshot?.id ?? '');
    if (serverGenerationId && browserGenerationId && serverGenerationId !== browserGenerationId) {
        const serverGenerationTimestamp = parseTimestamp(serverStored.generationSnapshot?.generatedAt);
        const browserGenerationTimestamp = parseTimestamp(browserStored.generationSnapshot?.generatedAt);
        if (serverGenerationTimestamp !== browserGenerationTimestamp) {
            return browserGenerationTimestamp > serverGenerationTimestamp ? browserStored : serverStored;
        }
        return serverStored;
    }

    const serverContentTimestamp = getSessionContentTimestamp(serverStored);
    const browserContentTimestamp = getSessionContentTimestamp(browserStored);
    if (serverContentTimestamp !== browserContentTimestamp) {
        return browserContentTimestamp > serverContentTimestamp ? browserStored : serverStored;
    }

    // Browser storage may be the only copy of inline artwork when an artwork
    // upload was interrupted. It is safe to prefer that more complete copy
    // only when both records describe the same semantic generation.
    return countRestorableArtwork(browserStored) > countRestorableArtwork(serverStored)
        ? browserStored
        : serverStored;
}

export function conceptsForGeneration(concepts, generationId) {
    if (!Array.isArray(concepts)) return [];
    const candidates = concepts.filter(concept => /^concept-[1-3]$/.test(String(concept?.id ?? '')));
    if (!generationId || !candidates.some(concept => typeof concept?.generationId === 'string')) {
        return candidates;
    }

    return candidates.filter(concept => concept.generationId === generationId);
}
