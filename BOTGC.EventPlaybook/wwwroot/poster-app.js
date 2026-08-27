const sessions = new Map();
const REFERENCE_LIBRARY_STORAGE_KEY = 'botgc-event-playbook-reference-library-v1';
const MAX_AUTOMATIC_REFERENCES = 3;
const STUDIO_DATABASE_NAME = 'botgc-event-playbook-poster-studio';
const STUDIO_DATABASE_VERSION = 1;
const STUDIO_SESSION_STORE = 'event-sessions';
const POSTER_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const INTERRUPTED_GENERATION_MESSAGE = 'The previous generation did not finish. Completed artwork and settings have been kept so only the missing formats need to be retried.';
let activeSession = null;
let configCache = null;
let studioDatabasePromise = null;
let elements = {};
let currentContext = {};

function createSession(key, context) {
    return {
        key,
        context: context ?? {},
        config: null,
        selectedStyleId: null,
        selectedOutputIds: new Set(),
        primaryArtworkDataUrl: null,
        artworkByOutput: new Map(),
        posterCanvases: new Map(),
        failedOutputs: new Map(),
        isGenerating: false,
        initialised: false,
        hydrated: false,
        restoredFromStorage: false,
        generationSnapshot: null,
        referenceSelection: null,
        persistTimer: null,
        persistenceChain: Promise.resolve(),
        serverRevision: 0,
        customEventName: (context?.eventName ?? '').trim(),
        form: {
            eventId: null,
            eventName: (context?.eventName ?? '').trim(),
            eventDate: context?.eventDate ?? '',
            description: context?.description ?? '',
            includeDate: true,
            includePrice: false,
            includeClubBranding: false,
            price: '',
            additionalInstructions: '',
            refinementNotes: '',
            supportingImages: [],
            useLibraryReferences: true,
            selectedLibraryReferences: [],
            publishMediaName: '',
            publishTags: '',
            publishStartDate: ''
        },
        progress: {
            primary: { cssClass: '', label: 'Waiting' },
            variants: { cssClass: '', label: 'Waiting' },
            compose: { cssClass: '', label: 'Waiting' }
        },
        workflowStep: 1,
        workflowComplete: false,
        campaignStatus: { text: 'Not started', mode: 'neutral' },
        refinementVisible: false,
        publishVisible: false,
        screenPublication: null,
        errorMessage: null,
        generationPromise: null,
        generationAbortController: null,
        generationStartedAt: null,
        generationTimer: null
    };
}

function getSessionKey(context) {
    return String(context?.eventId || context?.eventName || 'current-event');
}

function getOrCreateSession(context) {
    const key = getSessionKey(context);
    let session = sessions.get(key);
    if (!session) {
        session = createSession(key, context);
        sessions.set(key, session);
    }
    session.context = context ?? {};
    if (context?.eventName) {
        session.customEventName = context.eventName.trim();
        session.form.eventName = context.eventName.trim();
    }
    return session;
}

function openStudioDatabase() {
    if (!('indexedDB' in window)) {
        return Promise.resolve(null);
    }

    studioDatabasePromise ??= new Promise((resolve, reject) => {
        const request = indexedDB.open(STUDIO_DATABASE_NAME, STUDIO_DATABASE_VERSION);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(STUDIO_SESSION_STORE)) {
                database.createObjectStore(STUDIO_SESSION_STORE, { keyPath: 'key' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Unable to open Poster Studio storage.'));
    });

    return studioDatabasePromise;
}

async function readStoredSession(key) {
    const database = await openStudioDatabase();
    if (!database) return null;

    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STUDIO_SESSION_STORE, 'readonly');
        const request = transaction.objectStore(STUDIO_SESSION_STORE).get(key);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error ?? new Error('Unable to read the saved Poster Studio session.'));
    });
}

async function writeStoredSession(record) {
    const database = await openStudioDatabase();
    if (!database) return;

    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STUDIO_SESSION_STORE, 'readwrite');
        transaction.objectStore(STUDIO_SESSION_STORE).put(record);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('Unable to save the Poster Studio session.'));
        transaction.onabort = () => reject(transaction.error ?? new Error('Saving the Poster Studio session was interrupted.'));
    });
}

async function readServerSession(key) {
    const response = await fetch(`/api/poster/session?key=${encodeURIComponent(key)}`, { cache: 'no-store' });
    if (response.status === 404) return null;
    if (!response.ok) {
        throw new Error(`Poster Studio shared session load failed (${response.status}).`);
    }
    return response.json();
}

async function writeServerSession(key, record) {
    const response = await fetch(`/api/poster/session?key=${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: record })
    });
    const document = await response.json();
    if (!response.ok) {
        throw new Error(document?.error ?? `Poster Studio shared session save failed (${response.status}).`);
    }
    return document;
}

function isInlineArtworkSource(value) {
    return typeof value === 'string' && value.startsWith('data:image/');
}

function isPersistedArtworkSource(value) {
    return isInlineArtworkSource(value)
        || (typeof value === 'string' && value.startsWith('/api/poster/artwork?'));
}

async function writeServerArtwork(key, outputId, artworkDataUrl) {
    const sourceResponse = await fetch(artworkDataUrl);
    if (!sourceResponse.ok) {
        throw new Error(`The completed ${outputId} artwork could not be prepared for storage.`);
    }
    const image = await sourceResponse.blob();
    const response = await fetch(`/api/poster/artwork?key=${encodeURIComponent(key)}&outputId=${encodeURIComponent(outputId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': image.type || 'image/png' },
        body: image
    });
    const document = await response.json();
    if (!response.ok || typeof document?.url !== 'string') {
        throw new Error(document?.error ?? `Completed ${outputId} artwork could not be saved (${response.status}).`);
    }
    return document.url;
}

async function persistCompletedArtwork(session, outputId, artworkSource) {
    if (!isInlineArtworkSource(artworkSource)) return artworkSource;
    try {
        const storedSource = await writeServerArtwork(session.key, outputId, artworkSource);
        session.artworkByOutput.set(outputId, storedSource);
        if (getPrimaryOutput(session)?.id === outputId) {
            session.primaryArtworkDataUrl = storedSource;
        }
        return storedSource;
    } catch (error) {
        // Keep the inline image in the browser session. The shared-session writer
        // deliberately excludes it so one oversized payload cannot erase the
        // last good server copy.
        console.warn(`Unable to persist completed artwork for ${outputId}.`, error);
        return artworkSource;
    }
}

async function migrateInlineArtwork(session) {
    for (const [outputId, artworkSource] of [...session.artworkByOutput]) {
        if (!isInlineArtworkSource(artworkSource)) continue;
        await persistCompletedArtwork(session, outputId, artworkSource);
    }
}

async function artworkSourceToDataUrl(artworkSource) {
    if (isInlineArtworkSource(artworkSource)) return artworkSource;
    if (!isPersistedArtworkSource(artworkSource)) {
        throw new Error('The saved campaign reference could not be loaded. Generate a new digital-screen master to continue.');
    }
    const response = await fetch(artworkSource, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error('The saved digital-screen master is unavailable. Generate a new master to continue.');
    }
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error ?? new Error('The saved campaign reference could not be read.'));
        reader.readAsDataURL(blob);
    });
}

function serialiseSession(session, includeInlineArtwork = true) {
    const form = session.generationSnapshot?.form ?? session.form;
    const generationWasInterrupted = session.isGenerating && session.campaignStatus.mode === 'generating';
    const compactGenerationSnapshot = session.generationSnapshot
        ? {
            id: session.generationSnapshot.id,
            generatedAt: session.generationSnapshot.generatedAt,
            selectedStyleId: session.generationSnapshot.selectedStyleId,
            styleVariationId: session.generationSnapshot.styleVariationId,
            selectedOutputIds: session.generationSnapshot.selectedOutputIds,
            referenceSelection: session.generationSnapshot.referenceSelection ?? null
        }
        : null;

    const artworkByOutput = Object.fromEntries(
        [...session.artworkByOutput].filter(([, value]) => includeInlineArtwork || !isInlineArtworkSource(value))
    );
    const primaryArtworkDataUrl = includeInlineArtwork || !isInlineArtworkSource(session.primaryArtworkDataUrl)
        ? session.primaryArtworkDataUrl
        : null;
    const supportingImages = includeInlineArtwork
        ? form.supportingImages
        : (form.supportingImages ?? []).filter(image => !isInlineArtworkSource(image?.dataUrl));

    return {
        key: session.key,
        schemaVersion: 5,
        savedAt: new Date().toISOString(),
        selectedStyleId: session.selectedStyleId,
        selectedOutputIds: [...session.selectedOutputIds],
        primaryArtworkDataUrl,
        artworkByOutput,
        failedOutputs: Object.fromEntries(session.failedOutputs),
        generationSnapshot: compactGenerationSnapshot,
        form: {
            eventId: form.eventId,
            eventName: form.eventName,
            eventDate: form.eventDate,
            description: form.description,
            includeDate: form.includeDate,
            includePrice: form.includePrice,
            includeClubBranding: form.includeClubBranding,
            price: form.price,
            additionalInstructions: form.additionalInstructions,
            refinementNotes: form.refinementNotes,
            supportingImages,
            useLibraryReferences: form.useLibraryReferences,
            publishMediaName: session.form.publishMediaName,
            publishTags: session.form.publishTags,
            publishStartDate: session.form.publishStartDate
        },
        workflowStep: generationWasInterrupted ? 1 : session.workflowStep,
        workflowComplete: generationWasInterrupted ? false : session.workflowComplete,
        campaignStatus: generationWasInterrupted
            ? { text: 'Generation interrupted', mode: 'neutral' }
            : session.campaignStatus,
        errorMessage: generationWasInterrupted ? INTERRUPTED_GENERATION_MESSAGE : session.errorMessage,
        refinementVisible: session.refinementVisible,
        publishVisible: session.publishVisible,
        screenPublication: session.screenPublication
    };
}

