import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const completeHtml = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/complete.html', import.meta.url),
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
  assert.match(completeHtml, /data-task-token/);
  assert.doesNotMatch(completeHtml, /Open task in Event Playbook/);
});

test('only the narrow read-only email workspace endpoint bypasses site login', () => {
  assert.match(programSource, /IsPublicTaskEmailAccessPath\(context\.Request\)/);
  assert.match(programSource, /HttpMethods\.IsGet\(request\.Method\)/);
  assert.match(programSource, /string\.Equals\(segments\[2\], "email-access"/);
  assert.match(programSource, /Guid\.TryParse\(segments\[3\], out _\)/);
});
