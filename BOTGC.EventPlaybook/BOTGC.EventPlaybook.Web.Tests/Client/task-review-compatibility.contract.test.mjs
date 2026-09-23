import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourcePath = new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook-app.js', import.meta.url);
const source = await readFile(sourcePath, 'utf8');
const indexPath = new URL('../../BOTGC.EventPlaybook.Web/wwwroot/index.html', import.meta.url);
const indexSource = await readFile(indexPath, 'utf8');

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
  const dependencyNames = Object.keys(dependencies);
  const dependencyValues = Object.values(dependencies);
  return Function(
    ...dependencyNames,
    `'use strict';\n${functionSource(name)}\nreturn ${name};`
  )(...dependencyValues);
}

test('the operational-controls client script uses its release cache key', () => {
  assert.match(indexSource, /playbook-app\.js\?v=20260923-status-save-1/);
});

test('food review provenance is migrated before task reconciliation and server completion sync', () => {
  const applySharedState = functionSource('applySharedState');
  assert.match(applySharedState, /migrateFoodServiceReviewCompletionState\(\)/);

  const startup = source.slice(source.indexOf('loadInitialPlaybook()'));
  const migrationIndex = startup.indexOf('migrateFoodServiceReviewCompletionState();');
  const sharedStateIndex = startup.indexOf('await initialiseSharedState();');
  const operationalStateIndex = startup.indexOf('initialiseOperationalState();');
  const serverSyncIndex = startup.indexOf('await syncServerCompletions();');
  assert.ok(migrationIndex >= 0, 'Expected startup to migrate food review completion provenance.');
  assert.ok(migrationIndex < sharedStateIndex, 'Expected migration before shared-state snapshot task reconciliation.');
  assert.ok(migrationIndex < operationalStateIndex, 'Expected migration before operational task reconciliation.');
  assert.ok(migrationIndex < serverSyncIndex, 'Expected migration before server completion sync.');

  const createEvent = functionSource('createEvent');
  assert.match(createEvent, /foodServiceReviewCompletionV36:\s*true/);
});

test('the v3.6 migration marks only proven legacy food-task completions', () => {
  const state = {
    events: [
      {
        playbookVersion: '3.5',
        taskState: {
          'external-food-service-liaison-task': { completed: true },
          'food-staff-task': { completed: true },
          'food-service-readiness-task': { completed: true },
          'event-day-food-service-task': { completed: true }
        }
      },
      {
        taskState: {
          'external-food-service-liaison-task': { completed: true },
          'food-staff-task': { completed: true },
          'food-service-readiness-task': { completed: true },
          'event-day-food-service-task': { completed: true }
        }
      },
      {
        playbookVersion: '3.6',
        taskState: {
          'external-food-service-liaison-task': { completed: true },
          'food-staff-task': { completed: true },
          'food-service-readiness-task': { completed: true }
        }
      }
    ]
  };
  const taskIds = [
    'external-food-service-liaison-task',
    'food-staff-task',
    'food-service-readiness-task',
    'event-day-food-service-task'
  ];
  const migrate = compileFunction('migrateFoodServiceReviewCompletionState', {
    FOOD_SERVICE_REVIEW_TASK_IDS_V36: taskIds,
    LEGACY_FOOD_REVIEW_COMPLETION_PROVENANCE: 'pre-v3.6-food-review',
    itemIndex: new Map(taskIds.map(taskId => [taskId, {}])),
    state
  });

  assert.equal(migrate(), true);
  for (const taskId of taskIds) {
    assert.equal(
      state.events[0].taskState[taskId].reviewCompletionProvenance,
      'pre-v3.6-food-review',
      `Expected v3.5 ${taskId} to be grandfathered.`
    );
    assert.equal(
      state.events[1].taskState[taskId].reviewCompletionProvenance,
      'pre-v3.6-food-review',
      `Expected versionless legacy ${taskId} to be grandfathered.`
    );
  }
  assert.equal(state.events[2].taskState['external-food-service-liaison-task'].reviewCompletionProvenance, undefined);
  assert.equal(state.events[2].taskState['food-staff-task'].reviewCompletionProvenance, undefined);
  assert.equal(state.events[2].taskState['food-service-readiness-task'].reviewCompletionProvenance, undefined);
  assert.equal(state.events[0].dataMigrations.foodServiceReviewCompletionV36, true);
  assert.equal(state.events[1].dataMigrations.foodServiceReviewCompletionV36, true);
  assert.equal(state.events[2].dataMigrations.foodServiceReviewCompletionV36, true);
  assert.equal(migrate(), false);
});