function applyStoredSession(session, stored) {
    if (!stored || typeof stored !== 'object') return false;
    const storedGenerationWasInterrupted = stored.campaignStatus?.mode === 'generating';

    if (typeof stored.selectedStyleId === 'string') {
        session.selectedStyleId = stored.selectedStyleId;
    }
    if (Array.isArray(stored.selectedOutputIds)) {
        session.selectedOutputIds = new Set(stored.selectedOutputIds.filter(value => typeof value === 'string'));
    }

    const storedForm = stored.form && typeof stored.form === 'object' ? stored.form : {};
    const stringFields = ['eventId', 'eventName', 'eventDate', 'description', 'price', 'additionalInstructions', 'refinementNotes', 'publishMediaName', 'publishTags', 'publishStartDate'];
    for (const field of stringFields) {
        if (typeof storedForm[field] === 'string') session.form[field] = storedForm[field];
    }
    if (typeof storedForm.includeDate === 'boolean') session.form.includeDate = storedForm.includeDate;
    if (typeof storedForm.includePrice === 'boolean') session.form.includePrice = storedForm.includePrice;
    if (typeof storedForm.includeClubBranding === 'boolean') session.form.includeClubBranding = storedForm.includeClubBranding;
    if (typeof storedForm.useLibraryReferences === 'boolean') session.form.useLibraryReferences = storedForm.useLibraryReferences;
    if (Array.isArray(storedForm.supportingImages)) session.form.supportingImages = storedForm.supportingImages;
    session.form.selectedLibraryReferences = [];

    session.primaryArtworkDataUrl = isPersistedArtworkSource(stored.primaryArtworkDataUrl) ? stored.primaryArtworkDataUrl : null;
    session.artworkByOutput = new Map(
        stored.artworkByOutput && typeof stored.artworkByOutput === 'object'
            ? Object.entries(stored.artworkByOutput).filter(([, value]) => isPersistedArtworkSource(value))
            : []
    );
    session.failedOutputs = new Map(
        stored.failedOutputs && typeof stored.failedOutputs === 'object'
            ? Object.entries(stored.failedOutputs).filter(([outputId, value]) => typeof outputId === 'string' && value && typeof value === 'object')
            : []
    );

    if (session.artworkByOutput.size > 0) {
        applyGenerationSnapshot(session, stored.generationSnapshot);
        session.generationSnapshot = {
            id: typeof stored.generationSnapshot?.id === 'string' ? stored.generationSnapshot.id : null,
            generatedAt: stored.generationSnapshot?.generatedAt ?? stored.savedAt ?? new Date().toISOString(),
            selectedStyleId: session.selectedStyleId,
            styleVariationId: typeof stored.generationSnapshot?.styleVariationId === 'string'
                ? stored.generationSnapshot.styleVariationId
                : null,
            selectedOutputIds: [...session.selectedOutputIds],
            referenceSelection: stored.generationSnapshot?.referenceSelection ?? null,
            form: cloneGenerationForm(session.form)
        };
        session.referenceSelection = session.generationSnapshot.referenceSelection;
    }

    if (Number.isFinite(stored.workflowStep)) session.workflowStep = stored.workflowStep;
    if (typeof stored.workflowComplete === 'boolean') session.workflowComplete = stored.workflowComplete;
    if (stored.campaignStatus && typeof stored.campaignStatus.text === 'string' && typeof stored.campaignStatus.mode === 'string') {
        session.campaignStatus = stored.campaignStatus;
    }
    if (typeof stored.errorMessage === 'string' && stored.errorMessage.trim()) {
        session.errorMessage = stored.errorMessage.trim();
    }
    if (typeof stored.refinementVisible === 'boolean') session.refinementVisible = stored.refinementVisible;
    if (typeof stored.publishVisible === 'boolean') session.publishVisible = stored.publishVisible;
    if (stored.screenPublication && typeof stored.screenPublication === 'object' && Number(stored.screenPublication.mediaId) > 0) {
        session.screenPublication = {
            mediaId: Number(stored.screenPublication.mediaId),
            mediaName: String(stored.screenPublication.mediaName ?? ''),
            destinationName: String(stored.screenPublication.destinationName ?? ''),
            startDate: String(stored.screenPublication.startDate ?? ''),
            endDate: String(stored.screenPublication.endDate ?? ''),
            updatedAt: String(stored.screenPublication.updatedAt ?? '')
        };
    }

    if (session.artworkByOutput.size > 0) {
        const selectedVariants = session.config.outputs.filter(output =>
            session.selectedOutputIds.has(output.id) && !output.isPrimary
        );
        const readyVariants = selectedVariants.filter(output => session.artworkByOutput.has(output.id));
        const missingVariants = selectedVariants.filter(output => !session.artworkByOutput.has(output.id));
        const hasMissingFormats = missingVariants.length > 0;
        session.progress = {
            primary: { cssClass: 'complete', label: 'Restored' },
            variants: {
                cssClass: hasMissingFormats ? 'error' : 'complete',
                label: hasMissingFormats ? `${readyVariants.length} of ${selectedVariants.length} ready` : 'Restored'
            },
            compose: {
                cssClass: hasMissingFormats ? 'active' : 'complete',
                label: `${session.artworkByOutput.size} ready`
            }
        };
        session.campaignStatus = hasMissingFormats
            ? { text: 'Some formats need retrying', mode: 'neutral' }
            : { text: 'Saved artwork restored', mode: 'ready' };
        session.workflowStep = 3;
        session.workflowComplete = !hasMissingFormats;
        session.errorMessage = hasMissingFormats
            ? isGenericGenerationError(session.errorMessage)
                ? buildMissingFormatsMessage(missingVariants, session.failedOutputs)
                : session.errorMessage
            : null;
        session.refinementVisible = true;
        session.publishVisible = true;
    } else if (storedGenerationWasInterrupted) {
        session.workflowStep = 1;
        session.workflowComplete = false;
        session.campaignStatus = { text: 'Generation interrupted', mode: 'neutral' };
        session.errorMessage = INTERRUPTED_GENERATION_MESSAGE;
        session.refinementVisible = false;
        session.publishVisible = false;
    }

    return true;
}

function createGenerationSnapshot(session, isRegeneration) {
    return {
        id: typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        generatedAt: new Date().toISOString(),
        selectedStyleId: session.selectedStyleId,
        styleVariationId: selectStyleVariationId(session, isRegeneration),
        selectedOutputIds: [...session.selectedOutputIds],
        referenceSelection: session.referenceSelection,
        form: cloneGenerationForm(session.form)
    };
}

function cloneGenerationForm(form) {
    return {
        eventId: form.eventId,
        eventName: form.eventName,
        eventDate: form.eventDate,
        description: form.description,
        includeDate: form.includeDate,
        includePrice: form.includePrice,
        includeClubBranding: form.includeClubBranding,
        price: form.price,
        additionalInstructions: form.additionalInstructions,
        refinementNotes: form.refinementNotes,
        supportingImages: (form.supportingImages ?? []).map(image => ({ ...image })),
        useLibraryReferences: form.useLibraryReferences
    };
}

function applyGenerationSnapshot(session, snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return false;

    let applied = false;

    if (typeof snapshot.selectedStyleId === 'string') {
        session.selectedStyleId = snapshot.selectedStyleId;
        applied = true;
    }
    if (Array.isArray(snapshot.selectedOutputIds)) {
        session.selectedOutputIds = new Set(snapshot.selectedOutputIds.filter(value => typeof value === 'string'));
        applied = true;
    }
    if (snapshot.referenceSelection && typeof snapshot.referenceSelection === 'object') {
        session.referenceSelection = snapshot.referenceSelection;
        applied = true;
    }

    if (!snapshot.form || typeof snapshot.form !== 'object') return applied;

    const stringFields = ['eventId', 'eventName', 'eventDate', 'description', 'price', 'additionalInstructions', 'refinementNotes'];
    for (const field of stringFields) {
        if (typeof snapshot.form[field] === 'string') session.form[field] = snapshot.form[field];
    }
    for (const field of ['includeDate', 'includePrice', 'includeClubBranding', 'useLibraryReferences']) {
        if (typeof snapshot.form[field] === 'boolean') session.form[field] = snapshot.form[field];
    }
    if (Array.isArray(snapshot.form.supportingImages)) {
        session.form.supportingImages = snapshot.form.supportingImages.map(image => ({ ...image }));
    }

    return true;
}

function createGenerationContext(session, isRegeneration) {
    const snapshot = createGenerationSnapshot(session, isRegeneration);
    return {
        snapshot,
        supportingImages: buildSupportingImagesPayload(session, snapshot.referenceSelection),
        previousArtworkDataUrl: session.primaryArtworkDataUrl
    };
}

async function hydrateSession(session) {
    if (session.hydrated) return session.restoredFromStorage;

    let serverStored = null;
    let browserStored = null;
    let serverDocument = null;
    try {
        serverDocument = await readServerSession(session.key);
        if (serverDocument?.session) {
            serverStored = serverDocument.session;
            session.serverRevision = Number(serverDocument.revision) || 0;
        }
    } catch (error) {
        console.warn('Unable to restore the shared Poster Studio session. Trying the browser cache.', error);
    }

    try {
        browserStored = await readStoredSession(session.key);
    } catch (error) {
        console.warn('Unable to restore the browser-cached Poster Studio session.', error);
    }

    const stored = chooseNewestStoredSession(serverStored, browserStored);
    session.restoredFromStorage = applyStoredSession(session, stored);
    session.hydrated = true;
    if (session.restoredFromStorage && stored === browserStored && stored !== serverStored) {
        scheduleSessionPersistence(session);
    }
    return session.restoredFromStorage;
}

function chooseNewestStoredSession(serverStored, browserStored) {
    if (!serverStored) return browserStored;
    if (!browserStored) return serverStored;

    const serverSavedAt = Date.parse(serverStored.savedAt ?? '') || 0;
    const browserSavedAt = Date.parse(browserStored.savedAt ?? '') || 0;
    if (serverSavedAt !== browserSavedAt) {
        return browserSavedAt > serverSavedAt ? browserStored : serverStored;
    }

    const countArtwork = stored => stored?.artworkByOutput && typeof stored.artworkByOutput === 'object'
        ? Object.values(stored.artworkByOutput).filter(isPersistedArtworkSource).length
        : 0;
    return countArtwork(browserStored) > countArtwork(serverStored) ? browserStored : serverStored;
}

async function persistSession(session) {
    if (!session?.hydrated) return;
    if (session.persistTimer) {
        clearTimeout(session.persistTimer);
        session.persistTimer = null;
    }

    const savedAt = new Date().toISOString();
    const browserRecord = { ...serialiseSession(session, true), savedAt };
    const serverRecord = { ...serialiseSession(session, false), savedAt };
    session.persistenceChain = session.persistenceChain
        .catch(() => undefined)
        .then(async () => {
            try {
                await writeStoredSession(browserRecord);
            } catch (error) {
                console.warn('Unable to update the browser-cached Poster Studio session.', error);
            }
            const document = await writeServerSession(session.key, serverRecord);
            session.serverRevision = Number(document.revision) || session.serverRevision;
        })
        .catch(error => console.warn('Unable to save the shared Poster Studio session.', error));

    return session.persistenceChain;
}

