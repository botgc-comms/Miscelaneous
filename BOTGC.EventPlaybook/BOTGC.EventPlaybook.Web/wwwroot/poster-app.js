import {
    chooseNewestStoredSession,
    conceptsForGeneration,
    getSessionContentTimestamp
} from './poster-session-state.js?v=20260909-latest-concepts-1';

const sessions = new Map();
const REFERENCE_LIBRARY_STORAGE_KEY = 'botgc-event-playbook-reference-library-v1';
const MAX_AUTOMATIC_REFERENCES = 3;
const STUDIO_DATABASE_NAME = 'botgc-event-playbook-poster-studio';
const STUDIO_DATABASE_VERSION = 1;
const STUDIO_SESSION_STORE = 'event-sessions';
const POSTER_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_SAFETY_PROMPT_RETRIES = 3;
const CONCEPT_PREVIEW_COUNT = 3;
const SOURCE_DESIGN_OUTPUT_ID = 'source-design';
const SOURCE_DESIGN_MAX_BYTES = 40 * 1024 * 1024;
const SOURCE_DESIGN_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
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
        sourceDesign: null,
        generationOrigin: 'concept',
        concepts: [],
        selectedConceptId: null,
        artworkByOutput: new Map(),
        posterCanvases: new Map(),
        failedOutputs: new Map(),
        isGenerating: false,
        initialised: false,
        hydrated: false,
        restoredFromStorage: false,
        contentUpdatedAt: null,
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
            publishStartDate: '',
            diaryTitle: (context?.eventName ?? '').trim(),
            diaryDescription: '',
            diaryStartTime: context?.startTime ?? '',
            diaryEndTime: context?.endTime ?? '',
            diaryBookingUrl: '',
            emailSubject: '',
            emailBodyHtml: '',
            emailTestAddress: '',
            emailAudienceMode: 'all',
            emailMembershipCategories: []
        },
        progress: {
            concepts: { cssClass: '', label: 'Waiting' },
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
        screenPublishOperation: null,
        isPublishingScreens: false,
        diaryPublication: null,
        emailPublication: null,
        memberEmailMembers: [],
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
        request.onerror = () => reject(request.error ?? new Error('Unable to open Communications Centre storage.'));
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
        request.onerror = () => reject(request.error ?? new Error('Unable to read the saved Communications Centre session.'));
    });
}

async function writeStoredSession(record) {
    const database = await openStudioDatabase();
    if (!database) return;

    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STUDIO_SESSION_STORE, 'readwrite');
        transaction.objectStore(STUDIO_SESSION_STORE).put(record);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('Unable to save the Communications Centre session.'));
        transaction.onabort = () => reject(transaction.error ?? new Error('Saving the Communications Centre session was interrupted.'));
    });
}

async function readServerSession(key) {
    const response = await fetch(`/api/poster/session?key=${encodeURIComponent(key)}`, { cache: 'no-store' });
    if (response.status === 404) return null;
    if (!response.ok) {
        throw new Error(`Communications Centre shared session load failed (${response.status}).`);
    }
    return response.json();
}

