import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const modulePath = new URL('../../BOTGC.EventPlaybook.Web/wwwroot/poster-style-selection.js', import.meta.url);
const source = await readFile(modulePath, 'utf8');
const styleModule = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const { selectDiverseStyleVariationIds, updateStyleVariationHistory } = styleModule;

function variation(id, family, paletteTone, isMixedMedia = false) {
    return { id, name: id, diversityFamily: family, paletteTone, isMixedMedia };
}

test('children book concepts include illustrated and photographic-background treatments from distinct families', () => {
    const style = {
        id: 'childrens-book',
        name: "Children's book",
        variations: [
            variation('seuss-illustrated', 'Dr. Seuss', 'bright'),
            variation('seuss-photo', 'Dr. Seuss', 'bright', true),
            variation('blake-illustrated', 'Quentin Blake', 'balanced'),
            variation('blake-photo', 'Quentin Blake', 'balanced', true),
            variation('sendak-illustrated', 'Maurice Sendak', 'dark'),
            variation('sendak-photo', 'Maurice Sendak', 'dark', true)
        ]
    };

    const selectedIds = selectDiverseStyleVariationIds(style, 3, { random: () => 0.42 });
    const selected = selectedIds.map(id => style.variations.find(item => item.id === id));

    assert.equal(selectedIds.length, 3);
    assert.equal(new Set(selected.map(item => item.diversityFamily)).size, 3);
    assert.ok(selected.some(item => item.isMixedMedia));
    assert.ok(selected.some(item => !item.isMixedMedia));
});

test('recent directions and a second dark palette are avoided when alternatives exist', () => {
    const style = {
        id: 'movie-posters',
        name: 'Movie posters',
        variations: [
            variation('montage-a', 'Drew Struzan', 'dark'),
            variation('montage-b', 'Drew Struzan', 'dark'),
            variation('noir', 'Neon noir', 'dark'),
            variation('bass', 'Saul Bass', 'bright'),
            variation('travel', 'Travel cinema', 'balanced'),
            variation('comic', 'Comic cinema', 'bright')
        ]
    };

    const selectedIds = selectDiverseStyleVariationIds(style, 3, {
        recentIds: ['bass'],
        random: () => 0.25
    });
    const selected = selectedIds.map(id => style.variations.find(item => item.id === id));

    assert.equal(new Set(selected.map(item => item.diversityFamily)).size, 3);
    assert.ok(selected.filter(item => item.paletteTone === 'dark').length <= 1);
    assert.ok(!selectedIds.includes('bass'));
});

test('style history keeps newest unique directions first', () => {
    assert.deepEqual(
        updateStyleVariationHistory(['old-a', 'old-b', 'old-c'], ['new-a', 'old-b'], 4),
        ['new-a', 'old-b', 'old-a', 'old-c']);
});
