import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = relativePath => readFile(new URL(relativePath, import.meta.url), 'utf8');
const [playbookSource, posterSource, webServiceSource, apiSource, transportSource] = await Promise.all([
  read('../../BOTGC.EventPlaybook.Web/wwwroot/playbook-app.js'),
  read('../../BOTGC.EventPlaybook.Web/wwwroot/poster-app.js'),
  read('../../BOTGC.EventPlaybook.Web/Services/IntelligentGolfEventIntegration.cs'),
  read('../../BOTGC.EventPlaybook.API/Features/Competitions/CompetitionsFeature.cs'),
  read('../../BOTGC.EventPlaybook.API/Infrastructure/IntelligentGolf/IntelligentGolfTransport.cs')
]);

function functionSource(source, name) {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = declaration.exec(source);
  assert.ok(match, `Expected ${name}() to be declared.`);
  const nextDeclaration = /\n\s*(?:async\s+)?function\s+[A-Za-z0-9_$]+\s*\(/g;
  nextDeclaration.lastIndex = match.index + match[0].length;
  const next = nextDeclaration.exec(source);
  return source.slice(match.index, next?.index ?? source.length);
}

test('linked competitions replace the separate member-diary publication route', () => {
  assert.match(webServiceSource, /if \(existingLink\?\.IntelligentGolfCompetitionId is > 0\)/);
  assert.match(webServiceSource, /api\/competitions\/\{competitionId\}\/member-advertising/);
  assert.match(webServiceSource, /PublicationTarget = "competition"/);
});

test('competition updates reproduce the captured upload and save endpoints', () => {
  assert.match(apiSource, /ajaxaction=compimageupload/);
  assert.match(apiSource, /ajaxaction=savecomp/);
  assert.match(apiSource, /new\("name", artwork\.FileName\), new\("undefined", "undefined"\)/);
  assert.match(apiSource, /"#compImageInput"/);
  assert.match(transportSource, /compadmin3\.php/);
  assert.match(transportSource, /compid=\{competitionId\}/);
});

test('the whole live competition form is preserved while comments and image are replaced', () => {
  assert.match(apiSource, /SelectSingleNode\("\/\/\*\[@id='compform'\]"\)/);
  assert.match(apiSource, /SerialiseSuccessfulControls/);
  assert.match(apiSource, /field\.Key\.Equals\("comments"/);
  assert.match(apiSource, /field\.Key\.Equals\("image"/);
  assert.match(apiSource, /competition-settings-verification/);
});

test('replacing an existing diary entry requires confirmation and removes it only after competition success', () => {
  const start = webServiceSource.indexOf('private async Task<IntelligentGolfDiaryPublishResult> PublishCompetitionAdvertisingAsync');
  const end = webServiceSource.indexOf('public async Task<IntelligentGolfEventCancellationResult>', start);
  const publish = start >= 0 && end > start ? webServiceSource.slice(start, end) : '';
  assert.match(publish, /IntelligentGolfDiaryReplacementRequiredException/);
  assert.match(publish, /SaveCompetitionPublicationAsync/);
  assert.match(publish, /HttpMethod\.Delete, "api\/event-planner\/member-diary"/);
  assert.ok(
    publish.indexOf('SaveCompetitionPublicationAsync') < publish.indexOf('HttpMethod.Delete, "api/event-planner/member-diary"'),
    'The competition must be confirmed before the old diary entry is removed.'
  );
});

test('the Communications Centre explains and collects the replacement decision', () => {
  const studio = functionSource(playbookSource, 'renderArtworkStudio');
  assert.match(studio, /id="memberDiaryRoutingNotice"/);
  assert.match(studio, /id="replaceExistingMemberDiary"/);
  const routing = functionSource(posterSource, 'updateMemberDiaryRoutingUi');
  assert.match(routing, /Publish through the linked competition/);
  assert.match(routing, /Confirm diary replacement above/);
  const publish = functionSource(posterSource, 'addToMemberDiary');
  assert.match(publish, /replaceExistingDiaryEntry/);
  assert.match(publish, /publicationTarget === 'competition'/);
});
