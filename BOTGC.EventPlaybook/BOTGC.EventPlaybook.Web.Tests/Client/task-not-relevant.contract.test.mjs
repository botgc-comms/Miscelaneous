import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook-app.js', import.meta.url),
  'utf8');
const css = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook.css', import.meta.url),
  'utf8');

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

test('not relevant is a reversible task disposition that clears active completion and reminders', () => {
  const taskState = {
    completed: true,
    completedAt: '2026-09-20T09:00:00.000Z',
    completionToken: 'old-token',
    notificationStatus: 'queued',
    reviewSignature: 'old-review',
    reviewInvalidatedAt: '2026-09-19T09:00:00.000Z'
  };
  const state = {
    notificationOutbox: [
      { eventId: 'event-1', taskId: 'task-1', status: 'queued' },
      { eventId: 'event-1', taskId: 'task-1', status: 'sent' }
    ]
  };
  const taskBoardSelection = { taskIds: new Set(['task-1']) };
  let rotations = 0;
  const markTaskNotRelevant = compileFunction('markTaskNotRelevant', {
    ensureTaskState: () => taskState,
    rotateTaskCompletionLink: value => {
      rotations += 1;
      value.completionToken = 'new-token';
    },
    state,
    taskBoardSelection
  });

  assert.equal(markTaskNotRelevant({ id: 'event-1' }, { id: 'task-1' }, true), true);
  assert.equal(taskState.notRelevant, true);
  assert.equal(taskState.status, 'not-relevant');
  assert.equal(taskState.completed, false);
  assert.equal(taskState.completedAt, null);
  assert.equal(taskState.reviewSignature, null);
  assert.equal(taskState.notificationStatus, 'not-relevant');
  assert.equal(state.notificationOutbox[0].status, 'not-relevant');
  assert.equal(state.notificationOutbox[1].status, 'sent');
  assert.equal(taskBoardSelection.taskIds.has('task-1'), false);

  assert.equal(markTaskNotRelevant({ id: 'event-1' }, { id: 'task-1' }, false), true);
  assert.equal(taskState.notRelevant, false);
  assert.equal(taskState.status, 'open');
  assert.equal(taskState.notificationStatus, null);
  assert.equal(rotations, 2);
});

test('active task queries omit not-relevant work unless the archive explicitly requests it', () => {
  const item = { id: 'task-1', type: 'task', title: 'Example task' };
  const playbook = { modules: [{ sections: [{ items: [item] }] }] };
  const event = { taskState: { 'task-1': { notRelevant: true } } };
  const getActiveTasks = compileFunction('getActiveTasks', {
    playbook,
    isEventIdea: () => false,
    isModuleActive: () => true,
    isItemVisible: () => true,
    buildDontKnowTask: () => null,
    getDueDate: () => null,
    ensureOperationalTaskState: (_event, task) => task.state,
    getTaskExpiryDate: () => null,
    isTaskExpired: () => false
  });

  assert.deepEqual(getActiveTasks(event), []);
  assert.equal(getActiveTasks(event, { includeNotRelevant: true }).length, 1);
});

test('every task presentation exposes the shared not-relevant checkbox and the task board retains a restore view', () => {
  for (const renderer of ['renderInlineTask', 'renderDashboardTaskCard', 'renderTaskBoardCard']) {
    assert.match(functionSource(renderer), /renderTaskNotRelevantControl/);
  }
  assert.match(functionSource('renderTaskNotRelevantControl'), /type="checkbox"/);
  assert.match(functionSource('renderTaskNotRelevantControl'), /data-task-not-relevant-event-id/);
  assert.match(functionSource('renderTaskBoard'), /value: 'not-relevant'/);
  assert.match(functionSource('bindEvents'), /querySelectorAll\('\[data-task-not-relevant\]'\)/);
  assert.match(css, /\.task-not-relevant-control/);
  assert.match(css, /\.task-card\.not-relevant/);
});

test('not-relevant tasks are excluded from event snapshots and downstream active-work projections', () => {
  assert.match(functionSource('getEventTaskSnapshot'), /taskState\.notRelevant === true\) continue/);
  assert.match(functionSource('briefingSourcePayload'), /getActiveTasks\(event\)/);
  assert.match(functionSource('materialiseTaskAlertSchedule'), /getActiveTasks\(event\)/);
  assert.match(functionSource('queueNotification'), /taskState\.notRelevant === true/);
  assert.match(functionSource('applyServerTaskCompletion'), /taskState\.notRelevant === true/);
});
