import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/poster-app.js', import.meta.url),
  'utf8');

function functionSource(name) {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = declaration.exec(source);
  assert.ok(match, `Expected poster-app.js to declare ${name}().`);
  const nextDeclaration = /\n\s*(?:async\s+)?function\s+[A-Za-z0-9_$]+\s*\(/g;
  nextDeclaration.lastIndex = match.index + match[0].length;
  const next = nextDeclaration.exec(source);
  return source.slice(match.index, next?.index ?? source.length);
}

test('a restored master artwork remains eligible for retrying missing formats', () => {
  const getRetryableMasterArtworkSource = Function(
    'getPrimaryOutput',
    `'use strict';\n${functionSource('getRetryableMasterArtworkSource')}\nreturn getRetryableMasterArtworkSource;`
  )(() => ({ id: 'digital-screen' }));

  const restoredSource = '/api/poster/artwork?key=event-1&outputId=digital-screen&version=v1';
  const session = {
    primaryArtworkDataUrl: null,
    artworkByOutput: new Map([['digital-screen', restoredSource]])
  };

  assert.equal(getRetryableMasterArtworkSource(session), restoredSource);
});

test('the error renderer and retry action use the same restored-master check', () => {
  assert.match(functionSource('renderGenerationError'), /getRetryableMasterArtworkSource\(session\)/);
  assert.match(functionSource('retryMissingFormats'), /getRetryableMasterArtworkSource\(session\)/);
  assert.match(functionSource('renderGenerationError'), /data-retry-missing-formats/);
});
