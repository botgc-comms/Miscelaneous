function shuffle(values, random) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(random() * (index + 1));
        [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
}

function familyOf(variation) {
    return String(variation?.diversityFamily || variation?.name || variation?.id || '').trim().toLocaleLowerCase();
}

function paletteOf(variation) {
    return String(variation?.paletteTone || 'balanced').trim().toLocaleLowerCase();
}

function chooseCandidate(candidates, selected, recentIds, random) {
    if (candidates.length === 0) return null;
    const selectedFamilies = new Set(selected.map(familyOf));
    const selectedPalettes = new Set(selected.map(paletteOf));
    const recent = new Map(recentIds.map((id, index) => [id, recentIds.length - index]));
    const availableFamilies = new Set(candidates.map(familyOf));
    const canUseFreshFamily = [...availableFamilies].some(family => family && !selectedFamilies.has(family));

    return shuffle(candidates, random)
        .map(variation => {
            const family = familyOf(variation);
            const palette = paletteOf(variation);
            let score = random();
            if (family && !selectedFamilies.has(family)) score += 120;
            if (canUseFreshFamily && selectedFamilies.has(family)) score -= 240;
            if (!selectedPalettes.has(palette)) score += 24;
            if (palette === 'dark' && selectedPalettes.has('dark')) score -= 60;
            if (recent.has(variation.id)) score -= 30 + recent.get(variation.id);
            else score += 35;
            return { variation, score };
        })
        .sort((left, right) => right.score - left.score)[0]?.variation ?? null;
}

function takeCandidate(pool, selected, recentIds, random) {
    const selectedIds = new Set(selected.map(variation => variation.id));
    const candidate = chooseCandidate(
        pool.filter(variation => variation?.id && !selectedIds.has(variation.id)),
        selected,
        recentIds,
        random);
    if (candidate) selected.push(candidate);
}

export function selectDiverseStyleVariationIds(style, count, options = {}) {
    const random = typeof options.random === 'function' ? options.random : Math.random;
    const recentIds = Array.isArray(options.recentIds) ? options.recentIds.filter(Boolean) : [];
    const variations = Array.isArray(style?.variations)
        ? style.variations.filter(variation => variation?.id)
        : [];
    if (variations.length === 0 || count <= 0) return [];

    const selected = [];
    const targetCount = Math.min(count, variations.length);
    const mixedMedia = variations.filter(variation => variation.isMixedMedia === true);
    const singleMedium = variations.filter(variation => variation.isMixedMedia !== true);
    const isChildrensBook = style?.id === 'childrens-book' || /children/i.test(style?.name ?? '');

    // Children's-book batches should demonstrate the mixed-media option instead
    // of leaving it to chance, while still including a fully illustrated idea.
    if (isChildrensBook && targetCount >= 2 && mixedMedia.length > 0 && singleMedium.length > 0) {
        const pair = random() < 0.5
            ? [mixedMedia, singleMedium]
            : [singleMedium, mixedMedia];
        takeCandidate(pair[0], selected, recentIds, random);
        takeCandidate(pair[1], selected, recentIds, random);
    }

    while (selected.length < targetCount) {
        const before = selected.length;
        takeCandidate(variations, selected, recentIds, random);
        if (selected.length === before) break;
    }

    return shuffle(selected, random).map(variation => variation.id);
}

export function updateStyleVariationHistory(history, selectedIds, maximumEntries = 24) {
    const incoming = Array.isArray(selectedIds) ? selectedIds.filter(Boolean) : [];
    const existing = Array.isArray(history) ? history.filter(Boolean) : [];
    const merged = [];
    for (const id of [...incoming, ...existing]) {
        if (!merged.includes(id)) merged.push(id);
    }
    return merged.slice(0, Math.max(0, maximumEntries));
}