async function writeServerSession(key, record, expectedRevision) {
    const response = await fetch(`/api/poster/session?key=${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision, session: record })
    });
    const document = await response.json();
    if (response.status === 409) {
        return { conflict: true, document };
    }
    if (!response.ok) {
        throw new Error(document?.error ?? `Communications Centre shared session save failed (${response.status}).`);
    }
    return { conflict: false, document };
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
    return {
        url: document.url,
        version: typeof document.version === 'string' ? document.version : getArtworkVersion(document.url)
    };
}

async function persistCompletedArtwork(session, outputId, artworkSource) {
    if (!isInlineArtworkSource(artworkSource)) return artworkSource;
    try {
        const storedArtwork = await writeServerArtwork(session.key, outputId, artworkSource);
        session.artworkByOutput.set(outputId, storedArtwork.url);
        if (getPrimaryOutput(session)?.id === outputId) {
            session.primaryArtworkDataUrl = storedArtwork.url;
        }
        return storedArtwork.url;
    } catch (error) {
        // Keep the inline image in the browser session. The shared-session writer
        // deliberately excludes it so one oversized payload cannot erase the
        // last good server copy.
        console.warn(`Unable to persist completed artwork for ${outputId}.`, error);
        return artworkSource;
    }
}

async function persistConceptArtwork(session, concept, artworkSource) {
    if (!isInlineArtworkSource(artworkSource)) return artworkSource;
    const generationId = concept.generationId ?? session.generationSnapshot?.id ?? null;
    concept.generationId = generationId;
    try {
        const storedArtwork = await writeServerArtwork(session.key, concept.id, artworkSource);
        if (!generationId || (session.generationSnapshot?.id === generationId && session.concepts.includes(concept))) {
            concept.artworkSource = storedArtwork.url;
        }
        return storedArtwork.url;
    } catch (error) {
        console.warn(`Unable to persist ${concept.id}.`, error);
        return artworkSource;
    }
}

async function persistSourceDesignArtwork(session) {
    const sourceDesign = session.sourceDesign;
    if (!sourceDesign || !isInlineArtworkSource(sourceDesign.artworkSource)) {
        return sourceDesign?.artworkSource ?? null;
    }

    try {
        const storedArtwork = await writeServerArtwork(session.key, SOURCE_DESIGN_OUTPUT_ID, sourceDesign.artworkSource);
        if (session.sourceDesign === sourceDesign) {
            sourceDesign.artworkSource = storedArtwork.url;
            sourceDesign.version = storedArtwork.version;
            sourceDesign.saved = true;
        }
        return storedArtwork.url;
    } catch (error) {
        sourceDesign.saved = false;
        console.warn('Unable to persist the uploaded source design.', error);
        return sourceDesign.artworkSource;
    }
}

function getArtworkVersion(artworkSource) {
    if (typeof artworkSource !== 'string' || !artworkSource) return null;
    try {
        return new URL(artworkSource, globalThis.location?.origin ?? 'http://localhost').searchParams.get('version');
    } catch {
        return null;
    }
}

async function migrateInlineArtwork(session) {
    for (const [outputId, artworkSource] of [...session.artworkByOutput]) {
        if (!isInlineArtworkSource(artworkSource)) continue;
        await persistCompletedArtwork(session, outputId, artworkSource);
    }
    for (const concept of session.concepts) {
        if (!isInlineArtworkSource(concept.artworkSource)) continue;
        await persistConceptArtwork(session, concept, concept.artworkSource);
    }
    if (isInlineArtworkSource(session.sourceDesign?.artworkSource)) {
        await persistSourceDesignArtwork(session);
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
    const form = session.sourceDesign ? session.form : session.generationSnapshot?.form ?? session.form;
    const generationWasInterrupted = session.isGenerating && session.campaignStatus.mode === 'generating';
    const compactGenerationSnapshot = session.generationSnapshot
        ? {
            id: session.generationSnapshot.id,
            generatedAt: session.generationSnapshot.generatedAt,
            selectedStyleId: session.generationSnapshot.selectedStyleId,
            styleVariationId: session.generationSnapshot.styleVariationId,
            conceptStyleVariationIds: session.generationSnapshot.conceptStyleVariationIds ?? [],
            isRegeneration: session.generationSnapshot.isRegeneration === true,
            generationOrigin: session.generationSnapshot.generationOrigin ?? session.generationOrigin,
            safetyRecovery: session.generationSnapshot.safetyRecovery ?? null,
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
    const concepts = session.concepts.map(concept => ({
        id: concept.id,
        index: concept.index,
        generationId: concept.generationId ?? session.generationSnapshot?.id ?? null,
        styleVariationId: concept.styleVariationId,
        artworkSource: includeInlineArtwork || !isInlineArtworkSource(concept.artworkSource)
            ? concept.artworkSource
            : null,
        status: concept.status,
        failure: concept.failure ?? null
    }));
    const sourceDesign = session.sourceDesign
        ? {
            fileName: session.sourceDesign.fileName,
            artworkSource: includeInlineArtwork || !isInlineArtworkSource(session.sourceDesign.artworkSource)
                ? session.sourceDesign.artworkSource
                : null,
            version: session.sourceDesign.version ?? getArtworkVersion(session.sourceDesign.artworkSource),
            width: session.sourceDesign.width,
            height: session.sourceDesign.height,
            byteLength: session.sourceDesign.byteLength,
            uploadedAt: session.sourceDesign.uploadedAt,
            saved: session.sourceDesign.saved === true
        }
        : null;

    return {
        key: session.key,
        schemaVersion: 10,
        savedAt: new Date().toISOString(),
        contentUpdatedAt: session.contentUpdatedAt,
        selectedStyleId: session.selectedStyleId,
        selectedOutputIds: [...session.selectedOutputIds],
        primaryArtworkDataUrl,
        sourceDesign,
        generationOrigin: session.generationOrigin,
        artworkByOutput,
        failedOutputs: Object.fromEntries(session.failedOutputs),
        concepts,
        selectedConceptId: session.selectedConceptId,
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
            publishStartDate: session.form.publishStartDate,
            diaryTitle: session.form.diaryTitle,
            diaryDescription: session.form.diaryDescription,
            diaryStartTime: session.form.diaryStartTime,
            diaryEndTime: session.form.diaryEndTime,
            diaryBookingUrl: session.form.diaryBookingUrl,
            emailSubject: session.form.emailSubject,
            emailBodyHtml: session.form.emailBodyHtml,
            emailTestAddress: session.form.emailTestAddress,
            emailAudienceMode: session.form.emailAudienceMode,
            emailMembershipCategories: session.form.emailMembershipCategories
        },
        workflowStep: session.workflowStep,
        workflowComplete: generationWasInterrupted ? false : session.workflowComplete,
        campaignStatus: generationWasInterrupted
            ? { text: 'Generation interrupted', mode: 'neutral' }
            : session.campaignStatus,
        errorMessage: generationWasInterrupted ? INTERRUPTED_GENERATION_MESSAGE : session.errorMessage,
        refinementVisible: session.refinementVisible,
        publishVisible: session.publishVisible,
        screenPublication: session.screenPublication,
        screenPublishOperation: session.screenPublishOperation,
        diaryPublication: session.diaryPublication,
        emailPublication: session.emailPublication
    };
}

function applyStoredSession(session, stored) {
    if (!stored || typeof stored !== 'object') return false;
    session.contentUpdatedAt = typeof stored.contentUpdatedAt === 'string'
        ? stored.contentUpdatedAt
        : null;
    const storedGenerationWasInterrupted = stored.campaignStatus?.mode === 'generating'
        || stored.campaignStatus?.text === 'Generation interrupted';

    if (typeof stored.selectedStyleId === 'string') {
        session.selectedStyleId = stored.selectedStyleId;
    }
    if (Array.isArray(stored.selectedOutputIds)) {
        session.selectedOutputIds = new Set(stored.selectedOutputIds.filter(value => typeof value === 'string'));
    }

    const storedForm = stored.form && typeof stored.form === 'object' ? stored.form : {};
    const stringFields = ['eventId', 'eventName', 'eventDate', 'description', 'price', 'additionalInstructions', 'refinementNotes', 'publishMediaName', 'publishTags', 'publishStartDate', 'diaryTitle', 'diaryDescription', 'diaryStartTime', 'diaryEndTime', 'diaryBookingUrl', 'emailSubject', 'emailBodyHtml', 'emailTestAddress', 'emailAudienceMode'];
    for (const field of stringFields) {
        if (typeof storedForm[field] === 'string') session.form[field] = storedForm[field];
    }
    if (typeof storedForm.includeDate === 'boolean') session.form.includeDate = storedForm.includeDate;
    if (typeof storedForm.includePrice === 'boolean') session.form.includePrice = storedForm.includePrice;
    if (typeof storedForm.includeClubBranding === 'boolean') session.form.includeClubBranding = storedForm.includeClubBranding;
    if (typeof storedForm.useLibraryReferences === 'boolean') session.form.useLibraryReferences = storedForm.useLibraryReferences;
    if (Array.isArray(storedForm.supportingImages)) session.form.supportingImages = storedForm.supportingImages;
    if (Array.isArray(storedForm.emailMembershipCategories)) {
        session.form.emailMembershipCategories = storedForm.emailMembershipCategories.filter(value => typeof value === 'string');
    }
    session.form.selectedLibraryReferences = [];

    const storedSourceDesign = stored.sourceDesign && typeof stored.sourceDesign === 'object'
        ? stored.sourceDesign
        : null;
    const storedSourceDesignArtwork = isPersistedArtworkSource(storedSourceDesign?.artworkSource)
        ? storedSourceDesign.artworkSource
        : null;
    session.sourceDesign = storedSourceDesignArtwork
        ? {
            fileName: typeof storedSourceDesign.fileName === 'string' ? storedSourceDesign.fileName : 'uploaded-design.png',
            artworkSource: storedSourceDesignArtwork,
            version: typeof storedSourceDesign.version === 'string'
                ? storedSourceDesign.version
                : getArtworkVersion(storedSourceDesignArtwork),
            width: Number(storedSourceDesign.width) || 0,
            height: Number(storedSourceDesign.height) || 0,
            byteLength: Number(storedSourceDesign.byteLength) || 0,
            uploadedAt: typeof storedSourceDesign.uploadedAt === 'string' ? storedSourceDesign.uploadedAt : stored.savedAt,
            saved: !isInlineArtworkSource(storedSourceDesignArtwork) || storedSourceDesign.saved === true
        }
        : null;
    session.generationOrigin = stored.generationOrigin === 'uploaded-design'
        ? 'uploaded-design'
        : 'concept';

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
    const storedGenerationId = typeof stored.generationSnapshot?.id === 'string'
        ? stored.generationSnapshot.id
        : null;
    session.concepts = Array.isArray(stored.concepts)
        ? conceptsForGeneration(stored.concepts, storedGenerationId)
            .map((concept, index) => {
                const artworkSource = isPersistedArtworkSource(concept.artworkSource) ? concept.artworkSource : null;
                return {
                    id: concept.id,
                    index: Number.isFinite(concept.index) ? concept.index : index,
                    generationId: typeof concept.generationId === 'string'
                        ? concept.generationId
                        : storedGenerationId,
                    styleVariationId: typeof concept.styleVariationId === 'string' ? concept.styleVariationId : null,
                    artworkSource,
                    status: artworkSource ? 'ready' : concept.status === 'failed' ? 'failed' : 'waiting',
                    failure: concept.failure && typeof concept.failure === 'object' ? concept.failure : null
                };
            })
            .sort((left, right) => left.index - right.index)
        : [];
    if (storedGenerationWasInterrupted) {
        for (const concept of session.concepts.filter(item => !item.artworkSource && item.status !== 'failed')) {
            concept.status = 'failed';
            concept.failure = {
                message: 'This preview was interrupted before it finished. Retry only this idea or continue with a completed concept.',
                retryable: true,
                recordedAt: stored.savedAt ?? new Date().toISOString()
            };
        }
    }
    session.selectedConceptId = session.concepts.some(concept => concept.id === stored.selectedConceptId && concept.artworkSource)
        ? stored.selectedConceptId
        : null;

    if (session.artworkByOutput.size > 0 || session.concepts.length > 0) {
        applyGenerationSnapshot(session, stored.generationSnapshot);
        session.generationSnapshot = {
            id: typeof stored.generationSnapshot?.id === 'string' ? stored.generationSnapshot.id : null,
            generatedAt: stored.generationSnapshot?.generatedAt ?? stored.savedAt ?? new Date().toISOString(),
            selectedStyleId: session.selectedStyleId,
            styleVariationId: typeof stored.generationSnapshot?.styleVariationId === 'string'
                ? stored.generationSnapshot.styleVariationId
                : null,
            conceptStyleVariationIds: Array.isArray(stored.generationSnapshot?.conceptStyleVariationIds)
                ? stored.generationSnapshot.conceptStyleVariationIds.filter(value => typeof value === 'string')
                : session.concepts.map(concept => concept.styleVariationId).filter(Boolean),
            isRegeneration: stored.generationSnapshot?.isRegeneration === true,
            generationOrigin: stored.generationSnapshot?.generationOrigin === 'uploaded-design'
                ? 'uploaded-design'
                : session.generationOrigin,
            safetyRecovery: stored.generationSnapshot?.safetyRecovery && typeof stored.generationSnapshot.safetyRecovery === 'object'
                ? stored.generationSnapshot.safetyRecovery
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
            pushConfirmed: stored.screenPublication.pushConfirmed === true,
            pushStatus: String(stored.screenPublication.pushStatus ?? ''),
            screenCount: Number(stored.screenPublication.screenCount || 0),
            uploadConfirmed: stored.screenPublication.uploadConfirmed === true,
            mediaSource: String(stored.screenPublication.mediaSource ?? ''),
            width: Number(stored.screenPublication.width || 0),
            height: Number(stored.screenPublication.height || 0),
            updatedAt: String(stored.screenPublication.updatedAt ?? '')
        };
    }
    if (stored.screenPublishOperation && typeof stored.screenPublishOperation === 'object') {
        const storedStatus = String(stored.screenPublishOperation.status ?? '');
        session.screenPublishOperation = {
            status: storedStatus === 'sending' ? 'failed' : storedStatus,
            mediaName: String(stored.screenPublishOperation.mediaName ?? ''),
            startDate: String(stored.screenPublishOperation.startDate ?? ''),
            endDate: String(stored.screenPublishOperation.endDate ?? ''),
            startedAt: String(stored.screenPublishOperation.startedAt ?? ''),
            updatedAt: String(stored.screenPublishOperation.updatedAt ?? ''),
            error: storedStatus === 'sending'
                ? 'The previous background send was interrupted when the page closed. Try again; the existing Yodeck item will be updated rather than duplicated.'
                : String(stored.screenPublishOperation.error ?? '')
        };
    }
    if (stored.diaryPublication && typeof stored.diaryPublication === 'object' && stored.diaryPublication.remoteId) {
        session.diaryPublication = {
            remoteId: String(stored.diaryPublication.remoteId),
            externalId: String(stored.diaryPublication.externalId ?? ''),
            operation: String(stored.diaryPublication.operation ?? 'saved'),
            eventDate: String(stored.diaryPublication.eventDate ?? ''),
            updatedAt: String(stored.diaryPublication.updatedAt ?? '')
        };
    }
    if (stored.emailPublication && typeof stored.emailPublication === 'object' && Number(stored.emailPublication.sent) > 0) {
        session.emailPublication = {
            sent: Number(stored.emailPublication.sent),
            sentAt: String(stored.emailPublication.sentAt ?? ''),
            subject: String(stored.emailPublication.subject ?? '')
        };
    }

    if (session.artworkByOutput.size > 0 && session.generationOrigin === 'uploaded-design') {
        const expectedOutputs = session.config.outputs;
        const readyOutputs = expectedOutputs.filter(output => session.artworkByOutput.has(output.id));
        const missingOutputs = expectedOutputs.filter(output => !session.artworkByOutput.has(output.id));
        const hasMissingFormats = missingOutputs.length > 0;
        session.progress = {
            concepts: { cssClass: 'complete', label: 'Original retained' },
            primary: {
                cssClass: hasMissingFormats ? 'error' : 'complete',
                label: `${readyOutputs.length} of ${expectedOutputs.length} ready`
            },
            variants: { cssClass: 'complete', label: 'Original-only source' },
            compose: {
                cssClass: hasMissingFormats ? 'active' : 'complete',
                label: `${readyOutputs.length} ready`
            }
        };
        session.campaignStatus = hasMissingFormats
            ? { text: 'Some formats need retrying', mode: 'neutral' }
            : { text: 'Saved artwork restored', mode: 'ready' };
        session.workflowStep = 3;
        session.workflowComplete = !hasMissingFormats;
        session.errorMessage = hasMissingFormats
            ? isGenericGenerationError(session.errorMessage)
                ? buildMissingFormatsMessage(missingOutputs, session.failedOutputs, true)
                : session.errorMessage
            : null;
        session.refinementVisible = readyOutputs.length > 0;
        session.publishVisible = readyOutputs.length > 0;
    } else if (session.artworkByOutput.size > 0) {
        const selectedVariants = session.config.outputs.filter(output =>
            session.selectedOutputIds.has(output.id) && !output.isPrimary
        );
        const readyVariants = selectedVariants.filter(output => session.artworkByOutput.has(output.id));
        const missingVariants = selectedVariants.filter(output => !session.artworkByOutput.has(output.id));
        const hasMissingFormats = missingVariants.length > 0;
        session.progress = {
            concepts: {
                cssClass: 'complete',
                label: session.selectedConceptId ? 'Selected' : 'Complete'
            },
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
    } else if (session.concepts.length > 0) {
        const readyConcepts = session.concepts.filter(concept => concept.artworkSource).length;
        const failedConcepts = session.concepts.filter(concept => concept.status === 'failed').length;
        session.progress = {
            concepts: {
                cssClass: readyConcepts === CONCEPT_PREVIEW_COUNT ? 'complete' : readyConcepts > 0 && failedConcepts === 0 ? 'active' : 'error',
                label: `${readyConcepts} of ${CONCEPT_PREVIEW_COUNT} ready`
            },
            primary: { cssClass: '', label: 'Waiting for selection' },
            variants: { cssClass: '', label: 'Waiting' },
            compose: { cssClass: '', label: 'Waiting' }
        };
        session.campaignStatus = readyConcepts > 0
            ? { text: 'Choose a concept', mode: 'ready' }
            : { text: 'Concept generation interrupted', mode: 'neutral' };
        session.workflowStep = 2;
        session.workflowComplete = false;
        session.errorMessage = readyConcepts === 0 && storedGenerationWasInterrupted
            ? 'The concept generation was interrupted before an idea finished. Your brief has been kept and the previews can be tried again.'
            : null;
        session.refinementVisible = false;
        session.publishVisible = false;
    } else if (storedGenerationWasInterrupted && session.generationOrigin === 'uploaded-design' && session.sourceDesign) {
        session.progress = {
            concepts: { cssClass: 'complete', label: 'Original retained' },
            primary: { cssClass: 'error', label: `0 of ${session.config.outputs.length} ready` },
            variants: { cssClass: 'complete', label: 'Original-only source' },
            compose: { cssClass: 'error', label: 'No formats ready' }
        };
        session.workflowStep = 3;
        session.workflowComplete = false;
        session.campaignStatus = { text: 'Design adaptation interrupted', mode: 'neutral' };
        session.errorMessage = 'The previous design adaptation did not finish. The original design has been kept; retry the missing formats to continue.';
        session.refinementVisible = false;
        session.publishVisible = false;
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

function createGenerationSnapshot(session, isRegeneration, generationOrigin = 'concept') {
    const conceptStyleVariationIds = selectStyleVariationIds(session, CONCEPT_PREVIEW_COUNT);
    return {
        id: typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        generatedAt: new Date().toISOString(),
        selectedStyleId: session.selectedStyleId,
        styleVariationId: null,
        conceptStyleVariationIds,
        isRegeneration: isRegeneration === true,
        generationOrigin,
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
    if (snapshot.generationOrigin === 'uploaded-design' || snapshot.generationOrigin === 'concept') {
        session.generationOrigin = snapshot.generationOrigin;
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
    if (session.hydrated) {
        if (session.isGenerating) return session.restoredFromStorage;

        try {
            const serverDocument = await readServerSession(session.key);
            const serverRevision = Number(serverDocument?.revision) || 0;
            if (serverDocument?.session && serverRevision > session.serverRevision) {
                const currentRecord = serialiseSession(session, true);
                const newest = chooseNewestStoredSession(serverDocument.session, currentRecord);
                session.serverRevision = serverRevision;
                if (newest === serverDocument.session) {
                    replaceSessionFromStored(session, serverDocument.session);
                    session.restoredFromStorage = true;
                }
            }
        } catch (error) {
            console.warn('Unable to refresh the shared Communications Centre session.', error);
        }

        return session.restoredFromStorage;
    }

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
        console.warn('Unable to restore the shared Communications Centre session. Trying the browser cache.', error);
    }

    try {
        browserStored = await readStoredSession(session.key);
    } catch (error) {
        console.warn('Unable to restore the browser-cached Communications Centre session.', error);
    }

    const stored = chooseNewestStoredSession(serverStored, browserStored);
    session.restoredFromStorage = applyStoredSession(session, stored);
    session.hydrated = true;
    if (session.restoredFromStorage && stored === browserStored && stored !== serverStored) {
        scheduleSessionPersistence(session, false);
    }
    return session.restoredFromStorage;
}

function replaceSessionFromStored(session, stored) {
    const restored = createSession(session.key, session.context);
    restored.config = session.config;
    if (!applyStoredSession(restored, stored)) return false;

    const persistenceChain = session.persistenceChain;
    const persistTimer = session.persistTimer;
    const serverRevision = session.serverRevision;
    const initialised = session.initialised;
    Object.assign(session, restored, {
        persistenceChain,
        persistTimer,
        serverRevision,
        initialised,
        hydrated: true,
        restoredFromStorage: true
    });
    return true;
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
                console.warn('Unable to update the browser-cached Communications Centre session.', error);
            }

            let expectedRevision = session.serverRevision;
            for (let attempt = 0; attempt < 3; attempt += 1) {
                const result = await writeServerSession(session.key, serverRecord, expectedRevision);
                if (!result.conflict) {
                    session.serverRevision = Number(result.document.revision) || expectedRevision;
                    return;
                }

                const currentDocument = result.document;
                const currentRecord = currentDocument?.session;
                session.serverRevision = Number(currentDocument?.revision) || expectedRevision;
                if (chooseNewestStoredSession(currentRecord, serverRecord) !== serverRecord) {
                    // Another tab or device has already saved newer campaign
                    // work. Keep the current view stable, but never overwrite
                    // that newer shared record with this stale snapshot.
                    return;
                }
                expectedRevision = session.serverRevision;
            }

            throw new Error('The Communications Centre session changed repeatedly while it was being saved. Reopen the event to load the newest version.');
        })
        .catch(error => console.warn('Unable to save the shared Communications Centre session.', error));

    return session.persistenceChain;
}

function markSessionContentChanged(session, changedAt = new Date().toISOString()) {
    if (!session) return;
    if (getSessionContentTimestamp({ contentUpdatedAt: session.contentUpdatedAt }) >= Date.parse(changedAt)) return;
    session.contentUpdatedAt = changedAt;
}

function scheduleSessionPersistence(session, contentChanged = true) {
    if (!session?.hydrated) return;
    if (contentChanged) markSessionContentChanged(session);
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

function selectStyleVariationIds(session, count) {
    const style = getSelectedStyle(session);
    const variations = Array.isArray(style?.variations) ? style.variations : [];
    if (variations.length === 0) return [];

    const previousVariationIds = new Set([
        ...(session.generationSnapshot?.conceptStyleVariationIds ?? []),
        session.generationSnapshot?.styleVariationId
    ].filter(Boolean));
    const isSameStyleAsPrevious = session.generationSnapshot?.selectedStyleId === session.selectedStyleId;
    const freshCandidates = isSameStyleAsPrevious
        ? variations.filter(variation => !previousVariationIds.has(variation.id))
        : variations;
    const candidates = freshCandidates.length >= count ? freshCandidates : variations;
    return [...candidates]
        .sort(() => Math.random() - 0.5)
        .slice(0, count)
        .map(variation => variation.id);
}

function selectAlternativeStyleVariationId(session, selectedStyleId, currentVariationId, excludedVariationIds = []) {
    const style = session.config?.styles?.find(item => item.id === selectedStyleId);
    const excluded = new Set([currentVariationId, ...excludedVariationIds].filter(Boolean));
    const candidates = (Array.isArray(style?.variations) ? style.variations : [])
        .filter(variation => variation.id && !excluded.has(variation.id));
    if (candidates.length === 0) return null;
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
    if (session.sourceDesign || !session.form.useLibraryReferences) {
        session.form.selectedLibraryReferences = [];
        renderSupportingFiles(session);
        return;
    }

    const clubName = session.config?.brand?.name || 'the club';
    const tokens = tokenise([
        session.form.eventName,
        session.form.description,
        session.form.additionalInstructions,
        session.form.includeDate ? session.form.eventDate : '',
        session.form.includePrice ? session.form.price : '',
        session.form.includeClubBranding ? `${clubName} official logo crest branding` : 'no club logo branding'
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
    if (session.sourceDesign || !session.form.useLibraryReferences || library.length === 0) {
        session.form.selectedLibraryReferences = [];
        session.referenceSelection = {
            eventIntent: '',
            mode: session.sourceDesign ? 'uploaded-design' : library.length === 0 ? 'empty-library' : 'disabled',
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
        posterStyleField: document.querySelector('#posterStyleField'),
        styleOptions: document.querySelector('#styleOptions'),
        posterStyleHelp: document.querySelector('#posterStyleHelp'),
        includeDate: document.querySelector('#includeDate'),
        includePrice: document.querySelector('#includePrice'),
        includeClubBranding: document.querySelector('#includeClubBranding'),
        dateCard: document.querySelector('#dateCard'),
        priceCard: document.querySelector('#priceCard'),
        brandingCard: document.querySelector('#brandingCard'),
        priceField: document.querySelector('#priceField'),
        price: document.querySelector('#price'),
        additionalInstructions: document.querySelector('#additionalInstructions'),
        additionalInstructionsLabel: document.querySelector('#additionalInstructionsLabel'),
        additionalInstructionsHelp: document.querySelector('#additionalInstructionsHelp'),
        supportingUploadBox: document.querySelector('#supportingUploadBox'),
        supportingFilesInput: document.querySelector('#supportingFilesInput'),
        useLibraryReferences: document.querySelector('#useLibraryReferences'),
        supportingFilesList: document.querySelector('#supportingFilesList'),
        outputOptions: document.querySelector('#outputOptions'),
        generateButton: document.querySelector('#generateButton'),
        uploadDesignButton: document.querySelector('#uploadDesignButton'),
        sourceDesignInput: document.querySelector('#sourceDesignInput'),
        sourceDesignPanel: document.querySelector('#sourceDesignPanel'),
        sourceDesignPreview: document.querySelector('#sourceDesignPreview'),
        sourceDesignName: document.querySelector('#sourceDesignName'),
        sourceDesignMetadata: document.querySelector('#sourceDesignMetadata'),
        sourceDesignMessage: document.querySelector('#sourceDesignMessage'),
        sourceDesignUploadError: document.querySelector('#sourceDesignUploadError'),
        produceSourceDesignButton: document.querySelector('#produceSourceDesignButton'),
        replaceSourceDesignButton: document.querySelector('#replaceSourceDesignButton'),
        removeSourceDesignButton: document.querySelector('#removeSourceDesignButton'),
        generationMode: document.querySelector('#generationMode'),
        campaignTitle: document.querySelector('#campaignTitle'),
        campaignStatus: document.querySelector('#campaignStatus'),
        emptyState: document.querySelector('#emptyState'),
        generationProgress: document.querySelector('#generationProgress'),
        generationElapsed: document.querySelector('#generationElapsed'),
        cancelGenerationButton: document.querySelector('#cancelGenerationButton'),
        conceptSelectionPanel: document.querySelector('#conceptSelectionPanel'),
        conceptPreviewCount: document.querySelector('#conceptPreviewCount'),
        conceptResults: document.querySelector('#conceptResults'),
        conceptSelectionMessage: document.querySelector('#conceptSelectionMessage'),
        generateMoreConceptsButton: document.querySelector('#generateMoreConceptsButton'),
        produceSelectedConceptButton: document.querySelector('#produceSelectedConceptButton'),
        generatedArtworkPanel: document.querySelector('#generatedArtworkPanel'),
        generatedArtworkCount: document.querySelector('#generatedArtworkCount'),
        posterResults: document.querySelector('#posterResults'),
        refinementPanel: document.querySelector('#refinementPanel'),
        refinementNotes: document.querySelector('#refinementNotes'),
        regenerateButton: document.querySelector('#regenerateButton'),
        sharePanel: document.querySelector('#sharePanel'),
        shareScreensButton: document.querySelector('#shareScreensButton'),
        shareScreensStatus: document.querySelector('#shareScreensStatus'),
        shareEmailButton: document.querySelector('#shareEmailButton'),
        shareEmailCard: document.querySelector('#shareEmailCard'),
        shareEmailStatus: document.querySelector('#shareEmailStatus'),
        sharePrintButton: document.querySelector('#sharePrintButton'),
        shareDiaryButton: document.querySelector('#shareDiaryButton'),
        shareDiaryCard: document.querySelector('#shareDiaryCard'),
        shareDiaryStatus: document.querySelector('#shareDiaryStatus'),
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
        yodeckPlaylistName: document.querySelector('#yodeckPlaylistName'),
        emailDialog: document.querySelector('#memberEmailDialog'),
        emailForm: document.querySelector('#memberEmailForm'),
        emailDialogClose: document.querySelector('#closeMemberEmailDialog'),
        emailDialogCancel: document.querySelector('#cancelMemberEmail'),
        emailDialogConfirm: document.querySelector('#confirmMemberEmail'),
        emailDialogMessage: document.querySelector('#memberEmailDialogMessage'),
        emailConnectionStatus: document.querySelector('#memberEmailConnectionStatus'),
        emailArtworkPreview: document.querySelector('#memberEmailArtworkPreview'),
        emailArtworkName: document.querySelector('#memberEmailArtworkName'),
        emailGenerateButton: document.querySelector('#generateMemberEmail'),
        emailSubject: document.querySelector('#memberEmailSubject'),
        emailBody: document.querySelector('#memberEmailBody'),
        emailBodyPreview: document.querySelector('#memberEmailBodyPreview'),
        emailLoadAudienceButton: document.querySelector('#loadMemberEmailAudience'),
        emailAudienceModes: document.querySelectorAll('input[name="memberEmailAudienceMode"]'),
        emailCategories: document.querySelector('#memberEmailCategories'),
        emailAudienceSummary: document.querySelector('#memberEmailAudienceSummary'),
        emailTestAddress: document.querySelector('#memberEmailTestAddress'),
        emailTestButton: document.querySelector('#sendMemberEmailTest'),
        printDialog: document.querySelector('#posterPrintDialog'),
        printForm: document.querySelector('#posterPrintForm'),
        printPreview: document.querySelector('#posterPrintPreview'),
        printPreviewSize: document.querySelector('#posterPrintPreviewSize'),
        printDialogClose: document.querySelector('#closePosterPrintDialog'),
        printDialogCancel: document.querySelector('#cancelPosterPrint'),
        printDialogConfirm: document.querySelector('#confirmPosterPrint'),
        printDialogMessage: document.querySelector('#posterPrintDialogMessage'),
        printSizeOptions: document.querySelectorAll('input[name="posterPrintSize"]'),
        diaryDialog: document.querySelector('#memberDiaryDialog'),
        diaryForm: document.querySelector('#memberDiaryForm'),
        diaryPreview: document.querySelector('#memberDiaryPreview'),
        diaryDialogClose: document.querySelector('#closeMemberDiaryDialog'),
        diaryDialogCancel: document.querySelector('#cancelMemberDiary'),
        diaryDialogConfirm: document.querySelector('#confirmMemberDiary'),
        diaryDialogMessage: document.querySelector('#memberDiaryDialogMessage'),
        diaryConnectionStatus: document.querySelector('#memberDiaryConnectionStatus'),
        diaryGenerateButton: document.querySelector('#generateMemberDiary'),
        diaryTitle: document.querySelector('#memberDiaryTitle'),
        diaryDate: document.querySelector('#memberDiaryDate'),
        diaryStartTime: document.querySelector('#memberDiaryStartTime'),
        diaryEndTime: document.querySelector('#memberDiaryEndTime'),
        diaryDescription: document.querySelector('#memberDiaryDescription'),
        diaryBodyPreview: document.querySelector('#memberDiaryBodyPreview'),
        diaryBookingUrl: document.querySelector('#memberDiaryBookingUrl')
    };

    if (!elements.generateButton) {
        return;
    }

    await initialise(activeSession);
}

async function initialise(session) {
    const response = await fetch('/api/poster/config', { cache: 'no-store' });
    if (!response.ok) {
        throw new Error('Unable to load poster configuration.');
    }
    configCache = await response.json();

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
    wireEvents(session);
    updateSourceDesignUi(session);
    configureShareConnections(session);
    updateAutomaticReferenceSelection(session);
    restoreSessionToDom(session);
    scheduleSessionPersistence(session, false);
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
    const configuredStyleIds = new Set(session.config.styles.map(style => style.id));
    if (!configuredStyleIds.has(session.selectedStyleId)) {
        session.selectedStyleId = session.config.styles[0]?.id ?? null;
    }
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

    const openSourceDesignPicker = () => {
        if (!session.isGenerating) elements.sourceDesignInput?.click();
    };
    elements.uploadDesignButton?.addEventListener('click', openSourceDesignPicker);
    elements.replaceSourceDesignButton?.addEventListener('click', openSourceDesignPicker);
    elements.sourceDesignInput?.addEventListener('change', async event => {
        const input = event.target;
        const file = input.files?.[0] ?? null;
        input.value = '';
        if (!file) return;
        try {
            await selectSourceDesign(session, file);
        } catch (error) {
            showSourceDesignUploadError(error instanceof Error ? error.message : 'The supplied design could not be read.');
        }
    });
    elements.sourceDesignPreview?.addEventListener('load', () => {
        if (!session.sourceDesign) return;
        session.sourceDesign.available = true;
        updateSourceDesignUi(session);
    });
    elements.sourceDesignPreview?.addEventListener('error', () => {
        if (!session.sourceDesign) return;
        session.sourceDesign.available = false;
        showSourceDesignMessage('The retained original could not be loaded. Replace the upload before creating or refining the formats.', true);
        updateSourceDesignUi(session);
    });
    elements.removeSourceDesignButton?.addEventListener('click', () => removeSourceDesign(session));
    elements.produceSourceDesignButton?.addEventListener('click', () => produceUploadedDesign(session));

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
    elements.generateButton.addEventListener('click', () => generateConcepts(session, false));
    elements.regenerateButton.addEventListener('click', () => session.generationOrigin === 'uploaded-design' && session.sourceDesign
        ? produceUploadedDesign(session)
        : generateConcepts(session, true));
    elements.generateMoreConceptsButton?.addEventListener('click', () => generateConcepts(session, false));
    elements.produceSelectedConceptButton?.addEventListener('click', () => produceSelectedConcept(session));
    elements.conceptResults?.addEventListener('click', event => {
        const selectButton = event.target.closest('[data-select-concept]');
        if (selectButton) {
            selectConcept(session, selectButton.dataset.selectConcept);
            return;
        }
        const retryButton = event.target.closest('[data-retry-concept]');
        if (retryButton) retryConcept(session, retryButton.dataset.retryConcept);
    });
    elements.cancelGenerationButton.addEventListener('click', () => cancelGeneration(session));
    elements.shareScreensButton.addEventListener('click', openScreenShareDialog);
    elements.shareEmailButton.addEventListener('click', openMemberEmailDialog);
    elements.sharePrintButton?.addEventListener('click', openPrintDialog);
    elements.shareDiaryButton?.addEventListener('click', openMemberDiaryDialog);
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
    elements.emailDialogClose?.addEventListener('click', closeMemberEmailDialog);
    elements.emailDialogCancel?.addEventListener('click', closeMemberEmailDialog);
    elements.emailDialog?.addEventListener('close', () => {
        captureMemberEmailDialog(session);
        scheduleSessionPersistence(session);
    });
    elements.emailForm?.addEventListener('submit', event => {
        event.preventDefault();
        sendMemberCampaignEmail();
    });
    elements.emailGenerateButton?.addEventListener('click', () => generateMemberEmailDraft(session));
    elements.emailLoadAudienceButton?.addEventListener('click', () => loadMemberEmailAudience(session, true));
    elements.emailSubject?.addEventListener('input', () => {
        captureMemberEmailDialog(session);
        scheduleSessionPersistence(session);
    });
    elements.emailBody?.addEventListener('input', () => {
        captureMemberEmailDialog(session);
        renderMemberEmailPreview();
        scheduleSessionPersistence(session);
    });
    elements.emailTestAddress?.addEventListener('input', () => {
        captureMemberEmailDialog(session);
        scheduleSessionPersistence(session);
    });
    elements.emailAudienceModes?.forEach(input => input.addEventListener('change', () => {
        captureMemberEmailDialog(session);
        renderMemberEmailAudience(session);
        scheduleSessionPersistence(session);
    }));
    elements.emailCategories?.addEventListener('change', () => {
        captureMemberEmailDialog(session);
        updateMemberEmailAudienceSummary(session);
        scheduleSessionPersistence(session);
    });
    elements.emailTestButton?.addEventListener('click', () => sendMemberEmailTest(session));
    elements.printDialogClose?.addEventListener('click', closePrintDialog);
    elements.printDialogCancel?.addEventListener('click', closePrintDialog);
    elements.printForm?.addEventListener('submit', event => {
        event.preventDefault();
        printApprovedCampaign();
    });
    elements.printSizeOptions?.forEach(input => input.addEventListener('change', updatePrintSizeSelection));
    elements.diaryDialogClose?.addEventListener('click', closeMemberDiaryDialog);
    elements.diaryDialogCancel?.addEventListener('click', closeMemberDiaryDialog);
    elements.diaryDialog?.addEventListener('close', () => {
        captureMemberDiaryDialog(session);
        scheduleSessionPersistence(session);
    });
    elements.diaryForm?.addEventListener('submit', event => {
        event.preventDefault();
        addToMemberDiary();
    });
    elements.diaryGenerateButton?.addEventListener('click', () => generateMemberDiaryDraft(session));
    elements.diaryTitle?.addEventListener('input', () => {
        captureMemberDiaryDialog(session);
        renderMemberDiaryPreview();
        scheduleSessionPersistence(session);
    });
    elements.diaryDescription?.addEventListener('input', () => {
        captureMemberDiaryDialog(session);
        renderMemberDiaryPreview();
        scheduleSessionPersistence(session);
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
        session.form.diaryTitle ||= contextEventName;
    }
    if (typeof context.eventDate === 'string') {
        session.form.eventDate = context.eventDate;
    }
    if (typeof context.startTime === 'string' && !session.form.diaryStartTime) {
        session.form.diaryStartTime = context.startTime;
    }
    if (typeof context.endTime === 'string' && !session.form.diaryEndTime) {
        session.form.diaryEndTime = context.endTime;
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

    if (session.isGenerating || session.concepts.length > 0 || session.posterCanvases.size > 0 || session.errorMessage) {
        elements.emptyState.classList.add('hidden');
        elements.generationProgress.classList.remove('hidden');
    }
    renderConceptChoices(session);
    if (session.posterCanvases.size > 0) renderCampaignResults(session);
    elements.refinementPanel.classList.toggle('hidden', !session.refinementVisible);
    elements.sharePanel.classList.toggle('hidden', !session.publishVisible);
    elements.shareTopButton.disabled = !session.publishVisible;
    if (elements.shareMessage) {
        const shareHistory = [];
        if (session.screenPublication) {
            const publication = session.screenPublication;
            const pushCopy = publication.pushConfirmed
                ? 'The latest changes were pushed to the screens.'
                : 'The artwork is scheduled, but a completed screen push has not been confirmed.';
            shareHistory.push(`“${publication.mediaName}” is scheduled on ${publication.destinationName} from ${publication.startDate} to ${publication.endDate}. ${pushCopy}`);
        }
        if (session.diaryPublication) {
            shareHistory.push(`The event is linked to the member diary for ${session.diaryPublication.eventDate}.`);
        }
        if (shareHistory.length > 0) {
            elements.shareMessage.textContent = `${shareHistory.join(' ')} Sending again will update the existing destination item.`;
        }
    }
    renderScreenPublishState(session);
    if (!session.isGenerating && elements.generationElapsed) {
        elements.generationElapsed.textContent = session.errorMessage
            ? 'The form is unlocked and ready to try again.'
            : session.posterCanvases.size > 0
                ? 'All saved campaign formats are ready.'
                : session.concepts.some(concept => concept.artworkSource)
                    ? 'Choose a concept to produce, or retry an unfinished idea.'
                    : 'Low-resolution concepts are generated before any high-quality formats.';
    }
    setBusy(session, session.isGenerating);

    if (session.errorMessage) {
        renderGenerationError(session);
    }
}

function renderScreenPublishState(session) {
    if (!isSessionVisible(session) || !elements.shareScreensButton) return;

    const operation = session.screenPublishOperation;
    const status = elements.shareScreensStatus;
    const isSending = session.isPublishingScreens || operation?.status === 'sending';
    if (isSending) {
        elements.shareScreensButton.disabled = true;
        elements.shareScreensButton.textContent = 'Sending…';
        if (status) {
            status.textContent = 'Sending in background…';
            status.className = 'share-action-status sending';
        }
        if (elements.shareMessage) {
            elements.shareMessage.textContent = 'Artwork is being sent to the clubhouse screens in the background. You can continue working elsewhere in Event Playbook.';
        }
        return;
    }

    elements.shareScreensButton.disabled = false;
    if (operation?.status === 'failed') {
        elements.shareScreensButton.textContent = 'Try again';
        if (status) {
            status.textContent = 'Could not send · try again';
            status.className = 'share-action-status failed';
        }
        if (elements.shareMessage) elements.shareMessage.textContent = operation.error;
        return;
    }

    if (session.screenPublication) {
        elements.shareScreensButton.textContent = 'Update clubhouse screens';
        if (status) {
            status.textContent = 'Scheduled · push completed';
            status.className = 'share-action-status';
        }
        return;
    }

    elements.shareScreensButton.textContent = 'Send to clubhouse screens';
    if (status) status.className = 'share-action-status hidden';
}

async function produceUploadedDesign(session, outputsToRetry = null) {
    if (session.isGenerating) return session.generationPromise;
    if (!session.sourceDesign?.artworkSource) {
        showSourceDesignMessage('Upload the supplied poster before creating campaign formats.', true);
        return;
    }
    if (session.sourceDesign.available === false) {
        showSourceDesignMessage('The retained original is unavailable. Replace the upload before creating or refining the formats.', true);
        return;
    }

    if (!session.sourceDesign.version || isInlineArtworkSource(session.sourceDesign.artworkSource)) {
        showSourceDesignMessage('Saving the original design before creating the formats…');
        await persistSourceDesignArtwork(session);
    }
    const sourceDesignVersion = session.sourceDesign.version ?? getArtworkVersion(session.sourceDesign.artworkSource);
    if (!sourceDesignVersion) {
        showSourceDesignMessage('The original design could not be saved securely. Try replacing the upload before creating the formats.', true);
        return;
    }

    captureFormFromDom(session);
    session.config.outputs.forEach(output => session.selectedOutputIds.add(output.id));
    renderOutputs(session);

    const generationController = new AbortController();
    const isRetry = Array.isArray(outputsToRetry);
    const outputs = isRetry ? outputsToRetry : [...session.config.outputs];
    const generationSnapshot = createGenerationSnapshot(session, Boolean(session.artworkByOutput.size), 'uploaded-design');
    generationSnapshot.selectedOutputIds = session.config.outputs.map(output => output.id);
    generationSnapshot.conceptStyleVariationIds = [];
    generationSnapshot.styleVariationId = null;

    session.generationOrigin = 'uploaded-design';
    session.generationSnapshot = generationSnapshot;
    markSessionContentChanged(session, generationSnapshot.generatedAt);
    session.concepts = [];
    session.selectedConceptId = null;
    session.referenceSelection = null;
    session.failedOutputs.clear();
    for (const output of outputs) {
        session.artworkByOutput.delete(output.id);
        session.posterCanvases.delete(output.id);
    }
    if (outputs.some(output => output.isPrimary)) session.primaryArtworkDataUrl = null;

    session.generationAbortController = generationController;
    session.isGenerating = true;
    session.errorMessage = null;
    session.refinementVisible = false;
    session.publishVisible = false;
    setBusy(session, true);
    setWorkflowStep(session, 3);
    beginUploadedDesignProgress(session, outputs.length, isRetry);
    setCampaignStatus(session, isRetry ? 'Retrying supplied-design formats' : 'Adapting supplied design', 'generating');
    updateSourceDesignUi(session);
    startGenerationClock(session);
    await persistSession(session);

    session.generationPromise = (async () => {
        const failures = new Map();
        try {
            let completed = 0;
            for (const output of outputs) {
                if (generationController.signal.aborted) {
                    throw createGenerationError('AbortError', 'Generation cancelled. The original design and completed formats have been kept.');
                }

                setProgressState(session, 'primary', 'active', `${completed} of ${outputs.length} ready · creating ${output.name}`);
                try {
                    const generated = await generateUploadedDesignOutputWithAutomaticRetry(
                        generationSnapshot,
                        output,
                        session.key,
                        sourceDesignVersion,
                        session.sourceDesign.fileName,
                        generationController.signal,
                        session
                    );
                    session.artworkByOutput.set(output.id, generated.dataUrl);
                    if (output.isPrimary) session.primaryArtworkDataUrl = generated.dataUrl;
                    await composeOutput(session, output, generated.dataUrl, session.context);
                    await persistCompletedArtwork(session, output.id, generated.dataUrl);
                    session.failedOutputs.delete(output.id);
                    completed += 1;
                } catch (error) {
                    if (error?.name === 'AbortError') throw error;
                    const failure = serialiseGenerationFailure(error);
                    session.failedOutputs.set(output.id, failure);
                    failures.set(output.id, failure);
                }

                setProgressState(session, 'primary', 'active', `${completed} of ${outputs.length} ready`);
                setProgressState(session, 'compose', 'active', `${session.posterCanvases.size} ready`);
                renderCampaignResults(session);
                await persistSession(session);
            }

            const missingFormats = getMissingSourceDesignOutputs(session);
            if (failures.size > 0 || missingFormats.length > 0) {
                finishUploadedDesignWithMissingFormats(session, missingFormats);
            } else {
                finishUploadedDesignReady(session);
            }
        } catch (error) {
            if (!generationController.signal.aborted) generationController.abort();
            if (error?.name !== 'AbortError' && error?.name !== 'TimeoutError') console.error(error);
            for (const output of getMissingSourceDesignOutputs(session)) {
                if (!session.failedOutputs.has(output.id)) session.failedOutputs.set(output.id, serialiseGenerationFailure(error));
            }
            finishUploadedDesignWithMissingFormats(session, getMissingSourceDesignOutputs(session), error);
        } finally {
            stopGenerationClock(session);
            session.isGenerating = false;
            session.generationPromise = null;
            if (session.generationAbortController === generationController) session.generationAbortController = null;
            setBusy(session, false);
            updateSourceDesignUi(session);
            await persistSession(session);
        }
    })();

    return session.generationPromise;
}

async function generateUploadedDesignOutputWithAutomaticRetry(snapshot, output, sourceDesignSessionKey, sourceDesignVersion, sourceDesignFileName, signal, session) {
    let attempt = 0;
    while (true) {
        try {
            return await generateUploadedDesignOutput(snapshot, output, sourceDesignSessionKey, sourceDesignVersion, sourceDesignFileName, signal);
        } catch (error) {
            if (signal.aborted || error?.name === 'AbortError') throw error;
            if (error?.retryable !== true || attempt >= 1) throw error;
            attempt += 1;
            setProgressState(session, 'primary', 'active', `Retrying ${output.name}`);
            await waitForRetry(5000, signal);
        }
    }
}

async function generateUploadedDesignOutput(snapshot, output, sourceDesignSessionKey, sourceDesignVersion, sourceDesignFileName, signal) {
    const form = snapshot.form;
    const refinementInstructions = [form.additionalInstructions, form.refinementNotes]
        .map(value => String(value ?? '').trim())
        .filter(Boolean)
        .join('\n\n');
    return postPosterRequest('/api/poster/generate-from-uploaded-design', {
        eventId: form.eventId,
        eventName: form.eventName,
        outputId: output.id,
        eventDate: form.eventDate,
        sourceDesignSessionKey,
        sourceDesignVersion,
        sourceDesignFileName,
        includeDate: form.includeDate,
        includePrice: form.includePrice,
        includeClubBranding: form.includeClubBranding,
        price: form.price,
        refinementInstructions
    }, signal);
}

function beginUploadedDesignProgress(session, outputCount, isRetry) {
    session.errorMessage = null;
    session.progress = {
        concepts: { cssClass: 'complete', label: 'Original retained' },
        primary: { cssClass: 'active', label: isRetry ? `Retrying ${outputCount}` : `0 of ${outputCount} ready` },
        variants: { cssClass: 'active', label: 'Original-only source' },
        compose: { cssClass: '', label: 'Waiting' }
    };
    if (!isSessionVisible(session)) return;
    elements.generationProgress.querySelector('[data-generation-error]')?.remove();
    elements.emptyState.classList.add('hidden');
    elements.conceptSelectionPanel?.classList.add('hidden');
    elements.refinementPanel.classList.add('hidden');
    elements.sharePanel.classList.add('hidden');
    elements.generationProgress.classList.remove('hidden');
    updateGenerationOriginUi(session);
    for (const [name, progress] of Object.entries(session.progress)) setProgressState(session, name, progress.cssClass, progress.label);
}

function getMissingSourceDesignOutputs(session) {
    return session.config.outputs.filter(output => !session.artworkByOutput.has(output.id));
}

function finishUploadedDesignReady(session) {
    session.failedOutputs.clear();
    session.errorMessage = null;
    setProgressState(session, 'concepts', 'complete', 'Original retained');
    setProgressState(session, 'primary', 'complete', `${session.config.outputs.length} of ${session.config.outputs.length} ready`);
    setProgressState(session, 'variants', 'complete', 'Original-only source');
    setProgressState(session, 'compose', 'complete', 'Complete');
    setCampaignStatus(session, 'Ready to review', 'ready');
    setWorkflowStep(session, 3, true);
    revealReviewAndShare(session);
    updateGenerationOriginUi(session);
    if (isSessionVisible(session)) elements.generationProgress.querySelector('[data-generation-error]')?.remove();
}

function finishUploadedDesignWithMissingFormats(session, missingFormats, error = null) {
    const readyCount = session.config.outputs.length - missingFormats.length;
    session.errorMessage = missingFormats.length > 0
        ? buildMissingFormatsMessage(missingFormats, session.failedOutputs, true)
        : error instanceof Error
            ? error.message
            : 'The supplied design could not be adapted.';
    setProgressState(session, 'concepts', 'complete', 'Original retained');
    setProgressState(session, 'primary', 'error', `${readyCount} of ${session.config.outputs.length} ready`);
    setProgressState(session, 'variants', 'complete', 'Original-only source');
    setProgressState(session, 'compose', readyCount > 0 ? 'active' : 'error', `${session.posterCanvases.size} ready`);
    setCampaignStatus(session, readyCount > 0 ? 'Some formats need retrying' : 'Design adaptation failed', 'neutral');
    setWorkflowStep(session, 3, false);
    if (readyCount > 0) revealReviewAndShare(session);
    renderGenerationError(session);
}

async function generateConcepts(session, isRegeneration) {
    if (session.isGenerating) return session.generationPromise;

    session.generationOrigin = 'concept';
    updateGenerationOriginUi(session);
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
    const generationController = new AbortController();
    session.generationSnapshot = generation.snapshot;
    markSessionContentChanged(session, generation.snapshot.generatedAt);
    session.concepts = generation.snapshot.conceptStyleVariationIds.map((styleVariationId, index) => ({
        id: `concept-${index + 1}`,
        index,
        generationId: generation.snapshot.id,
        styleVariationId,
        artworkSource: null,
        status: 'waiting',
        failure: null
    }));
    session.selectedConceptId = null;
    session.generationAbortController = generationController;
    session.isGenerating = true;
    session.errorMessage = null;
    setBusy(session, true);
    setWorkflowStep(session, 2);
    beginConceptProgress(session);
    setCampaignStatus(session, 'Generating concepts', 'generating');
    startGenerationClock(session);
    await persistSession(session);

    session.generationPromise = (async () => {
        try {
            for (const concept of session.concepts) {
                if (generationController.signal.aborted) {
                    throw createGenerationError('AbortError', 'Concept generation cancelled. Completed previews have been kept.');
                }

                concept.status = 'generating';
                renderConceptChoices(session);
                const readyBefore = session.concepts.filter(item => item.artworkSource).length;
                setProgressState(session, 'concepts', 'active', `${readyBefore} of ${CONCEPT_PREVIEW_COUNT} ready · creating idea ${concept.index + 1}`);
                try {
                    const conceptResponse = await generateConceptWithSafetyRecovery(
                        session,
                        generation,
                        concept,
                        generationController.signal
                    );
                    concept.artworkSource = conceptResponse.dataUrl;
                    concept.status = 'ready';
                    concept.failure = null;
                    await persistConceptArtwork(session, concept, conceptResponse.dataUrl);
                } catch (error) {
                    if (error?.name === 'AbortError') throw error;
                    concept.status = 'failed';
                    concept.failure = serialiseGenerationFailure(error);
                }

                renderConceptChoices(session);
                await persistSession(session);
            }

            const readyCount = session.concepts.filter(concept => concept.artworkSource).length;
            const failedCount = CONCEPT_PREVIEW_COUNT - readyCount;
            setProgressState(session, 'concepts', failedCount === 0 ? 'complete' : 'error', `${readyCount} of ${CONCEPT_PREVIEW_COUNT} ready`);
            if (readyCount === 0) {
                throw new Error('The image service could not create any concept previews. Your brief has been kept so the ideas can be tried again.');
            }

            setCampaignStatus(session, 'Choose a concept', 'ready');
            setWorkflowStep(session, 2);
            renderConceptChoices(session);
            await persistSession(session);
        } catch (error) {
            if (!generationController.signal.aborted) generationController.abort();
            if (error?.name !== 'AbortError' && error?.name !== 'TimeoutError') console.error(error);
            const readyCount = session.concepts.filter(concept => concept.artworkSource).length;
            if (readyCount > 0) {
                for (const concept of session.concepts.filter(item => !item.artworkSource && item.status !== 'failed')) {
                    concept.status = 'failed';
                    concept.failure = serialiseGenerationFailure(error);
                }
                setProgressState(session, 'concepts', 'error', `${readyCount} of ${CONCEPT_PREVIEW_COUNT} ready`);
                setCampaignStatus(session, 'Choose a completed concept', 'ready');
                setWorkflowStep(session, 2);
                renderConceptChoices(session);
            } else {
                session.errorMessage = error instanceof Error ? error.message : 'The concept previews could not be generated.';
                const statusText = error?.name === 'AbortError'
                    ? 'Concept generation cancelled'
                    : error?.name === 'TimeoutError'
                        ? 'Concept generation timed out'
                        : 'Concept generation failed';
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

async function produceSelectedConcept(session) {
    if (session.isGenerating) return session.generationPromise;
    const selectedConcept = session.concepts.find(concept => concept.id === session.selectedConceptId && concept.artworkSource);
    if (!selectedConcept || !session.generationSnapshot) return;

    session.generationSnapshot.styleVariationId = selectedConcept.styleVariationId;
    session.generationSnapshot.selectedOutputIds = [...session.selectedOutputIds];
    const selectedConceptDataUrl = await artworkSourceToDataUrl(selectedConcept.artworkSource);
    const generation = {
        snapshot: session.generationSnapshot,
        supportingImages: buildSupportingImagesPayload(session, session.generationSnapshot.referenceSelection),
        previousArtworkDataUrl: session.primaryArtworkDataUrl,
        selectedConceptDataUrl
    };
    const generationContext = session.context;
    const generationController = new AbortController();
    const isRegeneration = session.generationSnapshot.isRegeneration === true;
    let generatedNewPrimary = false;

    session.failedOutputs.clear();
    session.generationAbortController = generationController;
    session.isGenerating = true;
    session.errorMessage = null;
    session.refinementVisible = false;
    session.publishVisible = false;
    setBusy(session, true);
    setWorkflowStep(session, 3);
    beginProductionProgress(session);
    setCampaignStatus(session, 'Producing selected concept', 'generating');
    startGenerationClock(session);
    await persistSession(session);

    session.generationPromise = (async () => {
        try {
            const primaryOutput = getPrimaryOutput(session);
            setProgressState(session, 'primary', 'active', 'Rendering high resolution');
            const primaryResponse = await generatePrimaryWithSafetyRecovery(
                session,
                generation,
                isRegeneration,
                generationController.signal
            );
            const masterArtworkDataUrl = primaryResponse.dataUrl;
            generatedNewPrimary = true;
            session.primaryArtworkDataUrl = masterArtworkDataUrl;
            session.artworkByOutput.set(primaryOutput.id, masterArtworkDataUrl);

            setProgressState(session, 'compose', 'active', 'Sizing');
            await composeOutput(session, primaryOutput, masterArtworkDataUrl, generationContext);
            renderCampaignResults(session);
            setProgressState(session, 'primary', 'complete', 'Complete');
            setProgressState(session, 'compose', 'active', 'Master ready');
            await persistCompletedArtwork(session, primaryOutput.id, masterArtworkDataUrl);

            const selectedOutputIds = new Set(generation.snapshot.selectedOutputIds);
            const variants = session.config.outputs.filter(output => selectedOutputIds.has(output.id) && !output.isPrimary);
            clearVariantArtwork(session);
            renderCampaignResults(session);
            setProgressState(session, 'variants', 'active', variants.length === 0 ? 'Not selected' : `0 of ${variants.length} ready`);
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
            const missingFormats = generatedNewPrimary ? getMissingVariantOutputs(session) : [];
            if (generatedNewPrimary && missingFormats.length > 0) {
                for (const output of missingFormats) {
                    if (!session.failedOutputs.has(output.id)) session.failedOutputs.set(output.id, serialiseGenerationFailure(error));
                }
                finishCampaignWithMissingFormats(session);
            } else {
                session.errorMessage = error instanceof Error ? error.message : 'The selected concept could not be produced.';
                setCampaignStatus(session, error?.name === 'AbortError' ? 'Production cancelled' : 'Production failed', 'neutral');
                setProgressState(session, 'primary', 'error', 'Not produced');
                renderGenerationError(session);
            }
        } finally {
            stopGenerationClock(session);
            session.isGenerating = false;
            session.generationPromise = null;
            if (session.generationAbortController === generationController) session.generationAbortController = null;
            setBusy(session, false);
            renderConceptChoices(session);
            await persistSession(session);
        }
    })();

    return session.generationPromise;
}

async function generateConceptWithSafetyRecovery(session, generation, concept, signal) {
    let safetyRecoveryAttempt = 0;
    let safetyFallbackStyle = false;

    while (true) {
        try {
            return await generateConcept(generation, concept, signal, safetyRecoveryAttempt, safetyFallbackStyle);
        } catch (error) {
            if (signal.aborted || error?.name === 'AbortError') throw error;
            if (error?.safetyRefusal !== true) throw error;

            if (safetyRecoveryAttempt < MAX_SAFETY_PROMPT_RETRIES) {
                safetyRecoveryAttempt += 1;
                setProgressState(session, 'concepts', 'active', `Rewording idea ${concept.index + 1} · ${safetyRecoveryAttempt} of ${MAX_SAFETY_PROMPT_RETRIES}`);
                await persistSession(session);
                continue;
            }

            if (!safetyFallbackStyle) {
                const otherConceptVariations = session.concepts
                    .filter(item => item.id !== concept.id)
                    .map(item => item.styleVariationId);
                const alternativeVariationId = selectAlternativeStyleVariationId(
                    session,
                    generation.snapshot.selectedStyleId,
                    concept.styleVariationId,
                    otherConceptVariations
                );
                if (!alternativeVariationId) throw error;

                concept.styleVariationId = alternativeVariationId;
                generation.snapshot.conceptStyleVariationIds[concept.index] = alternativeVariationId;
                safetyFallbackStyle = true;
                safetyRecoveryAttempt += 1;
                setProgressState(session, 'concepts', 'active', `Alternative direction for idea ${concept.index + 1}`);
                await persistSession(session);
                continue;
            }

            throw error;
        }
    }
}

async function generateConcept(generation, concept, signal, safetyRecoveryAttempt = 0, safetyFallbackStyle = false) {
    const form = generation.snapshot.form;
    const previousArtworkDataUrl = generation.snapshot.isRegeneration && generation.previousArtworkDataUrl
        ? await artworkSourceToDataUrl(generation.previousArtworkDataUrl)
        : null;
    return postPosterRequest('/api/poster/generate-concept', {
        eventId: form.eventId,
        eventName: form.eventName,
        styleId: generation.snapshot.selectedStyleId,
        styleVariationId: concept.styleVariationId,
        eventDate: form.eventDate,
        description: form.description,
        includeDate: form.includeDate,
        includePrice: form.includePrice,
        includeClubBranding: form.includeClubBranding,
        price: form.price,
        additionalInstructions: form.additionalInstructions,
        refinementNotes: generation.snapshot.isRegeneration ? form.refinementNotes : '',
        previousArtworkDataUrl,
        isConceptPreview: true,
        safetyRecoveryAttempt,
        safetyFallbackStyle,
        supportingImages: generation.supportingImages
    }, signal);
}

async function generatePrimaryWithSafetyRecovery(session, generation, isRegeneration, signal) {
    let safetyRecoveryAttempt = 0;
    let safetyFallbackStyle = false;

    while (true) {
        try {
            return await generatePrimary(
                generation,
                isRegeneration,
                signal,
                safetyRecoveryAttempt,
                safetyFallbackStyle
            );
        } catch (error) {
            if (signal.aborted || error?.name === 'AbortError') throw error;
            if (error?.safetyRefusal !== true) throw error;

            if (safetyRecoveryAttempt < MAX_SAFETY_PROMPT_RETRIES) {
                safetyRecoveryAttempt += 1;
                generation.snapshot.safetyRecovery = {
                    attempts: safetyRecoveryAttempt,
                    usedAlternativeStyle: false,
                    originalStyleVariationId: generation.snapshot.styleVariationId
                };
                setProgressState(session, 'primary', 'active', `Rewording ${safetyRecoveryAttempt} of ${MAX_SAFETY_PROMPT_RETRIES}`);
                setCampaignStatus(session, 'Rewording artwork request', 'generating');
                if (elements.generationElapsed) {
                    elements.generationElapsed.textContent = `The image service declined ambiguous wording. Trying a clearer, neutral version (${safetyRecoveryAttempt} of ${MAX_SAFETY_PROMPT_RETRIES})…`;
                }
                await persistSession(session);
                continue;
            }

            if (!safetyFallbackStyle) {
                const alternativeVariationId = selectAlternativeStyleVariationId(
                    session,
                    generation.snapshot.selectedStyleId,
                    generation.snapshot.styleVariationId
                );
                if (!alternativeVariationId) throw error;

                generation.snapshot.safetyRecovery = {
                    attempts: safetyRecoveryAttempt,
                    usedAlternativeStyle: true,
                    originalStyleVariationId: generation.snapshot.styleVariationId,
                    fallbackStyleVariationId: alternativeVariationId
                };
                generation.snapshot.styleVariationId = alternativeVariationId;
                safetyFallbackStyle = true;
                safetyRecoveryAttempt += 1;
                setProgressState(session, 'primary', 'active', 'Alternative art direction');
                setCampaignStatus(session, 'Trying another art direction', 'generating');
                if (elements.generationElapsed) {
                    elements.generationElapsed.textContent = 'The clearer wording was still declined. Trying one different art direction from the selected poster style…';
                }
                await persistSession(session);
                continue;
            }

            throw error;
        }
    }
}

async function generatePrimary(generation, isRegeneration, signal, safetyRecoveryAttempt = 0, safetyFallbackStyle = false) {
    const form = generation.snapshot.form;
    const selectedConceptDataUrl = generation.selectedConceptDataUrl ?? null;
    const previousArtworkDataUrl = !selectedConceptDataUrl && isRegeneration && generation.previousArtworkDataUrl
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
            selectedConceptDataUrl,
            isConceptPreview: false,
            safetyRecoveryAttempt,
            safetyFallbackStyle,
            supportingImages: generation.supportingImages
        }, signal);
}

function selectConcept(session, conceptId) {
    const concept = session.concepts.find(item => item.id === conceptId && item.artworkSource);
    if (!concept || session.isGenerating) return;
    session.selectedConceptId = concept.id;
    if (session.generationSnapshot) session.generationSnapshot.styleVariationId = concept.styleVariationId;
    renderConceptChoices(session);
    scheduleSessionPersistence(session);
}

function renderConceptChoices(session) {
    if (!elements.conceptSelectionPanel || !elements.conceptResults) return;
    const hasConceptBatch = session.concepts.length > 0;
    elements.conceptSelectionPanel.classList.toggle('hidden', !hasConceptBatch);
    if (!hasConceptBatch) return;

    const readyCount = session.concepts.filter(concept => concept.artworkSource).length;
    const failedCount = session.concepts.filter(concept => concept.status === 'failed').length;
    elements.conceptPreviewCount.textContent = `${readyCount} of ${CONCEPT_PREVIEW_COUNT} ready`;
    elements.conceptPreviewCount.className = `status-pill ${readyCount === CONCEPT_PREVIEW_COUNT ? 'ready' : failedCount > 0 ? 'neutral' : 'generating'}`;
    elements.conceptResults.innerHTML = session.concepts.map(concept => {
        const selected = concept.id === session.selectedConceptId;
        const variation = session.config?.styles
            ?.flatMap(style => style.variations ?? [])
            .find(item => item.id === concept.styleVariationId);
        if (concept.artworkSource) {
            return `<article class="concept-card${selected ? ' selected' : ''}">
                <button class="concept-image-button" type="button" data-select-concept="${escapeHtml(concept.id)}" aria-pressed="${selected}">
                  <img src="${escapeHtml(concept.artworkSource)}" alt="Concept ${concept.index + 1} for ${escapeHtml(getCampaignEventName(session))}">
                  <span class="concept-select-mark">${selected ? '✓ Selected' : 'Choose this idea'}</span>
                </button>
                <div class="concept-card-copy"><strong>Concept ${concept.index + 1}</strong><small>${escapeHtml(variation?.name || 'Alternative visual direction')} · low-resolution preview</small></div>
              </article>`;
        }
        if (concept.status === 'failed') {
            return `<article class="concept-card failed"><div class="concept-placeholder"><span>!</span><strong>Concept ${concept.index + 1} did not finish</strong><small>${escapeHtml(concept.failure?.message || 'The image service returned an error.')}</small><button class="button button-secondary" type="button" data-retry-concept="${escapeHtml(concept.id)}">Retry this idea</button></div></article>`;
        }
        return `<article class="concept-card waiting"><div class="concept-placeholder"><span>${concept.status === 'generating' ? '✦' : concept.index + 1}</span><strong>${concept.status === 'generating' ? 'Creating this idea…' : 'Waiting'}</strong><small>Low-resolution digital-screen concept</small></div></article>`;
    }).join('');

    const selected = session.concepts.find(concept => concept.id === session.selectedConceptId && concept.artworkSource);
    elements.conceptSelectionMessage.textContent = selected
        ? `Concept ${selected.index + 1} is selected. It will be re-rendered as the high-resolution master before the other formats are created.`
        : readyCount > 0
            ? failedCount > 0
                ? 'Choose any completed concept, or retry an unfinished idea first.'
                : 'Select the strongest idea to take forward.'
            : 'The first completed idea will appear here without waiting for the full batch.';
    elements.produceSelectedConceptButton.disabled = session.isGenerating || !selected;
    elements.generateMoreConceptsButton.disabled = session.isGenerating;
}

async function retryConcept(session, conceptId) {
    if (session.isGenerating || !session.generationSnapshot) return;
    const concept = session.concepts.find(item => item.id === conceptId);
    if (!concept) return;

    const generation = {
        snapshot: session.generationSnapshot,
        supportingImages: buildSupportingImagesPayload(session, session.generationSnapshot.referenceSelection),
        previousArtworkDataUrl: session.primaryArtworkDataUrl
    };
    const generationController = new AbortController();
    session.isGenerating = true;
    session.generationAbortController = generationController;
    session.errorMessage = null;
    concept.status = 'generating';
    concept.failure = null;
    setBusy(session, true);
    setCampaignStatus(session, `Retrying concept ${concept.index + 1}`, 'generating');
    setProgressState(session, 'concepts', 'active', `Retrying idea ${concept.index + 1}`);
    renderConceptChoices(session);
    startGenerationClock(session);

    session.generationPromise = (async () => {
        try {
            const response = await generateConceptWithSafetyRecovery(session, generation, concept, generationController.signal);
            concept.artworkSource = response.dataUrl;
            concept.status = 'ready';
            await persistConceptArtwork(session, concept, response.dataUrl);
        } catch (error) {
            if (error?.name !== 'AbortError') console.error(error);
            concept.status = 'failed';
            concept.failure = serialiseGenerationFailure(error);
        } finally {
            stopGenerationClock(session);
            session.isGenerating = false;
            session.generationPromise = null;
            if (session.generationAbortController === generationController) session.generationAbortController = null;
            const readyCount = session.concepts.filter(item => item.artworkSource).length;
            const failedCount = session.concepts.filter(item => item.status === 'failed').length;
            setProgressState(session, 'concepts', failedCount === 0 ? 'complete' : 'error', `${readyCount} of ${CONCEPT_PREVIEW_COUNT} ready`);
            setCampaignStatus(session, readyCount > 0 ? 'Choose a concept' : 'Concept generation failed', readyCount > 0 ? 'ready' : 'neutral');
            setBusy(session, false);
            renderConceptChoices(session);
            await persistSession(session);
        }
    })();

    return session.generationPromise;
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
        safetyRefusal: error?.safetyRefusal === true,
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

function buildMissingFormatsMessage(outputs, failures = activeSession?.failedOutputs, sourceDesignMode = false) {
    const names = outputs.map(output => output.name);
    const formatList = names.length > 1
        ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
        : names[0] || 'One or more formats';
    const firstFailure = outputs.map(output => failures?.get(output.id)).find(Boolean);
    const reason = firstFailure && !isGenericGenerationError(firstFailure.message)
        ? ` ${firstFailure.message}`
        : '';
    const reference = firstFailure?.requestId ? ` Support reference: ${firstFailure.requestId}.` : '';
    const retainedCopy = sourceDesignMode
        ? 'The original supplied design and every completed format have been kept.'
        : 'The digital-screen master and every completed format have been kept.';
    return `${formatList} could not be created.${reason}${reference} ${retainedCopy} Use “Retry missing formats” to continue without regenerating them.`;
}

function revealReviewAndShare(session) {
    session.refinementVisible = true;
    session.publishVisible = true;
    if (!isSessionVisible(session)) return;
    elements.refinementPanel.classList.remove('hidden');
    elements.sharePanel.classList.remove('hidden');
    elements.shareTopButton.disabled = false;
    updateGenerationOriginUi(session);
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
    if (session.generationOrigin === 'uploaded-design') {
        const missingSourceDesignOutputs = getMissingSourceDesignOutputs(session);
        if (!session.sourceDesign?.artworkSource || missingSourceDesignOutputs.length === 0) return;
        return produceUploadedDesign(session, missingSourceDesignOutputs);
    }
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


async function selectSourceDesign(session, file) {
    showSourceDesignUploadError('');
    if (!SOURCE_DESIGN_MIME_TYPES.has(file.type)) {
        throw new Error('Upload the supplied poster as a PNG, JPEG or WebP image.');
    }
    if (file.size <= 0 || file.size > SOURCE_DESIGN_MAX_BYTES) {
        throw new Error('The supplied poster must be smaller than 40 MB.');
    }

    const artworkSource = await fileToDataUrl(file);
    const image = await loadImage(artworkSource);
    if (!image.naturalWidth || !image.naturalHeight) {
        throw new Error('The supplied poster does not contain a readable image.');
    }

    session.sourceDesign = {
        fileName: file.name,
        artworkSource,
        version: null,
        width: image.naturalWidth,
        height: image.naturalHeight,
        byteLength: file.size,
        uploadedAt: new Date().toISOString(),
        available: true,
        saved: false
    };
    resetCampaignForSourceDesign(session);
    session.form.refinementNotes = '';
    if (elements.refinementNotes) elements.refinementNotes.value = '';
    session.config.outputs.forEach(output => session.selectedOutputIds.add(output.id));
    renderOutputs(session);
    updateSourceDesignUi(session);
    showSourceDesignMessage('Saving the original design with this event…');

    await persistSourceDesignArtwork(session);
    updateSourceDesignUi(session);
    showSourceDesignMessage(
        session.sourceDesign?.saved
            ? 'Original design saved. Review your change instructions, then create the three formats.'
            : 'The original is available in this browser, but could not be saved for generation. Check the connection or replace the upload, then try again.',
        session.sourceDesign?.saved !== true
    );
    await persistSession(session);
}

function removeSourceDesign(session) {
    if (session.isGenerating) return;
    session.sourceDesign = null;
    resetCampaignAfterSourceDesignRemoval(session);
    showSourceDesignUploadError('');
    updateSourceDesignUi(session);
    renderConceptChoices(session);
    scheduleSessionPersistence(session);
}

function resetCampaignForSourceDesign(session) {
    clearGeneratedCampaignState(session);
    session.generationOrigin = 'uploaded-design';
    session.form.selectedLibraryReferences = [];
    session.progress = {
        concepts: { cssClass: 'complete', label: 'Original retained' },
        primary: { cssClass: '', label: 'Waiting' },
        variants: { cssClass: '', label: 'Constrained by original' },
        compose: { cssClass: '', label: 'Waiting' }
    };
    setCampaignStatus(session, 'Source design ready', 'ready');
    setWorkflowStep(session, 2, true);
    hideGeneratedCampaignUi(session);
    renderSupportingFiles(session);
    updateGenerationOriginUi(session);
}

function resetCampaignAfterSourceDesignRemoval(session) {
    clearGeneratedCampaignState(session);
    session.generationOrigin = 'concept';
    session.progress = {
        concepts: { cssClass: '', label: 'Waiting' },
        primary: { cssClass: '', label: 'Waiting' },
        variants: { cssClass: '', label: 'Waiting' },
        compose: { cssClass: '', label: 'Waiting' }
    };
    setCampaignStatus(session, 'Not started', 'neutral');
    setWorkflowStep(session, 1, false);
    hideGeneratedCampaignUi(session);
    updateAutomaticReferenceSelection(session);
    updateGenerationOriginUi(session);
}

function clearGeneratedCampaignState(session) {
    session.primaryArtworkDataUrl = null;
    session.concepts = [];
    session.selectedConceptId = null;
    session.artworkByOutput.clear();
    session.posterCanvases.clear();
    session.failedOutputs.clear();
    session.generationSnapshot = null;
    session.referenceSelection = null;
    session.errorMessage = null;
    session.refinementVisible = false;
    session.publishVisible = false;
    session.workflowComplete = false;
}

function hideGeneratedCampaignUi(session) {
    if (!isSessionVisible(session)) return;
    elements.emptyState.classList.remove('hidden');
    elements.generationProgress.classList.add('hidden');
    elements.conceptSelectionPanel?.classList.add('hidden');
    elements.generatedArtworkPanel.classList.add('hidden');
    elements.posterResults.classList.add('hidden');
    elements.posterResults.innerHTML = '';
    elements.refinementPanel.classList.add('hidden');
    elements.sharePanel.classList.add('hidden');
    elements.shareTopButton.disabled = true;
    elements.generationProgress.querySelector('[data-generation-error]')?.remove();
}

function showSourceDesignMessage(message, isError = false) {
    if (!elements.sourceDesignMessage) return;
    elements.sourceDesignMessage.textContent = message ?? '';
    elements.sourceDesignMessage.classList.toggle('error', isError);
}

function showSourceDesignUploadError(message) {
    if (!elements.sourceDesignUploadError) return;
    elements.sourceDesignUploadError.textContent = message ?? '';
    elements.sourceDesignUploadError.classList.toggle('hidden', !message);
}

function updateSourceDesignUi(session) {
    if (!isSessionVisible(session)) return;
    const sourceDesign = session.sourceDesign;
    const hasSourceDesign = Boolean(sourceDesign?.artworkSource);

    elements.sourceDesignPanel?.classList.toggle('hidden', !hasSourceDesign);
    if (hasSourceDesign) elements.conceptSelectionPanel?.classList.add('hidden');
    if (hasSourceDesign) {
        if (elements.sourceDesignPreview.getAttribute('src') !== sourceDesign.artworkSource) {
            elements.sourceDesignPreview.src = sourceDesign.artworkSource;
        }
        elements.sourceDesignPreview.alt = `Uploaded source design: ${sourceDesign.fileName}`;
        elements.sourceDesignName.textContent = sourceDesign.fileName;
        const dimensions = sourceDesign.width > 0 && sourceDesign.height > 0
            ? `${sourceDesign.width} × ${sourceDesign.height}`
            : 'Dimensions unavailable';
        elements.sourceDesignMetadata.textContent = `${dimensions} · ${formatFileSize(sourceDesign.byteLength)}`;
    } else if (elements.sourceDesignPreview) {
        elements.sourceDesignPreview.removeAttribute('src');
        showSourceDesignMessage('');
    }

    if (elements.uploadDesignButton) {
        elements.uploadDesignButton.innerHTML = hasSourceDesign
            ? '<span>↥</span> Replace uploaded design'
            : '<span>↥</span> Upload design';
        elements.uploadDesignButton.disabled = session.isGenerating;
    }
    if (elements.produceSourceDesignButton) elements.produceSourceDesignButton.disabled = session.isGenerating || !hasSourceDesign || sourceDesign.available === false;
    if (elements.replaceSourceDesignButton) elements.replaceSourceDesignButton.disabled = session.isGenerating;
    if (elements.removeSourceDesignButton) elements.removeSourceDesignButton.disabled = session.isGenerating;
    if (elements.generateButton) elements.generateButton.disabled = session.isGenerating || hasSourceDesign;

    elements.posterStyleField?.classList.toggle('source-design-bypassed', hasSourceDesign);
    elements.supportingUploadBox?.classList.toggle('source-design-bypassed', hasSourceDesign);
    if (elements.posterStyleHelp) {
        elements.posterStyleHelp.textContent = hasSourceDesign
            ? 'Style supplied by the uploaded design. Remove it to use an AI style preset.'
            : 'Choose the visual direction for AI-created concepts.';
    }
    if (elements.additionalInstructionsLabel) {
        elements.additionalInstructionsLabel.innerHTML = hasSourceDesign
            ? 'Specific changes to make <em>optional</em>'
            : 'Additional creative instructions <em>optional</em>';
    }
    if (elements.additionalInstructionsHelp) {
        elements.additionalInstructionsHelp.textContent = hasSourceDesign
            ? 'Only these changes and the layout adjustments needed for each format will be applied to the uploaded design.'
            : 'These instructions refine the creative brief used for AI-generated concepts.';
    }

    elements.styleOptions?.querySelectorAll('input[name="posterStyle"]').forEach(input => {
        input.disabled = session.isGenerating || hasSourceDesign;
    });
    if (elements.supportingFilesInput) elements.supportingFilesInput.disabled = session.isGenerating || hasSourceDesign;
    if (elements.useLibraryReferences) elements.useLibraryReferences.disabled = session.isGenerating || hasSourceDesign;
    elements.outputOptions?.querySelectorAll('input[type="checkbox"]').forEach(input => {
        input.disabled = session.isGenerating || hasSourceDesign || input.closest('.output-card')?.classList.contains('primary');
    });

    updateGenerationOriginUi(session);
}

function updateGenerationOriginUi(session) {
    if (!isSessionVisible(session)) return;
    const uploadedDesignMode = Boolean(session.sourceDesign) || session.generationOrigin === 'uploaded-design';
    const workflowSourceStep = document.querySelector('.poster-studio .workflow-step[data-step="2"]');
    const sourceProgress = elements.generationProgress?.querySelector('[data-progress="concepts"]');
    const primaryProgress = elements.generationProgress?.querySelector('[data-progress="primary"]');
    const variantsProgress = elements.generationProgress?.querySelector('[data-progress="variants"]');

    if (workflowSourceStep) {
        workflowSourceStep.querySelector('strong').textContent = uploadedDesignMode ? 'Source design' : 'Choose concept';
        workflowSourceStep.querySelector('small').textContent = uploadedDesignMode ? 'Original retained' : '3 draft ideas';
    }
    if (sourceProgress) {
        sourceProgress.querySelector('strong').textContent = uploadedDesignMode ? 'Uploaded source design' : 'Low-resolution concepts';
        sourceProgress.querySelector('small').textContent = uploadedDesignMode
            ? 'The supplied artwork remains the sole visual source'
            : 'Three distinct digital-screen ideas, saved as each one finishes';
    }
    if (primaryProgress) {
        primaryProgress.querySelector('strong').textContent = uploadedDesignMode ? 'Campaign format generation' : 'High-resolution master artwork';
        primaryProgress.querySelector('small').textContent = uploadedDesignMode
            ? 'Each selected size is generated directly from the original'
            : 'Rebuilding the selected concept with exact copy and polished detail';
    }
    if (variantsProgress) {
        variantsProgress.querySelector('strong').textContent = uploadedDesignMode ? 'Visual consistency' : 'Reference-led format adaptations';
        variantsProgress.querySelector('small').textContent = uploadedDesignMode
            ? 'No style preset or Image Library reference is introduced'
            : 'Recomposing the approved master for each selected dimension';
    }

    const refinementHeading = elements.refinementPanel?.querySelector('h3');
    const refinementCopy = elements.refinementPanel?.querySelector('p:not(.section-kicker)');
    const generatedArtworkCopy = elements.generatedArtworkPanel?.querySelector('.panel-heading .panel-copy');
    if (refinementHeading) refinementHeading.textContent = session.generationOrigin === 'uploaded-design' ? 'Refine the supplied design' : 'Explore three refined ideas';
    if (refinementCopy) {
        refinementCopy.textContent = session.generationOrigin === 'uploaded-design'
            ? 'Describe only the changes you want. All three formats will be recreated directly from the retained original design.'
            : 'Describe what worked and what should change. The studio will create three new low-resolution concepts before any high-resolution formats are replaced.';
    }
    if (elements.regenerateButton) {
        elements.regenerateButton.textContent = session.generationOrigin === 'uploaded-design'
            ? 'Apply changes to 3 formats'
            : 'Create 3 refined concepts';
        elements.regenerateButton.disabled = session.isGenerating || (session.generationOrigin === 'uploaded-design' && (!session.sourceDesign || session.sourceDesign.available === false));
    }
    if (generatedArtworkCopy) {
        generatedArtworkCopy.textContent = session.generationOrigin === 'uploaded-design'
            ? 'Review each AI adaptation against the retained original before sharing. Every format was produced directly from that original, never from another generated version.'
            : 'Each finished poster appears here immediately, without waiting for the rest of the campaign to finish generating.';
    }
}

function formatFileSize(byteLength) {
    const bytes = Number(byteLength) || 0;
    if (bytes < 1024) return `${bytes} bytes`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

    const automaticMarkup = session.sourceDesign
        ? '<div class="automatic-reference-summary muted"><strong>Not used with the supplied design</strong><small>The uploaded poster remains the only visual source for all three formats.</small></div>'
        : session.form.useLibraryReferences === false
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
            throw new Error('The Communications Centre could not reach the image service. Check that the application server is running, then try again.');
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
        const error = new Error(body.detail ?? body.error ?? body.title ?? 'The service returned an error.');
        error.title = typeof body.title === 'string' ? body.title : null;
        error.retryable = body.retryable === true;
        error.safetyRefusal = body.safetyRefusal === true;
        error.requestId = typeof body.requestId === 'string' ? body.requestId : null;
        error.code = typeof body.code === 'string' ? body.code : null;
        error.stage = typeof body.stage === 'string' ? body.stage : null;
        error.intelligentGolfEventId = Number(body.intelligentGolfEventId) > 0
            ? Number(body.intelligentGolfEventId)
            : null;
        error.intelligentGolfRecordId = Number(body.intelligentGolfRecordId) > 0
            ? Number(body.intelligentGolfRecordId)
            : null;
        error.upstreamStatusCode = Number(body.upstreamStatusCode) > 0
            ? Number(body.upstreamStatusCode)
            : null;
        error.traceId = typeof body.traceId === 'string' ? body.traceId : null;
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
    const mark = await loadImage(configCache?.brand?.crestUrl || '/assets/botgc-mark.svg');
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

function getMemberEmailArtwork(session) {
    const outputs = session.config?.outputs ?? [];
    const squareOutput = outputs.find(output => output.width === output.height && session.posterCanvases.has(output.id));
    const printOutput = outputs.find(output => output.id === 'a4' && session.posterCanvases.has(output.id));
    const primaryOutput = getPrimaryOutput(session);
    const output = squareOutput ?? printOutput ?? primaryOutput;
    const canvas = output ? session.posterCanvases.get(output.id) : null;
    return output && canvas ? { output, canvas } : null;
}

function captureMemberEmailDialog(session) {
    if (!elements.emailSubject) return;
    session.form.emailSubject = elements.emailSubject.value.trim();
    session.form.emailBodyHtml = elements.emailBody.value;
    session.form.emailTestAddress = elements.emailTestAddress.value.trim();
    session.form.emailAudienceMode = Array.from(elements.emailAudienceModes ?? [])
        .find(input => input.checked)?.value ?? 'all';
    session.form.emailMembershipCategories = Array.from(
        elements.emailCategories?.querySelectorAll('input[type="checkbox"]:checked') ?? []
    ).map(input => input.value);
    updateMemberEmailSendState(session);
}

async function openMemberEmailDialog() {
    const session = activeSession;
    if (!session || !elements.emailDialog) return;
    const artwork = getMemberEmailArtwork(session);
    if (!artwork) {
        elements.shareMessage.textContent = 'Generate at least one finished campaign format before emailing members.';
        return;
    }

    elements.emailArtworkPreview.src = artwork.canvas.toDataURL('image/png');
    elements.emailArtworkPreview.style.aspectRatio = `${artwork.output.width} / ${artwork.output.height}`;
    elements.emailArtworkName.textContent = artwork.output.name;
    elements.emailSubject.value = session.form.emailSubject || '';
    elements.emailBody.value = session.form.emailBodyHtml || '';
    elements.emailTestAddress.value = session.form.emailTestAddress || '';
    elements.emailAudienceModes?.forEach(input => {
        input.checked = input.value === (session.form.emailAudienceMode || 'all');
    });
    elements.emailDialogMessage.textContent = '';
    elements.emailDialogMessage.className = 'poster-publish-dialog-message';

    const connection = session.config?.memberEmail ?? {};
    elements.emailConnectionStatus.className = `yodeck-connection-status ${connection.configured ? 'ready' : 'unavailable'}`;
    elements.emailConnectionStatus.innerHTML = connection.configured
        ? '<span></span><div><strong>Member email connection ready</strong><small>Recipients and delivery are handled securely through the club membership system.</small></div>'
        : '<span></span><div><strong>Member email connection unavailable</strong><small>An administrator must configure and enable the Intelligent Golf connection first.</small></div>';
    elements.emailGenerateButton.disabled = false;
    elements.emailLoadAudienceButton.disabled = !connection.configured;
    elements.emailTestButton.disabled = !connection.configured;

    renderMemberEmailPreview();
    renderMemberEmailAudience(session);
    elements.emailDialog.showModal();
    if (!session.form.emailBodyHtml) {
        await generateMemberEmailDraft(session);
    } else {
        requestAnimationFrame(() => elements.emailSubject.focus());
    }
}

function closeMemberEmailDialog() {
    const session = activeSession;
    if (session) {
        captureMemberEmailDialog(session);
        scheduleSessionPersistence(session);
    }
    elements.emailDialog?.close();
}

async function generateMemberEmailDraft(session) {
    const artwork = getMemberEmailArtwork(session);
    if (!artwork) return;
    captureMemberEmailDialog(session);
    elements.emailGenerateButton.disabled = true;
    elements.emailGenerateButton.textContent = 'Generating email…';
    elements.emailDialogMessage.textContent = 'Preparing an event-specific member email from the approved campaign…';
    elements.emailDialogMessage.className = 'poster-publish-dialog-message working';
    try {
        const response = await fetch('/api/poster/member-email/draft', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                eventId: session.context?.eventId || session.key,
                eventName: getCampaignEventName(session),
                eventDate: session.form.eventDate,
                description: session.form.description,
                additionalInstructions: session.form.additionalInstructions || null,
                price: session.form.includePrice ? session.form.price : null,
                artwork: {
                    outputId: artwork.output.id,
                    name: artwork.output.name,
                    dataUrl: artwork.canvas.toDataURL('image/png')
                }
            })
        });
        const result = await readApiResponse(response);
        session.form.emailSubject = String(result.subject ?? '');
        session.form.emailBodyHtml = String(result.bodyHtml ?? '');
        elements.emailSubject.value = session.form.emailSubject;
        elements.emailBody.value = session.form.emailBodyHtml;
        renderMemberEmailPreview();
        elements.emailDialogMessage.textContent = result.mode === 'openai'
            ? 'The AI-assisted draft is ready. Review and edit it before sending a test.'
            : 'A reliable event-based draft is ready. Review and edit it before sending a test.';
        elements.emailDialogMessage.className = 'poster-publish-dialog-message success';
        await persistSession(session);
    } catch (error) {
        elements.emailDialogMessage.textContent = error instanceof Error ? error.message : 'The member email draft could not be generated.';
        elements.emailDialogMessage.className = 'poster-publish-dialog-message error';
    } finally {
        elements.emailGenerateButton.disabled = false;
        elements.emailGenerateButton.textContent = 'Generate email with AI';
        updateMemberEmailSendState(session);
    }
}

function renderMemberEmailPreview() {
    if (!elements.emailBodyPreview) return;
    const subject = elements.emailSubject?.value.trim() || 'Member email preview';
    const body = elements.emailBody?.value || '<p style="font-family:Arial,sans-serif;color:#52666b">Generate or enter an email to preview it here.</p>';
    elements.emailBodyPreview.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:18px;background:#fff">${body}</body></html>`;
}

async function loadMemberEmailAudience(session, refresh = false) {
    elements.emailLoadAudienceButton.disabled = true;
    elements.emailLoadAudienceButton.textContent = 'Retrieving members…';
    elements.emailDialogMessage.textContent = 'Retrieving the current active-member directory and contact details…';
    elements.emailDialogMessage.className = 'poster-publish-dialog-message working';
    try {
        const response = await fetch(`/api/poster/member-email/members?refresh=${refresh ? 'true' : 'false'}`, { cache: 'no-store' });
        const members = await readApiResponse(response);
        const activeMembers = Array.isArray(members) ? members.filter(member => member?.isActive) : [];
        session.memberEmailMembers = activeMembers.filter(member =>
            Number(member.memberNumber) > 0 &&
            Number(member.intelligentGolfUserId) > 0 &&
            typeof member.email === 'string' &&
            member.email.trim());
        session.memberEmailExcludedCount = Math.max(0, activeMembers.length - session.memberEmailMembers.length);
        renderMemberEmailAudience(session);
        elements.emailDialogMessage.textContent = `${session.memberEmailMembers.length} active members with email addresses are available${session.memberEmailExcludedCount ? `; ${session.memberEmailExcludedCount} without usable email details were excluded` : ''}.`;
        elements.emailDialogMessage.className = 'poster-publish-dialog-message success';
    } catch (error) {
        elements.emailDialogMessage.textContent = error instanceof Error ? error.message : 'The active-member directory could not be retrieved.';
        elements.emailDialogMessage.className = 'poster-publish-dialog-message error';
    } finally {
        elements.emailLoadAudienceButton.disabled = !(session.config?.memberEmail?.configured);
        elements.emailLoadAudienceButton.textContent = 'Refresh active members';
        updateMemberEmailSendState(session);
    }
}

function renderMemberEmailAudience(session) {
    const mode = session.form.emailAudienceMode || 'all';
    elements.emailCategories?.classList.toggle('hidden', mode !== 'categories');
    if (!elements.emailCategories) return;

    const counts = new Map();
    for (const member of session.memberEmailMembers ?? []) {
        const category = String(member.membershipCategory || 'Uncategorised').trim() || 'Uncategorised';
        counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    const selected = new Set(session.form.emailMembershipCategories ?? []);
    elements.emailCategories.innerHTML = [...counts.entries()]
        .sort(([left], [right]) => left.localeCompare(right, 'en-GB'))
        .map(([category, count]) => `<label><input type="checkbox" value="${escapeHtml(category)}"${selected.has(category) ? ' checked' : ''}><span><strong>${escapeHtml(category)}</strong><small>${count} member${count === 1 ? '' : 's'}</small></span></label>`)
        .join('');
    updateMemberEmailAudienceSummary(session);
}

function getSelectedMemberEmailRecipients(session) {
    const members = session.memberEmailMembers ?? [];
    if (session.form.emailAudienceMode !== 'categories') return members;
    const selected = new Set(session.form.emailMembershipCategories ?? []);
    return members.filter(member => selected.has(String(member.membershipCategory || 'Uncategorised').trim() || 'Uncategorised'));
}

function updateMemberEmailAudienceSummary(session) {
    captureMemberEmailCategorySelection(session);
    const recipients = getSelectedMemberEmailRecipients(session);
    if (elements.emailAudienceSummary) {
        elements.emailAudienceSummary.textContent = session.memberEmailMembers?.length
            ? `${recipients.length} active member${recipients.length === 1 ? '' : 's'} will receive this email.`
            : 'Retrieve the current member list to choose recipients.';
    }
    updateMemberEmailSendState(session);
}

function captureMemberEmailCategorySelection(session) {
    session.form.emailMembershipCategories = Array.from(
        elements.emailCategories?.querySelectorAll('input[type="checkbox"]:checked') ?? []
    ).map(input => input.value);
}

function updateMemberEmailSendState(session) {
    if (!elements.emailDialogConfirm) return;
    const recipients = getSelectedMemberEmailRecipients(session);
    const ready = session.config?.memberEmail?.configured &&
        elements.emailSubject?.value.trim() &&
        elements.emailBody?.value.trim() &&
        recipients.length > 0;
    elements.emailDialogConfirm.disabled = !ready;
    elements.emailDialogConfirm.textContent = recipients.length > 0
        ? `Send email to ${recipients.length} member${recipients.length === 1 ? '' : 's'}`
        : 'Send email to members';
}

async function sendMemberEmailTest(session) {
    captureMemberEmailDialog(session);
    if (!elements.emailSubject.value.trim() || !elements.emailBody.value.trim()) {
        elements.emailDialogMessage.textContent = 'Generate or enter the email subject and body before sending a test.';
        elements.emailDialogMessage.className = 'poster-publish-dialog-message error';
        return;
    }
    if (!elements.emailTestAddress.value.trim() || !elements.emailTestAddress.checkValidity()) {
        elements.emailDialogMessage.textContent = 'Enter a valid email address for the test message.';
        elements.emailDialogMessage.className = 'poster-publish-dialog-message error';
        elements.emailTestAddress.focus();
        return;
    }

    elements.emailTestButton.disabled = true;
    elements.emailTestButton.textContent = 'Sending test…';
    elements.emailDialogMessage.textContent = `Sending a test to ${session.form.emailTestAddress}…`;
    elements.emailDialogMessage.className = 'poster-publish-dialog-message working';
    try {
        const response = await fetch('/api/poster/member-email/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recipientEmail: session.form.emailTestAddress,
                subject: session.form.emailSubject,
                bodyHtml: session.form.emailBodyHtml
            })
        });
        await readApiResponse(response);
        elements.emailDialogMessage.textContent = `Test email sent to ${session.form.emailTestAddress}. Check it before sending to members.`;
        elements.emailDialogMessage.className = 'poster-publish-dialog-message success';
        await persistSession(session);
    } catch (error) {
        elements.emailDialogMessage.textContent = error instanceof Error ? error.message : 'The test email could not be sent.';
        elements.emailDialogMessage.className = 'poster-publish-dialog-message error';
    } finally {
        elements.emailTestButton.disabled = !(session.config?.memberEmail?.configured);
        elements.emailTestButton.textContent = 'Send test';
    }
}

