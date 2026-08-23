const sessions = new Map();
const REFERENCE_LIBRARY_STORAGE_KEY = 'botgc-event-playbook-reference-library-v1';
const MAX_AUTOMATIC_REFERENCES = 3;
let activeSession = null;
let configCache = null;
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
        isGenerating: false,
        initialised: false,
        customEventName: (context?.eventName ?? '').trim(),
        form: {
            eventId: null,
            eventName: (context?.eventName ?? '').trim(),
            eventDate: context?.eventDate ?? '',
            description: context?.description ?? '',
            includeDate: true,
            includePrice: false,
            price: '',
            additionalInstructions: '',
            refinementNotes: '',
            supportingImages: [],
            useLibraryReferences: true,
            selectedLibraryReferences: []
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
        errorMessage: null,
        generationPromise: null
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

function isSessionVisible(session) {
    return activeSession === session && elements.generateButton && document.body.contains(elements.generateButton);
}

function loadReferenceLibrary() {
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

function scoreReferenceMatch(reference, tokens) {
    const fields = [reference.title, reference.description, reference.category, ...(Array.isArray(reference.tags) ? reference.tags : [])];
    const haystack = tokenise(fields.join(' '));
    let score = Number(reference.priority) || 0;
    for (const token of tokens) {
        if (haystack.has(token)) score += 4;
        if (String(reference.category ?? '').toLocaleLowerCase().includes(token)) score += 2;
    }
    return score;
}

function updateAutomaticReferenceSelection(session) {
    const library = loadReferenceLibrary().filter(item => item.active !== false && item.dataUrl);
    if (!session.form.useLibraryReferences) {
        session.form.selectedLibraryReferences = [];
        renderAutomaticReferenceSelection(session);
        renderSupportingFiles(session);
        return;
    }

    const style = getSelectedStyle(session);
    const tokens = tokenise([
        session.form.eventName,
        session.form.description,
        session.form.additionalInstructions,
        style?.name,
        style?.summary
    ].join(' '));

    session.form.selectedLibraryReferences = library
        .map(reference => ({ reference, score: scoreReferenceMatch(reference, tokens) }))
        .filter(item => item.score > 0)
        .sort((left, right) => right.score - left.score || String(left.reference.title ?? '').localeCompare(String(right.reference.title ?? '')))
        .slice(0, MAX_AUTOMATIC_REFERENCES)
        .map(item => item.reference);

    renderAutomaticReferenceSelection(session);
    renderSupportingFiles(session);
}

function renderAutomaticReferenceSelection(session) {
    if (!elements.automaticReferenceList) return;
    const references = session.form.selectedLibraryReferences ?? [];
    if (references.length === 0) {
        elements.automaticReferenceList.innerHTML = '<div class="supporting-files-empty">No matching library references yet. Add library images or enrich the event brief.</div>';
        return;
    }

    elements.automaticReferenceList.innerHTML = references.map(reference => `
        <article class="automatic-reference-card">
          <img src="${escapeHtml(reference.dataUrl)}" alt="${escapeHtml(reference.title || 'Library image')}">
          <div class="automatic-reference-copy">
            <strong>${escapeHtml(reference.title || 'Library image')}</strong>
            <small>${escapeHtml(reference.category || 'Library reference')} · priority ${escapeHtml(reference.priority ?? 0)}</small>
            <p>${escapeHtml(reference.description || 'Used automatically during image generation.')}</p>
          </div>
        </article>`).join('');
}

function buildSupportingImagesPayload(session) {
    const automatic = session.form.useLibraryReferences !== false
        ? (session.form.selectedLibraryReferences ?? []).map(reference => ({
            fileName: reference.title || 'reference-library-image',
            dataUrl: reference.dataUrl,
            title: reference.title || '',
            description: reference.description || '',
            category: reference.category || '',
            tags: Array.isArray(reference.tags) ? reference.tags : [],
            source: 'library'
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
        eventSelect: document.querySelector('#eventSelect'),
        eventDate: document.querySelector('#eventDate'),
        eventDescription: document.querySelector('#eventDescription'),
        styleOptions: document.querySelector('#styleOptions'),
        includeDate: document.querySelector('#includeDate'),
        includePrice: document.querySelector('#includePrice'),
        dateCard: document.querySelector('#dateCard'),
        priceCard: document.querySelector('#priceCard'),
        priceField: document.querySelector('#priceField'),
        price: document.querySelector('#price'),
        additionalInstructions: document.querySelector('#additionalInstructions'),
        supportingFilesInput: document.querySelector('#supportingFilesInput'),
        useLibraryReferences: document.querySelector('#useLibraryReferences'),
        automaticReferenceList: document.querySelector('#automaticReferenceList'),
        supportingFilesList: document.querySelector('#supportingFilesList'),
        outputOptions: document.querySelector('#outputOptions'),
        generateButton: document.querySelector('#generateButton'),
        generationMode: document.querySelector('#generationMode'),
        campaignTitle: document.querySelector('#campaignTitle'),
        campaignStatus: document.querySelector('#campaignStatus'),
        emptyState: document.querySelector('#emptyState'),
        generationProgress: document.querySelector('#generationProgress'),
        generatedArtworkPanel: document.querySelector('#generatedArtworkPanel'),
        generatedArtworkCount: document.querySelector('#generatedArtworkCount'),
        posterResults: document.querySelector('#posterResults'),
        refinementPanel: document.querySelector('#refinementPanel'),
        refinementNotes: document.querySelector('#refinementNotes'),
        regenerateButton: document.querySelector('#regenerateButton'),
        publishPanel: document.querySelector('#publishPanel'),
        publishYodeck: document.querySelector('#publishYodeck'),
        publishEmail: document.querySelector('#publishEmail'),
        yodeckCard: document.querySelector('#yodeckCard'),
        emailCard: document.querySelector('#emailCard'),
        publishButton: document.querySelector('#publishButton'),
        publishTopButton: document.querySelector('#publishTopButton'),
        publishMessage: document.querySelector('#publishMessage')
    };

    if (!elements.eventSelect || !elements.generateButton) {
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
    if (elements.generationMode) {
        elements.generationMode.textContent = session.config.generationMode === 'openai'
            ? `OpenAI live generation · ${session.config.imageModel} · ${session.config.imageQuality} · creative director ${session.config.promptModel}`
            : `Prototype mock generation · configured for ${session.config.imageModel} · creative director ${session.config.promptModel}`;
    }

    renderEvents(session);
    renderStyles(session);
    renderOutputs(session);

    if (!session.initialised) {
        const matching = session.config.events.find(event => event.name.toLocaleLowerCase() === session.customEventName.toLocaleLowerCase());
        session.form.eventId = matching?.id ?? (session.customEventName ? 'custom-event' : session.config.events[0]?.id);
        elements.eventSelect.value = session.form.eventId;
        seedFormFromSelectedEvent(session);
        if (session.context.eventDate) session.form.eventDate = session.context.eventDate;
        if (session.context.description) session.form.description = session.context.description;
        session.initialised = true;
    }

    applyFormToDom(session);
    updateAutomaticReferenceSelection(session);
    wireEvents(session);
    restoreSessionToDom(session);
}

function renderEvents(session) {
    elements.eventSelect.innerHTML = '';
    for (const event of session.config.events) {
        const option = document.createElement('option');
        option.value = event.id;
        option.textContent = event.name;
        elements.eventSelect.append(option);
    }

    if (session.customEventName && !session.config.events.some(event => event.name.toLocaleLowerCase() === session.customEventName.toLocaleLowerCase())) {
        const option = document.createElement('option');
        option.value = 'custom-event';
        option.textContent = session.customEventName;
        elements.eventSelect.append(option);
    }
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
    elements.eventSelect.addEventListener('change', () => {
        session.form.eventId = elements.eventSelect.value;
        seedFormFromSelectedEvent(session);
        applyFormToDom(session);
        updateAutomaticReferenceSelection(session);
    });

    elements.styleOptions.addEventListener('change', event => {
        const input = event.target.closest('input[name="posterStyle"]');
        if (!input) return;
        session.selectedStyleId = input.value;
        elements.styleOptions.querySelectorAll('.style-card').forEach(card => card.classList.toggle('selected', card.dataset.styleId === session.selectedStyleId));
        updateAutomaticReferenceSelection(session);
    });

    elements.outputOptions.addEventListener('change', event => {
        const input = event.target.closest('input[type="checkbox"]');
        if (!input) return;
        if (input.checked) session.selectedOutputIds.add(input.value); else session.selectedOutputIds.delete(input.value);
        input.closest('.output-card')?.classList.toggle('selected', input.checked);
    });

    const capture = () => captureFormFromDom(session);
    elements.eventDate.addEventListener('change', () => { capture(); updateAutomaticReferenceSelection(session); });
    elements.eventDescription.addEventListener('input', () => { capture(); updateAutomaticReferenceSelection(session); });
    elements.price.addEventListener('input', capture);
    elements.additionalInstructions.addEventListener('input', () => { capture(); updateAutomaticReferenceSelection(session); });
    elements.refinementNotes.addEventListener('input', capture);

    elements.supportingFilesInput?.addEventListener('change', async event => {
        const input = event.target;
        const files = Array.from(input.files ?? []);
        if (files.length === 0) return;
        await addSupportingFiles(session, files);
        input.value = '';
    });

    elements.supportingFilesList?.addEventListener('click', event => {
        const button = event.target.closest('[data-remove-supporting-file]');
        if (!button) return;
        removeSupportingFile(session, button.dataset.removeSupportingFile);
    });

    elements.useLibraryReferences?.addEventListener('change', () => {
        session.form.useLibraryReferences = elements.useLibraryReferences.checked;
        updateAutomaticReferenceSelection(session);
    });

    elements.includeDate.addEventListener('change', () => {
        capture();
        elements.dateCard.classList.toggle('selected', elements.includeDate.checked);
    });
    elements.includePrice.addEventListener('change', () => {
        capture();
        elements.priceCard.classList.toggle('selected', elements.includePrice.checked);
        elements.priceField.classList.toggle('hidden', !elements.includePrice.checked);
    });
    elements.publishYodeck.addEventListener('change', () => elements.yodeckCard.classList.toggle('selected', elements.publishYodeck.checked));
    elements.publishEmail.addEventListener('change', () => elements.emailCard.classList.toggle('selected', elements.publishEmail.checked));

    elements.generateButton.addEventListener('click', () => generateCampaign(session, false));
    elements.regenerateButton.addEventListener('click', () => generateCampaign(session, true));
    elements.publishButton.addEventListener('click', publishCampaign);
    elements.publishTopButton.addEventListener('click', () => elements.publishPanel.scrollIntoView({ behavior: 'smooth' }));
}

function seedFormFromSelectedEvent(session) {
    const event = getSelectedEvent(session);
    session.form.eventId = event.id;
    session.form.eventName = event.id === 'custom-event' ? session.customEventName : event.name;
    session.form.eventDate = session.context.eventDate || event.defaultDate || '';
    session.form.description = session.context.description || event.description || '';
    session.form.price = event.defaultPrice ?? '';
}

function captureFormFromDom(session) {
    if (!isSessionVisible(session)) return;
    session.form.eventId = elements.eventSelect.value;
    session.form.eventName = getCampaignEventName(session);
    session.form.eventDate = elements.eventDate.value;
    session.form.description = elements.eventDescription.value;
    session.form.includeDate = elements.includeDate.checked;
    session.form.includePrice = elements.includePrice.checked;
    session.form.price = elements.price.value;
    session.form.additionalInstructions = elements.additionalInstructions.value;
    session.form.refinementNotes = elements.refinementNotes.value;
    session.form.useLibraryReferences = elements.useLibraryReferences?.checked !== false;
}

function applyFormToDom(session) {
    elements.eventSelect.value = session.form.eventId ?? 'custom-event';
    elements.eventDate.value = session.form.eventDate ?? '';
    elements.eventDescription.value = session.form.description ?? '';
    elements.includeDate.checked = session.form.includeDate !== false;
    elements.includePrice.checked = session.form.includePrice === true;
    elements.price.value = session.form.price ?? '';
    elements.additionalInstructions.value = session.form.additionalInstructions ?? '';
    elements.refinementNotes.value = session.form.refinementNotes ?? '';
    if (elements.useLibraryReferences) {
        elements.useLibraryReferences.checked = session.form.useLibraryReferences !== false;
    }
    if (elements.supportingFilesInput) {
        elements.supportingFilesInput.value = '';
    }
    renderAutomaticReferenceSelection(session);
    renderSupportingFiles(session);
    elements.dateCard.classList.toggle('selected', elements.includeDate.checked);
    elements.priceCard.classList.toggle('selected', elements.includePrice.checked);
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
    elements.publishPanel.classList.toggle('hidden', !session.publishVisible);
    elements.publishTopButton.disabled = !session.publishVisible;
    setBusy(session, session.isGenerating);

    if (session.errorMessage) {
        renderGenerationError(session);
    }
}

async function generateCampaign(session, isRegeneration) {
    if (session.isGenerating) return session.generationPromise;

    captureFormFromDom(session);
    const generationContext = session.context;
    session.isGenerating = true;
    session.errorMessage = null;
    session.refinementVisible = false;
    session.publishVisible = false;
    setBusy(session, true);
    setWorkflowStep(session, 2);
    beginGenerationProgress(session, isRegeneration);
    setCampaignStatus(session, 'Generating', 'generating');

    session.generationPromise = (async () => {
        try {
            const primaryOutput = getPrimaryOutput(session);
            setProgressState(session, 'primary', 'active', isRegeneration ? 'Refining' : 'Generating');
            const primaryResponse = await generatePrimary(session, isRegeneration);
            session.primaryArtworkDataUrl = primaryResponse.dataUrl;
            session.artworkByOutput.set(primaryOutput.id, primaryResponse.dataUrl);

            setProgressState(session, 'compose', 'active', 'Sizing');
            await composeOutput(session, primaryOutput, primaryResponse.dataUrl, generationContext);
            renderCampaignResults(session);
            setProgressState(session, 'primary', 'complete', 'Complete');
            setProgressState(session, 'compose', 'active', 'Primary ready');

            const variants = getSelectedOutputs(session).filter(output => !output.isPrimary);
            setWorkflowStep(session, 3);
            setProgressState(session, 'variants', 'active', variants.length === 0 ? 'Not selected' : `0 of ${variants.length} ready`);

            if (variants.length > 0) {
                let completedVariants = 0;
                await Promise.all(variants.map(async output => {
                    const generatedVariant = await generateVariant(session, output);
                    session.artworkByOutput.set(output.id, generatedVariant.dataUrl);
                    await composeOutput(session, output, generatedVariant.dataUrl, generationContext);
                    completedVariants += 1;
                    setProgressState(session, 'variants', 'active', `${completedVariants} of ${variants.length} ready`);
                    setProgressState(session, 'compose', 'active', `${session.posterCanvases.size} ready`);
                    renderCampaignResults(session);
                }));
            }

            setProgressState(session, 'variants', 'complete', variants.length === 0 ? 'Skipped' : 'Complete');
            setProgressState(session, 'compose', 'complete', 'Complete');
            setCampaignStatus(session, 'Ready to review', 'ready');
            setWorkflowStep(session, 3, true);
            session.refinementVisible = true;
            session.publishVisible = true;
            if (isSessionVisible(session)) {
                elements.refinementPanel.classList.remove('hidden');
                elements.publishPanel.classList.remove('hidden');
                elements.publishTopButton.disabled = false;
            }
        } catch (error) {
            console.error(error);
            session.errorMessage = error instanceof Error ? error.message : 'The artwork could not be generated.';
            setCampaignStatus(session, 'Generation failed', 'neutral');
            renderGenerationError(session);
        } finally {
            session.isGenerating = false;
            session.generationPromise = null;
            setBusy(session, false);
        }
    })();

    return session.generationPromise;
}

async function generatePrimary(session, isRegeneration) {
    const response = await fetch('/api/poster/generate-primary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            eventId: session.form.eventId,
            eventName: session.form.eventName,
            styleId: session.selectedStyleId,
            eventDate: session.form.eventDate,
            description: session.form.description,
            includeDate: session.form.includeDate,
            includePrice: session.form.includePrice,
            price: session.form.price,
            additionalInstructions: session.form.additionalInstructions,
            refinementNotes: isRegeneration ? session.form.refinementNotes : '',
            previousArtworkDataUrl: isRegeneration ? session.primaryArtworkDataUrl : null,
            supportingImages: buildSupportingImagesPayload(session)
        })
    });

    return readApiResponse(response);
}

async function generateVariant(session, output) {
    const response = await fetch('/api/poster/generate-variant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            eventId: session.form.eventId,
            eventName: session.form.eventName,
            styleId: session.selectedStyleId,
            outputId: output.id,
            eventDate: session.form.eventDate,
            description: session.form.description,
            primaryArtworkDataUrl: session.primaryArtworkDataUrl,
            includeDate: session.form.includeDate,
            includePrice: session.form.includePrice,
            price: session.form.price,
            additionalInstructions: session.form.additionalInstructions,
            refinementNotes: session.form.refinementNotes,
            supportingImages: buildSupportingImagesPayload(session)
        })
    });

    return readApiResponse(response);
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
    const automaticFiles = session.form.useLibraryReferences !== false ? (session.form.selectedLibraryReferences ?? []) : [];

    if (manualFiles.length === 0 && automaticFiles.length === 0) {
        elements.supportingFilesList.innerHTML = '<div class="supporting-files-empty">No event-specific supporting images added.</div>';
        return;
    }

    const automaticMarkup = automaticFiles.map(file => `
        <article class="supporting-file-card auto">
          <img src="${escapeHtml(file.dataUrl)}" alt="${escapeHtml(file.title || file.fileName || 'Automatic reference')}">
          <div class="supporting-file-copy">
            <strong>${escapeHtml(file.title || file.fileName || 'Automatic reference')}</strong>
            <small>Auto-selected from the Image Library</small>
          </div>
        </article>`).join('');

    const manualMarkup = manualFiles.map(file => `
        <article class="supporting-file-card">
          <img src="${escapeHtml(file.dataUrl)}" alt="${escapeHtml(file.fileName)}">
          <div class="supporting-file-copy">
            <strong>${escapeHtml(file.fileName)}</strong>
            <small>Uploaded for this event only</small>
          </div>
          <button class="supporting-file-remove" type="button" data-remove-supporting-file="${escapeHtml(file.id)}" aria-label="Remove ${escapeHtml(file.fileName)}">×</button>
        </article>`).join('');

    elements.supportingFilesList.innerHTML = `
        ${automaticFiles.length > 0 ? `<div class="supporting-file-section"><h4>Automatic club references</h4><div class="supporting-file-stack">${automaticMarkup}</div></div>` : ''}
        ${manualFiles.length > 0 ? `<div class="supporting-file-section"><h4>Event-specific uploads</h4><div class="supporting-file-stack">${manualMarkup}</div></div>` : ''}`;
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
        reader.readAsDataURL(file);
    });
}

