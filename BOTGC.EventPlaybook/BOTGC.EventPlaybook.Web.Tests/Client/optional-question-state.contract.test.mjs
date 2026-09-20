import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourcePath = new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook-app.js', import.meta.url);
const source = await readFile(sourcePath, 'utf8');
const css = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook.css', import.meta.url),
  'utf8');

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

const isAnsweredValue = compileFunction('isAnsweredValue');
const isQuestionNotRelevant = compileFunction('isQuestionNotRelevant');
const hasRecordedQuestionValue = compileFunction('hasRecordedQuestionValue');

test('module progress accepts an explicit not-relevant decision for any visible question', () => {
  const values = new Map([
    ['optional-answered', 'Recorded detail']
  ]);
  const getQuestionValue = questionId => values.get(questionId);
  const isQuestionComplete = compileFunction('isQuestionComplete', {
    isAnsweredValue,
    getQuestionValue,
    isQuestionNotRelevant
  });
  const moduleProgress = compileFunction('moduleProgress', {
    isModuleActive: () => true,
    isItemVisible: item => item.visible !== false,
    isQuestionComplete
  });
  const module = {
    sections: [{
      items: [
        { id: 'required', type: 'question' },
        { id: 'optional-answered', type: 'question', required: false },
        { id: 'optional-skipped', type: 'question', required: false },
        { id: 'optional-hidden', type: 'question', required: false, visible: false }
      ]
    }]
  };
  const event = {
    questionMeta: {
      'optional-skipped': { notRelevant: true },
      required: { notRelevant: true }
    }
  };

  assert.deepEqual(moduleProgress(module, event), {
    active: true,
    answered: 3,
    total: 3,
    percent: 100
  });
});

test('marking any question not relevant clears its typed value without using an answer sentinel', () => {
  const optionalQuestion = { id: 'optional-question', type: 'question', required: false };
  const communicationsOwner = { id: 'event-communications-owner', type: 'question', required: false };
  const requiredQuestion = { id: 'required-question', type: 'question' };
  const itemIndex = new Map([
    [optionalQuestion.id, { item: optionalQuestion }],
    [communicationsOwner.id, { item: communicationsOwner }],
    [requiredQuestion.id, { item: requiredQuestion }]
  ]);
  const normaliseQuestionMeta = compileFunction('normaliseQuestionMeta');
  let invalidations = 0;
  let saves = 0;
  let renders = 0;
  const setQuestionNotRelevant = compileFunction('setQuestionNotRelevant', {
    itemIndex,
    normaliseQuestionMeta,
    reanchorEventDate: () => assert.fail('An ordinary optional question must not reanchor the event.'),
    buildDontKnowTask: () => null,
    invalidateTaskReviewConfirmations: () => { invalidations += 1; },
    normaliseAnswers: () => {},
    saveState: () => { saves += 1; },
    render: () => { renders += 1; }
  });
  const event = {
    answers: { 'optional-question': 17 },
    questionMeta: {},
    clonedAnswerHints: { 'optional-question': 12 },
    taskState: {}
  };

  assert.equal(setQuestionNotRelevant(event, optionalQuestion.id, true), true);
  assert.equal(event.answers[optionalQuestion.id], undefined);
  assert.equal(event.clonedAnswerHints[optionalQuestion.id], undefined);
  assert.deepEqual(event.questionMeta, { 'optional-question': { notRelevant: true } });
  assert.equal(invalidations, 1);
  assert.equal(saves, 1);
  assert.equal(renders, 1);

  assert.equal(setQuestionNotRelevant(event, optionalQuestion.id, false), true);
  assert.deepEqual(event.questionMeta, {});
  assert.equal(setQuestionNotRelevant(event, requiredQuestion.id, true), true);
  assert.deepEqual(event.questionMeta, { 'required-question': { notRelevant: true } });

  const communicationsEvent = {
    answers: { [communicationsOwner.id]: { kind: 'person', id: 'alice' } },
    questionMeta: {},
    clonedAnswerHints: {},
    taskState: {},
    lifecycle: {
      communicationsOwnerRef: { kind: 'person', id: 'alice' },
      communicationsOwner: 'Alice'
    }
  };
  assert.equal(setQuestionNotRelevant(communicationsEvent, communicationsOwner.id, true), true);
  assert.equal(communicationsEvent.answers[communicationsOwner.id], undefined);
  assert.equal(communicationsEvent.lifecycle.communicationsOwnerRef, null);
  assert.equal(communicationsEvent.lifecycle.communicationsOwner, '');
});

