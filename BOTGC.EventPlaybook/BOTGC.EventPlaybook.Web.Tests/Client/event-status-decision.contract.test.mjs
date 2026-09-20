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

const targetSignature = compileFunction('eventStatusNotificationTargetSignature');
const emptyTargets = { recipients: [], missingEmail: [] };
const emptyTargetSignature = targetSignature(emptyTargets);
const notifiableStatuses = new Set(['confirmed', 'at-risk', 'postponed', 'cancelled']);

function buildSatisfiedEvent(status, overrides = {}) {
  const changedAt = overrides.changedAt ?? '2026-09-10T12:00:00.000Z';
  return {
    eventDate: '2026-09-30',
    taskState: {},
    lifecycle: {
      status,
      resolvedFromAtRisk: overrides.resolvedFromAtRisk === true,
      statusChangedAt: changedAt,
      statusNotification: {
        id: 'notice-1',
        status,
        statusChangedAt: changedAt,
        targetSignature: emptyTargetSignature,
        deliveryStatus: 'not-required',
        pendingRecipientCount: 0
      }
    },
    ...overrides
  };
}

function compileStatusSatisfaction(overrides = {}) {
  return compileFunction('eventStatusDecisionIsSatisfied', {
    normaliseEventLifecycle: event => event.lifecycle,
    getTaskExpiryDate: () => null,
    clubIsoDateFromTimestamp: value => String(value ?? '').substring(0, 10),
    isValidIsoDate: value => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')),
    currentClubIsoDate: () => '2026-09-16',
    NOTIFIABLE_EVENT_STATUSES: notifiableStatuses,
    eventStatusNotificationTargets: () => emptyTargets,
    eventStatusNotificationTargetSignature: targetSignature,
    ...overrides
  });
}

test('go-ahead and at-risk resolution tasks retain the correct decision history', () => {
  const isSatisfied = compileStatusSatisfaction();
  const goAhead = { id: 'confirm-event-before-commitments', completionMode: 'event-status-decision' };
  const resolution = { id: 'resolve-at-risk-event', completionMode: 'event-status-decision' };

  assert.equal(isSatisfied(goAhead, buildSatisfiedEvent('confirmed')), true);
  for (const status of ['provisional', 'at-risk', 'postponed', 'cancelled']) {
    assert.equal(isSatisfied(goAhead, buildSatisfiedEvent(status)), false,
      `Expected ${status} not to satisfy the go-ahead task.`);
  }

  assert.equal(isSatisfied(resolution, buildSatisfiedEvent('postponed')), true);
  assert.equal(isSatisfied(resolution, buildSatisfiedEvent('cancelled')), true);
  assert.equal(isSatisfied(resolution, buildSatisfiedEvent('confirmed', { resolvedFromAtRisk: true })), true,
    'Confirming an at-risk event should complete the resolution task, not the original go-ahead task.');
  for (const status of ['provisional', 'at-risk', 'confirmed']) {
    assert.equal(isSatisfied(resolution, buildSatisfiedEvent(status)), false,
      `Expected ${status} not to satisfy the at-risk resolution task.`);
  }

  const statusChangeSource = functionSource('applyEventStatusChange');
  assert.match(statusChangeSource, /previousStatus\s*===\s*['"]at-risk['"]/);
  assert.match(statusChangeSource, /lifecycle\.resolvedFromAtRisk\s*=/);
});

test('a changed recipient signature makes a sent update retryable and dispatchable', async () => {
  const newTargets = {
    recipients: [{ name: 'Paul Fox', email: 'paul@example.test', areas: ['Food & Beverage'] }],
    missingEmail: []
  };
  const event = {
    id: 'event-1',
    name: 'Autumn social',
    eventDate: '2026-09-30',
    lifecycle: {
      status: 'confirmed',
      statusChangedAt: '2026-09-10T12:00:00.000Z',
      decisionOwner: 'Event organiser',
      reason: 'Approved',
      statusNotification: {
        id: 'notice-1',
        status: 'confirmed',
        statusChangedAt: '2026-09-10T12:00:00.000Z',
        targetSignature: emptyTargetSignature,
        deliveryStatus: 'sent',
        pendingRecipientCount: 0,
        sentRecipientCount: 0,
        alreadySentRecipientCount: 0,
        missingEmail: []
      }
    }
  };

  const renderNotification = compileFunction('renderEventStatusNotification', {
    eventStatusNotificationTargetsChanged: () => true,
    eventStatusNotificationFeedback: () => 'Recipients changed.',
    escapeHtml: value => String(value ?? '')
  });
  const notificationHtml = renderNotification(event.lifecycle.statusNotification, event);
  assert.match(notificationHtml, /data-retry-event-status-notification="event-1"/);
  assert.match(notificationHtml, />Retry update</);

  const requests = [];
  const dispatch = compileFunction('dispatchEventStatusNotification', {
    normaliseEventLifecycle: value => value.lifecycle,
    eventStatusNotificationTargets: () => newTargets,
    eventStatusNotificationTargetSignature: targetSignature,
    isValidIsoDate: value => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')),
    currentClubIsoDate: () => '2026-09-16',
    fetch: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          sentRecipientCount: 1,
          alreadySentRecipientCount: 0,
          pendingRecipientCount: 0,
          deliveries: []
        })
      };
    },
    saveState: () => {},
    render: () => {}
  });

  await dispatch(event);

  assert.equal(requests.length, 1, 'Expected a sent notification with changed recipients to be dispatched again.');
  assert.equal(requests[0].url, '/api/events/status-notifications');
  assert.deepEqual(JSON.parse(requests[0].options.body).recipients, newTargets.recipients);
  assert.equal(event.lifecycle.statusNotification.targetSignature, targetSignature(newTargets));
  assert.equal(event.lifecycle.statusNotification.deliveryStatus, 'sent');
});

