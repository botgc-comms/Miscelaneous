import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const playbookSource = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook-app.js', import.meta.url),
  'utf8');
const styleSource = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook.css', import.meta.url),
  'utf8');

function functionSource(name) {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = declaration.exec(playbookSource);
  assert.ok(match, `Expected playbook-app.js to declare ${name}().`);
  const nextDeclaration = /\n\s*(?:async\s+)?function\s+[A-Za-z0-9_$]+\s*\(/g;
  nextDeclaration.lastIndex = match.index + match[0].length;
  const next = nextDeclaration.exec(playbookSource);
  return playbookSource.slice(match.index, next?.index ?? playbookSource.length);
}

test('new catalogue records can be created as events or ideas', () => {
  assert.match(playbookSource, /const EVENT_RECORD_TYPES[\s\S]*event:[\s\S]*idea:/);
  const dialog = functionSource('renderNewEventDialog');
  assert.match(dialog, /id="new-event-record-type"/);
  assert.match(playbookSource, /idea:\s*\{\s*label:\s*'Idea for consideration'/);
  assert.match(functionSource('updateNewEventRecordTypeUi'), /Save idea/);
  assert.match(functionSource('createEvent'), /initialStatus = integrationDetails\.status === 'idea'/);
  assert.match(functionSource('createEvent'), /status: initialStatus/);
  assert.doesNotMatch(functionSource('createEvent'), /recordType,/);
});

test('ideas have a separate catalogue space and cannot leak into operational work', () => {
  const catalogue = functionSource('renderCatalogue');
  assert.match(catalogue, /filter\(isEventIdea\)/);
  assert.match(catalogue, /filter\(event => !isEventIdea\(event\)\)/);
  assert.match(catalogue, /catalogue-ideas-section/);
  assert.match(catalogue, /Ideas/);
  assert.match(functionSource('getActiveTasks'), /if \(isEventIdea\(event\)\) return \[\]/);
  assert.match(functionSource('materialiseTaskAlertSchedule'), /if \(isEventIdea\(event\) \|\| event\.closedAt/);
  assert.match(functionSource('dashboardEvents'), /!isEventIdea\(event\)/);
  assert.match(styleSource, /\.catalogue-ideas-section/);
  assert.match(styleSource, /\.catalogue-idea-card/);
});

test('the catalogue has an explicit ideas filter with record counts', () => {
  const catalogue = functionSource('renderCatalogue');
  const bindings = functionSource('bindEvents');
  assert.match(catalogue, /data-catalogue-filter="all"/);
  assert.match(catalogue, /data-catalogue-filter="events"/);
  assert.match(catalogue, /data-catalogue-filter="ideas"/);
  assert.match(catalogue, /Ideas <strong>\$\{ideas\.length\}<\/strong>/);
  assert.match(catalogue, /No ideas have been recorded yet/);
  assert.match(catalogue, /data-new-record-type="idea"/);
  assert.match(bindings, /state\.catalogueFilter = \['events', 'ideas'\]\.includes\(filter\) \? filter : 'all'/);
  assert.match(bindings, /element\.dataset\.newRecordType === 'idea'/);
  assert.match(styleSource, /\.catalogue-filter-button\.active/);
  assert.match(styleSource, /\.catalogue-ideas-empty-inline/);
});

test('adopting an idea preserves the record and starts provisional planning from an explicit date', () => {
  const adoption = functionSource('adoptIdeaAsEvent');
  assert.match(adoption, /idea\.eventDate = eventDate/);
  assert.match(adoption, /idea\.milestoneDates = defaultMilestoneDates\(eventDate\)/);
  assert.match(adoption, /lifecycle\.status = 'provisional'/);
  assert.match(adoption, /Idea adopted as a provisional event/);
  assert.match(adoption, /state\.activeEventId = idea\.id/);
  assert.match(functionSource('renderAdoptIdeaDialog'), /id="adopt-idea-date" type="date" required/);
  assert.match(functionSource('renderIdeaCatalogueCard'), /Adopt as event/);
});

test('idea is an event lifecycle status and legacy record types migrate to it', () => {
  assert.match(playbookSource, /idea:\s*\{\s*label:\s*'Idea',\s*summary:/);
  const lifecycle = functionSource('normaliseEventLifecycle');
  assert.match(lifecycle, /legacyIdeaRecord = event\.recordType === 'idea'/);
  assert.match(lifecycle, /event\.lifecycle\.status = 'idea'/);
  assert.match(lifecycle, /delete event\.recordType/);
  assert.match(functionSource('migrateIdeaStatusState'), /event\.lifecycle\.status = 'idea'/);
  assert.match(functionSource('applySharedState'), /ideaStatusMigrated = migrateIdeaStatusState\(\)/);
  assert.match(functionSource('isEventIdea'), /event\?\.lifecycle\?\.status === 'idea'/);
  assert.match(functionSource('applyEventStatusChange'), /nextStatus === 'idea'/);
});
