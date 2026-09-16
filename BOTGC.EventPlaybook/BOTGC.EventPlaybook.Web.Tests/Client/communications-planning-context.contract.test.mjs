import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const playbookSource = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook-app.js', import.meta.url),
  'utf8');
const posterSource = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/poster-app.js', import.meta.url),
  'utf8');
const promptSource = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/Services/OpenAiPromptService.cs', import.meta.url),
  'utf8');
const emailSource = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/Services/MemberEmailComposer.cs', import.meta.url),
  'utf8');
const diarySource = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/Services/MemberDiaryComposer.cs', import.meta.url),
  'utf8');

function functionSource(source, name) {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = declaration.exec(source);
  assert.ok(match, `Expected source to declare ${name}().`);

  const followingDeclaration = /\n\s*(?:async\s+)?function\s+[A-Za-z0-9_$]+\s*\(/g;
  followingDeclaration.lastIndex = match.index + match[0].length;
  const next = followingDeclaration.exec(source);
  return source.slice(match.index, next?.index ?? source.length);
}

function compileFunction(source, name, dependencies = {}) {
  return Function(
    ...Object.keys(dependencies),
    `'use strict';\n${functionSource(source, name)}\nreturn ${name};`
  )(...Object.values(dependencies));
}

function question(id, answerType, options = [], extra = {}) {
  return {
    item: { id, type: 'question', answerType, options, ...extra },
    module: { id: 'admission' }
  };
}

test('playbook translates admission answers into readable Communications Centre planning facts', () => {
  const itemIndex = new Map([
    ['admission-arrangements', question('admission-arrangements', 'singleChoice', [
      { value: 'paid-entry', label: 'Paid tickets or admission, in advance and/or at the door' }
    ])],
    ['admission-free-entry', question('admission-free-entry', 'yesNo')],
    ['admission-free-categories', question('admission-free-categories', 'multiChoice', [
      { value: 'children', label: 'Children' }
    ])],
    ['admission-price-details', question('admission-price-details', 'text')],
    ['admission-payment-timing', question('admission-payment-timing', 'multiChoice', [
      { value: 'advance', label: 'In advance' },
      { value: 'door', label: 'At the door' }
    ])],
    ['admission-capacity', question('admission-capacity', 'number', [], { unit: 'places' })],
    ['ticket-sales-methods', question('ticket-sales-methods', 'multiChoice', [
      { value: 'member-system', label: 'Member system or club website' }
    ])],
    ['guest-table-booking', question('guest-table-booking', 'yesNo')],
    ['ticket-sales-open-date', question('ticket-sales-open-date', 'date')],
    ['ticket-sales-close-date', question('ticket-sales-close-date', 'date')],
    ['admission-public-instructions', question('admission-public-instructions', 'text')]
  ]);
  const event = {
    answers: {
      'admission-arrangements': 'paid-entry',
      'admission-free-entry': true,
      'admission-free-categories': ['children'],
      'admission-price-details': 'Adults £30; members £25. Includes supper.',
      'admission-payment-timing': ['advance', 'door'],
      'admission-capacity': 120,
      'ticket-sales-methods': ['member-system'],
      'guest-table-booking': false,
      'ticket-sales-open-date': '2026-10-01',
      'ticket-sales-close-date': '2026-11-30',
      'admission-public-instructions': 'Book at https://example.test/event'
    }
  };
  const formatBriefingAnswer = (item, value) => {
    const optionLabel = candidate => item.options?.find(option => option.value === candidate)?.label ?? candidate;
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) return value.map(optionLabel).join(', ');
    if (item.answerType === 'singleChoice') return optionLabel(value);
    if (item.answerType === 'date') return `UK date ${value}`;
    if (item.answerType === 'number' && item.unit) return `${value} ${item.unit}`;
    return String(value).trim();
  };
  const buildContext = compileFunction(playbookSource, 'buildCommunicationsPlanningContext', {
    itemIndex,
    isModuleActive: () => true,
    isItemVisible: () => true,
    getQuestionValue: (questionId, candidateEvent) => candidateEvent.answers[questionId],
    isAnsweredValue: value => value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0),
    formatBriefingAnswer
  });

  assert.deepEqual(buildContext(event), {
    registrationMode: 'Paid tickets or admission, in advance and/or at the door',
    freeEntry: 'Yes',
    freeEntryCategories: 'Children',
    ticketPriceDetails: 'Adults £30; members £25. Includes supper.',
    paymentTiming: 'In advance, At the door',
    maximumPlaces: '120 places',
    bookingRoutes: 'Member system or club website',
    guestTableBooking: 'No',
    bookingOpens: 'UK date 2026-10-01',
    bookingCloses: 'UK date 2026-11-30',
    publicBookingInstructions: 'Book at https://example.test/event'
  });
});

test('Poster Studio receives current planning facts and preserves a saved price override', () => {
  assert.match(playbookSource, /planningContext:\s*buildCommunicationsPlanningContext\(event\)/);

  const clonePlanningContext = compileFunction(posterSource, 'clonePlanningContext');
  const synchronise = compileFunction(posterSource, 'synchroniseSelectedEventContext', {
    clonePlanningContext
  });
  const context = {
    eventName: 'Club Dinner',
    eventDate: '2026-12-12',
    planningContext: { ticketPriceDetails: 'Adults £30; children £15' }
  };
  const fresh = {
    context,
    config: { events: [] },
    customEventName: '',
    form: { price: '', diaryTitle: '', diaryStartTime: '', diaryEndTime: '' }
  };
  synchronise(fresh, true);
  assert.equal(fresh.form.price, 'Adults £30; children £15');

  const restored = {
    context,
    config: { events: [] },
    customEventName: '',
    form: { price: 'Family ticket £70', diaryTitle: '', diaryStartTime: '', diaryEndTime: '' }
  };
  synchronise(restored, false);
  assert.equal(restored.form.price, 'Family ticket £70');

  const previouslySeeded = {
    context: {
      ...context,
      planningContext: { ticketPriceDetails: 'Adults £32; children £16' }
    },
    config: { events: [] },
    customEventName: '',
    form: {
      planningContext: { ticketPriceDetails: 'Adults £30; children £15' },
      price: 'Adults £30; children £15',
      diaryTitle: '',
      diaryStartTime: '',
      diaryEndTime: ''
    }
  };
  synchronise(previouslySeeded, false);
  assert.equal(previouslySeeded.form.price, 'Adults £32; children £16',
    'A price automatically seeded from planning should follow later planning changes.');
});

test('planning facts travel to every Communications Centre AI request', () => {
  for (const functionName of [
    'buildReferenceSelectionRequest',
    'generateConcept',
    'generatePrimary',
    'generateVariant',
    'generateMemberEmailDraft',
    'generateMemberDiaryDraft'
  ]) {
    assert.match(
      functionSource(posterSource, functionName),
      /planningContext:\s*(?:form|session\.form)\.planningContext/,
      `${functionName} should send the planning context.`
    );
  }

  assert.match(promptSource, /planningContext\s*=\s*request\.PlanningContext/g);
  assert.match(emailSource, /planningContext\s*=\s*request\.PlanningContext/);
  assert.match(diarySource, /planningContext\s*=\s*request\.PlanningContext/);
  assert.match(emailSource, /prices, dates, capacity, table-booking requirement and public booking instructions/);
  assert.match(diarySource, /prices, dates, capacity, table-booking requirement and public booking instructions/);
});
