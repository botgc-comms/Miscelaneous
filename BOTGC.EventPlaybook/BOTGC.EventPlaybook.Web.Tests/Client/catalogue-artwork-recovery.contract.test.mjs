import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook-app.js', import.meta.url),
  'utf8');

function functionSource(name) {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = declaration.exec(source);
  assert.ok(match, `Expected playbook-app.js to declare ${name}().`);
  const nextDeclaration = /\n\s*(?:async\s+)?function\s+[A-Za-z0-9_$]+\s*\(/g;
  nextDeclaration.lastIndex = match.index + match[0].length;
  const next = nextDeclaration.exec(source);
  return source.slice(match.index, next?.index ?? source.length);
}

test('catalogue cards recover a missing thumbnail from saved Communications Centre artwork', () => {
  const selection = functionSource('selectRecoveredCatalogueArtwork');
  const recovery = functionSource('recoverMissingCatalogueArtwork');
  const scheduling = functionSource('scheduleMissingCatalogueArtworkRecovery');
  const catalogue = functionSource('renderCatalogue');

  assert.match(selection, /\['social', 'clubhouse', 'a4'/);
  assert.match(selection, /storedSession\.selectedConceptId/);
  assert.match(selection, /storedSession\.sourceDesign\?\.artworkSource/);
  assert.match(recovery, /\/api\/poster\/session\?key=/);
  assert.match(recovery, /target\.cataloguePosterThumbnail = recovered\.source/);
  assert.match(recovery, /target\.cataloguePosterRecoveredAt/);
  assert.match(scheduling, /!event\.publishedCataloguePosterThumbnail/);
  assert.match(scheduling, /!event\.cataloguePosterThumbnail/);
  assert.match(scheduling, /saveState\(\)/);
  assert.match(catalogue, /scheduleMissingCatalogueArtworkRecovery\(\[\.\.\.ideas, \.\.\.sortedEvents\]\)/);
});

test('recovery prefers finished square artwork and can fall back to the selected concept', () => {
  const selectRecoveredCatalogueArtwork = Function(
    `'use strict';\n${functionSource('isRecoverableCatalogueArtworkSource')}\n${functionSource('selectRecoveredCatalogueArtwork')}\nreturn selectRecoveredCatalogueArtwork;`
  )();

  const finished = selectRecoveredCatalogueArtwork({
    artworkByOutput: {
      clubhouse: '/api/poster/artwork?key=event-1&outputId=clubhouse',
      social: '/api/poster/artwork?key=event-1&outputId=social'
    },
    generationSnapshot: { id: 'generation-1' }
  });
  assert.equal(finished.outputId, 'social');
  assert.equal(finished.isSquare, true);

  const concept = selectRecoveredCatalogueArtwork({
    selectedConceptId: 'concept-2',
    concepts: [
      { id: 'concept-1', index: 0, artworkSource: '/api/poster/artwork?key=event-1&outputId=concept-1' },
      { id: 'concept-2', index: 1, artworkSource: '/api/poster/artwork?key=event-1&outputId=concept-2' }
    ]
  });
  assert.equal(concept.outputId, 'concept-2');
});
