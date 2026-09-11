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

test('shared state exposes a versioned derived task alert schedule', () => {
  const emptyState = functionSource('emptySharedState');
  const normaliseState = functionSource('normaliseSharedState');
  const snapshot = functionSource('getSharedStateSnapshot');
  const merge = functionSource('mergeSharedStates');
  const apply = functionSource('applySharedState');

  assert.match(emptyState, /schemaVersion:\s*6/);
  assert.match(emptyState, /taskAlertSchedule/);
  assert.match(normaliseState, /schemaVersion:\s*6/);
  assert.match(normaliseState, /normaliseTaskAlertSchedule\(candidate\.taskAlertSchedule\)/);
  assert.match(snapshot, /materialiseTaskAlertSchedule\(\)/);
  assert.match(snapshot, /taskAlertSchedule/);
  assert.match(merge, /taskAlertSchedule:\s*mergeChangedValue/);
  assert.match(apply, /state\.taskAlertSchedule\s*=\s*shared\.taskAlertSchedule/);
});

test('the projection contains only actionable active-event tasks and resolves current recipients', () => {
  const projection = functionSource('materialiseTaskAlertSchedule');
  const roleRoute = functionSource('contactForRole');

  assert.match(projection, /event\.closedAt\s*\|\|\s*lifecycle\.status\s*===\s*['"]completed['"]/);
  assert.match(projection, /getActiveTasks\(event\)/);
  assert.match(projection, /task\.state\.completed\s*===\s*true/);
  assert.match(projection, /task\.state\.status\s*===\s*['"]completed['"]/);
  assert.match(projection, /isValidIsoDate\(task\.dueDate\)/);
  assert.match(projection, /const assigneeReference\s*=\s*taskAssignmentReference\(task\.state\)/);
  assert.match(projection, /assignmentRecipient\(assigneeReference\s*\?\?\s*task\.state\.assignee/);
  assert.match(projection, /assignmentRecipient\(event\.organiserRef\s*\?\?\s*event\.organiser/);
  assert.match(projection, /assigneeEmail:\s*assignee\.email\s*\|\|\s*legacyTaskAssigneeEmail/);
  assert.match(projection, /organiserEmail:\s*organiser\.email/);
  assert.match(projection, /canCompleteFromLink:\s*!taskCompletionControl/);
  assert.doesNotMatch(projection, /if\s*\(\s*!task\.state\.assignee\s*\)\s*continue/);
  assert.match(roleRoute, /linkedContact\s*&&\s*linkedContact\.active\s*!==\s*false\s*&&\s*linkedContact\.canReceiveTasks\s*!==\s*false/);
  assert.match(roleRoute, /role\?\.mailboxEmail/);
  assert.match(roleRoute, /role\?\.fallbackRoleId\s*\?\s*contactForRole/);
});

test('each projected task receives one reusable registered completion link', () => {
  const projection = functionSource('materialiseTaskAlertSchedule');
  const queueNotification = functionSource('queueNotification');
  const ensureRegistration = functionSource('ensureCompletionLinkRegistration');
  const registration = functionSource('registerCompletionLink');

  assert.match(projection, /task\.state\.completionToken\s*\|\|=/);
  assert.match(projection, /ensureCompletionLinkRegistration\(event,\s*task\.item,\s*task\.state,\s*task\.dueDate\)/);
  assert.match(projection, /completionToken,/);
  assert.match(projection, /completionPath:\s*`\/complete\.html\?token=\$\{encodeURIComponent\(completionToken\)\}`/);
  assert.match(projection, /taskPath:\s*`\/\?view=tasks&event=\$\{encodeURIComponent\(event\.id\)\}&task=\$\{encodeURIComponent\(task\.item\.id\)\}`/);
  assert.match(projection, /publicBaseUrl\s*=\s*location\.origin/);
  assert.match(queueNotification, /taskState\.completionToken\s*\|\|\s*crypto\.randomUUID\(\)/);
  assert.match(ensureRegistration, /completionLinkRegistrationSignatures/);
  assert.match(ensureRegistration, /completionLinkRegistrationRequests/);
  assert.match(registration, /\/api\/tasks\/completion-links/);
  assert.match(registration, /if\s*\(!response\.ok\)\s*throw/);
});

test('browser rendering no longer dispatches per-task reminders or overdue escalations', () => {
  assert.doesNotMatch(source, /function\s+processReminderRules\s*\(/);
  assert.doesNotMatch(source, /queueNotification\([^\n]+['"]reminder['"]/);
  assert.doesNotMatch(source, /queueNotification\([^\n]+['"]overdue['"]/);
  assert.doesNotMatch(source, /queueNotification\([^\n]+['"]escalation['"]/);
  assert.match(source, /queueNotification\(event,\s*item,\s*['"]assignment['"]\)/);
});

test('task query links select the requested event, horizon and exact task card', () => {
  const applyDeepLink = functionSource('applyRequestedTaskDeepLink');
  const focusDeepLink = functionSource('focusTaskBoardDeepLink');
  const taskCard = functionSource('renderTaskBoardCard');
  const initialiseContext = source.slice(source.indexOf('const params = new URLSearchParams(location.search)'), source.lastIndexOf('render();'));

  assert.match(applyDeepLink, /params\.get\(['"]view['"]\)\s*!==\s*['"]tasks['"]/);
  assert.match(applyDeepLink, /params\.get\(['"]event['"]\)/);
  assert.match(applyDeepLink, /params\.get\(['"]task['"]\)/);
  assert.match(applyDeepLink, /state\.activeEventId\s*=\s*event\.id/);
  assert.match(applyDeepLink, /state\.taskBoardMode\s*=\s*['"]overview['"]/);
  assert.match(applyDeepLink, /state\.taskBoardHorizon\s*=\s*taskHorizon\(task\)/);
  assert.match(taskCard, /data-task-card-id=/);
  assert.match(focusDeepLink, /candidate\.dataset\.taskCardId\s*===\s*taskBoardDeepLinkTarget\.taskId/);
  assert.match(focusDeepLink, /scrollIntoView/);
  assert.match(focusDeepLink, /\.focus\(/);
  assert.match(initialiseContext, /await syncServerCompletions\(\);\s*if \(applyRequestedTaskDeepLink\(params\)\) saveState\(\);/);
});

test('completion links are rotated on reopen or reassignment and stale completions are ignored', () => {
  const markComplete = functionSource('markTaskComplete');
  const assignReference = functionSource('assignTaskToReference');
  const reconcile = functionSource('reconcileTaskReviewCompletion');
  const sync = functionSource('syncServerCompletions');

  assert.match(markComplete, /!completed\s*&&\s*taskState\.completed\s*===\s*true\)\s*rotateTaskCompletionLink/);
  assert.match(assignReference, /rotateTaskCompletionLink\(taskState\)/);
  assert.match(reconcile, /rotateTaskCompletionLink\(taskState\)/);
  assert.match(sync, /taskState\.completionToken\s*!==\s*record\.token/);
});

test('recipient resolution excludes inactive contacts and cached addresses for known people', () => {
  const recipient = functionSource('assignmentRecipient');
  const legacyEmail = functionSource('legacyTaskAssigneeEmail');
  const contactEmail = functionSource('contactEmailByName');

  assert.match(recipient, /contact\.active\s*!==\s*false\s*&&\s*contact\.canReceiveTasks\s*!==\s*false/);
  assert.match(legacyEmail, /matchesKnownContact/);
  assert.match(legacyEmail, /matchesKnownContact\s*\?\s*['"]['"]\s*:/);
  assert.match(contactEmail, /contact\.active\s*!==\s*false\s*&&\s*contact\.canReceiveTasks\s*!==\s*false/);
});
