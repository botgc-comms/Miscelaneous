import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const playbookSource = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook-app.js', import.meta.url),
  'utf8');
const styleSource = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook.css', import.meta.url),
  'utf8');
const serverSource = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/Program.cs', import.meta.url),
  'utf8');

function functionSource(name) {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = declaration.exec(playbookSource);
  assert.ok(match, `Expected ${name}() to be declared.`);
  const nextDeclaration = /\n\s*(?:async\s+)?function\s+[A-Za-z0-9_$]+\s*\(/g;
  nextDeclaration.lastIndex = match.index + match[0].length;
  const next = nextDeclaration.exec(playbookSource);
  return playbookSource.slice(match.index, next?.index ?? playbookSource.length);
}

test('event attachments use a responsive preview tile gallery', () => {
  const renderer = functionSource('renderEventFiles');
  const preview = functionSource('eventFilePreviewMarkup');
  assert.match(renderer, /class="event-files-grid"/);
  assert.match(renderer, /class="event-file-card"/);
  assert.match(preview, /<img[^>]+data-event-file-preview/);
  assert.match(preview, /\?preview=true/);
  assert.match(styleSource, /\.event-files-grid\s*\{[^}]*repeat\(auto-fill,minmax\(/s);
  assert.match(styleSource, /\.event-file-preview\.image img\s*\{[^}]*object-fit:\s*cover/s);
});

test('documents receive recognisable fallback tiles while downloads remain separate', () => {
  const kind = functionSource('eventFileKind');
  const preview = functionSource('eventFilePreviewMarkup');
  assert.match(kind, /PDF document/);
  assert.match(kind, /Word document/);
  assert.match(kind, /Spreadsheet/);
  assert.match(kind, /Presentation/);
  assert.match(preview, /event-file-document-sheet/);
  assert.match(functionSource('renderEventFiles'), /href="\$\{escapeHtml\(downloadUrl\)\}" download=/);
});

test('the server permits inline previews only for explicitly safe raster images', () => {
  assert.match(serverSource, /preview is true && EventFileStore\.IsSafeImagePreviewContentType/);
  assert.match(serverSource, /Content-Security-Policy/);
  assert.match(serverSource, /asset\.Metadata\.FileName,[\s\S]*enableRangeProcessing: true/);
});