function scheduleSessionPersistence(session) {
    if (!session?.hydrated) return;
    if (session.persistTimer) clearTimeout(session.persistTimer);
    session.persistTimer = setTimeout(() => persistSession(session), 750);
}

function isSessionVisible(session) {
    return activeSession === session && elements.generateButton && document.body.contains(elements.generateButton);
}

function loadReferenceLibrary() {
    if (Array.isArray(currentContext?.referenceLibrary)) {
        return currentContext.referenceLibrary;
    }
    try {
        const raw = localStorage.getItem(REFERENCE_LIBRARY_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function tokenise(text) {
    return new Set(String(text ?? '')
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/)
        .map(item => item.trim())
        .filter(item => item.length > 2 && !['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'your'].includes(item)));
}

function getSelectedStyle(session) {
    return session.config?.styles?.find(style => style.id === session.selectedStyleId) ?? null;
}

function selectStyleVariationId(session, isRegeneration) {
    const style = getSelectedStyle(session);
    const variations = Array.isArray(style?.variations) ? style.variations : [];
    if (variations.length === 0) return null;

    const previousVariationId = session.generationSnapshot?.styleVariationId;
    const isSameStyleAsPrevious = session.generationSnapshot?.selectedStyleId === session.selectedStyleId;
    const candidates = variations.length > 1 && isSameStyleAsPrevious && previousVariationId
        ? variations.filter(variation => variation.id !== previousVariationId)
        : variations;

    // One variation is selected for the whole campaign so every derivative
    // remains visually related to the digital-screen master. A subsequent
    // generation rotates away from the immediately previous direction.
    return candidates[Math.floor(Math.random() * candidates.length)].id;
}

function scoreReferenceMatch(reference, tokens) {
    const profile = reference.relevanceProfile ?? {};
    const fields = [
        reference.title,
        reference.description,
        reference.category,
        ...(Array.isArray(reference.tags) ? reference.tags : []),
        profile.matchingInstruction,
        ...(Array.isArray(profile.positiveSignals) ? profile.positiveSignals : []),
        ...(Array.isArray(profile.namedEntities) ? profile.namedEntities : [])
    ];
    const haystack = tokenise(fields.join(' '));
    let score = 0;
    for (const token of tokens) {
        if (haystack.has(token)) score += 9;
    }
    return Math.min(100, score);
}

function updateAutomaticReferenceSelection(session) {
    const library = loadReferenceLibrary().filter(item => item.active !== false && item.dataUrl);
    if (!session.form.useLibraryReferences) {
        session.form.selectedLibraryReferences = [];
        renderSupportingFiles(session);
        return;
    }

    const tokens = tokenise([
        session.form.eventName,
        session.form.description,
        session.form.additionalInstructions,
        session.form.includeDate ? session.form.eventDate : '',
        session.form.includePrice ? session.form.price : '',
        session.form.includeClubBranding ? 'Burton-on-Trent Golf Club official logo crest branding BOTGC' : 'no club logo branding'
    ].join(' '));

    session.form.selectedLibraryReferences = library
        .map(reference => ({ reference, score: scoreReferenceMatch(reference, tokens) }))
        .filter(item => item.score >= 65)
        .sort((left, right) => right.score - left.score || String(left.reference.title ?? '').localeCompare(String(right.reference.title ?? '')))
        .slice(0, MAX_AUTOMATIC_REFERENCES)
        .map(item => ({
            ...item.reference,
            relevanceConfidence: item.score,
            relevanceReason: 'Locally matched against the stored semantic profile. Final selection is reassessed when generation begins.'
        }));

    renderSupportingFiles(session);
}

function buildReferenceSelectionRequest(session, library) {
    const form = session.form;
    return {
        eventName: form.eventName || session.customEventName || 'Current event',
        eventDate: form.eventDate,
        description: form.description,
        additionalInstructions: form.additionalInstructions,
        includeDate: form.includeDate,
        includePrice: form.includePrice,
        includeClubBranding: form.includeClubBranding,
        price: form.price,
        references: library.map(reference => ({
            id: reference.id,
            title: reference.title || '',
            category: reference.category || 'Other',
            description: reference.description || '',
            tags: Array.isArray(reference.tags) ? reference.tags : [],
            priority: Number(reference.priority) || 0,
            relevanceProfile: reference.relevanceProfile ?? null
        }))
    };
}

async function analyseAutomaticReferenceSelection(session, signal) {
    const library = loadReferenceLibrary().filter(item => item.active !== false && item.dataUrl);
    if (!session.form.useLibraryReferences || library.length === 0) {
        session.form.selectedLibraryReferences = [];
        session.referenceSelection = {
            eventIntent: '',
            mode: library.length === 0 ? 'empty-library' : 'disabled',
            model: 'none',
            matches: [],
            selected: []
        };
        renderSupportingFiles(session);
        return;
    }

    try {
        const response = await fetch('/api/poster/select-references', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildReferenceSelectionRequest(session, library)),
            signal
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(result?.selected)) {
            throw new Error(result?.error ?? `Reference selection failed (${response.status}).`);
        }

        const selectedById = new Map(result.selected.map(match => [match.id, match]));
        session.form.selectedLibraryReferences = library
            .filter(reference => selectedById.has(reference.id))
            .map(reference => {
                const match = selectedById.get(reference.id);
                return {
                    ...reference,
                    relevanceConfidence: match.confidence,
                    relevanceReason: match.reason
                };
            });
        session.referenceSelection = result;
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        console.warn('Unable to complete AI reference selection. Continuing with the local semantic-profile matches.', error);
        updateAutomaticReferenceSelection(session);
        session.referenceSelection = {
            eventIntent: '',
            mode: 'browser-fallback',
            model: 'browser-fallback',
            matches: session.form.selectedLibraryReferences.map(reference => ({
                id: reference.id,
                confidence: reference.relevanceConfidence ?? 65,
                reason: reference.relevanceReason
            })),
            selected: session.form.selectedLibraryReferences.map(reference => ({
                id: reference.id,
                confidence: reference.relevanceConfidence ?? 65,
                reason: reference.relevanceReason
            }))
        };
    }
    renderSupportingFiles(session);
}

function buildSupportingImagesPayload(session, referenceSelection = session.generationSnapshot?.referenceSelection) {
    const snapshotMatches = Array.isArray(referenceSelection?.selected)
        ? referenceSelection.selected
        : null;
    const snapshotMatchById = snapshotMatches
        ? new Map(snapshotMatches.map(match => [match.id, match]))
        : null;
    const automaticReferences = snapshotMatchById
        ? loadReferenceLibrary()
            .filter(reference => snapshotMatchById.has(reference.id) && reference.active !== false && reference.dataUrl)
            .map(reference => ({
                ...reference,
                relevanceConfidence: snapshotMatchById.get(reference.id)?.confidence,
                relevanceReason: snapshotMatchById.get(reference.id)?.reason
            }))
        : session.form.selectedLibraryReferences ?? [];
    const automatic = session.form.useLibraryReferences !== false
        ? automaticReferences.map(reference => ({
            libraryId: reference.id,
            fileName: reference.title || 'reference-library-image',
            dataUrl: reference.dataUrl,
            title: reference.title || '',
            description: reference.description || '',
            category: reference.category || '',
            tags: Array.isArray(reference.tags) ? reference.tags : [],
            source: 'library',
            relevanceConfidence: reference.relevanceConfidence ?? null,
            relevanceReason: reference.relevanceReason || '',
            matchingInstruction: reference.relevanceProfile?.matchingInstruction || ''
        }))
        : [];

    const manual = (session.form.supportingImages ?? []).map(file => ({
        fileName: file.fileName,
        dataUrl: file.dataUrl,
        title: file.title || file.fileName || '',
        description: file.description || '',
        category: file.category || 'Uploaded reference',
        tags: Array.isArray(file.tags) ? file.tags : [],
        source: 'uploaded'
    }));

    return [...automatic, ...manual];
}

export async function mountPosterStudio(context = {}) {
    currentContext = context ?? {};
    activeSession = getOrCreateSession(currentContext);

    elements = {
        eventDescription: document.querySelector('#eventDescription'),
        styleOptions: document.querySelector('#styleOptions'),
        includeDate: document.querySelector('#includeDate'),
        includePrice: document.querySelector('#includePrice'),
        includeClubBranding: document.querySelector('#includeClubBranding'),
        dateCard: document.querySelector('#dateCard'),
        priceCard: document.querySelector('#priceCard'),
        brandingCard: document.querySelector('#brandingCard'),
        priceField: document.querySelector('#priceField'),
        price: document.querySelector('#price'),
        additionalInstructions: document.querySelector('#additionalInstructions'),
        supportingFilesInput: document.querySelector('#supportingFilesInput'),
        useLibraryReferences: document.querySelector('#useLibraryReferences'),
        supportingFilesList: document.querySelector('#supportingFilesList'),
        outputOptions: document.querySelector('#outputOptions'),
        generateButton: document.querySelector('#generateButton'),
        generationMode: document.querySelector('#generationMode'),
        campaignTitle: document.querySelector('#campaignTitle'),
        campaignStatus: document.querySelector('#campaignStatus'),
        emptyState: document.querySelector('#emptyState'),
        generationProgress: document.querySelector('#generationProgress'),
        generationElapsed: document.querySelector('#generationElapsed'),
        cancelGenerationButton: document.querySelector('#cancelGenerationButton'),
        generatedArtworkPanel: document.querySelector('#generatedArtworkPanel'),
        generatedArtworkCount: document.querySelector('#generatedArtworkCount'),
        posterResults: document.querySelector('#posterResults'),
        refinementPanel: document.querySelector('#refinementPanel'),
        refinementNotes: document.querySelector('#refinementNotes'),
        regenerateButton: document.querySelector('#regenerateButton'),
        sharePanel: document.querySelector('#sharePanel'),
        shareScreensButton: document.querySelector('#shareScreensButton'),
        shareEmailButton: document.querySelector('#shareEmailButton'),
        shareTopButton: document.querySelector('#shareTopButton'),
        shareMessage: document.querySelector('#shareMessage'),
        publishDialog: document.querySelector('#posterPublishDialog'),
        publishForm: document.querySelector('#posterPublishForm'),
        publishPreview: document.querySelector('#posterPublishPreview'),
        publishDialogClose: document.querySelector('#closePosterPublishDialog'),
        publishDialogCancel: document.querySelector('#cancelPosterPublish'),
        publishDialogConfirm: document.querySelector('#confirmPosterPublish'),
        publishDialogMessage: document.querySelector('#posterPublishDialogMessage'),
        yodeckConnectionStatus: document.querySelector('#yodeckConnectionStatus'),
        yodeckMediaName: document.querySelector('#yodeckMediaName'),
        yodeckTags: document.querySelector('#yodeckTags'),
        yodeckStartDate: document.querySelector('#yodeckStartDate'),
        yodeckEndDate: document.querySelector('#yodeckEndDate'),
        yodeckPlaylistName: document.querySelector('#yodeckPlaylistName')
    };

    if (!elements.generateButton) {
        return;
    }

    await initialise(activeSession);
}

async function initialise(session) {
    if (!configCache) {
        const response = await fetch('/api/poster/config');
        if (!response.ok) {
            throw new Error('Unable to load poster configuration.');
        }
        configCache = await response.json();
    }

    session.config = configCache;
    const restored = await hydrateSession(session);
    synchroniseSelectedEventContext(session, !restored && !session.initialised);

    if (!session.config.styles.some(style => style.id === session.selectedStyleId)) {
        session.selectedStyleId = null;
    }
    session.selectedOutputIds = new Set(
        [...session.selectedOutputIds].filter(outputId => session.config.outputs.some(output => output.id === outputId))
    );

    if (elements.generationMode) {
        elements.generationMode.textContent = session.config.generationMode === 'openai'
            ? `OpenAI live generation · ${session.config.imageModel} · ${session.config.imageQuality} · creative director ${session.config.promptModel}`
            : `Prototype mock generation · configured for ${session.config.imageModel} · creative director ${session.config.promptModel}`;
    }

    session.initialised = true;

    renderStyles(session);
    renderOutputs(session);
    await migrateInlineArtwork(session);
    await rebuildPersistedCanvases(session);

    applyFormToDom(session);
    updateAutomaticReferenceSelection(session);
    wireEvents(session);
    restoreSessionToDom(session);
    scheduleSessionPersistence(session);
}

async function rebuildPersistedCanvases(session) {
    if (session.posterCanvases.size > 0 || session.artworkByOutput.size === 0) return;

    // Rebuild one large canvas at a time. Restoring all three 4K/A4 canvases
    // concurrently can exhaust the browser's image memory and make valid saved
    // artwork look as though it has disappeared.
    for (const output of session.config.outputs) {
        const dataUrl = session.artworkByOutput.get(output.id);
        if (!dataUrl) continue;

        try {
            session.posterCanvases.set(output.id, await createFinishedPoster(output, dataUrl, session.form.includeClubBranding));
        } catch (error) {
            console.warn(`Unable to restore saved artwork for ${output.name}.`, error);
        }
    }

    const primaryOutput = getPrimaryOutput(session);
    session.primaryArtworkDataUrl ??= primaryOutput ? session.artworkByOutput.get(primaryOutput.id) ?? null : null;
}

function renderStyles(session) {
    session.selectedStyleId ??= session.config.styles[0]?.id ?? null;
    elements.styleOptions.innerHTML = '';

    for (const style of session.config.styles) {
        const label = document.createElement('label');
        label.className = `style-card${style.id === session.selectedStyleId ? ' selected' : ''}`;
        label.dataset.styleId = style.id;
        label.innerHTML = `
            <input type="radio" name="posterStyle" value="${escapeHtml(style.id)}" ${style.id === session.selectedStyleId ? 'checked' : ''}>
            <strong>${escapeHtml(style.name)}</strong>
            <small>${escapeHtml(style.summary)}</small>`;
        elements.styleOptions.append(label);
    }
}

function renderOutputs(session) {
    elements.outputOptions.innerHTML = '';
    if (session.selectedOutputIds.size === 0) {
        session.config.outputs.forEach(output => session.selectedOutputIds.add(output.id));
    }

    for (const output of session.config.outputs) {
        if (output.isPrimary) session.selectedOutputIds.add(output.id);
        const selected = session.selectedOutputIds.has(output.id);
        const label = document.createElement('label');
        const squareClass = output.width === output.height ? ' square' : '';
        const primaryClass = output.isPrimary ? ' primary' : '';
        label.className = `output-card${squareClass}${primaryClass}${selected ? ' selected' : ''}`;
        label.dataset.outputId = output.id;
        label.innerHTML = `
            <input type="checkbox" value="${escapeHtml(output.id)}" ${selected ? 'checked' : ''} ${output.isPrimary ? 'disabled' : ''}>
            <span class="format-icon"></span>
            <span class="format-copy"><strong>${escapeHtml(output.name)}${output.isPrimary ? ' · Primary' : ''}</strong><small>${escapeHtml(output.purpose)}</small></span>
            <span class="dimensions">${output.width} × ${output.height}</span>`;
        elements.outputOptions.append(label);
    }
}

function wireEvents(session) {
    elements.styleOptions.addEventListener('change', event => {
        const input = event.target.closest('input[name="posterStyle"]');
        if (!input) return;
        session.selectedStyleId = input.value;
        elements.styleOptions.querySelectorAll('.style-card').forEach(card => card.classList.toggle('selected', card.dataset.styleId === session.selectedStyleId));
        scheduleSessionPersistence(session);
    });

    elements.outputOptions.addEventListener('change', event => {
        const input = event.target.closest('input[type="checkbox"]');
        if (!input) return;
        if (input.checked) session.selectedOutputIds.add(input.value); else session.selectedOutputIds.delete(input.value);
        input.closest('.output-card')?.classList.toggle('selected', input.checked);
        scheduleSessionPersistence(session);
    });

    const capture = () => {
        captureFormFromDom(session);
        scheduleSessionPersistence(session);
    };
    elements.eventDescription.addEventListener('input', () => { capture(); updateAutomaticReferenceSelection(session); });
    elements.price.addEventListener('input', () => { capture(); updateAutomaticReferenceSelection(session); });
    elements.additionalInstructions.addEventListener('input', () => { capture(); updateAutomaticReferenceSelection(session); });
    elements.refinementNotes.addEventListener('input', capture);

    elements.supportingFilesInput?.addEventListener('change', async event => {
        const input = event.target;
        const files = Array.from(input.files ?? []);
        if (files.length === 0) return;
        await addSupportingFiles(session, files);
        input.value = '';
        scheduleSessionPersistence(session);
    });

    elements.supportingFilesList?.addEventListener('click', event => {
        const button = event.target.closest('[data-remove-supporting-file]');
        if (!button) return;
        removeSupportingFile(session, button.dataset.removeSupportingFile);
        scheduleSessionPersistence(session);
    });

    elements.useLibraryReferences?.addEventListener('change', () => {
        session.form.useLibraryReferences = elements.useLibraryReferences.checked;
        updateAutomaticReferenceSelection(session);
        scheduleSessionPersistence(session);
    });

    elements.includeDate.addEventListener('change', () => {
        capture();
        elements.dateCard.classList.toggle('selected', elements.includeDate.checked);
        updateAutomaticReferenceSelection(session);
    });
    elements.includePrice.addEventListener('change', () => {
        capture();
        elements.priceCard.classList.toggle('selected', elements.includePrice.checked);
        elements.priceField.classList.toggle('hidden', !elements.includePrice.checked);
        updateAutomaticReferenceSelection(session);
    });
    elements.includeClubBranding.addEventListener('change', async () => {
        capture();
        elements.brandingCard.classList.toggle('selected', elements.includeClubBranding.checked);
        updateAutomaticReferenceSelection(session);
        await recomposeSavedArtwork(session);
        scheduleSessionPersistence(session);
    });
    elements.generateButton.addEventListener('click', () => generateCampaign(session, false));
    elements.regenerateButton.addEventListener('click', () => generateCampaign(session, true));
    elements.cancelGenerationButton.addEventListener('click', () => cancelGeneration(session));
    elements.shareScreensButton.addEventListener('click', openScreenShareDialog);
    elements.shareEmailButton.addEventListener('click', showEmailShareStatus);
    elements.shareTopButton.addEventListener('click', revealShareOptions);
    elements.publishDialogClose?.addEventListener('click', closePublishDialog);
    elements.publishDialogCancel?.addEventListener('click', closePublishDialog);
    elements.publishDialog?.addEventListener('close', () => {
        captureScreenShareDialog(session);
        scheduleSessionPersistence(session);
    });
    elements.publishForm?.addEventListener('submit', event => {
        event.preventDefault();
        sendToClubhouseScreens();
    });
}

function synchroniseSelectedEventContext(session, seedBrief = false) {
    const context = session.context ?? {};
    const contextEventName = typeof context.eventName === 'string' ? context.eventName.trim() : '';
    const catalogueEvent = session.config?.events?.find(event =>
        contextEventName && event.name.toLocaleLowerCase() === contextEventName.toLocaleLowerCase()
    );

    // The poster API's eventId selects a prompt recipe, while session.key keeps
    // the artwork tied to the real application event. Custom catalogue events
    // therefore use the shared custom-event recipe with their own name/date.
    session.form.eventId = catalogueEvent?.id ?? 'custom-event';
    if (contextEventName) {
        session.customEventName = contextEventName;
        session.form.eventName = contextEventName;
    }
    if (typeof context.eventDate === 'string') {
        session.form.eventDate = context.eventDate;
    }

    if (seedBrief) {
        session.form.description = typeof context.description === 'string' && context.description.trim()
            ? context.description
            : catalogueEvent?.description ?? session.form.description;
        session.form.price = catalogueEvent?.defaultPrice ?? session.form.price;
    }
}

function captureFormFromDom(session) {
    if (!isSessionVisible(session)) return;
    synchroniseSelectedEventContext(session);
    session.form.description = elements.eventDescription.value;
    session.form.includeDate = elements.includeDate.checked;
    session.form.includePrice = elements.includePrice.checked;
    session.form.includeClubBranding = elements.includeClubBranding.checked;
    session.form.price = elements.price.value;
    session.form.additionalInstructions = elements.additionalInstructions.value;
    session.form.refinementNotes = elements.refinementNotes.value;
    session.form.useLibraryReferences = elements.useLibraryReferences?.checked !== false;
}

function applyFormToDom(session) {
    elements.eventDescription.value = session.form.description ?? '';
    elements.includeDate.checked = session.form.includeDate !== false;
    elements.includePrice.checked = session.form.includePrice === true;
    elements.includeClubBranding.checked = session.form.includeClubBranding === true;
    elements.price.value = session.form.price ?? '';
    elements.additionalInstructions.value = session.form.additionalInstructions ?? '';
    elements.refinementNotes.value = session.form.refinementNotes ?? '';
    if (elements.useLibraryReferences) {
        elements.useLibraryReferences.checked = session.form.useLibraryReferences !== false;
    }
    if (elements.supportingFilesInput) {
        elements.supportingFilesInput.value = '';
    }
    renderSupportingFiles(session);
    elements.dateCard.classList.toggle('selected', elements.includeDate.checked);
    elements.priceCard.classList.toggle('selected', elements.includePrice.checked);
    elements.brandingCard.classList.toggle('selected', elements.includeClubBranding.checked);
    elements.priceField.classList.toggle('hidden', !elements.includePrice.checked);
    elements.campaignTitle.textContent = session.form.eventName || session.customEventName || 'Current event';
}

function restoreSessionToDom(session) {
    setCampaignStatus(session, session.campaignStatus.text, session.campaignStatus.mode);
    setWorkflowStep(session, session.workflowStep, session.workflowComplete);
    for (const [name, progress] of Object.entries(session.progress)) {
        setProgressState(session, name, progress.cssClass, progress.label);
    }

    if (session.isGenerating || session.posterCanvases.size > 0 || session.errorMessage) {
        elements.emptyState.classList.add('hidden');
        elements.generationProgress.classList.remove('hidden');
    }
    if (session.posterCanvases.size > 0) renderCampaignResults(session);
    elements.refinementPanel.classList.toggle('hidden', !session.refinementVisible);
    elements.sharePanel.classList.toggle('hidden', !session.publishVisible);
    elements.shareTopButton.disabled = !session.publishVisible;
    if (elements.shareMessage && session.screenPublication) {
        const publication = session.screenPublication;
        elements.shareMessage.textContent = `“${publication.mediaName}” is scheduled on ${publication.destinationName} from ${publication.startDate} to ${publication.endDate}. Sending again will update the same screen item.`;
    }
    if (!session.isGenerating && elements.generationElapsed) {
        elements.generationElapsed.textContent = session.errorMessage
            ? 'The form is unlocked and ready to try again.'
            : session.posterCanvases.size > 0
                ? 'All saved campaign formats are ready.'
                : 'High-quality artwork can take several minutes.';
    }
    setBusy(session, session.isGenerating);

    if (session.errorMessage) {
        renderGenerationError(session);
    }
}

async function generateCampaign(session, isRegeneration) {
    if (session.isGenerating) return session.generationPromise;

    captureFormFromDom(session);
    const referenceController = new AbortController();
    session.isGenerating = true;
    session.generationAbortController = referenceController;
    setBusy(session, true);
    setCampaignStatus(session, 'Matching relevant references', 'generating');
    if (elements.generationElapsed) {
        elements.generationElapsed.textContent = 'Assessing the event brief against the saved Image Library profiles…';
    }
    try {
        await analyseAutomaticReferenceSelection(session, referenceController.signal);
    } catch (error) {
        if (error?.name === 'AbortError') {
            setCampaignStatus(session, 'Generation cancelled', 'neutral');
            return;
        }
        throw error;
    } finally {
        session.isGenerating = false;
        if (session.generationAbortController === referenceController) session.generationAbortController = null;
        setBusy(session, false);
    }

    const generation = createGenerationContext(session, isRegeneration);
    const generationContext = session.context;
    const generationController = new AbortController();
    session.generationSnapshot = generation.snapshot;
    session.failedOutputs.clear();
    session.generationAbortController = generationController;
    session.isGenerating = true;
    session.errorMessage = null;
    session.refinementVisible = false;
    session.publishVisible = false;
    setBusy(session, true);
    setWorkflowStep(session, 2);
    beginGenerationProgress(session, isRegeneration);
    setCampaignStatus(session, 'Generating', 'generating');
    startGenerationClock(session);
    scheduleSessionPersistence(session);

    session.generationPromise = (async () => {
        try {
            const primaryOutput = getPrimaryOutput(session);
            setProgressState(session, 'primary', 'active', isRegeneration ? 'Refining' : 'Generating');
            const primaryResponse = await generatePrimary(generation, isRegeneration, generationController.signal);
            const masterArtworkDataUrl = primaryResponse.dataUrl;
            session.primaryArtworkDataUrl = masterArtworkDataUrl;
            session.artworkByOutput.set(primaryOutput.id, masterArtworkDataUrl);

            setProgressState(session, 'compose', 'active', 'Sizing');
            await composeOutput(session, primaryOutput, masterArtworkDataUrl, generationContext);
            renderCampaignResults(session);
            setProgressState(session, 'primary', 'complete', 'Complete');
            setProgressState(session, 'compose', 'active', 'Primary ready');
            await persistCompletedArtwork(session, primaryOutput.id, masterArtworkDataUrl);

            const selectedOutputIds = new Set(generation.snapshot.selectedOutputIds);
            const variants = session.config.outputs.filter(output => selectedOutputIds.has(output.id) && !output.isPrimary);
            clearVariantArtwork(session);
            renderCampaignResults(session);
            setWorkflowStep(session, 3);
            setProgressState(session, 'variants', 'active', variants.length === 0 ? 'Not selected' : `0 of ${variants.length} ready`);
            // Do not begin another paid image request until the master and the
            // exact list of missing formats are durably recoverable.
            await persistSession(session);

            const failures = await generateVariantBatch(
                session,
                generation,
                variants,
                masterArtworkDataUrl,
                generationContext,
                generationController.signal
            );

            if (failures.size > 0) finishCampaignWithMissingFormats(session);
            else finishCampaignReady(session, variants.length);
            await persistSession(session);
        } catch (error) {
            if (!generationController.signal.aborted) generationController.abort();
            if (error?.name !== 'AbortError' && error?.name !== 'TimeoutError') console.error(error);
            const missingFormats = getMissingVariantOutputs(session);
            if (session.primaryArtworkDataUrl && missingFormats.length > 0) {
                for (const output of missingFormats) {
                    if (!session.failedOutputs.has(output.id)) {
                        session.failedOutputs.set(output.id, serialiseGenerationFailure(error));
                    }
                }
                finishCampaignWithMissingFormats(session);
            } else {
                session.errorMessage = error instanceof Error ? error.message : 'The artwork could not be generated.';
                const statusText = error?.name === 'AbortError'
                    ? 'Generation cancelled'
                    : error?.name === 'TimeoutError'
                        ? 'Generation timed out'
                        : 'Generation failed';
                setCampaignStatus(session, statusText, 'neutral');
                renderGenerationError(session);
            }
            scheduleSessionPersistence(session);
        } finally {
            stopGenerationClock(session);
            session.isGenerating = false;
            session.generationPromise = null;
            if (session.generationAbortController === generationController) {
                session.generationAbortController = null;
            }
            setBusy(session, false);
            await persistSession(session);
        }
    })();

    return session.generationPromise;
}

async function generatePrimary(generation, isRegeneration, signal) {
    const form = generation.snapshot.form;
    const previousArtworkDataUrl = isRegeneration && generation.previousArtworkDataUrl
        ? await artworkSourceToDataUrl(generation.previousArtworkDataUrl)
        : null;
    return postPosterRequest('/api/poster/generate-primary', {
            eventId: form.eventId,
            eventName: form.eventName,
            styleId: generation.snapshot.selectedStyleId,
            styleVariationId: generation.snapshot.styleVariationId,
            eventDate: form.eventDate,
            description: form.description,
            includeDate: form.includeDate,
            includePrice: form.includePrice,
            includeClubBranding: form.includeClubBranding,
            price: form.price,
            additionalInstructions: form.additionalInstructions,
            refinementNotes: isRegeneration ? form.refinementNotes : '',
            previousArtworkDataUrl,
            supportingImages: generation.supportingImages
        }, signal);
}

async function generateVariant(generation, output, masterArtworkDataUrl, signal) {
    const form = generation.snapshot.form;
    return postPosterRequest('/api/poster/generate-variant', {
            eventId: form.eventId,
            eventName: form.eventName,
            styleId: generation.snapshot.selectedStyleId,
            styleVariationId: generation.snapshot.styleVariationId,
            outputId: output.id,
            eventDate: form.eventDate,
            description: form.description,
            primaryArtworkDataUrl: masterArtworkDataUrl,
            includeDate: form.includeDate,
            includePrice: form.includePrice,
            includeClubBranding: form.includeClubBranding,
            price: form.price,
            additionalInstructions: form.additionalInstructions,
            refinementNotes: form.refinementNotes,
            supportingImages: generation.supportingImages
        }, signal);
}

function clearVariantArtwork(session) {
    for (const output of session.config.outputs.filter(output => !output.isPrimary)) {
        session.artworkByOutput.delete(output.id);
        session.posterCanvases.delete(output.id);
    }
}

function getSelectedVariantOutputs(session) {
    const selectedIds = new Set(session.generationSnapshot?.selectedOutputIds ?? [...session.selectedOutputIds]);
    return session.config.outputs.filter(output => selectedIds.has(output.id) && !output.isPrimary);
}

function getMissingVariantOutputs(session) {
    return getSelectedVariantOutputs(session).filter(output => !session.artworkByOutput.has(output.id));
}

async function generateVariantBatch(session, generation, outputs, masterArtworkDataUrl, generationContext, signal) {
    const failures = new Map();
    const allVariants = getSelectedVariantOutputs(session);
    let completedVariants = allVariants.filter(output => session.artworkByOutput.has(output.id)).length;

    for (const output of outputs) {
        if (signal.aborted) throw createGenerationError('AbortError', 'Generation cancelled. Completed artwork has been kept.');
        try {
            const generatedVariant = await generateVariantWithAutomaticRetry(
                generation,
                output,
                masterArtworkDataUrl,
                signal,
                session
            );
            session.artworkByOutput.set(output.id, generatedVariant.dataUrl);
            await composeOutput(session, output, generatedVariant.dataUrl, generationContext);
            await persistCompletedArtwork(session, output.id, generatedVariant.dataUrl);
            session.failedOutputs.delete(output.id);
            completedVariants += 1;
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            const failure = serialiseGenerationFailure(error);
            session.failedOutputs.set(output.id, failure);
            failures.set(output.id, failure);
        }

        setProgressState(session, 'variants', 'active', `${completedVariants} of ${allVariants.length} ready`);
        setProgressState(session, 'compose', 'active', `${session.posterCanvases.size} ready`);
        renderCampaignResults(session);
        await persistSession(session);
    }

    return failures;
}

async function generateVariantWithAutomaticRetry(generation, output, masterArtworkDataUrl, signal, session) {
    let attempt = 0;
    while (true) {
        try {
            return await generateVariant(generation, output, masterArtworkDataUrl, signal);
        } catch (error) {
            if (signal.aborted || error?.name === 'AbortError') throw error;
            if (error?.retryable !== true || attempt >= 1) throw error;
            attempt += 1;
            setProgressState(session, 'variants', 'active', `Retrying ${output.name}`);
            await waitForRetry(5000, signal);
        }
    }
}

function waitForRetry(milliseconds, signal) {
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timeoutId);
            reject(createGenerationError('AbortError', 'Generation cancelled. Completed artwork has been kept.'));
        };
        const timeoutId = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, milliseconds);
        signal.addEventListener('abort', onAbort, { once: true });
    });
}

