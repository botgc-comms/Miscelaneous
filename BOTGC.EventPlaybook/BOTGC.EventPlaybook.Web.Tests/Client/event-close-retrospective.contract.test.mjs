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

test('closing an event checks retrospective answers, task completion and AI finalisation', () => {
  const status = functionSource('getEventClosureRetrospectiveStatus');
  const close = functionSource('closeEventAndCreateNew');

  assert.match(status, /answeredFields\.length === fields\.length/);
  assert.match(status, /taskState\?\.\['complete-retrospective'\]\?\.completed === true/);
  assert.match(status, /finalisedSignature === currentSignature/);
  assert.match(status, /feedbackResponseCount <= summarisedResponseCount/);
  assert.match(close, /await confirmEventClosure\(target\)/);
  assert.match(playbookSource, /value === 'completed'[\s\S]{0,220}await confirmEventClosure\(event\)/);
});

test('partially completed retrospectives can be reviewed, bypassed or finalised before close', () => {
  const dialog = functionSource('renderEventCloseReviewContent');
  const confirmation = functionSource('confirmEventClosure');

  assert.match(dialog, /Close without finishing/);
  assert.match(dialog, /Review retrospective/);
  assert.match(dialog, /Finalise with AI and close/);
  assert.match(confirmation, /ensureFeedbackLoaded\(event\.id\)/);
  assert.match(confirmation, /runRetrospectiveAnalysis\(event, button, \{ finalise: true, renderAfter: false \}\)/);
  assert.match(confirmation, /state\.activeView = 'retrospective'/);
  assert.match(styleSource, /\.event-close-review-dialog/);
});

test('AI finalisation records the exact retrospective version carried into future clones', () => {
  const analysis = functionSource('runRetrospectiveAnalysis');
  const setter = functionSource('setRetrospectiveContentValue');

  assert.match(analysis, /event\.retrospective\.finalisedSignature = retrospectiveFinalisationSignature\(event\)/);
  assert.match(analysis, /sourceType: 'finalised-retrospective'/);
  assert.match(analysis, /targetItemIds: relatedLearningTargetItemIds/);
  assert.match(setter, /contentUpdatedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(playbookSource, /setRetrospectiveContentValue\(event, 'sentimentRating'/);
  assert.match(playbookSource, /setRetrospectiveContentValue\(event, 'aiNarrative'/);
});
