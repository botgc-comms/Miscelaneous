import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook-app.js', import.meta.url),
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

test('role and person assignments compare by their resolved recipient', () => {
  const contacts = new Map([
    ['person-organiser', { id: 'person-organiser', name: 'Event organiser', email: 'organiser@example.test' }],
    ['person-comms', { id: 'person-comms', name: 'Communications owner', email: 'comms@example.test' }]
  ]);
  const roleContacts = new Map([
    ['event-coordinator', contacts.get('person-organiser')],
    ['communications', contacts.get('person-comms')]
  ]);
  const assignmentReference = value => value?.kind && value?.id ? value : null;
  const assignmentRecipient = value => {
    const contact = value.kind === 'person' ? contacts.get(value.id) : roleContacts.get(value.id);
    return { name: contact?.name ?? '', email: contact?.email ?? '' };
  };
  const sameRecipient = compileFunction('assignmentsResolveToSameRecipient', {
    assignmentReference,
    contactById: id => contacts.get(id) ?? null,
    contactForRole: id => roleContacts.get(id) ?? null,
    assignmentRecipient
  });

  assert.equal(sameRecipient(
    { kind: 'role', id: 'event-coordinator' },
    { kind: 'person', id: 'person-organiser' },
    {}), true);
  assert.equal(sameRecipient(
    { kind: 'role', id: 'event-coordinator' },
    { kind: 'role', id: 'communications' },
    {}), false);

  roleContacts.set('communications', contacts.get('person-organiser'));
  assert.equal(sameRecipient(
    { kind: 'role', id: 'event-coordinator' },
    { kind: 'role', id: 'communications' },
    {}), true);
});

test('a pure handover is omitted only when both sides resolve to the same person', () => {
  const handoverIsRequired = compileFunction('handoverIsRequired', {
    handoverAssignmentReference: descriptor => descriptor?.reference ?? null,
    assignmentsResolveToSameRecipient: (left, right) => left.id === right.id
  });
  const item = {
    handover: {
      from: { reference: { kind: 'person', id: 'same-person' } },
      to: { reference: { kind: 'role', id: 'same-person' } }
    }
  };

  assert.equal(handoverIsRequired({}, {}), true);
  assert.equal(handoverIsRequired(item, {}), false);
  item.handover.to.reference.id = 'different-person';
  assert.equal(handoverIsRequired(item, {}), true);
  item.handover.to.reference = null;
  assert.equal(handoverIsRequired(item, {}), true);
});

test('active-item visibility includes the ownership-boundary check', () => {
  const isItemVisible = compileFunction('isItemVisible', {
    conditionMatches: () => true,
    handoverIsRequired: item => item.handoverAllowed !== false
  });

  assert.equal(isItemVisible({ handoverAllowed: true }, {}), true);
  assert.equal(isItemVisible({ handoverAllowed: false }, {}), false);
});
