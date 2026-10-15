import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const completeHtml = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/complete.html', import.meta.url),
  'utf8'
);
const completeCss = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/complete.css', import.meta.url),
  'utf8'
);
const programSource = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/Program.cs', import.meta.url),
  'utf8'
);
const playbookAppSource = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook-app.js', import.meta.url),
  'utf8'
);
const emailSource = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/Services/TaskEmailAlertService.cs', import.meta.url),
  'utf8'
);

function functionSource(source, name) {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = declaration.exec(source);
  assert.ok(match, `Expected ${name}().`);
  const followingDeclaration = /\n  (?:async\s+)?function\s+[A-Za-z0-9_$]+\s*\(/g;
  followingDeclaration.lastIndex = match.index + match[0].length;
  const next = followingDeclaration.exec(source);
  return source.slice(match.index, next?.index ?? source.length);
}

test('task alert links use a recipient-scoped email workspace for every task type', () => {
  assert.match(emailSource, /RegisterEmailAccessAsync/);
  assert.match(emailSource, /complete\.html\?access=.*&task=/);
  assert.doesNotMatch(emailSource, /item\.Task\.CanCompleteFromLink\s*\?\s*item\.Task\.CompletionPath/);
});

test('the public completion page lists only tasks returned by its email access token', () => {
  assert.match(completeHtml, /\/api\/tasks\/email-access\/\$\{encodeURIComponent\(accessToken\)\}/);
  assert.match(completeHtml, /You can open only the tasks included in this email/);
  assert.match(completeHtml, /completion-task-strip/);
  assert.match(completeHtml, /data-task-token/);
  assert.doesNotMatch(completeHtml, /Open task in Event Playbook/);
  assert.match(completeCss, /\.completion-task-strip\s*\{[^}]*grid-auto-flow:\s*column;[^}]*overflow-x:\s*auto;/s);
  assert.match(completeCss, /scroll-snap-type:\s*inline proximity/);
  assert.match(completeCss, /scroll-behavior:\s*auto/);
  assert.match(completeCss, /scroll-snap-align:\s*center/);
  assert.match(completeCss, /@media \(max-width: 560px\)[\s\S]*grid-auto-columns:\s*minmax\(260px, 84vw\)/);
  assert.match(completeCss, /@media \(max-width: 560px\)[\s\S]*\.completion-reassignment-controls\s*\{[^}]*grid-template-columns:\s*1fr;/);
});

test('selecting an email task keeps the strip in place and centres without an animated sweep', () => {
  assert.match(completeHtml, /const previousScrollLeft = previousStrip\?\.scrollLeft \?\? null/);
  assert.match(completeHtml, /strip\.scrollLeft = previousScrollLeft/);
  assert.match(completeHtml, /selectWorkspaceTask\(button\.dataset\.taskToken\)/);
  assert.match(completeHtml, /button\.classList\.toggle\('selected', isSelected\)/);
  assert.match(completeHtml, /selected\.getBoundingClientRect\(\)/);
  assert.match(completeHtml, /strip\.scrollLeft \+ relativeLeft/);
  assert.match(completeHtml, /behavior: 'auto'/);
  assert.doesNotMatch(completeHtml, /behavior: 'smooth'/);
  assert.doesNotMatch(completeHtml, /selected\.offsetLeft/);
});

test('email tasks use scoped completion and reassignment actions', () => {
  assert.match(completeHtml, /email-access\/\$\{encodeURIComponent\(accessToken\)\}\/tasks\/\$\{encodeURIComponent\(token\)\}\/\$\{action\}/);
  assert.match(completeHtml, /updateTaskStatus\('complete'\)/);
  assert.match(completeHtml, /updateTaskStatus\('not-applicable'\)/);
  assert.match(completeHtml, /Restore task/);
  assert.match(completeHtml, /Undo completion/);
  assert.match(completeHtml, /tasks\/\$\{encodeURIComponent\(token\)\}\/reopen/);
  assert.match(completeHtml, /task\.notApplicableViaEmailAccess/);
  assert.match(completeHtml, /task\.completedViaEmailAccess/);
  assert.match(completeHtml, /Reassign this task/);
  assert.match(completeHtml, /tasks\/\$\{encodeURIComponent\(task\.token\)\}\/reassign/);
  assert.doesNotMatch(completeHtml, /task\.canCompleteFromLink\s*===\s*false/);
  assert.doesNotMatch(completeHtml, /Needs information/);
});

test('undoing an email action reopens the persisted task in the main playbook', () => {
  assert.match(programSource, /ReopenFromEmailAccessAsync/);
  assert.match(programSource, /record\.ReopenedAtUtc/);
  assert.match(playbookAppSource, /function applyServerTaskReopen/);
  assert.match(playbookAppSource, /taskState\.completed = false/);
  assert.match(playbookAppSource, /taskState\.notRelevant = false/);
  assert.match(playbookAppSource, /if \(record\.reopenedAtUtc\) applyServerTaskReopen/);

  const source = functionSource(playbookAppSource, 'applyServerTaskReopen');
  const applyReopen = Function(`'use strict';\n${source}\nreturn applyServerTaskReopen;`)();
  const taskState = {
    completed: true,
    status: 'completed',
    completedAt: '2026-10-15T08:00:00Z',
    reviewCompletionProvenance: 'email-access',
    notRelevant: false
  };
  assert.equal(applyReopen(taskState, { reopenedAtUtc: '2026-10-15T08:05:00Z' }), true);
  assert.equal(taskState.completed, false);
  assert.equal(taskState.notRelevant, false);
  assert.equal(taskState.status, 'open');

  const newerLocalState = {
    completed: true,
    completedAt: '2026-10-15T08:10:00Z',
    notRelevant: false
  };
  assert.equal(applyReopen(newerLocalState, { reopenedAtUtc: '2026-10-15T08:05:00Z' }), false);
  assert.equal(newerLocalState.completed, true);
});

test('only the narrow email workspace routes bypass site login', () => {
  assert.match(programSource, /IsPublicTaskEmailAccessPath\(context\.Request\)/);
  assert.match(programSource, /HttpMethods\.IsGet\(request\.Method\)/);
  assert.match(programSource, /HttpMethods\.IsPost\(request\.Method\)/);
  assert.match(programSource, /string\.Equals\(segments\[2\], "email-access"/);
  assert.match(programSource, /Guid\.TryParse\(segments\[3\], out _\)/);
  assert.match(programSource, /segments\[6\], "complete"/);
  assert.match(programSource, /segments\[6\], "reassign"/);
  assert.match(programSource, /segments\[6\], "reopen"/);
});