test('a marked pre-v3.6 task without a review signature remains completed', () => {
  let rotated = 0;
  const review = { ready: false, signature: 'new-required-answer' };
  const reconcile = compileFunction('reconcileTaskReviewCompletion', {
    taskReviewState: () => review,
    rotateTaskCompletionLink: () => { rotated += 1; },
    LEGACY_FOOD_REVIEW_COMPLETION_PROVENANCE: 'pre-v3.6-food-review'
  });
  const taskState = {
    completed: true,
    status: 'completed',
    completedAt: '2026-09-01T12:00:00.000Z',
    reviewCompletionProvenance: 'pre-v3.6-food-review'
  };

  assert.equal(reconcile({}, {}, taskState), review);
  assert.equal(taskState.completed, true);
  assert.equal(taskState.status, 'completed');
  assert.equal(taskState.completedAt, '2026-09-01T12:00:00.000Z');
  assert.equal(rotated, 0);
});

test('an unproven unsigned completion is not treated as legacy', () => {
  let rotated = 0;
  const reconcile = compileFunction('reconcileTaskReviewCompletion', {
    taskReviewState: () => ({ ready: true, signature: 'current-review' }),
    rotateTaskCompletionLink: () => { rotated += 1; },
    LEGACY_FOOD_REVIEW_COMPLETION_PROVENANCE: 'pre-v3.6-food-review'
  });
  const taskState = {
    completed: true,
    status: 'completed',
    completedAt: '2026-09-14T12:00:00.000Z'
  };

  reconcile({}, {}, taskState);

  assert.equal(taskState.completed, false);
  assert.equal(taskState.status, 'open');
  assert.equal(taskState.reviewSignature, null);
  assert.equal(rotated, 1);
});

test('a ready reviewed task completed through server sync is signed and remains complete', () => {
  let rotated = 0;
  const review = { ready: true, signature: 'current-review' };
  const applyServerCompletion = compileFunction('applyServerTaskCompletion', {
    taskReviewState: () => review,
    rotateTaskCompletionLink: () => { rotated += 1; }
  });
  const taskState = {
    completed: false,
    status: 'open',
    reviewInvalidatedAt: '2026-09-13T12:00:00.000Z',
    reviewCompletionProvenance: 'pre-v3.6-food-review'
  };

  assert.equal(applyServerCompletion({}, {}, taskState, {
    completedAtUtc: '2026-09-14T12:00:00.000Z',
    completionNotes: 'Checked remotely'
  }), true);
  assert.equal(taskState.completed, true);
  assert.equal(taskState.status, 'completed');
  assert.equal(taskState.completedAt, '2026-09-14T12:00:00.000Z');
  assert.equal(taskState.reviewSignature, 'current-review');
  assert.equal(taskState.reviewInvalidatedAt, null);
  assert.equal(taskState.reviewCompletionProvenance, undefined);
  assert.equal(taskState.notes, 'Checked remotely');

  const reconcile = compileFunction('reconcileTaskReviewCompletion', {
    taskReviewState: () => review,
    rotateTaskCompletionLink: () => { rotated += 1; },
    LEGACY_FOOD_REVIEW_COMPLETION_PROVENANCE: 'pre-v3.6-food-review'
  });
  reconcile({}, {}, taskState);
  assert.equal(taskState.completed, true);
  assert.equal(rotated, 0);

  assert.match(functionSource('syncServerCompletions'), /applyServerTaskCompletion\(event,\s*indexed\.item,\s*taskState,\s*record\)/);
});

