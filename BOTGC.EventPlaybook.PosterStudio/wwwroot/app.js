const state = {
    config: null,
    selectedStyleId: null,
    selectedOutputIds: new Set(),
    primaryArtworkDataUrl: null,
    artworkByOutput: new Map(),
    posterCanvases: new Map(),
    isGenerating: false
};

const elements = {
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

await initialise();

async function initialise() {
    const response = await fetch('/api/poster/config');

    if (!response.ok) {
        throw new Error('Unable to load poster configuration.');
    }

    state.config = await response.json();
    elements.generationMode.textContent = state.config.generationMode === 'openai'
        ? `OpenAI live generation · ${state.config.imageModel} · ${state.config.imageQuality} · creative director ${state.config.promptModel}`
        : `Prototype mock generation · configured for ${state.config.imageModel} · creative director ${state.config.promptModel}`;

    renderEvents();
    renderStyles();
    renderOutputs();
    wireEvents();
    loadSelectedEvent();
}

function renderEvents() {
    for (const event of state.config.events) {
        const option = document.createElement('option');
        option.value = event.id;
        option.textContent = event.name;
        elements.eventSelect.append(option);
    }
}

function renderStyles() {
    state.selectedStyleId = state.config.styles[0].id;
    elements.styleOptions.innerHTML = '';

    for (const style of state.config.styles) {
        const label = document.createElement('label');
        label.className = `style-card${style.id === state.selectedStyleId ? ' selected' : ''}`;
        label.dataset.styleId = style.id;
        label.innerHTML = `
            <input type="radio" name="posterStyle" value="${escapeHtml(style.id)}" ${style.id === state.selectedStyleId ? 'checked' : ''}>
            <strong>${escapeHtml(style.name)}</strong>
            <small>${escapeHtml(style.summary)}</small>`;
        elements.styleOptions.append(label);
    }
}

function renderOutputs() {
    elements.outputOptions.innerHTML = '';

    for (const output of state.config.outputs) {
        if (output.isPrimary) {
            state.selectedOutputIds.add(output.id);
        }

        const selected = true;

        if (selected) {
            state.selectedOutputIds.add(output.id);
        }

        const label = document.createElement('label');
        const squareClass = output.width === output.height ? ' square' : '';
        const primaryClass = output.isPrimary ? ' primary' : '';
        label.className = `output-card${squareClass}${primaryClass}${selected ? ' selected' : ''}`;
        label.dataset.outputId = output.id;
        label.innerHTML = `
            <input type="checkbox" value="${escapeHtml(output.id)}" ${selected ? 'checked' : ''} ${output.isPrimary ? 'disabled' : ''}>
            <span class="format-icon"></span>
            <span class="format-copy">
                <strong>${escapeHtml(output.name)}${output.isPrimary ? ' · Primary' : ''}</strong>
                <small>${escapeHtml(output.purpose)}</small>
            </span>
            <span class="dimensions">${output.width} × ${output.height}</span>`;
        elements.outputOptions.append(label);
    }
}

function wireEvents() {
    elements.eventSelect.addEventListener('change', loadSelectedEvent);

    elements.styleOptions.addEventListener('change', event => {
        const input = event.target.closest('input[name="posterStyle"]');

        if (!input) {
            return;
        }

        state.selectedStyleId = input.value;
        document.querySelectorAll('.style-card').forEach(card => {
            card.classList.toggle('selected', card.dataset.styleId === state.selectedStyleId);
        });
    });

    elements.outputOptions.addEventListener('change', event => {
        const input = event.target.closest('input[type="checkbox"]');

        if (!input) {
            return;
        }

        if (input.checked) {
            state.selectedOutputIds.add(input.value);
        } else {
            state.selectedOutputIds.delete(input.value);
        }

        input.closest('.output-card').classList.toggle('selected', input.checked);
    });

    elements.includeDate.addEventListener('change', () => {
        elements.dateCard.classList.toggle('selected', elements.includeDate.checked);
    });

    elements.includePrice.addEventListener('change', () => {
        elements.priceCard.classList.toggle('selected', elements.includePrice.checked);
        elements.priceField.classList.toggle('hidden', !elements.includePrice.checked);
    });

    elements.publishYodeck.addEventListener('change', () => {
        elements.yodeckCard.classList.toggle('selected', elements.publishYodeck.checked);
    });

    elements.publishEmail.addEventListener('change', () => {
        elements.emailCard.classList.toggle('selected', elements.publishEmail.checked);
    });

    elements.generateButton.addEventListener('click', () => generateCampaign(false));
    elements.regenerateButton.addEventListener('click', () => generateCampaign(true));
    elements.publishButton.addEventListener('click', publishCampaign);
    elements.publishTopButton.addEventListener('click', () => elements.publishPanel.scrollIntoView({ behavior: 'smooth' }));
}

function loadSelectedEvent() {
    const event = getSelectedEvent();
    elements.eventDate.value = event.defaultDate;
    elements.eventDescription.value = event.description;
    elements.price.value = event.defaultPrice ?? '';
    elements.campaignTitle.textContent = event.name;
}

async function generateCampaign(isRegeneration) {
    if (state.isGenerating) {
        return;
    }

    state.isGenerating = true;
    setBusy(true);
    setWorkflowStep(2);
    beginGenerationProgress(isRegeneration);
    elements.campaignTitle.textContent = getSelectedEvent().name;
    setCampaignStatus('Generating', 'generating');

    try {
        const primaryOutput = getPrimaryOutput();
        setProgressState('primary', 'active', isRegeneration ? 'Refining' : 'Generating');
        const primaryResponse = await generatePrimary(isRegeneration);
        state.primaryArtworkDataUrl = primaryResponse.dataUrl;
        state.artworkByOutput.set(primaryOutput.id, primaryResponse.dataUrl);

        setProgressState('compose', 'active', 'Sizing');
        await composeOutput(primaryOutput, primaryResponse.dataUrl);
        renderCampaignResults();
        setProgressState('primary', 'complete', 'Complete');
        setProgressState('compose', 'active', 'Primary ready');

        const variants = getSelectedOutputs().filter(output => !output.isPrimary);
        setWorkflowStep(3);
        setProgressState('variants', 'active', variants.length === 0 ? 'Not selected' : `0 of ${variants.length} ready`);

        if (variants.length > 0) {
            let completedVariants = 0;

            await Promise.all(variants.map(async output => {
                const generatedVariant = await generateVariant(output);
                state.artworkByOutput.set(output.id, generatedVariant.dataUrl);
                await composeOutput(output, generatedVariant.dataUrl);
                completedVariants += 1;
                setProgressState('variants', 'active', `${completedVariants} of ${variants.length} ready`);
                setProgressState('compose', 'active', `${state.posterCanvases.size} ready`);
                renderCampaignResults();
            }));
        }

        setProgressState('variants', 'complete', variants.length === 0 ? 'Skipped' : 'Complete');
        setProgressState('compose', 'complete', 'Complete');
        setCampaignStatus('Ready to review', 'ready');
        setWorkflowStep(3, true);
        elements.refinementPanel.classList.remove('hidden');
        elements.publishPanel.classList.remove('hidden');
        elements.publishTopButton.disabled = false;
    } catch (error) {
        console.error(error);
        setCampaignStatus('Generation failed', 'neutral');
        elements.generationProgress.classList.remove('hidden');
        const message = error instanceof Error ? error.message : 'The artwork could not be generated.';
        elements.generationProgress.insertAdjacentHTML('beforeend', `<div class="progress-row"><span class="progress-icon">!</span><div><strong>Generation stopped</strong><small>${escapeHtml(message)}</small></div><span class="progress-state">Error</span></div>`);
    } finally {
        state.isGenerating = false;
        setBusy(false);
    }
}

async function generatePrimary(isRegeneration) {
    const response = await fetch('/api/poster/generate-primary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            eventId: elements.eventSelect.value,
            styleId: state.selectedStyleId,
            eventDate: elements.eventDate.value,
            description: elements.eventDescription.value,
            includeDate: elements.includeDate.checked,
            includePrice: elements.includePrice.checked,
            price: elements.price.value,
            additionalInstructions: elements.additionalInstructions.value,
            refinementNotes: isRegeneration ? elements.refinementNotes.value : '',
            previousArtworkDataUrl: isRegeneration ? state.primaryArtworkDataUrl : null
        })
    });

    return readApiResponse(response);
}

