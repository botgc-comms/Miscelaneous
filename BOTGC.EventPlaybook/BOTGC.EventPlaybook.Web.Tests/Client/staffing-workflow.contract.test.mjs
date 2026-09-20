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
  const followingDeclaration = /\n\s*(?:async\s+)?function\s+[A-Za-z0-9_$]+\s*\(/g;
  followingDeclaration.lastIndex = match.index + match[0].length;
  const next = followingDeclaration.exec(source);
  return source.slice(match.index, next?.index ?? source.length);
}

test('staffing questions can collect a multiline duty allocation', () => {
  const control = functionSource('renderAnswerControl');
  assert.match(control, /case 'textarea'/);
  assert.match(control, /answer-textarea/);
  assert.match(control, /data-question-input/);
});

test('tasks may link to both their planning workspace and the briefing summary', () => {
  const action = functionSource('renderTaskWorkspaceAction');
  assert.match(action, /secondaryActionView/);
  assert.match(action, /secondaryActionLabel/);
  assert.match(action, /actions\.join\(''\)/);
});