function serialiseGenerationFailure(error) {
    return {
        message: error instanceof Error ? error.message : 'The image service returned an error.',
        retryable: error?.retryable === true,
        requestId: typeof error?.requestId === 'string' ? error.requestId : null,
        code: typeof error?.code === 'string' ? error.code : null,
        recordedAt: new Date().toISOString()
    };
}

function isGenericGenerationError(message) {
    const normalised = String(message ?? '').trim().toLocaleLowerCase();
    return !normalised || [
        'the image service returned an error.',
        'openai image editing failed.',
        'the artwork could not be generated.'
    ].includes(normalised);
}

function buildMissingFormatsMessage(outputs, failures = activeSession?.failedOutputs) {
    const names = outputs.map(output => output.name);
    const formatList = names.length > 1
        ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
        : names[0] || 'One or more formats';
    const firstFailure = outputs.map(output => failures?.get(output.id)).find(Boolean);
    const reason = firstFailure && !isGenericGenerationError(firstFailure.message)
        ? ` ${firstFailure.message}`
        : '';
    const reference = firstFailure?.requestId ? ` Support reference: ${firstFailure.requestId}.` : '';
    return `${formatList} could not be created.${reason}${reference} The digital-screen master and every completed format have been kept. Use “Retry missing formats” to continue without regenerating them.`;
}

