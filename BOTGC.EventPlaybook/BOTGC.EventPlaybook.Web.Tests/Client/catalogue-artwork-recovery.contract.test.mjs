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
  assert.match(recovery, /isDurableCatalogueArtworkSource\(recovered\.source\)/);
  assert.match(recovery, /target\.cataloguePosterThumbnail = recovered\.source/);
  assert.match(recovery, /target\.publishedCataloguePosterThumbnail = recovered\.source/);
  assert.match(recovery, /target\.cataloguePosterRecoveredAt/);
  assert.match(scheduling, /catalogueArtworkNeedsRecovery\(event\)/);
  assert.match(scheduling, /saveState\(\)/);
  assert.match(catalogue, /scheduleMissingCatalogueArtworkRecovery\(\[\.\.\.ideas, \.\.\.sortedEvents\]\)/);
});

test('catalogue recovery upgrades browser-only inline thumbnails as well as missing artwork', () => {
  const needsRecovery = Function(
    `'use strict';\n${functionSource('isDurableCatalogueArtworkSource')}\n${functionSource('catalogueArtworkNeedsRecovery')}\nreturn catalogueArtworkNeedsRecovery;`
  )();

  assert.equal(needsRecovery({}), true);
  assert.equal(needsRecovery({ cataloguePosterThumbnail: 'data:image/jpeg;base64,old-browser-copy' }), true);
  assert.equal(needsRecovery({ publishedCataloguePosterThumbnail: 'data:image/jpeg;base64,old-published-copy' }), true);
  assert.equal(needsRecovery({ cataloguePosterThumbnail: '/api/poster/artwork?key=event-1&outputId=social&version=1' }), false);
});

test('newly completed artwork gives the catalogue a durable server reference', async () => {
  const posterSource = await readFile(
    new URL('../../BOTGC.EventPlaybook.Web/wwwroot/poster-app.js', import.meta.url),
    'utf8');

  assert.match(posterSource, /const catalogueArtworkSource = isPersistedArtworkSource\(storedArtworkSource\)/);
  assert.match(posterSource, /generationContext\.onArtworkReady\(catalogueArtworkSource/);
  assert.match(posterSource, /generationContext\.onSquareArtworkReady\(catalogueArtworkSource/);
  assert.match(posterSource, /session\.context\.onArtworkPublished\(catalogueArtworkSource/);
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
