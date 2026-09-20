import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook-app.js', import.meta.url),
  'utf8');

function functionSource(name) {
  const declaration = new RegExp(`function\\s+${name}\\s*\\(`);
  const match = declaration.exec(source);
  assert.ok(match, `Expected playbook-app.js to declare ${name}().`);
  const following = /\n  (?:async\s+)?function\s+[A-Za-z0-9_$]+\s*\(/g;
  following.lastIndex = match.index + match[0].length;
  const next = following.exec(source);
  return source.slice(match.index, next?.index ?? source.length);
}

test('the IG note projection contains operational decisions and explicit task notes, not task actions', () => {
  const question = id => ({ id, type: 'question', answerType: 'text' });
  const itemIndex = new Map([
    ['clubhouse-areas', { item: question('clubhouse-areas'), module: {} }],
    ['agreed-menu-choices', { item: question('agreed-menu-choices'), module: {} }],
    ['golf-results-technology-plan', { item: question('golf-results-technology-plan'), module: {} }],
    ['close-down-plan-details', { item: question('close-down-plan-details'), module: {} }],
    ['setup-seating-task', { item: { id: 'setup-seating-task', type: 'task', title: 'Prepare the room' }, module: {} }]
  ]);
  const groups = [
    { title: 'Rooms and setup', fields: [['clubhouse-areas', 'Rooms/areas']] },
    { title: 'Catering and bar', fields: [['agreed-menu-choices', 'Menu/meal choices']] },
    { title: 'Golf operations', fields: [['golf-results-technology-plan', 'Scoring technology and fallback']] },
    { title: 'Close-down', fields: [['close-down-plan-details', 'Close-down instructions']] }
  ];
  const event = {
    name: 'Golf Sixes Final', eventDate: '2026-09-19', startTime: '17:00', endTime: '21:00',
    expectedAttendees: 80, organiser: 'Simon', lifecycle: { status: 'confirmed' },
    answers: {
      'clubhouse-areas': 'Peacock Lounge',
      'agreed-menu-choices': 'Junior buffet',
      'golf-results-technology-plan': 'Scoring app; mobile hotspot fallback',
      'close-down-plan-details': 'Return the room to its normal layout'
    },
    taskState: {
      'setup-seating-task': { completed: true, notes: 'Leave a clear route to both fire exits.' }
    }
  };
  const build = Function(
    'playbook', 'INTELLIGENT_GOLF_NOTE_GROUPS', 'EVENT_STATUS_DEFINITIONS', 'itemIndex',
    'normaliseEventLifecycle', 'formatDate', 'assignmentDisplay', 'isModuleActive', 'isItemVisible',
    'isQuestionNotRelevant', 'getQuestionValue', 'isAnsweredValue', 'formatBriefingAnswer',
    `'use strict';\n${functionSource('buildIntelligentGolfPlanningNote')}\nreturn buildIntelligentGolfPlanningNote;`
  )(
    {}, groups, { confirmed: { label: 'Confirmed' } }, itemIndex,
    candidate => candidate.lifecycle, value => value, value => String(value), () => true, () => true,
    () => false, (id, candidate) => candidate.answers[id], value => value !== undefined && value !== '',
    (_item, value) => String(value)
  );

  const note = build(event);

  assert.match(note, /Rooms\/areas: Peacock Lounge/);
  assert.match(note, /Menu\/meal choices: Junior buffet/);
  assert.match(note, /Scoring technology and fallback: Scoring app; mobile hotspot fallback/);
  assert.match(note, /Close-down instructions: Return the room to its normal layout/);
  assert.match(note, /Confirmed — Prepare the room: Leave a clear route to both fire exits\./);
  assert.match(note, /Actions remain in Event Playbook rather than this note/);
});

test('the shared-state snapshot materialises the managed note before it is persisted', () => {
  assert.match(functionSource('getSharedStateSnapshot'), /materialiseIntelligentGolfPlanningNotes\(\)/);
  assert.match(functionSource('materialiseIntelligentGolfPlanningNotes'), /const note\s*=\s*buildIntelligentGolfPlanningNote\(event\)/);
  assert.match(functionSource('materialiseIntelligentGolfPlanningNotes'), /event\.intelligentGolfPlanningNote\s*=\s*note/);
  assert.match(functionSource('applySharedState'), /planningNotesMigrated\s*=\s*materialiseIntelligentGolfPlanningNotes\(\)/);
});