async function sendMemberCampaignEmail() {
    const session = activeSession;
    if (!session) return;
    captureMemberEmailDialog(session);
    const recipients = getSelectedMemberEmailRecipients(session);
    if (!recipients.length) return;
    if (!window.confirm(`Send “${session.form.emailSubject}” to ${recipients.length} active club member${recipients.length === 1 ? '' : 's'} now?`)) return;

    elements.emailDialogConfirm.disabled = true;
    elements.emailDialogConfirm.textContent = 'Sending member email…';
    elements.emailDialogMessage.textContent = `Submitting one campaign email for ${recipients.length} selected members…`;
    elements.emailDialogMessage.className = 'poster-publish-dialog-message working';
    try {
        const response = await fetch('/api/poster/member-email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                memberNumbers: recipients.map(member => Number(member.memberNumber)),
                subject: session.form.emailSubject,
                bodyHtml: session.form.emailBodyHtml
            })
        });
        const result = await readApiResponse(response);
        session.emailPublication = {
            sent: Number(result.sent ?? recipients.length),
            sentAt: new Date().toISOString(),
            subject: session.form.emailSubject
        };
        elements.shareMessage.textContent = `“${session.form.emailSubject}” was sent to ${session.emailPublication.sent} active club members.`;
        configureShareConnections(session);
        setWorkflowStep(session, 4, true);
        await persistSession(session);
        elements.emailDialog.close();
    } catch (error) {
        elements.emailDialogMessage.textContent = error instanceof Error ? error.message : 'The member campaign email could not be sent.';
        elements.emailDialogMessage.className = 'poster-publish-dialog-message error';
        updateMemberEmailSendState(session);
    }
}