test('server sync rejects a reviewed task while required answers are incomplete', () => {
  let rotated = 0;
  const applyServerCompletion = compileFunction('applyServerTaskCompletion', {
    taskReviewState: () => ({ ready: false, signature: 'missing-answer' }),
    rotateTaskCompletionLink: () => { rotated += 1; }
  });
  const taskState = {
    completed: false,
    status: 'open',
    completionToken: 'submitted-token'
  };

  assert.equal(applyServerCompletion({}, {}, taskState, {
    completedAtUtc: '2026-09-14T12:00:00.000Z',
    completionNotes: 'Attempted remotely'
  }), false);
  assert.equal(taskState.completed, false);
  assert.equal(taskState.status, 'open');
  assert.equal(taskState.completedAt, undefined);
  assert.equal(taskState.reviewSignature, undefined);
  assert.equal(taskState.notes, undefined);
  assert.equal(rotated, 1);
});

test('a new task cannot be completed until its review is ready', () => {
  const taskState = { completed: false, status: 'open' };
  const markComplete = compileFunction('markTaskComplete', {
    ensureTaskState: () => taskState,
    isTaskExpired: () => false,
    taskReviewState: () => ({ ready: false, signature: 'missing-answer' }),
    rotateTaskCompletionLink: () => assert.fail('A blocked completion must not rotate its link.')
  });

  assert.equal(markComplete({}, { id: 'new-task' }, true), false);
  assert.equal(taskState.completed, false);
  assert.equal(taskState.status, 'open');
  assert.equal(taskState.reviewSignature, undefined);
});

test('a signed completion reopens when required answers are missing or its signature changes', () => {
  for (const review of [
    { ready: false, signature: 'recorded-signature' },
    { ready: true, signature: 'changed-signature' }
  ]) {
    let rotated = 0;
    const reconcile = compileFunction('reconcileTaskReviewCompletion', {
      taskReviewState: () => review,
      rotateTaskCompletionLink: () => { rotated += 1; },
      LEGACY_FOOD_REVIEW_COMPLETION_PROVENANCE: 'pre-v3.6-food-review'
    });
    const taskState = {
      completed: true,
      status: 'completed',
      completedAt: '2026-09-01T12:00:00.000Z',
      reviewSignature: 'recorded-signature'
    };

    reconcile({}, {}, taskState);

    assert.equal(taskState.completed, false);
    assert.equal(taskState.status, 'open');
    assert.equal(taskState.completedAt, null);
    assert.equal(taskState.reviewSignature, null);
    assert.equal(rotated, 1);
  }
});

test('changing a reviewed answer reopens a grandfathered completed task', () => {
  let rotated = 0;
  const playbook = {
    modules: [{
      sections: [{
        items: [{
          id: 'legacy-task',
          type: 'task',
          reviewSummary: { fields: [{ questionId: 'new-review-question' }] }
        }]
      }]
    }]
  };
  const invalidate = compileFunction('invalidateTaskReviewConfirmations', {
    playbook,
    rotateTaskCompletionLink: () => { rotated += 1; }
  });
  const taskState = {
    completed: true,
    status: 'completed',
    completedAt: '2026-09-01T12:00:00.000Z',
    reviewCompletionProvenance: 'pre-v3.6-food-review'
  };
  const event = { taskState: { 'legacy-task': taskState } };

  invalidate(event, 'new-review-question');

  assert.equal(taskState.completed, false);
  assert.equal(taskState.status, 'open');
  assert.equal(taskState.completedAt, null);
  assert.equal(taskState.reviewSignature, null);
  assert.equal(taskState.reviewCompletionProvenance, undefined);
  assert.ok(taskState.reviewInvalidatedAt);
  assert.equal(rotated, 1);
});
