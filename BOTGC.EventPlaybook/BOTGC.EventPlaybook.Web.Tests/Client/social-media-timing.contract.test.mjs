import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dataTemplate = JSON.parse(await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/Data/event-playbook.json', import.meta.url),
  'utf8'
));
const publicTemplate = JSON.parse(await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/event-playbook.json', import.meta.url),
  'utf8'
));

function items(template) {
  return template.modules
    .flatMap(module => module.sections)
    .flatMap(section => section.items);
}

test('social media planning distinguishes promotion, post-event coverage and both', () => {
  assert.equal(dataTemplate.schemaVersion, '4.2');
  assert.deepEqual(publicTemplate, dataTemplate);
  const byId = new Map(items(dataTemplate).map(item => [item.id, item]));
  const timing = byId.get('social-media-timing');

  assert.equal(timing.answerType, 'singleChoice');
  assert.equal(timing.required, true);
  assert.equal(timing.showWhen.all[0].questionId, 'social-media-required');
  assert.deepEqual(timing.options.map(option => option.value), [
    'before-event',
    'after-event',
    'both'
  ]);

  const promotion = byId.get('social-media-task');
  assert.equal(promotion.deadlineCode, 'B3');
  assert.deepEqual(promotion.showWhen.all[0].value, ['before-event', 'both']);
  assert.match(promotion.title, /pre-event/i);

  const followUp = byId.get('post-event-social-media-task');
  assert.equal(followUp.deadlineCode, 'A1');
  assert.deepEqual(followUp.showWhen.all[0].value, ['after-event', 'both']);
  assert.match(followUp.title, /post-event/i);
});
