import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourcePath = new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook-app.js', import.meta.url);
const source = await readFile(sourcePath, 'utf8');

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

function buildMigrationState(events) {
  return {
    events,
    notificationOutbox: [
      { taskId: 'set-admission-prices-task' },
      { taskId: 'approve-admission-offer-task' },
      { taskId: 'configure-ticket-sales-task' }
    ]
  };
}

function runMigration(events) {
  const state = buildMigrationState(events);
  const itemIndex = new Map([
    ['admission-arrangements', {}],
    ['admission-price-details', {}]
  ]);
  const migrate = compileFunction('migrateAdmissionModelV38', {
    playbook: { schemaVersion: '3.8' },
    itemIndex,
    hasRecordedQuestionValue: value => value !== undefined && value !== null && value !== '',
    state
  });
  return { changed: migrate(), state };
}

test('v3.8 maps unambiguous booking/payment shapes and flags ambiguous advance booking for review', () => {
  const events = [
    {
      answers: { 'admission-arrangements': ['entry-payment'] },
      taskState: {}
    },
    {
      answers: {
        'admission-arrangements': ['advance-booking'],
        'admission-capacity': 80
      },
      taskState: {}
    },
    {
      answers: { 'admission-arrangements': ['advance-booking'] },
      taskState: {}
    },
    {
      answers: { 'admission-arrangements': ['attendance-registration'] },
      taskState: {}
    }
  ];

  const { changed } = runMigration(events);

  assert.equal(changed, true);
  assert.equal(events[0].answers['admission-arrangements'], 'paid-entry');
  assert.equal(events[1].answers['admission-arrangements'], 'limited-place-booking');
  assert.equal(events[2].answers['admission-arrangements'], undefined,
    'Old advance booking without capacity does not prove whether places were limited.');
  assert.match(events[2].taskState['configure-ticket-sales-task'].notes, /needs review/i);
  assert.equal(events[3].answers['admission-arrangements'], 'attendance-registration');
  for (const event of events) {
    assert.equal(event.dataMigrations.admissionModelV38, true);
  }
});

test('v3.8 preserves ambiguous advance-booking evidence found only in cloned answer hints', () => {
  const event = {
    answers: {},
    clonedAnswerHints: {
      'admission-arrangements': ['advance-booking']
    },
    taskState: {}
  };

  runMigration([event]);

  assert.equal(event.answers['admission-arrangements'], undefined);
  assert.equal(event.clonedAnswerHints['admission-arrangements'], undefined,
    'The retired value must not remain as an invalid answer to the replacement question.');
  assert.match(event.taskState['configure-ticket-sales-task'].notes, /previous admission planning information/i);
  assert.match(event.taskState['configure-ticket-sales-task'].notes, /attendance-only registration or a limited-place reservation/i);
});

test('v3.8 preserves both yes and no legacy complimentary-entry decisions', () => {
  const freeEntryEvent = {
    answers: { 'complimentary-admission': true },
    clonedAnswerHints: { 'complimentary-admission': true },
    taskState: {}
  };
  const fullyPaidEvent = {
    answers: { 'complimentary-admission': false },
    clonedAnswerHints: { 'complimentary-admission': false },
    taskState: {}
  };

  runMigration([freeEntryEvent, fullyPaidEvent]);

  assert.equal(freeEntryEvent.answers['admission-free-entry'], true);
  assert.equal(freeEntryEvent.clonedAnswerHints['admission-free-entry'], true);
  assert.equal(fullyPaidEvent.answers['admission-free-entry'], false);
  assert.equal(fullyPaidEvent.clonedAnswerHints['admission-free-entry'], false);
});