function revealReviewAndShare(session) {
    session.refinementVisible = true;
    session.publishVisible = true;
    if (!isSessionVisible(session)) return;
    elements.refinementPanel.classList.remove('hidden');
    elements.sharePanel.classList.remove('hidden');
    elements.shareTopButton.disabled = false;
}

function finishCampaignReady(session, variantCount = getSelectedVariantOutputs(session).length) {
    session.failedOutputs.clear();
    session.errorMessage = null;
    setProgressState(session, 'variants', 'complete', variantCount === 0 ? 'Skipped' : 'Complete');
    setProgressState(session, 'compose', 'complete', 'Complete');
    setCampaignStatus(session, 'Ready to review', 'ready');
    setWorkflowStep(session, 3, true);
    revealReviewAndShare(session);
    if (isSessionVisible(session)) elements.generationProgress.querySelector('[data-generation-error]')?.remove();
}

function finishCampaignWithMissingFormats(session) {
    const missingFormats = getMissingVariantOutputs(session);
    const readyVariants = getSelectedVariantOutputs(session).length - missingFormats.length;
    session.errorMessage = buildMissingFormatsMessage(missingFormats, session.failedOutputs);
    setProgressState(session, 'variants', 'error', `${readyVariants} of ${getSelectedVariantOutputs(session).length} ready`);
    setProgressState(session, 'compose', 'active', `${session.posterCanvases.size} ready`);
    setCampaignStatus(session, 'Some formats need retrying', 'neutral');
    setWorkflowStep(session, 3, false);
    revealReviewAndShare(session);
    renderGenerationError(session);
}

