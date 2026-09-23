import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const config = JSON.parse(await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/event-playbook.json', import.meta.url),
  'utf8'));
const source = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook-app.js', import.meta.url),
  'utf8');
const indexSource = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/index.html', import.meta.url),
  'utf8');

const items = config.modules
  .flatMap(module => module.sections)
  .flatMap(section => section.items);
const byId = new Map(items.map(item => [item.id, item]));

test('the Intelligent Golf ticket questions capture every field used by the two observed posts', () => {
  for (const id of [
    'ig-online-ticketing',
    'ig-ticket-allocation',
    'ig-members-online',
    'ig-max-tickets-member',
    'ig-require-member-guest-details',
    'ig-members-payment-due-on-entry',
    'ig-visitors-online',
    'ig-max-tickets-visitor',
    'ig-add-ticket-options',
    'ig-ticket-types'
  ]) {
    assert.ok(byId.has(id), `Expected ${id} in the Playbook.`);
    assert.equal(byId.get(id).requiresPlugin, 'intelligentGolf');
  }
  assert.equal(byId.get('ig-ticket-types').answerType, 'ticketTypes');
});

test('the Intelligent Golf task is an explicit reviewed integration action', () => {
  const task = byId.get('configure-ig-ticket-sales-task');
  assert.equal(task.completionMode, 'intelligent-golf-ticket-sync');
  assert.equal(task.actionType, 'configure-intelligent-golf-tickets');
  assert.equal(task.canCompleteFromLink, false);
  assert.match(source, /\/api\/integrations\/intelligent-golf\/events\/\$\{encodeURIComponent\(event\.id\)\}\/tickets/);
  assert.match(source, /if \(!await flushSharedState\(\)\)/);
  assert.match(source, /taskState\.completed = true/);
  assert.match(source, /completionMode === 'intelligent-golf-ticket-sync'/);
});

test('the ordinary non-IG booking setup task remains available', () => {
  const task = byId.get('configure-ticket-sales-task');
  assert.equal(task.actionType, undefined);
  assert.equal(task.requiresPlugin, undefined);
  assert.match(JSON.stringify(task.showWhen), /ig-online-ticketing/);
  assert.match(JSON.stringify(task.showWhen), /notEquals/);
});

test('the ticket editor release changes are cache-busted', () => {
  assert.match(indexSource, /playbook\.css\?v=20260923-event-ideas-1/);
  assert.match(indexSource, /playbook-app\.js\?v=20260923-event-ideas-1/);
});