test('no selected recipients reaches the explicit not-required terminal state', async () => {
  let fetchCalls = 0;
  const event = buildSatisfiedEvent('confirmed');
  event.lifecycle.statusNotification.deliveryStatus = 'pending';
  event.lifecycle.statusNotification.targetSignature = 'stale';

  const dispatch = compileFunction('dispatchEventStatusNotification', {
    normaliseEventLifecycle: value => value.lifecycle,
    eventStatusNotificationTargets: () => emptyTargets,
    eventStatusNotificationTargetSignature: targetSignature,
    isValidIsoDate: value => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')),
    currentClubIsoDate: () => '2026-09-16',
    fetch: async () => { fetchCalls += 1; throw new Error('No request should be made.'); },
    saveState: () => {},
    render: () => {}
  });

  await dispatch(event);

  assert.equal(fetchCalls, 0);
  assert.equal(event.lifecycle.statusNotification.deliveryStatus, 'not-required');
  assert.ok(event.lifecycle.statusNotification.completedAt);
  assert.equal(event.lifecycle.statusNotification.pendingRecipientCount, 0);
  assert.equal(compileStatusSatisfaction()(
    { id: 'confirm-event-before-commitments', completionMode: 'event-status-decision' },
    event
  ), true);
});

test('expired status-decision rendering is read-only and exposes neither retry nor action controls', () => {
  const renderDelivery = compileFunction('renderTaskStatusDecisionDelivery', {
    isTaskExpired: () => true,
    eventStatusNotificationTargetsChanged: () => true,
    eventStatusNotificationFeedback: () => 'A previous delivery failed.',
    escapeHtml: value => String(value ?? '')
  });
  const event = {
    id: 'event-1',
    taskState: { 'confirm-event-before-commitments': { completed: false } },
    lifecycle: {
      status: 'confirmed',
      statusNotification: { deliveryStatus: 'failed', missingEmail: [] }
    }
  };
  const html = renderDelivery({
    id: 'confirm-event-before-commitments',
    completionMode: 'event-status-decision'
  }, event);

  assert.match(html, /Decision notification retained/);
  assert.doesNotMatch(html, /Retry update|data-retry-event-status-notification/);
  assert.doesNotMatch(html, /data-task-manage-event-status/);

  const cardSource = functionSource('renderTaskBoardCard');
  assert.match(cardSource, /task-card-primary-actions \$\{task\.expired \? 'task-expired-message'/);
  assert.match(cardSource, /task\.expired\s*\?\s*'<span>This task is retained for the event record; no action is required\.<\/span>'/);
  assert.match(cardSource, /:\s*completionControl\.actionRequired\s*\?\s*renderTaskWorkspaceAction/);
});

test('completed status-decision tasks expose no generic completion or repeated status action', () => {
  const renderAction = compileFunction('renderTaskWorkspaceAction', {
    eventStatusDecisionIsSatisfied: () => true,
    escapeHtml: value => String(value ?? '')
  });
  const item = {
    id: 'confirm-event-before-commitments',
    completionMode: 'event-status-decision',
    actionView: 'event-status',
    actionType: 'manage-event-status',
    actionLabel: 'Confirm event is going ahead',
    actionStatus: 'confirmed'
  };

  assert.equal(renderAction(item, { id: 'event-1' }), '');

  const completionSource = functionSource('taskCompletionControl');
  assert.match(completionSource, /const statusManaged = item\.completionMode === 'event-status-decision'/);
  assert.match(completionSource, /blocked = expired \|\| statusManaged/);
  const cardSource = functionSource('renderTaskBoardCard');
  assert.match(cardSource, /completionControl\.statusManaged \? 'task-status-managed-message'/);
  assert.match(cardSource, /completionControl\.statusManaged\s*\?\s*'<span>Completion follows the recorded event status and delivery result\.<\/span>'/);
  assert.doesNotMatch(cardSource, /completionControl\.statusManaged[^]*Reopen task[^]*completionControl\.statusManaged/);
});

test('status decision cutoff uses the Europe/London date of the decision timestamp', () => {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const currentClubIsoDate = compileFunction('currentClubIsoDate', { CLUB_DATE_FORMATTER: formatter, Date });
  const clubIsoDateFromTimestamp = compileFunction('clubIsoDateFromTimestamp', { currentClubIsoDate, Date });
  assert.equal(clubIsoDateFromTimestamp('2026-06-01T23:30:00.000Z'), '2026-06-02');

  const isSatisfied = compileStatusSatisfaction({
    getTaskExpiryDate: () => '2026-06-01',
    clubIsoDateFromTimestamp,
    currentClubIsoDate: () => '2026-06-02'
  });
  const event = buildSatisfiedEvent('confirmed', { changedAt: '2026-06-01T23:30:00.000Z' });

  assert.equal(isSatisfied(
    { id: 'confirm-event-before-commitments', completionMode: 'event-status-decision' },
    event
  ), false, 'A 00:30 BST decision is after the 1 June club-calendar cutoff.');
});

test('disabled event-status completion links are registered as disabled rather than skipped', async () => {
  const registrations = [];
  const registrationSignatures = new Map();
  const registrationRequests = new Map();
  const ensureRegistration = compileFunction('ensureCompletionLinkRegistration', {
    assignmentRecipient: () => ({ name: 'Event organiser', email: 'organiser@example.test' }),
    taskAssignmentReference: () => null,
    getTaskExpiryDate: () => '2026-09-30',
    taskCompletionControl: () => assert.fail('Explicit canCompleteFromLink=false should short-circuit completion control.'),
    priorLearningForItem: () => [],
    legacyTaskAssigneeEmail: () => '',
    completionLinkRegistrationSignatures: registrationSignatures,
    completionLinkRegistrationRequests: registrationRequests,
    registerCompletionLink: async payload => {
      registrations.push(payload);
      return true;
    }
  });
  const event = { id: 'event-1', name: 'Autumn social' };
  const item = {
    id: 'confirm-event-before-commitments',
    title: 'Confirm event go-ahead',
    completionMode: 'event-status-decision',
    canCompleteFromLink: false
  };
  const taskState = {
    completionToken: 'status-token',
    assignee: 'Event organiser'
  };

  ensureRegistration(event, item, taskState, '2026-09-20');
  await Promise.all([...registrationRequests.values()]);

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].token, 'status-token');
  assert.equal(registrations[0].canCompleteFromLink, false);
  assert.equal(registrations[0].expiresOn, '2026-09-30');
});