async function retryMissingFormats(session) {
    if (session.isGenerating) return session.generationPromise;
    const primaryOutput = getPrimaryOutput(session);
    const masterArtworkSource = session.primaryArtworkDataUrl ?? session.artworkByOutput.get(primaryOutput?.id);
    const missingFormats = getMissingVariantOutputs(session);
    if (!masterArtworkSource || missingFormats.length === 0) return;

    session.generationSnapshot ??= {
        id: typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        generatedAt: new Date().toISOString(),
        selectedStyleId: session.selectedStyleId,
        styleVariationId: null,
        selectedOutputIds: [...session.selectedOutputIds],
        form: cloneGenerationForm(session.form)
    };
    const generation = {
        snapshot: session.generationSnapshot,
        supportingImages: buildSupportingImagesPayload(session),
        previousArtworkDataUrl: masterArtworkSource
    };
    const generationController = new AbortController();
    session.generationAbortController = generationController;
    session.isGenerating = true;
    session.errorMessage = null;
    setBusy(session, true);
    setWorkflowStep(session, 3);
    setCampaignStatus(session, 'Retrying missing formats', 'generating');
    setProgressState(session, 'primary', 'complete', 'Kept');
    setProgressState(session, 'variants', 'active', `Retrying ${missingFormats.length}`);
    elements.generationProgress.querySelector('[data-generation-error]')?.remove();
    startGenerationClock(session);
    scheduleSessionPersistence(session);

    session.generationPromise = (async () => {
        try {
            const masterArtworkDataUrl = await artworkSourceToDataUrl(masterArtworkSource);
            const failures = await generateVariantBatch(
                session,
                generation,
                missingFormats,
                masterArtworkDataUrl,
                session.context,
                generationController.signal
            );
            if (failures.size > 0) finishCampaignWithMissingFormats(session);
            else finishCampaignReady(session);
        } catch (error) {
            if (error?.name !== 'AbortError') console.error(error);
            for (const output of getMissingVariantOutputs(session)) {
                if (!session.failedOutputs.has(output.id)) {
                    session.failedOutputs.set(output.id, serialiseGenerationFailure(error));
                }
            }
            finishCampaignWithMissingFormats(session);
        } finally {
            stopGenerationClock(session);
            session.isGenerating = false;
            session.generationPromise = null;
            if (session.generationAbortController === generationController) {
                session.generationAbortController = null;
            }
            setBusy(session, false);
            await persistSession(session);
        }
    })();

    return session.generationPromise;
}


async function addSupportingFiles(session, files) {
    const existing = session.form.supportingImages ?? [];
    const availableSlots = Math.max(0, 4 - existing.length);
    const acceptedFiles = files.slice(0, availableSlots);

    if (acceptedFiles.length === 0) {
        return;
    }

    const processed = [];
    for (const file of acceptedFiles) {
        if (!file.type.startsWith('image/')) {
            continue;
        }

        const dataUrl = await fileToDataUrl(file);
        processed.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            fileName: file.name,
            dataUrl
        });
    }

    session.form.supportingImages = [...existing, ...processed].slice(0, 4);
    renderSupportingFiles(session);
}

function removeSupportingFile(session, fileId) {
    session.form.supportingImages = (session.form.supportingImages ?? []).filter(file => file.id !== fileId);
    renderSupportingFiles(session);
}

function renderSupportingFiles(session) {
    if (!elements.supportingFilesList) return;
    const manualFiles = session.form.supportingImages ?? [];
    const automaticFiles = session.form.useLibraryReferences !== false
        ? session.form.selectedLibraryReferences ?? []
        : [];
    const hasAssessedSelection = Boolean(session.referenceSelection);

    const automaticMarkup = session.form.useLibraryReferences === false
        ? '<div class="automatic-reference-summary muted"><strong>Image Library disabled</strong><small>No shared library images will be supplied.</small></div>'
        : automaticFiles.length > 0
            ? `<div class="automatic-reference-summary"><strong>${automaticFiles.length} relevant library reference${automaticFiles.length === 1 ? '' : 's'} selected</strong><small>${automaticFiles.map(reference => `${escapeHtml(reference.title || 'Untitled reference')}${Number.isFinite(reference.relevanceConfidence) ? ` (${reference.relevanceConfidence}%)` : ''}`).join(' · ')}</small></div>`
            : `<div class="automatic-reference-summary muted"><strong>${hasAssessedSelection ? 'No relevant library reference selected' : 'Library relevance checked at generation'}</strong><small>${hasAssessedSelection ? 'No saved image was specific enough to influence this event.' : 'The complete brief, content choices and saved matching profiles will be assessed before the first image is generated.'}</small></div>`;

    const manualMarkup = manualFiles.map(file => `
        <article class="supporting-file-card">
          <img src="${escapeHtml(file.dataUrl)}" alt="${escapeHtml(file.fileName)}">
          <div class="supporting-file-copy">
            <strong>${escapeHtml(file.fileName)}</strong>
            <small>Uploaded for this event only</small>
          </div>
          <button class="supporting-file-remove" type="button" data-remove-supporting-file="${escapeHtml(file.id)}" aria-label="Remove ${escapeHtml(file.fileName)}">×</button>
        </article>`).join('');

    const manualSection = manualFiles.length > 0
        ? `<div class="supporting-file-section"><h4>Event-specific uploads</h4><div class="supporting-file-stack">${manualMarkup}</div></div>`
        : '<div class="supporting-files-empty">No event-specific supporting images added.</div>';
    elements.supportingFilesList.innerHTML = `${automaticMarkup}${manualSection}`;
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
        reader.readAsDataURL(file);
    });
}

async function postPosterRequest(url, payload, sessionSignal) {
    if (sessionSignal?.aborted) {
        throw createGenerationError('AbortError', 'Generation cancelled. Your saved settings and previous artwork are unchanged.');
    }

    const requestController = new AbortController();
    let timedOut = false;
    const abortRequest = () => requestController.abort();
    sessionSignal?.addEventListener('abort', abortRequest, { once: true });
    const timeoutId = setTimeout(() => {
        timedOut = true;
        requestController.abort();
    }, POSTER_REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: requestController.signal
        });

        return await readApiResponse(response);
    } catch (error) {
        if (timedOut) {
            throw createGenerationError(
                'TimeoutError',
                'The image service did not finish this artwork within five minutes. Your settings are safe; try again or choose fewer output formats.'
            );
        }
        if (sessionSignal?.aborted || error?.name === 'AbortError') {
            throw createGenerationError('AbortError', 'Generation cancelled. Your saved settings and previous artwork are unchanged.');
        }
        if (error instanceof TypeError) {
            throw new Error('Poster Studio could not reach the image service. Check that the application server is running, then try again.');
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
        sessionSignal?.removeEventListener('abort', abortRequest);
    }
}

function createGenerationError(name, message) {
    const error = new Error(message);
    error.name = name;
    return error;
}

async function readApiResponse(response) {
    const responseText = await response.text();
    let body = {};
    if (responseText) {
        try {
            body = JSON.parse(responseText);
        } catch {
            body = { detail: responseText };
        }
    }

    if (!response.ok) {
        const error = new Error(body.detail ?? body.error ?? 'The image service returned an error.');
        error.retryable = body.retryable === true;
        error.requestId = typeof body.requestId === 'string' ? body.requestId : null;
        error.code = typeof body.code === 'string' ? body.code : null;
        error.httpStatus = response.status;
        throw error;
    }

    return body;
}