function configureShareConnections(session) {
    const diaryConnection = session.config?.memberDiary ?? {};
    elements.shareDiaryCard?.classList.toggle('pending', !diaryConnection.configured);
    if (elements.shareDiaryStatus) {
        if (!diaryConnection.configured) {
            elements.shareDiaryStatus.textContent = 'Connection setup required';
            elements.shareDiaryStatus.classList.remove('hidden');
        } else if (session.diaryPublication) {
            elements.shareDiaryStatus.textContent = 'Already in the diary · send again to update';
            elements.shareDiaryStatus.classList.remove('hidden');
        } else {
            elements.shareDiaryStatus.classList.add('hidden');
        }
    }

    const emailConnection = session.config?.memberEmail ?? {};
    elements.shareEmailCard?.classList.toggle('pending', !emailConnection.configured);
    if (elements.shareEmailStatus) {
        if (!emailConnection.configured) {
            elements.shareEmailStatus.textContent = 'Connection setup required';
            elements.shareEmailStatus.classList.remove('hidden');
        } else if (session.emailPublication) {
            elements.shareEmailStatus.textContent = `Sent to ${session.emailPublication.sent} members`;
            elements.shareEmailStatus.classList.remove('hidden');
        } else {
            elements.shareEmailStatus.classList.add('hidden');
        }
    }
}

