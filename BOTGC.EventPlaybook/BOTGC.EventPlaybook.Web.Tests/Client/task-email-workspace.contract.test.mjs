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
const emailSource = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/Services/TaskEmailAlertService.cs', import.meta.url),
  'utf8'
);

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
  assert.match(completeCss, /scroll-snap-type:\s*inline mandatory/);
  assert.match(completeCss, /@media \(max-width: 560px\)[\s\S]*grid-auto-columns:\s*minmax\(260px, 84vw\)/);
  assert.match(completeCss, /@media \(max-width: 560px\)[\s\S]*\.completion-reassignment-controls\s*\{[^}]*grid-template-columns:\s*1fr;/);
});

test('email tasks use scoped completion and reassignment actions', () => {
  assert.match(completeHtml, /email-access\/\$\{encodeURIComponent\(accessToken\)\}\/tasks\/\$\{encodeURIComponent\(token\)\}\/\$\{action\}/);
  assert.match(completeHtml, /updateTaskStatus\('complete'\)/);
  assert.match(completeHtml, /updateTaskStatus\('not-applicable'\)/);
  assert.match(completeHtml, /Reassign this task/);
  assert.match(completeHtml, /tasks\/\$\{encodeURIComponent\(task\.token\)\}\/reassign/);
  assert.doesNotMatch(completeHtml, /task\.canCompleteFromLink\s*===\s*false/);
  assert.doesNotMatch(completeHtml, /Needs information/);
});

test('only the narrow email workspace routes bypass site login', () => {
  assert.match(programSource, /IsPublicTaskEmailAccessPath\(context\.Request\)/);
  assert.match(programSource, /HttpMethods\.IsGet\(request\.Method\)/);
  assert.match(programSource, /HttpMethods\.IsPost\(request\.Method\)/);
  assert.match(programSource, /string\.Equals\(segments\[2\], "email-access"/);
  assert.match(programSource, /Guid\.TryParse\(segments\[3\], out _\)/);
  assert.match(programSource, /segments\[6\], "complete"/);
  assert.match(programSource, /segments\[6\], "reassign"/);
});
