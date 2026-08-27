(() => {
  'use strict';

  const STORAGE_STATE = 'botgc-event-playbook-state-v2';
  const STORAGE_TEMPLATE = 'botgc-event-playbook-template-v1';
  const REFERENCE_LIBRARY_STORAGE = 'botgc-event-playbook-reference-library-v1';
  const STORAGE_SHARED_MIGRATED = 'botgc-event-playbook-shared-migration-v1';

  const DEFAULT_MILESTONE_OFFSETS = Object.freeze({
    B4: -60,
    B3: -20,
    B2: -7,
    CD: -7,
    B1: -1,
    GO: -1,
    DT: 0,
    A1: 1,
    A2: 7
  });

  const MILESTONE_LABELS = Object.freeze({
    B4: 'Initial planning',
    B3: 'Detailed planning',
    B2: 'Final arrangements',
    CD: 'Commitment decision',
    B1: 'Final checks',
    GO: 'Final go/no-go',
    DT: 'Event day',
    CX: 'Change response',
    A1: 'Immediate follow-up',
    A2: 'Post-event review'
  });

  const EVENT_STATUS_DEFINITIONS = Object.freeze({
    provisional: { label: 'Provisional', summary: 'Planning is under way, but operational commitments do not yet have a firm go-ahead.' },
    confirmed: { label: 'Confirmed', summary: 'The decision owner has confirmed that the event is proceeding.' },
    'at-risk': { label: 'At risk', summary: 'The event may change. Avoid new commitments until the recorded risk is resolved.' },
    postponed: { label: 'Postponed', summary: 'The event will not proceed on the current date. The change-response checklist is active.' },
    cancelled: { label: 'Cancelled', summary: 'The event has been cancelled. The change-response checklist is active.' },
    completed: { label: 'Completed', summary: 'The event has finished and can be reviewed or reused.' }
  });

  const CHANGE_RESPONSE_STATUSES = new Set(['cancelled', 'postponed']);

  const PLATFORM_ROLE_DEFINITIONS = Object.freeze([
    { id: 'team-member', name: 'Team member', description: 'Can receive and complete assigned tasks.' },
    { id: 'organiser', name: 'Organiser', description: 'Can create events and manage event planning.' },
    { id: 'admin', name: 'Admin', description: 'Can manage the directory and Playbook configuration.' }
  ]);

  const app = document.getElementById('app');
  const playbookFileInput = document.getElementById('playbook-file-input');

  let playbook = null;
  let itemIndex = new Map();
  let moduleIndex = new Map();
  let state = loadState();
  let sharedStateReady = false;
  let sharedStateRevision = 0;
  let lastSyncedSharedState = null;
  let sharedStateSaveTimer = null;
  let sharedStateSaveInFlight = false;
  let sharedStateSavePending = false;
  let applyingSharedState = false;
  const requestedView = new URLSearchParams(window.location.search).get('view');
  if (['tasks', 'catalogue', 'artwork', 'retrospective', 'admin', 'references', 'directory'].includes(requestedView)) {
    state.activeView = requestedView;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_STATE);
      if (!raw) {
        return {
          activeEventId: null,
          activeView: 'catalogue',
          taskFilter: 'open',
          deadlineOffsets: {},
          roles: [],
          contacts: [],
          notificationOutbox: [],
          adminDraftItems: [],
          adminDraftAdvisories: [],
          events: []
        };
      }

      const parsed = JSON.parse(raw);
      return {
        activeEventId: parsed.activeEventId ?? null,
        activeView: parsed.activeView ?? 'catalogue',
        taskFilter: parsed.taskFilter ?? 'open',
        deadlineOffsets: parsed.deadlineOffsets && typeof parsed.deadlineOffsets === 'object' ? parsed.deadlineOffsets : {},
        roles: Array.isArray(parsed.roles) ? parsed.roles : [],
        contacts: Array.isArray(parsed.contacts) ? parsed.contacts : [],
        notificationOutbox: Array.isArray(parsed.notificationOutbox) ? parsed.notificationOutbox : [],
        adminDraftItems: Array.isArray(parsed.adminDraftItems) ? parsed.adminDraftItems : [],
        adminDraftAdvisories: Array.isArray(parsed.adminDraftAdvisories) ? parsed.adminDraftAdvisories : [],
        events: Array.isArray(parsed.events) ? parsed.events : []
      };
    } catch {
      return {
        activeEventId: null,
        activeView: 'catalogue',
        taskFilter: 'open',
        deadlineOffsets: {},
        roles: [],
        contacts: [],
        notificationOutbox: [],
        adminDraftItems: [],
        events: []
      };
    }
  }

  function migrateMilestoneState() {
    const remap = { B5: 'B4', A7: 'A2' };

    if (state.deadlineOffsets && typeof state.deadlineOffsets === 'object') {
      for (const [oldCode, newCode] of Object.entries(remap)) {
        if (state.deadlineOffsets[oldCode] !== undefined && state.deadlineOffsets[newCode] === undefined) {
          state.deadlineOffsets[newCode] = state.deadlineOffsets[oldCode];
        }
        delete state.deadlineOffsets[oldCode];
      }
    }

    for (const event of state.events ?? []) {
      if (!event.milestoneDates || typeof event.milestoneDates !== 'object') continue;
      for (const [oldCode, newCode] of Object.entries(remap)) {
        if (event.milestoneDates[oldCode] && !event.milestoneDates[newCode]) {
          event.milestoneDates[newCode] = event.milestoneDates[oldCode];
        }
        delete event.milestoneDates[oldCode];
      }
    }
  }

  function migratePlaybookMilestoneCodes(candidate) {
    const copy = structuredClone(candidate);
    const remap = { B5: 'B4', A7: 'A2' };

    if (Array.isArray(copy.deadlineCodes)) {
      for (const item of copy.deadlineCodes) {
        item.code = remap[item.code] ?? item.code;
        if (item.code === 'B4') item.label = 'Initial planning';
        if (item.code === 'A2') item.label = 'Post-event review';
      }
    }

    for (const module of copy.modules ?? []) {
      for (const section of module.sections ?? []) {
        for (const item of section.items ?? []) {
          if (item.deadlineCode) item.deadlineCode = remap[item.deadlineCode] ?? item.deadlineCode;
        }
      }
    }

    return copy;
  }

  function saveState() {
    localStorage.setItem(STORAGE_STATE, JSON.stringify(state));
    if (sharedStateReady && !applyingSharedState) scheduleSharedStateSave();
  }

  function emptySharedState() {
    return {
      schemaVersion: 2,
      deadlineOffsets: {},
      roles: [],
      contacts: [],
      events: []
    };
  }

  function normaliseSharedState(value) {
    const candidate = value && typeof value === 'object' ? value : {};
    return {
      schemaVersion: 2,
      deadlineOffsets: candidate.deadlineOffsets && typeof candidate.deadlineOffsets === 'object'
        ? structuredClone(candidate.deadlineOffsets)
        : {},
      roles: Array.isArray(candidate.roles) ? structuredClone(candidate.roles) : [],
      contacts: Array.isArray(candidate.contacts) ? structuredClone(candidate.contacts) : [],
      events: Array.isArray(candidate.events) ? structuredClone(candidate.events) : []
    };
  }

  function getSharedStateSnapshot() {
    return normaliseSharedState({
      deadlineOffsets: state.deadlineOffsets,
      roles: state.roles,
      contacts: state.contacts,
      events: state.events
    });
  }

  function valuesEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function mergeChangedValue(base, local, remote) {
    if (valuesEqual(local, base)) return structuredClone(remote);
    if (valuesEqual(remote, base)) return structuredClone(local);
    const localIsObject = local && typeof local === 'object' && !Array.isArray(local);
    const remoteIsObject = remote && typeof remote === 'object' && !Array.isArray(remote);
    const baseObject = base && typeof base === 'object' && !Array.isArray(base) ? base : {};
    if (!localIsObject || !remoteIsObject) return structuredClone(local);

    const merged = {};
    const keys = new Set([...Object.keys(baseObject), ...Object.keys(local), ...Object.keys(remote)]);
    for (const key of keys) {
      const value = mergeChangedValue(baseObject[key], local[key], remote[key]);
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  }

  function mergeEntitiesById(baseItems, localItems, remoteItems) {
    const base = new Map((baseItems ?? []).filter(item => item?.id).map(item => [item.id, item]));
    const local = new Map((localItems ?? []).filter(item => item?.id).map(item => [item.id, item]));
    const remote = new Map((remoteItems ?? []).filter(item => item?.id).map(item => [item.id, item]));
    const order = [...new Set([...(remoteItems ?? []).map(item => item?.id), ...(localItems ?? []).map(item => item?.id)].filter(Boolean))];
    const merged = [];

    for (const id of order) {
      const baseItem = base.get(id);
      const localItem = local.get(id);
      const remoteItem = remote.get(id);
      if (!localItem && !remoteItem) continue;
      if (!baseItem) {
        merged.push(localItem && remoteItem ? mergeChangedValue({}, localItem, remoteItem) : structuredClone(localItem ?? remoteItem));
        continue;
      }
      if (!localItem) {
        if (!valuesEqual(remoteItem, baseItem)) merged.push(structuredClone(remoteItem));
        continue;
      }
      if (!remoteItem) {
        if (!valuesEqual(localItem, baseItem)) merged.push(structuredClone(localItem));
        continue;
      }
      merged.push(mergeChangedValue(baseItem, localItem, remoteItem));
    }
    return merged;
  }

  function mergeSharedStates(baseValue, localValue, remoteValue) {
    const base = normaliseSharedState(baseValue);
    const local = normaliseSharedState(localValue);
    const remote = normaliseSharedState(remoteValue);
    return {
      schemaVersion: 2,
      deadlineOffsets: mergeChangedValue(base.deadlineOffsets, local.deadlineOffsets, remote.deadlineOffsets),
      roles: mergeEntitiesById(base.roles, local.roles, remote.roles),
      contacts: mergeEntitiesById(base.contacts, local.contacts, remote.contacts),
      events: mergeEntitiesById(base.events, local.events, remote.events)
    };
  }

  function applySharedState(sharedValue) {
    const shared = normaliseSharedState(sharedValue);
    applyingSharedState = true;
    state.deadlineOffsets = shared.deadlineOffsets;
    state.roles = shared.roles;
    state.contacts = shared.contacts;
    state.events = shared.events;
    if (state.activeEventId && !state.events.some(event => event.id === state.activeEventId)) {
      state.activeEventId = null;
      state.activeView = 'catalogue';
    }
    localStorage.setItem(STORAGE_STATE, JSON.stringify(state));
    applyingSharedState = false;
  }

  function scheduleSharedStateSave(delay = 450) {
    if (!sharedStateReady) return;
    if (sharedStateSaveTimer) clearTimeout(sharedStateSaveTimer);
    sharedStateSaveTimer = setTimeout(() => {
      sharedStateSaveTimer = null;
      persistSharedState();
    }, delay);
  }

  async function persistSharedState() {
    if (!sharedStateReady) return false;
    if (sharedStateSaveInFlight) {
      sharedStateSavePending = true;
      return false;
    }

    const localSnapshot = getSharedStateSnapshot();
    if (lastSyncedSharedState && valuesEqual(localSnapshot, lastSyncedSharedState)) return true;

    sharedStateSaveInFlight = true;
    let retry = false;
    let saved = false;
    try {
      const response = await fetch('/api/shared-state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: sharedStateRevision, state: localSnapshot })
      });
      const document = await response.json();
      if (response.status === 409) {
        const remote = normaliseSharedState(document.state);
        const merged = mergeSharedStates(lastSyncedSharedState ?? emptySharedState(), localSnapshot, remote);
        sharedStateRevision = Number(document.revision) || 0;
        lastSyncedSharedState = remote;
        applySharedState(merged);
        retry = true;
      } else if (!response.ok) {
        throw new Error(document?.error ?? `Shared state save failed (${response.status}).`);
      } else {
        sharedStateRevision = Number(document.revision) || sharedStateRevision + 1;
        lastSyncedSharedState = normaliseSharedState(document.state ?? localSnapshot);
        saved = true;
      }
    } catch (error) {
      console.warn('Unable to save the shared event workspace. The browser cache is still available.', error);
      retry = true;
    } finally {
      sharedStateSaveInFlight = false;
      if (retry || sharedStateSavePending) {
        sharedStateSavePending = false;
        scheduleSharedStateSave(retry ? 1500 : 100);
      }
    }
    return saved;
  }

  async function pollSharedState() {
    if (!sharedStateReady || sharedStateSaveInFlight) return;
    if (document.activeElement?.matches?.('input, textarea, select, [contenteditable="true"]')) return;
    try {
      const response = await fetch('/api/shared-state', { cache: 'no-store' });
      if (!response.ok) return;
      const document = await response.json();
      const revision = Number(document.revision) || 0;
      if (revision <= sharedStateRevision || !document.state) return;

      const remote = normaliseSharedState(document.state);
      const local = getSharedStateSnapshot();
      const hasLocalChanges = lastSyncedSharedState && !valuesEqual(local, lastSyncedSharedState);
      const next = hasLocalChanges
        ? mergeSharedStates(lastSyncedSharedState, local, remote)
        : remote;
      sharedStateRevision = revision;
      lastSyncedSharedState = remote;
      applySharedState(next);
      render();
      if (hasLocalChanges) scheduleSharedStateSave(100);
    } catch (error) {
      console.warn('Unable to refresh the shared event workspace.', error);
    }
  }

  async function initialiseSharedState() {
    try {
      const browserSnapshot = getSharedStateSnapshot();
      const shouldMigrateBrowserData = localStorage.getItem(STORAGE_SHARED_MIGRATED) !== '1';
      const response = await fetch('/api/shared-state', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Shared state load failed (${response.status}).`);
      const document = await response.json();
      sharedStateRevision = Number(document.revision) || 0;
      let needsMigrationSave = false;
      if (document.state) {
        const remote = normaliseSharedState(document.state);
        lastSyncedSharedState = remote;
        let initial = remote;
        if (shouldMigrateBrowserData) {
          const remoteEventIds = new Set(remote.events.map(event => event.id));
          const remoteContactIds = new Set(remote.contacts.map(contact => contact.id));
          const legacyEvents = browserSnapshot.events.filter(event => event?.id && !remoteEventIds.has(event.id));
          const legacyContacts = browserSnapshot.contacts.filter(contact => contact?.id && !remoteContactIds.has(contact.id));
          needsMigrationSave = legacyEvents.length > 0 || legacyContacts.length > 0;
          if (needsMigrationSave) {
            initial = normaliseSharedState({
              deadlineOffsets: Object.keys(remote.deadlineOffsets).length > 0
                ? remote.deadlineOffsets
                : browserSnapshot.deadlineOffsets,
              contacts: [...remote.contacts, ...legacyContacts],
              events: [...remote.events, ...legacyEvents]
            });
          }
        }
        applySharedState(initial);
      } else {
        lastSyncedSharedState = emptySharedState();
        needsMigrationSave = browserSnapshot.events.length > 0 || browserSnapshot.contacts.length > 0;
      }
      sharedStateReady = true;
      if (needsMigrationSave) {
        const migrated = await persistSharedState();
        if (migrated && valuesEqual(getSharedStateSnapshot(), lastSyncedSharedState)) {
          localStorage.setItem(STORAGE_SHARED_MIGRATED, '1');
        }
      } else if (shouldMigrateBrowserData) {
        localStorage.setItem(STORAGE_SHARED_MIGRATED, '1');
      }
      window.setInterval(pollSharedState, 7000);
    } catch (error) {
      console.warn('Shared storage is unavailable; continuing with this browser cache.', error);
      sharedStateReady = false;
    }
  }

  async function loadInitialPlaybook() {
    const storedTemplate = localStorage.getItem(STORAGE_TEMPLATE);
    if (storedTemplate) {
      try {
        return JSON.parse(storedTemplate);
      } catch {
        localStorage.removeItem(STORAGE_TEMPLATE);
      }
    }

    if (window.EMBEDDED_PLAYBOOK) {
      return structuredClone(window.EMBEDDED_PLAYBOOK);
    }

    const response = await fetch('./event-playbook.json');
    if (!response.ok) {
      throw new Error(`Unable to load event-playbook.json (${response.status}).`);
    }

    return response.json();
  }

  function buildDontKnowTask(question) {
    if (!question?.allowDontKnow || !question.dontKnowTask) return null;
    return {
      ...question.dontKnowTask,
      id: question.dontKnowTask.id ?? `${question.id}-decision-task`,
      type: 'task',
      decisionForQuestionId: question.id,
      showWhen: {
        all: [
          {
            questionId: question.id,
            operator: 'equals',
            value: 'dont-know'
          }
        ]
      }
    };
  }

  function validatePlaybook(candidate) {
    if (!candidate || typeof candidate !== 'object') {
      throw new Error('The selected file does not contain a JSON object.');
    }
    if (!Array.isArray(candidate.modules) || candidate.modules.length === 0) {
      throw new Error('The playbook must contain at least one module.');
    }
    if (!Array.isArray(candidate.deadlineCodes)) {
      throw new Error('The playbook must contain a deadlineCodes array.');
    }

    const ids = new Set();
    const itemTypes = new Map();
    const questions = new Map();
    const tasks = [];
    const deadlineCodes = new Set(candidate.deadlineCodes.map(item => item.code));
    const roleIds = new Set((candidate.responsibilityRoles ?? []).map(item => item.id));

    for (const module of candidate.modules) {
      if (!module.id || !module.title || !Array.isArray(module.sections)) {
        throw new Error('Every module must have an id, title and sections array.');
      }
      for (const section of module.sections) {
        if (!Array.isArray(section.items)) {
          throw new Error(`Section ${section.id ?? section.title ?? '(unknown)'} must contain an items array.`);
        }
        for (const item of section.items) {
          if (!item.id || !item.type) throw new Error('Every item must have an id and type.');
          if (ids.has(item.id)) throw new Error(`Duplicate item id: ${item.id}`);
          ids.add(item.id);
          itemTypes.set(item.id, item.type);
          if (item.type === 'question') questions.set(item.id, item);
          if (item.type === 'task') tasks.push(item);
        }
      }
    }

    for (const question of questions.values()) {
      if (question.allowDontKnow && !question.dontKnowTask) {
        throw new Error(`${question.id} allows Don't know but does not define a decision task.`);
      }
      const decisionTask = buildDontKnowTask(question);
      if (!decisionTask) continue;
      if (ids.has(decisionTask.id)) throw new Error(`Duplicate item id: ${decisionTask.id}`);
      ids.add(decisionTask.id);
      itemTypes.set(decisionTask.id, 'task');
      tasks.push(decisionTask);
    }

    function referencedQuestions(condition, result = []) {
      if (!condition) return result;
      if (condition.questionId) result.push(condition.questionId);
      for (const part of condition.all ?? []) referencedQuestions(part, result);
      for (const part of condition.any ?? []) referencedQuestions(part, result);
      if (condition.not) referencedQuestions(condition.not, result);
      return result;
    }

    for (const module of candidate.modules) {
      for (const questionId of referencedQuestions(module.activation)) {
        if (itemTypes.get(questionId) !== 'question') throw new Error(`Module ${module.id} references missing question ${questionId}.`);
      }
      for (const section of module.sections) {
        for (const item of section.items) {
          for (const questionId of referencedQuestions(item.showWhen)) {
            if (itemTypes.get(questionId) !== 'question') throw new Error(`${item.id} references missing question ${questionId}.`);
          }
        }
      }
    }

    for (const task of tasks) {
      if (task.deadlineCode && !deadlineCodes.has(task.deadlineCode)) throw new Error(`${task.id} uses unknown deadline code ${task.deadlineCode}.`);
      if (task.defaultOwnerRoleId && !roleIds.has(task.defaultOwnerRoleId)) throw new Error(`${task.id} uses unknown owner role ${task.defaultOwnerRoleId}.`);
    }

    for (const advisory of candidate.advisoryRules ?? []) {
      if (itemTypes.get(advisory.targetQuestionId) !== 'question') throw new Error(`Advisory ${advisory.id} targets missing question ${advisory.targetQuestionId}.`);
    }

    const graph = new Map();
    for (const [id, question] of questions) graph.set(id, referencedQuestions(question.showWhen));
    const visiting = new Set();
    const visited = new Set();
    function visit(id) {
      if (visiting.has(id)) throw new Error(`Circular question visibility rule detected at ${id}.`);
      if (visited.has(id)) return;
      visiting.add(id);
      for (const dependency of graph.get(id) ?? []) if (graph.has(dependency)) visit(dependency);
      visiting.delete(id);
      visited.add(id);
    }
    for (const id of graph.keys()) visit(id);
  }

  function indexPlaybook() {
    itemIndex = new Map();
    moduleIndex = new Map();

    for (const module of playbook.modules) {
      moduleIndex.set(module.id, module);
      for (const section of module.sections) {
        for (const item of section.items) {
          itemIndex.set(item.id, { item, module, section });
          const decisionTask = buildDontKnowTask(item);
          if (decisionTask) itemIndex.set(decisionTask.id, { item: decisionTask, module, section });
        }
      }
    }
  }

  function createEvent(name, organiser = '', eventDate = '', description = '', milestoneDates = {}, organiserRef = null) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const resolvedOrganiserRef = assignmentReference(organiserRef ?? organiser);
    const organiserName = assignmentDisplay(resolvedOrganiserRef ?? organiser, organiser);
    const event = {
      id,
      name: name || 'Untitled event',
      organiser: organiserName,
      organiserRef: resolvedOrganiserRef,
      eventDate,
      description,
      createdAt: now,
      closedAt: null,
      answers: organiserName ? { 'event-decision-owner': resolvedOrganiserRef ?? organiserName } : {},
      taskState: {},
      team: organiserName ? [organiserName] : [],
      advisoryOverrides: {},
      retrospective: {},
      milestoneDates: { ...milestoneDates, DT: eventDate || milestoneDates.DT || '' },
      lifecycle: {
        status: 'provisional',
        statusChangedAt: now,
        decisionOwner: organiserName,
        decisionOwnerRef: resolvedOrganiserRef,
        communicationsOwner: '',
        communicationsOwnerRef: null,
        changedBy: organiserName,
        reason: '',
        memberUpdate: '',
        interestedParties: [],
        history: []
      },
      playbookVersion: playbook?.schemaVersion ?? '1.0',
      sourceEventId: null,
      cataloguePosterThumbnail: null
    };

    state.events.push(event);
    state.activeEventId = id;
    state.activeView = 'module:start';
    saveState();
    return event;
  }

  function addDaysToIsoDate(isoDate, days) {
    if (!isoDate) return '';
    const date = new Date(`${isoDate}T12:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    date.setDate(date.getDate() + Number(days || 0));
    return toIsoDate(date);
  }

  function daysBetweenIsoDates(fromIsoDate, toIsoDate) {
    if (!fromIsoDate || !toIsoDate) return null;
    const from = new Date(`${fromIsoDate}T12:00:00`);
    const to = new Date(`${toIsoDate}T12:00:00`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
    return Math.round((to.getTime() - from.getTime()) / 86400000);
  }

  function formatMilestoneOffset(offset) {
    const days = Number(offset);
    if (!Number.isFinite(days)) return '';
    if (days === 0) return 'Event day';
    return `${days > 0 ? '+' : ''}${days} day${Math.abs(days) === 1 ? '' : 's'}`;
  }

  function defaultMilestoneDates(eventDate) {
    const result = {};
    for (const [code, offset] of Object.entries(DEFAULT_MILESTONE_OFFSETS)) {
      result[code] = eventDate ? addDaysToIsoDate(eventDate, offset) : '';
    }
    return result;
  }

  function normaliseMilestoneDates(event) {
    event.milestoneDates ??= {};
    if (event.eventDate) {
      event.milestoneDates.DT = event.eventDate;
      const defaults = defaultMilestoneDates(event.eventDate);
      for (const code of Object.keys(DEFAULT_MILESTONE_OFFSETS)) {
        if (!event.milestoneDates[code]) event.milestoneDates[code] = defaults[code];
      }
    }
    if (CHANGE_RESPONSE_STATUSES.has(event.lifecycle?.status) && event.lifecycle?.statusChangedAt) {
      event.milestoneDates.CX = localDateFromTimestamp(event.lifecycle.statusChangedAt);
    }
  }

  function normaliseEventLifecycle(event) {
    const fallbackStatus = event.closedAt ? 'completed' : 'provisional';
    event.lifecycle = event.lifecycle && typeof event.lifecycle === 'object' ? event.lifecycle : {};
    if (!EVENT_STATUS_DEFINITIONS[event.lifecycle.status]) event.lifecycle.status = fallbackStatus;
    event.lifecycle.statusChangedAt ??= event.closedAt ?? event.createdAt ?? new Date().toISOString();
    event.organiserRef = assignmentReference(event.organiserRef ?? event.organiser);
    if (event.organiserRef) event.organiser = assignmentDisplay(event.organiserRef, event.organiser);

    const decisionRef = assignmentReference(event.lifecycle.decisionOwnerRef ?? event.answers?.['event-decision-owner'] ?? event.organiserRef ?? event.lifecycle.decisionOwner ?? event.organiser);
    event.lifecycle.decisionOwnerRef = decisionRef;
    event.lifecycle.decisionOwner = assignmentDisplay(decisionRef ?? event.lifecycle.decisionOwner ?? event.organiser, event.lifecycle.decisionOwner || event.organiser || '');

    let communicationsRef = assignmentReference(event.lifecycle.communicationsOwnerRef ?? event.answers?.['event-communications-owner'] ?? event.lifecycle.communicationsOwner);
    if (!communicationsRef && !event.lifecycle.communicationsOwner) communicationsRef = roleById('communications') ? { kind: 'role', id: 'communications' } : null;
    event.lifecycle.communicationsOwnerRef = communicationsRef;
    event.lifecycle.communicationsOwner = assignmentDisplay(communicationsRef ?? event.lifecycle.communicationsOwner, event.lifecycle.communicationsOwner || '');
    event.lifecycle.changedBy ??= event.organiser ?? '';
    event.lifecycle.reason ??= '';
    event.lifecycle.memberUpdate ??= '';
    event.lifecycle.interestedParties = Array.isArray(event.lifecycle.interestedParties) ? event.lifecycle.interestedParties : [];
    event.lifecycle.history = Array.isArray(event.lifecycle.history) ? event.lifecycle.history : [];
    event.answers ??= {};
    if (!event.answers['event-decision-owner'] && event.lifecycle.decisionOwner) {
      event.answers['event-decision-owner'] = event.lifecycle.decisionOwnerRef ?? event.lifecycle.decisionOwner;
    }
    if (!event.answers['event-communications-owner'] && event.lifecycle.communicationsOwner) {
      event.answers['event-communications-owner'] = event.lifecycle.communicationsOwnerRef ?? event.lifecycle.communicationsOwner;
    }
    return event.lifecycle;
  }

  function getActiveEvent() {
    let event = state.events.find(item => item.id === state.activeEventId) ?? null;
    if (!event && state.events.length > 0) {
      event = state.events[0];
      state.activeEventId = event.id;
    }
    if (event) {
      event.answers ??= {};
      event.taskState ??= {};
      event.team ??= [];
      event.advisoryOverrides ??= {};
      event.retrospective ??= {};
      event.playbookVersion ??= playbook?.schemaVersion ?? '1.0';
      event.sourceEventId ??= null;
      event.name ??= 'Untitled event';
      event.organiser ??= '';
      event.organiserRef = assignmentReference(event.organiserRef ?? event.organiser);
      if (event.organiserRef) event.organiser = assignmentDisplay(event.organiserRef, event.organiser);
      event.eventDate ??= '';
      event.description ??= '';
      normaliseEventLifecycle(event);
      saveState();
    }
    return event;
  }

  function getQuestionValue(questionId, event) {
    const indexed = itemIndex.get(questionId);
    if (!indexed || indexed.item.type !== 'question') {
      return undefined;
    }

    if (indexed.item.bind === 'eventDate') {
      return event.eventDate || undefined;
    }

    return event.answers[questionId];
  }

  function conditionMatches(condition, event) {
    if (!condition) {
      return true;
    }

    if (condition.always === true) {
      return true;
    }

    if (Array.isArray(condition.all)) {
      return condition.all.every(part => conditionMatches(part, event));
    }

    if (Array.isArray(condition.any)) {
      return condition.any.some(part => conditionMatches(part, event));
    }

    if (condition.not) {
      return !conditionMatches(condition.not, event);
    }

    const actual = condition.evidenceArea
      ? hasCancellationEvidence(event, condition.evidenceArea)
      : condition.eventField
        ? condition.eventField.split('.').reduce((value, key) => value?.[key], event)
        : getQuestionValue(condition.questionId, event);
    switch (condition.operator) {
      case 'equals':
        return actual === condition.value;
      case 'notEquals':
        return actual !== condition.value;
      case 'in':
        return Array.isArray(condition.value) && condition.value.includes(actual);
      case 'contains':
        return Array.isArray(actual) && actual.includes(condition.value);
      case 'answered':
        return isAnsweredValue(actual);
      default:
        return false;
    }
  }

  function isModuleActive(module, event) {
    return conditionMatches(module.activation, event);
  }

  function isItemVisible(item, event) {
    return conditionMatches(item.showWhen, event);
  }

  function taskStateShowsBriefingOrCommitment(taskState) {
    if (!taskState || typeof taskState !== 'object') return false;
    return taskState.completed === true ||
      taskState.assignedBy === 'manual' ||
      Boolean(taskState.notes?.trim()) ||
      taskState.notificationStatus === 'sent';
  }

  function hasCancellationEvidence(event, area) {
    const answerSignals = {
      'Food & Beverage': [],
      Communications: ['member-communications-sent'],
      'Golf Operations': ['tee-times-reserved'],
      Clubhouse: [],
      Course: []
    };
    if ((answerSignals[area] ?? []).some(questionId => getQuestionValue(questionId, event) === true)) return true;

    return Object.entries(event.taskState ?? {}).some(([taskId, taskState]) => {
      const indexed = itemIndex.get(taskId);
      if (!indexed?.item || indexed.module?.id === 'event-control') return false;
      return indexed.item.responsibleArea === area && taskStateShowsBriefingOrCommitment(taskState);
    });
  }

  function deriveCancellationStakeholders(event) {
    const stakeholders = [];
    const seen = new Set();
    const add = (name, area) => {
      const cleanedName = String(name ?? '').trim();
      const cleanedArea = String(area ?? '').trim();
      if (!cleanedName && !cleanedArea) return;
      const key = `${cleanedName.toLocaleLowerCase()}|${cleanedArea.toLocaleLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      stakeholders.push({ name: cleanedName, area: cleanedArea });
    };

    for (const [taskId, taskState] of Object.entries(event.taskState ?? {})) {
      const indexed = itemIndex.get(taskId);
      if (!indexed?.item || indexed.module?.id === 'event-control' || !taskStateShowsBriefingOrCommitment(taskState)) continue;
      add(taskState.assignee, indexed.item.responsibleArea);
    }

    const areaOwners = [
      ['Food & Beverage', 'food-beverage-manager', 'food-beverage'],
      ['Clubhouse', 'clubhouse', 'clubhouse'],
      ['Golf Operations', 'golf-manager', 'golf'],
      ['Course', 'greens', 'golf'],
      ['Communications', 'communications', 'communications']
    ];
    const selectedAreas = getQuestionValue('event-affected-areas', event) ?? [];
    for (const [area, roleId, affectedAreaValue] of areaOwners) {
      if (!selectedAreas.includes(affectedAreaValue) && !hasCancellationEvidence(event, area)) continue;
      add(contactForRole(roleId, event)?.name, area);
    }

    if (selectedAreas.includes('suppliers')) add('', 'External suppliers or performers');
    if (selectedAreas.includes('staffing')) add('', 'Other staff or volunteers');
    return stakeholders;
  }

  function normaliseAnswers(event) {
    let changed = true;
    let loops = 0;
    while (changed && loops < 20) {
      changed = false;
      loops += 1;
      for (const module of playbook.modules) {
        if (!isModuleActive(module, event)) {
          continue;
        }
        for (const section of module.sections) {
          for (const item of section.items) {
            if (item.type !== 'question' || item.bind) {
              continue;
            }
            if (!isItemVisible(item, event) && Object.prototype.hasOwnProperty.call(event.answers, item.id)) {
              delete event.answers[item.id];
              changed = true;
            }
          }
        }
      }
    }
  }

  function isAnsweredValue(value) {
    if (value === undefined || value === null || value === '' || value === 'dont-know') {
      return false;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    if (typeof value === 'object') {
      const values = Object.values(value);
      return values.length > 0 && values.every(entry => entry !== undefined && entry !== null && entry !== '');
    }
    return true;
  }

  function moduleProgress(module, event) {
    if (!isModuleActive(module, event)) {
      return { active: false, answered: 0, total: 0, percent: 0 };
    }

    const questions = [];
    for (const section of module.sections) {
      for (const item of section.items) {
        if (item.type === 'question' && item.required !== false && isItemVisible(item, event)) {
          questions.push(item);
        }
      }
    }

    const answered = questions.filter(item => isAnsweredValue(getQuestionValue(item.id, event))).length;
    const total = questions.length;
    return {
      active: true,
      answered,
      total,
      percent: total === 0 ? 100 : Math.round((answered / total) * 100)
    };
  }

  function initialiseOperationalState() {
    const bundledRoles = playbook.responsibilityRoles ?? [];
    const existingRoles = new Map((Array.isArray(state.roles) ? state.roles : []).filter(role => role?.id).map(role => [role.id, role]));
    state.roles = bundledRoles.map(role => normaliseDirectoryRole({ ...role, ...(existingRoles.get(role.id) ?? {}) }));
    for (const role of existingRoles.values()) {
      if (!state.roles.some(candidate => candidate.id === role.id)) state.roles.push(normaliseDirectoryRole(role));
    }

    if (!Array.isArray(state.contacts) || state.contacts.length === 0) state.contacts = structuredClone(playbook.defaultContacts ?? []);
    state.contacts = state.contacts.map(normaliseDirectoryContact);

    let simon = state.contacts.find(contact => contact.email?.toLocaleLowerCase() === 'simon@maraboustork.co.uk')
      ?? state.contacts.find(contact => contact.name?.toLocaleLowerCase() === 'simon parsons');
    if (!simon) {
      simon = normaliseDirectoryContact({
        id: 'person-simon-parsons',
        type: 'person',
        name: 'Simon Parsons',
        email: 'simon@maraboustork.co.uk',
        phone: '',
        roleIds: ['communications'],
        platformRoleIds: ['organiser', 'admin'],
        canLogin: true,
        canReceiveTasks: true,
        active: true
      });
      state.contacts.push(simon);
    } else {
      if (!simon.email) simon.email = 'simon@maraboustork.co.uk';
      simon.roleIds = [...new Set([...(simon.roleIds ?? []), 'communications'])];
      simon.platformRoleIds = [...new Set([...(simon.platformRoleIds ?? []), 'organiser', 'admin'])];
      simon.canLogin = true;
      simon.canReceiveTasks = true;
    }

    const communicationsRole = state.roles.find(role => role.id === 'communications');
    if (communicationsRole && !communicationsRole.ownerContactId) communicationsRole.ownerContactId = simon.id;
    saveState();
  }

  function normaliseDirectoryRole(value) {
    const role = value && typeof value === 'object' ? value : {};
    return {
      id: String(role.id || crypto.randomUUID()),
      name: String(role.name || 'New role').trim(),
      area: String(role.area || '').trim(),
      ownerContactId: String(role.ownerContactId || '').trim(),
      mailboxEmail: String(role.mailboxEmail || '').trim(),
      fallbackRoleId: String(role.fallbackRoleId || '').trim() || null,
      active: role.active !== false,
      selectableForTasks: role.selectableForTasks !== false,
      source: role.source || 'directory'
    };
  }

  function normaliseDirectoryContact(value) {
    const contact = value && typeof value === 'object' ? value : {};
    const matchingRole = (playbook?.responsibilityRoles ?? []).find(role => role.name?.toLocaleLowerCase() === String(contact.name ?? '').toLocaleLowerCase());
    const inferredType = matchingRole && !contact.email ? 'mailbox' : 'person';
    return {
      id: String(contact.id || crypto.randomUUID()),
      type: contact.type === 'mailbox' ? 'mailbox' : (contact.type === 'person' ? 'person' : inferredType),
      name: String(contact.name || 'New person').trim(),
      email: String(contact.email || '').trim(),
      phone: String(contact.phone || '').trim(),
      roleIds: Array.isArray(contact.roleIds) ? [...new Set(contact.roleIds.filter(Boolean).map(String))] : [],
      platformRoleIds: Array.isArray(contact.platformRoleIds) ? [...new Set(contact.platformRoleIds.filter(Boolean).map(String))] : [],
      canLogin: contact.canLogin === true,
      canReceiveTasks: contact.canReceiveTasks !== false,
      active: contact.active !== false,
      notes: String(contact.notes || '').trim()
    };
  }

  function responsibilityRoles() {
    return Array.isArray(state.roles) ? state.roles : [];
  }

  function roleById(roleId) {
    return responsibilityRoles().find(role => role.id === roleId) ?? null;
  }

  function contactById(contactId) {
    return (state.contacts ?? []).find(contact => contact.id === contactId) ?? null;
  }

  function contactForRole(roleId, event, visited = new Set()) {
    if (!roleId || visited.has(roleId)) return null;
    visited.add(roleId);

    if (roleId === 'event-coordinator' && event?.organiser) {
      const organiserContact = event.organiserRef?.kind === 'person'
        ? contactById(event.organiserRef.id)
        : state.contacts.find(contact => contact.active !== false && contact.name.toLocaleLowerCase() === event.organiser.toLocaleLowerCase());
      return organiserContact ?? { id: 'event-organiser', name: event.organiser, email: '', roleIds: ['event-coordinator'], active: true };
    }

    const role = roleById(roleId);
    const linkedContact = role?.ownerContactId ? contactById(role.ownerContactId) : null;
    if (linkedContact?.active !== false) return linkedContact;
    if (role?.mailboxEmail) return { id: `role-mailbox-${role.id}`, type: 'mailbox', name: role.name, email: role.mailboxEmail, roleIds: [role.id], active: true };

    const contact = state.contacts.find(candidate => candidate.active !== false && Array.isArray(candidate.roleIds) && candidate.roleIds.includes(roleId));
    if (contact) return contact;

    return role?.fallbackRoleId ? contactForRole(role.fallbackRoleId, event, visited) : null;
  }

  function assignmentReference(value) {
    if (value && typeof value === 'object' && ['person', 'role'].includes(value.kind) && value.id) {
      return { kind: value.kind, id: String(value.id) };
    }
    if (typeof value !== 'string' || !value.trim()) return null;
    return findAssignmentReference(value);
  }

  function findAssignmentReference(value, mode = 'person-or-role') {
    const search = String(value ?? '').trim().toLocaleLowerCase();
    if (!search) return null;
    const person = (state.contacts ?? []).find(contact => contact.active !== false && (
      contact.id.toLocaleLowerCase() === search ||
      contact.name.toLocaleLowerCase() === search ||
      contact.email?.toLocaleLowerCase() === search
    ));
    if (person && (mode !== 'person' || person.type === 'person')) return { kind: 'person', id: person.id };
    if (mode === 'person') return null;
    const role = responsibilityRoles().find(item => item.active !== false && (item.id.toLocaleLowerCase() === search || item.name.toLocaleLowerCase() === search));
    return role ? { kind: 'role', id: role.id } : null;
  }

  function assignmentDisplay(value, fallback = '') {
    const reference = assignmentReference(value);
    if (reference?.kind === 'person') return contactById(reference.id)?.name ?? fallback;
    if (reference?.kind === 'role') return roleById(reference.id)?.name ?? fallback;
    return typeof value === 'string' ? value : fallback;
  }

  function assignmentRecipient(value, event) {
    const reference = assignmentReference(value);
    if (reference?.kind === 'person') {
      const contact = contactById(reference.id);
      return contact ? { name: contact.name, email: contact.email ?? '' } : { name: '', email: '' };
    }
    if (reference?.kind === 'role') {
      const role = roleById(reference.id);
      const contact = contactForRole(reference.id, event);
      return {
        name: contact?.name || role?.name || '',
        email: contact?.email || role?.mailboxEmail || ''
      };
    }
    const name = typeof value === 'string' ? value : '';
    return { name, email: contactEmailByName(name) };
  }

  function taskAssignmentReference(taskState) {
    if (taskState?.assignmentKind && taskState?.assignmentId) {
      return assignmentReference({ kind: taskState.assignmentKind, id: taskState.assignmentId });
    }
    return assignmentReference(taskState?.assignee ?? '');
  }

  function assignmentOptions(mode = 'person-or-role', event = null) {
    const options = [];
    if (mode !== 'person') {
      for (const role of responsibilityRoles().filter(role => role.active !== false && role.selectableForTasks !== false)) {
        const recipient = assignmentRecipient({ kind: 'role', id: role.id }, event);
        options.push({
          kind: 'role',
          id: role.id,
          name: role.name,
          label: role.name,
          typeLabel: 'Role',
          detail: recipient.email ? `${recipient.name || 'Shared mailbox'} · ${recipient.email}` : 'Contact route not configured',
          search: `${role.name} ${role.area} ${recipient.name} ${recipient.email}`.toLocaleLowerCase()
        });
      }
    }
    for (const contact of (state.contacts ?? []).filter(contact => contact.active !== false && (mode === 'person' ? contact.type === 'person' : contact.canReceiveTasks !== false))) {
      const roleNames = (contact.roleIds ?? []).map(roleId => roleById(roleId)?.name).filter(Boolean);
      options.push({
        kind: 'person',
        id: contact.id,
        name: contact.name,
        label: contact.name,
        typeLabel: contact.type === 'mailbox' ? 'Mailbox' : 'Person',
        detail: [contact.email, roleNames.join(', ')].filter(Boolean).join(' · ') || 'No email or role configured',
        search: `${contact.name} ${contact.email} ${roleNames.join(' ')}`.toLocaleLowerCase()
      });
    }
    return options.sort((left, right) => left.typeLabel.localeCompare(right.typeLabel) || left.name.localeCompare(right.name));
  }

  function renderAssignmentPicker({ value = null, fallback = '', mode = 'person-or-role', taskId = '', questionId = '', eventField = '', statusField = '', newEventField = '', id = '', required = false, compact = false } = {}) {
    const reference = assignmentReference(value);
    const display = assignmentDisplay(reference ?? value, fallback);
    const targetAttributes = [
      taskId ? `data-task-assignment="${escapeHtml(taskId)}"` : '',
      questionId ? `data-question-assignment="${escapeHtml(questionId)}"` : '',
      eventField ? `data-event-assignment-field="${escapeHtml(eventField)}"` : '',
      statusField ? `data-status-assignment-field="${escapeHtml(statusField)}"` : '',
      newEventField ? `data-new-event-assignment-field="${escapeHtml(newEventField)}"` : ''
    ].filter(Boolean).join(' ');
    const options = assignmentOptions(mode, getActiveEvent());
    return `<div class="assignment-picker ${compact ? 'compact' : ''}" data-assignment-picker data-assignment-mode="${escapeHtml(mode)}" ${targetAttributes}>
      <div class="assignment-picker-input-row">
        <input ${id ? `id="${escapeHtml(id)}"` : ''} type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" autocomplete="off" value="${escapeHtml(display)}" placeholder="Start typing a person or role" data-assignment-input data-selected-kind="${escapeHtml(reference?.kind ?? '')}" data-selected-id="${escapeHtml(reference?.id ?? '')}" ${required ? 'required' : ''}>
        <button type="button" class="assignment-picker-toggle" data-assignment-toggle aria-label="Show people and roles">⌄</button>
      </div>
      <div class="assignment-picker-menu" role="listbox" hidden>
        ${options.map(option => `<button type="button" role="option" data-assignment-option data-kind="${escapeHtml(option.kind)}" data-id="${escapeHtml(option.id)}" data-name="${escapeHtml(option.name)}" data-search="${escapeHtml(option.search)}">
          <span class="assignment-option-kind">${escapeHtml(option.typeLabel)}</span>
          <span class="assignment-option-copy"><strong>${escapeHtml(option.name)}</strong><small>${escapeHtml(option.detail)}</small></span>
        </button>`).join('')}
        <button type="button" class="assignment-manage-link" data-view="directory">Manage people and roles</button>
      </div>
      <small class="assignment-picker-error" data-assignment-error></small>
    </div>`;
  }

  function ensureOperationalTaskState(event, task) {
    const taskState = ensureTaskState(event, task.item.id);
    taskState.status ??= taskState.completed ? 'completed' : 'open';
    taskState.assignedAt ??= null;
    taskState.assignedBy ??= null;
    taskState.completedAt ??= null;
    taskState.lastReminderAt ??= null;
    taskState.escalatedAt ??= null;

    if (!taskState.assignee && task.item.defaultOwnerRoleId) {
      assignTaskToReference(event, task.item, { kind: 'role', id: task.item.defaultOwnerRoleId }, 'default-role');
    }
    return taskState;
  }

  function assignTaskToReference(event, item, reference, assignedBy = 'organiser') {
    const taskState = ensureTaskState(event, item.id);
    const previousKey = `${taskState.assignmentKind ?? 'legacy'}:${taskState.assignmentId ?? taskState.assignee ?? ''}`;
    const resolved = assignmentReference(reference);
    if (!resolved) {
      taskState.assignmentKind = null;
      taskState.assignmentId = null;
      taskState.assignee = '';
      taskState.assigneeEmail = '';
      taskState.assignedAt = null;
      taskState.assignedBy = assignedBy;
      return taskState;
    }

    const recipient = assignmentRecipient(resolved, event);
    taskState.assignmentKind = resolved.kind;
    taskState.assignmentId = resolved.id;
    taskState.assignee = assignmentDisplay(resolved);
    taskState.assigneeEmail = recipient.email;
    taskState.assignedAt = new Date().toISOString();
    taskState.assignedBy = assignedBy;
    updateTeam(event, recipient.name || taskState.assignee);

    const nextKey = `${resolved.kind}:${resolved.id}`;
    if (taskState.assignee && previousKey.toLocaleLowerCase() !== nextKey.toLocaleLowerCase()) queueNotification(event, item, 'assignment');
    return taskState;
  }

  function assignTask(event, item, assignee, email = '', assignedBy = 'organiser') {
    const reference = findAssignmentReference(assignee);
    if (reference) return assignTaskToReference(event, item, reference, assignedBy);
    const taskState = ensureTaskState(event, item.id);
    const previous = taskState.assignee ?? '';
    taskState.assignee = String(assignee ?? '').trim();
    taskState.assigneeEmail = String(email ?? '').trim();
    taskState.assignmentKind = null;
    taskState.assignmentId = null;
    taskState.assignedAt = taskState.assignee ? new Date().toISOString() : null;
    taskState.assignedBy = assignedBy;
    updateTeam(event, taskState.assignee);

    if (taskState.assignee && previous.toLocaleLowerCase() !== taskState.assignee.toLocaleLowerCase()) {
      queueNotification(event, item, 'assignment');
    }
    return taskState;
  }

  function queueNotification(event, item, type) {
    state.notificationOutbox ??= [];
    const taskState = ensureTaskState(event, item.id);
    const dueDate = getDueDate(item.deadlineCode, event);
    const existing = state.notificationOutbox.find(notification => notification.eventId === event.id && notification.taskId === item.id && notification.type === type && notification.status !== 'sent');
    if (existing) return existing;

    const token = crypto.randomUUID();
    const isEscalation = type === 'escalation';
    const taskRecipient = assignmentRecipient(taskAssignmentReference(taskState) ?? taskState.assignee, event);
    const organiserRecipient = assignmentRecipient(event.organiserRef ?? event.organiser, event);
    const recipientName = isEscalation ? (organiserRecipient.name || event.organiser || 'Event Coordinator') : (taskRecipient.name || taskState.assignee || '');
    const recipientEmail = isEscalation ? organiserRecipient.email : (taskRecipient.email || taskState.assigneeEmail || contactEmailByName(taskState.assignee));
    const notification = {
      id: crypto.randomUUID(),
      eventId: event.id,
      taskId: item.id,
      type,
      recipientName,
      recipientEmail,
      taskTitle: item.title,
      dueDate,
      createdAt: new Date().toISOString(),
      status: 'queued',
      completionToken: token
    };
    state.notificationOutbox.push(notification);
    taskState.completionToken = token;
    taskState.notificationStatus = 'queued';
    registerCompletionLink(event, item, taskState, dueDate);
    dispatchNotification(notification, taskState);
    saveState();
    return notification;
  }

  async function dispatchNotification(notification, taskState) {
    try {
      const response = await fetch('/api/tasks/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifications: [notification] })
      });
      if (!response.ok) return;
      const result = await response.json();
      notification.status = result.deliveryMode === 'development-outbox' ? 'outbox' : 'sent';
      taskState.notificationStatus = notification.status;
      saveState();
    } catch (error) {
      console.warn('Notification delivery is unavailable; it remains queued.', error);
    }
  }

  async function registerCompletionLink(event, item, taskState, dueDate) {
    if (!taskState.completionToken) return;
    const recipient = assignmentRecipient(taskAssignmentReference(taskState) ?? taskState.assignee, event);
    try {
      await fetch('/api/tasks/completion-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: taskState.completionToken,
          eventId: event.id,
          eventName: event.name,
          taskId: item.id,
          taskTitle: item.title,
          assignee: taskState.assignee ?? recipient.name ?? '',
          assigneeEmail: recipient.email || taskState.assigneeEmail || contactEmailByName(taskState.assignee),
          dueDate
        })
      });
    } catch (error) {
      console.warn('Could not register completion link.', error);
    }
  }

  async function syncServerCompletions() {
    for (const event of state.events) {
      try {
        const response = await fetch(`/api/tasks/events/${encodeURIComponent(event.id)}/completions`);
        if (!response.ok) continue;
        const records = await response.json();
        for (const record of records) {
          const taskState = ensureTaskState(event, record.taskId);
          taskState.completed = true;
          taskState.status = 'completed';
          taskState.completedAt = record.completedAtUtc ?? taskState.completedAt;
          if (record.completionNotes) taskState.notes = record.completionNotes;
        }
      } catch (error) {
        console.warn('Could not synchronise task completions.', error);
      }
    }
    saveState();
  }

  function contactEmailByName(name) {
    if (!name) return '';
    return state.contacts.find(contact => contact.name.toLocaleLowerCase() === String(name).toLocaleLowerCase())?.email ?? '';
  }

  function markTaskComplete(event, item, completed) {
    const taskState = ensureTaskState(event, item.id);
    taskState.completed = Boolean(completed);
    taskState.status = completed ? 'completed' : 'open';
    taskState.completedAt = completed ? new Date().toISOString() : null;
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

  function deriveFacts(event) {
    const holesAnswer = getQuestionValue('competition-holes', event);
    const customHoles = Number(getQuestionValue('competition-holes-other', event));
    const holes = holesAnswer === 'other' ? customHoles : Number(holesAnswer);
    const playerCountValue = getQuestionValue('golf-player-count', event);
    const supporterCountValue = getQuestionValue('golf-supporter-count', event);
    const roundDurationValue = getQuestionValue('golf-expected-round-minutes', event);
    const startMethod = getQuestionValue('golf-start-method', event);
    const teeWindow = getQuestionValue('tee-time-window', event) ?? {};
    const shotgunStart = getQuestionValue('shotgun-start-time', event);

    const playerCountNumber = Number(playerCountValue);
    const supporterCountNumber = Number(supporterCountValue);
    const roundDurationNumber = Number(roundDurationValue);
    const playerCount = playerCountValue !== null && playerCountValue !== undefined && playerCountValue !== '' && Number.isFinite(playerCountNumber) && playerCountNumber > 0
      ? playerCountNumber
      : null;
    const supporterCount = supporterCountValue !== null && supporterCountValue !== undefined && supporterCountValue !== '' && Number.isFinite(supporterCountNumber) && supporterCountNumber >= 0
      ? supporterCountNumber
      : null;
    const duration = roundDurationValue !== null && roundDurationValue !== undefined && roundDurationValue !== '' && Number.isFinite(roundDurationNumber) && roundDurationNumber > 0
      ? roundDurationNumber
      : null;
    const expectedClubhouseReturnCount = playerCount !== null && supporterCount !== null
      ? playerCount + supporterCount
      : null;

    const firstStartValue = startMethod === 'shotgun' ? shotgunStart : teeWindow.start;
    const lastStartValue = startMethod === 'shotgun' ? shotgunStart : teeWindow.end;
    const firstTee = minutesFromTime(firstStartValue);
    const lastTee = minutesFromTime(lastStartValue);

    const cateringOpeningTime = playbook.operatingHours?.catering?.opens ?? '09:00';
    const cateringClosingTime = playbook.operatingHours?.catering?.closes ?? '17:00';
    const requiredCateringStart = getQuestionValue('required-catering-start', event) ?? null;
    const expectedFirstGolfFinish = firstTee !== null && duration !== null ? timeFromMinutes(firstTee + duration) : null;
    const expectedLatestGolfFinish = lastTee !== null && duration !== null ? timeFromMinutes(lastTee + duration) : null;
    const golfArrivalPattern = startMethod === 'shotgun' ? 'concentrated' : startMethod === 'tee-times' ? 'staggered' : null;
    const severityThresholds = golfArrivalPattern ? playbook.golfReturnSeverityRules?.[golfArrivalPattern] : null;
    let golfReturnSeverity = 'neutral';
    if (expectedClubhouseReturnCount !== null && severityThresholds) {
      if (expectedClubhouseReturnCount >= Number(severityThresholds.red)) golfReturnSeverity = 'red';
      else if (expectedClubhouseReturnCount >= Number(severityThresholds.amber)) golfReturnSeverity = 'amber';
      else golfReturnSeverity = 'green';
    }

    return {
      competitionHoles: Number.isFinite(holes) && holes > 0 ? holes : null,
      expectedPlayerCount: playerCount,
      expectedSupporterCount: supporterCount,
      expectedClubhouseReturnCount,
      golfStartMethod: startMethod ?? null,
      golfArrivalPattern,
      golfReturnSeverity,
      expectedRoundMinutes: duration,
      expectedFirstGolfFinish,
      expectedLatestGolfFinish,
      requiredCateringStart,
      cateringOpeningTime,
      cateringClosingTime
    };
  }

  function compareFactCondition(condition, facts) {
    if (!condition) return true;
    const left = facts[condition.fact];
    const right = condition.valueFact ? facts[condition.valueFact] : condition.value;
    if (left === null || left === undefined || right === null || right === undefined) return false;
    const leftTime = minutesFromTime(left);
    const rightTime = minutesFromTime(right);
    switch (condition.operator) {
      case 'laterThan': return leftTime !== null && rightTime !== null && leftTime > rightTime;
      case 'earlierThan': return leftTime !== null && rightTime !== null && leftTime < rightTime;
      case 'equals': return left === right;
      default: return false;
    }
  }

  function getActiveAdvisories(event) {
    const facts = deriveFacts(event);
    return (playbook.advisoryRules ?? []).filter(rule => {
      const answer = getQuestionValue(rule.targetQuestionId, event);
      return answer === rule.triggerAnswer && compareFactCondition(rule.derivedCondition, facts);
    }).map(rule => ({
      rule,
      facts,
      overrideReason: event.advisoryOverrides?.[rule.id]?.reason ?? ''
    }));
  }

  function interpolateMessage(message, facts) {
    return String(message ?? '').replace(/\{([^}]+)\}/g, (_, key) => facts[key] ?? '—');
  }

  function taskTimingStatus(task) {
    if (task.state.completed) return 'completed';
    if (!task.dueDate) return 'undated';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(`${task.dueDate}T00:00:00`);
    const days = Math.ceil((due - today) / 86400000);
    if (days < 0) return 'overdue';
    if (days <= 2) return 'due-soon';
    return 'on-track';
  }

  function processReminderRules(event, tasks) {
    for (const task of tasks) {
      const taskState = task.state;
      if (!taskState.assignee || taskState.completed || !task.dueDate) continue;
      const timing = taskTimingStatus(task);
      if (timing === 'due-soon' && !taskState.lastReminderAt) {
        queueNotification(event, task.item, 'reminder');
        taskState.lastReminderAt = new Date().toISOString();
      }
      if (timing === 'overdue' && !taskState.escalatedAt) {
        queueNotification(event, task.item, 'overdue');
        queueNotification(event, task.item, 'escalation');
        taskState.escalatedAt = new Date().toISOString();
      }
    }
    saveState();
  }

  function cloneEvent(sourceEvent) {
    const copy = createEvent(`${sourceEvent.name} (Copy)`, sourceEvent.organiser, sourceEvent.eventDate, sourceEvent.description ?? '', structuredClone(sourceEvent.milestoneDates ?? {}));
    copy.answers = structuredClone(sourceEvent.answers ?? {});
    copy.team = structuredClone(sourceEvent.team ?? []);
    copy.sourceEventId = sourceEvent.id;
    copy.retrospective = {};
    copy.advisoryOverrides = {};
    copy.taskState = {};
    copy.lifecycle = {
      status: 'provisional',
      statusChangedAt: new Date().toISOString(),
      decisionOwner: sourceEvent.lifecycle?.decisionOwner ?? sourceEvent.organiser ?? '',
      communicationsOwner: sourceEvent.lifecycle?.communicationsOwner ?? '',
      changedBy: sourceEvent.organiser ?? '',
      reason: '',
      memberUpdate: '',
      interestedParties: [],
      history: []
    };
    delete copy.milestoneDates.CX;
    saveState();
    return copy;
  }

  function getActiveTasks(event) {
    const tasks = [];
    for (const module of playbook.modules) {
      if (!isModuleActive(module, event)) {
        continue;
      }

      for (const section of module.sections) {
        for (const item of section.items) {
          const taskItems = item.type === 'task'
            ? [item]
            : item.type === 'question'
              ? [buildDontKnowTask(item)].filter(Boolean)
              : [];
          for (const taskItem of taskItems) {
            if (!isItemVisible(taskItem, event)) continue;
            const dueDate = getDueDate(taskItem.deadlineCode, event);
            const task = { item: taskItem, module, section, dueDate, state: event.taskState[taskItem.id] ?? {} };
            task.state = ensureOperationalTaskState(event, task);
            tasks.push(task);
          }
        }
      }
    }

    return tasks.sort((a, b) => {
      if (a.state.completed !== b.state.completed) {
        return a.state.completed ? 1 : -1;
      }
      if (a.dueDate && b.dueDate) {
        return a.dueDate.localeCompare(b.dueDate);
      }
      if (a.dueDate) {
        return -1;
      }
      if (b.dueDate) {
        return 1;
      }
      return (a.item.deadlineCode ?? '').localeCompare(b.item.deadlineCode ?? '');
    });
  }

  function getDeadlineOffset(code, event) {
    if (!code) {
      return null;
    }

    if (Object.prototype.hasOwnProperty.call(state.deadlineOffsets ?? {}, code)) {
      const value = state.deadlineOffsets[code];
      if (value === '' || value === null || value === undefined) {
        return null;
      }
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    }

    if (Object.prototype.hasOwnProperty.call(event.deadlineOffsets ?? {}, code)) {
      const value = event.deadlineOffsets[code];
      if (value === '' || value === null || value === undefined) {
        return null;
      }
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    }

    const definition = playbook.deadlineCodes.find(item => item.code === code);
    return typeof definition?.offsetDays === 'number' ? definition.offsetDays : null;
  }

  function getDueDate(code, event) {
    if (!code) return null;
    if (code === 'CX') {
      return CHANGE_RESPONSE_STATUSES.has(event.lifecycle?.status)
        ? localDateFromTimestamp(event.lifecycle?.statusChangedAt) || toIsoDate(new Date())
        : null;
    }
    const milestoneDate = event.milestoneDates?.[code];
    if (milestoneDate) return milestoneDate;
    if (!event.eventDate) return null;

    const offset = getDeadlineOffset(code, event);
    if (offset === null) {
      return null;
    }

    const date = new Date(`${event.eventDate}T12:00:00`);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    date.setDate(date.getDate() + offset);
    return toIsoDate(date);
  }

  function toIsoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function localDateFromTimestamp(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value).substring(0, 10) : toIsoDate(date);
  }

  function formatDate(value) {
    if (!value) {
      return 'Not set';
    }
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }).format(date);
  }

  function formatShortDate(value) {
    if (!value) {
      return 'Not set';
    }
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short'
    }).format(date);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function cleanSummaryDescription(value) {
    return String(value ?? '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/__(.*?)__/g, '$1')
      .replace(/^[#>-]+\s*/gm, '')
      .trim();
  }

  function render() {
    if (!playbook) {
      app.innerHTML = '<div class="loading">Loading playbook…</div>';
      return;
    }

    let event = getActiveEvent();
    if (!event && !['catalogue', 'references', 'admin'].includes(state.activeView)) {
      state.activeView = 'catalogue';
      saveState();
    }

    if (event) {
      normaliseAnswers(event);
      normaliseMilestoneDates(event);
    }
    saveState();

    const activeModules = event ? playbook.modules.filter(module => isModuleActive(module, event)) : [];
    const tasks = event ? getActiveTasks(event) : [];
    const doneTasks = tasks.filter(task => task.state.completed).length;
    const questionProgress = event ? getOverallQuestionProgress(event) : { total: 0, answered: 0, percent: 0 };

    const currentModuleId = state.activeView.startsWith('module:')
      ? state.activeView.substring('module:'.length)
      : null;
    if (event && currentModuleId && !activeModules.some(module => module.id === currentModuleId)) {
      state.activeView = 'module:start';
      saveState();
    }

    const isPlanningView = state.activeView.startsWith('module:');
    const shellTitle = state.activeView === 'tasks' ? 'Task Board'
      : state.activeView === 'catalogue' ? 'Event Catalogue'
      : state.activeView === 'artwork' ? 'Event Poster Studio'
      : state.activeView === 'directory' ? 'People & Roles'
      : state.activeView === 'references' ? 'Image Library'
      : state.activeView === 'admin' ? 'Playbook Administration'
      : state.activeView === 'retrospective' ? 'Event Retrospective'
      : 'Event Playbook';
    const shellIntro = state.activeView === 'tasks' ? 'See every action generated by the playbook, who owns it, when it is due and what needs attention.'
      : state.activeView === 'catalogue' ? 'Review previous events, clone successful plans and reuse the knowledge captured from earlier events.'
      : state.activeView === 'artwork' ? 'Create one campaign concept, refine it until it is right, then produce matching artwork for the clubhouse, member communications and print.'
      : state.activeView === 'directory' ? 'Maintain the people, shared mailboxes, responsibilities and platform access used throughout every event.'
      : state.activeView === 'references' ? 'Maintain reusable images of the clubhouse, course, trophies and interiors so Poster Studio artwork can look recognisably like Burton-on-Trent Golf Club.'
      : state.activeView === 'admin' ? 'Configure the questions, tasks, ownership rules and advisories that make up the club event planning process.'
      : state.activeView === 'retrospective' ? 'Capture what worked, what did not and what the next organiser should know before this event is run again.'
      : 'Plan the event consistently from first decision to final close-down, with every relevant question, responsibility and deadline in one place.';
    const showEventEditor = Boolean(event) && state.activeView === 'module:start';
    const showEventTools = Boolean(event) && (isPlanningView || state.activeView === 'tasks' || state.activeView === 'retrospective');
    const showLifecycleBanner = Boolean(event) && (isPlanningView || ['tasks', 'artwork', 'retrospective'].includes(state.activeView));
    const lifecycle = event ? normaliseEventLifecycle(event) : null;
    const lifecycleDefinition = event ? eventStatusDefinition(event) : null;

    app.innerHTML = `
      <div class="app-shell">
        <aside class="sidebar">
          <a class="club-brand" href="/" aria-label="Burton-on-Trent Golf Club Event Playbook">
            <img src="./assets/botgc-mark.svg" alt="">
            <span>
              <strong>Burton-on-Trent</strong>
              <small>Golf Club</small>
            </span>
          </a>

          <nav class="side-nav" aria-label="Event Playbook">
            <button class="${state.activeView === 'catalogue' ? 'active' : ''}" data-view="catalogue"><span class="nav-icon">▦</span>Event Catalogue</button>
            <span class="side-nav-group-label">Current event workspace</span>
            <button class="${isPlanningView ? 'active' : ''}" data-view="module:start" ${event ? '' : 'disabled'}><span class="nav-icon">◇</span>Event Planner</button>
            <button class="${state.activeView === 'tasks' ? 'active' : ''}" data-view="tasks" ${event ? '' : 'disabled'}><span class="nav-icon">✓</span>Task Board</button>
            <button class="${state.activeView === 'artwork' ? 'active' : ''}" data-view="artwork" ${event ? '' : 'disabled'}><span class="nav-icon">✦</span>Digital Artwork</button>
            <button class="${state.activeView === 'retrospective' ? 'active' : ''}" data-view="retrospective" ${event ? '' : 'disabled'}><span class="nav-icon">↺</span>Retrospectives</button>
          </nav>

          ${isPlanningView && event ? `<section class="sidebar-section module-nav" aria-label="Planning modules">
            <div class="sidebar-section-heading">
              <span>Planning modules</span>
              <small>${questionProgress.answered}/${questionProgress.total}</small>
            </div>
            ${activeModules.map(module => renderModuleNav(module, event)).join('')}
          </section>` : ''}

          <nav class="sidebar-utility-nav" aria-label="Shared resources">
            <span>Shared resources</span>
            <button class="${state.activeView === 'directory' ? 'active' : ''}" data-view="directory">
              <span class="nav-icon">♙</span>
              <span><strong>People & Roles</strong><small>Contacts, responsibilities & access</small></span>
            </button>
            <button class="${state.activeView === 'references' ? 'active' : ''}" data-view="references">
              <span class="nav-icon">▣</span>
              <span><strong>Image Library</strong><small>Available to every event</small></span>
            </button>
          </nav>

          <div class="sidebar-footer">
            ${event ? `<div class="sidebar-progress-copy">
                <strong>${questionProgress.percent}% planned</strong>
                <small>${doneTasks} of ${tasks.length} tasks complete</small>
              </div>
              <div class="progress-track"><div class="progress-fill" style="width:${questionProgress.percent}%"></div></div>`
              : '<div class="sidebar-progress-copy"><strong>No event selected</strong><small>Choose one from the catalogue</small></div>'}
            <button class="sidebar-admin-link ${state.activeView === 'admin' ? 'active' : ''}" data-view="admin">⚙ Playbook administration</button>
          </div>
        </aside>

        <main class="page playbook-page">
          <header class="app-page-hero">
            <div>
              <div class="breadcrumb">EVENT PLAYBOOK <span>/</span> ${escapeHtml(shellTitle.toUpperCase())}</div>
              <h1>${escapeHtml(shellTitle)}</h1>
              <p>${escapeHtml(shellIntro)}</p>
            </div>
            <div class="app-page-hero-actions">
              ${event ? `<section class="hero-event-context status-${escapeHtml(lifecycle.status)}${event.closedAt ? ' closed' : ''}" aria-label="Current selected event">
                  <div class="hero-event-context-copy">
                    <span><i></i>Current selected event · ${escapeHtml(lifecycleDefinition.label)}</span>
                    <strong>${escapeHtml(event.name || 'Untitled event')}</strong>
                    <small>${escapeHtml(event.eventDate ? formatDate(event.eventDate) : 'Date not set')} · ${escapeHtml(event.organiser || 'Organiser not assigned')}</small>
                  </div>
                  <div class="hero-event-context-actions"><button type="button" data-action="manage-event-status">Manage status</button><button type="button" data-view="catalogue">Change event</button></div>
                </section>`
                : `<section class="hero-event-context empty" aria-label="No event selected">
                    <div class="hero-event-context-copy"><span>No event selected</span><strong>Choose an event to begin</strong><small>Planner, tasks, artwork and retrospectives share one selected event.</small></div>
                    <button type="button" data-view="catalogue">Choose event</button>
                  </section>`}
              ${state.activeView === 'artwork' ? '<button id="shareTopButton" class="button button-gold hero-page-action" type="button" disabled>Share artwork</button>'
                : state.activeView === 'directory' ? '<button class="button button-gold hero-page-action" data-action="add-directory-contact">Add person</button>'
                : state.activeView === 'references' ? '<button class="button button-gold hero-page-action" data-action="add-library-image">Add image</button>'
                : state.activeView === 'catalogue' ? '<button class="button button-gold hero-page-action" data-action="new-event">New event</button>'
                : state.activeView === 'admin' ? '<button class="button button-gold hero-page-action" data-action="load-playbook">Load playbook JSON</button>'
                : ''}
            </div>
          </header>

          ${showEventEditor ? `
          <section class="event-context-bar">
            <div class="event-context-primary">
              <span class="section-kicker">Active event</span>
              <input class="event-title-input" type="text" value="${escapeHtml(event.name)}" data-event-field="name" aria-label="Event name">
              <div class="event-context-meta">
                <div class="event-organiser-field"><span>Organiser</span>${renderAssignmentPicker({ value: event.organiserRef ?? event.organiser, fallback: event.organiser, mode: 'person', eventField: 'organiser', compact: true })}</div>
                <div><span>Event date</span><strong>${escapeHtml(formatDate(event.eventDate))}</strong></div>
              </div>
            </div>
            <label class="event-description-field">
              <span>Event description</span>
              <textarea rows="3" data-event-field="description" placeholder="Describe what makes this event distinctive">${escapeHtml(event.description)}</textarea>
            </label>
          </section>` : ''}

          ${showEventTools ? `<section class="utility-toolbar" aria-label="Event actions">
              <button class="toolbar-button" data-action="export-plan">Export event plan</button>
              <button class="toolbar-button" data-action="export-csv">Export tasks CSV</button>
            </section>` : ''}

          <main class="main-content ${state.activeView === 'artwork' ? 'poster-studio' : ''}">
            ${showLifecycleBanner ? renderEventLifecycleBanner(event) : ''}
            ${state.activeView === 'catalogue' ? renderCatalogue() : state.activeView === 'directory' ? renderDirectory() : state.activeView === 'references' ? renderReferenceLibrary() : !event ? renderEmptyState() : state.activeView === 'tasks' ? renderTaskBoard(event, tasks) : state.activeView === 'artwork' ? renderArtworkStudio(event) : state.activeView === 'admin' ? renderAdmin(event) : state.activeView === 'retrospective' ? renderRetrospective(event) : renderModuleView(event)}
          </main>
        </main>
      </div>

      <datalist id="team-list">
        ${(event?.team ?? []).map(name => `<option value="${escapeHtml(name)}"></option>`).join('')}
      </datalist>

      ${renderNewEventDialog()}
      <dialog id="event-summary-dialog" class="modal event-summary-dialog"><div id="event-summary-content"></div></dialog>
      ${renderEventStatusDialog(event)}
    `;

    bindEvents();
    if (state.activeView === 'artwork' && event) {
      import('./poster-app.js?v=20260827-yodeck-upsert-1')
        .then(module => module.mountPosterStudio({
          eventId: event.id,
          eventName: event.name,
          eventDate: event.eventDate,
          description: event.description,
          onArtworkReady: (thumbnailDataUrl, artworkInfo = {}) => {
            const target = state.events.find(item => item.id === event.id);
            if (!target || !thumbnailDataUrl) return;

            // Before anything has been published, the catalogue follows the
            // latest generated campaign artwork. If a true square output has
            // been generated, prefer that over later portrait adaptations.
            const existingIsSquare = target.cataloguePosterSourceIsSquare === true;
            const incomingIsSquare = artworkInfo.isSquare === true;

            if (!existingIsSquare || incomingIsSquare) {
              target.cataloguePosterThumbnail = thumbnailDataUrl;
              target.cataloguePosterSourceOutputId = artworkInfo.outputId ?? null;
              target.cataloguePosterSourceIsSquare = incomingIsSquare;
              target.cataloguePosterThumbnailMode = 'cover';
              target.posterUpdatedAt = artworkInfo.generatedAt ?? new Date().toISOString();
              saveState();
            }
          },
          onSquareArtworkReady: thumbnailDataUrl => {
            const target = state.events.find(item => item.id === event.id);
            if (!target || !thumbnailDataUrl) return;
            target.cataloguePosterThumbnail = thumbnailDataUrl;
            target.cataloguePosterSourceIsSquare = true;
            target.cataloguePosterThumbnailMode = 'cover';
            target.posterUpdatedAt = new Date().toISOString();
            saveState();
          },
          onArtworkPublished: (thumbnailDataUrl, artworkInfo = {}) => {
            const target = state.events.find(item => item.id === event.id);
            if (!target || !thumbnailDataUrl) return;
            target.publishedCataloguePosterThumbnail = thumbnailDataUrl;
            target.publishedCataloguePosterSourceOutputId = artworkInfo.outputId ?? null;
            target.publishedCataloguePosterSourceIsSquare = artworkInfo.isSquare === true;
            target.publishedCataloguePosterThumbnailMode = 'cover';
            target.posterPublishedAt = new Date().toISOString();
            saveState();
          }
        }))
        .catch(error => console.error('Unable to initialise Poster Studio', error));
    }
  }

  function loadReferenceLibrary() {
    try {
      const raw = localStorage.getItem(REFERENCE_LIBRARY_STORAGE);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveReferenceLibrary(items) {
    localStorage.setItem(REFERENCE_LIBRARY_STORAGE, JSON.stringify(items));
  }

  function parseReferenceTags(value) {
    return String(value ?? '').split(',').map(item => item.trim()).filter(Boolean);
  }

  function referenceCategoryOptions() {
    return ['Clubhouse exterior', 'Clubhouse interior', 'Function room', 'Course', 'Signature hole', 'Trophy', 'Presentation area', 'Catering', 'Branding', 'Other'];
  }

  function renderReferenceLibrary() {
    const references = loadReferenceLibrary().sort((left, right) => (Number(right.priority) || 0) - (Number(left.priority) || 0) || String(left.title || '').localeCompare(String(right.title || '')));
    const activeCount = references.filter(item => item.active !== false).length;

    return `
      <section class="reference-library-view">
        <section class="panel reference-library-intro">
          <div class="panel-heading">
            <div>
              <p class="section-kicker">Image library</p>
              <h2>Build a visual memory of the club</h2>
              <p class="panel-copy">Upload real images of the clubhouse, interiors, trophies, course and other distinctive club details. Describe what each image shows and the Poster Studio will use that information to choose the most relevant images automatically.</p>
            </div>
            <div class="reference-library-stats">
              <div><strong>${references.length}</strong><small>Total references</small></div>
              <div><strong>${activeCount}</strong><small>Active for auto-selection</small></div>
            </div>
          </div>
        </section>

        <div class="reference-library-layout">
          <section class="panel reference-library-form-panel">
            <div class="panel-heading compact">
              <div>
                <p class="section-kicker">Maintain library</p>
                <h2>Add or update an image</h2>
                <p class="panel-copy">Describe the image clearly. The title, category, tags and description are used to decide when the image is relevant to an event brief.</p>
              </div>
            </div>
            <form id="reference-library-form" class="reference-library-form">
              <input id="reference-library-id" type="hidden">
              <div class="reference-form-grid">
                <label class="field field-span-2">
                  <span>Image</span>
                  <input id="reference-library-image" type="file" accept="image/png,image/jpeg,image/webp">
                  <small>Upload a clear photo that can help future artwork resemble the real club, course or object.</small>
                </label>
                <div id="reference-library-preview" class="reference-form-preview empty">Choose an image to preview it here.</div>
                <label class="field field-span-2"><span>Title</span><input id="reference-library-title" type="text" placeholder="Clubhouse exterior from 18th green" required></label>
                <label class="field"><span>Category</span><select id="reference-library-category">${referenceCategoryOptions().map(option => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('')}</select></label>
                <label class="field"><span>Priority</span><input id="reference-library-priority" type="number" min="0" max="10" step="1" value="5"><small>Higher priority references are more likely to be selected when they match.</small></label>
                <label class="field field-span-2"><span>Tags</span><input id="reference-library-tags" type="text" placeholder="clubhouse, exterior, patio, presentation"><small>Comma-separated keywords.</small></label>
                <label class="field field-span-2"><span>Description</span><textarea id="reference-library-description" rows="6" placeholder="For example: Main clubhouse frontage viewed from the 18th green, including the patio and white-trimmed windows. Use when the clubhouse is visible in outdoor scenes."></textarea></label>
                <label class="field field-span-2 inline-check"><input id="reference-library-active" type="checkbox" checked><span>Active for automatic selection</span></label>
              </div>
              <div class="reference-form-actions">
                <button class="button button-primary" type="submit">Save reference</button>
                <button class="button button-secondary" type="button" data-action="reference-form-reset">Clear form</button>
              </div>
            </form>
          </section>

          <section class="panel reference-library-list-panel">
            <div class="panel-heading compact">
              <div>
                <p class="section-kicker">Library contents</p>
                <h2>Available images</h2>
                <p class="panel-copy">Poster Studio can select these images automatically and pass the best matches to the image generator together with the organiser brief.</p>
              </div>
            </div>
            ${references.length === 0 ? '<div class="reference-library-empty">No images have been added yet.</div>' : `<div class="reference-library-grid">${references.map(renderReferenceCard).join('')}</div>`}
          </section>
        </div>
      </section>`;
  }

  function renderReferenceCard(reference) {
    const tags = Array.isArray(reference.tags) ? reference.tags : [];
    return `
      <article class="reference-card">
        <div class="reference-card-image">
          <img src="${escapeHtml(reference.dataUrl || '')}" alt="${escapeHtml(reference.title || 'Library image')}">
          <span class="status-pill ${reference.active === false ? 'neutral' : 'ready'}">${reference.active === false ? 'Inactive' : 'Active'}</span>
        </div>
        <div class="reference-card-body">
          <div class="reference-card-header">
            <div>
              <p class="section-kicker">${escapeHtml(reference.category || 'Reference')}</p>
              <h3>${escapeHtml(reference.title || 'Untitled reference')}</h3>
            </div>
            <span class="reference-priority">P${escapeHtml(reference.priority ?? 0)}</span>
          </div>
          <p class="reference-card-copy">${escapeHtml(reference.description || 'No description supplied yet.')}</p>
          <div class="reference-tag-list">${tags.length === 0 ? '<span class="reference-tag muted">No tags</span>' : tags.map(tag => `<span class="reference-tag">${escapeHtml(tag)}</span>`).join('')}</div>
          <div class="reference-card-actions">
            <button class="button button-secondary" type="button" data-edit-reference="${escapeHtml(reference.id)}">Edit</button>
            <button class="button button-secondary" type="button" data-toggle-reference="${escapeHtml(reference.id)}">${reference.active === false ? 'Activate' : 'Deactivate'}</button>
            <button class="button button-secondary destructive" type="button" data-delete-reference="${escapeHtml(reference.id)}">Delete</button>
          </div>
        </div>
      </article>`;
  }

  function resetReferenceLibraryForm() {
    const form = document.getElementById('reference-library-form');
    form?.reset();
    const idField = document.getElementById('reference-library-id');
    if (idField) idField.value = '';
    const categoryField = document.getElementById('reference-library-category');
    if (categoryField) categoryField.value = referenceCategoryOptions()[0];
    const priorityField = document.getElementById('reference-library-priority');
    if (priorityField) priorityField.value = '5';
    const activeField = document.getElementById('reference-library-active');
    if (activeField) activeField.checked = true;
    renderReferenceLibraryPreview('');
  }

  function renderReferenceLibraryPreview(dataUrl) {
    const preview = document.getElementById('reference-library-preview');
    if (!preview) return;
    if (!dataUrl) {
      preview.className = 'reference-form-preview empty';
      preview.innerHTML = 'Choose an image to preview it here.';
      return;
    }
    preview.className = 'reference-form-preview';
    preview.innerHTML = `<img src="${escapeHtml(dataUrl)}" alt="Reference preview">`;
  }

  function populateReferenceLibraryForm(reference) {
    document.getElementById('reference-library-id').value = reference.id ?? '';
    document.getElementById('reference-library-title').value = reference.title ?? '';
    document.getElementById('reference-library-category').value = reference.category ?? referenceCategoryOptions()[0];
    document.getElementById('reference-library-priority').value = String(reference.priority ?? 5);
    document.getElementById('reference-library-tags').value = Array.isArray(reference.tags) ? reference.tags.join(', ') : '';
    document.getElementById('reference-library-description').value = reference.description ?? '';
    document.getElementById('reference-library-active').checked = reference.active !== false;
    renderReferenceLibraryPreview(reference.dataUrl ?? '');
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
      reader.readAsDataURL(file);
    });
  }

  function renderEmptyState() {
    return `
      <section class="empty-catalogue-state">
        <span class="eyebrow">No active event</span>
        <h2>Create an event to begin planning</h2>
        <p>The catalogue is the starting point for the Event Playbook. Create a new event here, then move into the planner, task board and Digital Artwork when you are ready.</p>
        <button class="button button-primary" data-action="new-event">Create new event</button>
      </section>`;
  }

  function renderEventListItem(event) {
    const tasks = getActiveTasks(event);
    const open = tasks.filter(task => !task.state.completed).length;
    return `
      <div class="event-list-row ${event.id === state.activeEventId ? 'selected' : ''}">
        <button class="event-list-item" data-event-id="${event.id}">
          <span class="event-dot"></span>
          <span class="event-list-copy">
            <strong>${escapeHtml(event.name || 'Untitled event')}</strong>
            <small>${escapeHtml(event.eventDate ? formatShortDate(event.eventDate) : 'Date not set')} · ${open} open task${open === 1 ? '' : 's'}</small>
          </span>
        </button>
        ${state.events.length > 1 ? `<button class="delete-event" data-delete-event="${event.id}" title="Delete event" aria-label="Delete ${escapeHtml(event.name)}">×</button>` : ''}
      </div>
    `;
  }

  function renderModuleNav(module, event) {
    const progress = moduleProgress(module, event);
    const active = state.activeView === `module:${module.id}`;
    const complete = progress.total === 0 || progress.answered === progress.total;
    return `
      <button class="nav-item ${active ? 'active' : ''}" data-view="module:${module.id}">
        <span class="nav-icon ${complete ? 'complete' : ''}">${complete ? '✓' : module.id === 'start' ? '1' : '•'}</span>
        <span class="nav-main">
          <strong>${escapeHtml(module.shortTitle ?? module.title)}</strong>
          <small>${progress.answered} of ${progress.total} answered</small>
        </span>
        <span class="nav-progress">${progress.percent}%</span>
      </button>
    `;
  }

  function renderArtworkStudio(event) {
    const retainedArtworkThumbnail = event.publishedCataloguePosterThumbnail || event.cataloguePosterThumbnail || '';
    return `
      <section class="workflow-strip" aria-label="Poster creation workflow">
        <div class="workflow-step active" data-step="1"><span>1</span><strong>Brief</strong><small>Event & style</small></div>
        <div class="workflow-line"></div>
        <div class="workflow-step" data-step="2"><span>2</span><strong>Generate</strong><small>Primary artwork</small></div>
        <div class="workflow-line"></div>
        <div class="workflow-step" data-step="3"><span>3</span><strong>Adapt</strong><small>Other formats</small></div>
        <div class="workflow-line"></div>
        <div class="workflow-step" data-step="4"><span>4</span><strong>Share</strong><small>Screens & members</small></div>
      </section>

      <div class="content-grid">
        <section class="panel brief-panel">
          <div class="panel-heading">
            <div><p class="section-kicker">Creative brief</p><h2>Shape the artwork for this event</h2></div>
            <span class="required-pill">Selected event</span>
          </div>
          <label class="field"><span>Event description</span><textarea id="eventDescription" rows="7"></textarea><small>The selected event supplies its name and date automatically. Use this description to shape the generated artwork.</small></label>
          <div class="field"><span>Poster style</span><div id="styleOptions" class="style-options"></div></div>
          <div class="poster-content-box">
            <div><p class="section-kicker">Poster content</p><h3>What should be added to the finished artwork?</h3></div>
            <div class="toggle-grid">
              <label class="check-card selected" id="dateCard"><input id="includeDate" type="checkbox" checked><span class="check-mark">✓</span><span><strong>Event date</strong><small>Use the selected event date</small></span></label>
              <label class="check-card" id="priceCard"><input id="includePrice" type="checkbox"><span class="check-mark">✓</span><span><strong>Price</strong><small>Add a price badge</small></span></label>
              <label class="check-card" id="brandingCard"><input id="includeClubBranding" type="checkbox"><span class="check-mark">✓</span><span><strong>Club logo</strong><small>External promotion only</small></span></label>
            </div>
            <label id="priceField" class="field hidden"><span>Price to display</span><input id="price" type="text" placeholder="£12.50"></label>
          </div>
          <label class="field"><span>Additional creative instructions <em>optional</em></span><textarea id="additionalInstructions" rows="4" placeholder="For example: show the player attempting a ridiculous shot over mature trees towards a distant green."></textarea></label>
          <div class="supporting-upload-box">
            <div><p class="section-kicker">Supporting references</p><h3>Optional files for the studio</h3><p class="panel-copy">Upload images that should influence the artwork, for example a trophy photo, mascot, prop or previous campaign element.</p></div>
            <label class="supporting-dropzone" for="supportingFilesInput">
              <input id="supportingFilesInput" type="file" accept="image/png,image/jpeg,image/webp" multiple>
              <span class="supporting-dropzone-icon">↥</span>
              <span><strong>Add supporting image files</strong><small>Up to 4 event-specific images. They are sent with the artwork request and can be incorporated into the poster.</small></span>
            </label>
            <div class="automatic-references-panel">
              <label class="automatic-references-toggle"><input id="useLibraryReferences" type="checkbox" checked><span><strong>Use Image Library automatically</strong><small>The studio will inspect the brief and use the most relevant club images behind the scenes.</small></span></label>
              <button class="text-button automatic-references-link" type="button" data-view="references">View or manage the Image Library</button>
            </div>
            <div id="supportingFilesList" class="supporting-files-list"></div>
          </div>
          <div class="format-picker"><div><p class="section-kicker">Outputs</p><h3>Create the campaign in these formats</h3></div><div id="outputOptions" class="output-options"></div></div>
          <button id="generateButton" class="button button-primary button-large" type="button"><span>✦</span> Generate campaign artwork</button>
        </section>

        <div class="campaign-column">
          <aside class="panel campaign-panel">
            <div class="panel-heading compact"><div><p class="section-kicker">Campaign preview</p><h2 id="campaignTitle">${escapeHtml(event.name || 'No artwork generated')}</h2></div><span id="campaignStatus" class="status-pill neutral">Not started</span></div>
            <div id="emptyState" class="empty-state">${retainedArtworkThumbnail
              ? `<div class="saved-catalogue-art"><img src="${escapeHtml(retainedArtworkThumbnail)}" alt="Previously generated campaign artwork for ${escapeHtml(event.name)}"></div><span class="status-pill ready">Saved with this event</span><h3>Previously generated campaign</h3><p>This older catalogue preview is connected to the event, but it may have been cropped into a square. Generate the campaign again once to retain uncropped full-size formats and the studio settings here.</p>`
              : '<div class="empty-art"><img src="/assets/botgc-mark.svg" alt=""><span class="spark spark-one">✦</span><span class="spark spark-two">✦</span></div><h3>Your event campaign will appear here</h3><p>The clubhouse poster is created first. The studio then recomposes that artwork for square and A4 versions without cropping the approved design.</p>'}</div>
            <div id="generationProgress" class="generation-progress hidden">
              <div class="progress-row" data-progress="primary"><span class="progress-icon">1</span><div><strong>Digital-screen master artwork</strong><small>Generated first and retained as the campaign reference</small></div><span class="progress-state">Waiting</span></div>
              <div class="progress-row" data-progress="variants"><span class="progress-icon">2</span><div><strong>Reference-led format adaptations</strong><small>Recomposing that approved master for each selected dimension</small></div><span class="progress-state">Waiting</span></div>
              <div class="progress-row" data-progress="compose"><span class="progress-icon">3</span><div><strong>Final output preparation</strong><small>Sizing each AI-designed finished poster for its delivery format</small></div><span class="progress-state">Waiting</span></div>
              <div class="generation-controls">
                <small id="generationElapsed">High-quality artwork can take several minutes.</small>
                <button id="cancelGenerationButton" class="button button-secondary hidden" type="button">Cancel generation</button>
              </div>
            </div>
          </aside>
          <section id="generatedArtworkPanel" class="panel generated-artwork-panel hidden">
            <div class="panel-heading compact"><div><p class="section-kicker">Generated artwork</p><h2>Campaign assets</h2><p class="panel-copy">Each finished poster appears here immediately, without waiting for the rest of the campaign to finish generating.</p></div><span id="generatedArtworkCount" class="status-pill neutral">0 ready</span></div>
            <div id="posterResults" class="poster-results"></div>
            <div id="refinementPanel" class="refinement-panel hidden"><div><p class="section-kicker">Not quite right?</p><h3>Refine the whole campaign</h3><p>Tell the generator what worked and what should change. A new primary is created from the previous attempt, then the other formats are rebuilt from it.</p></div><textarea id="refinementNotes" rows="4" placeholder="For example: I like the composition but the golfer feels too serious. Make it funnier and show more of the strange route across the course."></textarea><button id="regenerateButton" class="button button-secondary" type="button">Regenerate with feedback</button></div>
          </section>
        </div>
      </div>

      <section id="sharePanel" class="panel publish-panel share-panel hidden">
        <div class="panel-heading"><div><p class="section-kicker">Share</p><h2>Share the approved campaign</h2><p class="panel-copy">Choose where the event should be communicated. Each channel has its own settings and can be used independently.</p></div></div>
        <div class="share-actions">
          <article class="share-action-card">
            <span class="share-action-icon">▣</span>
            <div><h3>Clubhouse screens</h3><p>Choose when the digital-screen artwork should appear around the clubhouse.</p></div>
            <button id="shareScreensButton" class="button button-gold" type="button">Send to clubhouse screens</button>
          </article>
          <article class="share-action-card pending">
            <span class="share-action-icon">✉</span>
            <div><h3>Members</h3><p>Use the campaign artwork in an email to the club membership.</p><span class="share-action-status">Email connection coming next</span></div>
            <button id="shareEmailButton" class="button button-secondary" type="button">Email to members</button>
          </article>
        </div>
        <div id="shareMessage" class="publish-message share-message" role="status">This campaign has not been shared yet.</div>
      </section>

      <dialog id="posterPublishDialog" class="poster-publish-dialog">
        <form id="posterPublishForm">
          <div class="poster-publish-heading">
            <div><p class="eyebrow">Share artwork</p><h2>Send to clubhouse screens</h2><p>Choose how the digital-screen artwork should be identified and when it should appear.</p></div>
            <button id="closePosterPublishDialog" class="icon-button" type="button" aria-label="Close clubhouse screen sharing dialog">×</button>
          </div>
          <div class="poster-publish-body">
            <aside class="poster-publish-preview"><img id="posterPublishPreview" alt="Artwork selected for the clubhouse screens"><span>Clubhouse Digital Display</span><small>2160 × 3840 PNG</small></aside>
            <div class="poster-publish-fields">
              <div id="yodeckConnectionStatus" class="yodeck-connection-status checking"><span></span><div><strong>Checking the clubhouse screen connection…</strong><small>The connection is managed securely by Event Playbook.</small></div></div>
              <label class="field"><span>Artwork name</span><input id="yodeckMediaName" type="text" maxlength="180" required><small>This is how the artwork will be identified in the screen library.</small></label>
              <label class="field"><span>Tags</span><input id="yodeckTags" type="text" placeholder="event-playbook, clubhouse-screens, event-name"><small>Separate tags with commas. Event Playbook is always added automatically.</small></label>
              <div class="poster-publish-date-grid">
                <label class="field"><span>Start showing</span><input id="yodeckStartDate" type="date" required><small>The poster becomes available from the start of this day.</small></label>
                <label class="field"><span>Stop showing</span><input id="yodeckEndDate" type="date" readonly><small>Fixed to the end of the selected event date.</small></label>
              </div>
              <div class="yodeck-playlist-summary"><span>Destination</span><strong id="yodeckPlaylistName">Clubhouse screens</strong><small>The artwork is added to the existing screen rotation without replacing anything already there.</small></div>
              <div id="posterPublishDialogMessage" class="poster-publish-dialog-message" role="status"></div>
            </div>
          </div>
          <div class="poster-publish-actions"><button id="cancelPosterPublish" class="button button-secondary" type="button">Cancel</button><button id="confirmPosterPublish" class="button button-gold button-large" type="submit">Send to clubhouse screens</button></div>
        </form>
      </dialog>`;
  }

  function renderModuleView(event) {
    const moduleId = state.activeView.startsWith('module:') ? state.activeView.substring('module:'.length) : 'start';
    const module = moduleIndex.get(moduleId) ?? moduleIndex.get('start') ?? playbook.modules[0];
    if (!module || !isModuleActive(module, event)) {
      return '<div class="empty-state">This module is not currently required.</div>';
    }

    const progress = moduleProgress(module, event);
    const tasks = getActiveTasks(event).filter(task => task.module.id === module.id);
    const visibleSections = module.sections.filter(section => section.items.some(item => isItemVisible(item, event)));
    const sectionColumns = [[], []];
    visibleSections.forEach((section, index) => {
      sectionColumns[index % 2].push(renderSection(section, event, index));
    });

    return `
      <section class="page-header">
        <div>
          <div class="eyebrow">${module.id === 'start' ? 'Master checklist' : 'Event module'}</div>
          <h2>${escapeHtml(module.title)}</h2>
          <p>${escapeHtml(module.description ?? '')}</p>
        </div>
        <div class="page-progress">
          <strong>${progress.percent}%</strong>
          <span>${progress.answered}/${progress.total} questions</span>
        </div>
      </section>

      ${module.id === 'start' ? `
        <div class="planner-start-grid">
          <div class="planner-timeline-column">${renderPlanningCalendar(event)}</div>
          <div class="module-sections planner-question-column">
            ${module.sections.map(section => renderSection(section, event)).join('')}
          </div>
        </div>
      ` : `
        <div class="module-sections planner-module-grid">
          <div class="planner-module-column">${sectionColumns[0].join('')}</div>
          <div class="planner-module-column">${sectionColumns[1].join('')}</div>
        </div>
      `}

      ${tasks.length > 0 ? `
        <section class="module-task-summary">
          <div>
            <span class="eyebrow">Generated automatically</span>
            <h3>${tasks.length} task${tasks.length === 1 ? '' : 's'} from this module</h3>
          </div>
          <button class="button button-primary" data-view="tasks">Open task board</button>
        </section>
      ` : ''}
    `;
  }

  function eventStatusDefinition(event) {
    normaliseEventLifecycle(event);
    return EVENT_STATUS_DEFINITIONS[event.lifecycle.status] ?? EVENT_STATUS_DEFINITIONS.provisional;
  }

  function renderEventLifecycleBanner(event) {
    const lifecycle = normaliseEventLifecycle(event);
    const definition = eventStatusDefinition(event);
    const commitmentDate = getDueDate('CD', event);
    const goNoGoDate = getDueDate('GO', event);
    const changedDate = localDateFromTimestamp(lifecycle.statusChangedAt);
    const showChangeDetail = CHANGE_RESPONSE_STATUSES.has(lifecycle.status) || lifecycle.status === 'at-risk';
    return `
      <section class="event-lifecycle-banner status-${escapeHtml(lifecycle.status)}" aria-label="Event status and decision controls">
        <div class="event-lifecycle-status">
          <span class="event-status-pill status-${escapeHtml(lifecycle.status)}">${escapeHtml(definition.label)}</span>
          <div>
            <span class="eyebrow">Event status</span>
            <h2>${escapeHtml(definition.summary)}</h2>
            ${showChangeDetail && lifecycle.reason ? `<p><strong>Recorded reason:</strong> ${escapeHtml(lifecycle.reason)}</p>` : ''}
            ${changedDate ? `<small>Last changed ${escapeHtml(formatDate(changedDate))}${lifecycle.changedBy ? ` by ${escapeHtml(lifecycle.changedBy)}` : ''}</small>` : ''}
          </div>
        </div>
        <div class="event-decision-gates">
          <div><span>Commitment decision</span><strong>${escapeHtml(commitmentDate ? formatDate(commitmentDate) : 'Not set')}</strong></div>
          <div><span>Final go/no-go</span><strong>${escapeHtml(goNoGoDate ? formatDate(goNoGoDate) : 'Not set')}</strong></div>
          <div><span>Decision owner</span><strong>${escapeHtml(lifecycle.decisionOwner || 'Not assigned')}</strong></div>
          <div><span>Communications owner</span><strong>${escapeHtml(lifecycle.communicationsOwner || 'Not assigned')}</strong></div>
        </div>
        ${CHANGE_RESPONSE_STATUSES.has(lifecycle.status) && lifecycle.memberUpdate ? `<div class="event-authoritative-message"><span>Authoritative member update</span><p>${escapeHtml(lifecycle.memberUpdate)}</p></div>` : ''}
        <button class="button button-primary" type="button" data-action="manage-event-status">Manage event status</button>
      </section>`;
  }

  function renderEventStatusDialog(event) {
    if (!event) return '';
    const lifecycle = normaliseEventLifecycle(event);
    const changeStatus = CHANGE_RESPONSE_STATUSES.has(lifecycle.status);
    const reasonRequired = changeStatus || lifecycle.status === 'at-risk';
    const recentHistory = [...lifecycle.history].slice(-5).reverse();
    return `
      <dialog id="event-status-dialog" class="modal event-status-dialog">
        <form id="event-status-form">
          <div class="modal-heading">
            <div>
              <span class="eyebrow">Event control</span>
              <h2>Update the event status</h2>
              <p>This status is the single operational signal used by the planner, task board, artwork and event catalogue.</p>
            </div>
            <button class="icon-button" type="button" data-close-event-status aria-label="Close">×</button>
          </div>
          <div class="event-status-dialog-body">
            <section class="event-status-fields">
              <label class="field">
                <span>New status</span>
                <select id="event-status-value">
                  ${Object.entries(EVENT_STATUS_DEFINITIONS).map(([value, item]) => `<option value="${escapeHtml(value)}" ${lifecycle.status === value ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
                </select>
                <small id="event-status-guidance">${escapeHtml(eventStatusDefinition(event).summary)}</small>
              </label>
              <div class="event-status-owner-grid">
                <div class="field"><span>Decision made by</span>${renderAssignmentPicker({ value: lifecycle.decisionOwnerRef ?? event.organiserRef ?? lifecycle.decisionOwner ?? event.organiser, fallback: lifecycle.decisionOwner || event.organiser, mode: 'person', statusField: 'decision-owner', id: 'event-status-decision-owner', required: true })}</div>
                <div class="field"><span>Communications owner</span>${renderAssignmentPicker({ value: lifecycle.communicationsOwnerRef ?? lifecycle.communicationsOwner, fallback: lifecycle.communicationsOwner, statusField: 'communications-owner', id: 'event-status-communications-owner' })}<small>Required when member or participant communications have already been sent or scheduled.</small></div>
              </div>
              <div id="event-status-change-fields" class="event-status-change-fields ${reasonRequired ? '' : 'hidden'}">
                <label class="field"><span>Reason for the change</span><textarea id="event-status-reason" rows="3" ${reasonRequired ? 'required' : ''} placeholder="Record the operational reason, not just ‘organiser decision’.">${escapeHtml(lifecycle.reason)}</textarea></label>
              </div>
              <div id="event-status-member-fields" class="event-status-change-fields ${changeStatus ? '' : 'hidden'}">
                <label class="field"><span>Authoritative member or participant update</span><textarea id="event-status-member-update" rows="5" placeholder="For example: Tonight’s event has been cancelled. Please disregard the earlier message about additional catering support. We apologise for the short notice.">${escapeHtml(lifecycle.memberUpdate)}</textarea><small>Record one agreed message here. The generated Communications task uses this as the source wording.</small></label>
                <div class="event-change-warning"><strong>A coordinated cancellation response will activate immediately.</strong><span>The organiser owns the overall notification task. Departmental follow-ups appear only where completed work, task notes or sent briefings indicate that something may need to be unwound.</span></div>
              </div>
            </section>
            <aside class="event-status-history">
              <span class="eyebrow">Decision record</span>
              <h3>Recent status changes</h3>
              ${recentHistory.length ? recentHistory.map(entry => {
                const definition = EVENT_STATUS_DEFINITIONS[entry.status] ?? { label: entry.status };
                const date = localDateFromTimestamp(entry.changedAt);
                return `<div class="event-status-history-item"><span class="event-status-pill status-${escapeHtml(entry.status)}">${escapeHtml(definition.label)}</span><strong>${escapeHtml(date ? formatDate(date) : 'Date not recorded')}</strong><small>${escapeHtml(entry.changedBy || 'Owner not recorded')}${entry.reason ? ` · ${escapeHtml(entry.reason)}` : ''}</small></div>`;
              }).join('') : '<p>No previous status changes have been recorded.</p>'}
            </aside>
          </div>
          <div class="modal-actions">
            <button class="button button-secondary" type="button" data-close-event-status>Cancel</button>
            <button class="button button-primary" type="submit">Apply event status</button>
          </div>
        </form>
      </dialog>`;
  }

  function renderPlanningCalendar(event) {
    normaliseMilestoneDates(event);
    return `
      <section class="calendar-card">
        <div class="calendar-card-heading">
          <div>
            <span class="eyebrow">Planning timeline</span>
            <h3>Key milestones</h3>
            <p>These dates were set when the event was created and drive the deadlines for generated tasks. Adjust them here whenever the planning timetable changes.</p>
          </div>
          <div class="event-date-pill">
            <span>Event date</span>
            <strong>${escapeHtml(event.eventDate ? formatDate(event.eventDate) : 'Not set')}</strong>
          </div>
        </div>
        <div class="deadline-grid">
          ${playbook.deadlineCodes.filter(code => !code.dynamic || CHANGE_RESPONSE_STATUSES.has(event.lifecycle?.status)).map(code => {
            const due = getDueDate(code.code, event);
            return `
              <div class="deadline-row milestone-row ${['CD', 'GO', 'CX'].includes(code.code) ? 'decision-gate-row' : ''}">
                <div class="deadline-code">${escapeHtml(code.code)}</div>
                <div class="deadline-copy">
                  <strong>${escapeHtml(MILESTONE_LABELS[code.code] ?? code.label)}</strong>
                  <small>${escapeHtml(code.description ?? '')}</small>
                </div>
                <label class="deadline-offset milestone-date-input">
                  <span>Date</span>
                  <input type="date" value="${escapeHtml(due ?? '')}" data-milestone-code="${escapeHtml(code.code)}" ${code.code === 'DT' ? 'data-event-date-milestone="true"' : ''}>
                </label>
                <div class="deadline-date ${due ? '' : 'unset'}">${escapeHtml(due ? formatDate(due) : 'Not configured')}</div>
              </div>
            `;
          }).join('')}
        </div>
      </section>
    `;
  }

  function renderSection(section, event, layoutOrder = null) {
    const visibleItems = section.items.filter(item => isItemVisible(item, event));
    if (visibleItems.length === 0) {
      return '';
    }

    const orderStyle = Number.isInteger(layoutOrder) ? ` style="--section-order:${layoutOrder}"` : '';

    return `
      <section class="playbook-section"${orderStyle}>
        <div class="section-heading">
          <h3>${escapeHtml(section.title)}</h3>
        </div>
        <div class="flow-list">
          ${visibleItems.map(item => {
            if (item.type === 'question') {
              const decisionTask = buildDontKnowTask(item);
              return renderQuestion(item, event) + (decisionTask && isItemVisible(decisionTask, event) ? renderInlineTask(decisionTask, event) : '');
            }
            return item.type === 'note' ? renderNote(item, event) : renderInlineTask(item, event);
          }).join('')}
        </div>
      </section>
    `;
  }

  function renderNote(item, event) {
    if (item.id === 'golf-return-window-note') {
      const facts = deriveFacts(event);
      const severityLabels = {
        green: 'Green impact',
        amber: 'Amber impact',
        red: 'Red impact',
        neutral: 'Needs answers'
      };
      const returnTime = facts.expectedLatestGolfFinish
        ? facts.golfArrivalPattern === 'concentrated'
          ? `Around ${facts.expectedLatestGolfFinish}`
          : `${facts.expectedFirstGolfFinish}-${facts.expectedLatestGolfFinish}`
        : 'Add duration and start time';
      const attendance = facts.expectedClubhouseReturnCount !== null
        ? `${facts.expectedClubhouseReturnCount} people`
        : 'Add players and supporters';
      const roundDuration = facts.expectedRoundMinutes !== null
        ? `${facts.expectedRoundMinutes} minutes`
        : 'Add expected duration';
      const pattern = facts.golfArrivalPattern === 'concentrated'
        ? 'Concentrated shotgun return'
        : facts.golfArrivalPattern === 'staggered'
          ? 'Staggered return window'
          : 'Select a start pattern';
      const impactMessage = facts.golfReturnSeverity === 'red'
        ? `${attendance} are expected around the finish. This is a high-impact return: confirm catering and bar capacity, seating and operational staffing before play ends.`
        : facts.golfReturnSeverity === 'amber'
          ? `${attendance} are expected around the finish. Allow for a noticeable demand peak and confirm catering, bar and staffing cover.`
          : facts.golfReturnSeverity === 'green'
            ? `${attendance} are expected around the finish. Standard operational cover is likely to be sufficient, but should still be confirmed.`
            : 'Answer the round duration, start pattern, player count and supporter count to calculate the return forecast and its operational severity.';

      return `
        <article class="flow-item note-item golf-return-note severity-${facts.golfReturnSeverity}" data-item-id="${item.id}">
          <div class="flow-rail"><span class="type-badge note-badge">Info</span></div>
          <div class="flow-body">
            <div class="golf-return-heading">
              <div class="task-title">${escapeHtml(item.title ?? 'Expected clubhouse return')}</div>
              <span class="golf-return-severity">${escapeHtml(severityLabels[facts.golfReturnSeverity])}</span>
            </div>
            <p class="help-text">${escapeHtml(item.body ?? '')}</p>
            <div class="golf-return-metrics">
              <div><small>Expected return</small><strong>${escapeHtml(returnTime)}</strong></div>
              <div><small>People around finish</small><strong>${escapeHtml(attendance)}</strong></div>
              <div><small>Round duration</small><strong>${escapeHtml(roundDuration)}</strong></div>
            </div>
            <p class="golf-return-pattern">${escapeHtml(pattern)}</p>
            <p class="golf-return-impact">${escapeHtml(impactMessage)}</p>
          </div>
        </article>`;
    }

    return `
      <article class="flow-item note-item" data-item-id="${item.id}">
        <div class="flow-rail"><span class="type-badge note-badge">Info</span></div>
        <div class="flow-body">
          <div class="task-title">${escapeHtml(item.title ?? 'Information')}</div>
          <p class="help-text">${escapeHtml(item.body ?? '')}</p>
        </div>
      </article>`;
  }

  function renderAdvisoriesForQuestion(questionId, event) {
    return getActiveAdvisories(event)
      .filter(entry => entry.rule.targetQuestionId === questionId)
      .map(entry => `
        <div class="advisory-card ${entry.overrideReason ? 'overridden' : ''}">
          <div class="advisory-icon">!</div>
          <div class="advisory-body">
            <strong>${escapeHtml(entry.rule.title)}</strong>
            <p>${escapeHtml(interpolateMessage(entry.rule.message, entry.facts))}</p>
            ${entry.rule.requireOverrideReason ? `
              <label>
                <span>${entry.overrideReason ? 'Recorded reason' : 'If you still want to continue with this answer, record why'}</span>
                <textarea data-advisory-reason="${escapeHtml(entry.rule.id)}" rows="2" placeholder="Reason for overriding this advisory">${escapeHtml(entry.overrideReason)}</textarea>
              </label>
              <button class="button button-secondary" data-save-advisory="${escapeHtml(entry.rule.id)}">${entry.overrideReason ? 'Update reason' : 'Confirm this decision'}</button>
            ` : ''}
          </div>
        </div>`).join('');
  }

  function renderDerivedContextForQuestion(questionId, event) {
    if (!['extend-catering-hours', 'peak-catering-staffing'].includes(questionId)) return '';
    const facts = deriveFacts(event);
    if (!facts.expectedLatestGolfFinish) return '';

    const returnText = facts.golfArrivalPattern === 'concentrated'
      ? `Most players are expected back at around ${facts.expectedLatestGolfFinish}.`
      : `Players are expected back between approximately ${facts.expectedFirstGolfFinish} and ${facts.expectedLatestGolfFinish}.`;
    const patternText = facts.golfArrivalPattern === 'concentrated'
      ? 'Shotgun start — demand is likely to arrive in one concentrated peak.'
      : 'Staggered tee times — demand should build and fall more gradually.';
    const attendanceText = facts.expectedClubhouseReturnCount !== null
      ? ` Plan for ${facts.expectedClubhouseReturnCount} players and supporters around the finish (${facts.golfReturnSeverity} impact).`
      : '';

    return `<div class="derived-consideration-card">
      <div class="derived-consideration-icon">↳</div>
      <div><strong>Golf return forecast</strong><p>${escapeHtml(returnText)}${escapeHtml(attendanceText)} Normal catering hours are ${escapeHtml(facts.cateringOpeningTime)}–${escapeHtml(facts.cateringClosingTime)}.</p><small>${escapeHtml(patternText)}</small></div>
    </div>`;
  }

  function renderQuestion(item, event) {
    const value = getQuestionValue(item.id, event);
    const pending = value === 'dont-know';
    const answered = isAnsweredValue(value);
    return `
      <article class="flow-item question-item ${answered ? 'answered' : ''} ${pending ? 'pending-decision' : ''}" data-item-id="${item.id}">
        <div class="flow-rail question-flow-rail">
          <span class="type-badge question-badge">Question</span>
          <span class="question-state-mark">${pending ? '…' : answered ? '✓' : '?'}</span>
          <small>${pending ? 'Pending' : answered ? 'Answered' : 'Decision'}</small>
        </div>
        <div class="flow-body question-flow-body">
          <div class="question-label-row">
            <label>${escapeHtml(item.label)}</label>
            ${item.required === false ? '<span class="optional-label">Optional</span>' : ''}
          </div>
          ${item.helpText ? `<p class="help-text">${escapeHtml(item.helpText)}</p>` : ''}
          ${renderDerivedContextForQuestion(item.id, event)}
          ${renderAnswerControl(item, value)}
          ${renderAdvisoriesForQuestion(item.id, event)}
        </div>
      </article>
    `;
  }

  function renderAnswerControl(item, value) {
    switch (item.answerType) {
      case 'yesNo':
        return `
          <div class="choice-group yes-no-group" role="group" aria-label="${escapeHtml(item.label)}">
            <button class="choice-button ${value === true ? 'selected' : ''}" data-question-id="${item.id}" data-answer-json="true">Yes</button>
            <button class="choice-button ${value === false ? 'selected' : ''}" data-question-id="${item.id}" data-answer-json="false">No</button>
            ${item.allowDontKnow ? `<button class="choice-button dont-know-choice ${value === 'dont-know' ? 'selected' : ''}" data-question-id="${item.id}" data-answer-json="${escapeHtml(JSON.stringify('dont-know'))}">Don't know</button>` : ''}
          </div>
        `;
      case 'singleChoice':
        return `
          <div class="choice-group wrap" role="group" aria-label="${escapeHtml(item.label)}">
            ${(item.options ?? []).map(option => `
              <button class="choice-button ${value === option.value ? 'selected' : ''}" data-question-id="${item.id}" data-answer-json="${escapeHtml(JSON.stringify(option.value))}">${escapeHtml(option.label)}</button>
            `).join('')}
          </div>
        `;
      case 'multiChoice':
        return `
          <div class="multi-choice-group">
            ${(item.options ?? []).map(option => `
              <label class="check-choice">
                <input type="checkbox" data-multi-question-id="${item.id}" value="${escapeHtml(option.value)}" ${Array.isArray(value) && value.includes(option.value) ? 'checked' : ''}>
                <span>${escapeHtml(option.label)}</span>
              </label>
            `).join('')}
          </div>
        `;
      case 'date':
        return `<input class="answer-input" type="date" value="${escapeHtml(value ?? '')}" data-question-input="${item.id}">`;
      case 'number': {
        const min = Number.isFinite(Number(item.min)) ? ` min="${escapeHtml(item.min)}"` : '';
        const max = Number.isFinite(Number(item.max)) ? ` max="${escapeHtml(item.max)}"` : '';
        const step = Number.isFinite(Number(item.step)) ? ` step="${escapeHtml(item.step)}"` : '';
        return `<div class="number-answer-control">
          <input class="answer-input" type="number" value="${escapeHtml(value ?? '')}"${min}${max}${step} data-question-input="${item.id}">
          ${item.unit ? `<span class="number-input-unit">${escapeHtml(item.unit)}</span>` : ''}
        </div>`;
      }
      case 'time':
        return `<input class="answer-input" type="time" value="${escapeHtml(value ?? '')}" data-question-input="${item.id}">`;
      case 'timeRange': {
        const range = value && typeof value === 'object' ? value : {};
        return `<div class="time-range-control">
          <label><span>First tee time</span><input class="answer-input" type="time" value="${escapeHtml(range.start ?? '')}" data-time-range-question-id="${item.id}" data-time-range-part="start"></label>
          <span class="time-range-separator">to</span>
          <label><span>Last tee time</span><input class="answer-input" type="time" value="${escapeHtml(range.end ?? '')}" data-time-range-question-id="${item.id}" data-time-range-part="end"></label>
        </div>`;
      }
      case 'assignment':
        return renderAssignmentPicker({
          value,
          mode: item.assignmentMode === 'person' ? 'person' : 'person-or-role',
          questionId: item.id,
          required: item.required !== false
        });
      case 'text':
      default:
        return `<input class="answer-input" type="text" value="${escapeHtml(value ?? '')}" data-question-input="${item.id}">`;
    }
  }

  function renderInlineTask(item, event) {
    const taskState = event.taskState[item.id] ?? {};
    const dueDate = getDueDate(item.deadlineCode, event);
    const dueText = dueDate ? formatDate(dueDate) : item.deadlineCode ? `Configure ${item.deadlineCode}` : 'No deadline';
    const milestoneLabel = item.deadlineCode ? (MILESTONE_LABELS[item.deadlineCode] ?? item.deadlineCode) : 'No milestone';
    const detail = getTaskDetail(item, event);
    return `
      <article class="flow-item task-item ${taskState.completed ? 'completed' : ''}" data-item-id="${item.id}">
        <div class="flow-rail task-flow-rail">
          <span class="type-badge task-badge">Task</span>
          <div class="task-milestone-marker ${item.deadlineCode ? '' : 'no-milestone'}">
            <strong>${escapeHtml(item.deadlineCode ?? '—')}</strong>
            <span>${escapeHtml(milestoneLabel)}</span>
            <small>${escapeHtml(dueText)}</small>
          </div>
        </div>
        <div class="flow-body task-inline-body">
          <div class="task-inline-heading">
            <div>
              <div class="task-title">${escapeHtml(item.title)}</div>
              ${detail ? `<p class="help-text">${escapeHtml(detail)}</p>` : ''}
            </div>
            <label class="complete-toggle task-complete-control" title="Mark task complete">
              <input type="checkbox" data-task-complete="${item.id}" ${taskState.completed ? 'checked' : ''}>
              <span></span><small>${taskState.completed ? 'Complete' : 'Mark complete'}</small>
            </label>
          </div>
          <div class="task-inline-meta">
            ${item.responsibleArea ? `<span class="area-chip">${escapeHtml(item.responsibleArea)}</span>` : ''}
            <div class="assignee-compact">
              <span>Owner</span>
              ${renderAssignmentPicker({ value: taskAssignmentReference(taskState) ?? taskState.assignee, fallback: taskState.assignee, taskId: item.id, compact: true })}
            </div>
          </div>
        </div>
      </article>
    `;
  }

  function getTaskDetail(item, event) {
    if (item.dynamicDetail !== 'cancellation-coordination') return item.detail ?? '';
    const interestedParties = Array.isArray(event.lifecycle?.interestedParties) ? event.lifecycle.interestedParties : [];
    const parties = interestedParties.map(party => {
      const name = String(party?.name ?? '').trim();
      const area = String(party?.area ?? '').trim();
      return name && area ? `${name} (${area})` : name || area;
    }).filter(Boolean);
    if (!parties.length) {
      return `${item.detail ?? ''} Review completed and assigned work to identify anyone already briefed or committed.`.trim();
    }
    return `${item.detail ?? ''} The current plan identifies: ${parties.join(', ')}.`.trim();
  }

  function renderTaskBoard(event, tasks) {
    const open = tasks.filter(task => !task.state.completed);
    const done = tasks.filter(task => task.state.completed);
    const missingDates = tasks.filter(task => task.item.deadlineCode && !task.dueDate);
    const unassigned = tasks.filter(task => !task.state.assignee);
    const overdue = tasks.filter(task => taskTimingStatus(task) === 'overdue');
    const dueSoon = tasks.filter(task => taskTimingStatus(task) === 'due-soon');
    const advisories = getActiveAdvisories(event);
    processReminderRules(event, tasks);

    const filter = state.taskFilter ?? 'open';
    const filtered = tasks.filter(task => {
      if (filter === 'open') return !task.state.completed;
      if (filter === 'done') return task.state.completed;
      if (filter === 'unassigned') return !task.state.assignee && !task.state.completed;
      if (filter === 'overdue') return taskTimingStatus(task) === 'overdue';
      if (filter === 'due-soon') return taskTimingStatus(task) === 'due-soon';
      return true;
    });

    return `
      <section class="page-header">
        <div>
          <div class="eyebrow">Live output</div>
          <h2>Task board</h2>
          <p>Tasks are generated from the answers in the playbook. Change an answer and the task list changes with it.</p>
        </div>
        <div class="page-progress task-progress">
          <strong>${done.length}/${tasks.length}</strong>
          <span>tasks complete</span>
        </div>
      </section>

      <section class="task-stat-grid">
        <div class="stat-card"><span>Open</span><strong>${open.length}</strong></div>
        <div class="stat-card"><span>Completed</span><strong>${done.length}</strong></div>
        <div class="stat-card ${unassigned.length ? 'warning' : ''}"><span>Unassigned</span><strong>${unassigned.length}</strong></div>
        <div class="stat-card ${overdue.length ? 'warning' : ''}"><span>Overdue</span><strong>${overdue.length}</strong></div>
        <div class="stat-card ${dueSoon.length ? 'warning' : ''}"><span>Due soon</span><strong>${dueSoon.length}</strong></div>
        <div class="stat-card ${advisories.length ? 'warning' : ''}"><span>Advisories</span><strong>${advisories.length}</strong></div>
      </section>

      ${missingDates.length ? `
        <div class="notice notice-warning">
          <strong>${missingDates.length} generated task${missingDates.length === 1 ? '' : 's'} cannot be dated yet.</strong>
          Configure the relevant deadline codes in the Start module and make sure the event date is set.
          <button class="text-button inline" data-view="module:start">Open planning timeline</button>
        </div>
      ` : ''}

      <section class="task-toolbar">
        <div class="filter-tabs">
          ${[
            ['open', 'Open'],
            ['all', 'All'],
            ['overdue', 'Overdue'],
            ['due-soon', 'Due soon'],
            ['unassigned', 'Unassigned'],
            ['done', 'Completed']
          ].map(([value, label]) => `<button class="filter-tab ${filter === value ? 'active' : ''}" data-task-filter="${value}">${label}</button>`).join('')}
        </div>
        <div class="task-toolbar-actions">
          <button class="button button-secondary" data-action="send-notifications">Send queued notifications</button>
          <button class="button button-secondary" data-action="export-csv">Export CSV</button>
          <button class="button button-secondary" data-action="print">Print</button>
        </div>
      </section>

      <div class="task-board-list">
        ${filtered.length ? filtered.map(task => renderTaskBoardCard(task, event)).join('') : `
          <div class="empty-state">
            <div class="empty-icon">✓</div>
            <h3>No tasks in this view</h3>
            <p>Answer more playbook questions or choose a different task filter.</p>
          </div>
        `}
      </div>
    `;
  }

  function renderTaskBoardCard(task, event) {
    const { item, module, dueDate } = task;
    const taskState = task.state;
    const dueLabel = dueDate ? formatDate(dueDate) : item.deadlineCode ? `Deadline ${item.deadlineCode} is not configured` : 'No due date';
    const detail = getTaskDetail(item, event);
    return `
      <article class="task-card ${taskState.completed ? 'completed' : ''}">
        <label class="task-card-check">
          <input type="checkbox" data-task-complete="${item.id}" ${taskState.completed ? 'checked' : ''}>
          <span></span>
        </label>
        <div class="task-card-content">
          <div class="task-card-heading">
            <div>
              <div class="task-module-label">${escapeHtml(module.title)}${item.responsibleArea ? ` · ${escapeHtml(item.responsibleArea)}` : ''}</div>
              <h3>${escapeHtml(item.title)}</h3>
              ${item.defaultOwnerRoleId ? `<small class="default-owner-label">Default: ${escapeHtml(roleById(item.defaultOwnerRoleId)?.name ?? item.defaultOwnerRoleId)}</small>` : ''}
            </div>
            <div class="task-due-block ${dueDate ? '' : 'missing'}">
              <span class="task-board-milestone-code">${escapeHtml(item.deadlineCode ?? '—')}</span>
              <span class="task-board-milestone-copy">
                <small>${escapeHtml(item.deadlineCode ? (MILESTONE_LABELS[item.deadlineCode] ?? item.deadlineCode) : 'No milestone')}</small>
                <strong>${escapeHtml(dueLabel)}</strong>
              </span>
            </div>
          </div>
          ${detail ? `<p class="task-detail">${escapeHtml(detail)}</p>` : ''}
          <div class="task-fields">
            <div class="task-assignment-field">
              <span>Assigned to</span>
              ${renderAssignmentPicker({ value: taskAssignmentReference(taskState) ?? taskState.assignee, fallback: taskState.assignee, taskId: item.id })}
            </div>
            <label class="task-notes-field">
              <span>Task notes</span>
              <input type="text" value="${escapeHtml(taskState.notes ?? '')}" placeholder="Add any event-specific detail" data-task-notes="${item.id}">
            </label>
          </div>
          <div class="task-operational-row">
            <span class="notification-chip ${taskState.notificationStatus ?? 'none'}">${taskState.notificationStatus === 'queued' ? 'Assignment notification queued' : taskState.notificationStatus === 'outbox' ? 'Notification written to development outbox' : taskState.assignee ? 'Owner assigned' : 'Awaiting owner'}</span>
            ${taskState.assignee && !assignmentRecipient(taskAssignmentReference(taskState) ?? taskState.assignee, event).email ? `<span class="notification-chip warning">No email configured for this person or role</span>` : ''}
            ${taskState.completionToken ? `<button class="text-button inline" data-copy-completion="${escapeHtml(item.id)}">Copy completion link</button>` : ''}
            ${taskState.completedAt ? `<span class="completed-at">Completed ${escapeHtml(formatDate(taskState.completedAt.substring(0,10)))}</span>` : ''}
          </div>
        </div>
      </article>
    `;
  }

  function getEventTaskSnapshot(event) {
    const tasks = [];
    for (const module of playbook.modules) {
      if (!isModuleActive(module, event)) continue;
      for (const section of module.sections) {
        for (const item of section.items) {
          if (item.type !== 'task' || !isItemVisible(item, event)) continue;
          tasks.push({
            item,
            module,
            section,
            dueDate: getDueDate(item.deadlineCode, event),
            state: event.taskState?.[item.id] ?? {}
          });
        }
      }
    }
    return tasks.sort((a, b) => (a.dueDate ?? '9999-99-99').localeCompare(b.dueDate ?? '9999-99-99'));
  }

  function catalogueYear(event) {
    if (event.eventDate && /^\d{4}-/.test(event.eventDate)) return event.eventDate.substring(0, 4);
    if (event.createdAt && /^\d{4}-/.test(event.createdAt)) return event.createdAt.substring(0, 4);
    return 'Date not set';
  }

  function renderCatalogue() {
    const grouped = new Map();
    const sortedEvents = [...state.events].sort((a, b) => {
      const aDate = a.eventDate || a.createdAt || '';
      const bDate = b.eventDate || b.createdAt || '';
      return bDate.localeCompare(aDate);
    });

    for (const event of sortedEvents) {
      const year = catalogueYear(event);
      if (!grouped.has(year)) grouped.set(year, []);
      grouped.get(year).push(event);
    }

    return `
      <section class="catalogue-intro">
        <div>
          <span class="eyebrow">Club event history</span>
          <h2>Event catalogue</h2>
          <p>Every event lives here. Review what was planned, see the tasks that were created, capture what was learned and reuse successful events when they return.</p>
        </div>
        <button class="button button-primary button-large" data-action="new-event">Create new event</button>
      </section>

      ${state.events.length === 0 ? `
        <section class="empty-catalogue-state">
          <span class="eyebrow">No events yet</span>
          <h2>Create the first event</h2>
          <p>Start by recording the event date, key planning milestones and a detailed description. The description will also be used by the AI artwork and planning features.</p>
          <button class="button button-primary" data-action="new-event">Create new event</button>
        </section>` : [...grouped.entries()].map(([year, events]) => `
        <section class="catalogue-year-section">
          <div class="catalogue-year-heading">
            <div>
              <span class="eyebrow">Events</span>
              <h3>${escapeHtml(year)}</h3>
            </div>
            <span>${events.length} event${events.length === 1 ? '' : 's'}</span>
          </div>
          <div class="catalogue-grid">
            ${events.map(event => renderCatalogueCard(event)).join('')}
          </div>
        </section>`).join('')}
    `;
  }

  function renderCatalogueCard(event) {
    const lifecycle = normaliseEventLifecycle(event);
    const statusDefinition = eventStatusDefinition(event);
    const tasks = getEventTaskSnapshot(event);
    const completed = tasks.filter(task => task.state.completed).length;
    const retroCount = Object.values(event.retrospective ?? {}).filter(value => value !== '' && value !== null && value !== undefined).length;
    const closed = Boolean(event.closedAt);
    const current = event.id === state.activeEventId;
    const usesPublishedArtwork = Boolean(event.publishedCataloguePosterThumbnail);
    const catalogueArtwork = event.publishedCataloguePosterThumbnail || event.cataloguePosterThumbnail || '';
    const sourceIsSquare = usesPublishedArtwork
      ? event.publishedCataloguePosterSourceIsSquare ?? event.cataloguePosterSourceIsSquare
      : event.cataloguePosterSourceIsSquare;
    const sourceOutputId = usesPublishedArtwork
      ? event.publishedCataloguePosterSourceOutputId ?? event.cataloguePosterSourceOutputId
      : event.cataloguePosterSourceOutputId;
    const thumbnailMode = usesPublishedArtwork
      ? event.publishedCataloguePosterThumbnailMode ?? event.cataloguePosterThumbnailMode
      : event.cataloguePosterThumbnailMode;
    const legacyPortraitClass = catalogueArtwork && sourceIsSquare === false && thumbnailMode !== 'cover'
      ? sourceOutputId === 'a4' ? ' legacy-fitted-a4' : ' legacy-fitted-portrait'
      : '';
    return `
      <article class="catalogue-card status-${escapeHtml(lifecycle.status)}${closed ? ' closed' : ''}${current ? ' current' : ''}">
        <button class="catalogue-poster" data-event-summary="${escapeHtml(event.id)}" aria-label="View summary for ${escapeHtml(event.name)}">
          ${catalogueArtwork
            ? `<img class="${legacyPortraitClass.trim()}" src="${escapeHtml(catalogueArtwork)}" alt="Campaign artwork for ${escapeHtml(event.name)}">`
            : `<span class="catalogue-poster-placeholder"><img src="./assets/botgc-mark.svg" alt=""><small>Artwork not generated yet</small></span>`}
          <span class="catalogue-status status-${escapeHtml(lifecycle.status)}">${escapeHtml(statusDefinition.label)}</span>
          ${current ? '<span class="catalogue-current-badge">Current event</span>' : ''}
        </button>
        <div class="catalogue-card-body">
          <div class="catalogue-card-heading">
            <div>
              <span class="eyebrow">${escapeHtml(event.eventDate ? formatDate(event.eventDate) : 'Date not set')}</span>
              <h3>${escapeHtml(event.name)}</h3>
            </div>
          </div>
          <p class="catalogue-description">${escapeHtml(event.description || 'No event description has been recorded yet.')}</p>
          <div class="catalogue-stats">
            <span><strong>${tasks.length}</strong> tasks</span>
            <span><strong>${completed}</strong> complete</span>
            <span><strong>${retroCount}</strong> retrospective answers</span>
          </div>
          <div class="button-row">
            <button class="button button-primary" data-event-summary="${escapeHtml(event.id)}">View event summary</button>
            ${closed
              ? `<button class="button button-primary" data-reopen-event="${escapeHtml(event.id)}">Reopen event</button>
                 <button class="button button-secondary" data-clone-event="${escapeHtml(event.id)}">Create from this event</button>`
              : `<button class="button button-secondary" data-open-event="${escapeHtml(event.id)}" aria-label="${escapeHtml(current ? `Continue planning ${event.name}` : `Select ${event.name} and open planner`)}">${current ? 'Continue planning' : 'Select & open planner'}</button>
                 <button class="button button-secondary catalogue-close" data-close-event="${escapeHtml(event.id)}">Close & create new</button>`}
          </div>
        </div>
      </article>`;
  }

  function renderEventSummaryContent(event) {
    const lifecycle = normaliseEventLifecycle(event);
    const statusDefinition = eventStatusDefinition(event);
    const tasks = getEventTaskSnapshot(event);
    const retrospectiveFields = playbook.retrospective?.fields ?? [];
    return `
      <div class="summary-dialog-header">
        <div>
          <span class="eyebrow">Event summary · ${escapeHtml(statusDefinition.label)}</span>
          <h2>${escapeHtml(event.name)}</h2>
          <p>${escapeHtml(event.eventDate ? formatDate(event.eventDate) : 'Date not set')} ${event.organiser ? `· Organiser: ${escapeHtml(event.organiser)}` : ''}</p>
        </div>
        <button class="icon-button" data-action="close-summary" aria-label="Close">×</button>
      </div>
      <div class="summary-dialog-body">
        <section class="summary-description">
          <span class="eyebrow">Event</span>
          <p>${escapeHtml(cleanSummaryDescription(event.description || 'No event description was recorded.'))}</p>
        </section>

        <section class="summary-section summary-event-status status-${escapeHtml(lifecycle.status)}">
          <div class="summary-section-heading"><h3>Operational status</h3><span class="event-status-pill status-${escapeHtml(lifecycle.status)}">${escapeHtml(statusDefinition.label)}</span></div>
          <p>${escapeHtml(statusDefinition.summary)}</p>
          ${lifecycle.reason ? `<p><strong>Reason:</strong> ${escapeHtml(lifecycle.reason)}</p>` : ''}
          <div class="summary-retro-grid"><div class="summary-retro-item"><span>Decision owner</span><strong>${escapeHtml(lifecycle.decisionOwner || 'Not assigned')}</strong></div><div class="summary-retro-item"><span>Communications owner</span><strong>${escapeHtml(lifecycle.communicationsOwner || 'Not assigned')}</strong></div></div>
        </section>

        <section class="summary-section">
          <div class="summary-section-heading"><h3>Tasks created</h3><span>${tasks.filter(task => task.state.completed).length}/${tasks.length} complete</span></div>
          ${tasks.length ? `<div class="summary-task-list">${tasks.map(task => `
            <div class="summary-task-row ${task.state.completed ? 'complete' : ''}">
              <span class="summary-task-status">${task.state.completed ? '✓' : '○'}</span>
              <div><strong>${escapeHtml(task.item.title)}</strong><small>${escapeHtml(task.module.title)}${task.dueDate ? ` · Due ${escapeHtml(formatDate(task.dueDate))}` : ''}${task.state.assignee ? ` · ${escapeHtml(task.state.assignee)}` : ''}</small></div>
            </div>`).join('')}</div>` : '<p class="summary-empty">No tasks were generated for this event.</p>'}
        </section>

        <section class="summary-section">
          <div class="summary-section-heading"><h3>Retrospective</h3></div>
          <div class="summary-retro-grid">
            ${retrospectiveFields.map(field => {
              const value = event.retrospective?.[field.id];
              const display = value === true ? 'Yes' : value === false ? 'No' : value === '' || value === null || value === undefined ? 'Not recorded' : String(value);
              return `<div class="summary-retro-item"><span>${escapeHtml(field.label)}</span><strong>${escapeHtml(display)}</strong></div>`;
            }).join('')}
          </div>
        </section>
      </div>
      <div class="summary-dialog-footer">
        ${event.closedAt ? `<span class="summary-closed">Closed ${escapeHtml(formatDate(event.closedAt.substring(0,10)))}</span>` : '<span></span>'}
        <div class="button-row">
          <button class="button button-secondary" data-manage-event-status="${escapeHtml(event.id)}">Manage status</button>
          ${event.closedAt ? `<button class="button button-primary" data-reopen-event="${escapeHtml(event.id)}">Reopen event</button><button class="button button-secondary" data-clone-event="${escapeHtml(event.id)}">Create from this event</button>` : `<button class="button button-secondary" data-open-event="${escapeHtml(event.id)}">Open planner</button><button class="button button-primary" data-close-event="${escapeHtml(event.id)}">Close & create new</button>`}
        </div>
      </div>`;
  }

  function renderRetrospective(event) {
    const fields = playbook.retrospective?.fields ?? [];
    return `
      <section class="page-header"><div><div class="eyebrow">Post-event review</div><h2>Retrospective</h2><p>Capture what happened, the financial result and the lessons that should be carried into the next running of this event.</p></div></section>
      <section class="playbook-section retrospective-section">
        <div class="retrospective-grid">
          ${fields.map(field => renderRetrospectiveField(field, event)).join('')}
        </div>
      </section>`;
  }

  function renderRetrospectiveField(field, event) {
    const value = event.retrospective?.[field.id] ?? '';
    if (field.type === 'textarea') return `<label class="retro-field wide"><span>${escapeHtml(field.label)}</span><textarea rows="5" data-retro-field="${escapeHtml(field.id)}">${escapeHtml(value)}</textarea></label>`;
    if (field.type === 'yesNo') return `<div class="retro-field"><span>${escapeHtml(field.label)}</span><div class="choice-group yes-no-group"><button class="choice-button ${value === true ? 'selected' : ''}" data-retro-choice="${escapeHtml(field.id)}" data-value="true">Yes</button><button class="choice-button ${value === false ? 'selected' : ''}" data-retro-choice="${escapeHtml(field.id)}" data-value="false">No</button></div></div>`;
    const type = field.type === 'number' || field.type === 'currency' ? 'number' : 'text';
    const step = field.type === 'currency' ? '0.01' : '1';
    return `<label class="retro-field"><span>${escapeHtml(field.label)}</span><input type="${type}" step="${step}" value="${escapeHtml(value)}" data-retro-field="${escapeHtml(field.id)}"></label>`;
  }

  function renderAdmin(event) {
    return `
      <section class="page-header"><div><div class="eyebrow">Configuration</div><h2>Playbook admin</h2><p>Manage responsibility contacts and extend the data-driven Playbook without changing application code.</p></div></section>
      <section class="admin-grid">
        <article class="admin-card"><div class="section-heading"><h3>Responsibility directory</h3></div>
          <div class="contact-list">${state.contacts.map(contact => renderContactEditor(contact)).join('')}</div>
          <button class="button button-secondary" data-action="add-contact">Add contact</button>
        </article>
        <article class="admin-card"><div class="section-heading"><h3>Add a question or task</h3></div>
          <div class="admin-form">
            <label><span>Module</span><select id="admin-module">${playbook.modules.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.title)}</option>`).join('')}</select></label>
            <label><span>Section</span><select id="admin-section">${playbook.modules[0].sections.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.title)}</option>`).join('')}</select></label>
            <label><span>Type</span><select id="admin-type"><option value="question">Question</option><option value="task">Task</option></select></label>
            <label class="wide"><span>Question / task wording</span><input id="admin-wording" type="text"></label>
            <label><span>Answer type</span><select id="admin-answer-type"><option value="yesNo">Yes / No</option><option value="text">Text</option><option value="time">Time</option><option value="number">Number</option></select></label>
            <label><span>Deadline code (tasks)</span><select id="admin-deadline"><option value="">None</option>${playbook.deadlineCodes.map(d => `<option value="${escapeHtml(d.code)}">${escapeHtml(d.code)}</option>`).join('')}</select></label>
            <label><span>Default owner role</span><select id="admin-role"><option value="">None</option>${(playbook.responsibilityRoles ?? []).map(r => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`).join('')}</select></label>
            <label><span>Show when question</span><select id="admin-condition-question"><option value="">Always</option>${[...itemIndex.values()].filter(x => x.item.type === 'question').map(x => `<option value="${escapeHtml(x.item.id)}">${escapeHtml(x.item.label)}</option>`).join('')}</select></label>
            <label><span>Condition value</span><input id="admin-condition-value" type="text" placeholder="true, false or exact value"></label>
          </div>
          <div class="button-row"><button class="button button-primary" data-action="admin-add-item">Add to draft</button><button class="button button-secondary" data-action="admin-publish">Validate & publish</button></div>
          <div class="notice"><strong>${state.adminDraftItems.length} draft change${state.adminDraftItems.length === 1 ? '' : 's'}.</strong> Draft changes do not alter the live Playbook until Validate & publish is selected.</div>
          ${state.adminDraftItems.length ? `<div class="draft-list">${state.adminDraftItems.map(item => `<div class="draft-row"><span>${escapeHtml(item.type)}</span><strong>${escapeHtml(item.wording)}</strong><small>${escapeHtml(item.moduleId)} / ${escapeHtml(item.sectionId)}</small></div>`).join('')}</div>` : ''}
        </article>
        <article class="admin-card advisory-admin-card">
          <div class="section-heading"><h3>Add an advisory rule</h3></div>
          <p class="help-text">Advisories challenge an answer when derived event facts suggest the organiser may have overlooked something. They do not run arbitrary custom code.</p>
          <div class="admin-form">
            <label><span>Question being challenged</span><select id="advisory-question">${[...itemIndex.values()].filter(x => x.item.type === 'question').map(x => `<option value="${escapeHtml(x.item.id)}">${escapeHtml(x.item.label)}</option>`).join('')}</select></label>
            <label><span>Trigger answer</span><select id="advisory-answer"><option value="false">No</option><option value="true">Yes</option></select></label>
            <label><span>Derived fact</span><select id="advisory-left-fact"><option value="expectedLatestGolfFinish">Expected latest golf finish</option><option value="expectedFirstGolfFinish">Expected first golf finish</option><option value="requiredCateringStart">Required catering start</option></select></label>
            <label><span>Comparison</span><select id="advisory-operator"><option value="laterThan">is later than</option><option value="earlierThan">is earlier than</option></select></label>
            <label><span>Compare with</span><select id="advisory-right-fact"><option value="cateringClosingTime">Catering closing time</option><option value="cateringOpeningTime">Catering opening time</option></select></label>
            <label class="wide"><span>Warning title</span><input id="advisory-title" type="text" placeholder="Players may return after catering closes"></label>
            <label class="wide"><span>Warning message</span><input id="advisory-message" type="text" placeholder="Use {expectedLatestGolfFinish} and {cateringClosingTime} to include calculated values"></label>
          </div>
          <div class="button-row"><button class="button button-primary" data-action="admin-add-advisory">Add advisory to draft</button></div>
          <div class="notice"><strong>${state.adminDraftAdvisories.length} advisory draft${state.adminDraftAdvisories.length === 1 ? '' : 's'}.</strong> These are published with the rest of the Playbook draft.</div>
          ${state.adminDraftAdvisories.length ? `<div class="draft-list">${state.adminDraftAdvisories.map(item => `<div class="draft-row"><span>Advisory</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.targetQuestionId)}</small></div>`).join('')}</div>` : ''}
        </article>
      </section>`;
  }

  function renderContactEditor(contact) {
    const roles = playbook.responsibilityRoles ?? [];
    return `<div class="contact-editor" data-contact-id="${escapeHtml(contact.id)}">
      <input type="text" value="${escapeHtml(contact.name)}" data-contact-field="name" placeholder="Name">
      <input type="email" value="${escapeHtml(contact.email ?? '')}" data-contact-field="email" placeholder="Email">
      <select data-contact-field="roleId"><option value="">Role</option>${roles.map(role => `<option value="${escapeHtml(role.id)}" ${contact.roleIds?.includes(role.id) ? 'selected' : ''}>${escapeHtml(role.name)}</option>`).join('')}</select>
    </div>`;
  }

  function renderNewEventDialog() {
    return `
      <dialog id="new-event-dialog" class="modal new-event-dialog">
        <form method="dialog" id="new-event-form">
          <div class="modal-heading">
            <div>
              <span class="eyebrow">New event</span>
              <h2>Create an event plan</h2>
              <p>Record the event clearly now so the Playbook, task engine and Digital Artwork all start from the same information.</p>
            </div>
            <button class="icon-button" type="button" data-cancel-new-event aria-label="Close">×</button>
          </div>

          <div class="new-event-grid">
            <section class="new-event-section">
              <div class="new-event-section-heading"><span>01</span><div><h3>Event details</h3><p>The core information that identifies the event.</p></div></div>
              <div class="new-event-fields">
                <label class="wide">
                  <span>Event name</span>
                  <input id="new-event-name" type="text" required autocomplete="off">
                </label>
                <label>
                  <span>Provisional event date</span>
                  <input id="new-event-date" type="date" required>
                </label>
                <div class="new-event-organiser-field">
                  <span>Organiser</span>
                  ${renderAssignmentPicker({ mode: 'person', newEventField: 'organiser', id: 'new-event-organiser' })}
                </div>
                <label class="wide description-field">
                  <span>Detailed event description</span>
                  <textarea id="new-event-description" rows="7" required placeholder="Describe the format of the event, who it is for, what happens on the day, how golf or clubhouse facilities are used, expected atmosphere, unusual features, catering requirements and anything else that makes the event distinctive."></textarea>
                  <small>The more detailed this description is, the better placed the AI will be to generate appropriate artwork and assist with the running and planning of the event.</small>
                </label>
              </div>
            </section>

            <section class="new-event-section milestone-setup-section">
              <div class="new-event-section-heading"><span>02</span><div><h3>Planning milestones</h3><p>Choose the key dates that generated tasks will work back from. Sensible defaults are filled in from the event date and can be changed now.</p></div></div>
              <div class="new-event-milestones">
                ${playbook.deadlineCodes.filter(code => !code.dynamic).map(code => `
                  <label class="new-event-milestone">
                    <span class="new-event-milestone-name"><strong>${escapeHtml(code.code)}</strong>${escapeHtml(MILESTONE_LABELS[code.code] ?? code.label)}</span>
                    <span class="new-event-milestone-controls">
                      <span class="new-event-offset-control">
                        <input
                          id="new-event-milestone-offset-${escapeHtml(code.code)}"
                          data-new-event-milestone-offset="${escapeHtml(code.code)}"
                          type="number"
                          step="1"
                          value="${DEFAULT_MILESTONE_OFFSETS[code.code] ?? 0}"
                          ${code.code === 'DT' ? 'readonly' : ''}
                          aria-label="${escapeHtml(MILESTONE_LABELS[code.code] ?? code.label)} days relative to event date">
                        <span>days</span>
                      </span>
                      <input id="new-event-milestone-${escapeHtml(code.code)}" data-new-event-milestone="${escapeHtml(code.code)}" type="date" ${code.code === 'DT' ? 'readonly' : ''}>
                    </span>
                  </label>`).join('')}
              </div>
              <div class="milestone-guidance">
                <strong>Default planning rhythm</strong>
                <span>Initial and detailed planning lead into a commitment decision and a final go/no-go. These two decision gates should happen before operational teams make difficult-to-reverse commitments.</span>
              </div>
            </section>
          </div>

          <div class="modal-actions">
            <button class="button button-secondary" type="button" data-cancel-new-event>Cancel</button>
            <button class="button button-primary" type="submit" data-submit-new-event>Create event</button>
          </div>
        </form>
      </dialog>
    `;
  }

  function populateNewEventMilestones(eventDate, force = false) {
    for (const [code, defaultOffset] of Object.entries(DEFAULT_MILESTONE_OFFSETS)) {
      const dateInput = document.querySelector(`[data-new-event-milestone="${CSS.escape(code)}"]`);
      const offsetInput = document.querySelector(`[data-new-event-milestone-offset="${CSS.escape(code)}"]`);
      const summary = document.querySelector(`[data-new-event-milestone-offset-summary="${CSS.escape(code)}"]`);
      if (!dateInput || !offsetInput) continue;

      let offset = Number(offsetInput.value);
      if (force || !Number.isFinite(offset) || code === 'DT') {
        offset = defaultOffset;
        offsetInput.value = String(offset);
      }

      dateInput.value = eventDate ? addDaysToIsoDate(eventDate, offset) : '';
      if (summary) summary.textContent = formatMilestoneOffset(offset);
    }
  }

  function updateNewEventMilestoneFromOffset(code) {
    const eventDate = document.getElementById('new-event-date')?.value ?? '';
    const dateInput = document.querySelector(`[data-new-event-milestone="${CSS.escape(code)}"]`);
    const offsetInput = document.querySelector(`[data-new-event-milestone-offset="${CSS.escape(code)}"]`);
    const summary = document.querySelector(`[data-new-event-milestone-offset-summary="${CSS.escape(code)}"]`);
    if (!dateInput || !offsetInput) return;

    const offset = Number(offsetInput.value);
    if (!Number.isFinite(offset)) return;

    dateInput.value = eventDate ? addDaysToIsoDate(eventDate, offset) : '';
    if (summary) summary.textContent = formatMilestoneOffset(offset);
  }

  function updateNewEventMilestoneOffsetFromDate(code) {
    const eventDate = document.getElementById('new-event-date')?.value ?? '';
    const dateInput = document.querySelector(`[data-new-event-milestone="${CSS.escape(code)}"]`);
    const offsetInput = document.querySelector(`[data-new-event-milestone-offset="${CSS.escape(code)}"]`);
    const summary = document.querySelector(`[data-new-event-milestone-offset-summary="${CSS.escape(code)}"]`);
    if (!dateInput || !offsetInput || !eventDate || !dateInput.value) return;

    const offset = daysBetweenIsoDates(eventDate, dateInput.value);
    if (offset === null) return;

    offsetInput.value = String(offset);
    if (summary) summary.textContent = formatMilestoneOffset(offset);
  }

  function getOverallQuestionProgress(event) {
    let total = 0;
    let answered = 0;
    for (const module of playbook.modules) {
      if (!isModuleActive(module, event)) {
        continue;
      }
      const progress = moduleProgress(module, event);
      total += progress.total;
      answered += progress.answered;
    }
    return {
      total,
      answered,
      percent: total === 0 ? 0 : Math.round((answered / total) * 100)
    };
  }

  function ensureTaskState(event, taskId) {
    if (!event.taskState[taskId]) {
      event.taskState[taskId] = {};
    }
    return event.taskState[taskId];
  }

  function setQuestionAnswer(event, questionId, value) {
    const indexed = itemIndex.get(questionId);
    if (!indexed || indexed.item.type !== 'question') {
      return;
    }

    if (indexed.item.bind === 'eventDate') {
      event.eventDate = value;
      event.milestoneDates ??= {};
      event.milestoneDates.DT = value;
    } else {
      event.answers[questionId] = value;
    }
    if (questionId === 'event-decision-owner') {
      event.lifecycle.decisionOwnerRef = assignmentReference(value);
      event.lifecycle.decisionOwner = assignmentDisplay(value);
      updateTeam(event, assignmentRecipient(value, event).name || event.lifecycle.decisionOwner);
    }
    if (questionId === 'event-communications-owner') {
      event.lifecycle.communicationsOwnerRef = assignmentReference(value);
      event.lifecycle.communicationsOwner = assignmentDisplay(value);
      updateTeam(event, assignmentRecipient(value, event).name || event.lifecycle.communicationsOwner);
    }
    normaliseEventLifecycle(event);
    const decisionTask = buildDontKnowTask(indexed.item);
    if (decisionTask && value !== 'dont-know') delete event.taskState[decisionTask.id];
    normaliseAnswers(event);
    for (const rule of playbook.advisoryRules ?? []) {
      if (rule.targetQuestionId === questionId && value !== rule.triggerAnswer) delete event.advisoryOverrides?.[rule.id];
    }
    saveState();
    render();
  }

  function updateTeam(event, name) {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) {
      return;
    }
    event.team ??= [];
    if (!event.team.some(existing => existing.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) {
      event.team.push(trimmed);
    }
  }

  function updateEventStatusDialogFields() {
    const select = document.getElementById('event-status-value');
    const reasonFields = document.getElementById('event-status-change-fields');
    const memberFields = document.getElementById('event-status-member-fields');
    const reason = document.getElementById('event-status-reason');
    const communicationsOwner = document.getElementById('event-status-communications-owner');
    const guidance = document.getElementById('event-status-guidance');
    if (!select) return;

    const status = select.value;
    const isChangeResponse = CHANGE_RESPONSE_STATUSES.has(status);
    const event = state.events.find(item => item.id === state.activeEventId);
    const requiresCommunicationsOwner = isChangeResponse && event && hasCancellationEvidence(event, 'Communications');
    const needsReason = isChangeResponse || status === 'at-risk';
    reasonFields?.classList.toggle('hidden', !needsReason);
    memberFields?.classList.toggle('hidden', !isChangeResponse);
    if (reason) reason.required = needsReason;
    if (communicationsOwner) communicationsOwner.required = Boolean(requiresCommunicationsOwner);
    if (guidance) guidance.textContent = EVENT_STATUS_DEFINITIONS[status]?.summary ?? '';
  }

  function openEventStatusDialog(eventId = state.activeEventId) {
    if (eventId && eventId !== state.activeEventId && state.events.some(event => event.id === eventId)) {
      state.activeEventId = eventId;
      saveState();
      document.getElementById('event-summary-dialog')?.close();
      render();
      requestAnimationFrame(() => openEventStatusDialog(eventId));
      return;
    }
    const dialog = document.getElementById('event-status-dialog');
    if (!dialog) return;
    updateEventStatusDialogFields();
    dialog.showModal();
    requestAnimationFrame(() => document.getElementById('event-status-value')?.focus());
  }

  function applyEventStatusChange(event) {
    const lifecycle = normaliseEventLifecycle(event);
    const nextStatus = document.getElementById('event-status-value')?.value;
    const decisionOwner = document.getElementById('event-status-decision-owner')?.value.trim() ?? '';
    const communicationsOwner = document.getElementById('event-status-communications-owner')?.value.trim() ?? '';
    const isChangeResponse = CHANGE_RESPONSE_STATUSES.has(nextStatus);
    const requiresCommunicationsOwner = isChangeResponse && hasCancellationEvidence(event, 'Communications');
    const needsReason = isChangeResponse || nextStatus === 'at-risk';
    const reason = needsReason ? document.getElementById('event-status-reason')?.value.trim() ?? '' : '';
    const memberUpdate = isChangeResponse ? document.getElementById('event-status-member-update')?.value.trim() ?? '' : '';
    if (!EVENT_STATUS_DEFINITIONS[nextStatus] || !decisionOwner || (needsReason && !reason) || (requiresCommunicationsOwner && !communicationsOwner)) return false;

    const now = new Date().toISOString();
    const interestedParties = isChangeResponse ? deriveCancellationStakeholders(event) : [];
    const changed = nextStatus !== lifecycle.status ||
      decisionOwner !== lifecycle.decisionOwner ||
      communicationsOwner !== lifecycle.communicationsOwner ||
      reason !== lifecycle.reason ||
      memberUpdate !== lifecycle.memberUpdate;
    if (changed) {
      lifecycle.history.push({
        status: nextStatus,
        changedAt: now,
        changedBy: decisionOwner,
        communicationsOwner,
        reason,
        memberUpdate,
        interestedParties: structuredClone(interestedParties)
      });
    }

    lifecycle.status = nextStatus;
    if (changed) lifecycle.statusChangedAt = now;
    lifecycle.decisionOwner = decisionOwner;
    lifecycle.communicationsOwner = communicationsOwner;
    lifecycle.changedBy = decisionOwner;
    lifecycle.reason = reason;
    lifecycle.memberUpdate = memberUpdate;
    lifecycle.interestedParties = interestedParties;
    event.answers['event-decision-owner'] = decisionOwner;
    event.answers['event-communications-owner'] = communicationsOwner;
    updateTeam(event, decisionOwner);
    updateTeam(event, communicationsOwner);

    event.milestoneDates ??= {};
    if (isChangeResponse) {
      event.milestoneDates.CX = localDateFromTimestamp(now);
      if (nextStatus === 'cancelled') event.cancelledAt = now;
      if (nextStatus === 'postponed') event.postponedAt = now;
      const cancellationCoordinator = String(event.organiser ?? '').trim() || decisionOwner;
      const explicitOwners = [
        ['notify-operational-leads-of-event-change', cancellationCoordinator],
        ['issue-authoritative-event-change-message', communicationsOwner],
        ['stop-scheduled-event-publicity', communicationsOwner]
      ];
      for (const [taskId, owner] of explicitOwners) {
        const indexed = itemIndex.get(taskId);
        if (indexed?.item && owner && isItemVisible(indexed.item, event)) {
          assignTask(event, indexed.item, owner, contactEmailByName(owner), 'event-status');
        }
      }
    } else {
      delete event.milestoneDates.CX;
    }
    if (nextStatus === 'confirmed') event.confirmedAt = now;
    if (nextStatus === 'completed') event.closedAt ??= now;
    else if (event.closedAt) event.closedAt = null;

    saveState();
    return true;
  }

  function closeEventAndCreateNew(eventId) {
    const target = state.events.find(item => item.id === eventId);
    if (!target) return;
    if (!target.closedAt) target.closedAt = new Date().toISOString();
    normaliseEventLifecycle(target);
    if (!CHANGE_RESPONSE_STATUSES.has(target.lifecycle.status)) {
      target.lifecycle.status = 'completed';
      target.lifecycle.statusChangedAt = target.closedAt;
      target.lifecycle.changedBy = target.organiser || target.lifecycle.decisionOwner;
      target.lifecycle.history.push({ status: 'completed', changedAt: target.closedAt, changedBy: target.lifecycle.changedBy, reason: 'Event closed from the catalogue.' });
    }
    saveState();
    document.getElementById('event-summary-dialog')?.close();
    render();
    const dialog = document.getElementById('new-event-dialog');
    const form = document.getElementById('new-event-form');
    form?.reset();
    populateNewEventMilestones('', true);
    dialog?.showModal();
    requestAnimationFrame(() => document.getElementById('new-event-name')?.focus());
  }

  function reopenEvent(eventId) {
    const target = state.events.find(item => item.id === eventId);
    if (!target || !target.closedAt) return;
    target.closedAt = null;
    target.reopenedAt = new Date().toISOString();
    normaliseEventLifecycle(target);
    if (target.lifecycle.status === 'completed') {
      target.lifecycle.status = 'provisional';
      target.lifecycle.statusChangedAt = target.reopenedAt;
      target.lifecycle.reason = 'Event reopened for further planning.';
      target.lifecycle.history.push({ status: 'provisional', changedAt: target.reopenedAt, changedBy: target.organiser || target.lifecycle.decisionOwner, reason: target.lifecycle.reason });
    }
    state.activeEventId = target.id;
    state.activeView = 'module:start';
    saveState();
    document.getElementById('event-summary-dialog')?.close();
    render();
  }

  function bindSummaryDialogEvents() {
    document.querySelectorAll('#event-summary-dialog [data-action="close-summary"]').forEach(element => {
      element.addEventListener('click', () => document.getElementById('event-summary-dialog')?.close());
    });
    document.querySelectorAll('#event-summary-dialog [data-open-event]').forEach(element => {
      element.addEventListener('click', () => {
        state.activeEventId = element.dataset.openEvent;
        state.activeView = 'module:start';
        saveState();
        document.getElementById('event-summary-dialog')?.close();
        render();
      });
    });
    document.querySelectorAll('#event-summary-dialog [data-close-event]').forEach(element => {
      element.addEventListener('click', () => closeEventAndCreateNew(element.dataset.closeEvent));
    });
    document.querySelectorAll('#event-summary-dialog [data-reopen-event]').forEach(element => {
      element.addEventListener('click', () => reopenEvent(element.dataset.reopenEvent));
    });
    document.querySelectorAll('#event-summary-dialog [data-clone-event]').forEach(element => {
      element.addEventListener('click', () => {
        const source = state.events.find(item => item.id === element.dataset.cloneEvent);
        if (!source) return;
        const cloned = cloneEvent(source);
        state.activeEventId = cloned.id;
        state.activeView = 'module:start';
        saveState();
        document.getElementById('event-summary-dialog')?.close();
        render();
      });
    });
    document.querySelectorAll('#event-summary-dialog [data-manage-event-status]').forEach(element => {
      element.addEventListener('click', () => openEventStatusDialog(element.dataset.manageEventStatus));
    });
  }

  function bindEvents() {
    document.querySelectorAll('[data-view]').forEach(element => {
      element.addEventListener('click', () => {
        state.activeView = element.dataset.view;
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-action="manage-event-status"]').forEach(element => {
      element.addEventListener('click', () => openEventStatusDialog());
    });

    document.querySelectorAll('[data-close-event-status]').forEach(element => {
      element.addEventListener('click', () => document.getElementById('event-status-dialog')?.close());
    });

    document.getElementById('event-status-value')?.addEventListener('change', updateEventStatusDialogFields);
    document.getElementById('event-status-form')?.addEventListener('submit', eventArgs => {
      eventArgs.preventDefault();
      const event = getActiveEvent();
      const form = eventArgs.currentTarget;
      updateEventStatusDialogFields();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      if (!event || !applyEventStatusChange(event)) return;
      document.getElementById('event-status-dialog')?.close();
      render();
    });

    document.querySelectorAll('[data-event-id]').forEach(element => {
      element.addEventListener('click', () => {
        state.activeEventId = element.dataset.eventId;
        state.activeView = 'module:start';
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-delete-event]').forEach(element => {
      element.addEventListener('click', eventArgs => {
        eventArgs.stopPropagation();
        const eventId = element.dataset.deleteEvent;
        const target = state.events.find(item => item.id === eventId);
        if (!target) return;
        if (!confirm(`Delete the event plan “${target.name}”?`)) return;
        state.events = state.events.filter(item => item.id !== eventId);
        if (state.activeEventId === eventId) {
          state.activeEventId = state.events[0]?.id ?? null;
        }
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-question-id]').forEach(element => {
      element.addEventListener('click', () => {
        const event = getActiveEvent();
        if (!event) return;
        const value = JSON.parse(element.dataset.answerJson);
        setQuestionAnswer(event, element.dataset.questionId, value);
      });
    });

    document.querySelectorAll('[data-question-input]').forEach(element => {
      element.addEventListener('input', () => {
        const event = getActiveEvent();
        if (!event) return;
        const indexed = itemIndex.get(element.dataset.questionInput);
        if (!indexed || indexed.item.type !== 'question') return;
        if (indexed.item.bind === 'eventDate') {
          event.eventDate = element.value;
          event.milestoneDates ??= {};
          event.milestoneDates.DT = element.value;
        } else {
          event.answers[element.dataset.questionInput] = element.value;
        }
        saveState();
      });
      element.addEventListener('change', () => {
        const event = getActiveEvent();
        if (!event) return;
        setQuestionAnswer(event, element.dataset.questionInput, element.value);
      });
    });

    document.querySelectorAll('[data-time-range-question-id]').forEach(element => {
      element.addEventListener('change', () => {
        const event = getActiveEvent();
        if (!event) return;
        const questionId = element.dataset.timeRangeQuestionId;
        const inputs = [...document.querySelectorAll(`[data-time-range-question-id="${CSS.escape(questionId)}"]`)];
        const value = {};
        for (const input of inputs) value[input.dataset.timeRangePart] = input.value;
        setQuestionAnswer(event, questionId, value);
      });
    });

    document.querySelectorAll('[data-multi-question-id]').forEach(element => {
      element.addEventListener('change', () => {
        const event = getActiveEvent();
        if (!event) return;
        const questionId = element.dataset.multiQuestionId;
        const values = [...document.querySelectorAll(`[data-multi-question-id="${CSS.escape(questionId)}"]`)]
          .filter(input => input.checked)
          .map(input => input.value);
        setQuestionAnswer(event, questionId, values);
      });
    });

    document.querySelectorAll('[data-task-complete]').forEach(element => {
      element.addEventListener('change', () => {
        const event = getActiveEvent();
        if (!event) return;
        const indexed = itemIndex.get(element.dataset.taskComplete);
        if (indexed) markTaskComplete(event, indexed.item, element.checked);
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-task-assignee]').forEach(element => {
      element.addEventListener('change', () => {
        const event = getActiveEvent();
        if (!event) return;
        const indexed = itemIndex.get(element.dataset.taskAssignee);
        if (indexed) assignTask(event, indexed.item, element.value.trim(), contactEmailByName(element.value.trim()), 'manual');
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-task-notes]').forEach(element => {
      element.addEventListener('change', () => {
        const event = getActiveEvent();
        if (!event) return;
        ensureTaskState(event, element.dataset.taskNotes).notes = element.value.trim();
        saveState();
      });
    });

    document.querySelectorAll('[data-save-advisory]').forEach(element => {
      element.addEventListener('click', () => {
        const event = getActiveEvent();
        if (!event) return;
        const ruleId = element.dataset.saveAdvisory;
        const textarea = document.querySelector(`[data-advisory-reason="${CSS.escape(ruleId)}"]`);
        const reason = textarea?.value.trim() ?? '';
        if (!reason) {
          textarea?.focus();
          return;
        }
        event.advisoryOverrides[ruleId] = { reason, recordedAt: new Date().toISOString() };
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-copy-completion]').forEach(element => {
      element.addEventListener('click', async () => {
        const event = getActiveEvent();
        if (!event) return;
        const taskId = element.dataset.copyCompletion;
        const taskState = ensureTaskState(event, taskId);
        if (!taskState.completionToken) return;
        const url = `${location.origin}/complete.html?token=${encodeURIComponent(taskState.completionToken)}`;
        await navigator.clipboard.writeText(url);
        element.textContent = 'Copied';
      });
    });

    document.querySelectorAll('[data-event-field]').forEach(element => {
      element.addEventListener('change', () => {
        const event = getActiveEvent();
        if (!event) return;
        const field = element.dataset.eventField;
        event[field] = element.value.trim();
        if (field === 'organiser') {
          updateTeam(event, event.organiser);
        }
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-milestone-code]').forEach(element => {
      element.addEventListener('change', () => {
        const event = getActiveEvent();
        if (!event) return;
        const code = element.dataset.milestoneCode;
        event.milestoneDates ??= {};
        event.milestoneDates[code] = element.value;
        if (code === 'DT') {
          event.eventDate = element.value;
        }
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-task-filter]').forEach(element => {
      element.addEventListener('click', () => {
        state.taskFilter = element.dataset.taskFilter;
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-action="new-event"]').forEach(element => {
      element.addEventListener('click', () => {
        const dialog = document.getElementById('new-event-dialog');
        const form = document.getElementById('new-event-form');
        form?.reset();
        populateNewEventMilestones('', true);
        dialog.showModal();
        requestAnimationFrame(() => document.getElementById('new-event-name')?.focus());
      });
    });

    const newEventDateInput = document.getElementById('new-event-date');
    if (newEventDateInput) {
      // Re-anchor every milestone to the new event date while preserving any
      // offsets the organiser has deliberately customised.
      newEventDateInput.addEventListener('change', () => populateNewEventMilestones(newEventDateInput.value, false));
    }

    document.querySelectorAll('[data-new-event-milestone-offset]').forEach(input => {
      const update = () => updateNewEventMilestoneFromOffset(input.dataset.newEventMilestoneOffset);
      input.addEventListener('input', update);
      input.addEventListener('change', update);
    });

    document.querySelectorAll('[data-new-event-milestone]').forEach(input => {
      if (input.dataset.newEventMilestone === 'DT') return;
      input.addEventListener('change', () => updateNewEventMilestoneOffsetFromDate(input.dataset.newEventMilestone));
    });

    document.querySelectorAll('[data-open-event]').forEach(element => {
      element.addEventListener('click', () => {
        const eventId = element.dataset.openEvent;
        if (!state.events.some(item => item.id === eventId)) return;
        document.getElementById('event-summary-dialog')?.close();
        state.activeEventId = eventId;
        state.activeView = 'module:start';
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-event-summary]').forEach(element => {
      element.addEventListener('click', () => {
        const target = state.events.find(item => item.id === element.dataset.eventSummary);
        if (!target) return;
        const content = document.getElementById('event-summary-content');
        const dialog = document.getElementById('event-summary-dialog');
        if (!content || !dialog) return;
        content.innerHTML = renderEventSummaryContent(target);
        dialog.showModal();
        bindSummaryDialogEvents();
      });
    });

    document.querySelectorAll('[data-close-event]').forEach(element => {
      element.addEventListener('click', () => closeEventAndCreateNew(element.dataset.closeEvent));
    });

    document.querySelectorAll('[data-reopen-event]').forEach(element => {
      element.addEventListener('click', () => reopenEvent(element.dataset.reopenEvent));
    });

    document.querySelectorAll('[data-clone-event]').forEach(element => {
      element.addEventListener('click', () => {
        const source = state.events.find(item => item.id === element.dataset.cloneEvent);
        if (!source) return;
        const cloned = cloneEvent(source);
        state.activeEventId = cloned.id;
        state.activeView = 'module:start';
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-retro-field]').forEach(element => {
      element.addEventListener('change', () => {
        const event = getActiveEvent(); if (!event) return;
        event.retrospective[element.dataset.retroField] = element.type === 'number' && element.value !== '' ? Number(element.value) : element.value;
        saveState();
      });
    });
    document.querySelectorAll('[data-retro-choice]').forEach(element => {
      element.addEventListener('click', () => {
        const event = getActiveEvent(); if (!event) return;
        event.retrospective[element.dataset.retroChoice] = element.dataset.value === 'true';
        saveState(); render();
      });
    });

    document.querySelectorAll('[data-action="poster-studio"]').forEach(element => {
      element.addEventListener('click', () => {
        state.activeView = 'artwork';
        saveState();
        render();
      });
    });

    const referenceImageInput = document.getElementById('reference-library-image');
    referenceImageInput?.addEventListener('change', async () => {
      const [file] = [...(referenceImageInput.files ?? [])];
      if (!file) {
        renderReferenceLibraryPreview('');
        delete referenceImageInput.dataset.dataUrl;
        return;
      }
      const dataUrl = await fileToDataUrl(file);
      referenceImageInput.dataset.dataUrl = dataUrl;
      renderReferenceLibraryPreview(dataUrl);
    });

    document.querySelectorAll('[data-action="add-library-image"]').forEach(element => {
      element.addEventListener('click', () => {
        resetReferenceLibraryForm();
        document.getElementById('reference-library-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        requestAnimationFrame(() => document.getElementById('reference-library-title')?.focus());
      });
    });

    document.querySelectorAll('[data-action="reference-form-reset"]').forEach(element => {
      element.addEventListener('click', () => {
        const imageInput = document.getElementById('reference-library-image');
        if (imageInput) {
          imageInput.value = '';
          delete imageInput.dataset.dataUrl;
        }
        resetReferenceLibraryForm();
      });
    });

    const referenceLibraryForm = document.getElementById('reference-library-form');
    referenceLibraryForm?.addEventListener('submit', async eventArgs => {
      eventArgs.preventDefault();
      const references = loadReferenceLibrary();
      const id = document.getElementById('reference-library-id').value || crypto.randomUUID();
      const imageInput = document.getElementById('reference-library-image');
      const existing = references.find(item => item.id === id);
      let dataUrl = imageInput?.dataset.dataUrl || existing?.dataUrl || '';
      if (!dataUrl && imageInput?.files?.[0]) {
        dataUrl = await fileToDataUrl(imageInput.files[0]);
      }
      if (!dataUrl) {
        alert('Please choose an image.');
        return;
      }
      const next = {
        id,
        title: document.getElementById('reference-library-title').value.trim(),
        category: document.getElementById('reference-library-category').value.trim(),
        priority: Number(document.getElementById('reference-library-priority').value || 0),
        tags: parseReferenceTags(document.getElementById('reference-library-tags').value),
        description: document.getElementById('reference-library-description').value.trim(),
        active: document.getElementById('reference-library-active').checked,
        dataUrl,
        updatedAt: new Date().toISOString(),
        createdAt: existing?.createdAt ?? new Date().toISOString()
      };
      const filtered = references.filter(item => item.id !== id);
      filtered.push(next);
      saveReferenceLibrary(filtered);
      if (imageInput) {
        imageInput.value = '';
        delete imageInput.dataset.dataUrl;
      }
      resetReferenceLibraryForm();
      render();
    });

    document.querySelectorAll('[data-edit-reference]').forEach(element => {
      element.addEventListener('click', () => {
        const reference = loadReferenceLibrary().find(item => item.id === element.dataset.editReference);
        if (!reference) return;
        populateReferenceLibraryForm(reference);
        document.getElementById('reference-library-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    document.querySelectorAll('[data-toggle-reference]').forEach(element => {
      element.addEventListener('click', () => {
        const references = loadReferenceLibrary();
        const target = references.find(item => item.id === element.dataset.toggleReference);
        if (!target) return;
        target.active = target.active === false;
        target.updatedAt = new Date().toISOString();
        saveReferenceLibrary(references);
        render();
      });
    });

    document.querySelectorAll('[data-delete-reference]').forEach(element => {
      element.addEventListener('click', () => {
        const references = loadReferenceLibrary();
        const target = references.find(item => item.id === element.dataset.deleteReference);
        if (!target) return;
        if (!confirm(`Delete the reference “${target.title}”?`)) return;
        saveReferenceLibrary(references.filter(item => item.id !== target.id));
        resetReferenceLibraryForm();
        render();
      });
    });

    document.querySelectorAll('[data-contact-field]').forEach(element => {
      element.addEventListener('change', () => {
        const row = element.closest('[data-contact-id]');
        const contact = state.contacts.find(item => item.id === row?.dataset.contactId);
        if (!contact) return;
        const field = element.dataset.contactField;
        if (field === 'roleId') contact.roleIds = element.value ? [element.value] : [];
        else contact[field] = element.value.trim();
        saveState(); render();
      });
    });

    document.querySelectorAll('[data-action="add-contact"]').forEach(element => {
      element.addEventListener('click', () => {
        state.contacts.push({ id: crypto.randomUUID(), name: 'New contact', email: '', roleIds: [], active: true });
        saveState(); render();
      });
    });

    document.querySelectorAll('[data-action="admin-add-item"]').forEach(element => {
      element.addEventListener('click', () => {
        const moduleId = document.getElementById('admin-module')?.value;
        const sectionId = document.getElementById('admin-section')?.value;
        const type = document.getElementById('admin-type')?.value;
        const wording = document.getElementById('admin-wording')?.value.trim();
        if (!moduleId || !sectionId || !wording) return;
        const module = moduleIndex.get(moduleId);
        const section = module?.sections.find(item => item.id === sectionId);
        if (!section) return;
        const conditionQuestion = document.getElementById('admin-condition-question')?.value;
        const rawCondition = document.getElementById('admin-condition-value')?.value.trim();
        let conditionValue = rawCondition;
        if (rawCondition === 'true') conditionValue = true;
        if (rawCondition === 'false') conditionValue = false;
        state.adminDraftItems.push({
          id: `${type}-${Date.now()}`,
          moduleId,
          sectionId,
          type,
          wording,
          answerType: document.getElementById('admin-answer-type')?.value || 'text',
          deadlineCode: document.getElementById('admin-deadline')?.value || undefined,
          defaultOwnerRoleId: document.getElementById('admin-role')?.value || undefined,
          conditionQuestion: conditionQuestion || undefined,
          conditionValue
        });
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-action="admin-add-advisory"]').forEach(element => {
      element.addEventListener('click', () => {
        const title = document.getElementById('advisory-title')?.value.trim();
        const message = document.getElementById('advisory-message')?.value.trim();
        if (!title || !message) return;
        state.adminDraftAdvisories.push({
          id: `advisory-${Date.now()}`,
          targetQuestionId: document.getElementById('advisory-question')?.value,
          triggerAnswer: document.getElementById('advisory-answer')?.value === 'true',
          leftFact: document.getElementById('advisory-left-fact')?.value,
          operator: document.getElementById('advisory-operator')?.value,
          rightFact: document.getElementById('advisory-right-fact')?.value,
          title,
          message
        });
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-action="admin-publish"]').forEach(element => {
      element.addEventListener('click', () => {
        try {
          const candidate = structuredClone(playbook);
          for (const draft of state.adminDraftItems) {
            const module = candidate.modules.find(item => item.id === draft.moduleId);
            const section = module?.sections.find(item => item.id === draft.sectionId);
            if (!section) throw new Error(`Draft target ${draft.moduleId}/${draft.sectionId} no longer exists.`);
            const showWhen = draft.conditionQuestion ? { all: [{ questionId: draft.conditionQuestion, operator: 'equals', value: draft.conditionValue }] } : undefined;
            if (draft.type === 'task') {
              const role = (candidate.responsibilityRoles ?? []).find(item => item.id === draft.defaultOwnerRoleId);
              section.items.push({ id: draft.id, type: 'task', title: draft.wording, deadlineCode: draft.deadlineCode, defaultOwnerRoleId: draft.defaultOwnerRoleId, responsibleArea: role?.area, showWhen, source: 'admin' });
            } else {
              section.items.push({ id: draft.id, type: 'question', label: draft.wording, answerType: draft.answerType, required: true, showWhen, source: 'admin' });
            }
          }
          candidate.advisoryRules ??= [];
          for (const draft of state.adminDraftAdvisories) {
            if (!itemIndex.has(draft.targetQuestionId)) throw new Error(`Advisory target ${draft.targetQuestionId} does not exist.`);
            candidate.advisoryRules.push({
              id: draft.id,
              title: draft.title,
              severity: 'warning',
              targetQuestionId: draft.targetQuestionId,
              triggerAnswer: draft.triggerAnswer,
              derivedCondition: { fact: draft.leftFact, operator: draft.operator, valueFact: draft.rightFact },
              message: draft.message,
              requireOverrideReason: true
            });
          }
          validatePlaybook(candidate);
          const nextVersion = Number.parseFloat(candidate.schemaVersion || '1') + 0.1;
          candidate.schemaVersion = nextVersion.toFixed(1);
          playbook = candidate;
          state.adminDraftItems = [];
          state.adminDraftAdvisories = [];
          localStorage.setItem(STORAGE_TEMPLATE, JSON.stringify(playbook));
          indexPlaybook(); saveState();
          alert(`Playbook v${playbook.schemaVersion} validated and published locally.`);
          render();
        } catch (error) {
          alert(`Cannot publish: ${error.message}`);
        }
      });
    });

    const adminModule = document.getElementById('admin-module');
    adminModule?.addEventListener('change', () => {
      const section = document.getElementById('admin-section');
      const module = moduleIndex.get(adminModule.value);
      if (section && module) section.innerHTML = module.sections.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`).join('');
    });

    document.querySelectorAll('[data-action="load-playbook"]').forEach(element => {
      element.addEventListener('click', () => playbookFileInput.click());
    });

    document.querySelectorAll('[data-action="export-plan"]').forEach(element => {
      element.addEventListener('click', exportEventPlan);
    });

    document.querySelectorAll('[data-action="send-notifications"]').forEach(element => {
      element.addEventListener('click', async () => {
        const queued = (state.notificationOutbox ?? []).filter(item => item.status === 'queued');
        if (queued.length === 0) {
          alert('There are no queued notifications.');
          return;
        }
        try {
          const response = await fetch('/api/tasks/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notifications: queued }) });
          if (!response.ok) throw new Error('Notification endpoint returned an error.');
          const result = await response.json();
          for (const notification of queued) notification.status = result.deliveryMode === 'development-outbox' ? 'outbox' : 'sent';
          for (const event of state.events) for (const taskState of Object.values(event.taskState ?? {})) if (taskState.notificationStatus === 'queued') taskState.notificationStatus = result.deliveryMode === 'development-outbox' ? 'outbox' : 'sent';
          saveState();
          alert(`${queued.length} notification${queued.length === 1 ? '' : 's'} processed via ${result.deliveryMode}.`);
          render();
        } catch (error) {
          alert(error.message);
        }
      });
    });

    document.querySelectorAll('[data-action="export-csv"]').forEach(element => {
      element.addEventListener('click', exportTasksCsv);
    });

    document.querySelectorAll('[data-action="print"]').forEach(element => {
      element.addEventListener('click', () => window.print());
    });

    document.querySelectorAll('[data-action="reset-playbook"]').forEach(element => {
      element.addEventListener('click', () => {
        if (!confirm('Reset the playbook template to the bundled sample? Your event answers will be retained where IDs still match.')) {
          return;
        }
        localStorage.removeItem(STORAGE_TEMPLATE);
        location.reload();
      });
    });

    const newEventForm = document.getElementById('new-event-form');
    const newEventDialog = document.getElementById('new-event-dialog');

    document.querySelectorAll('[data-cancel-new-event]').forEach(button => {
      button.addEventListener('click', () => {
        newEventForm?.reset();
        populateNewEventMilestones('', true);
        newEventDialog?.close();
      });
    });

    if (newEventForm) {
      newEventForm.addEventListener('submit', eventArgs => {
        eventArgs.preventDefault();

        // Only Create event invokes validation. Cancel, close and Escape never do.
        if (!newEventForm.checkValidity()) {
          newEventForm.reportValidity();
          return;
        }

        const nameInput = document.getElementById('new-event-name');
        const eventDateInput = document.getElementById('new-event-date');
        const descriptionInput = document.getElementById('new-event-description');

        const name = nameInput.value.trim();
        const eventDate = eventDateInput.value;
        const organiser = document.getElementById('new-event-organiser').value.trim();
        const description = descriptionInput.value.trim();

        // Native required validation catches empty values; these trim checks
        // also reject fields containing only spaces.
        if (!name) {
          nameInput.setCustomValidity('Enter an event name.');
          nameInput.reportValidity();
          nameInput.setCustomValidity('');
          return;
        }
        if (!description) {
          descriptionInput.setCustomValidity('Enter a useful event description.');
          descriptionInput.reportValidity();
          descriptionInput.setCustomValidity('');
          return;
        }

        const milestoneDates = {};
        let milestoneInvalid = false;
        document.querySelectorAll('[data-new-event-milestone]').forEach(input => {
          if (!input.value) milestoneInvalid = true;
          milestoneDates[input.dataset.newEventMilestone] = input.value;
        });

        if (milestoneInvalid) {
          eventDateInput.setCustomValidity('Choose an event date so the planning milestones can be calculated.');
          eventDateInput.reportValidity();
          eventDateInput.setCustomValidity('');
          return;
        }

        milestoneDates.DT = eventDate;
        createEvent(name, organiser, eventDate, description, milestoneDates);
        newEventDialog?.close();
        render();
      });
    }
  }

  function exportEventPlan() {
    const event = getActiveEvent();
    if (!event) return;
    const tasks = getActiveTasks(event).map(task => ({
      id: task.item.id,
      module: task.module.title,
      title: task.item.title,
      deadlineCode: task.item.deadlineCode ?? null,
      dueDate: task.dueDate,
      assignee: task.state.assignee ?? null,
      completed: Boolean(task.state.completed),
      notes: task.state.notes ?? null
    }));

    const exportData = {
      playbookId: playbook.id,
      playbookSchemaVersion: playbook.schemaVersion,
      exportedAt: new Date().toISOString(),
      event: {
        id: event.id,
        name: event.name,
        organiser: event.organiser,
        eventDate: event.eventDate,
        description: event.description,
        lifecycle: structuredClone(event.lifecycle),
        deadlineOffsets: Object.fromEntries(playbook.deadlineCodes.map(code => [code.code, getDeadlineOffset(code.code, event)])),
        answers: event.answers,
        tasks
      }
    };

    downloadBlob(
      `${safeFilename(event.name)}-event-plan.json`,
      JSON.stringify(exportData, null, 2),
      'application/json'
    );
  }

  function exportTasksCsv() {
    const event = getActiveEvent();
    if (!event) return;
    const rows = [
      ['Event', 'Module', 'Task', 'Deadline code', 'Due date', 'Assigned to', 'Status', 'Notes']
    ];
    for (const task of getActiveTasks(event)) {
      rows.push([
        event.name,
        task.module.title,
        task.item.title,
        task.item.deadlineCode ?? '',
        task.dueDate ?? '',
        task.state.assignee ?? '',
        task.state.completed ? 'Complete' : 'Open',
        task.state.notes ?? ''
      ]);
    }

    const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    downloadBlob(`${safeFilename(event.name)}-tasks.csv`, csv, 'text/csv;charset=utf-8');
  }

  function csvCell(value) {
    const text = String(value ?? '');
    return `"${text.replaceAll('"', '""')}"`;
  }

  function safeFilename(value) {
    return String(value || 'event')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'event';
  }

  function downloadBlob(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  playbookFileInput.addEventListener('change', async () => {
    const file = playbookFileInput.files?.[0];
    playbookFileInput.value = '';
    if (!file) return;

    try {
      let candidate = JSON.parse(await file.text());
      candidate = migratePlaybookMilestoneCodes(candidate);
      validatePlaybook(candidate);
      if (state.events.length > 0 && !confirm('Load this playbook template? Existing event data will be retained, but questions or tasks with different IDs may no longer appear.')) {
        return;
      }
      playbook = candidate;
      localStorage.setItem(STORAGE_TEMPLATE, JSON.stringify(candidate));
      indexPlaybook();
      state.activeView = 'module:start';
      saveState();
      render();
    } catch (error) {
      alert(`Could not load the playbook: ${error.message}`);
    }
  });

  loadInitialPlaybook()
    .then(async candidate => {
      candidate = migratePlaybookMilestoneCodes(candidate);
      validatePlaybook(candidate);
      playbook = candidate;
      indexPlaybook();
      await initialiseSharedState();
      migrateMilestoneState();
      initialiseOperationalState();
      const params = new URLSearchParams(location.search);
      const requestedView = params.get('view');
      if (requestedView) state.activeView = requestedView;
      const completeToken = params.get('complete');
      if (completeToken) {
        const eventId = params.get('event');
        const taskId = params.get('task');
        const targetEvent = state.events.find(item => item.id === eventId);
        const targetState = targetEvent?.taskState?.[taskId];
        if (targetEvent && targetState?.completionToken === completeToken) {
          const indexed = itemIndex.get(taskId);
          if (indexed && confirm(`Mark “${indexed.item.title}” as complete?`)) {
            markTaskComplete(targetEvent, indexed.item, true);
            saveState();
            state.activeEventId = targetEvent.id;
            state.activeView = 'tasks';
            history.replaceState({}, '', location.pathname);
          }
        }
      }
      await syncServerCompletions();
      render();
    })
    .catch(error => {
      app.innerHTML = `
        <div class="fatal-error">
          <h1>Unable to load the playbook</h1>
          <p>${escapeHtml(error.message)}</p>
          <p>If you opened index.html directly from disk, use the standalone-demo.html file or run the folder through any static web server.</p>
          <button class="button button-primary" id="fatal-load">Choose playbook JSON</button>
        </div>
      `;
      document.getElementById('fatal-load')?.addEventListener('click', () => playbookFileInput.click());
    });
})();
