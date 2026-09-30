import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = relativePath => readFile(new URL(relativePath, import.meta.url), 'utf8');

const [config, clientSource, webProgram, integrationSource, linkStoreSource, apiSource] = await Promise.all([
  read('../../BOTGC.EventPlaybook.Web/wwwroot/event-playbook.json').then(JSON.parse),
  read('../../BOTGC.EventPlaybook.Web/wwwroot/playbook-app.js'),
  read('../../BOTGC.EventPlaybook.Web/Program.cs'),
  read('../../BOTGC.EventPlaybook.Web/Services/IntelligentGolfEventIntegration.cs'),
  read('../../BOTGC.EventPlaybook.Web/Services/IntelligentGolfIntegrationLinkStore.cs'),
  read('../../BOTGC.EventPlaybook.API/Features/Competitions/CompetitionsFeature.cs')
]);

const items = config.modules
  .flatMap(module => module.sections)
  .flatMap(section => section.items);
const byId = new Map(items.map(item => [item.id, item]));

test('golf planning asks whether the competition exists and creates a verified link task', () => {
  const question = byId.get('competition-already-created');
  assert.ok(question);
  assert.equal(question.answerType, 'yesNo');
  assert.equal(question.requiresPlugin, 'intelligentGolf');

  const task = byId.get('link-intelligent-golf-competition-task');
  assert.ok(task);
  assert.equal(task.completionMode, 'intelligent-golf-competition-link');
  assert.equal(task.actionType, 'link-intelligent-golf-competition');
  assert.equal(task.canCompleteFromLink, false);
  assert.equal(task.requiresPlugin, 'intelligentGolf');
});

test('the browser calls only Event Playbook Web competition endpoints', () => {
  assert.match(clientSource, /\/api\/integrations\/intelligent-golf\/events\/\$\{encodeURIComponent\(event\.id\)\}\/competition-candidates/);
  assert.match(clientSource, /\/api\/integrations\/intelligent-golf\/events\/\$\{encodeURIComponent\(event\.id\)\}\/competition-link/);
  assert.doesNotMatch(clientSource, /compdash\.php/i);
  assert.doesNotMatch(clientSource, /botgc\.api/i);
});

test('Event Playbook Web proxies exact-date discovery to its own integration API', () => {
  assert.match(webProgram, /MapGet\("\/api\/integrations\/intelligent-golf\/events\/\{eventId\}\/competition-candidates"/);
  assert.match(webProgram, /MapPost\("\/api\/integrations\/intelligent-golf\/events\/\{eventId\}\/competition-link"/);
  assert.match(integrationSource, /api\/competitions\/available\?date=\{Uri\.EscapeDataString\(eventSnapshot\.EventDate\)\}/);
  assert.match(integrationSource, /GetCompetitionCandidatesAsync\(eventSnapshot, true, cancellationToken\)/);
});

test('the internal API owns Intelligent Golf scraping and exact-date filtering', () => {
  assert.match(apiSource, /IIntelligentGolfReportClient reports/);
  assert.match(apiSource, /IIntelligentGolfReportParser<AvailableCompetition> parser/);
  assert.match(apiSource, /DateOnly\? Date/);
  assert.match(apiSource, /DateOnly\.FromDateTime\(competition\.Date\.Value\) == request\.Date\.Value/);
  assert.match(apiSource, /"\/api\/competitions\/available"/);
});

test('competition identity is persisted independently of the planner event identity', () => {
  assert.match(linkStoreSource, /link\.IntelligentGolfCompetitionId = intelligentGolfCompetitionId/);
  assert.match(linkStoreSource, /link\.IntelligentGolfCompetitionName = competitionName\.Trim\(\)/);
  assert.match(linkStoreSource, /link\.IntelligentGolfCompetitionDate = competitionDate/);
  assert.doesNotMatch(
    linkStoreSource.match(/public async Task<IntelligentGolfIntegrationLink> SaveCompetitionAsync[\s\S]*?^    }/m)?.[0] ?? '',
    /IntelligentGolfEventId\s*=/
  );
});

test('the task is completed only after the server verifies and persists the selected competition', () => {
  const saveFunction = clientSource.match(/async function saveIntelligentGolfCompetitionLink[\s\S]*?\n  }\n/)?.[0] ?? '';
  assert.match(saveFunction, /if \(!response\.ok\)/);
  assert.match(saveFunction, /taskState\.completed = true/);
  assert.ok(
    saveFunction.indexOf('if (!response.ok)') < saveFunction.indexOf('taskState.completed = true'),
    'The UI must not mark the task complete before the API confirms the link.'
  );
});