test('v3.8 preserves legacy price notes as the authoritative free-form price answer', () => {
  const event = {
    answers: {
      'admission-arrangements': ['entry-payment'],
      'admission-price-details': 'Adults £30'
    },
    taskState: {
      'set-admission-prices-task': {
        notes: 'Children £15; family ticket £80'
      }
    }
  };

  runMigration([event]);

  assert.match(event.answers['admission-price-details'], /Adults £30/);
  assert.match(event.answers['admission-price-details'], /Children £15; family ticket £80/);
  assert.match(event.answers['admission-price-details'], /Previously recorded ticket prices/);
  assert.equal(event.taskState['set-admission-prices-task'], undefined);
});

test('v3.8 removes retired answers, metadata, task state and queued notifications', () => {
  const event = {
    answers: {
      'admission-arrangements': ['advance-booking'],
      'booking-registration-instructions': 'Bring the receipt',
      'booking-confirmation-process': 'Email from the office',
      'complimentary-admission': true,
      'complimentary-admission-details': 'Juniors enter free'
    },
    clonedAnswerHints: {
      'booking-registration-instructions': 'Old instruction hint',
      'booking-confirmation-process': 'Old confirmation hint',
      'complimentary-admission': true,
      'complimentary-admission-details': 'Old free-entry hint'
    },
    questionMeta: {
      'booking-registration-instructions': { notRelevant: true },
      'booking-confirmation-process': { notRelevant: true }
    },
    taskState: {
      'set-admission-prices-task': { notes: 'Adults £25' },
      'approve-admission-offer-task': { notes: 'Approved by committee' }
    }
  };

  const { state } = runMigration([event]);

  for (const id of ['booking-registration-instructions', 'booking-confirmation-process']) {
    assert.equal(event.answers[id], undefined);
    assert.equal(event.clonedAnswerHints[id], undefined);
    assert.equal(event.questionMeta[id], undefined);
  }
  assert.equal(event.answers['complimentary-admission'], undefined);
  assert.equal(event.answers['complimentary-admission-details'], undefined);
  assert.equal(event.answers['admission-free-entry'], true,
    'Legacy complimentary admission should remain an affirmative free-entry decision.');
  assert.equal(event.clonedAnswerHints['complimentary-admission'], undefined);
  assert.equal(event.clonedAnswerHints['complimentary-admission-details'], undefined);
  assert.equal(event.clonedAnswerHints['admission-free-entry'], true);
  assert.match(event.answers['admission-price-details'], /Juniors enter free/);
  assert.match(event.answers['admission-price-details'], /Adults £25/);
  assert.equal(event.taskState['set-admission-prices-task'], undefined);
  assert.equal(event.taskState['approve-admission-offer-task'], undefined);
  assert.deepEqual(state.notificationOutbox.map(notification => notification.taskId), [
    'configure-ticket-sales-task'
  ]);
});

test('v3.8 migration runs after legacy admission normalisation and new events carry its marker', () => {
  const applySharedState = functionSource('applySharedState');
  const planningIndex = applySharedState.indexOf('migrateAdmissionPlanningState();');
  const modelIndex = applySharedState.indexOf('migrateAdmissionModelV38();');
  const pricingIndex = applySharedState.indexOf('migrateAdmissionPricingState();');

  assert.ok(planningIndex >= 0, 'Expected the legacy admission migration to run.');
  assert.ok(modelIndex > planningIndex, 'Expected v3.8 to consume the normalised legacy admission answer.');
  assert.ok(pricingIndex > modelIndex, 'Expected obsolete pricing migration to be evaluated only after v3.8.');

  const startup = source.slice(source.indexOf('loadInitialPlaybook()'));
  const startupPlanningIndex = startup.indexOf('migrateAdmissionPlanningState();');
  const startupModelIndex = startup.indexOf('migrateAdmissionModelV38();');
  const startupOperationalIndex = startup.indexOf('initialiseOperationalState();');
  assert.ok(startupPlanningIndex >= 0 && startupModelIndex > startupPlanningIndex);
  assert.ok(startupModelIndex < startupOperationalIndex,
    'Expected admission data to be migrated before tasks are materialised.');

  assert.match(functionSource('createEvent'), /admissionModelV38:\s*true/);
});