async function generateVariant(output) {
    const response = await fetch('/api/poster/generate-variant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            eventId: elements.eventSelect.value,
            styleId: state.selectedStyleId,
            outputId: output.id,
            eventDate: elements.eventDate.value,
            description: elements.eventDescription.value,
            primaryArtworkDataUrl: state.primaryArtworkDataUrl,
            includeDate: elements.includeDate.checked,
            includePrice: elements.includePrice.checked,
            price: elements.price.value,
            additionalInstructions: elements.additionalInstructions.value,
            refinementNotes: elements.refinementNotes.value
        })
    });

    return readApiResponse(response);
}

async function readApiResponse(response) {
    const body = await response.json();

    if (!response.ok) {
        throw new Error(body.detail ?? body.error ?? 'The image service returned an error.');
    }

    return body;
}

async function composeOutput(output, artworkDataUrl) {
    const canvas = await createFinishedPoster(output, artworkDataUrl);
    state.posterCanvases.set(output.id, canvas);
    return canvas;
}

async function createFinishedPoster(output, artworkDataUrl) {
    const canvas = document.createElement('canvas');
    canvas.width = output.width;
    canvas.height = output.height;
    const context = canvas.getContext('2d');
    const image = await loadImage(artworkDataUrl);

    drawImageCover(context, image, canvas.width, canvas.height);

    return canvas;
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

function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('The generated artwork could not be loaded.'));
        image.src = dataUrl;
    });
}

