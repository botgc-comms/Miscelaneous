import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const playbookSourcePath = new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook-app.js', import.meta.url);
const cancellationSourcePath = new URL('../../BOTGC.EventPlaybook.Web/wwwroot/cancellation-app.js', import.meta.url);
const [playbookSource, cancellationSource] = await Promise.all([
  readFile(playbookSourcePath, 'utf8'),
  readFile(cancellationSourcePath, 'utf8')
]);

test('Cancellation Control is status-gated and opens after a cancelled decision', () => {
  assert.match(playbookSource, /lifecycle\?\.status === 'cancelled'[\s\S]*data-view="cancellation"/);
  assert.match(playbookSource, /state\.activeView === 'cancellation' && normaliseEventLifecycle\(event\)\.status !== 'cancelled'/);
  assert.match(playbookSource, /statusChanged && nextStatus === 'cancelled'[\s\S]*state\.activeView = 'cancellation'/);
  assert.match(playbookSource, /import\('\.\/cancellation-app\.js\?v=/);
});

test('the workspace derives evidence from persisted publications and the live IG link', () => {
  assert.match(cancellationSource, /\/api\/poster\/session\?key=/);
  assert.match(cancellationSource, /\/api\/integrations\/intelligent-golf\/events\//);
  assert.match(cancellationSource, /session\.screenPublication/);
  assert.match(cancellationSource, /session\.emailPublication/);
  assert.match(cancellationSource, /diaryEntryId/);
  assert.match(cancellationSource, /plannerEntryId/);
  assert.match(cancellationSource, /cycleKey = `cancelled:\$\{context\.lifecycle\.statusChangedAt/);
});

test('Yodeck actions are hidden when disabled and support either withdrawal or an exact notice', () => {
  assert.match(cancellationSource, /if \(!runtime\.context\.yodeckEnabled\)/);
  assert.match(cancellationSource, /Yodeck is currently disabled/);
  assert.match(cancellationSource, /apiJson\('\/api\/poster\/take-down'/);
  assert.match(cancellationSource, /apiJson\('\/api\/poster\/publish'/);
  assert.match(cancellationSource, /context\.fillText\('CANCELLED'/);
  assert.match(cancellationSource, /session\.screenPublication = null/);
});

test('member cancellation and Intelligent Golf rollback use explicit service operations', () => {
  assert.match(cancellationSource, /\/api\/poster\/member-email\/cancellation-draft/);
  assert.match(cancellationSource, /\/api\/poster\/member-email\/members\?refresh=true/);
  assert.match(cancellationSource, /\/api\/poster\/member-email\/test/);
  assert.match(cancellationSource, /\/api\/poster\/member-email\/send/);
  assert.match(cancellationSource, /operation: 'cancellation'/);
  assert.match(cancellationSource, /\/cancel`/);
  assert.match(cancellationSource, /removeDiary, removePlanner/);
  assert.match(cancellationSource, /The diary is always removed before its planner entry/);
});

test('destructive and interrupted actions recover safely', () => {
  assert.match(cancellationSource, /intelligentGolf: \{ status: 'pending', removeDiary: false, removePlanner: false/);
  assert.match(cancellationSource, /status !== 'working'[\s\S]*status = 'failed'/);
  assert.match(cancellationSource, /posterCheckFailed/);
  assert.match(cancellationSource, /intelligentGolfCheckFailed/);
  assert.match(cancellationSource, /activeRuntime\?\.context\.eventId === context\.eventId/);
});
