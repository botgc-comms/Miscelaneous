import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const modulePath = new URL('../../BOTGC.EventPlaybook.Web/wwwroot/poster-session-state.js', import.meta.url);
const source = await readFile(modulePath, 'utf8');
const stateModule = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const { chooseNewestStoredSession, conceptsForGeneration, getSessionContentTimestamp } = stateModule;

function storedSession(generationId, generatedAt, overrides = {}) {
    return {
        savedAt: generatedAt,
        generationSnapshot: { id: generationId, generatedAt },
        concepts: [],
        artworkByOutput: {},
        ...overrides
    };
}

test('a mount-time save cannot make an old concept generation newer', () => {
    const oldBrowser = storedSession('batch-1', '2026-09-09T09:00:00.000Z', {
        savedAt: '2026-09-09T12:00:00.000Z',
        contentUpdatedAt: '2026-09-09T12:00:00.000Z'
    });
    const latestServer = storedSession('batch-2', '2026-09-09T10:00:00.000Z', {
        savedAt: '2026-09-09T10:01:00.000Z',
        contentUpdatedAt: '2026-09-09T10:01:00.000Z'
    });

    assert.equal(chooseNewestStoredSession(latestServer, oldBrowser), latestServer);
});

test('the more complete copy wins within the same generation', () => {
    const server = storedSession('batch-2', '2026-09-09T10:00:00.000Z', {
        concepts: [{ id: 'concept-1', generationId: 'batch-2', artworkSource: null }]
    });
    const browser = storedSession('batch-2', '2026-09-09T10:00:00.000Z', {
        concepts: [{ id: 'concept-1', generationId: 'batch-2', artworkSource: 'data:image/png;base64,new' }]
    });

    assert.equal(chooseNewestStoredSession(server, browser), browser);
});

test('restoration rejects concepts belonging to a different batch', () => {
    const concepts = [
        { id: 'concept-1', generationId: 'batch-1' },
        { id: 'concept-2', generationId: 'batch-2' },
        { id: 'concept-3', generationId: 'batch-1' }
    ];

    assert.deepEqual(conceptsForGeneration(concepts, 'batch-2'), [concepts[1]]);
});

test('the catalogue generation identifies the matching saved studio session', () => {
    const server = storedSession('batch-1', '2026-09-09T11:00:00.000Z');
    const browser = storedSession('batch-2', '2026-09-09T10:00:00.000Z');

    assert.equal(chooseNewestStoredSession(server, browser, 'batch-2'), browser);
});

test('legacy records use generation time instead of a later storage timestamp', () => {
    const legacy = storedSession('batch-1', '2026-09-09T09:00:00.000Z', {
        savedAt: '2026-09-09T12:00:00.000Z'
    });

    assert.equal(getSessionContentTimestamp(legacy), Date.parse('2026-09-09T09:00:00.000Z'));
});