function renderCampaignResults() {
    elements.emptyState.classList.add('hidden');
    elements.generatedArtworkPanel.classList.remove('hidden');
    elements.posterResults.classList.remove('hidden');
    elements.posterResults.innerHTML = '';

    const readyCount = getSelectedOutputs().filter(output => state.posterCanvases.has(output.id)).length;
    const selectedCount = getSelectedOutputs().length;
    elements.generatedArtworkCount.textContent = `${readyCount} of ${selectedCount} ready`;
    elements.generatedArtworkCount.className = `status-pill ${readyCount === selectedCount ? 'ready' : 'generating'}`;

    const primaryOutput = getPrimaryOutput();
    const primaryCanvas = state.posterCanvases.get(primaryOutput.id);

    if (primaryCanvas) {
        const feature = document.createElement('article');
        feature.className = 'poster-feature';
        feature.append(primaryCanvas);
        feature.append(createPosterFooter(primaryOutput, primaryCanvas));
        elements.posterResults.append(feature);
    }

    const variantOutputs = getSelectedOutputs().filter(output => !output.isPrimary && state.posterCanvases.has(output.id));

    if (variantOutputs.length > 0) {
        const grid = document.createElement('div');
        grid.className = 'variant-grid';

        for (const output of variantOutputs) {
            const canvas = state.posterCanvases.get(output.id);
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
        downloadCanvas(canvas, `${slugify(getSelectedEvent().name)}-${output.id}.png`);
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
    const assets = getSelectedOutputs()
        .filter(output => state.posterCanvases.has(output.id))
        .map(output => ({ outputId: output.id, name: output.name }));

    elements.publishButton.disabled = true;
    elements.publishMessage.textContent = 'Publishing selected artwork…';

    try {
        const response = await fetch('/api/poster/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                eventName: getSelectedEvent().name,
                assets,
                publishToYodeck: elements.publishYodeck.checked,
                publishByEmail: elements.publishEmail.checked
            })
        });
        const result = await readApiResponse(response);
        elements.publishMessage.textContent = `${result.assets} campaign asset${result.assets === 1 ? '' : 's'} accepted. ${result.yodeck} ${result.email}`;
        setWorkflowStep(4, true);
    } catch (error) {
        elements.publishMessage.textContent = error instanceof Error ? error.message : 'Publishing failed.';
    } finally {
        elements.publishButton.disabled = false;
    }
}

function beginGenerationProgress(isRegeneration) {
    elements.emptyState.classList.add('hidden');
    elements.refinementPanel.classList.add('hidden');
    elements.generationProgress.classList.remove('hidden');

    if (!isRegeneration) {
        state.artworkByOutput.clear();
        state.posterCanvases.clear();
        elements.posterResults.innerHTML = '';
        elements.generatedArtworkPanel.classList.add('hidden');
        elements.generatedArtworkCount.textContent = '0 ready';
        elements.generatedArtworkCount.className = 'status-pill neutral';
    } else if (state.posterCanvases.size > 0) {
        elements.generatedArtworkPanel.classList.remove('hidden');
    }

    document.querySelectorAll('.progress-row').forEach(row => {
        row.classList.remove('active', 'complete');
        const stateLabel = row.querySelector('.progress-state');

        if (stateLabel) {
            stateLabel.textContent = 'Waiting';
        }
    });
}

function setProgressState(name, cssClass, label) {
    const row = document.querySelector(`[data-progress="${name}"]`);

    if (!row) {
        return;
    }

    row.classList.remove('active', 'complete');
    row.classList.add(cssClass);
    row.querySelector('.progress-state').textContent = label;
}

function setCampaignStatus(text, mode) {
    elements.campaignStatus.textContent = text;
    elements.campaignStatus.className = `status-pill ${mode}`;
}

function setWorkflowStep(step, complete = false) {
    document.querySelectorAll('.workflow-step').forEach(item => {
        const itemStep = Number(item.dataset.step);
        item.classList.toggle('active', itemStep === step && !complete);
        item.classList.toggle('complete', itemStep < step || (itemStep === step && complete));
    });
}

function setBusy(isBusy) {
    elements.generateButton.disabled = isBusy;
    elements.regenerateButton.disabled = isBusy;
    document.body.classList.toggle('busy', isBusy);
}

function getSelectedEvent() {
    return state.config.events.find(event => event.id === elements.eventSelect.value);
}

function getSelectedStyle() {
    return state.config.styles.find(style => style.id === state.selectedStyleId);
}

function getPrimaryOutput() {
    return state.config.outputs.find(output => output.isPrimary);
}

function getSelectedOutputs() {
    return state.config.outputs.filter(output => state.selectedOutputIds.has(output.id));
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
