import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourcePath = new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook-app.js', import.meta.url);
const source = await readFile(sourcePath, 'utf8');
const playbookPath = new URL('../../BOTGC.EventPlaybook.Web/Data/event-playbook.json', import.meta.url);
const playbook = JSON.parse(await readFile(playbookPath, 'utf8'));

function functionSource(name) {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = declaration.exec(source);
  assert.ok(match, `Expected playbook-app.js to declare ${name}().`);
  const followingDeclaration = /\n  (?:async\s+)?function\s+[A-Za-z0-9_$]+\s*\(/g;
  followingDeclaration.lastIndex = match.index + match[0].length;
  const next = followingDeclaration.exec(source);
  return source.slice(match.index, next?.index ?? source.length);
}

function compileFunction(name, dependencies = {}) {
  return Function(
    ...Object.keys(dependencies),
    `'use strict';\n${functionSource(name)}\nreturn ${name};`
  )(...Object.values(dependencies));
}

function question(id) {
  return playbook.modules
    .flatMap(module => module.sections)
    .flatMap(section => section.items)
    .find(item => item.id === id);
}

test('competition planning separates scoring method from playing or team format', () => {
  const scoring = question('competition-format');
  const playing = question('competition-playing-format');

  assert.equal(playbook.schemaVersion, '4.0');
  assert.equal(scoring.label, 'How will the competition be scored?');
  assert.deepEqual(scoring.options.map(option => option.value), [
    'stableford', 'medal', 'match-play', 'other'
  ]);
  assert.equal(playing.label, 'How will players compete?');
  assert.deepEqual(playing.options.map(option => option.value), [
    'individual',
    'fourball-betterball',
    'foursomes',
    'greensomes',
    'texas-scramble',
    'am-am',
    'pro-am',
    'team-aggregate',
    'other'
  ]);
  assert.equal(question('competition-playing-format-other').showWhen.all[0].questionId, 'competition-playing-format');
});

test('legacy mixed competition formats move to the playing-format answer without inventing a scoring method', () => {
  const state = {
    events: [
      { answers: { 'competition-format': 'stableford' } },
      { answers: { 'competition-format': 'betterball' } },
      { answers: { 'competition-format': 'team' } },
      { answers: {}, clonedAnswerHints: { 'competition-format': 'greensomes' } }
    ]
  };
  const migrate = compileFunction('migrateCompetitionFormatStateV40', {
    playbook: { schemaVersion: '4.0' },
    itemIndex: new Map([['competition-playing-format', {}]]),
    state
  });

  assert.equal(migrate(), true);
  assert.equal(state.events[0].answers['competition-format'], 'stableford');
  assert.equal(state.events[0].answers['competition-playing-format'], undefined);

  assert.equal(state.events[1].answers['competition-format'], undefined);
  assert.equal(state.events[1].answers['competition-playing-format'], 'fourball-betterball');

  assert.equal(state.events[2].answers['competition-format'], undefined);
  assert.equal(state.events[2].answers['competition-playing-format'], 'other');
  assert.match(state.events[2].answers['competition-playing-format-other'], /confirm the exact playing format/i);

  assert.equal(state.events[3].clonedAnswerHints['competition-format'], undefined);
  assert.equal(state.events[3].clonedAnswerHints['competition-playing-format'], 'greensomes');
  assert.ok(state.events.every(event => event.dataMigrations.competitionFormatSplitV40 === true));
  assert.equal(migrate(), false);
});

test('the scoring and playing formats are included in Intelligent Golf planning notes', () => {
  assert.match(source, /\['competition-format', 'Scoring method'\]/);
  assert.match(source, /\['competition-playing-format', 'Playing \/ team format'\]/);
  assert.match(source, /competitionFormatSplitV40:\s*true/);
});