async function composeOutput(session, output, artworkDataUrl, generationContext) {
    const canvas = await createFinishedPoster(output, artworkDataUrl, session.form.includeClubBranding);
    session.posterCanvases.set(output.id, canvas);

    // Any completed campaign artwork can immediately provide a catalogue
    // thumbnail. A square campaign output is still preferred when one exists.
    if (typeof generationContext?.onArtworkReady === 'function') {
        try {
            generationContext.onArtworkReady(createCatalogueThumbnail(canvas), {
                outputId: output.id,
                isSquare: output.width === output.height,
                generatedAt: new Date().toISOString()
            });
        } catch (error) {
            console.warn('Unable to store catalogue artwork thumbnail.', error);
        }
    }

    if (output.width === output.height && typeof generationContext?.onSquareArtworkReady === 'function') {
        try {
            generationContext.onSquareArtworkReady(createCatalogueThumbnail(canvas));
        } catch (error) {
            console.warn('Unable to store square catalogue artwork thumbnail.', error);
        }
    }

    return canvas;
}

function createCatalogueThumbnail(sourceCanvas) {
    const size = 520;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');

    // Catalogue cards are always edge-to-edge squares. Until a purpose-made
    // square output exists, crop the portrait master centrally for this small
    // preview; the complete uncropped poster remains available in the studio.
    context.clearRect(0, 0, size, size);
    drawImageCover(context, sourceCanvas, size, size);
    return canvas.toDataURL('image/jpeg', 0.84);
}

async function createFinishedPoster(output, artworkDataUrl, includeClubBranding = false) {
    const canvas = document.createElement('canvas');
    canvas.width = output.width;
    canvas.height = output.height;
    const context = canvas.getContext('2d');
    const image = await loadImage(artworkDataUrl);

    context.clearRect(0, 0, canvas.width, canvas.height);
    drawImageCover(context, image, canvas.width, canvas.height);
    if (includeClubBranding) {
        await drawClubBranding(context, canvas.width, canvas.height);
    }

    return canvas;
}

async function recomposeSavedArtwork(session) {
    if (session.artworkByOutput.size === 0) return;

    session.posterCanvases.clear();
    for (const output of session.config.outputs) {
        const dataUrl = session.artworkByOutput.get(output.id);
        if (!dataUrl) continue;
        session.posterCanvases.set(output.id, await createFinishedPoster(output, dataUrl, session.form.includeClubBranding));
    }

    if (isSessionVisible(session)) renderCampaignResults(session);
}

async function drawClubBranding(context, width, height) {
    const mark = await loadImage('/assets/botgc-mark.svg');
    const markHeight = Math.round(Math.min(height * 0.11, width * 0.14));
    const markWidth = Math.round(markHeight * (80 / 92));
    const edgeInset = Math.round(Math.min(width, height) * 0.06);
    const padding = Math.round(markHeight * 0.16);
    const x = width - edgeInset - markWidth;
    const y = edgeInset;

    context.save();
    context.fillStyle = 'rgba(255,255,255,0.9)';
    context.shadowColor = 'rgba(13,53,72,0.2)';
    context.shadowBlur = Math.max(10, Math.round(markHeight * 0.12));
    roundRect(
        context,
        x - padding,
        y - padding,
        markWidth + (padding * 2),
        markHeight + (padding * 2),
        Math.round(markHeight * 0.15)
    );
    context.fill();
    context.shadowColor = 'transparent';
    context.drawImage(mark, x, y, markWidth, markHeight);
    context.restore();
}

function drawImageCover(context, image, width, height) {
    const imageRatio = image.width / image.height;
    const canvasRatio = width / height;
    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = image.width;
    let sourceHeight = image.height;

    if (imageRatio > canvasRatio) {
        sourceWidth = image.height * canvasRatio;
        sourceX = (image.width - sourceWidth) / 2;
    } else {
        sourceHeight = image.width / canvasRatio;
        sourceY = (image.height - sourceHeight) / 2;
    }

    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
}

function roundRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
}

function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('The generated artwork could not be loaded.'));
        image.src = dataUrl;
    });
}

function renderCampaignResults(session) {
    if (!isSessionVisible(session)) return;
    elements.emptyState.classList.add('hidden');
    elements.generatedArtworkPanel.classList.remove('hidden');
    elements.posterResults.classList.remove('hidden');
    elements.posterResults.innerHTML = '';

    const readyCount = getSelectedOutputs(session).filter(output => session.posterCanvases.has(output.id)).length;
    const selectedCount = getSelectedOutputs(session).length;
    elements.generatedArtworkCount.textContent = `${readyCount} of ${selectedCount} ready`;
    elements.generatedArtworkCount.className = `status-pill ${readyCount === selectedCount ? 'ready' : 'generating'}`;

    const primaryOutput = getPrimaryOutput(session);
    const primaryCanvas = session.posterCanvases.get(primaryOutput.id);

    if (primaryCanvas) {
        const feature = document.createElement('article');
        feature.className = 'poster-feature';
        feature.append(primaryCanvas);
        feature.append(createPosterFooter(primaryOutput, primaryCanvas));
        elements.posterResults.append(feature);
    }

    const variantOutputs = getSelectedOutputs(session).filter(output => !output.isPrimary && session.posterCanvases.has(output.id));

    if (variantOutputs.length > 0) {
        const grid = document.createElement('div');
        grid.className = 'variant-grid';

        for (const output of variantOutputs) {
            const canvas = session.posterCanvases.get(output.id);
            const card = document.createElement('article');
            card.className = 'poster-card';
            card.append(canvas);
            card.append(createPosterFooter(output, canvas));
            grid.append(card);
        }

        elements.posterResults.append(grid);
    }
}

function createPosterFooter(output, canvas) {
    const footer = document.createElement('div');
    footer.className = output.isPrimary ? 'poster-feature-footer' : 'poster-card-footer';
    const copy = document.createElement('div');
    copy.innerHTML = `<strong>${escapeHtml(output.name)}</strong><small>${output.width} × ${output.height}</small>`;
    const download = document.createElement('a');
    download.className = 'format-download';
    download.href = '#';
    download.textContent = 'Download PNG';
    download.addEventListener('click', event => {
        event.preventDefault();
        downloadCanvas(canvas, `${slugify(activeSession?.form?.eventName || 'current-event')}-${output.id}.png`);
    });
    footer.append(copy, download);
    return footer;
}

function downloadCanvas(canvas, fileName) {
    canvas.toBlob(blob => {
        if (!blob) {
            return;
        }

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
    }, 'image/png');
}

function getLocalTodayIso() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getDefaultShareTags(session) {
    return [
        'event-playbook',
        'clubhouse-screens',
        slugify(getCampaignEventName(session))
    ].filter(Boolean).join(', ');
}

function captureScreenShareDialog(session) {
    if (!elements.yodeckMediaName) return;
    session.form.publishMediaName = elements.yodeckMediaName?.value.trim() ?? '';
    session.form.publishTags = elements.yodeckTags?.value.trim() ?? '';
    session.form.publishStartDate = elements.yodeckStartDate?.value ?? '';
}