test('lifecycle fallback does not silently answer the optional communications-owner question', () => {
  const normaliseEventLifecycle = compileFunction('normaliseEventLifecycle', {
    EVENT_STATUS_DEFINITIONS: { provisional: {} },
    assignmentReference: value => value && typeof value === 'object' ? value : null,
    assignmentDisplay: value => value?.id === 'communications' ? 'Communications' : '',
    roleById: id => id === 'communications' ? { id } : null
  });
  const event = {
    answers: {},
    lifecycle: { status: 'provisional' },
    organiserRef: null,
    organiser: '',
    clonedAnswerHints: {}
  };

  normaliseEventLifecycle(event);

  assert.deepEqual(event.lifecycle.communicationsOwnerRef, { kind: 'role', id: 'communications' });
  assert.equal(event.answers['event-communications-owner'], undefined);
});

test('recording a real typed answer clears not relevant and preserves the original answer type', () => {
  const question = { id: 'optional-number', type: 'question', required: false };
  const itemIndex = new Map([[question.id, { item: question }]]);
  const clearQuestionNotRelevant = compileFunction('clearQuestionNotRelevant', { isQuestionNotRelevant });
  const event = {
    answers: {},
    questionMeta: { [question.id]: { notRelevant: true } },
    taskState: {},
    lifecycle: {},
    clonedAnswerHints: {}
  };
  const setQuestionAnswer = compileFunction('setQuestionAnswer', {
    itemIndex,
    hasRecordedQuestionValue,
    clearQuestionNotRelevant,
    reanchorEventDate: () => {},
    assignmentReference: value => value,
    assignmentDisplay: value => String(value),
    assignmentRecipient: () => ({ name: '' }),
    updateTeam: () => {},
    invalidateTaskReviewConfirmations: () => {},
    normaliseEventLifecycle: () => {},
    buildDontKnowTask: () => null,
    normaliseAnswers: () => {},
    playbook: { advisoryRules: [] },
    ensureOperationalTaskState: () => {},
    saveState: () => {},
    render: () => {}
  });

  setQuestionAnswer(event, question.id, 24);

  assert.equal(event.answers[question.id], 24);
  assert.equal(typeof event.answers[question.id], 'number');
  assert.deepEqual(event.questionMeta, {});
});

test('normalisation removes stale not-relevant metadata when a question becomes hidden', () => {
  const question = { id: 'conditional-optional', type: 'question', required: false };
  const playbook = { modules: [{ sections: [{ items: [question] }] }] };
  const itemIndex = new Map([[question.id, { item: question }]]);
  const normaliseQuestionMeta = compileFunction('normaliseQuestionMeta');
  const event = {
    answers: {},
    questionMeta: { [question.id]: { notRelevant: true } }
  };
  const normaliseAnswers = compileFunction('normaliseAnswers', {
    normaliseQuestionMeta,
    itemIndex,
    playbook,
    isModuleActive: () => true,
    isItemVisible: () => false,
    hasRecordedQuestionValue,
    getQuestionValue: () => undefined
  });

  normaliseAnswers(event);

  assert.deepEqual(event.questionMeta, {});
});

test('the question UI makes not relevant available to every question', () => {
  const renderQuestion = functionSource('renderQuestion');
  assert.match(renderQuestion, /data-question-not-relevant/);
  assert.match(renderQuestion, /aria-pressed/);
  assert.match(renderQuestion, /Not relevant — restore/);
  assert.match(source, /querySelectorAll\('\[data-question-not-relevant\]'\)/);
  assert.match(css, /\.optional-question-resolution/);
  assert.match(css, /\.choice-button\.not-relevant-choice\.selected/);
  assert.match(css, /\.question-item\.not-relevant/);
});

test('not-relevant state is serialized independently and represented in generated briefing input', () => {
  assert.match(functionSource('createEvent'), /questionMeta:\s*\{\}/);
  assert.match(functionSource('cloneEvent'), /copy\.questionMeta\s*=\s*\{\}/);
  assert.match(functionSource('exportEventPlan'), /questionMeta:\s*structuredClone/);
  assert.match(functionSource('briefingSourcePayload'), /answer:\s*['"]Not relevant['"]/);
  assert.match(functionSource('taskReviewState'), /isQuestionNotRelevant/);
  assert.doesNotMatch(functionSource('getQuestionValue'), /questionMeta|notRelevant/);
});
