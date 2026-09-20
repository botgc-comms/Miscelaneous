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

test('every task presentation exposes the shared Add or Edit note action', () => {
  assert.match(functionSource('renderInlineTask'), /renderTaskNoteAction\(item, event, taskState\)/);
  assert.match(functionSource('renderDashboardTaskCard'), /renderTaskNoteAction\(item, event, taskState\)/);
  assert.match(functionSource('renderTaskBoardCard'), /renderTaskNoteAction\(item, event, taskState\)/);
  assert.match(functionSource('renderTaskNoteAction'), /hasNote \? 'Edit note' : 'Add note'/);
});

test('the task note dialog explains and persists its shared planning purpose', () => {
  const dialog = functionSource('renderTaskNoteDialog');
  assert.match(dialog, /Shared planning context/);
  assert.match(dialog, /exported task data and briefing source/);
  assert.match(source, /taskState\.notesUpdatedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(source, /data-task-note-action/);
});

test('task notes participate in briefing invalidation and generation', () => {
  const payload = functionSource('briefingSourcePayload');
  assert.match(payload, /notes:\s*String\(task\.state\.notes/);
  assert.match(functionSource('briefingFingerprint'), /briefing-v3/);
});