async function readApiResponse(response) {
    const body = await response.json();

    if (!response.ok) {
        throw new Error(body.detail ?? body.error ?? 'The image service returned an error.');
    }

    return body;
}

async function composeOutput(session, output, artworkDataUrl, generationContext) {
    const canvas = await createFinishedPoster(output, artworkDataUrl);
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

    // Centre-crop any generated format into a proper square thumbnail rather
    // than distorting a portrait poster to fit the catalogue card.
    const sourceRatio = sourceCanvas.width / sourceCanvas.height;
    let sx = 0;
    let sy = 0;
    let sw = sourceCanvas.width;
    let sh = sourceCanvas.height;

    if (sourceRatio > 1) {
        sw = sourceCanvas.height;
        sx = (sourceCanvas.width - sw) / 2;
    } else if (sourceRatio < 1) {
        sh = sourceCanvas.width;
        sy = (sourceCanvas.height - sh) / 2;
    }

    context.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, size, size);
    return canvas.toDataURL('image/jpeg', 0.84);
}

async function createFinishedPoster(output, artworkDataUrl) {
    const canvas = document.createElement('canvas');
    canvas.width = output.width;
    canvas.height = output.height;
    const context = canvas.getContext('2d');
    const image = await loadImage(artworkDataUrl);

    drawArtworkFitted(context, image, canvas.width, canvas.height);

    return canvas;
}

