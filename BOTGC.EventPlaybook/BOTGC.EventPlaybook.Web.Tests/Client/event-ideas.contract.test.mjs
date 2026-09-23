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
  assert.match(functionSource('createEvent'), /recordType === 'idea'/);
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

test('adopting an idea preserves the record and starts provisional planning from an explicit date', () => {
  const adoption = functionSource('adoptIdeaAsEvent');
  assert.match(adoption, /idea\.recordType = 'event'/);
  assert.match(adoption, /idea\.eventDate = eventDate/);
  assert.match(adoption, /idea\.milestoneDates = defaultMilestoneDates\(eventDate\)/);
  assert.match(adoption, /lifecycle\.status = 'provisional'/);
  assert.match(adoption, /Idea adopted as a provisional event/);
  assert.match(adoption, /state\.activeEventId = idea\.id/);
  assert.match(functionSource('renderAdoptIdeaDialog'), /id="adopt-idea-date" type="date" required/);
  assert.match(functionSource('renderIdeaCatalogueCard'), /Adopt as event/);
});