function getA4PrintArtwork(session) {
    const output = session.config?.outputs?.find(item => item.id === 'a4');
    const canvas = output ? session.posterCanvases.get(output.id) : null;
    return output && canvas ? { output, canvas } : null;
}

function getSelectedPrintSize() {
    return Array.from(elements.printSizeOptions ?? []).find(input => input.checked)?.value ?? 'A4';
}

function updatePrintSizeSelection() {
    const selectedSize = getSelectedPrintSize();
    elements.printSizeOptions?.forEach(input => {
        input.closest('.print-size-option')?.classList.toggle('selected', input.checked);
    });
    if (elements.printDialogConfirm) elements.printDialogConfirm.textContent = `Print ${selectedSize}`;
    if (elements.printPreviewSize) elements.printPreviewSize.textContent = `${selectedSize} portrait · approved A-series layout`;
}

function openPrintDialog() {
    const session = activeSession;
    if (!session || !elements.printDialog) return;
    const printArtwork = getA4PrintArtwork(session);
    if (!printArtwork) {
        elements.shareMessage.textContent = 'The A4 Print artwork is not ready. Generate or retry that format before printing A3, A4 or A5.';
        return;
    }

    elements.printPreview.src = printArtwork.canvas.toDataURL('image/png');
    elements.printDialogMessage.textContent = '';
    elements.printDialogMessage.className = 'poster-publish-dialog-message';
    updatePrintSizeSelection();
    elements.printDialog.showModal();
}

