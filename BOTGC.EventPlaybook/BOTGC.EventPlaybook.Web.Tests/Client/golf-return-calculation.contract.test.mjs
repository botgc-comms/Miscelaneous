import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourcePath = new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook-app.js', import.meta.url);
const source = await readFile(sourcePath, 'utf8');
const playbookPath = new URL('../../BOTGC.EventPlaybook.Web/Data/event-playbook.json', import.meta.url);
const playbookTemplate = JSON.parse(await readFile(playbookPath, 'utf8'));

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

function minutesFromTime(value) {
  if (!value || !/^\d{2}:\d{2}$/.test(String(value))) return null;
  const [hours, minutes] = String(value).split(':').map(Number);
  return hours * 60 + minutes;
}

function timeFromMinutes(value) {
  if (!Number.isFinite(value)) return null;
  const normalised = ((value % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalised / 60)).padStart(2, '0')}:${String(normalised % 60).padStart(2, '0')}`;
}

test('golf return forecast multiplies pace per hole by the selected number of holes', () => {
  const event = {
    answers: {
      'competition-holes': '9',
      'golf-player-count': 30,
      'golf-supporter-count': 10,
      'golf-expected-round-minutes': 10,
      'golf-start-method': 'tee-times',
      'tee-time-window': { start: '18:30', end: '20:30' }
    }
  };
  const deriveFacts = compileFunction('deriveFacts', {
    getQuestionValue: (id, candidate) => candidate.answers[id],
    minutesFromTime,
    timeFromMinutes,
    playbook: playbookTemplate
  });

  const facts = deriveFacts(event);

  assert.equal(facts.competitionHoles, 9);
  assert.equal(facts.expectedMinutesPerHole, 10);
  assert.equal(facts.expectedRoundMinutes, 90);
  assert.equal(facts.expectedFirstGolfFinish, '20:00');
  assert.equal(facts.expectedLatestGolfFinish, '22:00');
});

test('v3.9 migrates plausible legacy whole-round durations to a per-hole pace once', () => {
  const state = {
    events: [
      {
        answers: {
          'competition-holes': '9',
          'golf-expected-round-minutes': 90
        },
        clonedAnswerHints: {
          'golf-expected-round-minutes': 180
        }
      },
      {
        answers: {
          'competition-holes': '9',
          'golf-expected-round-minutes': 10
        }
      },
      {
        answers: {
          'golf-expected-round-minutes': 120
        }
      }
    ]
  };
  const migrate = compileFunction('migrateGolfPaceStateV39', {
    playbook: { schemaVersion: '3.9' },
    state
  });

  assert.equal(migrate(), true);
  assert.equal(state.events[0].answers['golf-expected-round-minutes'], 10);
  assert.equal(state.events[0].clonedAnswerHints['golf-expected-round-minutes'], 20);
  assert.equal(state.events[1].answers['golf-expected-round-minutes'], 10);
  assert.equal('golf-expected-round-minutes' in state.events[2].answers, false);
  assert.ok(state.events.every(event => event.dataMigrations.golfPacePerHoleV39 === true));
  assert.equal(migrate(), false);
});

test('the playbook describes the input explicitly as pace per hole', () => {
  const questions = playbookTemplate.modules
    .flatMap(module => module.sections)
    .flatMap(section => section.items);
  const question = questions.find(item => item.id === 'golf-expected-round-minutes');

  assert.equal(playbookTemplate.schemaVersion, '4.0');
  assert.equal(question.unit, 'minutes per hole');
  assert.match(question.label, /per hole/i);
  assert.match(question.helpText, /multiplies this by the selected number of holes/i);
});
