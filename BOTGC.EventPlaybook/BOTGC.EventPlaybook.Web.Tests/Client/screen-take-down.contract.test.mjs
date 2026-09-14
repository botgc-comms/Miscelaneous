import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const playbookSourcePath = new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook-app.js', import.meta.url);
const posterSourcePath = new URL('../../BOTGC.EventPlaybook.Web/wwwroot/poster-app.js', import.meta.url);
const cssSourcePath = new URL('../../BOTGC.EventPlaybook.Web/wwwroot/poster-module.css', import.meta.url);
const [playbookSource, posterSource, cssSource] = await Promise.all([
  readFile(playbookSourcePath, 'utf8'),
  readFile(posterSourcePath, 'utf8'),
  readFile(cssSourcePath, 'utf8')
]);

function functionSource(name) {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = declaration.exec(posterSource);
  assert.ok(match, `Expected poster-app.js to declare ${name}().`);

  const followingDeclaration = /\n(?:async\s+)?function\s+[A-Za-z0-9_$]+\s*\(/g;
  followingDeclaration.lastIndex = match.index + match[0].length;
  const next = followingDeclaration.exec(posterSource);
  return posterSource.slice(match.index, next?.index ?? posterSource.length);
}

test('the screen card places a matching take-down action beside the publish action', () => {
  const cardStart = playbookSource.indexOf('<h3>Clubhouse screens</h3>');
  assert.notEqual(cardStart, -1);
  const card = playbookSource.slice(cardStart, playbookSource.indexOf('</article>', cardStart));

  assert.match(card, /class="share-action-buttons"/);
  assert.match(card, /id="shareScreensButton"/);
  assert.match(card, /id="takeDownScreensButton" class="button button-secondary hidden"/);
  assert.ok(card.indexOf('shareScreensButton') < card.indexOf('takeDownScreensButton'));
  assert.match(cssSource, /\.share-action-buttons\{[\s\S]*display:\s*flex;[\s\S]*grid-column:\s*1\s*\/\s*-1;/);
});

test('persisted screen operations retain their action and old records default to publish', () => {
  const hydration = functionSource('applyStoredSession');

  assert.match(posterSource, /screenPublishOperation:\s*session\.screenPublishOperation/);
  assert.match(hydration, /stored\.screenPublishOperation\.action\s*===\s*'take-down'/);
  assert.match(hydration, /:\s*'publish'/);
  assert.match(hydration, /previous background take-down was interrupted/i);
  assert.match(hydration, /media file will remain in the Yodeck library/i);
});

test('take down is confirmed then launched as a background screen operation', () => {
  const takeDown = functionSource('takeDownFromClubhouseScreens');

  assert.match(posterSource, /takeDownScreensButton\?\.addEventListener\('click',\s*\(\)\s*=>\s*void takeDownFromClubhouseScreens\(\)\)/);
  assert.match(takeDown, /window\.confirm\(/);
  assert.match(takeDown, /removes it from the Clubhouse rotation and pushes the change to the screens/i);
  assert.match(takeDown, /media file will remain in the Yodeck library/i);
  assert.match(takeDown, /action:\s*'take-down'/);
  assert.match(takeDown, /status:\s*'sending'/);
  assert.match(takeDown, /fetch\('\/api\/poster\/take-down'/);
  assert.match(takeDown, /eventId:\s*session\.context\?\.eventId\s*\|\|\s*session\.key/);
  assert.match(takeDown, /eventName:\s*getCampaignEventName\(session\)/);
  assert.match(takeDown, /mediaId:\s*publication\?\.mediaId\s*\?\?\s*null/);
  assert.match(takeDown, /const previousPublishFailed\s*=\s*session\.screenPublishOperation\?\.status\s*===\s*'failed'/);
  assert.match(takeDown, /if\s*\(!publication\s*&&\s*!previousPublishFailed\s*&&\s*!previousTakeDownFailed\)\s*return/);
  assert.ok(takeDown.indexOf('renderScreenPublishState(session)') < takeDown.indexOf("fetch('/api/poster/take-down'"));
  assert.doesNotMatch(takeDown, /showModal\(/);
});

test('a failed take down preserves publication state while success clears it', () => {
  const takeDown = functionSource('takeDownFromClubhouseScreens');
  const responseRead = takeDown.indexOf('await readApiResponse(response)');
  const clearPublication = takeDown.indexOf('session.screenPublication = null');
  const catchStart = takeDown.indexOf('} catch (error) {');

  assert.ok(responseRead >= 0 && clearPublication > responseRead && catchStart > clearPublication);
  assert.doesNotMatch(takeDown.slice(catchStart), /screenPublication\s*=\s*null/);
  assert.match(takeDown.slice(catchStart), /status:\s*'failed'/);
});

test('screen state disables both actions while removing and offers a focused retry on failure', () => {
  const render = functionSource('renderScreenPublishState');

  assert.match(render, /const publishFailed\s*=\s*operation\?\.status\s*===\s*'failed'\s*&&\s*operationAction\s*===\s*'publish'/);
  assert.match(render, /const canTakeDown\s*=\s*Boolean\(session\.screenPublication\)\s*\|\|\s*publishFailed\s*\|\|\s*takeDownFailed\s*\|\|\s*isTakingDown/);
  assert.match(render, /classList\.toggle\('hidden',\s*!canTakeDown\)/);
  assert.match(render, /takeDownScreensButton\.disabled\s*=\s*isSending/);
  assert.match(render, /Taking down in background/);
  assert.match(render, /Try taking down again/);
  assert.match(render, /Could not take down · try again/);
  assert.match(render, /Taken down · push completed/);
  assert.match(render, /media file remains in the Yodeck library and can be published again/i);
});