function closePrintDialog() {
    elements.printDialog?.close();
}

function printApprovedCampaign() {
    const session = activeSession;
    const printArtwork = session ? getA4PrintArtwork(session) : null;
    if (!session || !printArtwork) {
        elements.printDialogMessage.textContent = 'The approved A-series artwork is no longer available. Close this window and regenerate the A4 format.';
        elements.printDialogMessage.className = 'poster-publish-dialog-message error';
        return;
    }

    const printSize = getSelectedPrintSize();
    const printWindow = window.open('', '_blank', 'popup,width=920,height=1100');
    if (!printWindow) {
        elements.printDialogMessage.textContent = 'The browser blocked the print window. Allow pop-ups for Event Playbook and try again.';
        elements.printDialogMessage.className = 'poster-publish-dialog-message error';
        return;
    }

    printWindow.opener = null;
    const document = printWindow.document;
    document.title = `${getCampaignEventName(session)} — ${printSize}`;
    const style = document.createElement('style');
    style.textContent = `
        @page { size: ${printSize} portrait; margin: 0; }
        * { box-sizing: border-box; }
        html, body { width: 100%; height: 100%; margin: 0; padding: 0; background: #fff; }
        body { display: grid; place-items: center; overflow: hidden; }
        img { display: block; width: 100%; height: 100%; object-fit: contain; }
        @media screen { body { background: #dce5e2; padding: 20px; } img { width: auto; max-width: 100%; box-shadow: 0 12px 38px rgba(0,0,0,.2); } }
        @media print { html, body, img { width: 100%; height: 100%; } }
    `;
    const image = document.createElement('img');
    image.alt = `${getCampaignEventName(session)} poster`;
    image.addEventListener('load', () => {
        window.setTimeout(() => {
            printWindow.focus();
            printWindow.print();
        }, 150);
    }, { once: true });
    document.head.append(style);
    document.body.append(image);
    image.src = printArtwork.canvas.toDataURL('image/png');

    elements.shareMessage.textContent = `${getCampaignEventName(session)} is ready to print as ${printSize}.`;
    closePrintDialog();
}

