import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook-app.js', import.meta.url),
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

test('closing or completing an event retires its outstanding local and registered tasks', () => {
  assert.match(functionSource('applyEventStatusChange'), /retireOutstandingEventTasks/);
  assert.match(functionSource('closeEventAndCreateNew'), /retireOutstandingEventTasks/);
  assert.match(functionSource('closeEventAndCreateNew'), /retireRegisteredEventTasks/);
  assert.match(functionSource('reconcileTerminalEventTasks'), /filter\(isTerminalEvent\)/);
  assert.match(source, /await reconcileTerminalEventTasks\(\)/);
  assert.match(functionSource('retireOutstandingEventTasks'), /source:\s*['"]event-closed['"]/);
});

test('reopening restores only tasks automatically retired by event closure', () => {
  const restore = functionSource('restoreTasksRetiredWithEvent');
  assert.match(restore, /notRelevantSource !== ['"]event-closed['"]/);
  assert.match(functionSource('reopenEvent'), /restoreTasksRetiredWithEvent/);
});

test('acting on somebody else task requires and records a textual justification', () => {
  const authorise = functionSource('requestTaskActionJustification');
  assert.match(authorise, /taskOwnedByActor/);
  assert.match(authorise, /reason is required/i);
  assert.match(functionSource('markTaskComplete'), /completionJustification/);
  assert.match(functionSource('markTaskNotRelevant'), /notRelevantReason/);
  assert.match(source, /id="task-action-justification-reason"[^>]*required/);
  assert.match(functionSource('bindEvents'), /completeTaskForCurrentActor/);
  assert.match(functionSource('bindEvents'), /setTaskNotRelevantForCurrentActor/);
});