function drawArtworkFitted(context, image, width, height) {
    context.clearRect(0, 0, width, height);

    // Soft club-brand backdrop so we preserve the entire generated poster
    // without centre-cropping away the text at the edges.
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#f4f7f6');
    gradient.addColorStop(1, '#e6efed');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    const fitted = calculateContainRect(image.width, image.height, width, height, 0.94);

    // Optional atmospheric background fill using the same artwork, heavily softened.
    context.save();
    if ('filter' in context) {
        context.filter = 'blur(26px) saturate(88%)';
    }
    context.globalAlpha = 0.18;
    drawImageCover(context, image, width, height);
    context.restore();

    context.save();
    context.fillStyle = 'rgba(255,255,255,0.72)';
    roundRect(context, fitted.x - 10, fitted.y - 10, fitted.width + 20, fitted.height + 20, 18);
    context.fill();
    context.shadowColor = 'rgba(13,53,72,0.12)';
    context.shadowBlur = 30;
    context.shadowOffsetY = 10;
    context.drawImage(image, fitted.x, fitted.y, fitted.width, fitted.height);
    context.restore();
}

function calculateContainRect(sourceWidth, sourceHeight, targetWidth, targetHeight, scaleLimit = 1) {
    const widthScale = targetWidth / sourceWidth;
    const heightScale = targetHeight / sourceHeight;
    const scale = Math.min(widthScale, heightScale) * scaleLimit;
    const width = Math.round(sourceWidth * scale);
    const height = Math.round(sourceHeight * scale);
    const x = Math.round((targetWidth - width) / 2);
    const y = Math.round((targetHeight - height) / 2);
    return { x, y, width, height };
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
        downloadCanvas(canvas, `${slugify(activeSession?.form?.eventName || getSelectedEvent(activeSession).name)}-${output.id}.png`);
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

async function publishCampaign() {
    const session = activeSession;
    const assets = getSelectedOutputs(session)
        .filter(output => session.posterCanvases.has(output.id))
        .map(output => ({ outputId: output.id, name: output.name }));

    elements.publishButton.disabled = true;
    elements.publishMessage.textContent = 'Publishing selected artwork…';

    try {
        const response = await fetch('/api/poster/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                eventName: getCampaignEventName(session),
                assets,
                publishToYodeck: elements.publishYodeck.checked,
                publishByEmail: elements.publishEmail.checked
            })
        });
        const result = await readApiResponse(response);
        elements.publishMessage.textContent = `${result.assets} campaign asset${result.assets === 1 ? '' : 's'} accepted. ${result.yodeck} ${result.email}`;

        const selectedOutputs = getSelectedOutputs(session);
        const squareOutput = selectedOutputs
            .find(output => output.width === output.height && session.posterCanvases.has(output.id));
        const bestOutput = squareOutput
            ?? selectedOutputs.find(output => session.posterCanvases.has(output.id))
            ?? session.config.outputs.find(output => session.posterCanvases.has(output.id));

        if (bestOutput && typeof session.context?.onArtworkPublished === 'function') {
            const bestCanvas = session.posterCanvases.get(bestOutput.id);
            session.context.onArtworkPublished(createCatalogueThumbnail(bestCanvas));
        }

        setWorkflowStep(session, 4, true);
    } catch (error) {
        elements.publishMessage.textContent = error instanceof Error ? error.message : 'Publishing failed.';
    } finally {
        elements.publishButton.disabled = false;
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
    row.classList.remove('active', 'complete');
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

function setBusy(session, isBusy) {
    if (!isSessionVisible(session)) return;
    elements.generateButton.disabled = isBusy;
    elements.regenerateButton.disabled = isBusy;
    document.body.classList.toggle('busy', isBusy);
}

function renderGenerationError(session) {
    if (!isSessionVisible(session) || !session.errorMessage) return;
    elements.generationProgress.classList.remove('hidden');
    elements.generationProgress.querySelector('[data-generation-error]')?.remove();
    elements.generationProgress.insertAdjacentHTML('beforeend', `<div class="progress-row generation-error-row" data-generation-error><span class="progress-icon">!</span><div><strong>Generation stopped</strong><small>${escapeHtml(session.errorMessage)}</small></div><span class="progress-state">Error</span></div>`);
}

function getCampaignEventName(session) {
    const selected = getSelectedEvent(session);
    return selected.id === 'custom-event' && session.customEventName ? session.customEventName : selected.name;
}

function getSelectedEvent(session) {
    const eventId = session?.form?.eventId ?? elements.eventSelect?.value;
    return session.config.events.find(event => event.id === eventId) ?? {
        id: 'custom-event',
        name: session.customEventName || session.form.eventName || 'Current event',
        defaultDate: session.context.eventDate || '',
        description: session.context.description || '',
        defaultPrice: ''
    };
}

function getSelectedStyle(session = activeSession) {
    return session.config.styles.find(style => style.id === session.selectedStyleId);
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