function getMemberDiaryArtwork(session) {
    const outputs = session.config?.outputs ?? [];
    const squareOutput = outputs.find(output => output.width === output.height && session.posterCanvases.has(output.id));
    const printOutput = outputs.find(output => output.id === 'a4' && session.posterCanvases.has(output.id));
    const primaryOutput = getPrimaryOutput(session);
    const output = squareOutput ?? printOutput ?? primaryOutput;
    const canvas = output ? session.posterCanvases.get(output.id) : null;
    return output && canvas ? { output, canvas } : null;
}

function captureMemberDiaryDialog(session) {
    if (!elements.diaryTitle) return;
    session.form.diaryTitle = elements.diaryTitle.value.trim();
    session.form.diaryDescription = elements.diaryDescription.value.trim();
    session.form.diaryStartTime = elements.diaryStartTime.value;
    session.form.diaryEndTime = elements.diaryEndTime.value;
    session.form.diaryBookingUrl = elements.diaryBookingUrl.value.trim();
}

function memberDiaryStageLabel(stage) {
    const labels = {
        'planner-allocation': 'creating the Intelligent Golf planner entry',
        'planner-allocation-response': 'reading the new planner entry ID',
        'planner-page-preparation': 'opening the linked planner entry',
        'planner-details-update': 'updating the planner details',
        'planner-details-verification': 'checking the saved planner details',
        'member-diary-discovery': 'checking for an existing member diary entry',
        'member-diary-allocation': 'creating the member diary entry',
        'member-diary-allocation-response': 'reading the new member diary entry ID',
        'member-diary-add': 'creating the member diary entry',
        'member-diary-add-response': 'reading the new member diary entry ID',
        'member-diary-initialisation': 'saving the initial member diary details',
        'member-diary-update': 'saving the member diary HTML'
    };
    return labels[stage] ?? null;
}

function formatMemberDiaryFailure(error) {
    const message = error instanceof Error
        ? error.message
        : 'The event could not be added to the member diary.';
    const stage = memberDiaryStageLabel(error?.stage);
    const identifiers = [];
    if (error?.intelligentGolfEventId) identifiers.push(`planner entry ${error.intelligentGolfEventId}`);
    if (error?.intelligentGolfRecordId) identifiers.push(`diary entry ${error.intelligentGolfRecordId}`);
    const context = [stage ? `failed while ${stage}` : null, identifiers.length ? identifiers.join(', ') : null]
        .filter(Boolean)
        .join(' · ');
    const reference = error?.traceId ? ` Reference: ${error.traceId}.` : '';
    return `${context ? `${message} (${context})` : message}${reference}`;
}

