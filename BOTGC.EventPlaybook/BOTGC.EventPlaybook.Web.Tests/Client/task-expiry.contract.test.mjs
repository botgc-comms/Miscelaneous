import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourcePath = new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook-app.js', import.meta.url);
const source = await readFile(sourcePath, 'utf8');
const completionPage = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/complete.html', import.meta.url),
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

test('the browser evaluates expiry using the Europe/London calendar date', () => {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const currentClubIsoDate = compileFunction('currentClubIsoDate', {
    CLUB_DATE_FORMATTER: formatter,
    Date
  });

  assert.equal(currentClubIsoDate(new Date('2026-06-01T23:30:00Z')), '2026-06-02');
});

test('expiry is computed only after the configured milestone and never expires completed work', () => {
  const getTaskExpiryDate = compileFunction('getTaskExpiryDate', {
    getDueDate: (code) => code === 'DT' ? '2026-09-11' : null
  });
  const isValidIsoDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''));
  const isTaskExpired = compileFunction('isTaskExpired', {
    getTaskExpiryDate,
    isValidIsoDate,
    currentClubIsoDate: () => '2026-09-12'
  });
  const item = { expiresAfterDeadlineCode: 'DT' };

  assert.equal(getTaskExpiryDate(item, {}), '2026-09-11');
  assert.equal(isTaskExpired(item, {}, { completed: false }), true);
  assert.equal(isTaskExpired(item, {}, { completed: false }, '2026-09-12'), false);
  assert.equal(isTaskExpired(item, {}, { completed: true }), false);
  assert.equal(isTaskExpired({}, {}, { completed: false }), false);
});

test('expiry blocks completion and gives the user a specific status', () => {
  const control = compileFunction('taskCompletionControl', {
    taskReviewState: () => null,
    getTaskExpiryDate: () => '2026-09-11',
    isTaskExpired: () => true,
    formatDate: value => value
  })({}, {}, { completed: false });

  assert.equal(control.expired, true);
  assert.equal(control.blocked, true);
  assert.equal(control.label, 'Expired');
  assert.match(control.title, /no longer needs action/i);
});

test('expired work is omitted from dashboards, briefings and alert schedules but retained in task records', () => {
  assert.match(functionSource('dashboardTaskRecords'), /if\s*\(task\.expired\)\s*continue/);
  assert.match(functionSource('briefingSourcePayload'), /filter\(task\s*=>\s*!task\.expired\)/);
  assert.match(functionSource('materialiseTaskAlertSchedule'), /task\.expired/);
  assert.match(functionSource('queueNotification'), /isTaskExpired/);
  assert.match(functionSource('dispatchNotification'), /isExpiredTaskNotification/);
  assert.match(functionSource('renderTaskBoard'), /value:\s*['"]expired['"]/);
  assert.match(functionSource('renderTaskBoardCard'), /no action is required/i);
  assert.match(functionSource('exportTasksCsv'), /task\.expired\s*\?\s*['"]Expired['"]/);
});

test('completion links carry the expiry and present an explicit expired state', () => {
  const registration = functionSource('ensureCompletionLinkRegistration');
  assert.match(registration, /expiresOn\s*=\s*getTaskExpiryDate/);
  assert.match(registration, /expiresOn,/);
  assert.match(completionPage, /<h2>Task expired<\/h2>/);
  assert.match(completionPage, /completion link is no longer active/i);
  assert.match(completionPage, /timeZone:\s*['"]Europe\/London['"]/);
});