function revealShareOptions() {
    elements.sharePanel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showEmailShareStatus() {
    elements.shareMessage.textContent = 'Email to members is not connected yet. The campaign artwork remains ready here for the future email integration.';
}

function openScreenShareDialog() {
    const session = activeSession;
    if (!session || !elements.publishDialog) return;

    const primaryOutput = getPrimaryOutput(session);
    const primaryCanvas = primaryOutput ? session.posterCanvases.get(primaryOutput.id) : null;
    if (!primaryOutput || !primaryCanvas) {
        elements.shareMessage.textContent = 'Generate the Clubhouse Digital Display artwork before sending it to the screens.';
        return;
    }

    const eventDate = session.form.eventDate;
    const today = getLocalTodayIso();
    const defaultStartDate = today <= eventDate ? today : eventDate;
    const savedStartDate = session.form.publishStartDate;
    const startDate = savedStartDate && savedStartDate <= eventDate ? savedStartDate : defaultStartDate;

    elements.publishPreview.src = primaryCanvas.toDataURL('image/png');
    elements.yodeckMediaName.value = session.form.publishMediaName
        || `${getCampaignEventName(session)} — Clubhouse screens — ${eventDate}`;
    elements.yodeckTags.value = session.form.publishTags || getDefaultShareTags(session);
    elements.yodeckStartDate.value = startDate;
    elements.yodeckStartDate.min = defaultStartDate;
    elements.yodeckStartDate.max = eventDate;
    elements.yodeckEndDate.value = eventDate;
    elements.publishDialogMessage.textContent = '';
    elements.publishDialogMessage.className = 'poster-publish-dialog-message';
    elements.publishDialogConfirm.textContent = session.screenPublication
        ? 'Update clubhouse screens'
        : 'Send to clubhouse screens';

    const screenConnection = session.config?.clubhouseScreens ?? {};
    elements.yodeckPlaylistName.textContent = screenConnection.destinationName || 'Clubhouse screens';
    elements.yodeckConnectionStatus.className = `yodeck-connection-status ${screenConnection.configured ? 'ready' : 'unavailable'}`;
    elements.yodeckConnectionStatus.innerHTML = screenConnection.configured
        ? '<span></span><div><strong>Clubhouse screen connection ready</strong><small>Artwork is sent securely from Event Playbook.</small></div>'
        : '<span></span><div><strong>Clubhouse screen connection unavailable</strong><small>Ask an administrator to complete the server connection before sharing.</small></div>';
    elements.publishDialogConfirm.disabled = !screenConnection.configured;
    if (screenConnection.configured && session.screenPublication) {
        elements.publishDialogMessage.textContent = 'This event already has a clubhouse-screen item. Sending again will replace its image, name, tags and dates without adding another playlist entry.';
    }

    elements.publishDialog.showModal();
    requestAnimationFrame(() => elements.yodeckMediaName.focus());
}

function closePublishDialog() {
    const session = activeSession;
    if (session) {
        captureScreenShareDialog(session);
        scheduleSessionPersistence(session);
    }
    elements.publishDialog?.close();
}

async function sendToClubhouseScreens() {
    const session = activeSession;
    const primaryOutput = getPrimaryOutput(session);
    const primaryCanvas = primaryOutput ? session.posterCanvases.get(primaryOutput.id) : null;
    if (!primaryOutput || !primaryCanvas) {
        elements.publishDialogMessage.textContent = 'The Clubhouse Digital Display artwork is not ready.';
        elements.publishDialogMessage.className = 'poster-publish-dialog-message error';
        return;
    }

    captureScreenShareDialog(session);
    const startDate = session.form.publishStartDate;
    const eventDate = session.form.eventDate;
    if (!startDate || startDate > eventDate) {
        elements.publishDialogMessage.textContent = 'Choose a start date on or before the event date.';
        elements.publishDialogMessage.className = 'poster-publish-dialog-message error';
        return;
    }

    const tags = session.form.publishTags
        .split(',')
        .map(tag => tag.trim())
        .filter(Boolean);

    elements.shareScreensButton.disabled = true;
    elements.publishDialogConfirm.disabled = true;
    elements.publishDialogConfirm.textContent = 'Sending to clubhouse screens…';
    elements.shareMessage.textContent = 'Sending the digital-screen artwork to the clubhouse screens…';
    elements.publishDialogMessage.textContent = 'Uploading the artwork and updating the clubhouse screen rotation…';
    elements.publishDialogMessage.className = 'poster-publish-dialog-message working';

    try {
        const response = await fetch('/api/poster/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                eventId: session.context?.eventId || session.key,
                eventName: getCampaignEventName(session),
                eventDate,
                startDate,
                mediaName: session.form.publishMediaName,
                tags,
                digitalScreenAsset: {
                    outputId: primaryOutput.id,
                    name: primaryOutput.name,
                    dataUrl: primaryCanvas.toDataURL('image/png')
                },
                sendToClubhouseScreens: true
            })
        });
        const result = await readApiResponse(response);
        const screenResult = result.clubhouseScreens;
        const wasUpdated = screenResult.operation === 'updated';
        session.screenPublication = {
            mediaId: Number(screenResult.artworkId),
            mediaName: screenResult.artworkName,
            destinationName: screenResult.destinationName,
            startDate: screenResult.startDate,
            endDate: screenResult.endDate,
            updatedAt: new Date().toISOString()
        };
        elements.shareMessage.textContent = wasUpdated
            ? `“${screenResult.artworkName}” was updated on ${screenResult.destinationName}; its schedule now runs from ${screenResult.startDate} to ${screenResult.endDate}.`
            : `“${screenResult.artworkName}” will appear on ${screenResult.destinationName} from ${screenResult.startDate} to ${screenResult.endDate}.`;
        elements.publishDialogMessage.textContent = wasUpdated
            ? `Updated successfully. No additional screen-library or playlist item was created.`
            : `Sent successfully. The artwork is now scheduled for ${screenResult.destinationName}.`;
        elements.publishDialogMessage.className = 'poster-publish-dialog-message success';
        elements.publishDialogConfirm.textContent = wasUpdated ? 'Clubhouse screens updated' : 'Sent to clubhouse screens';

        const selectedOutputs = getSelectedOutputs(session);
        const squareOutput = selectedOutputs
            .find(output => output.width === output.height && session.posterCanvases.has(output.id));
        const bestOutput = squareOutput
            ?? selectedOutputs.find(output => session.posterCanvases.has(output.id))
            ?? session.config.outputs.find(output => session.posterCanvases.has(output.id));

        if (bestOutput && typeof session.context?.onArtworkPublished === 'function') {
            const bestCanvas = session.posterCanvases.get(bestOutput.id);
            session.context.onArtworkPublished(createCatalogueThumbnail(bestCanvas), {
                outputId: bestOutput.id,
                isSquare: bestOutput.width === bestOutput.height,
                generatedAt: new Date().toISOString()
            });
        }

        setWorkflowStep(session, 4, true);
        await persistSession(session);
        elements.publishDialog?.close();
    } catch (error) {
        const message = error instanceof Error ? error.message : 'The artwork could not be sent to the clubhouse screens.';
        elements.shareMessage.textContent = message;
        elements.publishDialogMessage.textContent = message;
        elements.publishDialogMessage.className = 'poster-publish-dialog-message error';
        elements.publishDialogConfirm.textContent = 'Try sending again';
        elements.publishDialogConfirm.disabled = false;
    } finally {
        elements.shareScreensButton.disabled = false;
    }
}

function beginGenerationProgress(session, isRegeneration) {
    session.errorMessage = null;
    session.progress = {
        primary: { cssClass: '', label: 'Waiting' },
        variants: { cssClass: '', label: 'Waiting' },
        compose: { cssClass: '', label: 'Waiting' }
    };
    if (!isRegeneration) {
        session.artworkByOutput.clear();
        session.posterCanvases.clear();
        session.primaryArtworkDataUrl = null;
    }

    if (!isSessionVisible(session)) return;
    elements.generationProgress.querySelector('[data-generation-error]')?.remove();
    elements.emptyState.classList.add('hidden');
    elements.refinementPanel.classList.add('hidden');
    elements.generationProgress.classList.remove('hidden');
    if (!isRegeneration) {
        elements.posterResults.innerHTML = '';
        elements.generatedArtworkPanel.classList.add('hidden');
        elements.generatedArtworkCount.textContent = '0 ready';
        elements.generatedArtworkCount.className = 'status-pill neutral';
    } else if (session.posterCanvases.size > 0) {
        elements.generatedArtworkPanel.classList.remove('hidden');
    }
}

function setProgressState(session, name, cssClass, label) {
    session.progress[name] = { cssClass, label };
    if (!isSessionVisible(session)) return;
    const row = elements.generationProgress?.querySelector(`[data-progress="${name}"]`);
    if (!row) return;
    row.classList.remove('active', 'complete', 'error');
    if (cssClass) row.classList.add(cssClass);
    const stateLabel = row.querySelector('.progress-state');
    if (stateLabel) stateLabel.textContent = label;
}

function setCampaignStatus(session, text, mode) {
    session.campaignStatus = { text, mode };
    if (!isSessionVisible(session)) return;
    elements.campaignStatus.textContent = text;
    elements.campaignStatus.className = `status-pill ${mode}`;
}

function setWorkflowStep(session, step, complete = false) {
    session.workflowStep = step;
    session.workflowComplete = complete;
    if (!isSessionVisible(session)) return;
    document.querySelectorAll('.poster-studio .workflow-step').forEach(item => {
        const itemStep = Number(item.dataset.step);
        item.classList.toggle('active', itemStep === step && !complete);
        item.classList.toggle('complete', itemStep < step || (itemStep === step && complete));
    });
}

function startGenerationClock(session) {
    stopGenerationClock(session, false);
    session.generationStartedAt = Date.now();

    const updateElapsed = () => {
        if (!isSessionVisible(session) || !elements.generationElapsed || !session.generationStartedAt) return;
        const elapsedSeconds = Math.max(0, Math.floor((Date.now() - session.generationStartedAt) / 1000));
        elements.generationElapsed.textContent = `Working for ${formatElapsedTime(elapsedSeconds)}. High-quality artwork can take several minutes.`;
    };

    updateElapsed();
    session.generationTimer = setInterval(updateElapsed, 1000);
}

function stopGenerationClock(session, showFinishedTime = true) {
    if (session.generationTimer) {
        clearInterval(session.generationTimer);
        session.generationTimer = null;
    }

    if (showFinishedTime && session.generationStartedAt && isSessionVisible(session) && elements.generationElapsed) {
        const elapsedSeconds = Math.max(0, Math.floor((Date.now() - session.generationStartedAt) / 1000));
        const outcome = session.campaignStatus.mode === 'ready' ? 'Finished' : 'Stopped';
        elements.generationElapsed.textContent = `${outcome} after ${formatElapsedTime(elapsedSeconds)}.`;
    }
    session.generationStartedAt = null;
}

function formatElapsedTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

function cancelGeneration(session) {
    if (!session.isGenerating || !session.generationAbortController) return;
    setCampaignStatus(session, 'Cancelling', 'generating');
    session.generationAbortController.abort();
    if (isSessionVisible(session) && elements.cancelGenerationButton) {
        elements.cancelGenerationButton.disabled = true;
        elements.cancelGenerationButton.textContent = 'Cancelling…';
    }
}

function setBusy(session, isBusy) {
    if (!isSessionVisible(session)) return;
    elements.generateButton.disabled = isBusy;
    elements.regenerateButton.disabled = isBusy;
    elements.generationProgress?.querySelectorAll('[data-retry-missing-formats]').forEach(button => {
        button.disabled = isBusy;
    });
    if (elements.cancelGenerationButton) {
        elements.cancelGenerationButton.classList.toggle('hidden', !isBusy);
        elements.cancelGenerationButton.disabled = !isBusy;
        elements.cancelGenerationButton.textContent = 'Cancel generation';
    }
    document.querySelectorAll('.poster-studio .brief-panel input, .poster-studio .brief-panel select, .poster-studio .brief-panel textarea').forEach(control => {
        if (isBusy) {
            if (!Object.hasOwn(control.dataset, 'posterWasDisabled')) {
                control.dataset.posterWasDisabled = control.disabled ? 'true' : 'false';
            }
            control.disabled = true;
        } else if (Object.hasOwn(control.dataset, 'posterWasDisabled')) {
            control.disabled = control.dataset.posterWasDisabled === 'true';
            delete control.dataset.posterWasDisabled;
        }
    });
    document.body.classList.toggle('busy', isBusy);
}

function renderGenerationError(session) {
    if (!isSessionVisible(session) || !session.errorMessage) return;
    const canRetryMissingFormats = Boolean(session.primaryArtworkDataUrl) && getMissingVariantOutputs(session).length > 0;
    elements.generationProgress.classList.remove('hidden');
    elements.generationProgress.querySelector('[data-generation-error]')?.remove();
    elements.generationProgress.insertAdjacentHTML('beforeend', `<div class="progress-row generation-error-row" data-generation-error><span class="progress-icon">!</span><div><strong>${canRetryMissingFormats ? 'Some formats are missing' : 'Generation stopped'}</strong><small>${escapeHtml(session.errorMessage)}</small></div><div class="generation-error-actions"><span class="progress-state">Error</span>${canRetryMissingFormats ? '<button class="button button-secondary" type="button" data-retry-missing-formats>Retry missing formats</button>' : ''}</div></div>`);
    elements.generationProgress.querySelector('[data-retry-missing-formats]')?.addEventListener('click', () => retryMissingFormats(session));
}

function getCampaignEventName(session) {
    return session.customEventName || session.form.eventName || 'Current event';
}

function getPrimaryOutput(session = activeSession) {
    return session.config.outputs.find(output => output.isPrimary);
}

function getSelectedOutputs(session = activeSession) {
    return session.config.outputs.filter(output => session.selectedOutputIds.has(output.id));
}

function slugify(value) {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}