async function openMemberDiaryDialog() {
    const session = activeSession;
    if (!session || !elements.diaryDialog) return;
    const diaryArtwork = getMemberDiaryArtwork(session);
    if (!diaryArtwork) {
        elements.shareMessage.textContent = 'Generate at least one finished campaign format before adding this event to the member diary.';
        return;
    }

    elements.diaryPreview.src = diaryArtwork.canvas.toDataURL('image/png');
    elements.diaryPreview.style.aspectRatio = `${diaryArtwork.output.width} / ${diaryArtwork.output.height}`;
    elements.diaryTitle.value = session.form.diaryTitle || getCampaignEventName(session);
    elements.diaryDate.value = session.form.eventDate;
    elements.diaryStartTime.value = session.form.diaryStartTime || '';
    elements.diaryEndTime.value = session.form.diaryEndTime || '';
    elements.diaryDescription.value = session.form.diaryDescription || '';
    elements.diaryBookingUrl.value = session.form.diaryBookingUrl || '';
    elements.diaryDialogMessage.textContent = '';
    elements.diaryDialogMessage.className = 'poster-publish-dialog-message';

    const connection = session.config?.memberDiary ?? {};
    elements.diaryConnectionStatus.className = `yodeck-connection-status ${connection.configured ? 'ready' : 'unavailable'}`;
    elements.diaryConnectionStatus.innerHTML = connection.configured
        ? '<span></span><div><strong>Member diary connection ready</strong><small>If this event has not yet been created in Intelligent Golf, it will be created before the diary entry is published.</small></div>'
        : '<span></span><div><strong>Member diary connection unavailable</strong><small>An administrator must complete the server-side diary connection before this event can be added.</small></div>';
    elements.diaryDialogConfirm.disabled = !connection.configured;
    elements.diaryDialogConfirm.textContent = session.diaryPublication ? 'Update member diary' : 'Add to member diary';
    if (connection.configured && session.diaryPublication) {
        elements.diaryDialogMessage.textContent = 'This event is already linked to a diary entry. Saving again will update the existing entry.';
    }

    elements.diaryDialog.showModal();
    renderMemberDiaryPreview();
    requestAnimationFrame(() => elements.diaryTitle.focus());
    if (connection.configured) {
        await refreshMemberDiaryIntegrationStatus(session);
    }

    const body = session.form.diaryDescription.trim();
    if (connection.configured && (!body || body === session.form.description.trim())) {
        await generateMemberDiaryDraft(session);
    }
}

async function refreshMemberDiaryIntegrationStatus(session) {
    const eventId = session.context?.eventId || session.key;
    if (!eventId || !elements.diaryConnectionStatus) return;

    try {
        const response = await fetch(`/api/integrations/intelligent-golf/events/${encodeURIComponent(eventId)}`, {
            cache: 'no-store'
        });
        if (!response.ok) return;
        const status = await response.json();
        if (status.lastError) {
            const record = status.plannerEntryId
                ? `Planner entry ${status.plannerEntryId} has been allocated, but its details are not yet synchronised.`
                : 'The planner entry has not been synchronised.';
            const failedStage = memberDiaryStageLabel(status.lastErrorStage);
            const stage = failedStage ? ` The last attempt failed while ${failedStage}.` : '';
            elements.diaryConnectionStatus.className = 'yodeck-connection-status unavailable';
            elements.diaryConnectionStatus.innerHTML = `<span></span><div><strong>Intelligent Golf needs attention</strong><small>${escapeHtml(record)} Publishing will retry the same entry.${escapeHtml(stage)} ${escapeHtml(status.lastError)}</small><a class="integration-diagnostics-link" href="/?view=plugins">View integration activity</a></div>`;
            return;
        }

        if (status.plannerEntryId) {
            elements.diaryConnectionStatus.className = 'yodeck-connection-status ready';
            elements.diaryConnectionStatus.innerHTML = `<span></span><div><strong>Planner entry ${escapeHtml(String(status.plannerEntryId))} is linked</strong><small>The event details will be checked and updated before the diary entry is published.</small></div>`;
        }
    } catch {
        // The initial dialog state already reports whether the integration is configured.
    }
}

async function generateMemberDiaryDraft(session) {
    const artwork = getMemberDiaryArtwork(session);
    if (!artwork || !elements.diaryGenerateButton) return;

    captureMemberDiaryDialog(session);
    elements.diaryGenerateButton.disabled = true;
    elements.diaryGenerateButton.textContent = 'Generating diary entry…';
    elements.diaryDialogMessage.textContent = 'Preparing an event-specific diary entry from the approved campaign…';
    elements.diaryDialogMessage.className = 'poster-publish-dialog-message working';

    try {
        const response = await fetch('/api/poster/member-diary/draft', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                eventId: session.context?.eventId || session.key,
                eventName: getCampaignEventName(session),
                eventDate: session.form.eventDate,
                description: session.form.description,
                additionalInstructions: session.form.additionalInstructions || null,
                price: session.form.includePrice ? session.form.price : null,
                startTime: session.form.diaryStartTime || session.context?.startTime || null,
                endTime: session.form.diaryEndTime || session.context?.endTime || null,
                bookingUrl: session.form.diaryBookingUrl || null,
                artwork: {
                    outputId: artwork.output.id,
                    name: artwork.output.name,
                    dataUrl: artwork.canvas.toDataURL('image/png')
                }
            })
        });
        const result = await readApiResponse(response);
        session.form.diaryTitle = String(result.title ?? '').trim();
        session.form.diaryDescription = String(result.bodyHtml ?? '').trim();
        elements.diaryTitle.value = session.form.diaryTitle;
        elements.diaryDescription.value = session.form.diaryDescription;
        renderMemberDiaryPreview();
        elements.diaryDialogMessage.textContent = result.mode === 'openai'
            ? 'The AI draft is ready. Review and edit it before publishing.'
            : 'A reliable draft is ready. Review and edit it before publishing.';
        elements.diaryDialogMessage.className = 'poster-publish-dialog-message success';
        scheduleSessionPersistence(session);
    } catch (error) {
        elements.diaryDialogMessage.textContent = error instanceof Error
            ? error.message
            : 'The member diary draft could not be generated.';
        elements.diaryDialogMessage.className = 'poster-publish-dialog-message error';
    } finally {
        elements.diaryGenerateButton.disabled = false;
        elements.diaryGenerateButton.textContent = 'Generate diary entry with AI';
    }
}

function renderMemberDiaryPreview() {
    if (!elements.diaryBodyPreview) return;
    const title = elements.diaryTitle?.value.trim() || 'Member diary preview';
    const body = elements.diaryDescription?.value || '<p style="font-family:Arial,sans-serif;color:#52666b">Generate or enter a diary entry to preview it here.</p>';
    elements.diaryBodyPreview.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:18px;background:#fff">${body}</body></html>`;
}

function closeMemberDiaryDialog() {
    const session = activeSession;
    if (session) {
        captureMemberDiaryDialog(session);
        scheduleSessionPersistence(session);
    }
    elements.diaryDialog?.close();
}

async function addToMemberDiary() {
    const session = activeSession;
    const diaryArtwork = session ? getMemberDiaryArtwork(session) : null;
    if (!session || !diaryArtwork) return;

    captureMemberDiaryDialog(session);
    if (!elements.diaryForm.reportValidity()) return;
    if (session.form.diaryStartTime && session.form.diaryEndTime && session.form.diaryEndTime <= session.form.diaryStartTime) {
        elements.diaryDialogMessage.textContent = 'Choose an end time after the start time.';
        elements.diaryDialogMessage.className = 'poster-publish-dialog-message error';
        return;
    }

    elements.shareDiaryButton.disabled = true;
    elements.diaryDialogConfirm.disabled = true;
    elements.diaryDialogConfirm.textContent = session.diaryPublication ? 'Updating member diary…' : 'Adding to member diary…';
    elements.diaryDialogMessage.textContent = 'Checking the Intelligent Golf event, then publishing the linked diary entry…';
    elements.diaryDialogMessage.className = 'poster-publish-dialog-message working';
    elements.shareMessage.textContent = 'Saving this event to the member diary…';

    try {
        const response = await fetch('/api/poster/member-diary', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                eventId: session.context?.eventId || session.key,
                eventName: getCampaignEventName(session),
                title: session.form.diaryTitle,
                eventDate: session.form.eventDate,
                description: session.form.diaryDescription,
                eventDescription: session.form.description,
                eventTypeId: Number(session.context?.eventTypeId) || 0,
                attendees: Math.max(0, Number(session.context?.expectedAttendees) || 0),
                venue: 'Clubhouse',
                startTime: session.form.diaryStartTime || null,
                endTime: session.form.diaryEndTime || null,
                bookingUrl: session.form.diaryBookingUrl || null,
                artwork: {
                    outputId: diaryArtwork.output.id,
                    name: diaryArtwork.output.name,
                    dataUrl: diaryArtwork.canvas.toDataURL('image/png')
                }
            })
        });
        const result = await readApiResponse(response);
        session.diaryPublication = {
            remoteId: String(result.diaryEntryId),
            externalId: String(result.intelligentGolfEventId ?? ''),
            operation: String(result.operation ?? 'saved'),
            eventDate: String(result.eventDate ?? session.form.eventDate),
            updatedAt: new Date().toISOString()
        };
        elements.shareMessage.textContent = `“${session.form.diaryTitle}” is now advertised in the member diary for ${session.form.eventDate}. Sending it again will update the same entry.`;
        configureShareConnections(session);
        setWorkflowStep(session, 4, true);
        await persistSession(session);
        elements.diaryDialog.close();
    } catch (error) {
        const message = formatMemberDiaryFailure(error);
        elements.shareMessage.textContent = message;
        elements.diaryDialogMessage.textContent = message;
        elements.diaryDialogMessage.className = 'poster-publish-dialog-message error';
        elements.diaryDialogConfirm.textContent = 'Try again';
        elements.diaryDialogConfirm.disabled = false;
    } finally {
        elements.shareDiaryButton.disabled = false;
    }
}

function openScreenShareDialog() {
    const session = activeSession;
    if (!session || !elements.publishDialog) return;
    if (session.isPublishingScreens || session.screenPublishOperation?.status === 'sending') return;

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
    elements.publishDialogConfirm.textContent = session.screenPublishOperation?.status === 'failed'
        ? 'Try sending again'
        : session.screenPublication
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
    if (screenConnection.configured && session.screenPublishOperation?.status === 'failed') {
        elements.publishDialogMessage.textContent = session.screenPublishOperation.error;
        elements.publishDialogMessage.className = 'poster-publish-dialog-message error';
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
    if (!session || session.isPublishingScreens || session.screenPublishOperation?.status === 'sending') return;
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

    const request = {
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
    };

    session.isPublishingScreens = true;
    session.screenPublishOperation = {
        status: 'sending',
        mediaName: session.form.publishMediaName,
        startDate,
        endDate: eventDate,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        error: ''
    };
    elements.publishDialogConfirm.disabled = true;
    elements.publishDialog?.close();
    renderScreenPublishState(session);
    void persistSession(session);

    try {
        const response = await fetch('/api/poster/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request)
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
            pushConfirmed: screenResult.pushConfirmed === true,
            pushStatus: String(screenResult.pushStatus ?? ''),
            screenCount: Number(screenResult.screenCount || 0),
            uploadConfirmed: screenResult.uploadConfirmed === true,
            mediaSource: String(screenResult.mediaSource ?? ''),
            width: Number(screenResult.width || 0),
            height: Number(screenResult.height || 0),
            updatedAt: new Date().toISOString()
        };
        session.screenPublishOperation = {
            ...session.screenPublishOperation,
            status: 'succeeded',
            updatedAt: new Date().toISOString(),
            error: ''
        };
        const pushMessage = screenResult.pushConfirmed
            ? 'Yodeck confirmed that the screen push completed.'
            : `The screen service accepted the push request; confirmation is still pending${screenResult.pushStatus ? ` (${screenResult.pushStatus})` : ''}.`;
        const uploadMessage = screenResult.uploadConfirmed && screenResult.mediaSource === 'local'
            ? `A ${screenResult.width} × ${screenResult.height} PNG file was uploaded to Yodeck's media library and finished processing.`
            : 'Yodeck did not confirm a completed local file upload.';
        const successMessage = wasUpdated
            ? `“${screenResult.artworkName}” was updated on ${screenResult.destinationName} for ${screenResult.startDate} to ${screenResult.endDate}. ${uploadMessage} ${pushMessage}`
            : `“${screenResult.artworkName}” was added to ${screenResult.destinationName} for ${screenResult.startDate} to ${screenResult.endDate}. ${uploadMessage} ${pushMessage}`;
        if (isSessionVisible(session) && elements.shareMessage) {
            elements.shareMessage.textContent = successMessage;
        }

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
    } catch (error) {
        const message = error instanceof Error ? error.message : 'The artwork could not be sent to the clubhouse screens.';
        session.screenPublishOperation = {
            ...session.screenPublishOperation,
            status: 'failed',
            updatedAt: new Date().toISOString(),
            error: message
        };
    } finally {
        session.isPublishingScreens = false;
        renderScreenPublishState(session);
        await persistSession(session);
    }
}

function beginConceptProgress(session) {
    session.errorMessage = null;
    session.progress = {
        concepts: { cssClass: 'active', label: `0 of ${CONCEPT_PREVIEW_COUNT} ready` },
        primary: { cssClass: '', label: 'Waiting' },
        variants: { cssClass: '', label: 'Waiting' },
        compose: { cssClass: '', label: 'Waiting' }
    };

    if (!isSessionVisible(session)) return;
    elements.generationProgress.querySelector('[data-generation-error]')?.remove();
    elements.emptyState.classList.add('hidden');
    elements.generationProgress.classList.remove('hidden');
    for (const [name, progress] of Object.entries(session.progress)) setProgressState(session, name, progress.cssClass, progress.label);
    renderConceptChoices(session);
}

function beginProductionProgress(session) {
    session.errorMessage = null;
    session.progress = {
        concepts: { cssClass: 'complete', label: 'Selected' },
        primary: { cssClass: 'active', label: 'Waiting' },
        variants: { cssClass: '', label: 'Waiting' },
        compose: { cssClass: '', label: 'Waiting' }
    };
    if (!isSessionVisible(session)) return;
    elements.generationProgress.querySelector('[data-generation-error]')?.remove();
    elements.emptyState.classList.add('hidden');
    elements.refinementPanel.classList.add('hidden');
    elements.sharePanel.classList.add('hidden');
    elements.generationProgress.classList.remove('hidden');
    for (const [name, progress] of Object.entries(session.progress)) setProgressState(session, name, progress.cssClass, progress.label);
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
        const phase = session.workflowStep === 2 ? 'Low-resolution concepts are being created' : 'High-quality artwork is being produced';
        elements.generationElapsed.textContent = `Working for ${formatElapsedTime(elapsedSeconds)}. ${phase}.`;
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
    elements.generateButton.disabled = isBusy || Boolean(session.sourceDesign);
    elements.regenerateButton.disabled = isBusy || (session.generationOrigin === 'uploaded-design' && (!session.sourceDesign || session.sourceDesign.available === false));
    if (elements.generateMoreConceptsButton) elements.generateMoreConceptsButton.disabled = isBusy;
    if (elements.produceSelectedConceptButton) {
        elements.produceSelectedConceptButton.disabled = isBusy || !session.selectedConceptId;
    }
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
    updateSourceDesignUi(session);
}

function renderGenerationError(session) {
    if (!isSessionVisible(session) || !session.errorMessage) return;
    const canRetryMissingFormats = session.generationOrigin === 'uploaded-design'
        ? Boolean(session.sourceDesign?.artworkSource) && session.sourceDesign.available !== false && getMissingSourceDesignOutputs(session).length > 0
        : Boolean(session.primaryArtworkDataUrl) && getMissingVariantOutputs(session).length > 0;
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
