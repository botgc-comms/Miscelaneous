import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourcePath = new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook-app.js', import.meta.url);
const source = await readFile(sourcePath, 'utf8');
const playbookPath = new URL('../../BOTGC.EventPlaybook.Web/Data/event-playbook.json', import.meta.url);
const playbook = JSON.parse(await readFile(playbookPath, 'utf8'));

function functionSource(name) {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = declaration.exec(source);
  assert.ok(match, `Expected playbook-app.js to declare ${name}().`);
  const followingDeclaration = /\n  (?:async\s+)?function\s+[A-Za-z0-9_$]+\s*\(/g;
  followingDeclaration.lastIndex = match.index + match[0].length;
  const next = followingDeclaration.exec(source);
  return source.slice(match.index, next?.index ?? source.length);
}

function compileFunction(name, dependencies = {}) {
  return Function(
    ...Object.keys(dependencies),
    `'use strict';\n${functionSource(name)}\nreturn ${name};`
  )(...Object.values(dependencies));
}

const items = playbook.modules
  .flatMap(module => module.sections)
  .flatMap(section => section.items);
const byId = new Map(items.map(item => [item.id, item]));

test('golf events choose competition fees, event tickets, free booking or both before downstream questions', () => {
  const route = byId.get('admission-fee-route');
  assert.equal(playbook.schemaVersion, '4.1');
  assert.deepEqual(route.options.map(option => option.value), [
    'no-fee-booking',
    'competition-fee',
    'event-ticket',
    'competition-and-ticket'
  ]);
  assert.deepEqual(route.showWhen.any.map(condition => condition.value), ['competition', 'match']);

  const ticketArrangement = byId.get('admission-arrangements');
  assert.deepEqual(ticketArrangement.showWhen.any[0].value, [
    'no-fee-booking', 'event-ticket', 'competition-and-ticket'
  ]);
});

test('competition-fee planning captures fees, collection route, dates and communications instructions', () => {
  const expectedQuestions = [
    'competition-entry-fee-details',
    'competition-entry-payment-route',
    'competition-entry-open-date',
    'competition-entry-close-date',
    'competition-entry-instructions'
  ];
  for (const id of expectedQuestions) {
    const question = byId.get(id);
    assert.equal(question.type, 'question');
    assert.deepEqual(question.showWhen.all[0].value, ['competition-fee', 'competition-and-ticket']);
  }

  const task = byId.get('configure-competition-entry-task');
  assert.equal(task.defaultOwnerRoleId, 'golf-manager');
  assert.deepEqual(task.reviewSummary.fields.map(field => field.questionId), expectedQuestions);

  const cancellationTask = byId.get('close-competition-entry-after-event-change');
  assert.equal(cancellationTask.defaultOwnerRoleId, 'golf-manager');
  assert.deepEqual(cancellationTask.showWhen.all[1].value, ['competition-fee', 'competition-and-ticket']);
  assert.equal(
    byId.get('resolve-admission-refunds-after-event-change').showWhen.all[2].questionId,
    'admission-fee-route'
  );
});

test('existing golf booking answers seed the new route without guessing competition fees', () => {
  const state = {
    events: [
      { answers: { 'golf-type': 'competition', 'admission-arrangements': 'paid-entry' } },
      { answers: { 'golf-type': 'match', 'admission-arrangements': 'limited-place-booking' } },
      { answers: { 'golf-type': 'none', 'admission-arrangements': 'paid-entry' } },
      { answers: { 'golf-type': 'competition' } }
    ]
  };
  const migrate = compileFunction('migrateAdmissionFeeRouteStateV41', {
    playbook: { schemaVersion: '4.1' },
    itemIndex: new Map([['admission-fee-route', {}]]),
    state
  });

  assert.equal(migrate(), true);
  assert.equal(state.events[0].answers['admission-fee-route'], 'event-ticket');
  assert.equal(state.events[1].answers['admission-fee-route'], 'no-fee-booking');
  assert.equal(state.events[2].answers['admission-fee-route'], undefined);
  assert.equal(state.events[3].answers['admission-fee-route'], undefined);
  assert.ok(state.events.every(event => event.dataMigrations.admissionFeeRouteV41 === true));
  assert.equal(migrate(), false);
});

test('Golf Operations and Bookings expose one shared competition-fee plan', () => {
  const golfNote = byId.get('competition-entry-fee-routing-note');
  assert.equal(golfNote.type, 'note');
  assert.match(golfNote.body, /recorded once/i);
  assert.match(functionSource('renderNote'), /Open shared entry and fee questions/);
  assert.match(functionSource('renderNote'), /data-view="module:admission"/);
  assert.match(functionSource('isItemVisible'), /COMPETITION_FEE_ADMISSION_ITEM_IDS/);
  assert.match(source, /\['competition-entry-fee-details', 'Competition entry fees'\]/);
});

test('a competition-fee-only route suppresses ticket setup without suppressing the shared fee questions', () => {
  const itemIndex = new Map([
    ['competition-entry-fee-details', { module: { id: 'admission' } }],
    ['ig-online-ticketing', { module: { id: 'admission' } }]
  ]);
  const allowed = new Set([
    'admission-fee-route',
    'competition-entry-fee-details',
    'competition-entry-payment-route',
    'competition-entry-open-date',
    'competition-entry-close-date',
    'competition-entry-instructions',
    'configure-competition-entry-task'
  ]);
  const isItemVisible = compileFunction('isItemVisible', {
    pluginCapabilities: { intelligentGolfEnabled: true, mondayEnabled: false, yodeckEnabled: false },
    itemIndex,
    getQuestionValue: (id, event) => event.answers[id],
    COMPETITION_FEE_ADMISSION_ITEM_IDS: allowed,
    conditionMatches: () => true,
    handoverIsRequired: () => true
  });
  const event = { answers: { 'admission-fee-route': 'competition-fee' } };

  assert.equal(isItemVisible({ id: 'competition-entry-fee-details' }, event), true);
  assert.equal(isItemVisible({ id: 'ig-online-ticketing', requiresPlugin: 'intelligentGolf' }, event), false);
});
