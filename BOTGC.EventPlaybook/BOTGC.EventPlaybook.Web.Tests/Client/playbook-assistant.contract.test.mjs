import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const playbookPath = new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook-app.js', import.meta.url);
const assistantPath = new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook-assistant.js', import.meta.url);
const programPath = new URL('../../BOTGC.EventPlaybook.Web/Program.cs', import.meta.url);
const [playbookSource, assistantSource, programSource] = await Promise.all([
  readFile(playbookPath, 'utf8'),
  readFile(assistantPath, 'utf8'),
  readFile(programPath, 'utf8')
]);

test('Playbook administration mounts the assistant only in the authenticated admin view', () => {
  assert.match(playbookSource, /state\.activeView === 'admin' && accessSession\.isAdmin/);
  assert.match(playbookSource, /import\('\.\/playbook-assistant\.js\?v=/);
  assert.match(playbookSource, /id="playbook-assistant-root"/);
  assert.match(programSource, /path\.StartsWithSegments\("\/api\/admin"\) && !isAdmin/);
});

test('shared template persistence replaces browser-only publishing and uses optimistic revisions', () => {
  assert.match(playbookSource, /fetch\('\/api\/playbook\/template'/);
  assert.match(playbookSource, /fetch\('\/api\/admin\/playbook\/template'/);
  assert.match(playbookSource, /expectedRevision: playbookTemplateRevision/);
  assert.match(programSource, /MapPut\("\/api\/admin\/playbook\/template"/);
  assert.match(programSource, /StatusCodes\.Status409Conflict/);
});

test('legacy browser templates are migrated without source-flag data loss and primary questions stay protected', () => {
  assert.match(playbookSource, /function replayLocalAdminCustomisations\(bundledPlaybook, storedTemplate, protectedIds/);
  assert.match(playbookSource, /for \(const legacyModule of storedTemplate\?\.modules \?\? \[\]\)/);
  assert.match(playbookSource, /if \(!id \|\| protectedSet\.has\(id\)\) continue/);
  assert.match(playbookSource, /mergeNamedTemplateArray\(merged\.responsibilityRoles/);
  assert.doesNotMatch(playbookSource, /item\.source !== 'admin'/);
});

test('revision conflicts load the current shared template while retaining manual drafts', () => {
  assert.match(playbookSource, /response\.status === 409 && result\.current\?\.template/);
  assert.match(playbookSource, /applyPlaybookTemplateDocument\(result\.current, \{ renderAfter: false \}\)/);
  assert.match(playbookSource, /your draft changes are still available to review and publish again/i);
});

test('open sessions are notified when another administrator publishes a newer template', () => {
  assert.match(playbookSource, /function pollPlaybookTemplate\(\)/);
  assert.match(playbookSource, /window\.setInterval\(pollPlaybookTemplate, 30_000\)/);
  assert.match(playbookSource, /Load latest Playbook/);
  assert.match(playbookSource, /pendingPlaybookTemplateDocument = document/);
});

test('AI proposals require explicit review and apply rather than changing the template immediately', () => {
  assert.match(assistantSource, /\/api\/admin\/playbook-assistant\/propose/);
  assert.match(assistantSource, /Not applied/);
  assert.match(assistantSource, /Apply approved proposal/);
  assert.match(assistantSource, /\/api\/admin\/playbook-assistant\/apply/);
  assert.match(assistantSource, /The proposal was discarded\. The live Playbook was not changed\./);
});

test('proposal review exposes current and proposed values plus every material field', () => {
  assert.match(assistantSource, /renderComparison\('Wording', change\.currentWording, change\.wording\)/);
  assert.match(assistantSource, /renderComparison\('Status', change\.currentEnabled === false/);
  for (const label of [
    'Help text',
    'Example',
    'Answer type',
    'Required',
    'Shown when',
    'Deadline',
    'Owner',
    'Staff briefing phase',
    'Staff briefing audience',
    'Staff briefing instruction'
  ]) assert.match(assistantSource, new RegExp(label));
  assert.match(assistantSource, />Current</);
  assert.match(assistantSource, />Proposed</);
});

test('voice instructions are transcribed into editable text and are not automatically submitted', () => {
  assert.match(assistantSource, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(assistantSource, /\/api\/admin\/playbook-assistant\/voice/);
  assert.match(assistantSource, /input\.value = result\.text/);
  assert.match(assistantSource, /Review the wording, then send it when you are ready/);
  assert.doesNotMatch(assistantSource, /input\.value = result\.text[\s\S]{0,100}requestSubmit/);
});

test('retired club-specific items are hidden without deleting their IDs and core reset remains available', () => {
  assert.match(playbookSource, /item\?\.assistantDisabled !== true/);
  assert.match(playbookSource, /!visible && !retiredByAssistant/);
  assert.match(playbookSource, /!visible && !retiredByAssistant && Object\.prototype\.hasOwnProperty\.call\(event\.answers/);
  assert.match(assistantSource, /set_enabled/);
  assert.match(assistantSource, /Restore bundled core/);
  assert.match(assistantSource, /\/api\/admin\/playbook\/template\/reset/);
});
