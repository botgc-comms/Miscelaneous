(() => {
  'use strict';

  const STORAGE_STATE = 'botgc-event-playbook-state-v2';
  const STORAGE_TEMPLATE = 'botgc-event-playbook-template-v1';
  const REFERENCE_LIBRARY_STORAGE = 'botgc-event-playbook-reference-library-v1';
  const STORAGE_SHARED_MIGRATED = 'botgc-event-playbook-shared-migration-v1';
  const CLUB_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

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
  const NOTIFIABLE_EVENT_STATUSES = new Set(['confirmed', 'at-risk', 'postponed', 'cancelled']);
  const EVENT_STATUS_RECIPIENT_DEFINITIONS = Object.freeze([
    { value: 'food-beverage', label: 'Food & Beverage', roleId: 'food-beverage-manager', ownerQuestionId: 'food-service-owner' },
    { value: 'clubhouse', label: 'Clubhouse', roleId: 'clubhouse' },
    { value: 'golf', label: 'Golf Operations', roleId: 'golf-manager' },
    { value: 'communications', label: 'Communications', roleId: 'communications', ownerQuestionId: 'event-communications-owner' },
    { value: 'suppliers', label: 'External suppliers', roleId: 'event-coordinator' },
    { value: 'entertainment', label: 'Entertainment and production', roleId: 'event-coordinator', ownerQuestionId: 'entertainment-event-contact' },
    { value: 'admission', label: 'Admission and payments', roleId: 'office' },
    { value: 'staffing', label: 'Staff and volunteers', roleId: 'event-coordinator', ownerQuestionId: 'staffing-coordinator' }
  ]);

  const INTELLIGENT_GOLF_NOTE_GROUPS = Object.freeze([
    { title: 'Leadership and contacts', fields: [
      ['event-decision-owner', 'Decision owner'], ['event-communications-owner', 'Communications owner'],
      ['staffing-coordinator', 'Staffing coordinator'], ['event-day-lead', 'Event-day lead']
    ] },
    { title: 'Golf operations', fields: [
      ['golf-type', 'Golf format'], ['golf-player-count', 'Players'], ['golf-supporter-count', 'Supporters'],
      ['golf-start-method', 'Start method'], ['tee-time-window', 'Tee-time window'], ['shotgun-start-time', 'Shotgun start'],
      ['competition-format', 'Competition'], ['golf-results-technology-plan', 'Scoring technology and fallback'],
      ['special-course-details', 'Non-standard course setup'], ['arrival-sign-in', 'Player check-in'],
      ['arrival-direction-signage', 'Arrival signage'], ['starter-required', 'Starter required'],
      ['course-marshals-required', 'Course marshals required']
    ] },
    { title: 'Rooms and setup', fields: [
      ['clubhouse-areas', 'Rooms/areas'], ['clubhouse-other-area', 'Other area'],
      ['seated-dining', 'Seated dining'], ['seating-setup-required', 'Special seating setup'],
      ['seating-layout', 'Seating layout'], ['seating-layout-notes', 'Layout instructions'],
      ['top-table-required', 'Top table'], ['top-table-seat-count', 'Top-table seats'],
      ['special-table-covering', 'Table covering'], ['special-table-covering-notes', 'Covering instructions'],
      ['room-theme', 'Room theme'], ['screen-channel', 'Required television/screen channel']
    ] },
    { title: 'Catering and bar', fields: [
      ['required-catering-start', 'Catering required from'], ['bar-service-required', 'Event bar service'],
      ['bar-service-start', 'Bar opens'], ['bar-service-end', 'Bar closes'],
      ['extended-catering-until', 'Extended catering until'], ['extended-catering-service', 'Extended service'],
      ['catering-covers', 'Food covers'], ['agreed-menu-choices', 'Menu/meal choices'],
      ['meal-service-time', 'Food service time'], ['food-service-arrangement', 'Food service arrangement'],
      ['food-service-arrangement-other', 'Other service arrangement'],
      ['food-service-self-service-supervisor', 'Self-service supervisor'],
      ['food-service-owner', 'Food-service owner'], ['dietary-requirements-summary', 'Dietary/allergen requirements']
    ] },
    { title: 'Bookings and admission', fields: [
      ['admission-arrangements', 'Booking/admission arrangement'], ['admission-price-details', 'Prices and inclusions'],
      ['admission-capacity', 'Capacity'], ['ticket-sales-open-date', 'Bookings open'],
      ['ticket-sales-close-date', 'Bookings close'], ['ig-ticket-allocation', 'IG ticket allocation'],
      ['ig-ticket-types', 'IG ticket types'], ['guest-table-booking', 'Separate table booking'],
      ['door-admission-process', 'Door/check-in process'], ['admission-payment-methods', 'Payment methods'],
      ['admission-cash-float', 'Cash float/handover']
    ] },
    { title: 'Entertainment and presentation', fields: [
      ['entertainment-outline', 'Programme/experience'], ['external-entertainment-provider', 'Entertainer/supplier'],
      ['entertainment-space-requirements', 'Performance space'],
      ['entertainment-technical-requirements', 'Technical requirements'],
      ['entertainment-event-contact', 'Entertainer contact on the day'],
      ['prize-requirements-detail', 'Prizes/awards'], ['prize-table-required', 'Prize table'],
      ['presentation-microphone-needed', 'Microphone/PA'], ['speaker-required', 'Host/speaker'],
      ['photos-required', 'Presentation photographs']
    ] },
    { title: 'Staffing, access and lock-up', fields: [
      ['event-day-duty-allocations', 'Duty allocations'], ['staff-briefing-comments', 'Additional briefing instructions'],
      ['additional-event-staff-areas', 'Teams needing changed cover'],
      ['additional-event-staff-details', 'Additional cover'], ['event-rotas-confirmed', 'Rotas updated'],
      ['whole-event-cover-confirmed', 'Full-event cover'], ['staffing-contingency-confirmed', 'Fallback cover'],
      ['event-opening-arrangement', 'Opening/early access'], ['event-opening-person', 'Person providing access'],
      ['event-lock-up-arrangement', 'Closing/lock-up'], ['event-lock-up-person', 'Final closer/keyholder']
    ] },
    { title: 'Safety and contingencies', fields: [
      ['risk-assessment-required', 'Event-specific risk assessment'], ['juniors-involved', 'Juniors involved'],
      ['weather-contingency', 'Weather contingency']
    ] },
    { title: 'Close-down', fields: [
      ['close-down-actions', 'Items/areas to reset'], ['close-down-plan-details', 'Close-down instructions'],
      ['additional-close-down-details', 'Additional recovery work'], ['close-down-lead', 'Close-down lead/team']
    ] }
  ]);

  const FOOD_SERVICE_REVIEW_TASK_IDS_V36 = Object.freeze([
    'external-food-service-liaison-task',
    'food-staff-task',
    'food-service-readiness-task',
    'event-day-food-service-task'
  ]);
  const LEGACY_FOOD_REVIEW_COMPLETION_PROVENANCE = 'pre-v3.6-food-review';
  const RETIRED_EVENT_CONTROL_TASK_IDS_V37 = Object.freeze([
    'decide-operational-commitments',
    'check-event-communications-already-sent',
    'confirm-fb-before-commitment',
    'confirm-communications-before-promotion',
    'final-event-go-no-go'
  ]);

  const FINANCE_CATEGORIES = Object.freeze({
    income: ['Ticket sales', 'Bar sales', 'Catering sales', 'Sponsorship', 'Donations', 'Other income'],
    expense: ['Additional staffing', 'Food and stock', 'Entertainment', 'Prizes and trophies', 'Equipment and hire', 'Marketing', 'Supplier costs', 'Other expense']
  });

  const FINANCE_CALCULATIONS = Object.freeze({
    total: { label: 'Single total', quantityLabel: '', unitLabel: '' },
    tickets: { label: 'Tickets sold × ticket price', quantityLabel: 'Tickets sold', unitLabel: 'Price per ticket' },
    staffing: { label: 'Staff hours × hourly cost', quantityLabel: 'Additional hours', unitLabel: 'Hourly cost' }
  });

  const INTELLIGENT_GOLF_EVENT_TYPES = Object.freeze([
    { id: 0, label: 'No event type' },
    { id: 17, label: 'Committee Meeting' },
    { id: 10, label: 'County Event' },
    { id: 20, label: 'Green Fee' },
    { id: 19, label: 'Green Fees' },
    { id: 15, label: 'Invitation Days' },
    { id: 16, label: 'Juniors' },
    { id: 4, label: 'Ladies Team' },
    { id: 22, label: 'Meeting Room Hire' },
    { id: 18, label: 'Member Private Meal' },
    { id: 8, label: 'Member Social Event' },
    { id: 3, label: 'Mens Team' },
    { id: 7, label: 'Mixed Team' },
    { id: 21, label: 'Non Member Social Event' },
    { id: 5, label: 'Open Competition' },
    { id: 6, label: 'Seniors Team' },
    { id: 14, label: 'Society' },
    { id: 23, label: 'Special Dining Event' },
    { id: 11, label: 'Wakes' }
  ]);

  function renderIntelligentGolfEventTypeOptions(selectedId = 0) {
    const selected = Number(selectedId) || 0;
    return INTELLIGENT_GOLF_EVENT_TYPES
      .map(type => `<option value="${type.id}"${type.id === selected ? ' selected' : ''}>${escapeHtml(type.label)}</option>`)
      .join('');
  }

  const PLATFORM_ROLE_DEFINITIONS = Object.freeze([
    { id: 'team-member', name: 'Team member', description: 'Can receive and complete assigned tasks.' },
    { id: 'organiser', name: 'Organiser', description: 'Can create events and manage event planning.' },
    { id: 'admin', name: 'Admin', description: 'Can manage the directory and Playbook configuration.' }
  ]);

  const app = document.getElementById('app');
  const playbookFileInput = document.getElementById('playbook-file-input');

  let playbook = null;
  let playbookTemplateRevision = 0;
  let protectedQuestionIds = [];
  let playbookTemplateNeedsMigration = false;
  let pendingPlaybookTemplateDocument = null;
  let playbookTemplatePollTimer = null;
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
  const completionLinkRegistrationSignatures = new Map();
  const completionLinkRegistrationRequests = new Map();
  let taskBoardDeepLinkTarget = null;
  const feedbackCache = new Map();
  const feedbackRequests = new Set();
  const briefingGenerationRequests = new Map();
  let taskNoteReturnFocus = null;
  const taskBoardSelection = {
    eventId: '',
    scopeKey: '',
    taskIds: new Set()
  };
  let pluginSettingsCache = null;
  let pluginSettingsRequest = null;
  let pluginSettingsNotice = '';
  let pluginCapabilities = {
    intelligentGolfEnabled: false,
    mondayEnabled: false,
    yodeckEnabled: false
  };
  const intelligentGolfEventStatuses = new Map();
  const intelligentGolfStatusRequests = new Map();
  const intelligentGolfStatusRefreshTimers = new Map();
  let intelligentGolfStatusCacheEpoch = 0;
  const deferredIntelligentGolfMatches = new Set();
  const intelligentGolfResolutionNotices = new Map();
  let intelligentGolfPlannerLinkDialogState = null;
  let intelligentGolfPlannerLinkRequest = null;
  let intelligentGolfPlannerLinkShouldRestoreFocus = false;
  let integrationActivityCache = null;
  let integrationActivityRequest = null;
  const DEFAULT_CLUB_BRANDING = Object.freeze({
    clubName: 'Burton-on-Trent Golf Club',
    crestUrl: '/assets/botgc-mark.svg',
    hasCustomCrest: false,
    updatedAtUtc: null
  });
  let clubBranding = { ...DEFAULT_CLUB_BRANDING };
  let clubBrandingNotice = '';
  const ADMIN_VIEWS = new Set(['admin', 'plugins']);
  let accessSession = {
    authenticated: false,
    isAdmin: false,
    administratorLoginConfigured: false,
    displayName: ''
  };
  const requestedView = new URLSearchParams(window.location.search).get('view');
  if (['dashboard', 'tasks', 'finances', 'briefing', 'catalogue', 'artwork', 'cancellation', 'retrospective', 'admin', 'plugins', 'references', 'directory'].includes(requestedView)) {
    state.activeView = requestedView;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_STATE);
      if (!raw) {
        return {
          activeEventId: null,
          activeView: 'dashboard',
          taskFilter: 'open',
          dashboardTaskFilter: 'open',
          taskBoardMode: 'mine',
          taskBoardHorizon: 'auto',
          taskBoardPersonId: '',
          deadlineOffsets: {},
          directoryInitialised: false,
          roles: [],
          deletedRoleIds: [],
          contacts: [],
          referenceLibrary: [],
          taskAlertSchedule: null,
          notificationOutbox: [],
          adminDraftItems: [],
          adminDraftAdvisories: [],
          events: []
        };
      }

      const parsed = JSON.parse(raw);
      return {
        activeEventId: parsed.activeEventId ?? null,
        activeView: parsed.activeView ?? 'dashboard',
        taskFilter: parsed.taskFilter ?? 'open',
        dashboardTaskFilter: ['open', 'done', 'all'].includes(parsed.dashboardTaskFilter) ? parsed.dashboardTaskFilter : 'open',
        taskBoardMode: parsed.taskBoardMode === 'overview' ? 'overview' : 'mine',
        taskBoardHorizon: ['auto', 'attention', 'next-days', 'next-weeks', 'later', 'completed'].includes(parsed.taskBoardHorizon) ? parsed.taskBoardHorizon : 'auto',
        taskBoardPersonId: String(parsed.taskBoardPersonId ?? ''),
        deadlineOffsets: parsed.deadlineOffsets && typeof parsed.deadlineOffsets === 'object' ? parsed.deadlineOffsets : {},
        directoryInitialised: parsed.directoryInitialised === true,
        roles: Array.isArray(parsed.roles) ? parsed.roles : [],
        deletedRoleIds: Array.isArray(parsed.deletedRoleIds) ? [...new Set(parsed.deletedRoleIds.filter(Boolean).map(String))] : [],
        contacts: Array.isArray(parsed.contacts) ? parsed.contacts : [],
        referenceLibrary: Array.isArray(parsed.referenceLibrary) ? parsed.referenceLibrary : loadLegacyReferenceLibrary(),
        taskAlertSchedule: parsed.taskAlertSchedule && typeof parsed.taskAlertSchedule === 'object' ? parsed.taskAlertSchedule : null,
        notificationOutbox: Array.isArray(parsed.notificationOutbox) ? parsed.notificationOutbox : [],
        adminDraftItems: Array.isArray(parsed.adminDraftItems) ? parsed.adminDraftItems : [],
        adminDraftAdvisories: Array.isArray(parsed.adminDraftAdvisories) ? parsed.adminDraftAdvisories : [],
        events: Array.isArray(parsed.events) ? parsed.events : []
      };
    } catch {
      return {
        activeEventId: null,
        activeView: 'dashboard',
        taskFilter: 'open',
        dashboardTaskFilter: 'open',
        taskBoardMode: 'mine',
        taskBoardHorizon: 'auto',
        taskBoardPersonId: '',
        deadlineOffsets: {},
        directoryInitialised: false,
        roles: [],
        deletedRoleIds: [],
        contacts: [],
        referenceLibrary: [],
        taskAlertSchedule: null,
        notificationOutbox: [],
        adminDraftItems: [],
        events: []
      };
    }
  }

  async function initialiseAccessSession() {
    try {
      const response = await fetch('/api/auth/session', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Access session could not be loaded (${response.status}).`);
      const result = await response.json();
      accessSession = {
        authenticated: result.authenticated === true,
        isAdmin: result.isAdmin === true,
        administratorLoginConfigured: result.administratorLoginConfigured === true,
        displayName: String(result.displayName ?? '')
      };
    } catch (error) {
      console.error('Unable to determine administrator access', error);
    }
  }

  function updatePluginCapabilities(value) {
    const intelligentGolfEnabled = value?.intelligentGolf?.enabled === true;
    const intelligentGolfChanged = pluginCapabilities.intelligentGolfEnabled !== intelligentGolfEnabled;
    pluginCapabilities = {
      intelligentGolfEnabled,
      mondayEnabled: value?.monday?.enabled === true,
      yodeckEnabled: value?.yodeck?.enabled === true
    };
    if (intelligentGolfChanged) invalidateIntelligentGolfEventStatusCache();
  }

  function invalidateIntelligentGolfEventStatusCache() {
    intelligentGolfStatusCacheEpoch += 1;
    intelligentGolfEventStatuses.clear();
    intelligentGolfStatusRequests.clear();
    intelligentGolfStatusRefreshTimers.forEach(timer => window.clearTimeout(timer));
    intelligentGolfStatusRefreshTimers.clear();
  }

  async function initialisePluginStatus() {
    try {
      const response = await fetch('/api/plugins/status', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Plugin status could not be loaded (${response.status}).`);
      updatePluginCapabilities(await response.json());
    } catch (error) {
      console.error('Unable to determine enabled plugins', error);
      updatePluginCapabilities(null);
    }
  }

  function normaliseIntelligentGolfEventStatus(value) {
    return {
      available: value?.available === true,
      linked: value?.linked === true || Number(value?.plannerEntryId) > 0,
      plannerEntryId: Number(value?.plannerEntryId) || null,
      diaryEntryId: Number(value?.diaryEntryId) || null,
      plannerMatchRequired: value?.plannerMatchRequired === true,
      plannerMatchEventDate: String(value?.plannerMatchEventDate ?? ''),
      plannerMatchCandidates: Array.isArray(value?.plannerMatchCandidates)
        ? value.plannerMatchCandidates
          .map(candidate => ({
            intelligentGolfEventId: Number(candidate?.intelligentGolfEventId) || 0,
            name: String(candidate?.name ?? '').trim(),
            linkedToAnotherPlaybookEvent: candidate?.linkedToAnotherPlaybookEvent === true
          }))
          .filter(candidate => candidate.intelligentGolfEventId > 0 && candidate.name)
        : [],
      matchRequiredAtUtc: value?.matchRequiredAtUtc ?? null,
      lastError: String(value?.lastError ?? ''),
      updatedAtUtc: value?.updatedAtUtc ?? null,
      checkedAt: Date.now()
    };
  }

  function intelligentGolfMatchSignature(eventId, status) {
    if (!status?.plannerMatchRequired || status.plannerMatchCandidates.length === 0) return '';
    return `${eventId}:${status.plannerMatchEventDate}:${status.plannerMatchCandidates.map(candidate => candidate.intelligentGolfEventId).join(',')}`;
  }

  function normaliseIntelligentGolfPlannerCandidates(value, fallbackPlannerEntryId = null) {
    const currentPlannerEntryId = Number(value?.currentPlannerEntryId) || Number(fallbackPlannerEntryId) || null;
    const candidates = Array.isArray(value?.candidates)
      ? value.candidates
        .map(candidate => {
          const intelligentGolfEventId = Number(candidate?.intelligentGolfEventId) || 0;
          return {
            intelligentGolfEventId,
            name: String(candidate?.name ?? '').trim() || `Planner entry ${intelligentGolfEventId}`,
            current: candidate?.current === true || intelligentGolfEventId === currentPlannerEntryId,
            linkedToAnotherPlaybookEvent: candidate?.linkedToAnotherPlaybookEvent === true
          };
        })
        .filter(candidate => candidate.intelligentGolfEventId > 0)
      : [];

    return {
      currentPlannerEntryId,
      eventDate: String(value?.eventDate ?? ''),
      candidates,
      currentPlannerEntryDiscovered: Boolean(currentPlannerEntryId) &&
        candidates.some(candidate => candidate.intelligentGolfEventId === currentPlannerEntryId)
    };
  }

  async function ensureIntelligentGolfEventStatus(eventId, force = false) {
    if (!pluginCapabilities.intelligentGolfEnabled || !eventId) return null;
    const cached = intelligentGolfEventStatuses.get(eventId);
    if (!force && cached &&
        ((cached.linked && cached.available) || cached.plannerMatchRequired || Date.now() - cached.checkedAt < 15000)) return cached;
    if (intelligentGolfStatusRequests.has(eventId)) return intelligentGolfStatusRequests.get(eventId);

    const requestEpoch = intelligentGolfStatusCacheEpoch;
    const request = (async () => {
      try {
        const response = await fetch(`/api/integrations/intelligent-golf/events/${encodeURIComponent(eventId)}`, {
          cache: 'no-store'
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `Intelligent Golf status could not be loaded (${response.status}).`);
        if (requestEpoch !== intelligentGolfStatusCacheEpoch) return intelligentGolfEventStatuses.get(eventId) ?? null;
        const next = normaliseIntelligentGolfEventStatus(result);
        const previous = intelligentGolfEventStatuses.get(eventId);
        intelligentGolfEventStatuses.set(eventId, next);
        if (next.linked && !next.available && !intelligentGolfStatusRefreshTimers.has(eventId)) {
          scheduleIntelligentGolfStatusRefresh(eventId);
        }
        const visibleChange = JSON.stringify({ ...previous, checkedAt: 0 }) !== JSON.stringify({ ...next, checkedAt: 0 });
        const interactionActive = document.querySelector('dialog[open]') ||
          document.activeElement?.matches?.('input, textarea, select, [contenteditable="true"]');
        if (visibleChange && state.activeEventId === eventId && !interactionActive) render();
        return next;
      } catch (error) {
        console.warn('Unable to check the Intelligent Golf planner link.', error);
        return intelligentGolfEventStatuses.get(eventId) ?? null;
      } finally {
        if (requestEpoch === intelligentGolfStatusCacheEpoch) intelligentGolfStatusRequests.delete(eventId);
      }
    })();
    intelligentGolfStatusRequests.set(eventId, request);
    return request;
  }

  function scheduleIntelligentGolfStatusRefresh(eventId) {
    if (!pluginCapabilities.intelligentGolfEnabled || !eventId) return;
    const currentStatus = intelligentGolfEventStatuses.get(eventId);
    if (currentStatus?.linked && currentStatus.available) return;
    const existing = intelligentGolfStatusRefreshTimers.get(eventId);
    if (existing) window.clearTimeout(existing);
    if (!currentStatus?.linked) intelligentGolfEventStatuses.delete(eventId);

    // Bounded checks cover the debounced shared-state save and one slower IG
    // round trip without leaving a permanent browser polling loop behind.
    const delays = [900, 2300, 5000, 9000, 13000];
    const check = async index => {
      await ensureIntelligentGolfEventStatus(eventId, true);
      const status = intelligentGolfEventStatuses.get(eventId);
      if ((status?.linked && status.available) || status?.plannerMatchRequired || index >= delays.length - 1) {
        intelligentGolfStatusRefreshTimers.delete(eventId);
        return;
      }
      const timer = window.setTimeout(() => check(index + 1), delays[index + 1]);
      intelligentGolfStatusRefreshTimers.set(eventId, timer);
    };
    const timer = window.setTimeout(() => check(0), delays[0]);
    intelligentGolfStatusRefreshTimers.set(eventId, timer);
  }

  async function initialiseClubBranding() {
    try {
      const loaded = window.clubBrandingReady
        ? await window.clubBrandingReady
        : await fetch('/api/branding', { cache: 'no-store' }).then(response => {
          if (!response.ok) throw new Error(`Club identity could not be loaded (${response.status}).`);
          return response.json();
        });
      setClubBranding(loaded);
    } catch (error) {
      console.error('Unable to load the club identity', error);
      setClubBranding(DEFAULT_CLUB_BRANDING);
    }
  }

  function setClubBranding(value) {
    clubBranding = {
      clubName: String(value?.clubName || DEFAULT_CLUB_BRANDING.clubName).trim() || DEFAULT_CLUB_BRANDING.clubName,
      crestUrl: String(value?.crestUrl || DEFAULT_CLUB_BRANDING.crestUrl),
      hasCustomCrest: value?.hasCustomCrest === true,
      updatedAtUtc: value?.updatedAtUtc || null
    };
    window.applyClubBranding?.(clubBranding);
  }

  function adminLoginUrl(view = 'admin') {
    const safeView = ADMIN_VIEWS.has(view) ? view : 'admin';
    return `/admin-login.html?returnUrl=${encodeURIComponent(`/?view=${safeView}`)}`;
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

  function migrateAdmissionPlanningState() {
    if (!itemIndex.has('admission-arrangements')) return false;

    let changed = false;
    const targetItemRemap = {
      'booking-required': 'admission-arrangements',
      'admission-tickets-required': 'admission-arrangements',
      'booking-details-task': 'configure-ticket-sales-task',
      'decide-entry-charge': 'decide-booking-or-entry-charge'
    };

    const migrateRecord = (record, inferLegacyMeaning) => {
      if (!record || typeof record !== 'object') return;

      const hasArrangements = Array.isArray(record['admission-arrangements']) &&
        record['admission-arrangements'].length > 0;
      const legacyCharge = record['entry-charge'];
      const legacyBooking = record['booking-required'];
      const legacyTickets = record['admission-tickets-required'];

      if (inferLegacyMeaning && !hasArrangements) {
        const arrangements = [];
        if (legacyCharge === true) {
          arrangements.push('entry-payment');
          if (legacyTickets === true) arrangements.push('advance-booking');
        } else if (legacyBooking === true) {
          record['entry-charge'] = true;
          arrangements.push('advance-booking');
        } else if (legacyCharge === false && legacyBooking === 'dont-know') {
          record['entry-charge'] = 'dont-know';
        } else if (legacyCharge === false && legacyBooking !== false) {
          // The old question established that entry was free, not that booking
          // was unnecessary. Require a fresh answer to the combined gateway.
          delete record['entry-charge'];
        }

        if (arrangements.length > 0) record['admission-arrangements'] = arrangements;
      }

      delete record['booking-required'];
      delete record['admission-tickets-required'];
    };

    for (const event of state.events ?? []) {
      const before = JSON.stringify({
        answers: event.answers,
        clonedAnswerHints: event.clonedAnswerHints,
        taskState: event.taskState,
        playbookVersion: event.playbookVersion,
        dataMigrations: event.dataMigrations,
        learningInsights: event.learningInsights,
        retrospectiveTaskAnalysis: event.retrospective?.taskAnalysis
      });
      const eventVersion = Number.parseFloat(event.playbookVersion);
      const migrationWasApplied = event.dataMigrations?.admissionPlanningV34 === true;
      const versionlessExplicitNeither = !Number.isFinite(eventVersion) &&
        event.answers?.['entry-charge'] === false &&
        event.answers?.['booking-required'] === false;
      const legacyRecords = [event.answers, event.clonedAnswerHints, event.taskState];
      const hasLegacyAdmissionKeys = legacyRecords.some(record => record && typeof record === 'object' && [
        'booking-required',
        'admission-tickets-required',
        'booking-details-task'
      ].some(key => Object.prototype.hasOwnProperty.call(record, key)));
      const isLegacyEvent = !migrationWasApplied &&
        ((Number.isFinite(eventVersion) && eventVersion < 3.4) || hasLegacyAdmissionKeys);

      event.answers = event.answers && typeof event.answers === 'object' ? event.answers : {};
      migrateRecord(event.answers, isLegacyEvent);
      migrateRecord(event.clonedAnswerHints, isLegacyEvent);
      if (!migrationWasApplied && !Number.isFinite(eventVersion) &&
          !versionlessExplicitNeither &&
          !Array.isArray(event.answers['admission-arrangements']) &&
          event.answers['entry-charge'] === false) {
        // Versionless records cannot prove that an old "free entry" answer
        // also meant no booking, so ask the combined gateway again.
        delete event.answers['entry-charge'];
      }

      event.taskState = event.taskState && typeof event.taskState === 'object' ? event.taskState : {};
      const legacyBookingTask = event.taskState['booking-details-task'];
      if (legacyBookingTask) {
        const bookingTask = event.taskState['configure-ticket-sales-task'] ?? {};
        if (!String(bookingTask.notes ?? '').trim() && String(legacyBookingTask.notes ?? '').trim()) {
          bookingTask.notes = legacyBookingTask.notes;
        }
        event.taskState['configure-ticket-sales-task'] = bookingTask;
        delete event.taskState['booking-details-task'];
      }

      const legacyDecisionTask = event.taskState['decide-entry-charge'];
      if (legacyDecisionTask) {
        const decisionTask = event.taskState['decide-booking-or-entry-charge'] ?? {};
        if (!String(decisionTask.notes ?? '').trim() && String(legacyDecisionTask.notes ?? '').trim()) {
          decisionTask.notes = legacyDecisionTask.notes;
        }
        event.taskState['decide-booking-or-entry-charge'] = decisionTask;
        delete event.taskState['decide-entry-charge'];
      }

      for (const insight of event.learningInsights ?? []) {
        if (!Array.isArray(insight.targetItemIds)) continue;
        insight.targetItemIds = [...new Set(insight.targetItemIds.map(itemId => targetItemRemap[itemId] ?? itemId))];
      }
      for (const proposal of event.retrospective?.taskAnalysis?.proposals ?? []) {
        if (proposal.targetItemId && targetItemRemap[proposal.targetItemId]) {
          proposal.targetItemId = targetItemRemap[proposal.targetItemId];
        }
      }

      event.dataMigrations = event.dataMigrations && typeof event.dataMigrations === 'object'
        ? event.dataMigrations
        : {};
      event.dataMigrations.admissionPlanningV34 = true;

      const after = JSON.stringify({
        answers: event.answers,
        clonedAnswerHints: event.clonedAnswerHints,
        taskState: event.taskState,
        playbookVersion: event.playbookVersion,
        dataMigrations: event.dataMigrations,
        learningInsights: event.learningInsights,
        retrospectiveTaskAnalysis: event.retrospective?.taskAnalysis
      });
      if (before !== after) changed = true;
    }

    const notificationCount = state.notificationOutbox?.length ?? 0;
    state.notificationOutbox = (state.notificationOutbox ?? [])
      .filter(notification => notification.taskId !== 'booking-details-task')
      .filter(notification => notification.taskId !== 'decide-entry-charge');
    if (state.notificationOutbox.length !== notificationCount) changed = true;

    return changed;
  }

  function migrateAdmissionPricingState() {
    // v3.8 restored admission-price-details as the authoritative planning
    // answer. The v3.5 migration moved that legacy answer into task notes, so
    // it must not run against the restored question and delete current data.
    if (itemIndex.has('admission-price-details')) return false;
    if (!itemIndex.has('admission-free-categories') || !itemIndex.has('set-admission-prices-task')) return false;

    let changed = false;
    const legacyQuestionId = 'admission-price-details';
    const priceTaskId = 'set-admission-prices-task';
    const legacyComplimentaryId = 'complimentary-admission';
    const legacyComplimentaryDetailsId = 'complimentary-admission-details';
    const targetItemRemap = {
      [legacyQuestionId]: priceTaskId,
      [legacyComplimentaryId]: 'admission-free-entry',
      [legacyComplimentaryDetailsId]: priceTaskId
    };

    const usableText = value => typeof value === 'string' && value.trim() ? value.trim() : '';
    const appendLegacyPricingNote = (taskState, value, sourceLabel) => {
      const pricing = usableText(value);
      if (!pricing) return;
      const note = `${sourceLabel}: ${pricing}`;
      const existing = usableText(taskState.notes);
      if (!existing) {
        taskState.notes = note;
      } else if (!existing.includes(pricing)) {
        taskState.notes = `${existing}\n\n${note}`;
      }
    };

    for (const event of state.events ?? []) {
      const before = JSON.stringify({
        answers: event.answers,
        clonedAnswerHints: event.clonedAnswerHints,
        taskState: event.taskState,
        dataMigrations: event.dataMigrations,
        learningInsights: event.learningInsights,
        retrospectiveTaskAnalysis: event.retrospective?.taskAnalysis
      });

      event.answers = event.answers && typeof event.answers === 'object' ? event.answers : {};
      event.taskState = event.taskState && typeof event.taskState === 'object' ? event.taskState : {};
      const legacyComplimentary = event.answers[legacyComplimentaryId];
      const legacyComplimentaryHint = event.clonedAnswerHints?.[legacyComplimentaryId];
      if (!Object.prototype.hasOwnProperty.call(event.answers, 'admission-free-entry') && legacyComplimentary === false) {
        event.answers['admission-free-entry'] = false;
      }
      if (event.clonedAnswerHints && typeof event.clonedAnswerHints === 'object' &&
          !Object.prototype.hasOwnProperty.call(event.clonedAnswerHints, 'admission-free-entry') &&
          legacyComplimentaryHint === false) {
        event.clonedAnswerHints['admission-free-entry'] = false;
      }

      const legacyAnswer = event.answers[legacyQuestionId];
      const legacyHint = event.clonedAnswerHints?.[legacyQuestionId];
      const legacyComplimentaryDetails = event.answers[legacyComplimentaryDetailsId];
      const legacyComplimentaryDetailsHint = event.clonedAnswerHints?.[legacyComplimentaryDetailsId];
      if (usableText(legacyAnswer) || usableText(legacyHint) ||
          usableText(legacyComplimentaryDetails) || usableText(legacyComplimentaryDetailsHint) ||
          legacyComplimentary === true || legacyComplimentaryHint === true) {
        const priceTaskState = event.taskState[priceTaskId] ?? {};
        appendLegacyPricingNote(priceTaskState, legacyAnswer, 'Previously recorded pricing — review and confirm');
        appendLegacyPricingNote(priceTaskState, legacyHint, 'Previous event pricing hint — review and confirm');
        appendLegacyPricingNote(priceTaskState, legacyComplimentaryDetails, 'Previously recorded complimentary or discounted entry — review and confirm');
        appendLegacyPricingNote(priceTaskState, legacyComplimentaryDetailsHint, 'Previous event complimentary-entry hint — review and confirm');
        if (legacyComplimentary === true && !usableText(legacyComplimentaryDetails)) {
          appendLegacyPricingNote(priceTaskState, 'Complimentary or discounted admission was previously selected; decide which categories now receive free entry.', 'Previous decision — review and confirm');
        }
        if (legacyComplimentaryHint === true && !usableText(legacyComplimentaryDetailsHint)) {
          appendLegacyPricingNote(priceTaskState, 'The previous event included complimentary or discounted admission; review the free-entry categories.', 'Previous event hint — review and confirm');
        }
        event.taskState[priceTaskId] = priceTaskState;
      }
      delete event.answers[legacyQuestionId];
      delete event.answers[legacyComplimentaryId];
      delete event.answers[legacyComplimentaryDetailsId];
      if (event.clonedAnswerHints && typeof event.clonedAnswerHints === 'object') {
        delete event.clonedAnswerHints[legacyQuestionId];
        delete event.clonedAnswerHints[legacyComplimentaryId];
        delete event.clonedAnswerHints[legacyComplimentaryDetailsId];
      }

      for (const insight of event.learningInsights ?? []) {
        if (!Array.isArray(insight.targetItemIds)) continue;
        insight.targetItemIds = [...new Set(insight.targetItemIds.map(itemId => targetItemRemap[itemId] ?? itemId))];
      }
      for (const proposal of event.retrospective?.taskAnalysis?.proposals ?? []) {
        if (proposal.targetItemId && targetItemRemap[proposal.targetItemId]) {
          proposal.targetItemId = targetItemRemap[proposal.targetItemId];
        }
      }

      event.dataMigrations = event.dataMigrations && typeof event.dataMigrations === 'object'
        ? event.dataMigrations
        : {};
      event.dataMigrations.admissionPricingV35 = true;

      const after = JSON.stringify({
        answers: event.answers,
        clonedAnswerHints: event.clonedAnswerHints,
        taskState: event.taskState,
        dataMigrations: event.dataMigrations,
        learningInsights: event.learningInsights,
        retrospectiveTaskAnalysis: event.retrospective?.taskAnalysis
      });
      if (before !== after) changed = true;
    }

    return changed;
  }

  function migrateFoodServiceReviewCompletionState() {
    if (!FOOD_SERVICE_REVIEW_TASK_IDS_V36.every(taskId => itemIndex.has(taskId))) return false;

    let changed = false;
    for (const event of state.events ?? []) {
      event.dataMigrations = event.dataMigrations && typeof event.dataMigrations === 'object'
        ? event.dataMigrations
        : {};
      if (event.dataMigrations.foodServiceReviewCompletionV36 === true) continue;

      const recordedVersion = String(event.playbookVersion ?? '').trim();
      const eventVersion = Number.parseFloat(recordedVersion);
      // createEvent has always recorded the current playbook version. A persisted
      // event with no version therefore also predates the v3.6 review summaries.
      const isPreV36Event = !recordedVersion || (Number.isFinite(eventVersion) && eventVersion < 3.6);
      if (isPreV36Event && event.taskState && typeof event.taskState === 'object') {
        for (const taskId of FOOD_SERVICE_REVIEW_TASK_IDS_V36) {
          const taskState = event.taskState[taskId];
          if (taskState?.completed === true && !taskState.reviewSignature) {
            taskState.reviewCompletionProvenance = LEGACY_FOOD_REVIEW_COMPLETION_PROVENANCE;
          }
        }
      }

      event.dataMigrations.foodServiceReviewCompletionV36 = true;
      changed = true;
    }
    return changed;
  }

  function migrateAdmissionModelV38() {
    const configuredVersion = Number.parseFloat(playbook?.schemaVersion ?? '0');
    if (!Number.isFinite(configuredVersion) || configuredVersion < 3.8 ||
        !itemIndex.has('admission-arrangements') || !itemIndex.has('admission-price-details')) return false;

    let changed = false;
    const retiredQuestionIds = [
      'booking-registration-instructions',
      'booking-confirmation-process'
    ];
    const retiredTaskIds = [
      'set-admission-prices-task',
      'approve-admission-offer-task'
    ];
    const targetItemRemap = {
      'booking-registration-instructions': 'admission-public-instructions',
      'booking-confirmation-process': 'configure-ticket-sales-task',
      'set-admission-prices-task': 'admission-price-details',
      'approve-admission-offer-task': 'configure-ticket-sales-task'
    };
    const usableText = value => typeof value === 'string' && value.trim() ? value.trim() : '';
    const appendUniqueText = (existing, value, label) => {
      const cleaned = usableText(value);
      if (!cleaned) return usableText(existing);
      const next = label ? `${label}: ${cleaned}` : cleaned;
      const current = usableText(existing);
      if (!current) return next;
      return current.includes(cleaned) ? current : `${current}\n\n${next}`;
    };
    const migrateArrangement = record => {
      if (!record || typeof record !== 'object') return false;
      const previous = record['admission-arrangements'];
      let needsReview = false;
      if (Array.isArray(previous)) {
        if (previous.includes('entry-payment') || previous.includes('paid-entry')) {
          record['admission-arrangements'] = 'paid-entry';
        } else if (previous.includes('limited-place-booking')) {
          record['admission-arrangements'] = 'limited-place-booking';
        } else if (previous.includes('attendance-registration')) {
          record['admission-arrangements'] = 'attendance-registration';
        } else if (previous.includes('advance-booking')) {
          if (hasRecordedQuestionValue(record['admission-capacity'])) {
            record['admission-arrangements'] = 'limited-place-booking';
          } else {
            // The retired answer covered both finite reservations and simple
            // attendance estimates. Without a recorded capacity, choosing one
            // silently would change the event's meaning, so require review.
            delete record['admission-arrangements'];
            needsReview = true;
          }
        } else {
          delete record['admission-arrangements'];
        }
      } else if (previous === 'entry-payment') {
        record['admission-arrangements'] = 'paid-entry';
      } else if (previous === 'advance-booking') {
        if (hasRecordedQuestionValue(record['admission-capacity'])) {
          record['admission-arrangements'] = 'limited-place-booking';
        } else {
          delete record['admission-arrangements'];
          needsReview = true;
        }
      }
      return needsReview;
    };

    for (const event of state.events ?? []) {
      event.dataMigrations = event.dataMigrations && typeof event.dataMigrations === 'object'
        ? event.dataMigrations
        : {};
      if (event.dataMigrations.admissionModelV38 === true) continue;

      const before = JSON.stringify({
        answers: event.answers,
        clonedAnswerHints: event.clonedAnswerHints,
        questionMeta: event.questionMeta,
        taskState: event.taskState,
        dataMigrations: event.dataMigrations,
        learningInsights: event.learningInsights,
        retrospectiveTaskAnalysis: event.retrospective?.taskAnalysis
      });

      event.answers = event.answers && typeof event.answers === 'object' ? event.answers : {};
      event.taskState = event.taskState && typeof event.taskState === 'object' ? event.taskState : {};
      const answerArrangementNeedsReview = migrateArrangement(event.answers);
      const hintArrangementNeedsReview = migrateArrangement(event.clonedAnswerHints);
      const arrangementNeedsReview = answerArrangementNeedsReview || hintArrangementNeedsReview;

      const legacyPriceTask = event.taskState['set-admission-prices-task'];
      const legacyComplimentary = event.answers['complimentary-admission'];
      const legacyComplimentaryDetails = event.answers['complimentary-admission-details'];
      const legacyComplimentaryHint = event.clonedAnswerHints?.['complimentary-admission'];
      const legacyComplimentaryDetailsHint = event.clonedAnswerHints?.['complimentary-admission-details'];
      if (!Object.prototype.hasOwnProperty.call(event.answers, 'admission-free-entry') &&
          typeof legacyComplimentary === 'boolean') {
        event.answers['admission-free-entry'] = legacyComplimentary;
      }
      if (event.clonedAnswerHints && typeof event.clonedAnswerHints === 'object' &&
          !Object.prototype.hasOwnProperty.call(event.clonedAnswerHints, 'admission-free-entry') &&
          typeof legacyComplimentaryHint === 'boolean') {
        event.clonedAnswerHints['admission-free-entry'] = legacyComplimentaryHint;
      }

      let priceDetails = usableText(event.answers['admission-price-details']);
      priceDetails = appendUniqueText(priceDetails, legacyPriceTask?.notes, 'Previously recorded ticket prices');
      priceDetails = appendUniqueText(priceDetails, legacyComplimentaryDetails, 'Previously recorded complimentary or discounted entry');
      if (priceDetails) event.answers['admission-price-details'] = priceDetails;
      if (event.clonedAnswerHints && typeof event.clonedAnswerHints === 'object') {
        let priceHint = usableText(event.clonedAnswerHints['admission-price-details']);
        priceHint = appendUniqueText(priceHint, legacyComplimentaryDetailsHint, 'Previous complimentary or discounted entry');
        if (priceHint) event.clonedAnswerHints['admission-price-details'] = priceHint;
      }

      const previousProcessDetails = [
        ['Previously recorded attendee instructions', event.answers['booking-registration-instructions']],
        ['Previously recorded confirmation process', event.answers['booking-confirmation-process']]
      ];
      const configureTask = event.taskState['configure-ticket-sales-task'] ?? {};
      if (arrangementNeedsReview) {
        configureTask.notes = appendUniqueText(
          configureTask.notes,
          'Previous admission planning information included advance booking without a recorded capacity. Review whether this event needs attendance-only registration or a limited-place reservation.',
          'Admission arrangement needs review');
      }
      for (const [label, value] of previousProcessDetails) {
        configureTask.notes = appendUniqueText(configureTask.notes, value, label);
      }
      const retiredApproval = event.taskState['approve-admission-offer-task'];
      configureTask.notes = appendUniqueText(configureTask.notes, retiredApproval?.notes, 'Previous admission review note');
      if (usableText(configureTask.notes)) event.taskState['configure-ticket-sales-task'] = configureTask;

      for (const questionId of retiredQuestionIds) {
        delete event.answers[questionId];
        if (event.clonedAnswerHints && typeof event.clonedAnswerHints === 'object') delete event.clonedAnswerHints[questionId];
        if (event.questionMeta && typeof event.questionMeta === 'object') delete event.questionMeta[questionId];
      }
      delete event.answers['complimentary-admission'];
      delete event.answers['complimentary-admission-details'];
      if (event.clonedAnswerHints && typeof event.clonedAnswerHints === 'object') {
        delete event.clonedAnswerHints['complimentary-admission'];
        delete event.clonedAnswerHints['complimentary-admission-details'];
      }
      for (const taskId of retiredTaskIds) delete event.taskState[taskId];

      for (const insight of event.learningInsights ?? []) {
        if (!Array.isArray(insight.targetItemIds)) continue;
        insight.targetItemIds = [...new Set(insight.targetItemIds.map(itemId => targetItemRemap[itemId] ?? itemId))];
      }
      for (const proposal of event.retrospective?.taskAnalysis?.proposals ?? []) {
        if (proposal.targetItemId && targetItemRemap[proposal.targetItemId]) {
          proposal.targetItemId = targetItemRemap[proposal.targetItemId];
        }
      }

      event.dataMigrations.admissionModelV38 = true;
      const after = JSON.stringify({
        answers: event.answers,
        clonedAnswerHints: event.clonedAnswerHints,
        questionMeta: event.questionMeta,
        taskState: event.taskState,
        dataMigrations: event.dataMigrations,
        learningInsights: event.learningInsights,
        retrospectiveTaskAnalysis: event.retrospective?.taskAnalysis
      });
      if (before !== after) changed = true;
    }

    const previousOutboxLength = state.notificationOutbox?.length ?? 0;
    state.notificationOutbox = (state.notificationOutbox ?? [])
      .filter(notification => !retiredTaskIds.includes(notification.taskId));
    return changed || state.notificationOutbox.length !== previousOutboxLength;
  }

  function migrateEventControlStateV37() {
    const configuredVersion = Number.parseFloat(playbook?.schemaVersion ?? '0');
    if (!Number.isFinite(configuredVersion) || configuredVersion < 3.7) return false;

    let changed = false;
    for (const event of state.events ?? []) {
      event.dataMigrations = event.dataMigrations && typeof event.dataMigrations === 'object'
        ? event.dataMigrations
        : {};
      if (event.dataMigrations.eventControlV37 === true) continue;

      event.answers = event.answers && typeof event.answers === 'object' ? event.answers : {};
      event.taskState = event.taskState && typeof event.taskState === 'object' ? event.taskState : {};
      const lifecycle = normaliseEventLifecycle(event);
      if (event.answers['member-communications-sent'] === true) {
        lifecycle.communicationsCommitmentRecorded = true;
      }
      delete event.answers['member-communications-sent'];
      delete event.answers['additional-operational-commitments'];
      if (event.clonedAnswerHints && typeof event.clonedAnswerHints === 'object') {
        delete event.clonedAnswerHints['member-communications-sent'];
        delete event.clonedAnswerHints['additional-operational-commitments'];
      }

      for (const taskId of RETIRED_EVENT_CONTROL_TASK_IDS_V37) delete event.taskState[taskId];

      const decisionTaskState = event.taskState['confirm-event-before-commitments'];
      if (decisionTaskState) {
        delete decisionTaskState.reviewCompletionProvenance;
        decisionTaskState.completed = false;
        decisionTaskState.status = 'open';
        decisionTaskState.completedAt = null;
        decisionTaskState.reviewSignature = null;
      }

      if (NOTIFIABLE_EVENT_STATUSES.has(lifecycle.status) && !lifecycle.statusNotification) {
        lifecycle.statusNotification = {
          id: null,
          status: lifecycle.status,
          statusChangedAt: lifecycle.statusChangedAt,
          deliveryStatus: 'legacy-recorded',
          requestedRecipientCount: 0,
          sentRecipientCount: 0,
          alreadySentRecipientCount: 0,
          pendingRecipientCount: 0,
          missingEmail: [],
          legacyRecordedAtUpgrade: true,
          error: ''
        };
      }

      event.dataMigrations.eventControlV37 = true;
      changed = true;
    }

    const previousOutboxLength = state.notificationOutbox?.length ?? 0;
    state.notificationOutbox = (state.notificationOutbox ?? []).filter(notification =>
      notification.status === 'sent' || !RETIRED_EVENT_CONTROL_TASK_IDS_V37.includes(notification.taskId));
    return changed || state.notificationOutbox.length !== previousOutboxLength;
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
    const { referenceLibrary: _, ...browserState } = state;
    localStorage.setItem(STORAGE_STATE, JSON.stringify(browserState));
    if (sharedStateReady && !applyingSharedState) scheduleSharedStateSave();
  }

  function normaliseTaskAlertSchedule(value) {
    const candidate = value && typeof value === 'object' ? value : {};
    return {
      generatedAtUtc: typeof candidate.generatedAtUtc === 'string' ? candidate.generatedAtUtc : null,
      publicBaseUrl: typeof candidate.publicBaseUrl === 'string' ? candidate.publicBaseUrl : '',
      tasks: Array.isArray(candidate.tasks)
        ? candidate.tasks.filter(task => task && typeof task === 'object').map(task => ({
            eventId: String(task.eventId ?? ''),
            eventName: String(task.eventName ?? ''),
            eventDate: String(task.eventDate ?? ''),
            taskId: String(task.taskId ?? ''),
            taskTitle: String(task.taskTitle ?? ''),
            notes: String(task.notes ?? ''),
            dueDate: String(task.dueDate ?? ''),
            expiresOn: String(task.expiresOn ?? ''),
            assigneeName: String(task.assigneeName ?? ''),
            assigneeEmail: String(task.assigneeEmail ?? ''),
            organiserName: String(task.organiserName ?? ''),
            organiserEmail: String(task.organiserEmail ?? ''),
            completionToken: String(task.completionToken ?? ''),
            completionPath: String(task.completionPath ?? ''),
            canCompleteFromLink: task.canCompleteFromLink !== false,
            taskPath: String(task.taskPath ?? '')
          }))
        : [],
      planningReminders: Array.isArray(candidate.planningReminders)
        ? candidate.planningReminders.filter(item => item && typeof item === 'object').map(item => ({
            eventId: String(item.eventId ?? ''),
            eventName: String(item.eventName ?? ''),
            eventDate: String(item.eventDate ?? ''),
            organiserName: String(item.organiserName ?? ''),
            organiserEmail: String(item.organiserEmail ?? ''),
            answeredQuestions: Math.max(0, Number(item.answeredQuestions) || 0),
            totalQuestions: Math.max(0, Number(item.totalQuestions) || 0),
            firstIncompleteModuleId: String(item.firstIncompleteModuleId ?? '')
          }))
        : []
    };
  }

  function materialiseTaskAlertSchedule(registerLinks = sharedStateReady) {
    const projectedTasks = [];
    const planningReminders = [];
    const publicBaseUrl = location.origin;

    if (playbook) {
      for (const event of state.events ?? []) {
        normaliseAnswers(event);
        normaliseMilestoneDates(event);
        const lifecycle = normaliseEventLifecycle(event);
        if (event.closedAt || lifecycle.status === 'completed') continue;

        const organiser = assignmentRecipient(event.organiserRef ?? event.organiser, event);
        const planningProgress = getOverallQuestionProgress(event);
        if (lifecycle.status !== 'cancelled' && organiser.email && planningProgress.total > 0 && planningProgress.percent < 100) {
          const firstIncompleteModule = playbook.modules.find(module => {
            const progress = moduleProgress(module, event);
            return progress.active && progress.total > 0 && progress.answered < progress.total;
          });
          planningReminders.push({
            eventId: event.id,
            eventName: event.name,
            eventDate: event.eventDate,
            organiserName: organiser.name || event.organiser || '',
            organiserEmail: organiser.email,
            answeredQuestions: planningProgress.answered,
            totalQuestions: planningProgress.total,
            firstIncompleteModuleId: firstIncompleteModule?.id || 'start'
          });
        }
        for (const task of getActiveTasks(event)) {
          if (task.expired && task.state.completionToken && registerLinks) {
            ensureCompletionLinkRegistration(event, task.item, task.state, task.dueDate);
          }
          if (task.state.completed === true || task.state.status === 'completed' || task.expired || !isValidIsoDate(task.dueDate)) continue;

          task.state.completionToken ||= crypto.randomUUID();
          const completionToken = task.state.completionToken;
          if (registerLinks) ensureCompletionLinkRegistration(event, task.item, task.state, task.dueDate);

          const assigneeReference = taskAssignmentReference(task.state);
          const assignee = assignmentRecipient(assigneeReference ?? task.state.assignee, event);
          projectedTasks.push({
            eventId: event.id,
            eventName: event.name,
            eventDate: event.eventDate,
            taskId: task.item.id,
            taskTitle: task.item.title,
            notes: String(task.state.notes ?? '').trim(),
            dueDate: task.dueDate,
            expiresOn: task.expiresOn ?? '',
            assigneeName: assignee.name || task.state.assignee || '',
            assigneeEmail: assignee.email || legacyTaskAssigneeEmail(task.state, assigneeReference) || '',
            organiserName: organiser.name || event.organiser || '',
            organiserEmail: organiser.email || '',
            completionToken,
            completionPath: `/complete.html?token=${encodeURIComponent(completionToken)}`,
            canCompleteFromLink: task.item.canCompleteFromLink !== false && !taskCompletionControl(task.item, event, task.state).blocked,
            taskPath: `/?view=tasks&event=${encodeURIComponent(event.id)}&task=${encodeURIComponent(task.item.id)}`
          });
        }
      }
    }

    const content = { publicBaseUrl, tasks: projectedTasks, planningReminders };
    const previous = normaliseTaskAlertSchedule(state.taskAlertSchedule);
    const unchanged = previous.generatedAtUtc && valuesEqual(
      { publicBaseUrl: previous.publicBaseUrl, tasks: previous.tasks, planningReminders: previous.planningReminders },
      content);
    const next = unchanged
      ? previous
      : { generatedAtUtc: new Date().toISOString(), ...content };
    state.taskAlertSchedule = next;
    return structuredClone(next);
  }

  function emptySharedState() {
    return {
      schemaVersion: 6,
      deadlineOffsets: {},
      directoryInitialised: false,
      roles: [],
      deletedRoleIds: [],
      contacts: [],
      referenceLibrary: [],
      taskAlertSchedule: normaliseTaskAlertSchedule(null),
      events: []
    };
  }

  function normaliseSharedState(value) {
    const candidate = value && typeof value === 'object' ? value : {};
    const deletedRoleIds = Array.isArray(candidate.deletedRoleIds)
      ? [...new Set(candidate.deletedRoleIds.filter(Boolean).map(String))]
      : [];
    const deletedRoleIdSet = new Set(deletedRoleIds);
    const roles = Array.isArray(candidate.roles)
      ? structuredClone(candidate.roles).filter(role => role?.id && !deletedRoleIdSet.has(String(role.id)))
      : [];
    const contacts = Array.isArray(candidate.contacts) ? structuredClone(candidate.contacts) : [];
    return {
      schemaVersion: 6,
      deadlineOffsets: candidate.deadlineOffsets && typeof candidate.deadlineOffsets === 'object'
        ? structuredClone(candidate.deadlineOffsets)
        : {},
      directoryInitialised: candidate.directoryInitialised === true,
      roles,
      deletedRoleIds,
      contacts,
      referenceLibrary: Array.isArray(candidate.referenceLibrary) ? structuredClone(candidate.referenceLibrary) : [],
      taskAlertSchedule: normaliseTaskAlertSchedule(candidate.taskAlertSchedule),
      events: Array.isArray(candidate.events) ? structuredClone(candidate.events) : []
    };
  }

  function getSharedStateSnapshot() {
    const taskAlertSchedule = materialiseTaskAlertSchedule();
    materialiseIntelligentGolfPlanningNotes();
    return normaliseSharedState({
      deadlineOffsets: state.deadlineOffsets,
      directoryInitialised: state.directoryInitialised,
      roles: state.roles,
      deletedRoleIds: state.deletedRoleIds,
      contacts: state.contacts,
      referenceLibrary: state.referenceLibrary,
      taskAlertSchedule,
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
      schemaVersion: 6,
      deadlineOffsets: mergeChangedValue(base.deadlineOffsets, local.deadlineOffsets, remote.deadlineOffsets),
      directoryInitialised: Boolean(mergeChangedValue(base.directoryInitialised, local.directoryInitialised, remote.directoryInitialised)),
      roles: mergeEntitiesById(base.roles, local.roles, remote.roles),
      deletedRoleIds: [...new Set([...local.deletedRoleIds, ...remote.deletedRoleIds])],
      contacts: mergeEntitiesById(base.contacts, local.contacts, remote.contacts),
      referenceLibrary: mergeEntitiesById(base.referenceLibrary, local.referenceLibrary, remote.referenceLibrary),
      taskAlertSchedule: mergeChangedValue(base.taskAlertSchedule, local.taskAlertSchedule, remote.taskAlertSchedule),
      events: mergeEntitiesById(base.events, local.events, remote.events)
    };
  }

  function applySharedState(sharedValue) {
    const shared = normaliseSharedState(sharedValue);
    applyingSharedState = true;
    state.deadlineOffsets = shared.deadlineOffsets;
    state.directoryInitialised = shared.directoryInitialised;
    state.roles = shared.roles;
    state.deletedRoleIds = shared.deletedRoleIds;
    state.contacts = shared.contacts;
    state.referenceLibrary = shared.referenceLibrary;
    state.taskAlertSchedule = shared.taskAlertSchedule;
    state.events = shared.events;
    const admissionPlanningMigrated = migrateAdmissionPlanningState();
    const admissionModelMigrated = migrateAdmissionModelV38();
    const admissionPricingMigrated = migrateAdmissionPricingState();
    const foodServiceReviewMigrated = migrateFoodServiceReviewCompletionState();
    const eventControlMigrated = migrateEventControlStateV37();
    const planningNotesMigrated = materialiseIntelligentGolfPlanningNotes();
    const eventStateMigrated = admissionPlanningMigrated || admissionModelMigrated || admissionPricingMigrated || foodServiceReviewMigrated || eventControlMigrated || planningNotesMigrated;
    if (state.activeEventId && !state.events.some(event => event.id === state.activeEventId)) {
      state.activeEventId = null;
      state.activeView = 'catalogue';
    }
    const { referenceLibrary: _, ...browserState } = state;
    localStorage.setItem(STORAGE_STATE, JSON.stringify(browserState));
    try {
      localStorage.setItem(REFERENCE_LIBRARY_STORAGE, JSON.stringify(state.referenceLibrary));
    } catch (error) {
      console.warn('The shared Image Library is too large for the browser cache. Server storage remains authoritative.', error);
    }
    applyingSharedState = false;
    if (eventStateMigrated && sharedStateReady) scheduleSharedStateSave(100);
    return eventStateMigrated;
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

  async function flushSharedState() {
    if (!sharedStateReady) return false;
    if (sharedStateSaveTimer) {
      clearTimeout(sharedStateSaveTimer);
      sharedStateSaveTimer = null;
    }
    const timeoutAt = Date.now() + 10_000;
    while (sharedStateSaveInFlight && Date.now() < timeoutAt) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (sharedStateSaveInFlight) return false;
    if (sharedStateSaveTimer) {
      clearTimeout(sharedStateSaveTimer);
      sharedStateSaveTimer = null;
    }
    return persistSharedState();
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
          const remoteRoleIds = new Set(remote.roles.map(role => role.id));
          const remoteEventIds = new Set(remote.events.map(event => event.id));
          const remoteContactIds = new Set(remote.contacts.map(contact => contact.id));
          const remoteReferenceIds = new Set(remote.referenceLibrary.map(reference => reference.id));
          const legacyRoles = browserSnapshot.roles.filter(role => role?.id && !remoteRoleIds.has(role.id));
          const legacyEvents = browserSnapshot.events.filter(event => event?.id && !remoteEventIds.has(event.id));
          const legacyContacts = browserSnapshot.contacts.filter(contact => contact?.id && !remoteContactIds.has(contact.id));
          const legacyReferences = browserSnapshot.referenceLibrary.filter(reference => reference?.id && !remoteReferenceIds.has(reference.id));
          const deletedRoleIds = [...new Set([...remote.deletedRoleIds, ...browserSnapshot.deletedRoleIds])];
          needsMigrationSave = legacyRoles.length > 0 || legacyEvents.length > 0 || legacyContacts.length > 0 || legacyReferences.length > 0 || deletedRoleIds.length !== remote.deletedRoleIds.length;
          if (needsMigrationSave) {
            initial = normaliseSharedState({
              deadlineOffsets: Object.keys(remote.deadlineOffsets).length > 0
                ? remote.deadlineOffsets
                : browserSnapshot.deadlineOffsets,
              directoryInitialised: remote.directoryInitialised || browserSnapshot.directoryInitialised,
              roles: [...remote.roles, ...legacyRoles],
              deletedRoleIds,
              contacts: [...remote.contacts, ...legacyContacts],
              referenceLibrary: [...remote.referenceLibrary, ...legacyReferences],
              events: [...remote.events, ...legacyEvents]
            });
          }
        }
        needsMigrationSave = applySharedState(initial) || needsMigrationSave;
      } else {
        lastSyncedSharedState = emptySharedState();
        needsMigrationSave = browserSnapshot.roles.length > 0 || browserSnapshot.events.length > 0 || browserSnapshot.contacts.length > 0 || browserSnapshot.referenceLibrary.length > 0;
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

  function mergeNamedTemplateArray(coreValues, legacyValues, keyName) {
    const merged = structuredClone(Array.isArray(coreValues) ? coreValues : []);
    const indexes = new Map(merged.map((value, index) => [String(value?.[keyName] ?? ''), index]));
    for (const legacyValue of Array.isArray(legacyValues) ? legacyValues : []) {
      const key = String(legacyValue?.[keyName] ?? '');
      if (!key) continue;
      const clone = structuredClone(legacyValue);
      if (indexes.has(key)) merged[indexes.get(key)] = clone;
      else {
        indexes.set(key, merged.length);
        merged.push(clone);
      }
    }
    return merged;
  }

  function replayLocalAdminCustomisations(bundledPlaybook, storedTemplate, protectedIds = protectedQuestionIds) {
    const merged = structuredClone(bundledPlaybook);
    const derivedProtectedIds = (bundledPlaybook?.modules ?? [])
      .find(module => module.id === 'start')?.sections
      ?.flatMap(section => section.items ?? [])
      .filter(item => item.type === 'question')
      .map(item => String(item.id)) ?? [];
    const protectedSet = new Set((protectedIds?.length ? protectedIds : derivedProtectedIds).map(String));
    const rootCollections = new Set(['modules', 'responsibilityRoles', 'deadlineCodes', 'advisoryRules', 'schemaVersion']);

    // A browser could already contain a manually imported club Playbook from before
    // shared storage existed. Preserve all of its club-specific data, not just items
    // carrying a particular source flag, while retaining immutable core questions.
    for (const [key, value] of Object.entries(storedTemplate ?? {})) {
      if (rootCollections.has(key)) continue;
      merged[key] = structuredClone(value);
    }

    merged.modules ??= [];
    const locateItem = id => {
      for (const module of merged.modules) {
        for (const section of module.sections ?? []) {
          const index = (section.items ?? []).findIndex(item => item.id === id);
          if (index >= 0) return { section, index };
        }
      }
      return null;
    };

    for (const legacyModule of storedTemplate?.modules ?? []) {
      let targetModule = merged.modules.find(module => module.id === legacyModule.id);
      if (!targetModule) {
        targetModule = structuredClone(legacyModule);
        targetModule.sections = (targetModule.sections ?? []).map(section => ({
          ...section,
          items: (section.items ?? []).filter(item => !protectedSet.has(String(item.id))).map(item => structuredClone(item))
        }));
        merged.modules.push(targetModule);
        continue;
      }

      for (const [key, value] of Object.entries(legacyModule)) {
        if (key !== 'sections' && key !== 'id') targetModule[key] = structuredClone(value);
      }
      targetModule.sections ??= [];
      for (const legacySection of legacyModule.sections ?? []) {
        let targetSection = targetModule.sections.find(section => section.id === legacySection.id);
        if (!targetSection) {
          targetSection = { ...structuredClone(legacySection), items: [] };
          targetModule.sections.push(targetSection);
        } else {
          for (const [key, value] of Object.entries(legacySection)) {
            if (key !== 'items' && key !== 'id') targetSection[key] = structuredClone(value);
          }
        }
        targetSection.items ??= [];
        for (const legacyItem of legacySection.items ?? []) {
          const id = String(legacyItem?.id ?? '');
          if (!id || protectedSet.has(id)) continue;
          const existing = locateItem(id);
          if (existing) existing.section.items.splice(existing.index, 1);
          targetSection.items.push(structuredClone(legacyItem));
        }
      }
    }

    merged.responsibilityRoles = mergeNamedTemplateArray(merged.responsibilityRoles, storedTemplate?.responsibilityRoles, 'id');
    merged.deadlineCodes = mergeNamedTemplateArray(merged.deadlineCodes, storedTemplate?.deadlineCodes, 'code');
    merged.advisoryRules = mergeNamedTemplateArray(merged.advisoryRules, storedTemplate?.advisoryRules, 'id');
    const coreVersion = Number.parseFloat(bundledPlaybook?.schemaVersion);
    const storedVersion = Number.parseFloat(storedTemplate?.schemaVersion);
    merged.schemaVersion = Number.isFinite(storedVersion) && (!Number.isFinite(coreVersion) || storedVersion > coreVersion)
      ? storedTemplate.schemaVersion
      : bundledPlaybook.schemaVersion;
    return merged;
  }

  async function loadInitialPlaybook() {
    let storedTemplate = null;
    const storedTemplateJson = localStorage.getItem(STORAGE_TEMPLATE);
    if (storedTemplateJson) {
      try {
        storedTemplate = JSON.parse(storedTemplateJson);
      } catch {
        localStorage.removeItem(STORAGE_TEMPLATE);
        storedTemplate = null;
      }
    }

    try {
      const response = await fetch('/api/playbook/template', { cache: 'no-store' });
      if (response.ok) {
        const document = await response.json();
        if (!document?.template || typeof document.template !== 'object') {
          throw new Error('The server returned an invalid Playbook template.');
        }
        playbookTemplateRevision = Number(document.revision) || 0;
        protectedQuestionIds = Array.isArray(document.protectedQuestionIds) ? document.protectedQuestionIds.map(String) : [];
        let serverTemplate = document.template;
        if (storedTemplate && playbookTemplateRevision === 0) {
          serverTemplate = replayLocalAdminCustomisations(serverTemplate, storedTemplate, document.protectedQuestionIds);
          if (JSON.stringify(serverTemplate) !== JSON.stringify(document.template)) {
            playbookTemplateNeedsMigration = true;
          }
        }
        localStorage.setItem(STORAGE_TEMPLATE, JSON.stringify(serverTemplate));
        return serverTemplate;
      }
      if (response.status !== 404) throw new Error(`Unable to load the server Playbook template (${response.status}).`);
    } catch (error) {
      console.warn('The shared Playbook template is unavailable; using the browser fallback.', error);
    }

    let bundledPlaybook;
    if (window.EMBEDDED_PLAYBOOK) {
      bundledPlaybook = structuredClone(window.EMBEDDED_PLAYBOOK);
    } else {
      try {
        const response = await fetch('./event-playbook.json', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Unable to load event-playbook.json (${response.status}).`);
        }
        bundledPlaybook = await response.json();
      } catch (error) {
        if (storedTemplate) return storedTemplate;
        throw error;
      }
    }

    if (storedTemplate) {
      const storedVersion = Number.parseFloat(storedTemplate.schemaVersion);
      const bundledVersion = Number.parseFloat(bundledPlaybook.schemaVersion);
      const versionsAreComparable = Number.isFinite(storedVersion) && Number.isFinite(bundledVersion);
      const sameVersionContentDiffers = versionsAreComparable &&
        storedVersion === bundledVersion &&
        JSON.stringify(storedTemplate) !== JSON.stringify(bundledPlaybook);
      if (versionsAreComparable && storedVersion > bundledVersion) {
        return storedTemplate;
      }
      if (!versionsAreComparable || bundledVersion > storedVersion || sameVersionContentDiffers) {
        const merged = replayLocalAdminCustomisations(bundledPlaybook, storedTemplate);
        localStorage.setItem(STORAGE_TEMPLATE, JSON.stringify(merged));
        return merged;
      }
      return bundledPlaybook;
    }

    return bundledPlaybook;
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
      if (task.expiresAfterDeadlineCode && !deadlineCodes.has(task.expiresAfterDeadlineCode)) throw new Error(`${task.id} uses unknown expiry deadline code ${task.expiresAfterDeadlineCode}.`);
      if (task.defaultOwnerRoleId && !roleIds.has(task.defaultOwnerRoleId)) throw new Error(`${task.id} uses unknown owner role ${task.defaultOwnerRoleId}.`);
      if (task.ownerFromQuestionId) {
        const ownerQuestion = questions.get(task.ownerFromQuestionId);
        if (!ownerQuestion || ownerQuestion.answerType !== 'assignment') {
          throw new Error(`${task.id} owner source must reference an assignment question.`);
        }
      }
      if (task.handover) {
        for (const [side, descriptor] of Object.entries({ source: task.handover.from, recipient: task.handover.to })) {
          if (!descriptor || !['questionId', 'eventField', 'roleId'].some(key => String(descriptor[key] ?? '').trim())) {
            throw new Error(`${task.id} handover ${side} must identify an assignment question, event field or role.`);
          }
          if (descriptor.questionId) {
            const handoverQuestion = questions.get(descriptor.questionId);
            if (!handoverQuestion || handoverQuestion.answerType !== 'assignment') {
              throw new Error(`${task.id} handover ${side} must reference an assignment question.`);
            }
          }
          for (const roleId of [descriptor.roleId, descriptor.fallbackRoleId].filter(Boolean)) {
            if (!roleIds.has(roleId)) throw new Error(`${task.id} handover ${side} uses unknown role ${roleId}.`);
          }
        }
      }
      if (task.reviewSummary) {
        if (!Array.isArray(task.reviewSummary.fields) || task.reviewSummary.fields.length === 0) {
          throw new Error(`${task.id} must define at least one review summary field.`);
        }
        const reviewQuestionIds = new Set();
        for (const field of task.reviewSummary.fields) {
          if (!field?.questionId || itemTypes.get(field.questionId) !== 'question') {
            throw new Error(`${task.id} review summary references missing question ${field?.questionId ?? '(unknown)'}.`);
          }
          if (reviewQuestionIds.has(field.questionId)) {
            throw new Error(`${task.id} review summary repeats question ${field.questionId}.`);
          }
          reviewQuestionIds.add(field.questionId);
        }
      }
      if (task.staffBriefing) {
        const validStaffPhases = new Set(['before-event', 'event-day', 'after-event']);
        if (!validStaffPhases.has(task.staffBriefing.phase)) throw new Error(`${task.id} uses unknown staff briefing phase ${task.staffBriefing.phase}.`);
        if (!String(task.staffBriefing.audience ?? '').trim()) throw new Error(`${task.id} must name the staff audience for its briefing instruction.`);
        if (!String(task.staffBriefing.instruction ?? '').trim()) throw new Error(`${task.id} must provide a practical staff briefing instruction.`);
      }
    }

    for (const question of questions.values()) {
      if (!question.planningContext) continue;
      if (!Array.isArray(question.planningContext.fields) || question.planningContext.fields.length === 0) {
        throw new Error(`${question.id} planning context must define at least one field.`);
      }
      for (const field of question.planningContext.fields) {
        if (!field?.questionId || !questions.has(field.questionId)) {
          throw new Error(`${question.id} planning context references missing question ${field?.questionId ?? '(unknown)'}.`);
        }
        for (const questionId of referencedQuestions(field.showWhen)) {
          if (!questions.has(questionId)) throw new Error(`${question.id} planning context references missing question ${questionId}.`);
        }
      }
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

  function createEvent(name, organiser = '', eventDate = '', description = '', milestoneDates = {}, organiserRef = null, integrationDetails = {}) {
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
      startTime: integrationDetails.startTime ?? '',
      endTime: integrationDetails.endTime ?? '',
      intelligentGolfEventTypeId: Number(integrationDetails.eventTypeId) || 0,
      expectedAttendees: Math.max(0, Number(integrationDetails.expectedAttendees) || 0),
      intelligentGolfGroupId: '151',
      intelligentGolfGroupName: 'BOTGC Event Planner',
      createdAt: now,
      closedAt: null,
      answers: organiserName ? { 'event-decision-owner': resolvedOrganiserRef ?? organiserName } : {},
      questionMeta: {},
      taskState: {},
      team: organiserName ? [organiserName] : [],
      advisoryOverrides: {},
      retrospective: {},
      briefing: {},
      finances: { entries: [] },
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
      dataMigrations: {
        admissionPlanningV34: true,
        admissionPricingV35: true,
        admissionModelV38: true,
        foodServiceReviewCompletionV36: true,
        eventControlV37: true
      },
      sourceEventId: null,
      eventSeriesId: id,
      learningInsights: [],
      cataloguePosterThumbnail: null
    };

    state.events.push(event);
    state.activeEventId = id;
    state.activeView = 'module:start';
    saveState();
    scheduleIntelligentGolfStatusRefresh(id);
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

  function isValidIsoDate(value) {
    const candidate = String(value ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return false;
    const date = new Date(`${candidate}T12:00:00`);
    return !Number.isNaN(date.getTime()) && toIsoDate(date) === candidate;
  }

  function reanchorEventDate(event, nextEventDate) {
    const nextDate = String(nextEventDate ?? '').trim();
    if (!event || !isValidIsoDate(nextDate)) return false;

    const previousDate = event.eventDate;
    if (previousDate === nextDate) return true;

    const previousTaskDates = new Map(getActiveTasks(event).map(task => [task.item.id, task.dueDate]));
    const previousMilestones = { ...(event.milestoneDates ?? {}) };
    const deadlineDefinitions = new Map((playbook.deadlineCodes ?? []).map(definition => [definition.code, definition]));
    const milestoneCodes = new Set([
      ...Object.keys(DEFAULT_MILESTONE_OFFSETS),
      ...deadlineDefinitions.keys(),
      ...Object.keys(previousMilestones),
      'DT'
    ]);

    event.eventDate = nextDate;
    event.milestoneDates ??= {};

    for (const code of milestoneCodes) {
      if (!code) continue;
      if (code === 'DT') {
        event.milestoneDates.DT = nextDate;
        continue;
      }

      if (deadlineDefinitions.get(code)?.dynamic === true || code === 'CX') {
        continue;
      }

      const preservedOffset = isValidIsoDate(previousDate) && isValidIsoDate(previousMilestones[code])
        ? daysBetweenIsoDates(previousDate, previousMilestones[code])
        : null;
      const configuredOffset = preservedOffset ?? getDeadlineOffset(code, event);
      event.milestoneDates[code] = configuredOffset === null
        ? (previousMilestones[code] ?? '')
        : addDaysToIsoDate(nextDate, configuredOffset);
    }

    normaliseMilestoneDates(event);

    const refreshedTasks = getActiveTasks(event);
    const refreshedDueDates = new Map(refreshedTasks.map(task => [task.item.id, task.dueDate]));
    for (const notification of state.notificationOutbox ?? []) {
      if (notification.eventId !== event.id || notification.status === 'sent') continue;
      if (refreshedDueDates.has(notification.taskId)) {
        notification.dueDate = refreshedDueDates.get(notification.taskId);
      }
    }

    for (const task of refreshedTasks) {
      if (previousTaskDates.get(task.item.id) === task.dueDate) continue;
      if (!task.state.completed) {
        task.state.lastReminderAt = null;
        task.state.escalatedAt = null;
      }
      if (task.state.completionToken) {
        ensureCompletionLinkRegistration(event, task.item, task.state, task.dueDate);
      }
    }

    return true;
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
    event.lifecycle.resolvedFromAtRisk = event.lifecycle.resolvedFromAtRisk === true;
    event.startTime = typeof event.startTime === 'string' ? event.startTime : '';
    event.endTime = typeof event.endTime === 'string' ? event.endTime : '';
    event.intelligentGolfEventTypeId = Number(event.intelligentGolfEventTypeId) || 0;
    event.expectedAttendees = Math.max(0, Number(event.expectedAttendees) || 0);
    event.intelligentGolfGroupId ||= '151';
    event.intelligentGolfGroupName ||= 'BOTGC Event Planner';
    event.answers ??= {};
    const clonedHints = event.clonedAnswerHints && typeof event.clonedAnswerHints === 'object'
      ? event.clonedAnswerHints
      : {};
    if (!event.answers['event-decision-owner'] &&
        !Object.prototype.hasOwnProperty.call(clonedHints, 'event-decision-owner') &&
        event.lifecycle.decisionOwner) {
      event.answers['event-decision-owner'] = event.lifecycle.decisionOwnerRef ?? event.lifecycle.decisionOwner;
    }
    return event.lifecycle;
  }

  function normaliseEventFinances(event) {
    event.finances = event.finances && typeof event.finances === 'object' ? event.finances : {};
    event.finances.entries = Array.isArray(event.finances.entries) ? event.finances.entries : [];
    event.finances.entries = event.finances.entries.map(entry => ({
      id: String(entry?.id || crypto.randomUUID()),
      direction: entry?.direction === 'expense' ? 'expense' : 'income',
      category: String(entry?.category || (entry?.direction === 'expense' ? 'Other expense' : 'Other income')),
      description: String(entry?.description || ''),
      calculation: FINANCE_CALCULATIONS[entry?.calculation] ? entry.calculation : 'total',
      quantity: Math.max(0, Number(entry?.quantity) || 0),
      unitAmount: Math.max(0, Number(entry?.unitAmount) || 0),
      totalAmount: Math.max(0, Number(entry?.totalAmount) || 0),
      status: entry?.status === 'actual' ? 'actual' : 'estimate',
      notes: String(entry?.notes || ''),
      createdAt: entry?.createdAt || new Date().toISOString(),
      updatedAt: entry?.updatedAt || entry?.createdAt || new Date().toISOString()
    }));
    return event.finances;
  }

  function getActiveEvent() {
    let event = state.events.find(item => item.id === state.activeEventId) ?? null;
    if (!event && state.events.length > 0) {
      event = state.events[0];
      state.activeEventId = event.id;
    }
    if (event) {
      event.answers ??= {};
      normaliseQuestionMeta(event);
      event.taskState ??= {};
      event.team ??= [];
      event.advisoryOverrides ??= {};
      event.retrospective ??= {};
      event.briefing = event.briefing && typeof event.briefing === 'object' ? event.briefing : {};
      normaliseEventFinances(event);
      event.playbookVersion ??= playbook?.schemaVersion ?? '1.0';
      event.sourceEventId ??= null;
      event.eventSeriesId ??= event.sourceEventId
        ? (state.events.find(candidate => candidate.id === event.sourceEventId)?.eventSeriesId ?? event.sourceEventId)
        : event.id;
      event.learningInsights = Array.isArray(event.learningInsights) ? event.learningInsights : [];
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

  function normaliseQuestionMeta(event) {
    if (!event || !event.questionMeta || typeof event.questionMeta !== 'object' || Array.isArray(event.questionMeta)) {
      if (event) event.questionMeta = {};
      return event?.questionMeta ?? {};
    }

    for (const [questionId, meta] of Object.entries(event.questionMeta)) {
      if (!meta || typeof meta !== 'object' || meta.notRelevant !== true) {
        delete event.questionMeta[questionId];
      }
    }
    return event.questionMeta;
  }

  function isQuestionNotRelevant(event, questionId) {
    return event?.questionMeta?.[questionId]?.notRelevant === true;
  }

  function clearQuestionNotRelevant(event, questionId) {
    if (!isQuestionNotRelevant(event, questionId)) return false;
    delete event.questionMeta[questionId];
    return true;
  }

  function hasRecordedQuestionValue(value) {
    if (value === undefined || value === null || value === '') return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') {
      return Object.values(value).some(entry => entry !== undefined && entry !== null && entry !== '');
    }
    return true;
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
    const requiredPluginEnabled = !item?.requiresPlugin ||
      (item.requiresPlugin === 'intelligentGolf' && pluginCapabilities.intelligentGolfEnabled) ||
      (item.requiresPlugin === 'monday' && pluginCapabilities.mondayEnabled) ||
      (item.requiresPlugin === 'yodeck' && pluginCapabilities.yodeckEnabled);
    return item?.assistantDisabled !== true && requiredPluginEnabled &&
      conditionMatches(item.showWhen, event) && handoverIsRequired(item, event);
  }

  function taskStateShowsBriefingOrCommitment(taskState) {
    if (!taskState || typeof taskState !== 'object') return false;
    if (taskState.notRelevant === true) return false;
    return taskState.completed === true ||
      taskState.assignedBy === 'manual' ||
      Boolean(taskState.notes?.trim()) ||
      taskState.notificationStatus === 'sent';
  }

  function hasPaidAdmissionCategories(event) {
    const arrangements = getQuestionValue('admission-arrangements', event);
    if (arrangements !== 'paid-entry') return false;
    const hasFreeEntry = getQuestionValue('admission-free-entry', event);
    if (hasFreeEntry === false) return true;
    if (hasFreeEntry !== true) return false;
    const freeCategories = getQuestionValue('admission-free-categories', event);
    if (!Array.isArray(freeCategories) || freeCategories.length === 0) return false;
    return !['children', 'members', 'visitors'].every(category => freeCategories.includes(category));
  }

  function hasCancellationEvidence(event, area) {
    const answerSignals = {
      'Food & Beverage': [],
      Communications: [],
      'Golf Operations': ['tee-times-reserved'],
      Clubhouse: [],
      Course: [],
      Finance: [],
      Administration: ['entry-charge']
    };
    if ((answerSignals[area] ?? []).some(questionId => getQuestionValue(questionId, event) === true)) return true;
    if (area === 'Communications' && event.lifecycle?.communicationsCommitmentRecorded === true) return true;
    if (area === 'Finance' && getQuestionValue('entry-charge', event) === true && hasPaidAdmissionCategories(event)) return true;

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
      ['Communications', 'communications', 'communications'],
      ['Finance', 'finance', 'admission'],
      ['Administration', 'office', 'admission']
    ];
    const selectedAreas = getQuestionValue('event-affected-areas', event) ?? [];
    for (const [area, roleId, affectedAreaValue] of areaOwners) {
      if (!selectedAreas.includes(affectedAreaValue) && !hasCancellationEvidence(event, area)) continue;
      add(contactForRole(roleId, event)?.name, area);
    }

    if (selectedAreas.includes('suppliers') || selectedAreas.includes('entertainment')) add('', 'External suppliers or performers');
    if (selectedAreas.includes('staffing')) add('', 'Other staff or volunteers');
    return stakeholders;
  }

  function normaliseAnswers(event) {
    const questionMeta = normaliseQuestionMeta(event);
    for (const questionId of Object.keys(questionMeta)) {
      const indexed = itemIndex.get(questionId);
      if (!indexed || indexed.item.type !== 'question') {
        delete questionMeta[questionId];
      }
    }
    let changed = true;
    let loops = 0;
    while (changed && loops < 20) {
      changed = false;
      loops += 1;
      for (const module of playbook.modules) {
        const moduleActive = isModuleActive(module, event);
        for (const section of module.sections) {
          for (const item of section.items) {
            if (item.type !== 'question') continue;

            const retiredByAssistant = item.assistantDisabled === true;
            const visible = moduleActive && isItemVisible(item, event);
            const notRelevant = questionMeta[item.id]?.notRelevant === true;
            const invalidNotRelevant = hasRecordedQuestionValue(getQuestionValue(item.id, event));
            if (((!visible && !retiredByAssistant) || invalidNotRelevant) && notRelevant) {
              delete questionMeta[item.id];
              changed = true;
            }

            // Preserve answers in an inactive module, as before, but discard an
            // answer when the question's own visibility rule makes it stale.
            if (moduleActive && !item.bind && !visible && !retiredByAssistant && Object.prototype.hasOwnProperty.call(event.answers, item.id)) {
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

  function isQuestionComplete(item, event) {
    return isAnsweredValue(getQuestionValue(item.id, event)) ||
      isQuestionNotRelevant(event, item.id);
  }

  function moduleProgress(module, event) {
    if (!isModuleActive(module, event)) {
      return { active: false, answered: 0, total: 0, percent: 0 };
    }

    const questions = [];
    for (const section of module.sections) {
      for (const item of section.items) {
        if (item.type === 'question' && isItemVisible(item, event)) {
          questions.push(item);
        }
      }
    }

    const answered = questions.filter(item => isQuestionComplete(item, event)).length;
    const total = questions.length;
    return {
      active: true,
      answered,
      total,
      percent: total === 0 ? 100 : Math.round((answered / total) * 100)
    };
  }

  function initialiseOperationalState() {
    const shouldSeedDirectory = state.directoryInitialised !== true;
    const bundledRoles = playbook.responsibilityRoles ?? [];
    const deletedRoleIds = new Set(Array.isArray(state.deletedRoleIds) ? state.deletedRoleIds : []);
    state.deletedRoleIds = [...deletedRoleIds];
    const existingRoles = new Map((Array.isArray(state.roles) ? state.roles : []).filter(role => role?.id).map(role => [role.id, role]));
    const directoryRolesWereMissing = existingRoles.size === 0;
    state.roles = bundledRoles
      .filter(role => !deletedRoleIds.has(role.id))
      .map(role => normaliseDirectoryRole({ ...role, ...(existingRoles.get(role.id) ?? {}) }));
    for (const role of existingRoles.values()) {
      if (!deletedRoleIds.has(role.id) && !state.roles.some(candidate => candidate.id === role.id)) state.roles.push(normaliseDirectoryRole(role));
    }

    const eventCoordinatorRole = state.roles.find(role => role.id === 'event-coordinator');
    if (eventCoordinatorRole) {
      // This is deliberately a per-event responsibility. It always follows
      // the organiser selected on the event rather than a standing mailbox.
      eventCoordinatorRole.ownerContactId = '';
      eventCoordinatorRole.mailboxEmail = '';
      eventCoordinatorRole.fallbackRoleId = null;
    }

    if (!Array.isArray(state.contacts)) state.contacts = [];
    if (shouldSeedDirectory && state.contacts.length === 0) state.contacts = structuredClone(playbook.defaultContacts ?? []);
    state.contacts = state.contacts.map(normaliseDirectoryContact);

    let simon = state.contacts.find(contact => contact.email?.toLocaleLowerCase() === 'simon@maraboustork.co.uk')
      ?? state.contacts.find(contact => contact.name?.toLocaleLowerCase() === 'simon parsons');
    if (shouldSeedDirectory && !simon) {
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
    }

    const communicationsRole = state.roles.find(role => role.id === 'communications');
    if (directoryRolesWereMissing && communicationsRole && !communicationsRole.ownerContactId && simon) communicationsRole.ownerContactId = simon.id;
    state.directoryInitialised = true;
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
        : state.contacts.find(contact => contact.active !== false && contact.type === 'person' && contact.name.toLocaleLowerCase() === event.organiser.toLocaleLowerCase());
      return organiserContact && organiserContact.active !== false && organiserContact.canReceiveTasks !== false
        ? organiserContact
        : { id: 'event-organiser', name: event.organiser, email: '', roleIds: ['event-coordinator'], active: true };
    }

    const role = roleById(roleId);
    const linkedContact = role?.ownerContactId ? contactById(role.ownerContactId) : null;
    if (linkedContact && linkedContact.active !== false && linkedContact.canReceiveTasks !== false) return linkedContact;
    if (role?.mailboxEmail) return { id: `role-mailbox-${role.id}`, type: 'mailbox', name: role.name, email: role.mailboxEmail, roleIds: [role.id], active: true };

    const contact = state.contacts.find(candidate => candidate.active !== false && candidate.canReceiveTasks !== false &&
      Array.isArray(candidate.roleIds) && candidate.roleIds.includes(roleId));
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
    const role = responsibilityRoles().find(item => item.active !== false && (item.id.toLocaleLowerCase() === search || item.name.toLocaleLowerCase() === search));
    const person = (state.contacts ?? []).find(contact => contact.active !== false
      && (mode !== 'person' || contact.type === 'person') && (
      contact.id.toLocaleLowerCase() === search ||
      contact.name.toLocaleLowerCase() === search ||
      contact.email?.toLocaleLowerCase() === search
    ));
    if (mode !== 'person' && role && person?.email?.toLocaleLowerCase() !== search) return { kind: 'role', id: role.id };
    if (person) return { kind: 'person', id: person.id };
    if (mode === 'person') return null;
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
      return contact
        ? {
            name: contact.name,
            email: contact.active !== false && contact.canReceiveTasks !== false ? (contact.email ?? '') : ''
          }
        : { name: '', email: '' };
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

  function handoverAssignmentReference(descriptor, event) {
    if (!descriptor || typeof descriptor !== 'object') return null;
    const value = descriptor.questionId
      ? getQuestionValue(descriptor.questionId, event)
      : descriptor.eventField
        ? descriptor.eventField.split('.').reduce((current, key) => current?.[key], event)
        : descriptor.roleId
          ? { kind: 'role', id: descriptor.roleId }
          : null;
    return assignmentReference(value) ?? (descriptor.fallbackRoleId
      ? assignmentReference({ kind: 'role', id: descriptor.fallbackRoleId })
      : null);
  }

  function assignmentsResolveToSameRecipient(leftValue, rightValue, event) {
    const left = assignmentReference(leftValue);
    const right = assignmentReference(rightValue);
    if (!left || !right) return false;
    if (left.kind === right.kind && left.id === right.id) return true;

    const resolvedContactId = reference => reference.kind === 'person'
      ? contactById(reference.id)?.id ?? reference.id
      : contactForRole(reference.id, event)?.id ?? '';
    const leftContactId = resolvedContactId(left);
    const rightContactId = resolvedContactId(right);
    if (leftContactId && rightContactId && leftContactId === rightContactId) return true;

    const leftRecipient = assignmentRecipient(left, event);
    const rightRecipient = assignmentRecipient(right, event);
    const leftEmail = String(leftRecipient.email ?? '').trim().toLocaleLowerCase();
    const rightEmail = String(rightRecipient.email ?? '').trim().toLocaleLowerCase();
    if (leftEmail && rightEmail) return leftEmail === rightEmail;

    const leftName = String(leftRecipient.name ?? '').trim().toLocaleLowerCase();
    const rightName = String(rightRecipient.name ?? '').trim().toLocaleLowerCase();
    return Boolean(leftName && rightName && leftName === rightName);
  }

  function handoverIsRequired(item, event) {
    if (!item?.handover) return true;
    const source = handoverAssignmentReference(item.handover.from, event);
    const recipient = handoverAssignmentReference(item.handover.to, event);
    if (!source || !recipient) return true;
    return !assignmentsResolveToSameRecipient(source, recipient, event);
  }

  function taskAssignmentReference(taskState) {
    if (taskState?.assignmentKind && taskState?.assignmentId) {
      return assignmentReference({ kind: taskState.assignmentKind, id: taskState.assignmentId });
    }
    return assignmentReference(taskState?.assignee ?? '');
  }

  function contactCanPerformRole(contact, roleId) {
    if (!roleId) return true;
    if ((contact.roleIds ?? []).includes(roleId)) return true;
    return roleById(roleId)?.ownerContactId === contact.id;
  }

  function assignmentOptions(mode = 'person-or-role', event = null, eligibleRoleId = '') {
    const options = [];
    if (mode !== 'person') {
      for (const role of responsibilityRoles().filter(role => role.active !== false && role.selectableForTasks !== false)) {
        const recipient = assignmentRecipient({ kind: 'role', id: role.id }, event);
        const detail = role.id === 'event-coordinator'
          ? (event?.organiser ? `${recipient.name || event.organiser}${recipient.email ? ` · ${recipient.email}` : ''}` : 'Uses the organiser selected for each event')
          : (recipient.email ? `${recipient.name || 'Shared mailbox'} · ${recipient.email}` : 'Contact route not configured');
        options.push({
          kind: 'role',
          id: role.id,
          name: role.name,
          label: role.name,
          typeLabel: 'Role',
          detail,
          search: `${role.name} ${role.area} ${recipient.name} ${recipient.email}`.toLocaleLowerCase()
        });
      }
    }
    for (const contact of (state.contacts ?? []).filter(contact => contact.active !== false
      && (mode === 'person' ? contact.type === 'person' : contact.canReceiveTasks !== false)
      && (mode === 'person' || contactCanPerformRole(contact, eligibleRoleId)))) {
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

  function renderAssignmentPicker({ value = null, hint = null, fallback = '', mode = 'person-or-role', eligibleRoleId = '', taskId = '', questionId = '', eventField = '', statusField = '', newEventField = '', id = '', required = false, compact = false } = {}) {
    const reference = assignmentReference(value);
    const hintReference = reference ? null : assignmentReference(hint);
    const hasHint = !reference && Boolean(hintReference ?? hint);
    const display = reference
      ? assignmentDisplay(reference, fallback)
      : hasHint
        ? assignmentDisplay(hintReference ?? hint, fallback)
        : assignmentDisplay(value, fallback);
    const targetAttributes = [
      taskId ? `data-task-assignment="${escapeHtml(taskId)}"` : '',
      questionId ? `data-question-assignment="${escapeHtml(questionId)}"` : '',
      eventField ? `data-event-assignment-field="${escapeHtml(eventField)}"` : '',
      statusField ? `data-status-assignment-field="${escapeHtml(statusField)}"` : '',
      newEventField ? `data-new-event-assignment-field="${escapeHtml(newEventField)}"` : ''
    ].filter(Boolean).join(' ');
    const options = assignmentOptions(mode, getActiveEvent(), eligibleRoleId);
    return `<div class="assignment-picker ${compact ? 'compact' : ''} ${hasHint ? 'prior-answer-hint' : ''}" data-assignment-picker data-assignment-mode="${escapeHtml(mode)}" ${targetAttributes}>
      <div class="assignment-picker-input-row">
        <input ${id ? `id="${escapeHtml(id)}"` : ''} type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" autocomplete="off" value="${escapeHtml(display)}" placeholder="Start typing a person or role" data-assignment-input data-selected-kind="${escapeHtml(reference?.kind ?? '')}" data-selected-id="${escapeHtml(reference?.id ?? '')}" ${hasHint ? 'data-prior-answer-hint="true"' : ''} ${required ? 'required' : ''}>
        <button type="button" class="assignment-picker-toggle" data-assignment-toggle aria-label="Show people and roles" aria-expanded="false"><span class="assignment-picker-chevron" aria-hidden="true"></span></button>
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
    if (taskState.notRelevant === true) {
      taskState.status = 'not-relevant';
      return taskState;
    }

    const ownerSourceQuestionId = String(task.item.ownerFromQuestionId ?? '').trim();
    const ownerSourceTag = ownerSourceQuestionId ? `question:${ownerSourceQuestionId}` : '';
    const ownerSourceReference = ownerSourceQuestionId
      ? assignmentReference(getQuestionValue(ownerSourceQuestionId, event))
      : null;
    if (!ownerSourceQuestionId && String(taskState.assignedBy ?? '').startsWith('question:')) {
      assignTaskToReference(event, task.item, null, 'owner-source-retired');
    }
    const currentReference = taskAssignmentReference(taskState);
    const sourceCanManageOwner = !taskState.assignee || taskState.assignedBy === 'default-role' || taskState.assignedBy === ownerSourceTag;
    const sourceMatchesCurrent = ownerSourceReference && currentReference &&
      ownerSourceReference.kind === currentReference.kind && ownerSourceReference.id === currentReference.id;

    if (ownerSourceReference && sourceCanManageOwner && !sourceMatchesCurrent) {
      assignTaskToReference(event, task.item, ownerSourceReference, ownerSourceTag);
    } else if (!ownerSourceReference && taskState.assignedBy === ownerSourceTag) {
      assignTaskToReference(event, task.item, null, ownerSourceTag);
    }

    if (!taskState.assignee && task.item.defaultOwnerRoleId) {
      assignTaskToReference(event, task.item, { kind: 'role', id: task.item.defaultOwnerRoleId }, 'default-role');
    }
    reconcileEventStatusDecisionCompletion(task.item, event, taskState);
    reconcileTaskReviewCompletion(task.item, event, taskState);
    return taskState;
  }

  function assignTaskToReference(event, item, reference, assignedBy = 'organiser') {
    const taskState = ensureTaskState(event, item.id);
    const previousKey = `${taskState.assignmentKind ?? 'legacy'}:${taskState.assignmentId ?? taskState.assignee ?? ''}`;
    const resolved = assignmentReference(reference);
    if (!resolved) {
      if (taskState.assignee || taskState.assignmentId) rotateTaskCompletionLink(taskState);
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
    if (previousKey.toLocaleLowerCase() !== nextKey.toLocaleLowerCase()) {
      rotateTaskCompletionLink(taskState);
      if (taskState.assignee) queueNotification(event, item, 'assignment');
    }
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

    if (previous.toLocaleLowerCase() !== taskState.assignee.toLocaleLowerCase()) {
      rotateTaskCompletionLink(taskState);
      if (taskState.assignee) queueNotification(event, item, 'assignment');
    }
    return taskState;
  }

  function queueNotification(event, item, type) {
    state.notificationOutbox ??= [];
    const taskState = ensureTaskState(event, item.id);
    if (taskState.notRelevant === true || isTaskExpired(item, event, taskState)) return null;
    const dueDate = getDueDate(item.deadlineCode, event);
    const existing = state.notificationOutbox.find(notification => notification.eventId === event.id && notification.taskId === item.id && notification.type === type && !['sent', 'expired', 'not-relevant'].includes(notification.status));
    if (existing) return existing;

    const token = taskState.completionToken || crypto.randomUUID();
    const isEscalation = type === 'escalation';
    const taskRecipient = assignmentRecipient(taskAssignmentReference(taskState) ?? taskState.assignee, event);
    const organiserRecipient = assignmentRecipient(event.organiserRef ?? event.organiser, event);
    const recipientName = isEscalation ? (organiserRecipient.name || event.organiser || 'Event Coordinator') : (taskRecipient.name || taskState.assignee || '');
    const recipientEmail = isEscalation
      ? organiserRecipient.email
      : (taskRecipient.email || legacyTaskAssigneeEmail(taskState, taskAssignmentReference(taskState)));
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
    ensureCompletionLinkRegistration(event, item, taskState, dueDate);
    dispatchNotification(notification, taskState);
    saveState();
    return notification;
  }

  function isExpiredTaskNotification(notification) {
    const event = state.events.find(candidate => candidate.id === notification?.eventId);
    const indexed = itemIndex.get(notification?.taskId);
    if (!event || !indexed || indexed.item.type !== 'task') return false;
    return isTaskExpired(indexed.item, event, event.taskState?.[indexed.item.id]);
  }

  async function dispatchNotification(notification, taskState) {
    if (taskState.notRelevant === true) {
      notification.status = 'not-relevant';
      taskState.notificationStatus = 'not-relevant';
      saveState();
      return;
    }
    if (isExpiredTaskNotification(notification)) {
      notification.status = 'expired';
      taskState.notificationStatus = 'expired';
      saveState();
      return;
    }
    try {
      const response = await fetch('/api/tasks/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifications: [notification] })
      });
      if (!response.ok) return;
      const result = await response.json();
      if (taskState.notRelevant === true) {
        notification.status = 'not-relevant';
        taskState.notificationStatus = 'not-relevant';
        saveState();
        return;
      }
      notification.status = result.deliveryMode === 'development-outbox' ? 'outbox' : 'sent';
      taskState.notificationStatus = notification.status;
      saveState();
    } catch (error) {
      console.warn('Notification delivery is unavailable; it remains queued.', error);
    }
  }

  function ensureCompletionLinkRegistration(event, item, taskState, dueDate) {
    if (!taskState.completionToken) return;
    const completionToken = taskState.completionToken;
    const recipient = assignmentRecipient(taskAssignmentReference(taskState) ?? taskState.assignee, event);
    const expiresOn = getTaskExpiryDate(item, event);
    const signature = JSON.stringify({
      token: completionToken,
      eventId: event.id,
      eventName: event.name,
      taskId: item.id,
      taskTitle: item.title,
      assignee: taskState.assignee ?? recipient.name ?? '',
      assigneeEmail: recipient.email || legacyTaskAssigneeEmail(taskState, taskAssignmentReference(taskState)),
      dueDate,
      expiresOn,
      canCompleteFromLink: item.canCompleteFromLink !== false && !taskCompletionControl(item, event, taskState).blocked,
      learningInsights: priorLearningForItem(event, item).map(insight => ({
        summary: insight.summary,
        sourceEventName: insight.sourceEventName,
        sourceEventDate: insight.sourceEventDate,
        evidenceCount: Number(insight.evidenceCount || 0),
        sourceType: insight.sourceType
      }))
    });
    if (completionLinkRegistrationSignatures.get(completionToken) === signature ||
        completionLinkRegistrationRequests.has(completionToken)) return;

    const request = registerCompletionLink(JSON.parse(signature))
      .then(registered => {
        if (registered) completionLinkRegistrationSignatures.set(completionToken, signature);
      })
      .finally(() => completionLinkRegistrationRequests.delete(completionToken));
    completionLinkRegistrationRequests.set(completionToken, request);
  }

  async function registerCompletionLink(payload) {
    try {
      const response = await fetch('/api/tasks/completion-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(`Completion link registration failed (${response.status}).`);
      return true;
    } catch (error) {
      console.warn('Could not register completion link.', error);
      return false;
    }
  }

  function applyServerTaskCompletion(event, item, taskState, record) {
    if (taskState.notRelevant === true) return false;
    if (item.completionMode === 'event-status-decision' || item.canCompleteFromLink === false) {
      rotateTaskCompletionLink(taskState);
      return false;
    }
    const review = taskReviewState(item, event);
    if (review && !review.ready) {
      // This server completion was submitted against an answer set that cannot
      // currently complete the reviewed task. Rotate the token so it cannot be
      // accepted later merely because somebody subsequently supplies answers.
      rotateTaskCompletionLink(taskState);
      return false;
    }

    delete taskState.reviewCompletionProvenance;
    taskState.completed = true;
    taskState.status = 'completed';
    taskState.completedAt = record.completedAtUtc ?? taskState.completedAt ?? new Date().toISOString();
    if (review) {
      taskState.reviewSignature = review.signature;
      taskState.reviewInvalidatedAt = null;
    }
    if (record.completionNotes) taskState.notes = record.completionNotes;
    return true;
  }

  async function syncServerCompletions() {
    for (const event of state.events) {
      try {
        const response = await fetch(`/api/tasks/events/${encodeURIComponent(event.id)}/completions`);
        if (!response.ok) continue;
        const records = await response.json();
        for (const record of records) {
          const legacyTaskReplacement = {
            'booking-details-task': 'configure-ticket-sales-task',
            'decide-entry-charge': 'decide-booking-or-entry-charge'
          }[record.taskId];
          if (legacyTaskReplacement) {
            const replacementState = ensureTaskState(event, legacyTaskReplacement);
            if (!String(replacementState.notes ?? '').trim() && String(record.completionNotes ?? '').trim()) {
              replacementState.notes = record.completionNotes;
            }
            continue;
          }
          const indexed = itemIndex.get(record.taskId);
          if (!indexed) continue;
          const taskState = ensureTaskState(event, record.taskId);
          if (!taskState.completionToken || taskState.completionToken !== record.token) continue;
          applyServerTaskCompletion(event, indexed.item, taskState, record);
        }
      } catch (error) {
        console.warn('Could not synchronise task completions.', error);
      }
    }
    saveState();
  }

  function contactEmailByName(name) {
    if (!name) return '';
    return state.contacts.find(contact => contact.active !== false && contact.canReceiveTasks !== false &&
      contact.name.toLocaleLowerCase() === String(name).toLocaleLowerCase())?.email ?? '';
  }

  function legacyTaskAssigneeEmail(taskState, resolvedReference = taskAssignmentReference(taskState)) {
    if (resolvedReference || taskState?.assignmentKind || taskState?.assignmentId) return '';
    const name = String(taskState?.assignee ?? '').trim().toLocaleLowerCase();
    const cachedEmail = String(taskState?.assigneeEmail ?? '').trim().toLocaleLowerCase();
    if (!name) return '';
    const matchesKnownContact = (state.contacts ?? []).some(contact =>
      String(contact.name ?? '').trim().toLocaleLowerCase() === name ||
      (cachedEmail && String(contact.email ?? '').trim().toLocaleLowerCase() === cachedEmail));
    return matchesKnownContact ? '' : String(taskState?.assigneeEmail ?? '').trim();
  }

  function rotateTaskCompletionLink(taskState) {
    const previousToken = taskState?.completionToken;
    if (previousToken) {
      completionLinkRegistrationSignatures.delete(previousToken);
      completionLinkRegistrationRequests.delete(previousToken);
    }
    taskState.completionToken = crypto.randomUUID();
  }

  function markTaskComplete(event, item, completed) {
    const taskState = ensureTaskState(event, item.id);
    if (taskState.notRelevant === true) return false;
    if (item.completionMode === 'event-status-decision' ||
        (item.completionMode === 'intelligent-golf-ticket-sync' && completed)) return false;
    if (completed && isTaskExpired(item, event, taskState)) return false;
    const review = taskReviewState(item, event);
    if (completed && review && !review.ready) return false;
    if (!completed && taskState.completed === true) rotateTaskCompletionLink(taskState);
    delete taskState.reviewCompletionProvenance;
    taskState.completed = Boolean(completed);
    taskState.status = completed ? 'completed' : 'open';
    taskState.completedAt = completed ? new Date().toISOString() : null;
    if (review) {
      taskState.reviewSignature = completed ? review.signature : null;
      if (completed) taskState.reviewInvalidatedAt = null;
    }
    return true;
  }

  function markTaskNotRelevant(event, item, notRelevant) {
    const taskState = ensureTaskState(event, item.id);
    const excluded = Boolean(notRelevant);
    if (taskState.notRelevant === excluded) return true;

    rotateTaskCompletionLink(taskState);
    delete taskState.reviewCompletionProvenance;
    taskState.notRelevant = excluded;
    taskState.notRelevantAt = excluded ? new Date().toISOString() : null;
    taskState.completed = false;
    taskState.completedAt = null;
    taskState.reviewSignature = null;
    taskState.reviewInvalidatedAt = null;
    taskState.status = excluded ? 'not-relevant' : 'open';
    if (excluded) {
      taskState.notificationStatus = 'not-relevant';
      for (const notification of state.notificationOutbox ?? []) {
        if (notification.eventId === event.id && notification.taskId === item.id && notification.status === 'queued') {
          notification.status = 'not-relevant';
        }
      }
      taskBoardSelection.taskIds.delete(item.id);
    } else if (taskState.notificationStatus === 'not-relevant') {
      taskState.notificationStatus = null;
    }
    return true;
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

  function cloneEvent(sourceEvent) {
    const copy = createEvent(`${sourceEvent.name} (Copy)`, sourceEvent.organiser, '', sourceEvent.description ?? '', {}, structuredClone(sourceEvent.organiserRef ?? null));
    copy.clonedAnswerHints = collectCloneAnswerHints(sourceEvent);
    copy.answers = {};
    copy.questionMeta = {};
    copy.team = structuredClone(sourceEvent.team ?? []);
    copy.sourceEventId = sourceEvent.id;
    copy.eventSeriesId = sourceEvent.eventSeriesId ?? sourceEvent.id;
    copy.learningInsights = [];
    copy.retrospective = {};
    copy.briefing = {};
    copy.advisoryOverrides = {};
    copy.taskState = {};
    const priorFinanceSummary = financeTotals(sourceEvent);
    copy.finances = {
      entries: [],
      priorEventSummary: priorFinanceSummary.count ? structuredClone(priorFinanceSummary) : null
    };
    copy.lifecycle = {
      status: 'provisional',
      statusChangedAt: new Date().toISOString(),
      decisionOwner: sourceEvent.lifecycle?.decisionOwner ?? sourceEvent.organiser ?? '',
      decisionOwnerRef: structuredClone(sourceEvent.lifecycle?.decisionOwnerRef ?? sourceEvent.organiserRef ?? null),
      communicationsOwner: sourceEvent.lifecycle?.communicationsOwner ?? '',
      communicationsOwnerRef: structuredClone(sourceEvent.lifecycle?.communicationsOwnerRef ?? null),
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

  function collectCloneAnswerHints(sourceEvent) {
    const hints = structuredClone(sourceEvent.clonedAnswerHints ?? {});
    for (const module of playbook.modules ?? []) {
      for (const section of module.sections ?? []) {
        for (const item of section.items ?? []) {
          if (item.type === 'question' && item.bind === 'eventDate' && sourceEvent.eventDate) {
            hints[item.id] = sourceEvent.eventDate;
          }
        }
      }
    }
    for (const [questionId, value] of Object.entries(sourceEvent.answers ?? {})) {
      if (value === undefined || value === null || value === '') continue;
      hints[questionId] = structuredClone(value);
    }
    return hints;
  }

  function getActiveTasks(event, { includeNotRelevant = false } = {}) {
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
            if (task.state.notRelevant === true && !includeNotRelevant) continue;
            task.expiresOn = getTaskExpiryDate(taskItem, event);
            task.expired = isTaskExpired(taskItem, event, task.state, task.expiresOn);
            tasks.push(task);
          }
        }
      }
    }

    return tasks.sort((a, b) => {
      const statusRank = task => task.state.completed ? 1 : task.expired ? 2 : 0;
      if (statusRank(a) !== statusRank(b)) return statusRank(a) - statusRank(b);
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

  function getTaskExpiryDate(item, event) {
    const code = String(item?.expiresAfterDeadlineCode ?? '').trim();
    return code ? getDueDate(code, event) : null;
  }

  function currentClubIsoDate(date = new Date()) {
    const parts = Object.fromEntries(CLUB_DATE_FORMATTER.formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function clubIsoDateFromTimestamp(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value).substring(0, 10) : currentClubIsoDate(date);
  }

  function isTaskExpired(item, event, taskState = null, expiresOn = getTaskExpiryDate(item, event)) {
    if (taskState?.completed === true || !isValidIsoDate(expiresOn)) return false;
    return currentClubIsoDate() > expiresOn;
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

  function slugify(value) {
    return String(value ?? 'event')
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'event';
  }

  function formatBriefingAnswer(item, value) {
    if (value === 'dont-know') return 'Decision pending';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (item.answerType === 'assignment') return assignmentDisplay(value, 'Not assigned');
    const options = Array.isArray(item.options) ? item.options : [];
    const optionLabel = candidate => options.find(option => option.value === candidate)?.label ?? candidate;
    if (item.answerType === 'ticketTypes' && Array.isArray(value)) {
      return value
        .filter(entry => entry && String(entry.name ?? '').trim())
        .map(entry => `${String(entry.name).trim()} — £${Number(entry.price || 0).toFixed(2)}`)
        .join('; ');
    }
    if (Array.isArray(value)) return value.map(optionLabel).join(', ');
    if (value && typeof value === 'object') {
      if (value.start || value.end) return [value.start, value.end].filter(Boolean).join(' to ');
      return Object.entries(value).map(([key, entry]) => `${key}: ${entry}`).join(', ');
    }
    if (item.answerType === 'singleChoice') return optionLabel(value);
    if (item.answerType === 'date') return formatDate(value);
    if (item.answerType === 'number' && item.unit) return `${value} ${item.unit}`;
    return String(value ?? '').trim();
  }

  function buildIntelligentGolfPlanningNote(event) {
    if (!event || !playbook) return '';
    const lifecycle = normaliseEventLifecycle(event);
    const status = EVENT_STATUS_DEFINITIONS[lifecycle.status]?.label || lifecycle.status || 'Provisional';
    const time = [event.startTime, event.endTime].filter(Boolean).join('–');
    const lines = [
      'EVENT PLAYBOOK — OPERATIONAL PLANNING SUMMARY',
      `Event: ${event.name}`,
      `Date: ${formatDate(event.eventDate)}${time ? ` · ${time}` : ''}`,
      `Status: ${status}`,
      `Expected attendance: ${Number(event.expectedAttendees) > 0 ? Number(event.expectedAttendees) : 'Not yet confirmed'}`,
      `Organiser: ${assignmentDisplay(event.organiserRef ?? event.organiser, event.organiser || 'Not assigned')}`
    ];

    for (const group of INTELLIGENT_GOLF_NOTE_GROUPS) {
      const rows = [];
      for (const [questionId, label] of group.fields) {
        const indexed = itemIndex.get(questionId);
        const question = indexed?.item;
        if (!question || question.type !== 'question' ||
            !isModuleActive(indexed.module, event) || !isItemVisible(question, event) ||
            isQuestionNotRelevant(event, questionId)) continue;
        const value = getQuestionValue(questionId, event);
        if (!isAnsweredValue(value)) continue;
        const answer = formatBriefingAnswer(question, value);
        if (answer) rows.push(`${label}: ${answer}`);
      }
      if (rows.length) lines.push('', group.title.toUpperCase(), ...rows);
    }

    const taskNotes = [];
    for (const [taskId, taskState] of Object.entries(event.taskState ?? {})) {
      const note = String(taskState?.notes ?? '').trim();
      const indexed = itemIndex.get(taskId);
      if (!note || taskState?.notRelevant === true || indexed?.item?.type !== 'task') continue;
      const stateLabel = taskState.completed === true ? 'Confirmed' : 'Planning note';
      taskNotes.push(`${stateLabel} — ${indexed.item.title}: ${note}`);
    }
    if (taskNotes.length) lines.push('', 'EVENT PLAYBOOK TASK NOTES', ...taskNotes);

    lines.push('', 'This managed note is updated from Event Playbook. Actions remain in Event Playbook rather than this note.');
    const note = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (note.length <= 7000) return note;
    return `${note.slice(0, 6910).trimEnd()}\n\n[Further planning detail remains available in Event Playbook.]`;
  }

  function materialiseIntelligentGolfPlanningNotes() {
    if (!playbook) return false;
    let changed = false;
    for (const event of state.events ?? []) {
      const note = buildIntelligentGolfPlanningNote(event);
      if (event.intelligentGolfPlanningNote === note) continue;
      event.intelligentGolfPlanningNote = note;
      changed = true;
    }
    return changed;
  }

  function buildCommunicationsPlanningContext(event) {
    const fields = [
      ['registrationMode', 'admission-arrangements'],
      ['freeEntry', 'admission-free-entry'],
      ['freeEntryCategories', 'admission-free-categories'],
      ['ticketPriceDetails', 'admission-price-details'],
      ['paymentTiming', 'admission-payment-timing'],
      ['maximumPlaces', 'admission-capacity'],
      ['bookingRoutes', 'ticket-sales-methods'],
      ['guestTableBooking', 'guest-table-booking'],
      ['bookingOpens', 'ticket-sales-open-date'],
      ['bookingCloses', 'ticket-sales-close-date'],
      ['publicBookingInstructions', 'admission-public-instructions']
    ];

    return Object.fromEntries(fields.flatMap(([propertyName, questionId]) => {
      const indexed = itemIndex.get(questionId);
      const question = indexed?.item;
      if (!question || question.type !== 'question' ||
          !isModuleActive(indexed.module, event) || !isItemVisible(question, event)) {
        return [];
      }

      const value = getQuestionValue(questionId, event);
      if (!isAnsweredValue(value)) return [];
      const answer = formatBriefingAnswer(question, value);
      return answer ? [[propertyName, answer]] : [];
    }));
  }

  function taskReviewState(item, event) {
    const review = item?.reviewSummary;
    if (!review || !Array.isArray(review.fields) || !event) return null;

    const fields = review.fields.map(field => {
      const question = itemIndex.get(field.questionId)?.item;
      const visible = Boolean(question && isItemVisible(question, event));
      const value = question ? getQuestionValue(field.questionId, event) : undefined;
      const notRelevant = Boolean(question && isQuestionNotRelevant(event, field.questionId));
      const hasAnswer = notRelevant || Boolean(question && isAnsweredValue(value) && (
        question.answerType !== 'assignment' || assignmentDisplay(value, '').trim()
      ) && (question.answerType !== 'ticketTypes' || validTicketTypesAnswer(value)));
      const required = field.required === undefined
        ? question?.required !== false
        : field.required !== false;
      const missing = !question || (visible && required && !hasAnswer);
      const unselectedOptionLabels = question && field.showUnselectedOptions === true && Array.isArray(value)
        ? (question.options ?? [])
          .filter(option => !value.includes(option.value))
          .map(option => option.label)
        : null;
      const answer = !question
        ? 'Question unavailable'
        : !visible
          ? (field.notApplicableText || 'Not applicable')
          : notRelevant
            ? (field.notApplicableText || 'Not relevant')
          : hasAnswer
            ? (unselectedOptionLabels
              ? (unselectedOptionLabels.join(', ') || field.allSelectedText || 'None')
              : formatBriefingAnswer(question, value))
            : (field.emptyText || (required ? 'Answer needed' : 'Not specified'));
      return {
        questionId: field.questionId,
        label: field.label || question?.label || field.questionId,
        visible,
        notRelevant,
        required,
        missing,
        answer
      };
    });

    return {
      config: review,
      fields,
      missing: fields.filter(field => field.missing),
      ready: fields.every(field => !field.missing),
      signature: JSON.stringify(fields.map(field => [field.questionId, field.visible, field.answer]))
    };
  }

  function invalidateTaskReviewConfirmations(event, questionId) {
    if (!event || !questionId) return;
    for (const module of playbook.modules ?? []) {
      for (const section of module.sections ?? []) {
        for (const item of section.items ?? []) {
          if (item.type !== 'task' || !item.reviewSummary?.fields?.some(field => field.questionId === questionId)) continue;
          const taskState = event.taskState?.[item.id];
          if (!taskState || (!taskState.completed && !taskState.reviewSignature)) continue;
          const wasConfirmed = taskState.completed === true;
          if (wasConfirmed) rotateTaskCompletionLink(taskState);
          delete taskState.reviewCompletionProvenance;
          taskState.completed = false;
          taskState.status = 'open';
          taskState.completedAt = null;
          taskState.reviewSignature = null;
          if (wasConfirmed) taskState.reviewInvalidatedAt = new Date().toISOString();
        }
      }
    }
  }

  function reconcileTaskReviewCompletion(item, event, taskState) {
    const review = taskReviewState(item, event);
    if (!review || taskState.completed !== true) return review;

    // Only the v3.6 migration may grandfather a completion created before these
    // food tasks gained review summaries. An unsigned current/server completion
    // must still be reconciled and cannot masquerade as legacy work.
    const isGrandfatheredFoodCompletion =
      taskState.reviewCompletionProvenance === LEGACY_FOOD_REVIEW_COMPLETION_PROVENANCE &&
      !taskState.reviewSignature;
    if (isGrandfatheredFoodCompletion) return review;

    const answersChanged = taskState.reviewSignature !== review.signature;
    if (!review.ready || answersChanged) {
      rotateTaskCompletionLink(taskState);
      delete taskState.reviewCompletionProvenance;
      taskState.completed = false;
      taskState.status = 'open';
      taskState.completedAt = null;
      taskState.reviewSignature = null;
      taskState.reviewInvalidatedAt ??= new Date().toISOString();
    }
    return review;
  }

  function eventStatusNotificationTargetSignature(targets) {
    return JSON.stringify({
      recipients: [...(targets?.recipients ?? [])]
        .map(recipient => ({
          email: String(recipient.email ?? '').trim().toLocaleLowerCase(),
          areas: [...(recipient.areas ?? [])].map(String).sort((left, right) => left.localeCompare(right))
        }))
        .sort((left, right) => left.email.localeCompare(right.email)),
      missingEmail: [...(targets?.missingEmail ?? [])]
        .map(recipient => `${recipient.area ?? ''}|${recipient.name ?? ''}`.toLocaleLowerCase())
        .sort((left, right) => left.localeCompare(right))
    });
  }

  function eventStatusDecisionIsSatisfied(item, event) {
    if (item?.completionMode !== 'event-status-decision') return false;
    const lifecycle = normaliseEventLifecycle(event);
    if (item.id === 'confirm-event-before-commitments' && lifecycle.status !== 'confirmed') return false;
    if (item.id === 'resolve-at-risk-event' &&
        !['postponed', 'cancelled'].includes(lifecycle.status) &&
        !(lifecycle.status === 'confirmed' && lifecycle.resolvedFromAtRisk === true)) return false;
    if (!['confirm-event-before-commitments', 'resolve-at-risk-event'].includes(item.id) &&
        lifecycle.status === 'provisional') return false;

    const expiresOn = getTaskExpiryDate(item, event);
    const decisionDate = clubIsoDateFromTimestamp(lifecycle.statusChangedAt);
    if (isValidIsoDate(expiresOn) && currentClubIsoDate() > expiresOn &&
        (!isValidIsoDate(decisionDate) || decisionDate > expiresOn)) return false;

    const notification = lifecycle.statusNotification;
    if (notification?.deliveryStatus === 'legacy-recorded') return true;
    if (!NOTIFIABLE_EVENT_STATUSES.has(lifecycle.status) ||
        notification?.status !== lifecycle.status ||
        notification?.statusChangedAt !== lifecycle.statusChangedAt) return false;

    const targets = eventStatusNotificationTargets(event);
    if (targets.missingEmail.length) return false;
    if (eventStatusNotificationTargetSignature(targets) !== notification.targetSignature) return false;
    if (!targets.recipients.length) return true;
    return notification.deliveryStatus === 'sent' && Number(notification.pendingRecipientCount || 0) === 0;
  }

  function reconcileEventStatusDecisionCompletion(item, event, taskState) {
    if (item?.completionMode !== 'event-status-decision') return;
    const completed = eventStatusDecisionIsSatisfied(item, event);
    if (taskState.completed === completed && taskState.status === (completed ? 'completed' : 'open')) return;
    if (!completed && taskState.completed === true) rotateTaskCompletionLink(taskState);
    delete taskState.reviewCompletionProvenance;
    taskState.completed = completed;
    taskState.status = completed ? 'completed' : 'open';
    taskState.completedAt = completed
      ? event.lifecycle?.statusNotification?.completedAt ?? event.lifecycle?.statusChangedAt ?? new Date().toISOString()
      : null;
    taskState.reviewSignature = null;
  }

  function taskCompletionControl(item, event, taskState) {
    const review = taskReviewState(item, event);
    const completed = taskState.completed === true;
    const expiresOn = getTaskExpiryDate(item, event);
    const expired = isTaskExpired(item, event, taskState, expiresOn);
    const statusManaged = item.completionMode === 'event-status-decision';
    const integrationManaged = item.completionMode === 'intelligent-golf-ticket-sync';
    const actionRequired = (statusManaged || integrationManaged) && !completed && !expired;
    const blocked = expired || statusManaged || integrationManaged || Boolean(review && !completed && !review.ready);
    return {
      review,
      blocked,
      expired,
      expiresOn,
      statusManaged,
      integrationManaged,
      actionRequired,
      title: integrationManaged
        ? completed
          ? 'The Intelligent Golf ticket configuration has been verified'
          : review && !review.ready
            ? `Complete ${review.missing.length} missing ticket answer${review.missing.length === 1 ? '' : 's'} first`
            : 'Use the Intelligent Golf action to configure and verify the tickets'
        : statusManaged
        ? completed
          ? 'Completion is controlled by the recorded event-status decision'
          : expired
            ? `This task expired after ${formatDate(expiresOn)} and no longer needs action`
            : 'Use the event-status action to record the decision and notify the affected leads'
        : completed
        ? (review ? 'Reopen the confirmed plan' : 'Mark task open')
        : expired
          ? `This task expired after ${formatDate(expiresOn)} and no longer needs action`
        : actionRequired
          ? 'Use the event-status action to record the decision and notify the affected leads'
        : blocked
          ? `Complete ${review.missing.length} missing Event control answer${review.missing.length === 1 ? '' : 's'} first`
          : (review?.config.confirmLabel || 'Mark task complete'),
      label: integrationManaged
        ? completed ? 'Configured' : 'Use IG action'
        : statusManaged
        ? completed ? 'Recorded' : expired ? 'Expired' : 'Use status'
        : completed
        ? (review ? 'Confirmed' : 'Complete')
        : expired
          ? 'Expired'
        : (review?.config.confirmLabel || 'Mark complete')
    };
  }

  function renderTaskReviewSummary(item, event, taskState, showCompletionAction = true) {
    const review = taskReviewState(item, event);
    if (!review) return '';
    const completed = taskState.completed === true;
    const expired = isTaskExpired(item, event, taskState);
    const statusText = expired
      ? 'Expired — no action required'
      : completed
      ? (review.config.confirmedLabel || 'Arrangements confirmed')
      : review.ready
        ? 'Ready to confirm'
        : `${review.missing.length} answer${review.missing.length === 1 ? '' : 's'} needed`;
    const confirmText = review.ready
      ? (review.config.confirmLabel || 'Confirm these arrangements')
      : `Complete ${review.missing.length} answer${review.missing.length === 1 ? '' : 's'} first`;

    return `<section class="task-review-summary ${completed ? 'confirmed' : ''} ${review.ready ? 'ready' : 'needs-answers'}" aria-label="${escapeHtml(review.config.title || 'Task review')}">
      <header class="task-review-summary-heading">
        <div><span>Decision check</span><strong>${escapeHtml(review.config.title || 'Review the recorded answers')}</strong></div>
        <span class="task-review-summary-status">${completed ? '✓ ' : ''}${escapeHtml(statusText)}</span>
      </header>
      <dl class="task-review-summary-grid">
        ${review.fields.map(field => `<div class="task-review-summary-field ${field.missing ? 'missing' : ''} ${field.visible && !field.notRelevant ? '' : 'not-applicable'}">
          <dt>${escapeHtml(field.label)}</dt>
          <dd>${escapeHtml(field.answer)}</dd>
        </div>`).join('')}
      </dl>
      <footer class="task-review-summary-footer">
        <p>${escapeHtml(review.config.instruction || 'Check the answers before confirming this task.')}</p>
        <div class="task-review-summary-actions">
          ${expired ? '' : renderTaskWorkspaceAction(item, event)}
          ${expired
            ? '<span class="task-review-confirmed">— Expired</span>'
            : completed
            ? `<span class="task-review-confirmed">✓ ${escapeHtml(review.config.confirmedLabel || 'Confirmed')}</span>`
            : showCompletionAction && item.completionMode !== 'intelligent-golf-ticket-sync'
              ? `<button type="button" class="button button-primary" data-task-confirm="${escapeHtml(item.id)}" data-task-confirm-event-id="${escapeHtml(event.id)}" ${review.ready ? '' : 'disabled'}>${escapeHtml(confirmText)}</button>`
              : ''}
        </div>
      </footer>
    </section>`;
  }

  function briefingSourcePayload(event) {
    const answers = [];
    for (const module of playbook.modules) {
      if (!isModuleActive(module, event)) continue;
      for (const section of module.sections) {
        for (const item of section.items) {
          if (item.type !== 'question' || !isItemVisible(item, event)) continue;
          const value = getQuestionValue(item.id, event);
          if (isQuestionNotRelevant(event, item.id)) {
            answers.push({
              questionId: item.id,
              module: module.title,
              section: section.title,
              question: item.label,
              answer: 'Not relevant'
            });
            continue;
          }
          if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) continue;
          const answer = formatBriefingAnswer(item, value);
          if (!answer) continue;
          answers.push({
            questionId: item.id,
            module: module.title,
            section: section.title,
            question: item.label,
            answer
          });
        }
      }
    }

    const tasks = getActiveTasks(event).filter(task => !task.expired).map(task => {
      const ownerReference = taskAssignmentReference(task.state) ?? task.state.assignee;
      const owner = assignmentDisplay(ownerReference, task.state.assignee || (task.item.defaultOwnerRoleId ? roleById(task.item.defaultOwnerRoleId)?.name : '') || '');
      const staffBriefing = task.item.staffBriefing && typeof task.item.staffBriefing === 'object'
        ? task.item.staffBriefing
        : {};
      return {
        area: task.item.responsibleArea ?? task.module.title,
        title: task.item.title,
        detail: getTaskDetail(task.item, event),
        dueDate: task.dueDate ? formatDate(task.dueDate) : '',
        owner,
        completed: task.state.completed === true,
        notes: String(task.state.notes ?? '').trim(),
        staffBriefingPhase: String(staffBriefing.phase ?? '').trim(),
        staffBriefingAudience: String(staffBriefing.audience ?? '').trim(),
        staffBriefingInstruction: String(staffBriefing.instruction ?? '').trim()
      };
    });

    const lifecycle = normaliseEventLifecycle(event);
    return {
      eventName: event.name,
      eventDescription: event.description,
      eventDate: event.eventDate,
      startTime: event.startTime,
      endTime: event.endTime,
      organiser: event.organiser,
      status: eventStatusDefinition(event).label,
      statusReason: lifecycle.reason || lifecycle.memberUpdate || '',
      expectedAttendees: event.expectedAttendees,
      answers,
      tasks
    };
  }

  function briefingFingerprint(payload) {
    const input = `briefing-v3|${playbook.schemaVersion}|${JSON.stringify(payload)}`;
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `v3-${(hash >>> 0).toString(16).padStart(8, '0')}-${input.length}`;
  }

  function currentBriefingSource(event) {
    const payload = briefingSourcePayload(event);
    return { payload, fingerprint: briefingFingerprint(payload) };
  }

  function renderBriefingList(values, emptyText) {
    const items = Array.isArray(values) ? values.filter(Boolean) : [];
    return items.length
      ? `<ul>${items.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`
      : `<p class="briefing-empty-copy">${escapeHtml(emptyText)}</p>`;
  }

  function renderStaffBriefingSection(title, values, emptyText) {
    const actions = Array.isArray(values) ? values.filter(Boolean) : [];
    const content = actions.length
      ? `<ul class="staff-briefing-action-list">${actions.map(action => {
          if (typeof action === 'string') return `<li><span>${escapeHtml(action)}</span></li>`;
          return `<li><strong>${escapeHtml(action.audience || 'Event team')}</strong><span>${escapeHtml(action.instruction || '')}</span></li>`;
        }).join('')}</ul>`
      : `<p class="briefing-empty-copy">${escapeHtml(emptyText)}</p>`;
    return `<section class="staff-briefing-section"><h3>${escapeHtml(title)}</h3>${content}</section>`;
  }

  function plannerSummaryText(briefing) {
    const lines = [briefing.headline, briefing.eventSummary].filter(Boolean);
    const facts = Array.isArray(briefing.keyInformation) ? briefing.keyInformation : [];
    if (facts.length) lines.push(facts.map(fact => `${fact.label}: ${fact.value}`).join('\n'));
    for (const section of Array.isArray(briefing.sections) ? briefing.sections : []) {
      if (!section?.title || !Array.isArray(section.points) || !section.points.length) continue;
      lines.push(`${section.title}\n${section.points.map(point => `• ${point}`).join('\n')}`);
    }
    return lines.join('\n\n').trim();
  }

  function renderBriefing(event) {
    const briefing = event.briefing ?? {};
    const source = currentBriefingSource(event);
    const current = briefing.sourceFingerprint === source.fingerprint;
    const hasSummary = Boolean(briefing.eventSummary && briefing.staffBriefing);
    const failed = !current && briefing.errorFingerprint === source.fingerprint;
    const generatedAt = briefing.generatedAt
      ? new Date(briefing.generatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
      : '';
    const keyInformation = Array.isArray(briefing.keyInformation) ? briefing.keyInformation : [];
    const sections = Array.isArray(briefing.sections) ? briefing.sections : [];
    const staff = briefing.staffBriefing ?? {};

    const status = current
      ? { className: 'current', title: 'Briefing up to date', copy: generatedAt ? `Generated ${generatedAt}` : 'Generated from the current event plan' }
      : failed
        ? { className: 'failed', title: 'Briefing could not be refreshed', copy: briefing.error || 'The briefing service returned an error.' }
        : { className: 'generating', title: hasSummary ? 'Refreshing after planning changes' : 'Preparing the first briefing', copy: 'The event details, confirmed answers and operational staff duties are being compiled now.' };

    return `<div class="briefing-page">
      <section class="briefing-intro-card">
        <div><span class="eyebrow">Read-only event intelligence</span><h2>One reliable briefing from the current plan</h2><p>This page is regenerated whenever the event description, planning answers, task ownership, notes, dates or completion state changes.</p></div>
        <div class="briefing-status ${status.className}" data-briefing-status><span aria-hidden="true"></span><div><strong>${escapeHtml(status.title)}</strong><small>${escapeHtml(status.copy)}</small></div>${failed ? '<button type="button" class="button button-secondary" data-retry-briefing>Try again</button>' : ''}</div>
      </section>

      ${hasSummary ? `<section class="event-briefing-card ${current ? '' : 'stale'}">
        ${!current ? '<div class="briefing-stale-banner">The plan has changed. This previous briefing remains visible while the replacement is prepared.</div>' : ''}
        <header><div><span class="eyebrow">Event summary for the planner</span><h2>${escapeHtml(briefing.headline || event.name)}</h2></div><div class="briefing-card-actions"><span class="briefing-readonly-badge">Read only</span><button type="button" class="button button-secondary" data-copy-planner-summary ${current ? '' : 'disabled'}>Copy summary</button></div></header>
        <p class="event-briefing-summary">${escapeHtml(briefing.eventSummary)}</p>
        ${keyInformation.length ? `<div class="briefing-key-information">${keyInformation.map(fact => `<div><small>${escapeHtml(fact.label)}</small><strong>${escapeHtml(fact.value)}</strong></div>`).join('')}</div>` : ''}
        ${sections.length ? `<div class="briefing-section-grid">${sections.map(section => `<section><h3>${escapeHtml(section.title)}</h3>${renderBriefingList(section.points, 'No additional details recorded.')}</section>`).join('')}</div>` : ''}
      </section>` : `<section class="briefing-generation-placeholder ${failed ? 'failed' : ''}"><span aria-hidden="true">${failed ? '!' : '✦'}</span><div><h2>${escapeHtml(status.title)}</h2><p>${escapeHtml(status.copy)}</p>${failed ? '<button type="button" class="button button-primary" data-retry-briefing>Try again</button>' : ''}</div></section>`}

      ${hasSummary ? `<section class="staff-briefing-area">
        <header><div><span class="eyebrow">Printable operational notice</span><h2>Staff briefing</h2><p>Only practical duties for the teams delivering the event—separate from the organisers’ planning checklist.</p></div><button type="button" class="button button-gold" data-print-staff-briefing ${current ? '' : 'disabled'}>Print staff briefing</button></header>
        <article class="staff-briefing-sheet" id="staff-briefing-print-area">
          <header class="staff-briefing-sheet-header"><div><img src="${escapeHtml(clubBranding.crestUrl)}" alt=""><span>${escapeHtml(clubBranding.clubName)}</span></div><small>STAFF BRIEFING</small></header>
          <div class="staff-briefing-title"><h2>${escapeHtml(staff.heading || `Staff briefing: ${event.name}`)}</h2><p>${escapeHtml(staff.introduction || briefing.eventSummary)}</p></div>
          <div class="staff-briefing-phases">
            ${renderStaffBriefingSection('Before guests arrive', staff.preparation, 'No immediate setup duties have been recorded.')}
            ${renderStaffBriefingSection('During the event', staff.eventDay, 'No event-delivery duties have been recorded.')}
            ${renderStaffBriefingSection('Close-down and afterwards', staff.afterwards, 'No immediate close-down duties have been recorded.')}
          </div>
          <div class="staff-briefing-support">
            ${renderStaffBriefingSection('Key contacts', staff.keyContacts, 'No named contacts have been recorded.')}
            ${renderStaffBriefingSection('Important notes', staff.importantNotes, 'No additional warnings or unresolved points have been recorded.')}
          </div>
          <footer>Generated from the current approved event information · ${escapeHtml(generatedAt || 'Current plan')}</footer>
        </article>
      </section>` : ''}
    </div>`;
  }

  async function ensureEventBriefing(event, force = false) {
    const source = currentBriefingSource(event);
    event.briefing ??= {};
    if (!force && event.briefing.sourceFingerprint === source.fingerprint) return;
    if (!force && event.briefing.errorFingerprint === source.fingerprint) return;
    if (briefingGenerationRequests.get(event.id)?.fingerprint === source.fingerprint) return;

    event.briefing.error = '';
    event.briefing.errorFingerprint = '';
    const requestRecord = { fingerprint: source.fingerprint, promise: null };
    briefingGenerationRequests.set(event.id, requestRecord);
    requestRecord.promise = (async () => {
      try {
        const response = await fetch('/api/briefing/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(source.payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `The briefing service returned ${response.status}.`);

        const latestSource = currentBriefingSource(event);
        if (latestSource.fingerprint !== source.fingerprint) return;
        event.briefing = {
          ...result,
          sourceFingerprint: source.fingerprint,
          generatedAt: new Date().toISOString(),
          error: '',
          errorFingerprint: ''
        };
        saveState();
      } catch (error) {
        const latestSource = currentBriefingSource(event);
        if (latestSource.fingerprint === source.fingerprint) {
          event.briefing.error = error.message || 'The briefing could not be generated.';
          event.briefing.errorFingerprint = source.fingerprint;
          saveState();
        }
      } finally {
        if (briefingGenerationRequests.get(event.id) === requestRecord) briefingGenerationRequests.delete(event.id);
        if (state.activeView === 'briefing' && state.activeEventId === event.id) render();
      }
    })();
  }

  function renderIntelligentGolfPlannerMatchBanner(event) {
    if (!pluginCapabilities.intelligentGolfEnabled || !event) return '';
    const status = intelligentGolfEventStatuses.get(event.id);
    const notice = intelligentGolfResolutionNotices.get(event.id);
    if (status?.plannerMatchRequired && status.plannerMatchCandidates.length > 0) {
      const count = status.plannerMatchCandidates.length;
      return `<section class="ig-planner-match-banner action-required" role="status">
        <span class="ig-planner-match-icon" aria-hidden="true">!</span>
        <div><strong>Intelligent Golf planner event needs matching</strong><p>${count} planner entr${count === 1 ? 'y already exists' : 'ies already exist'} on ${escapeHtml(formatDate(status.plannerMatchEventDate || event.eventDate))}. Confirm whether one is this event before Event Playbook creates anything else.</p></div>
        <button class="button button-primary" type="button" data-review-ig-planner-match>Review ${count === 1 ? 'event' : 'events'}</button>
      </section>`;
    }
    if (notice) {
      return `<section class="ig-planner-match-banner ${notice.tone === 'error' ? 'failed' : 'succeeded'}" role="${notice.tone === 'error' ? 'alert' : 'status'}">
        <span class="ig-planner-match-icon" aria-hidden="true">${notice.tone === 'error' ? '!' : '✓'}</span>
        <div><strong>${notice.tone === 'error' ? 'Intelligent Golf needs attention' : 'Intelligent Golf planner linked'}</strong><p>${escapeHtml(notice.message)}</p></div>
        <button class="button button-secondary" type="button" data-dismiss-ig-planner-notice>Dismiss</button>
      </section>`;
    }
    return '';
  }

  function renderIntelligentGolfPlannerMatchDialog(event) {
    if (!pluginCapabilities.intelligentGolfEnabled || !event) return '';
    const status = intelligentGolfEventStatuses.get(event.id);
    if (!status?.plannerMatchRequired || status.plannerMatchCandidates.length === 0) return '';
    const availableCandidates = status.plannerMatchCandidates.filter(candidate => !candidate.linkedToAnotherPlaybookEvent);
    const selectedId = availableCandidates[0]?.intelligentGolfEventId ?? 0;
    const count = status.plannerMatchCandidates.length;
    return `<dialog id="ig-planner-match-dialog" class="modal ig-planner-match-dialog" data-event-id="${escapeHtml(event.id)}" data-match-signature="${escapeHtml(intelligentGolfMatchSignature(event.id, status))}" aria-labelledby="ig-planner-match-heading">
      <div class="modal-heading">
        <div><span class="eyebrow">Intelligent Golf integration</span><h2 id="ig-planner-match-heading">Is this event already in the planner?</h2><p>Event Playbook found ${count === 1 ? 'an entry' : 'entries'} on the same date and has paused before creating a duplicate.</p></div>
        <button class="icon-button" type="button" data-defer-ig-planner-match aria-label="Decide later">×</button>
      </div>
      <div class="ig-planner-match-body">
        <section class="ig-planner-match-summary">
          <span class="eyebrow">Event Playbook event</span>
          <h3>${escapeHtml(event.name)}</h3>
          <p>${escapeHtml(formatDate(status.plannerMatchEventDate || event.eventDate))}</p>
          <div><strong>No changes have been made in Intelligent Golf</strong><span>If you link an existing entry, its current group, type and other configuration will be preserved.</span></div>
        </section>
        <fieldset class="ig-planner-match-candidates">
          <legend>Choose the matching planner entry</legend>
          ${status.plannerMatchCandidates.map(candidate => {
            const unavailable = candidate.linkedToAnotherPlaybookEvent;
            return `<label class="ig-planner-match-candidate${unavailable ? ' unavailable' : ''}">
              <input type="radio" name="ig-planner-match-candidate" value="${candidate.intelligentGolfEventId}"${candidate.intelligentGolfEventId === selectedId ? ' checked' : ''}${unavailable ? ' disabled' : ''}>
              <span><strong>${escapeHtml(candidate.name)}</strong><small>Intelligent Golf planner entry ${candidate.intelligentGolfEventId}${unavailable ? ' · already linked to another Playbook event' : ''}</small></span>
            </label>`;
          }).join('')}
        </fieldset>
        <div class="ig-planner-match-guidance">
          <div><strong>Use selected event</strong><span>Links this Playbook event to the selected planner entry without updating the existing IG details now.</span></div>
          <div><strong>Create a separate event</strong><span>Use this only when the entry above is genuinely a different event on the same day.</span></div>
        </div>
        <div class="ig-planner-match-error" role="alert" hidden></div>
      </div>
      <div class="modal-actions">
        <button class="button button-secondary" type="button" data-defer-ig-planner-match>Decide later</button>
        <span></span>
        <button class="button button-secondary" type="button" data-resolve-ig-planner-match="create-new">Create a separate event</button>
        <button class="button button-primary" type="button" data-resolve-ig-planner-match="adopt"${selectedId ? '' : ' disabled'}>Use selected event</button>
      </div>
    </dialog>`;
  }

  function renderIntelligentGolfPlannerLinkDialog(event) {
    const dialogState = intelligentGolfPlannerLinkDialogState;
    if (!pluginCapabilities.intelligentGolfEnabled || !event || dialogState?.eventId !== event.id) return '';

    const status = intelligentGolfEventStatuses.get(event.id);
    const currentPlannerEntryId = Number(dialogState.currentPlannerEntryId) || Number(status?.plannerEntryId) || 0;
    const candidates = Array.isArray(dialogState.candidates) ? dialogState.candidates : [];
    const currentPlannerEntryDiscovered = candidates.some(candidate =>
      candidate.intelligentGolfEventId === currentPlannerEntryId);
    const selectedPlannerEntryId = Number(dialogState.selectedPlannerEntryId) || currentPlannerEntryId;
    const selectedAlternative = candidates.some(candidate =>
      candidate.intelligentGolfEventId === selectedPlannerEntryId &&
      candidate.intelligentGolfEventId !== currentPlannerEntryId &&
      !candidate.linkedToAnotherPlaybookEvent);
    const selectableAlternative = candidates.some(candidate =>
      !candidate.current && !candidate.linkedToAnotherPlaybookEvent);
    const diaryWarning = status?.diaryEntryId
      ? `The saved association with member diary entry ${status.diaryEntryId} will be cleared. Publishing to the member diary again will establish the appropriate association for the newly linked planner event.`
      : 'Any saved member diary association with the old planner event will be cleared.';

    return `<dialog id="ig-planner-link-dialog" class="modal ig-planner-match-dialog ig-planner-link-dialog" data-planner-link-event-id="${escapeHtml(event.id)}" data-current-planner-entry-id="${currentPlannerEntryId}" aria-labelledby="ig-planner-link-heading"${dialogState.loading ? ' aria-busy="true"' : ''}>
      <div class="modal-heading">
        <div><span class="eyebrow">Intelligent Golf integration</span><h2 id="ig-planner-link-heading">Change linked planner event</h2><p>Choose a different Intelligent Golf planner entry for this Event Playbook event.</p></div>
        <button class="icon-button" type="button" data-close-ig-planner-link aria-label="Close">×</button>
      </div>
      <div class="ig-planner-match-body">
        <section class="ig-planner-match-summary">
          <span class="eyebrow">Event Playbook event</span>
          <h3>${escapeHtml(event.name)}</h3>
          <p>${escapeHtml(formatDate(dialogState.eventDate || event.eventDate))}</p>
          <div><strong>Currently linked to planner entry ${currentPlannerEntryId}</strong><span>${dialogState.loading
            ? 'Checking this saved link against the Intelligent Golf planner…'
            : currentPlannerEntryDiscovered
              ? 'Selecting another entry changes only Event Playbook’s link.'
              : 'This is the saved Event Playbook link, but it was not returned by the latest Intelligent Golf planner lookup.'}</span></div>
        </section>
        ${dialogState.loading
          ? '<div class="ig-planner-link-loading" role="status"><span aria-hidden="true"></span><div><strong>Checking the Intelligent Golf planner…</strong><p>Finding planner entries on this event date.</p></div></div>'
          : `<fieldset class="ig-planner-match-candidates">
              <legend>Choose the planner entry to use</legend>
              ${candidates.map(candidate => {
                const unavailable = candidate.linkedToAnotherPlaybookEvent;
                const current = candidate.current || candidate.intelligentGolfEventId === currentPlannerEntryId;
                const selected = candidate.intelligentGolfEventId === selectedPlannerEntryId;
                const details = current
                  ? 'currently linked'
                  : unavailable
                    ? 'already linked to another Playbook event'
                    : 'available to link';
                return `<label class="ig-planner-match-candidate${current ? ' current' : ''}${unavailable ? ' unavailable' : ''}">
                  <input type="radio" name="ig-planner-link-candidate" value="${candidate.intelligentGolfEventId}"${selected ? ' checked' : ''}${unavailable ? ' disabled' : ''}>
                  <span><strong>${escapeHtml(candidate.name)}</strong><small>Intelligent Golf planner entry ${candidate.intelligentGolfEventId} · ${details}</small></span>
                </label>`;
              }).join('')}
              ${selectableAlternative
                ? ''
                : candidates.length === 0
                  ? '<p class="ig-planner-link-empty">Intelligent Golf returned no planner entries for this date. The saved link could not be verified.</p>'
                  : '<p class="ig-planner-link-empty">No other available planner entries were found on this date.</p>'}
            </fieldset>`}
        ${dialogState.loading ? '' : `<section class="ig-planner-entry-lookup" aria-labelledby="ig-planner-entry-lookup-heading">
          <div>
            <strong id="ig-planner-entry-lookup-heading">Know the planner entry ID?</strong>
            <span>Open the event in Intelligent Golf and copy the number after <code>eventid=</code> from its address.</span>
          </div>
          <div class="ig-planner-entry-lookup-controls">
            <label for="ig-planner-entry-id">Planner entry ID</label>
            <input id="ig-planner-entry-id" type="number" min="1" step="1" inputmode="numeric" value="${escapeHtml(dialogState.lookupEntryId || '')}" placeholder="For example, 4423"${dialogState.lookupLoading ? ' disabled' : ''}>
            <button class="button button-secondary" type="button" data-check-ig-planner-entry${dialogState.lookupLoading ? ' disabled' : ''}>${dialogState.lookupLoading ? 'Checking…' : 'Check entry'}</button>
          </div>
          <p class="ig-planner-entry-lookup-status${dialogState.lookupError ? ' error' : ''}" role="${dialogState.lookupError ? 'alert' : 'status'}"${dialogState.lookupError || dialogState.lookupMessage ? '' : ' hidden'}>${escapeHtml(dialogState.lookupError || dialogState.lookupMessage || '')}</p>
        </section>`}
        <div class="ig-planner-link-warning">
          <strong>No Intelligent Golf entry will be edited or deleted</strong>
          <span>Future Event Playbook updates will be sent to the newly selected planner entry. ${escapeHtml(diaryWarning)}</span>
        </div>
        <div class="ig-planner-match-error" role="alert"${dialogState.error ? '' : ' hidden'}>${escapeHtml(dialogState.error || '')}</div>
      </div>
      <div class="modal-actions">
        <button class="button button-secondary" type="button" data-close-ig-planner-link>Cancel</button>
        <span></span>
        ${dialogState.error && !dialogState.loading ? '<button class="button button-secondary" type="button" data-retry-ig-planner-link>Try loading again</button>' : ''}
        <button class="button button-primary" type="button" data-confirm-ig-planner-link${selectedAlternative ? '' : ' disabled'}>Change linked event</button>
      </div>
    </dialog>`;
  }

  function showIntelligentGolfPlannerLinkDialog() {
    requestAnimationFrame(() => {
      const dialog = document.getElementById('ig-planner-link-dialog');
      const otherDialog = document.querySelector('dialog[open]');
      if (!dialog || (otherDialog && otherDialog !== dialog)) return;
      if (!dialog.open) dialog.showModal();
      dialog.querySelector('input[name="ig-planner-link-candidate"]:checked')?.focus();
    });
  }

  function restoreIntelligentGolfPlannerLinkFocus() {
    if (!intelligentGolfPlannerLinkShouldRestoreFocus) return;
    intelligentGolfPlannerLinkShouldRestoreFocus = false;
    requestAnimationFrame(() => {
      const target = document.querySelector('[data-action="change-ig-planner-link"]:not([disabled])') ??
        document.querySelector('[data-action="manage-event-status"]');
      target?.focus();
    });
  }

  function closeIntelligentGolfPlannerLinkDialog(dialog, restoreFocus = true) {
    intelligentGolfPlannerLinkRequest = null;
    intelligentGolfPlannerLinkDialogState = null;
    dialog?.close();
    if (restoreFocus) restoreIntelligentGolfPlannerLinkFocus();
  }

  async function openIntelligentGolfPlannerLinkDialog(trigger = null) {
    const event = getActiveEvent();
    const status = event ? intelligentGolfEventStatuses.get(event.id) : null;
    if (!event || !pluginCapabilities.intelligentGolfEnabled || !status?.linked || !status.available) return false;
    if (trigger?.matches?.('[data-action="change-ig-planner-link"]')) {
      intelligentGolfPlannerLinkShouldRestoreFocus = true;
    }

    const requestToken = {};
    let candidatesLoaded = false;
    intelligentGolfPlannerLinkRequest = requestToken;
    intelligentGolfPlannerLinkDialogState = {
      eventId: event.id,
      eventDate: event.eventDate,
      currentPlannerEntryId: status.plannerEntryId,
      candidates: [],
      selectedPlannerEntryId: status.plannerEntryId,
      lookupEntryId: '',
      lookupLoading: false,
      lookupMessage: '',
      lookupError: '',
      loading: true,
      error: ''
    };
    render();
    showIntelligentGolfPlannerLinkDialog();

    try {
      const response = await fetch(`/api/integrations/intelligent-golf/events/${encodeURIComponent(event.id)}/planner-candidates`, {
        method: 'GET',
        cache: 'no-store'
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.detail || result.error || result.title || `Planner entries could not be loaded (${response.status}).`);
      }
      if (intelligentGolfPlannerLinkRequest !== requestToken) return false;

      const loaded = normaliseIntelligentGolfPlannerCandidates(result, status.plannerEntryId);
      if (!loaded.currentPlannerEntryId) throw new Error('The current Intelligent Golf planner link could not be confirmed.');
      intelligentGolfPlannerLinkDialogState = {
        eventId: event.id,
        eventDate: loaded.eventDate || event.eventDate,
        currentPlannerEntryId: loaded.currentPlannerEntryId,
        candidates: loaded.candidates,
        currentPlannerEntryDiscovered: loaded.currentPlannerEntryDiscovered,
        selectedPlannerEntryId: loaded.currentPlannerEntryId,
        lookupEntryId: '',
        lookupLoading: false,
        lookupMessage: '',
        lookupError: '',
        loading: false,
        error: ''
      };
      candidatesLoaded = true;
    } catch (error) {
      if (intelligentGolfPlannerLinkRequest !== requestToken) return false;
      intelligentGolfPlannerLinkDialogState = {
        ...intelligentGolfPlannerLinkDialogState,
        loading: false,
        error: error.message || 'The Intelligent Golf planner entries could not be loaded.'
      };
    } finally {
      if (intelligentGolfPlannerLinkRequest === requestToken) intelligentGolfPlannerLinkRequest = null;
    }

    render();
    showIntelligentGolfPlannerLinkDialog();
    return candidatesLoaded;
  }

  async function lookupIntelligentGolfPlannerEntry(dialog) {
    const eventId = dialog?.dataset.plannerLinkEventId;
    const entryInput = dialog?.querySelector('#ig-planner-entry-id');
    const intelligentGolfEventId = Number(entryInput?.value) || 0;
    if (!eventId || !intelligentGolfPlannerLinkDialogState || intelligentGolfEventId <= 0 ||
        !Number.isInteger(intelligentGolfEventId)) {
      if (intelligentGolfPlannerLinkDialogState) {
        intelligentGolfPlannerLinkDialogState.lookupEntryId = entryInput?.value ?? '';
        intelligentGolfPlannerLinkDialogState.lookupMessage = '';
        intelligentGolfPlannerLinkDialogState.lookupError = 'Enter a valid Intelligent Golf planner entry ID.';
        render();
        showIntelligentGolfPlannerLinkDialog();
      }
      return false;
    }

    const requestToken = {};
    intelligentGolfPlannerLinkRequest = requestToken;
    intelligentGolfPlannerLinkDialogState = {
      ...intelligentGolfPlannerLinkDialogState,
      lookupEntryId: String(intelligentGolfEventId),
      lookupLoading: true,
      lookupMessage: '',
      lookupError: ''
    };
    render();
    showIntelligentGolfPlannerLinkDialog();

    try {
      const response = await fetch(`/api/integrations/intelligent-golf/events/${encodeURIComponent(eventId)}/planner-entry/${intelligentGolfEventId}`, {
        method: 'GET',
        cache: 'no-store'
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.detail || result.error || result.title || `Planner entry ${intelligentGolfEventId} could not be checked (${response.status}).`);
      }
      if (intelligentGolfPlannerLinkRequest !== requestToken ||
          intelligentGolfPlannerLinkDialogState?.eventId !== eventId) return false;

      const value = result.candidate ?? result;
      const verifiedId = Number(value?.intelligentGolfEventId) || 0;
      if (verifiedId !== intelligentGolfEventId) {
        throw new Error(`Intelligent Golf returned planner entry ${verifiedId || 'without an ID'}, not ${intelligentGolfEventId}.`);
      }
      const candidate = {
        intelligentGolfEventId: verifiedId,
        name: String(value?.name ?? '').trim() || `Planner entry ${verifiedId}`,
        current: value?.current === true || verifiedId === Number(intelligentGolfPlannerLinkDialogState.currentPlannerEntryId),
        linkedToAnotherPlaybookEvent: value?.linkedToAnotherPlaybookEvent === true
      };
      const candidates = intelligentGolfPlannerLinkDialogState.candidates
        .filter(existing => existing.intelligentGolfEventId !== verifiedId);
      candidates.push(candidate);
      candidates.sort((left, right) => left.intelligentGolfEventId - right.intelligentGolfEventId);
      const available = !candidate.current && !candidate.linkedToAnotherPlaybookEvent;
      intelligentGolfPlannerLinkDialogState = {
        ...intelligentGolfPlannerLinkDialogState,
        candidates,
        selectedPlannerEntryId: available
          ? candidate.intelligentGolfEventId
          : intelligentGolfPlannerLinkDialogState.currentPlannerEntryId,
        lookupLoading: false,
        lookupMessage: candidate.current
          ? `Planner entry ${verifiedId} is already the current link.`
          : candidate.linkedToAnotherPlaybookEvent
            ? `Planner entry ${verifiedId} belongs to another Event Playbook event and cannot be selected.`
            : `Verified ${candidate.name} on this event date. It is ready to select.`,
        lookupError: ''
      };
      return available;
    } catch (error) {
      if (intelligentGolfPlannerLinkRequest !== requestToken ||
          intelligentGolfPlannerLinkDialogState?.eventId !== eventId) return false;
      intelligentGolfPlannerLinkDialogState = {
        ...intelligentGolfPlannerLinkDialogState,
        lookupLoading: false,
        lookupMessage: '',
        lookupError: error.message || `Planner entry ${intelligentGolfEventId} could not be verified.`
      };
      return false;
    } finally {
      if (intelligentGolfPlannerLinkRequest === requestToken) intelligentGolfPlannerLinkRequest = null;
      if (intelligentGolfPlannerLinkDialogState?.eventId === eventId) {
        render();
        showIntelligentGolfPlannerLinkDialog();
      }
    }
  }

  async function saveIntelligentGolfPlannerLink(dialog) {
    const eventId = dialog?.dataset.plannerLinkEventId;
    const expectedIntelligentGolfEventId = Number(dialog?.dataset.currentPlannerEntryId) || 0;
    const selected = dialog?.querySelector('input[name="ig-planner-link-candidate"]:checked:not(:disabled)');
    const intelligentGolfEventId = Number(selected?.value) || 0;
    if (!eventId || !expectedIntelligentGolfEventId || !intelligentGolfEventId ||
        intelligentGolfEventId === expectedIntelligentGolfEventId) return;

    const errorBox = dialog.querySelector('.ig-planner-match-error');
    if (errorBox) {
      errorBox.hidden = true;
      errorBox.textContent = '';
    }
    dialog.setAttribute('aria-busy', 'true');
    const controls = [...dialog.querySelectorAll('button, input')];
    controls.forEach(element => {
      element.dataset.igPlannerLinkWasDisabled = element.disabled ? 'true' : 'false';
      element.disabled = true;
    });
    const confirmButton = dialog.querySelector('[data-confirm-ig-planner-link]');
    const originalLabel = confirmButton?.textContent ?? 'Change linked event';
    if (confirmButton) confirmButton.textContent = 'Changing link…';

    try {
      const response = await fetch(`/api/integrations/intelligent-golf/events/${encodeURIComponent(eventId)}/planner-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedIntelligentGolfEventId, intelligentGolfEventId })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(result.detail || result.error || result.title || `The planner link could not be changed (${response.status}).`);
        error.result = result;
        throw error;
      }

      intelligentGolfResolutionNotices.set(eventId, {
        tone: 'success',
        message: result.message || `Intelligent Golf planner entry ${intelligentGolfEventId} is now linked.`
      });
      intelligentGolfPlannerLinkDialogState = null;
      dialog.close();
      intelligentGolfEventStatuses.delete(eventId);
      await ensureIntelligentGolfEventStatus(eventId, true);
      render();
      restoreIntelligentGolfPlannerLinkFocus();
    } catch (error) {
      if (error.result?.refreshStatus === true) {
        intelligentGolfResolutionNotices.set(eventId, {
          tone: 'error',
          message: error.message || 'The Intelligent Golf planner link changed while you were deciding. Review its current status and try again.'
        });
        intelligentGolfPlannerLinkDialogState = null;
        dialog.close();
        intelligentGolfEventStatuses.delete(eventId);
        await ensureIntelligentGolfEventStatus(eventId, true);
        render();
        restoreIntelligentGolfPlannerLinkFocus();
        return;
      }
      if (error.result?.refreshCandidates === true) {
        const refreshMessage = error.message || 'The Intelligent Golf planner entries changed while you were deciding.';
        closeIntelligentGolfPlannerLinkDialog(dialog, false);
        const candidatesRefreshed = await openIntelligentGolfPlannerLinkDialog();
        if (intelligentGolfPlannerLinkDialogState?.eventId === eventId) {
          if (candidatesRefreshed) {
            intelligentGolfPlannerLinkDialogState.error = `${refreshMessage} The available entries have been refreshed.`;
            render();
            showIntelligentGolfPlannerLinkDialog();
          } else if (!intelligentGolfPlannerLinkDialogState.error) {
            intelligentGolfPlannerLinkDialogState.error = refreshMessage;
            render();
            showIntelligentGolfPlannerLinkDialog();
          }
        }
        return;
      }
      if (intelligentGolfPlannerLinkDialogState?.eventId === eventId) {
        intelligentGolfPlannerLinkDialogState.error = error.message || 'The planner link could not be changed.';
      }
      if (errorBox) {
        errorBox.hidden = false;
        errorBox.textContent = error.message || 'The planner link could not be changed.';
      }
      dialog.removeAttribute('aria-busy');
      controls.forEach(element => {
        element.disabled = element.dataset.igPlannerLinkWasDisabled === 'true';
        delete element.dataset.igPlannerLinkWasDisabled;
      });
      if (confirmButton) {
        confirmButton.textContent = originalLabel;
        const currentSelection = dialog.querySelector('input[name="ig-planner-link-candidate"]:checked:not(:disabled)');
        confirmButton.disabled = !currentSelection || Number(currentSelection.value) === expectedIntelligentGolfEventId;
      }
    }
  }

  function maybeOpenIntelligentGolfPlannerMatch(event) {
    if (!event) return;
    const status = intelligentGolfEventStatuses.get(event.id);
    const signature = intelligentGolfMatchSignature(event.id, status);
    if (!signature || deferredIntelligentGolfMatches.has(signature)) return;
    requestAnimationFrame(() => {
      const dialog = document.getElementById('ig-planner-match-dialog');
      if (!dialog || dialog.open || document.querySelector('dialog[open]')) return;
      dialog.showModal();
      dialog.querySelector('input[name="ig-planner-match-candidate"]:checked')?.focus();
    });
  }

  function deferIntelligentGolfPlannerMatch(dialog) {
    const signature = dialog?.dataset.matchSignature;
    if (signature) deferredIntelligentGolfMatches.add(signature);
    dialog?.close();
  }

  async function resolveIntelligentGolfPlannerMatch(dialog, action) {
    const eventId = dialog?.dataset.eventId;
    if (!eventId || !['adopt', 'create-new'].includes(action)) return;
    const selected = dialog.querySelector('input[name="ig-planner-match-candidate"]:checked');
    if (action === 'adopt' && !selected) return;

    const errorBox = dialog.querySelector('.ig-planner-match-error');
    if (errorBox) {
      errorBox.hidden = true;
      errorBox.textContent = '';
    }
    dialog.setAttribute('aria-busy', 'true');
    dialog.querySelectorAll('button, input').forEach(element => {
      element.dataset.igMatchWasDisabled = element.disabled ? 'true' : 'false';
      element.disabled = true;
    });
    try {
      const response = await fetch(`/api/integrations/intelligent-golf/events/${encodeURIComponent(eventId)}/planner-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, intelligentGolfEventId: action === 'adopt' ? Number(selected.value) : null })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(result.detail || result.error || result.title || `The planner choice could not be saved (${response.status}).`);
        error.result = result;
        throw error;
      }

      intelligentGolfResolutionNotices.set(eventId, { tone: 'success', message: result.message || 'The Intelligent Golf planner event is now linked.' });
      deferredIntelligentGolfMatches.delete(dialog.dataset.matchSignature);
      dialog.close();
      intelligentGolfEventStatuses.delete(eventId);
      await ensureIntelligentGolfEventStatus(eventId, true);
      render();
    } catch (error) {
      if ((Array.isArray(error.result?.candidates) && error.result.candidates.length > 0) ||
          error.result?.refreshMatch === true) {
        intelligentGolfResolutionNotices.set(eventId, { tone: 'error', message: 'The planner entries changed while you were deciding. Review the refreshed choices.' });
        deferredIntelligentGolfMatches.delete(dialog.dataset.matchSignature);
        dialog.close();
        intelligentGolfEventStatuses.delete(eventId);
        await ensureIntelligentGolfEventStatus(eventId, true);
        render();
        return;
      }
      if (error.result?.matchCleared === true) {
        intelligentGolfResolutionNotices.set(eventId, {
          tone: 'error',
          message: `${error.message || 'The selected planner entry is no longer available.'} Save an event detail to run the same-day check again.`
        });
        deferredIntelligentGolfMatches.delete(dialog.dataset.matchSignature);
        dialog.close();
        intelligentGolfEventStatuses.delete(eventId);
        await ensureIntelligentGolfEventStatus(eventId, true);
        render();
        return;
      }
      if (errorBox) {
        errorBox.hidden = false;
        errorBox.textContent = error.message || 'The planner choice could not be saved.';
      }
      dialog.removeAttribute('aria-busy');
      dialog.querySelectorAll('button, input').forEach(element => {
        element.disabled = element.dataset.igMatchWasDisabled === 'true';
        delete element.dataset.igMatchWasDisabled;
      });
      const availableSelected = dialog.querySelector('input[name="ig-planner-match-candidate"]:checked:not(:disabled)');
      const adoptButton = dialog.querySelector('[data-resolve-ig-planner-match="adopt"]');
      if (adoptButton) adoptButton.disabled = !availableSelected;
    }
  }

  function render() {
    if (!playbook) {
      app.innerHTML = '<div class="loading">Loading playbook…</div>';
      return;
    }

    if (ADMIN_VIEWS.has(state.activeView) && !accessSession.isAdmin) {
      state.activeView = 'dashboard';
      saveState();
    }

    let event = getActiveEvent();
    if (!event && !['dashboard', 'catalogue', 'references', 'admin', 'plugins', 'directory'].includes(state.activeView)) {
      state.activeView = 'dashboard';
      saveState();
    }

    if (event) {
      normaliseAnswers(event);
      normaliseMilestoneDates(event);
      if (state.activeView === 'cancellation' && normaliseEventLifecycle(event).status !== 'cancelled') {
        state.activeView = 'module:start';
      }
    }
    saveState();

    const activeModules = event ? playbook.modules.filter(module => isModuleActive(module, event)) : [];
    const tasks = event ? getActiveTasks(event) : [];
    const actionableTasks = tasks.filter(task => !task.expired);
    const doneTasks = actionableTasks.filter(task => task.state.completed).length;
    const questionProgress = event ? getOverallQuestionProgress(event) : { total: 0, answered: 0, percent: 0 };
    const intelligentGolfStatus = event ? intelligentGolfEventStatuses.get(event.id) : null;

    const currentModuleId = state.activeView.startsWith('module:')
      ? state.activeView.substring('module:'.length)
      : null;
    if (event && currentModuleId && !activeModules.some(module => module.id === currentModuleId)) {
      state.activeView = 'module:start';
      saveState();
    }

    const isPlanningView = state.activeView.startsWith('module:');
    const shellTitle = state.activeView === 'dashboard' ? 'My Dashboard'
      : state.activeView === 'tasks' ? 'Task Board'
      : state.activeView === 'finances' ? 'Event Finances'
      : state.activeView === 'briefing' ? 'Briefing Summary'
      : state.activeView === 'catalogue' ? 'Event Catalogue'
      : state.activeView === 'artwork' ? 'Communications Centre'
      : state.activeView === 'cancellation' ? 'Cancellation Control'
      : state.activeView === 'directory' ? 'People & Roles'
      : state.activeView === 'references' ? 'Image Library'
      : state.activeView === 'admin' ? 'Playbook Administration'
      : state.activeView === 'plugins' ? 'Plugin Administration'
      : state.activeView === 'retrospective' ? 'Event Retrospective'
      : 'Event Playbook';
    const shellIntro = state.activeView === 'dashboard' ? 'See the work that needs your attention across every active event, in one calm daily view.'
      : state.activeView === 'tasks' ? 'See every action generated by the playbook, who owns it, when it is due and what needs attention.'
      : state.activeView === 'finances' ? 'Track estimated and actual income and costs so the club can see whether this event is likely to make a profit, break even or make a loss.'
      : state.activeView === 'briefing' ? 'Read the latest event and staff briefings compiled from the description, planning answers and operational work.'
      : state.activeView === 'catalogue' ? 'Review previous events, clone successful plans and reuse the knowledge captured from earlier events.'
      : state.activeView === 'artwork' ? 'Create a campaign from three AI concepts or adapt an existing supplied design into matching artwork for screens, member communications and print.'
      : state.activeView === 'cancellation' ? 'Review every recorded publication and commitment, then coordinate the actions needed to withdraw or correct them.'
      : state.activeView === 'directory' ? 'Maintain the people, shared mailboxes, responsibilities and platform access used throughout every event.'
      : state.activeView === 'references' ? `Maintain reusable images of the clubhouse, course, trophies and interiors so Communications Centre artwork can look recognisably like ${clubBranding.clubName}.`
      : state.activeView === 'admin' ? 'Configure the questions, tasks, ownership rules and advisories that make up the club event planning process.'
      : state.activeView === 'plugins' ? 'Securely configure the external services that connect the Event Playbook to the rest of the club’s systems.'
      : state.activeView === 'retrospective' ? 'Release the member feedback form, review what went well, what did not, and turn the evidence into guidance for next time.'
      : 'Plan the event consistently from first decision to final close-down, with every relevant question, responsibility and deadline in one place.';
    const showEventEditor = Boolean(event) && state.activeView === 'module:start';
    const showEventTools = Boolean(event) && (isPlanningView || state.activeView === 'tasks' || state.activeView === 'retrospective');
    const showLifecycleBanner = Boolean(event) && (isPlanningView || ['tasks', 'finances', 'briefing', 'artwork', 'cancellation', 'retrospective'].includes(state.activeView));
    const lifecycle = event ? normaliseEventLifecycle(event) : null;
    const lifecycleDefinition = event ? eventStatusDefinition(event) : null;

    app.innerHTML = `
      <div class="app-shell">
        <aside class="sidebar">
          <a class="club-brand" href="/" aria-label="${escapeHtml(clubBranding.clubName)} Event Playbook">
            <img src="${escapeHtml(clubBranding.crestUrl)}" alt="${escapeHtml(clubBranding.clubName)} crest">
            <span>
              <strong>${escapeHtml(clubBranding.clubName)}</strong>
              <small>Event Playbook</small>
            </span>
          </a>

          <nav class="side-nav" aria-label="Event Playbook">
            <button class="${state.activeView === 'dashboard' ? 'active' : ''}" data-view="dashboard"><span class="nav-icon">⌂</span>My Dashboard</button>
            <button class="${state.activeView === 'catalogue' ? 'active' : ''}" data-view="catalogue"><span class="nav-icon">▦</span>Event Catalogue</button>
            <span class="side-nav-group-label">Current event workspace</span>
            <button class="${isPlanningView ? 'active' : ''}" data-view="module:start" ${event ? '' : 'disabled'}><span class="nav-icon">◇</span>Event Planner</button>
            <button class="${state.activeView === 'briefing' ? 'active' : ''}" data-view="briefing" ${event ? '' : 'disabled'}><span class="nav-icon">☷</span>Briefing Summary</button>
            <button class="${state.activeView === 'tasks' ? 'active' : ''}" data-view="tasks" ${event ? '' : 'disabled'}><span class="nav-icon">✓</span>Task Board</button>
            <button class="${state.activeView === 'finances' ? 'active' : ''}" data-view="finances" ${event ? '' : 'disabled'}><span class="nav-icon">£</span>Event Finances</button>
            <button class="${state.activeView === 'artwork' ? 'active' : ''}" data-view="artwork" ${event ? '' : 'disabled'}><span class="nav-icon">✦</span>Communications Centre</button>
            ${lifecycle?.status === 'cancelled' ? `<button class="cancellation-nav ${state.activeView === 'cancellation' ? 'active' : ''}" data-view="cancellation"><span class="nav-icon">!</span>Cancellation Control</button>` : ''}
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
            <small class="sidebar-resource-subheading">Administration</small>
            ${accessSession.isAdmin ? `
              <button class="admin-resource-link ${state.activeView === 'admin' ? 'active' : ''}" data-view="admin">
                <span class="nav-icon">⚙</span>
                <span><strong>Playbook Administration</strong><small>Questions, tasks & planning rules</small></span>
              </button>
              <button class="admin-resource-link ${state.activeView === 'plugins' ? 'active' : ''}" data-view="plugins">
                <span class="nav-icon">⌘</span>
                <span><strong>Plugin Administration</strong><small>Connected club services</small></span>
              </button>
              <div class="sidebar-admin-session">
                <span><i></i>Administrator signed in</span>
                <form action="/auth/logout" method="post"><button type="submit">Sign out</button></form>
              </div>` : `
              <a class="admin-resource-link locked" href="${adminLoginUrl('admin')}">
                <span class="nav-icon">⚙</span>
                <span><strong>Playbook Administration</strong><small>${accessSession.administratorLoginConfigured ? 'Administrator sign-in required' : 'Administrator login not configured'}</small></span>
              </a>
              <a class="admin-resource-link locked" href="${adminLoginUrl('plugins')}">
                <span class="nav-icon">⌘</span>
                <span><strong>Plugin Administration</strong><small>${accessSession.administratorLoginConfigured ? 'Administrator sign-in required' : 'Administrator login not configured'}</small></span>
              </a>`}
          </nav>

          <div class="sidebar-footer">
            ${event ? `<div class="sidebar-progress-copy">
                <strong>${questionProgress.percent}% planned</strong>
                <small>${doneTasks} of ${actionableTasks.length} actionable tasks complete</small>
              </div>
              <div class="progress-track"><div class="progress-fill" style="width:${questionProgress.percent}%"></div></div>`
              : '<div class="sidebar-progress-copy"><strong>No event selected</strong><small>Choose one from the catalogue</small></div>'}
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
                  <div class="hero-event-context-actions">
                    ${pluginCapabilities.intelligentGolfEnabled && intelligentGolfStatus?.linked
                      ? `<button type="button" data-action="change-ig-planner-link"${intelligentGolfStatus.available ? '' : ' disabled title="The Intelligent Golf connection is not currently available."'}>Change linked planner event</button>`
                      : ''}
                    <button type="button" data-action="manage-event-status">Manage status</button>
                    <button type="button" data-view="catalogue">Change event</button>
                  </div>
                </section>`
                : state.activeView === 'dashboard' ? `<section class="hero-event-context empty" aria-label="Global workspace">
                    <div class="hero-event-context-copy"><span>Global workspace</span><strong>No event workspace selected</strong><small>Your dashboard still includes assigned work from every active event.</small></div>
                    <button type="button" data-view="catalogue">Browse events</button>
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
                <label><span>Event date</span><input type="date" required value="${escapeHtml(event.eventDate)}" data-event-field="eventDate"></label>
                ${pluginCapabilities.intelligentGolfEnabled ? `<label><span>IG event type</span><select data-event-field="intelligentGolfEventTypeId">${renderIntelligentGolfEventTypeOptions(event.intelligentGolfEventTypeId)}</select></label>` : ''}
                <label><span>Expected attendees</span><input type="number" min="0" step="1" value="${escapeHtml(event.expectedAttendees)}" data-event-field="expectedAttendees"></label>
                <label><span>Start time</span><input type="time" value="${escapeHtml(event.startTime)}" data-event-field="startTime"></label>
                <label><span>End time</span><input type="time" value="${escapeHtml(event.endTime)}" data-event-field="endTime"></label>
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
            ${event ? renderIntelligentGolfPlannerMatchBanner(event) : ''}
            ${showLifecycleBanner ? renderEventLifecycleBanner(event) : ''}
            ${state.activeView === 'dashboard' ? renderDashboard() : state.activeView === 'catalogue' ? renderCatalogue() : state.activeView === 'directory' ? renderDirectory() : state.activeView === 'references' ? renderReferenceLibrary() : state.activeView === 'plugins' ? renderPluginAdministration() : state.activeView === 'admin' ? renderAdmin() : !event ? renderEmptyState() : state.activeView === 'tasks' ? renderTaskBoard(event, tasks) : state.activeView === 'finances' ? renderEventFinances(event) : state.activeView === 'briefing' ? renderBriefing(event) : state.activeView === 'artwork' ? renderArtworkStudio(event) : state.activeView === 'cancellation' ? renderCancellationWorkspace(event) : state.activeView === 'retrospective' ? renderRetrospective(event) : renderModuleView(event)}
          </main>
        </main>
      </div>

      ${renderNewEventDialog()}
      <dialog id="event-summary-dialog" class="modal event-summary-dialog"><div id="event-summary-content"></div></dialog>
      ${renderTaskNoteDialog()}
      ${renderEventStatusDialog(event)}
      ${renderIntelligentGolfPlannerMatchDialog(event)}
      ${renderIntelligentGolfPlannerLinkDialog(event)}
      ${renderPluginDialogs()}
    `;

    bindEvents();
    mountPendingPlaybookTemplateNotice();
    focusTaskBoardDeepLink();
    if (state.activeView === 'admin' && accessSession.isAdmin) {
      import('./playbook-assistant.js?v=20260919-playbook-assistant-1')
        .then(module => module.mountPlaybookAssistant({
          revision: playbookTemplateRevision,
          schemaVersion: playbook.schemaVersion,
          protectedQuestionIds: [...protectedQuestionIds],
          onApplied: result => applyPlaybookTemplateDocument(result.document),
          onReset: document => applyPlaybookTemplateDocument(document)
        }))
        .catch(error => {
          const host = document.getElementById('playbook-assistant-root');
          if (host) host.innerHTML = `<div class="playbook-assistant-load-error"><strong>Playbook Assistant could not start.</strong><span>${escapeHtml(error.message || 'The module could not be loaded.')}</span></div>`;
        });
    }
    if (state.activeView === 'plugins') {
      ensurePluginSettingsLoaded();
      ensureIntegrationActivityLoaded();
    }
    if (state.activeView === 'retrospective' && event) ensureFeedbackLoaded(event.id);
    if (state.activeView === 'briefing' && event) ensureEventBriefing(event);
    if (state.activeView === 'cancellation' && event && lifecycle?.status === 'cancelled') {
      import('./cancellation-app.js?v=20260918-cancellation-1')
        .then(module => module.mountCancellationWorkspace({
          eventId: event.id,
          eventName: event.name,
          eventDate: event.eventDate,
          answers: structuredClone(event.answers ?? {}),
          lifecycle: structuredClone(lifecycle),
          responseState: structuredClone(event.cancellationResponse ?? null),
          yodeckEnabled: pluginCapabilities.yodeckEnabled,
          intelligentGolfEnabled: pluginCapabilities.intelligentGolfEnabled,
          onManageStatus: () => openEventStatusDialog(event.id),
          onStateChange: response => {
            const target = state.events.find(candidate => candidate.id === event.id);
            if (!target) return;
            target.cancellationResponse = response;
            saveState();
          }
        }))
        .catch(error => {
          const workspace = document.getElementById('cancellationWorkspace');
          if (workspace) workspace.innerHTML = `<div class="cancellation-page-error"><strong>Cancellation Control could not start.</strong><span>${escapeHtml(error.message || 'The module could not be loaded.')}</span></div>`;
        });
    }
    if (event && pluginCapabilities.intelligentGolfEnabled) {
      ensureIntelligentGolfEventStatus(event.id);
      maybeOpenIntelligentGolfPlannerMatch(event);
    }
    if (state.activeView === 'artwork' && event) {
      import('./poster-app.js?v=20260916-admission-context-1')
        .then(module => module.mountPosterStudio({
          eventId: event.id,
          eventName: event.name,
          eventDate: event.eventDate,
          description: event.description,
          startTime: event.startTime,
          endTime: event.endTime,
          eventTypeId: event.intelligentGolfEventTypeId,
          expectedAttendees: event.expectedAttendees,
          planningContext: buildCommunicationsPlanningContext(event),
          cataloguePosterGenerationId: event.cataloguePosterGenerationId,
          referenceLibrary: loadReferenceLibrary(),
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
              target.cataloguePosterGenerationId = artworkInfo.generationId ?? null;
              target.cataloguePosterThumbnailMode = 'cover';
              target.posterUpdatedAt = artworkInfo.generatedAt ?? new Date().toISOString();
              saveState();
            }
          },
          onSquareArtworkReady: (thumbnailDataUrl, artworkInfo = {}) => {
            const target = state.events.find(item => item.id === event.id);
            if (!target || !thumbnailDataUrl) return;
            target.cataloguePosterThumbnail = thumbnailDataUrl;
            target.cataloguePosterSourceIsSquare = true;
            target.cataloguePosterGenerationId = artworkInfo.generationId ?? null;
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
            target.publishedCataloguePosterGenerationId = artworkInfo.generationId ?? null;
            target.publishedCataloguePosterThumbnailMode = 'cover';
            target.posterPublishedAt = new Date().toISOString();
            saveState();
          }
        }))
        .catch(error => console.error('Unable to initialise Communications Centre', error));
    }
  }

  function loadLegacyReferenceLibrary() {
    try {
      const raw = localStorage.getItem(REFERENCE_LIBRARY_STORAGE);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function loadReferenceLibrary() {
    if (Array.isArray(state.referenceLibrary)) return state.referenceLibrary;
    state.referenceLibrary = loadLegacyReferenceLibrary();
    return state.referenceLibrary;
  }

  function saveReferenceLibrary(items) {
    state.referenceLibrary = Array.isArray(items) ? items : [];
    try {
      localStorage.setItem(REFERENCE_LIBRARY_STORAGE, JSON.stringify(state.referenceLibrary));
    } catch (error) {
      console.warn('The Image Library is too large for the browser cache. Saving it to shared server storage instead.', error);
    }
    saveState();
  }

  function parseReferenceTags(value) {
    return String(value ?? '').split(',').map(item => item.trim()).filter(Boolean);
  }

  function buildLocalReferenceProfile(metadata) {
    const signals = [metadata.title, metadata.category, ...(metadata.tags ?? [])]
      .map(value => String(value ?? '').trim())
      .filter(Boolean);
    return {
      schemaVersion: 1,
      matchingInstruction: `Select this image only when the event brief explicitly or semantically calls for ${metadata.title} (${metadata.category}): ${metadata.description}`,
      positiveSignals: [...new Set(signals)],
      namedEntities: metadata.title ? [metadata.title] : [],
      negativeSignals: ['Do not select it solely because the event involves golf, the club, the clubhouse or a poster.'],
      mode: 'browser-fallback',
      model: 'browser-fallback',
      generatedAt: new Date().toISOString()
    };
  }

  async function compileReferenceProfile(metadata) {
    try {
      const response = await fetch('/api/poster/reference-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metadata)
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.matchingInstruction) {
        throw new Error(result?.error ?? `Reference analysis failed (${response.status}).`);
      }
      return result;
    } catch (error) {
      console.warn('Unable to compile the image matching profile with the server. Using a local profile.', error);
      return buildLocalReferenceProfile(metadata);
    }
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
              <p class="panel-copy">Upload real images of the clubhouse, interiors, trophies, course and other distinctive club details. Describe what each image shows and the Communications Centre will use that information to choose the most relevant images automatically.</p>
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
                 <label class="field field-span-2"><span>Description</span><textarea id="reference-library-description" rows="6" placeholder="For example: Main clubhouse frontage viewed from the 18th green, including the patio and white-trimmed windows. Use when the clubhouse is visible in outdoor scenes." required></textarea><small>This metadata is compiled into a reusable AI matching rule whenever the reference is saved.</small></label>
                <label class="field field-span-2 inline-check"><input id="reference-library-active" type="checkbox" checked><span>Active for automatic selection</span></label>
              </div>
              <div class="reference-form-actions">
                <button class="button button-primary" type="submit" data-reference-save>Save and analyse reference</button>
                <button class="button button-secondary" type="button" data-action="reference-form-reset">Clear form</button>
              </div>
            </form>
          </section>

          <section class="panel reference-library-list-panel">
            <div class="panel-heading compact">
              <div>
                <p class="section-kicker">Library contents</p>
                <h2>Available images</h2>
                <p class="panel-copy">The Communications Centre can select these images automatically and pass the best matches to the image generator together with the organiser brief.</p>
              </div>
            </div>
            ${references.length === 0 ? '<div class="reference-library-empty">No images have been added yet.</div>' : `<div class="reference-library-grid">${references.map(renderReferenceCard).join('')}</div>`}
          </section>
        </div>
      </section>`;
  }

  function renderReferenceCard(reference) {
    const tags = Array.isArray(reference.tags) ? reference.tags : [];
    const profile = reference.relevanceProfile;
    const profileReady = Boolean(profile?.matchingInstruction);
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
          <div class="reference-profile-status ${profileReady ? 'ready' : 'missing'}">
            <strong>${profileReady ? 'Matching profile ready' : 'Matching profile required'}</strong>
            <small>${profileReady ? escapeHtml(profile.matchingInstruction) : 'Edit and save this image once to compile its semantic relevance rule.'}</small>
          </div>
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
        <p>The catalogue is the starting point for the Event Playbook. Create a new event here, then move into the planner, task board and Communications Centre when you are ready.</p>
        <button class="button button-primary" data-action="new-event">Create new event</button>
      </section>`;
  }

  function renderEventListItem(event) {
    const tasks = getActiveTasks(event);
    const open = tasks.filter(task => !task.state.completed && !task.expired).length;
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

  function renderCancellationWorkspace(event) {
    const lifecycle = normaliseEventLifecycle(event);
    if (lifecycle.status !== 'cancelled') return renderModuleView(event);
    return '<div id="cancellationWorkspace" class="cancellation-workspace" aria-live="polite"><section class="cancellation-loading"><span></span><div><strong>Preparing Cancellation Control…</strong><p>Checking actual publication and integration records.</p></div></section></div>';
  }

  function renderArtworkStudio(event) {
    const retainedArtworkThumbnail = event.publishedCataloguePosterThumbnail || event.cataloguePosterThumbnail || '';
    return `
      <section class="workflow-strip" aria-label="Poster creation workflow">
        <div class="workflow-step active" data-step="1"><span>1</span><strong>Brief</strong><small>Event & style</small></div>
        <div class="workflow-line"></div>
        <div class="workflow-step" data-step="2"><span>2</span><strong>Choose concept</strong><small>3 draft ideas</small></div>
        <div class="workflow-line"></div>
        <div class="workflow-step" data-step="3"><span>3</span><strong>Produce</strong><small>Master & formats</small></div>
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
          <div id="posterStyleField" class="field"><span>Poster style</span><div id="styleOptions" class="style-options"></div><small id="posterStyleHelp">Choose the visual direction for AI-created concepts.</small></div>
          <div class="poster-content-box">
            <div><p class="section-kicker">Poster content</p><h3>What should be added to the finished artwork?</h3></div>
            <div class="toggle-grid">
              <label class="check-card selected" id="dateCard"><input id="includeDate" type="checkbox" checked><span class="check-mark">✓</span><span><strong>Event date</strong><small>Use the selected event date</small></span></label>
              <label class="check-card" id="priceCard"><input id="includePrice" type="checkbox"><span class="check-mark">✓</span><span><strong>Price</strong><small>Add a price badge</small></span></label>
              <label class="check-card" id="brandingCard"><input id="includeClubBranding" type="checkbox"><span class="check-mark">✓</span><span><strong>Club logo</strong><small>External promotion only</small></span></label>
            </div>
            <label id="priceField" class="field hidden"><span>Price to display</span><input id="price" type="text" placeholder="£12.50"></label>
          </div>
          <label class="field"><span id="additionalInstructionsLabel">Additional creative instructions <em>optional</em></span><textarea id="additionalInstructions" rows="4" placeholder="For example: show the player attempting a ridiculous shot over mature trees towards a distant green."></textarea><small id="additionalInstructionsHelp">These instructions refine the creative brief used for AI-generated concepts.</small></label>
          <div id="supportingUploadBox" class="supporting-upload-box">
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
          <div class="campaign-start-actions">
            <button id="generateButton" class="button button-primary button-large" type="button"><span>✦</span> Generate 3 preview concepts</button>
            <button id="uploadDesignButton" class="button button-secondary button-large" type="button"><span>↥</span> Upload design</button>
            <input id="sourceDesignInput" type="file" accept="image/png,image/jpeg,image/webp" hidden>
          </div>
          <p class="campaign-start-help">Already have artwork from an entertainer or supplier? Upload it as the fixed visual source. The studio will preserve its style and only apply your specific instructions while creating the three campaign formats.</p>
          <div id="sourceDesignUploadError" class="source-design-upload-error hidden" role="alert"></div>
          <section id="sourceDesignPanel" class="source-design-panel hidden" aria-live="polite">
            <img id="sourceDesignPreview" class="source-design-preview" alt="Uploaded source design">
            <div class="source-design-details">
              <span class="source-design-badge">Authoritative design</span>
              <strong id="sourceDesignName">Uploaded poster</strong>
              <small id="sourceDesignMetadata"></small>
              <p>The original is the sole visual reference. Style presets, supporting uploads and Image Library references are not used in this workflow.</p>
              <div id="sourceDesignMessage" class="source-design-message" role="status"></div>
              <div class="source-design-actions">
                <button id="produceSourceDesignButton" class="button button-primary" type="button">Create 3 campaign formats</button>
                <button id="replaceSourceDesignButton" class="button button-secondary" type="button">Replace</button>
                <button id="removeSourceDesignButton" class="text-button" type="button">Remove</button>
              </div>
            </div>
          </section>
        </section>

        <div class="campaign-column">
          <aside class="panel campaign-panel">
            <div class="panel-heading compact"><div><p class="section-kicker">Campaign preview</p><h2 id="campaignTitle">${escapeHtml(event.name || 'No artwork generated')}</h2></div><span id="campaignStatus" class="status-pill neutral">Not started</span></div>
            <div id="emptyState" class="empty-state">${retainedArtworkThumbnail
              ? `<div class="saved-catalogue-art"><img src="${escapeHtml(retainedArtworkThumbnail)}" alt="Previously generated campaign artwork for ${escapeHtml(event.name)}"></div><span class="status-pill ready">Saved with this event</span><h3>Previously generated campaign</h3><p>This older catalogue preview is connected to the event, but it may have been cropped into a square. Generate the campaign again once to retain uncropped full-size formats and the studio settings here.</p>`
              : `<div class="empty-art"><img src="${escapeHtml(clubBranding.crestUrl)}" alt="${escapeHtml(clubBranding.clubName)} crest"><span class="spark spark-one">✦</span><span class="spark spark-two">✦</span></div><h3>Your event campaign will appear here</h3><p>Start with three AI concepts, or upload an existing design and retain its visual style while the studio creates all three campaign formats.</p>`}</div>
            <div id="generationProgress" class="generation-progress hidden">
              <div class="progress-row" data-progress="concepts"><span class="progress-icon">1</span><div><strong>Low-resolution concepts</strong><small>Three distinct digital-screen ideas, saved as each one finishes</small></div><span class="progress-state">Waiting</span></div>
              <div class="progress-row" data-progress="primary"><span class="progress-icon">2</span><div><strong>High-resolution master artwork</strong><small>Rebuilding the selected concept with exact copy and polished detail</small></div><span class="progress-state">Waiting</span></div>
              <div class="progress-row" data-progress="variants"><span class="progress-icon">3</span><div><strong>Reference-led format adaptations</strong><small>Recomposing the approved master for each selected dimension</small></div><span class="progress-state">Waiting</span></div>
              <div class="progress-row" data-progress="compose"><span class="progress-icon">4</span><div><strong>Final output preparation</strong><small>Sizing each AI-designed finished poster for its delivery format</small></div><span class="progress-state">Waiting</span></div>
              <div class="generation-controls">
                <small id="generationElapsed">High-quality artwork can take several minutes.</small>
                <button id="cancelGenerationButton" class="button button-secondary hidden" type="button">Cancel generation</button>
              </div>
            </div>
          </aside>
          <section id="conceptSelectionPanel" class="panel concept-selection-panel hidden">
            <div class="panel-heading compact"><div><p class="section-kicker">Choose the campaign idea</p><h2>Low-resolution concepts</h2><p class="panel-copy">These previews are for choosing the strongest composition and visual direction. The selected idea will be rebuilt at high resolution with exact event copy.</p></div><span id="conceptPreviewCount" class="status-pill neutral">0 of 3 ready</span></div>
            <div id="conceptResults" class="concept-grid"></div>
            <div class="concept-selection-actions">
              <p id="conceptSelectionMessage">Select the idea you want to take forward.</p>
              <div><button id="generateMoreConceptsButton" class="button button-secondary" type="button">Generate 3 new ideas</button><button id="produceSelectedConceptButton" class="button button-primary button-large" type="button" disabled>Produce selected concept</button></div>
            </div>
          </section>
          <section id="generatedArtworkPanel" class="panel generated-artwork-panel hidden">
            <div class="panel-heading compact"><div><p class="section-kicker">Generated artwork</p><h2>Campaign assets</h2><p class="panel-copy">Each finished poster appears here immediately, without waiting for the rest of the campaign to finish generating.</p></div><span id="generatedArtworkCount" class="status-pill neutral">0 ready</span></div>
            <div id="posterResults" class="poster-results"></div>
            <div id="refinementPanel" class="refinement-panel hidden"><div><p class="section-kicker">Not quite right?</p><h3>Explore three refined ideas</h3><p>Describe what worked and what should change. The studio will create three new low-resolution concepts before any high-resolution formats are replaced.</p></div><textarea id="refinementNotes" rows="4" placeholder="For example: I like the composition but the golfer feels too serious. Make it funnier and show more of the strange route across the course."></textarea><button id="regenerateButton" class="button button-secondary" type="button">Create 3 refined concepts</button></div>
          </section>
        </div>
      </div>

      <section id="sharePanel" class="panel publish-panel share-panel hidden">
        <div class="panel-heading"><div><p class="section-kicker">Share</p><h2>Share the approved campaign</h2><p class="panel-copy">Choose where the event should be communicated. Each channel has its own settings and can be used independently.</p></div></div>
        <div class="share-actions">
          ${pluginCapabilities.yodeckEnabled ? `<article class="share-action-card">
            <span class="share-action-icon">▣</span>
            <div><h3>Clubhouse screens</h3><p>Choose when the digital-screen artwork should appear around the clubhouse.</p><span id="shareScreensStatus" class="share-action-status hidden"></span></div>
            <div class="share-action-buttons">
              <button id="shareScreensButton" class="button button-gold" type="button">Send to clubhouse screens</button>
              <button id="takeDownScreensButton" class="button button-secondary hidden" type="button">Take down</button>
            </div>
          </article>` : ''}
          <article id="shareEmailCard" class="share-action-card">
            <span class="share-action-icon">✉</span>
            <div><h3>Members</h3><p>Draft an email, choose active membership categories and send a test before contacting members.</p><span id="shareEmailStatus" class="share-action-status hidden"></span></div>
            <button id="shareEmailButton" class="button button-gold" type="button">Email to members</button>
          </article>
          <article class="share-action-card">
            <span class="share-action-icon">▤</span>
            <div><h3>Print</h3><p>Print the approved campaign as an A3, A4 or A5 portrait poster.</p></div>
            <button id="sharePrintButton" class="button button-gold" type="button">Print</button>
          </article>
          <article id="shareDiaryCard" class="share-action-card">
            <span class="share-action-icon">◫</span>
            <div><h3>Member diary</h3><p>Advertise the event in the club diary used by members and the member app.</p><span id="shareDiaryStatus" class="share-action-status hidden"></span></div>
            <button id="shareDiaryButton" class="button button-gold" type="button">Add to member diary</button>
          </article>
        </div>
        <div id="shareMessage" class="publish-message share-message" role="status">This campaign has not been shared yet.</div>
      </section>

      ${pluginCapabilities.yodeckEnabled ? `<dialog id="posterPublishDialog" class="poster-publish-dialog">
        <form id="posterPublishForm">
          <div class="poster-publish-heading">
            <div><p class="eyebrow">Share artwork</p><h2>Send to clubhouse screens</h2><p>Choose how the digital-screen artwork should be identified and when it should appear.</p></div>
            <button id="closePosterPublishDialog" class="icon-button" type="button" aria-label="Close clubhouse screen sharing dialog">×</button>
          </div>
          <div class="poster-publish-body">
            <aside class="poster-publish-preview"><img id="posterPublishPreview" alt="Artwork selected for the clubhouse screens"><span>Clubhouse Digital Display</span><small>Full-resolution PNG delivery file</small></aside>
            <div class="poster-publish-fields">
              <div id="yodeckConnectionStatus" class="yodeck-connection-status checking"><span></span><div><strong>Checking the clubhouse screen connection…</strong><small>The connection is managed securely by Event Playbook.</small></div></div>
              <label class="field"><span>Artwork name</span><input id="yodeckMediaName" type="text" maxlength="180" required><small>This is how the artwork will be identified in the screen library.</small></label>
              <label class="field"><span>Tags</span><input id="yodeckTags" type="text" placeholder="event-playbook, clubhouse-screens, event-name"><small>Separate tags with commas. Event Playbook is always added automatically.</small></label>
              <div class="poster-publish-date-grid">
                <label class="field"><span>Start showing</span><input id="yodeckStartDate" type="date" required><small>Yodeck makes the uploaded file available from this local calendar date.</small></label>
                <label class="field"><span>Stop showing</span><input id="yodeckEndDate" type="date" readonly><small>Fixed to the end of the selected event date in Yodeck.</small></label>
              </div>
              <div class="yodeck-playlist-summary"><span>Destination</span><strong id="yodeckPlaylistName">Clubhouse screens</strong><small>The artwork is added to the existing screen rotation without replacing anything already there.</small></div>
              <div id="posterPublishDialogMessage" class="poster-publish-dialog-message" role="status"></div>
            </div>
          </div>
          <div class="poster-publish-actions"><button id="cancelPosterPublish" class="button button-secondary" type="button">Cancel</button><button id="confirmPosterPublish" class="button button-gold button-large" type="submit">Send to clubhouse screens</button></div>
        </form>
      </dialog>` : ''}

      <dialog id="memberEmailDialog" class="poster-publish-dialog member-email-dialog">
        <form id="memberEmailForm">
          <div class="poster-publish-heading">
            <div><p class="eyebrow">Member communications</p><h2>Email this campaign to members</h2><p>Review the AI-assisted message, choose its audience and send yourself a test before delivery.</p></div>
            <button id="closeMemberEmailDialog" class="icon-button" type="button" aria-label="Close member email dialog">×</button>
          </div>
          <div class="poster-publish-body member-email-body">
            <aside class="poster-publish-preview email-preview"><img id="memberEmailArtworkPreview" alt="Campaign artwork selected for the member email"><span id="memberEmailArtworkName">Campaign artwork</span><small>Square artwork is preferred when available</small></aside>
            <div class="poster-publish-fields member-email-fields">
              <div id="memberEmailConnectionStatus" class="yodeck-connection-status checking"><span></span><div><strong>Checking the member email connection…</strong><small>The connection is managed securely by Event Playbook.</small></div></div>
              <div class="member-email-section-heading"><div><strong>Email message</strong><small>Generated from the selected event and editable before sending.</small></div><button id="generateMemberEmail" class="button button-secondary" type="button">Generate email with AI</button></div>
              <label class="field"><span>Subject</span><input id="memberEmailSubject" type="text" maxlength="250" required></label>
              <label class="field"><span>HTML email body</span><textarea id="memberEmailBody" rows="12" maxlength="200000" required spellcheck="true"></textarea><small>You can edit the generated HTML. Use Preview to check the finished message.</small></label>
              <details class="member-email-preview-panel"><summary>Preview email</summary><iframe id="memberEmailBodyPreview" title="Member email preview" sandbox></iframe></details>
              <section class="member-email-audience">
                <div class="member-email-section-heading"><div><strong>Recipients</strong><small>Only active members with an email address are included.</small></div><button id="loadMemberEmailAudience" class="button button-secondary" type="button">Retrieve active members</button></div>
                <div class="member-email-audience-modes">
                  <label><input type="radio" name="memberEmailAudienceMode" value="all" checked> <span>All active members</span></label>
                  <label><input type="radio" name="memberEmailAudienceMode" value="categories"> <span>Selected membership categories</span></label>
                </div>
                <div id="memberEmailCategories" class="member-email-categories hidden"></div>
                <div id="memberEmailAudienceSummary" class="member-email-audience-summary">Retrieve the current member list to choose recipients.</div>
              </section>
              <div class="member-email-test-row"><label class="field"><span>Send a test to</span><input id="memberEmailTestAddress" type="email" maxlength="320" placeholder="name@example.com"></label><button id="sendMemberEmailTest" class="button button-secondary" type="button">Send test</button></div>
              <div id="memberEmailDialogMessage" class="poster-publish-dialog-message" role="status"></div>
            </div>
          </div>
          <div class="poster-publish-actions"><button id="cancelMemberEmail" class="button button-secondary" type="button">Cancel</button><button id="confirmMemberEmail" class="button button-gold button-large" type="submit" disabled>Send email to members</button></div>
        </form>
      </dialog>

      <dialog id="posterPrintDialog" class="poster-publish-dialog poster-print-dialog">
        <form id="posterPrintForm">
          <div class="poster-publish-heading">
            <div><p class="eyebrow">Print artwork</p><h2>Print the approved poster</h2><p>Choose the finished paper size. The same approved A-series layout is printed without cropping.</p></div>
            <button id="closePosterPrintDialog" class="icon-button" type="button" aria-label="Close print dialog">×</button>
          </div>
          <div class="poster-publish-body">
            <aside class="poster-publish-preview print-preview"><img id="posterPrintPreview" alt="Approved campaign artwork ready to print"><span>Approved print artwork</span><small id="posterPrintPreviewSize">A4 campaign layout</small></aside>
            <div class="poster-publish-fields">
              <fieldset class="print-size-fieldset">
                <legend>Paper size</legend>
                <div class="print-size-options">
                  <label class="print-size-option"><input type="radio" name="posterPrintSize" value="A3"><span><strong>A3</strong><small>297 × 420 mm</small></span></label>
                  <label class="print-size-option selected"><input type="radio" name="posterPrintSize" value="A4" checked><span><strong>A4</strong><small>210 × 297 mm</small></span></label>
                  <label class="print-size-option"><input type="radio" name="posterPrintSize" value="A5"><span><strong>A5</strong><small>148 × 210 mm</small></span></label>
                </div>
              </fieldset>
              <div class="print-guidance"><strong>Print-ready campaign</strong><p>The browser print window will open with the selected physical page size, no margins and the approved artwork scaled proportionally to fit.</p></div>
              <div id="posterPrintDialogMessage" class="poster-publish-dialog-message" role="status"></div>
            </div>
          </div>
          <div class="poster-publish-actions"><button id="cancelPosterPrint" class="button button-secondary" type="button">Cancel</button><button id="confirmPosterPrint" class="button button-gold button-large" type="submit">Print A4</button></div>
        </form>
      </dialog>

      <dialog id="memberDiaryDialog" class="poster-publish-dialog member-diary-dialog">
        <form id="memberDiaryForm">
          <div class="poster-publish-heading">
            <div><p class="eyebrow">Member communications</p><h2>Add to member diary</h2><p>Review the member-facing details before advertising this event in the club diary.</p></div>
            <button id="closeMemberDiaryDialog" class="icon-button" type="button" aria-label="Close member diary dialog">×</button>
          </div>
          <div class="poster-publish-body">
            <aside class="poster-publish-preview diary-preview"><img id="memberDiaryPreview" alt="Campaign artwork for the member diary"><span>Member diary artwork</span><small>Square artwork is preferred when available</small></aside>
            <div class="poster-publish-fields">
              <div id="memberDiaryConnectionStatus" class="yodeck-connection-status checking"><span></span><div><strong>Checking the member diary connection…</strong><small>The connection is managed securely by Event Playbook.</small></div></div>
              <div class="member-email-section-heading"><div><strong>Diary entry</strong><small>Generated from the event details and editable before publishing.</small></div><button id="generateMemberDiary" class="button button-secondary" type="button">Generate diary entry with AI</button></div>
              <label class="field"><span>Diary title</span><input id="memberDiaryTitle" type="text" maxlength="180" required></label>
              <div class="poster-publish-date-grid diary-date-grid">
                <label class="field"><span>Event date</span><input id="memberDiaryDate" type="date" readonly required></label>
                <label class="field"><span>Start time <em>optional</em></span><input id="memberDiaryStartTime" type="time"></label>
                <label class="field"><span>End time <em>optional</em></span><input id="memberDiaryEndTime" type="time"></label>
              </div>
              <label class="field"><span>HTML diary body</span><textarea id="memberDiaryDescription" rows="12" maxlength="200000" required spellcheck="true"></textarea><small>You can edit the generated HTML before it is published.</small></label>
              <details class="member-email-preview-panel"><summary>Preview diary entry</summary><iframe id="memberDiaryBodyPreview" title="Member diary entry preview" sandbox></iframe></details>
              <label class="field"><span>Booking or information link <em>optional</em></span><input id="memberDiaryBookingUrl" type="url" maxlength="1000" placeholder="https://"></label>
              <div id="memberDiaryDialogMessage" class="poster-publish-dialog-message" role="status"></div>
            </div>
          </div>
          <div class="poster-publish-actions"><button id="cancelMemberDiary" class="button button-secondary" type="button">Cancel</button><button id="confirmMemberDiary" class="button button-gold button-large" type="submit">Add to member diary</button></div>
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

  function financeEntryAmount(entry) {
    if (entry?.calculation === 'tickets' || entry?.calculation === 'staffing') {
      return Math.max(0, Number(entry.quantity) || 0) * Math.max(0, Number(entry.unitAmount) || 0);
    }
    return Math.max(0, Number(entry?.totalAmount) || 0);
  }

  function financeTotals(event) {
    const entries = normaliseEventFinances(event).entries;
    const total = (direction, status = '') => entries
      .filter(entry => entry.direction === direction && (!status || entry.status === status))
      .reduce((sum, entry) => sum + financeEntryAmount(entry), 0);
    const income = total('income');
    const expenses = total('expense');
    const actualIncome = total('income', 'actual');
    const actualExpenses = total('expense', 'actual');
    return {
      income,
      expenses,
      net: income - expenses,
      actualIncome,
      actualExpenses,
      actualNet: actualIncome - actualExpenses,
      actualCount: entries.filter(entry => entry.status === 'actual').length,
      count: entries.length
    };
  }

  function formatMoney(value) {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(value) || 0);
  }

  function financeResult(value) {
    const amount = Number(value) || 0;
    if (Math.abs(amount) < 0.005) return { label: 'Break even', tone: 'neutral' };
    return amount > 0
      ? { label: 'Projected profit', tone: 'profit' }
      : { label: 'Projected loss', tone: 'loss' };
  }

  function financeCategoryOptions(direction, selected = '') {
    return (FINANCE_CATEGORIES[direction] ?? FINANCE_CATEGORIES.income)
      .map(category => `<option value="${escapeHtml(category)}" ${category === selected ? 'selected' : ''}>${escapeHtml(category)}</option>`)
      .join('');
  }

  function renderFinanceEntry(entry) {
    const amount = financeEntryAmount(entry);
    const calculation = FINANCE_CALCULATIONS[entry.calculation] ?? FINANCE_CALCULATIONS.total;
    const isCalculated = entry.calculation !== 'total';
    return `
      <article class="finance-ledger-entry ${entry.direction} ${entry.status}" data-finance-entry="${escapeHtml(entry.id)}">
        <div class="finance-ledger-mark" aria-hidden="true">${entry.direction === 'income' ? '+' : '−'}</div>
        <div class="finance-ledger-body">
          <div class="finance-entry-heading">
            <div><span>${escapeHtml(entry.category)}</span><strong>${escapeHtml(entry.description || 'Untitled entry')}</strong></div>
            <div class="finance-entry-total"><small>${entry.status === 'actual' ? 'Actual' : 'Estimate'}</small><strong>${escapeHtml(formatMoney(amount))}</strong></div>
          </div>
          <div class="finance-entry-fields">
            <label><span>Type</span><select data-finance-field="direction"><option value="income" ${entry.direction === 'income' ? 'selected' : ''}>Income</option><option value="expense" ${entry.direction === 'expense' ? 'selected' : ''}>Expense</option></select></label>
            <label><span>Category</span><select data-finance-field="category">${financeCategoryOptions(entry.direction, entry.category)}</select></label>
            <label class="finance-field-wide"><span>Description</span><input type="text" data-finance-field="description" value="${escapeHtml(entry.description)}" placeholder="What is this figure for?"></label>
            <label><span>Figure type</span><select data-finance-field="status"><option value="estimate" ${entry.status === 'estimate' ? 'selected' : ''}>Estimate</option><option value="actual" ${entry.status === 'actual' ? 'selected' : ''}>Actual</option></select></label>
            <label><span>Calculation</span><select data-finance-field="calculation">${Object.entries(FINANCE_CALCULATIONS).map(([id, definition]) => `<option value="${escapeHtml(id)}" ${entry.calculation === id ? 'selected' : ''}>${escapeHtml(definition.label)}</option>`).join('')}</select></label>
            ${isCalculated ? `
              <label><span>${escapeHtml(calculation.quantityLabel)}</span><input type="number" min="0" step="0.01" data-finance-field="quantity" value="${escapeHtml(entry.quantity)}"></label>
              <label><span>${escapeHtml(calculation.unitLabel)}</span><span class="money-input"><i>£</i><input type="number" min="0" step="0.01" data-finance-field="unitAmount" value="${escapeHtml(entry.unitAmount)}"></span></label>`
              : `<label><span>Total amount</span><span class="money-input"><i>£</i><input type="number" min="0" step="0.01" data-finance-field="totalAmount" value="${escapeHtml(entry.totalAmount)}"></span></label>`}
            <label class="finance-field-wide"><span>Notes <em>optional</em></span><input type="text" data-finance-field="notes" value="${escapeHtml(entry.notes)}" placeholder="Source, assumptions or anything still to confirm"></label>
          </div>
        </div>
        <button class="finance-delete-entry" type="button" data-delete-finance-entry="${escapeHtml(entry.id)}" aria-label="Delete ${escapeHtml(entry.description || entry.category)}">×</button>
      </article>`;
  }

  function renderEventFinances(event) {
    const finance = normaliseEventFinances(event);
    const totals = financeTotals(event);
    const result = financeResult(totals.net);
    const actualResult = financeResult(totals.actualNet);
    const previous = finance.priorEventSummary;
    return `
      <section class="finance-intro">
        <div><span class="eyebrow">Event profit and loss</span><h2>Is this event paying its way?</h2><p>Start with sensible estimates, then replace them with actual figures as ticket sales, supplier invoices and takings become known.</p></div>
        <span class="finance-entry-count">${totals.count}<small>ledger entr${totals.count === 1 ? 'y' : 'ies'}</small></span>
      </section>
      ${previous ? `<aside class="finance-prior-summary"><span>Previous event</span><strong>${escapeHtml(formatMoney(previous.net))}</strong><small>${previous.net > 0 ? 'profit' : previous.net < 0 ? 'loss' : 'break even'} from ${previous.count} recorded figure${previous.count === 1 ? '' : 's'} — use this as context, not as a current-event entry.</small></aside>` : ''}
      <section class="finance-summary-grid" aria-label="Event financial summary">
        <article><span>Expected income</span><strong>${escapeHtml(formatMoney(totals.income))}</strong><small>Best available estimate or actual</small></article>
        <article><span>Expected cost</span><strong>${escapeHtml(formatMoney(totals.expenses))}</strong><small>Including additional staffing</small></article>
        <article class="finance-result ${result.tone}"><span>${escapeHtml(result.label)}</span><strong>${escapeHtml(formatMoney(totals.net))}</strong><small>Income less costs</small></article>
        <article class="finance-result ${totals.actualCount ? actualResult.tone : 'neutral'}"><span>Actual position</span><strong>${totals.actualCount ? escapeHtml(formatMoney(totals.actualNet)) : '—'}</strong><small>${totals.actualCount ? `${totals.actualCount} actual figure${totals.actualCount === 1 ? '' : 's'} recorded` : 'No actual figures yet'}</small></article>
      </section>
      <section class="finance-workspace">
        <article class="finance-add-panel">
          <div class="section-heading"><div><span class="eyebrow">Add a figure</span><h3>Income or expense</h3></div></div>
          <form id="finance-entry-form">
            <div class="finance-add-grid">
              <label><span>Type</span><select id="finance-direction"><option value="income">Income</option><option value="expense">Expense</option></select></label>
              <label><span>Category</span><select id="finance-category">${financeCategoryOptions('income', 'Ticket sales')}</select></label>
              <label class="finance-field-wide"><span>Description</span><input id="finance-description" type="text" required placeholder="For example, advance ticket sales"></label>
              <label><span>Figure type</span><select id="finance-status"><option value="estimate">Estimate</option><option value="actual">Actual</option></select></label>
              <label><span>Calculation</span><select id="finance-calculation">${Object.entries(FINANCE_CALCULATIONS).map(([id, definition]) => `<option value="${escapeHtml(id)}">${escapeHtml(definition.label)}</option>`).join('')}</select></label>
              <label id="finance-total-field"><span>Total amount</span><span class="money-input"><i>£</i><input id="finance-total-amount" type="number" min="0" step="0.01" value="0"></span></label>
              <label id="finance-quantity-field" hidden><span id="finance-quantity-label">Quantity</span><input id="finance-quantity" type="number" min="0" step="0.01" value="0"></label>
              <label id="finance-unit-field" hidden><span id="finance-unit-label">Unit amount</span><span class="money-input"><i>£</i><input id="finance-unit-amount" type="number" min="0" step="0.01" value="0"></span></label>
              <label class="finance-field-wide"><span>Notes <em>optional</em></span><input id="finance-notes" type="text" placeholder="Source or assumptions behind the figure"></label>
            </div>
            <button class="button button-primary" type="submit">Add to event P&amp;L</button>
          </form>
        </article>
        <section class="finance-ledger-panel">
          <div class="finance-ledger-heading"><div><span class="eyebrow">Working P&amp;L</span><h3>Event ledger</h3></div><small>Change an estimate to actual when the final figure is known.</small></div>
          <div class="finance-ledger-list">
            ${finance.entries.length ? finance.entries.map(renderFinanceEntry).join('') : `<div class="finance-empty"><span>£</span><h3>No figures recorded yet</h3><p>Add ticket income, expected bar sales, supplier costs or additional staffing to build the first event forecast.</p></div>`}
          </div>
        </section>
      </section>`;
  }

  function eventStatusDefinition(event) {
    normaliseEventLifecycle(event);
    return EVENT_STATUS_DEFINITIONS[event.lifecycle.status] ?? EVENT_STATUS_DEFINITIONS.provisional;
  }

  function eventStatusNotificationTargets(event) {
    const selectedAreas = Array.isArray(getQuestionValue('event-affected-areas', event))
      ? getQuestionValue('event-affected-areas', event)
      : [];
    const recipientsByEmail = new Map();
    const missingEmail = [];

    for (const definition of EVENT_STATUS_RECIPIENT_DEFINITIONS) {
      if (!selectedAreas.includes(definition.value)) continue;
      const answerReference = definition.ownerQuestionId
        ? assignmentReference(getQuestionValue(definition.ownerQuestionId, event))
        : null;
      const reference = answerReference ?? { kind: 'role', id: definition.roleId };
      const recipient = assignmentRecipient(reference, event);
      const name = recipient.name || assignmentDisplay(reference) || definition.label;
      const email = String(recipient.email ?? '').trim().toLocaleLowerCase();

      if (!email) {
        missingEmail.push({ name, area: definition.label });
        continue;
      }

      const existing = recipientsByEmail.get(email) ?? { name, email, areas: [] };
      if (!existing.name && name) existing.name = name;
      if (!existing.areas.includes(definition.label)) existing.areas.push(definition.label);
      recipientsByEmail.set(email, existing);
    }

    return {
      recipients: [...recipientsByEmail.values()],
      missingEmail
    };
  }

  function createEventStatusNotification(event, status, changedAt) {
    const targets = eventStatusNotificationTargets(event);
    return {
      id: crypto.randomUUID(),
      status,
      statusChangedAt: changedAt,
      recipients: structuredClone(targets.recipients),
      missingEmail: structuredClone(targets.missingEmail),
      targetSignature: eventStatusNotificationTargetSignature(targets),
      deliveryStatus: targets.recipients.length ? 'pending' : targets.missingEmail.length ? 'no-email' : 'not-required',
      requestedRecipientCount: targets.recipients.length,
      sentRecipientCount: 0,
      alreadySentRecipientCount: 0,
      pendingRecipientCount: targets.recipients.length,
      attemptedAt: null,
      completedAt: null,
      error: ''
    };
  }

  function eventStatusNotificationTargetsChanged(event, notification) {
    if (!event || !notification || notification.deliveryStatus === 'legacy-recorded') return false;
    return eventStatusNotificationTargetSignature(eventStatusNotificationTargets(event)) !== notification.targetSignature;
  }

  function eventStatusNotificationFeedback(notification, targetsChanged = false) {
    if (!notification) return '';
    const sent = Number(notification.sentRecipientCount || 0) + Number(notification.alreadySentRecipientCount || 0);
    const pending = Number(notification.pendingRecipientCount || 0);
    const missing = Array.isArray(notification.missingEmail) ? notification.missingEmail.length : 0;
    if (notification.deliveryStatus === 'legacy-recorded') {
      return 'This decision was recorded before operational status emails were introduced. It will not be sent retrospectively.';
    }
    if (notification.deliveryStatus === 'expired') {
      return 'The event date has passed, so this old operational update will not be sent.';
    }
    if (targetsChanged) {
      return 'The affected leads or their email details have changed since this status was last processed. Retry the update so the current recipients are recorded and any newly added people are emailed.';
    }
    if (notification.deliveryStatus === 'not-required') {
      return 'The decision is recorded. No operational teams were selected, so no internal status email was required.';
    }
    if (notification.deliveryStatus === 'sending') {
      return `Sending the recorded status to ${notification.requestedRecipientCount} operational lead${notification.requestedRecipientCount === 1 ? '' : 's'}…${missing ? ` ${missing} selected lead${missing === 1 ? ' has' : 's have'} no email address.` : ''}`;
    }
    if (notification.deliveryStatus === 'sent') {
      return `Status update sent to ${sent} operational lead${sent === 1 ? '' : 's'}.${missing ? ` ${missing} selected lead${missing === 1 ? ' has' : 's have'} no email address.` : ''}`;
    }
    if (notification.deliveryStatus === 'no-email') {
      return missing
        ? `The decision is recorded, but ${missing} selected operational lead${missing === 1 ? ' has' : 's have'} no email address. Add the address in People & Roles, then retry.`
        : 'The decision is recorded. No operational teams were selected to receive an update.';
    }
    if (notification.deliveryStatus === 'partial') {
      return `Status update sent to ${sent}; ${pending} recipient${pending === 1 ? '' : 's'} still pending.${missing ? ` ${missing} selected lead${missing === 1 ? ' also has' : 's also have'} no email address.` : ''}`;
    }
    return `The decision is recorded, but its operational update is still pending.${notification.error ? ` ${notification.error}` : ''}${missing ? ` ${missing} selected lead${missing === 1 ? ' has' : 's have'} no email address.` : ''}`;
  }

  function renderEventStatusNotification(notification, event = null) {
    if (!notification) return '';
    const targetsChanged = eventStatusNotificationTargetsChanged(event, notification);
    const retryable = !['sending', 'legacy-recorded', 'expired'].includes(notification.deliveryStatus) &&
      (targetsChanged || ['pending', 'partial', 'failed'].includes(notification.deliveryStatus) ||
        (notification.deliveryStatus === 'no-email' && (notification.missingEmail?.length ?? 0) > 0));
    const tone = !targetsChanged && ['sent', 'legacy-recorded', 'not-required'].includes(notification.deliveryStatus)
      ? 'success'
      : notification.deliveryStatus === 'sending'
        ? 'progress'
        : 'warning';
    return `<div class="event-status-notification ${tone}" role="status">
      <div><strong>Operational status update</strong><span>${escapeHtml(eventStatusNotificationFeedback(notification, targetsChanged))}</span></div>
      ${retryable ? `<button class="button button-secondary" type="button" data-retry-event-status-notification="${escapeHtml(event?.id ?? '')}">Retry update</button>` : ''}
    </div>`;
  }

  async function dispatchEventStatusNotification(event) {
    const lifecycle = normaliseEventLifecycle(event);
    const notification = lifecycle.statusNotification;
    if (!notification) return;
    const targets = eventStatusNotificationTargets(event);
    const targetsChanged = eventStatusNotificationTargetSignature(targets) !== notification.targetSignature;
    if (['sending', 'legacy-recorded'].includes(notification.deliveryStatus) ||
        (['sent', 'not-required'].includes(notification.deliveryStatus) && !targetsChanged)) return;
    if (isValidIsoDate(event.eventDate) && currentClubIsoDate() > event.eventDate) {
      notification.deliveryStatus = 'expired';
      notification.pendingRecipientCount = 0;
      notification.error = '';
      saveState();
      render();
      return;
    }

    notification.recipients = structuredClone(targets.recipients);
    notification.missingEmail = structuredClone(targets.missingEmail);
    notification.targetSignature = eventStatusNotificationTargetSignature(targets);
    notification.requestedRecipientCount = targets.recipients.length;
    notification.pendingRecipientCount = targets.recipients.length;
    notification.error = '';
    if (!targets.recipients.length) {
      notification.deliveryStatus = targets.missingEmail.length ? 'no-email' : 'not-required';
      notification.completedAt = targets.missingEmail.length ? null : new Date().toISOString();
      saveState();
      render();
      return;
    }

    const notificationId = notification.id;
    notification.deliveryStatus = 'sending';
    notification.attemptedAt = new Date().toISOString();
    saveState();
    render();

    try {
      const response = await fetch('/api/events/status-notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notificationId,
          eventId: event.id,
          eventName: event.name,
          eventDate: event.eventDate,
          status: notification.status,
          statusChangedAtUtc: notification.statusChangedAt,
          decisionOwner: lifecycle.decisionOwner,
          reason: lifecycle.reason,
          recipients: targets.recipients
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || result.detail || `The email service returned HTTP ${response.status}.`);
      if (event.lifecycle?.statusNotification?.id !== notificationId) return;

      notification.sentRecipientCount = Number(result.sentRecipientCount || 0);
      notification.alreadySentRecipientCount = Number(result.alreadySentRecipientCount || 0);
      notification.pendingRecipientCount = Number(result.pendingRecipientCount || 0);
      const failures = Array.isArray(result.deliveries)
        ? result.deliveries.filter(delivery => delivery.status === 'pending' && delivery.error).map(delivery => delivery.error)
        : [];
      notification.error = failures[0] || '';
      notification.deliveryStatus = notification.pendingRecipientCount === 0 ? 'sent' :
        notification.sentRecipientCount + notification.alreadySentRecipientCount > 0 ? 'partial' : 'failed';
      if (notification.deliveryStatus === 'sent') notification.completedAt = new Date().toISOString();
    } catch (error) {
      if (event.lifecycle?.statusNotification?.id !== notificationId) return;
      notification.deliveryStatus = 'failed';
      notification.error = error.message || 'The operational update could not be sent.';
    }

    saveState();
    render();
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
        ${renderEventStatusNotification(lifecycle.statusNotification, event)}
        <button class="button button-primary" type="button" data-action="manage-event-status">Manage event status</button>
      </section>`;
  }

  function renderEventStatusDialog(event) {
    if (!event) return '';
    const lifecycle = normaliseEventLifecycle(event);
    const changeStatus = CHANGE_RESPONSE_STATUSES.has(lifecycle.status);
    const reasonRequired = changeStatus || lifecycle.status === 'at-risk';
    const recentHistory = [...lifecycle.history].slice(-5).reverse();
    const notificationTargets = eventStatusNotificationTargets(event);
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
              <section class="event-status-recipient-preview">
                <div><span class="eyebrow">Operational update</span><strong>The recorded decision will be sent as one update to the affected leads</strong><small>This does not create a separate notification task for every department.</small></div>
                <ul>
                  ${notificationTargets.recipients.map(recipient => `<li><span><strong>${escapeHtml(recipient.name || recipient.email)}</strong><small>${escapeHtml(recipient.areas.join(', '))}</small></span><em>Ready</em></li>`).join('')}
                  ${notificationTargets.missingEmail.map(recipient => `<li class="missing"><span><strong>${escapeHtml(recipient.name)}</strong><small>${escapeHtml(recipient.area)}</small></span><em>No email configured</em></li>`).join('')}
                  ${notificationTargets.recipients.length || notificationTargets.missingEmail.length ? '' : '<li class="empty"><span>No affected teams have been selected in Event control.</span></li>'}
                </ul>
              </section>
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
    const visibleItems = section.items.filter(item =>
      isItemVisible(item, event) && (item.type !== 'task' || event.taskState?.[item.id]?.notRelevant !== true));
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
              const decisionTaskVisible = decisionTask && isItemVisible(decisionTask, event) && event.taskState?.[decisionTask.id]?.notRelevant !== true;
              return renderQuestion(item, event) + (decisionTaskVisible ? renderInlineTask(decisionTask, event) : '');
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
    const priorHint = value === undefined &&
      Object.prototype.hasOwnProperty.call(event.clonedAnswerHints ?? {}, item.id)
        ? event.clonedAnswerHints[item.id]
        : undefined;
    const pending = value === 'dont-know';
    const answered = isAnsweredValue(value);
    const notRelevant = isQuestionNotRelevant(event, item.id);
    return `
      <article class="flow-item question-item ${answered ? 'answered' : ''} ${pending ? 'pending-decision' : ''} ${notRelevant ? 'not-relevant' : ''}" data-item-id="${item.id}">
        <div class="flow-rail question-flow-rail">
          <span class="type-badge question-badge">Question</span>
          <span class="question-state-mark">${notRelevant ? '—' : pending ? '…' : answered ? '✓' : '?'}</span>
          <small>${notRelevant ? 'Not relevant' : pending ? 'Pending' : answered ? 'Answered' : 'Decision'}</small>
        </div>
        <div class="flow-body question-flow-body">
          <div class="question-label-row">
            <label>${escapeHtml(item.label)}</label>
            ${item.required === false ? '<span class="optional-label">Optional</span>' : ''}
          </div>
          ${item.helpText ? `<p class="help-text">${escapeHtml(item.helpText)}</p>` : ''}
          ${item.example ? `<p class="question-example"><span>Example</span><strong>${escapeHtml(item.example)}</strong></p>` : ''}
          ${renderPlanningContext(item, event)}
          ${renderDerivedContextForQuestion(item.id, event)}
          ${renderPriorLearning(event, item)}
          ${renderAnswerControl(item, value, priorHint)}
          <div class="optional-question-resolution">
            <span>If this question does not apply to this event, remove it from the outstanding plan.</span>
            <button type="button" class="choice-button not-relevant-choice ${notRelevant ? 'selected' : ''}" data-question-not-relevant="${escapeHtml(item.id)}" aria-pressed="${notRelevant ? 'true' : 'false'}">
              ${notRelevant ? '✓ Not relevant — restore' : 'Not relevant'}
            </button>
          </div>
          ${renderAdvisoriesForQuestion(item.id, event)}
        </div>
      </article>
    `;
  }

  function renderPlanningContext(item, event) {
    const context = item?.planningContext;
    if (!context || !Array.isArray(context.fields)) return '';

    const fields = [];
    for (const field of context.fields) {
      if (field.showWhen && !conditionMatches(field.showWhen, event)) continue;
      const indexed = itemIndex.get(field.questionId);
      const question = indexed?.item;
      if (!question || question.type !== 'question' || !isModuleActive(indexed.module, event) || !isItemVisible(question, event)) continue;

      let value = getQuestionValue(field.questionId, event);
      if (!isAnsweredValue(value) || (value === false && field.includeFalse !== true)) continue;

      const excluded = new Set(Array.isArray(field.excludeValues) ? field.excludeValues : []);
      if (Array.isArray(value)) {
        value = value.filter(candidate => !excluded.has(candidate));
        if (value.length === 0) continue;
      } else if (excluded.has(value)) {
        continue;
      }

      const answer = value === true && field.trueText
        ? field.trueText
        : value === false && field.falseText
          ? field.falseText
          : formatBriefingAnswer(question, value);
      if (!String(answer ?? '').trim()) continue;
      fields.push({
        label: field.label || question.label,
        answer,
        impliesWork: value !== false || field.falseImpliesWork === true
      });
    }

    const conflictsWithNo = fields.some(field => field.impliesWork) && getQuestionValue(item.id, event) === false;
    return `<aside class="planning-context-card ${fields.length ? '' : 'empty'} ${conflictsWithNo ? 'conflict' : ''}">
      <header><span aria-hidden="true">↩</span><div><strong>${escapeHtml(context.title || 'Relevant planning already recorded')}</strong><small>${escapeHtml(context.description || 'This updates automatically from earlier answers.')}</small></div></header>
      ${fields.length
        ? `<dl>${fields.map(field => `<div><dt>${escapeHtml(field.label)}</dt><dd>${escapeHtml(field.answer)}</dd></div>`).join('')}</dl>`
        : `<p>${escapeHtml(context.emptyText || 'No relevant setup has been identified from the current answers yet.')}</p>`}
      ${conflictsWithNo && context.falseAnswerWarning ? `<p class="planning-context-warning">${escapeHtml(context.falseAnswerWarning)}</p>` : ''}
      ${context.footerText ? `<footer>${escapeHtml(context.footerText)}</footer>` : ''}
    </aside>`;
  }

  function renderAnswerControl(item, value, priorHint) {
    const hintMatches = candidate => priorHint !== undefined && (
      candidate === priorHint ||
      (Array.isArray(priorHint) && priorHint.includes(candidate))
    );
    const hintedValue = value ?? priorHint ?? '';
    const hintClass = priorHint !== undefined ? ' prior-answer-hint' : '';
    const hintData = priorHint !== undefined ? ' data-prior-answer-hint="true"' : '';
    switch (item.answerType) {
      case 'yesNo':
        return `
          <div class="choice-group yes-no-group" role="group" aria-label="${escapeHtml(item.label)}">
            <button class="choice-button ${value === true ? 'selected' : ''} ${hintMatches(true) ? 'prior-answer-hint' : ''}" data-question-id="${item.id}" data-answer-json="true">Yes</button>
            <button class="choice-button ${value === false ? 'selected' : ''} ${hintMatches(false) ? 'prior-answer-hint' : ''}" data-question-id="${item.id}" data-answer-json="false">No</button>
            ${item.allowDontKnow ? `<button class="choice-button dont-know-choice ${value === 'dont-know' ? 'selected' : ''} ${hintMatches('dont-know') ? 'prior-answer-hint' : ''}" data-question-id="${item.id}" data-answer-json="${escapeHtml(JSON.stringify('dont-know'))}">Don't know</button>` : ''}
          </div>
        `;
      case 'singleChoice':
        return `
          <div class="choice-group wrap" role="group" aria-label="${escapeHtml(item.label)}">
            ${(item.options ?? []).map(option => `
              <button class="choice-button ${value === option.value ? 'selected' : ''} ${hintMatches(option.value) ? 'prior-answer-hint' : ''}" data-question-id="${item.id}" data-answer-json="${escapeHtml(JSON.stringify(option.value))}">${escapeHtml(option.label)}</button>
            `).join('')}
          </div>
        `;
      case 'multiChoice':
        return `
          <div class="multi-choice-group">
            ${(item.options ?? []).map(option => `
              <label class="check-choice ${hintMatches(option.value) ? 'prior-answer-hint' : ''}">
                <input type="checkbox" data-multi-question-id="${item.id}" value="${escapeHtml(option.value)}" ${Array.isArray(value) && value.includes(option.value) ? 'checked' : ''}>
                <span>${escapeHtml(option.label)}</span>
              </label>
            `).join('')}
          </div>
        `;
      case 'date':
        return `<input class="answer-input${hintClass}" type="date" value="${escapeHtml(hintedValue)}" data-question-input="${item.id}"${hintData}>`;
      case 'number': {
        const min = Number.isFinite(Number(item.min)) ? ` min="${escapeHtml(item.min)}"` : '';
        const max = Number.isFinite(Number(item.max)) ? ` max="${escapeHtml(item.max)}"` : '';
        const step = Number.isFinite(Number(item.step)) ? ` step="${escapeHtml(item.step)}"` : '';
        return `<div class="number-answer-control">
          <input class="answer-input${hintClass}" type="number" value="${escapeHtml(hintedValue)}"${min}${max}${step} data-question-input="${item.id}"${hintData}>
          ${item.unit ? `<span class="number-input-unit">${escapeHtml(item.unit)}</span>` : ''}
        </div>`;
      }
      case 'time':
        return `<input class="answer-input${hintClass}" type="time" value="${escapeHtml(hintedValue)}" data-question-input="${item.id}"${hintData}>`;
      case 'timeRange': {
        const range = value && typeof value === 'object'
          ? value
          : priorHint && typeof priorHint === 'object'
            ? priorHint
            : {};
        return `<div class="time-range-control">
          <label><span>First tee time</span><input class="answer-input${hintClass}" type="time" value="${escapeHtml(range.start ?? '')}" data-time-range-question-id="${item.id}" data-time-range-part="start"${hintData}></label>
          <span class="time-range-separator">to</span>
          <label><span>Last tee time</span><input class="answer-input${hintClass}" type="time" value="${escapeHtml(range.end ?? '')}" data-time-range-question-id="${item.id}" data-time-range-part="end"${hintData}></label>
        </div>`;
      }
      case 'ticketTypes': {
        const rows = Array.isArray(value) && value.length
          ? value
          : [{ name: '', price: '' }];
        return `<div class="ticket-types-answer" data-ticket-types-question="${escapeHtml(item.id)}">
          <div class="ticket-types-heading"><span>Ticket name</span><span>Price</span><span></span></div>
          ${rows.map((entry, index) => `<div class="ticket-type-row">
            <input class="answer-input" type="text" maxlength="120" value="${escapeHtml(entry?.name ?? '')}" placeholder="For example, Member" data-ticket-type-question-id="${escapeHtml(item.id)}" data-ticket-type-index="${index}" data-ticket-type-field="name">
            <div class="ticket-type-price"><span>£</span><input class="answer-input" type="number" min="0" max="10000" step="0.01" value="${escapeHtml(entry?.price ?? '')}" data-ticket-type-question-id="${escapeHtml(item.id)}" data-ticket-type-index="${index}" data-ticket-type-field="price"></div>
            <button type="button" class="icon-button ticket-type-remove" data-ticket-type-remove="${index}" data-ticket-type-remove-question="${escapeHtml(item.id)}" aria-label="Remove ticket type">×</button>
          </div>`).join('')}
          <button type="button" class="button button-secondary ticket-type-add" data-ticket-type-add="${escapeHtml(item.id)}">Add ticket type</button>
        </div>`;
      }
      case 'assignment':
        return renderAssignmentPicker({
          value,
          hint: priorHint,
          mode: item.assignmentMode === 'person' ? 'person' : 'person-or-role',
          questionId: item.id,
          required: item.required !== false
        });
      case 'textarea':
        return `<textarea class="answer-input answer-textarea${hintClass}" rows="${escapeHtml(item.rows ?? 6)}" maxlength="${escapeHtml(item.maxLength ?? 6000)}" data-question-input="${item.id}"${hintData}>${escapeHtml(hintedValue)}</textarea>`;
      case 'text':
      default:
        return `<input class="answer-input${hintClass}" type="text" value="${escapeHtml(hintedValue)}" data-question-input="${item.id}"${hintData}>`;
    }
  }

  function renderTaskWorkspaceAction(item, event) {
    const actions = [];
    if (item.actionType === 'configure-intelligent-golf-tickets') {
      const taskState = ensureTaskState(event, item.id);
      if (taskState.completed === true) return '';
      const review = taskReviewState(item, event);
      const sending = taskState.integrationStatus === 'sending';
      actions.push(`<div class="task-integration-action ${escapeHtml(taskState.integrationStatus ?? '')}">
        <button type="button" class="button button-primary task-workspace-action" data-configure-ig-tickets="${escapeHtml(item.id)}" data-configure-ig-tickets-event-id="${escapeHtml(event.id)}" ${sending || !review?.ready ? 'disabled' : ''}>${sending ? 'Configuring tickets…' : escapeHtml(item.actionLabel || 'Configure tickets in Intelligent Golf')}</button>
        ${taskState.integrationMessage ? `<small>${escapeHtml(taskState.integrationMessage)}</small>` : ''}
      </div>`);
    } else if (item.actionView && item.actionLabel && (item.actionView === 'event-status' || item.actionType === 'manage-event-status')) {
      if (item.completionMode === 'event-status-decision' && eventStatusDecisionIsSatisfied(item, event)) return '';
      actions.push(`<button type="button" class="button button-primary task-workspace-action" data-task-manage-event-status="${escapeHtml(event?.id ?? '')}" data-event-status-prefill="${escapeHtml(item.actionStatus || 'confirmed')}">${escapeHtml(item.actionLabel)}</button>`);
    } else if (item.actionView && item.actionLabel) {
      actions.push(`<button type="button" class="button button-secondary task-workspace-action" data-task-workspace-view="${escapeHtml(item.actionView)}" data-task-workspace-event-id="${escapeHtml(event?.id ?? '')}">${escapeHtml(item.actionLabel)}</button>`);
    }
    if (item.secondaryActionView && item.secondaryActionLabel) {
      actions.push(`<button type="button" class="button button-secondary task-workspace-action" data-task-workspace-view="${escapeHtml(item.secondaryActionView)}" data-task-workspace-event-id="${escapeHtml(event?.id ?? '')}">${escapeHtml(item.secondaryActionLabel)}</button>`);
    }
    return actions.join('');
  }

  async function configureIntelligentGolfTickets(event, item) {
    const taskState = ensureTaskState(event, item.id);
    const review = taskReviewState(item, event);
    if (!review?.ready || taskState.integrationStatus === 'sending') return false;
    taskState.integrationStatus = 'sending';
    taskState.integrationMessage = 'Sending the reviewed settings and ticket types to Intelligent Golf.';
    render();
    try {
      if (!await flushSharedState()) {
        throw new Error('The latest ticket answers could not be saved to the shared event record. Intelligent Golf has not been changed.');
      }
      const response = await fetch(`/api/integrations/intelligent-golf/events/${encodeURIComponent(event.id)}/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || payload.error || payload.title || `Intelligent Golf ticket configuration failed (${response.status}).`);
      }
      delete taskState.reviewCompletionProvenance;
      taskState.completed = true;
      taskState.status = 'completed';
      taskState.completedAt = new Date().toISOString();
      taskState.reviewSignature = review.signature;
      taskState.reviewInvalidatedAt = null;
      taskState.integrationStatus = 'succeeded';
      taskState.integrationMessage = `Configured ${Number(payload.ticketTypeCount) || 0} ticket type${Number(payload.ticketTypeCount) === 1 ? '' : 's'} on Intelligent Golf planner entry ${payload.intelligentGolfEventId || ''}.`.trim();
      saveState();
      invalidateIntelligentGolfEventStatusCache();
      render();
      return true;
    } catch (error) {
      taskState.integrationStatus = 'failed';
      taskState.integrationMessage = error.message || 'The Intelligent Golf tickets could not be configured.';
      saveState();
      render();
      return false;
    }
  }

  function renderTaskStatusDecisionDelivery(item, event) {
    if (item?.completionMode !== 'event-status-decision') return '';
    const taskState = event.taskState?.[item.id] ?? {};
    const expired = isTaskExpired(item, event, taskState);
    const notification = event.lifecycle?.statusNotification;
    if (!notification) {
      return expired
        ? '<div class="task-status-delivery pending"><strong>Decision record expired</strong><span>No decision was recorded before the event cutoff; this task is retained as read-only history.</span></div>'
        : '<div class="task-status-delivery pending"><strong>Decision still needed</strong><span>Use the status action to record the decision and notify the selected operational leads.</span></div>';
    }
    const targetsChanged = eventStatusNotificationTargetsChanged(event, notification);
    const awaitingFinalDecision = item.id === 'resolve-at-risk-event' && event.lifecycle?.status === 'at-risk';
    const retryable = !expired && !['sending', 'legacy-recorded', 'expired'].includes(notification.deliveryStatus) &&
      (targetsChanged || ['pending', 'partial', 'failed'].includes(notification.deliveryStatus) ||
        (notification.deliveryStatus === 'no-email' && (notification.missingEmail?.length ?? 0) > 0));
    const tone = !expired && !targetsChanged && !awaitingFinalDecision &&
      ['sent', 'legacy-recorded', 'not-required'].includes(notification.deliveryStatus) ? 'success' : 'pending';
    const heading = expired
      ? 'Decision notification retained'
      : awaitingFinalDecision
        ? 'At-risk update recorded; final decision still needed'
        : tone === 'success'
          ? 'Decision and notification recorded'
          : 'Decision recorded; notification needs attention';
    return `<div class="task-status-delivery ${tone}">
      <div><strong>${heading}</strong><span>${escapeHtml(eventStatusNotificationFeedback(notification, targetsChanged))}</span></div>
      ${retryable ? `<button type="button" class="button button-secondary" data-retry-event-status-notification="${escapeHtml(event.id)}">Retry update</button>` : ''}
    </div>`;
  }

  function staffBriefingPhaseLabel(item) {
    const labels = {
      'before-event': 'Before guests arrive',
      'event-day': 'During the event',
      'after-event': 'Close-down / afterwards'
    };
    return labels[item?.staffBriefing?.phase] ?? '';
  }

  function renderTaskNoteAction(item, event, taskState = event?.taskState?.[item?.id] ?? {}) {
    const hasNote = Boolean(String(taskState?.notes ?? '').trim());
    const label = hasNote ? 'Edit note' : 'Add note';
    return `<button type="button" class="text-button inline task-note-action ${hasNote ? 'has-note' : ''}" data-task-note-action="${escapeHtml(item.id)}" data-task-note-event-id="${escapeHtml(event.id)}" aria-label="${label} for ${escapeHtml(item.title)}">${hasNote ? '● ' : '+ '}${label}</button>`;
  }

  function renderTaskNotRelevantControl(item, event, taskState = event?.taskState?.[item?.id] ?? {}) {
    const notRelevant = taskState?.notRelevant === true;
    return `<label class="task-not-relevant-control ${notRelevant ? 'selected' : ''}" title="${notRelevant ? 'Return this task to the active plan' : 'Remove this task from the active plan because it does not apply to this event'}">
      <input type="checkbox" data-task-not-relevant="${escapeHtml(item.id)}" data-task-not-relevant-event-id="${escapeHtml(event.id)}" ${notRelevant ? 'checked' : ''}>
      <span aria-hidden="true"></span><small>${notRelevant ? 'Not relevant — restore' : 'Not relevant'}</small>
    </label>`;
  }

  function renderTaskNoteDialog() {
    return `<dialog id="task-note-dialog" class="plugin-dialog task-note-dialog" aria-labelledby="task-note-dialog-title">
      <form id="task-note-form">
        <header class="modal-heading"><div><span class="eyebrow">Shared planning context</span><h2 id="task-note-dialog-title">Task note</h2><p>Record useful event-specific information against this task.</p></div><button class="icon-button" type="button" data-close-task-note-dialog aria-label="Close">×</button></header>
        <div class="plugin-dialog-body">
          <div class="task-note-context"><span id="task-note-area"></span><strong id="task-note-task"></strong><small id="task-note-status"></small></div>
          <label class="wide"><span>Note <em>optional</em></span><textarea id="task-note-text" rows="7" maxlength="2000" placeholder="Record a decision, confirmed arrangement, useful handover detail or information that other people need to know."></textarea><small>Notes form part of the event record, exported task data and briefing source. Open-task notes are treated as unconfirmed unless the wording clearly records a settled decision.</small></label>
          <input id="task-note-event-id" type="hidden"><input id="task-note-task-id" type="hidden">
        </div>
        <footer class="modal-actions"><span></span><button class="button button-secondary" type="button" data-close-task-note-dialog>Cancel</button><button class="button button-primary" type="submit">Save note</button></footer>
      </form>
    </dialog>`;
  }

  function openTaskNoteDialog(trigger) {
    const event = state.events.find(candidate => candidate.id === trigger.dataset.taskNoteEventId);
    const indexed = itemIndex.get(trigger.dataset.taskNoteAction);
    const dialog = document.getElementById('task-note-dialog');
    if (!event || !indexed || indexed.item.type !== 'task' || !dialog) return;
    const taskState = ensureTaskState(event, indexed.item.id);
    const expired = isTaskExpired(indexed.item, event, taskState);
    taskNoteReturnFocus = trigger;
    document.getElementById('task-note-event-id').value = event.id;
    document.getElementById('task-note-task-id').value = indexed.item.id;
    document.getElementById('task-note-area').textContent = `${event.name} · ${indexed.module.title} · ${indexed.section.title}`;
    document.getElementById('task-note-task').textContent = indexed.item.title;
    document.getElementById('task-note-status').textContent = expired
      ? 'Expired task record'
      : taskState.completed ? 'Completed task' : 'Open task';
    document.getElementById('task-note-text').value = String(taskState.notes ?? '');
    dialog.showModal();
    requestAnimationFrame(() => document.getElementById('task-note-text')?.focus());
  }

  function renderInlineTask(item, event) {
    const taskState = event.taskState[item.id] ?? {};
    const dueDate = getDueDate(item.deadlineCode, event);
    const expiresOn = getTaskExpiryDate(item, event);
    const expired = isTaskExpired(item, event, taskState, expiresOn);
    const dueText = expired
      ? `Expired after ${formatDate(expiresOn)}`
      : dueDate ? formatDate(dueDate) : item.deadlineCode ? `Configure ${item.deadlineCode}` : 'No deadline';
    const milestoneLabel = item.deadlineCode ? (MILESTONE_LABELS[item.deadlineCode] ?? item.deadlineCode) : 'No milestone';
    const detail = getTaskDetail(item, event);
    const completionControl = taskCompletionControl(item, event, taskState);
    const ownerInputId = `task-owner-${item.id}`;
    return `
      <article class="flow-item task-item ${taskState.completed ? 'completed' : ''} ${expired ? 'expired' : ''}" data-item-id="${item.id}">
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
              ${renderPriorLearning(event, item)}
            </div>
            ${expired
              ? `<div class="complete-toggle task-expired-control" title="${escapeHtml(completionControl.title)}"><span aria-hidden="true">—</span><small>Expired</small></div>`
              : completionControl.statusManaged
                ? `<div class="complete-toggle task-status-control" title="${escapeHtml(completionControl.title)}"><span aria-hidden="true">${taskState.completed ? '✓' : '!'}</span><small>${escapeHtml(completionControl.label)}</small></div>`
              : `<label class="complete-toggle task-complete-control ${completionControl.blocked ? 'blocked' : ''}" title="${escapeHtml(completionControl.title)}">
                  <input type="checkbox" data-task-complete="${item.id}" ${taskState.completed ? 'checked' : ''} ${completionControl.blocked ? 'disabled' : ''}>
                  <span></span><small>${escapeHtml(completionControl.label)}</small>
                </label>`}
          </div>
          ${renderTaskReviewSummary(item, event, taskState)}
          ${renderTaskStatusDecisionDelivery(item, event)}
          <div class="task-inline-meta">
            ${item.responsibleArea ? `<span class="area-chip">${escapeHtml(item.responsibleArea)}</span>` : ''}
            ${staffBriefingPhaseLabel(item) ? `<span class="staff-duty-chip">Staff duty · ${escapeHtml(staffBriefingPhaseLabel(item))}</span>` : ''}
            ${!expired && !item.reviewSummary ? renderTaskWorkspaceAction(item, event) : ''}
            ${renderTaskNoteAction(item, event, taskState)}
            ${renderTaskNotRelevantControl(item, event, taskState)}
            ${expired
              ? `<div class="assignee-compact task-expired-owner"><span class="assignee-compact-label">Owner at expiry</span><strong>${escapeHtml(taskState.assignee || (item.defaultOwnerRoleId ? roleById(item.defaultOwnerRoleId)?.name : '') || 'Not assigned')}</strong></div>`
              : `<div class="assignee-compact">
                  <label class="assignee-compact-label" for="${escapeHtml(ownerInputId)}">Owner</label>
                  ${renderAssignmentPicker({ value: taskAssignmentReference(taskState) ?? taskState.assignee, fallback: taskState.assignee, eligibleRoleId: item.defaultOwnerRoleId, taskId: item.id, id: ownerInputId, compact: true })}
                </div>`}
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

  function sourceEventsForLearning(event) {
    const result = [];
    const visited = new Set([event.id]);
    let sourceId = event.sourceEventId;
    while (sourceId && !visited.has(sourceId) && result.length < 30) {
      visited.add(sourceId);
      const source = state.events.find(candidate => candidate.id === sourceId);
      if (!source) break;
      result.push(source);
      sourceId = source.sourceEventId;
    }
    return result;
  }

  function priorLearningForItem(event, item) {
    const indexed = itemIndex.get(item.id);
    if (!indexed) return [];
    const results = [];
    for (const source of sourceEventsForLearning(event)) {
      for (const insight of source.learningInsights ?? []) {
        const itemMatch = (insight.targetItemIds ?? []).includes(item.id);
        const sectionMatch = (insight.targetSectionIds ?? []).includes(indexed.section.id);
        const moduleMatch = (insight.targetModuleIds ?? []).includes(indexed.module.id);
        if (!itemMatch && !sectionMatch && !moduleMatch) continue;
        results.push({ ...insight, sourceEventId: source.id, sourceEventName: insight.sourceEventName ?? source.name, sourceEventDate: insight.sourceEventDate ?? source.eventDate });
      }
    }
    return results.sort((left, right) => String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')));
  }

  function renderPriorLearning(event, item) {
    const insights = priorLearningForItem(event, item);
    if (!insights.length) return '';
    return `<aside class="prior-learning-card" aria-label="Learning from previous events">
      <div class="prior-learning-heading"><span>↺</span><div><strong>${item.type === 'question' ? 'Consider what happened last time' : 'Useful context from last time'}</strong><small>${insights.length} linked retrospective note${insights.length === 1 ? '' : 's'}</small></div></div>
      ${insights.slice(0, 3).map(insight => `<div class="prior-learning-entry">
        <p>${renderLearningSummary(insight)}</p>
        <small>${escapeHtml(insight.sourceEventName ?? 'Previous event')}${insight.sourceEventDate ? ` · ${escapeHtml(formatDate(insight.sourceEventDate))}` : ''}${insight.sourceType === 'internal-retrospective' ? ' · internal retrospective' : Number(insight.evidenceCount) > 0 ? ` · informed by ${escapeHtml(insight.evidenceCount)} member response${Number(insight.evidenceCount) === 1 ? '' : 's'}` : ' · organiser retrospective'}</small>
      </div>`).join('')}
    </aside>`;
  }

  function renderLearningSummary(insight) {
    const title = String(insight.title ?? '').trim().replace(/[.:]+$/, '');
    const summary = String(insight.summary ?? '').trim();
    const normalise = value => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return title && normalise(title) !== normalise(summary)
      ? `<strong>${escapeHtml(title)}:</strong> ${escapeHtml(summary)}`
      : escapeHtml(summary || title || 'Review the learning from the previous event.');
  }

  function renderTaskBoardLearning(event, item) {
    const insights = priorLearningForItem(event, item);
    if (!insights.length) return '';
    return `<aside class="task-card-learning-note"><span>↺</span><p><strong>Last time:</strong> ${renderLearningSummary(insights[0])}${insights.length > 1 ? ` <small>+${insights.length - 1} more linked note${insights.length === 2 ? '' : 's'}</small>` : ''}</p></aside>`;
  }

  function taskBoardPeople() {
    return (state.contacts ?? [])
      .filter(contact => contact.active !== false && contact.type === 'person' && contact.canReceiveTasks !== false)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  function resolveTaskBoardPerson(event) {
    const people = taskBoardPeople();
    let person = people.find(contact => contact.id === state.taskBoardPersonId) ?? null;
    if (!person) person = people.find(contact => contact.canLogin === true) ?? null;
    if (!person && event?.organiserRef?.kind === 'person') person = people.find(contact => contact.id === event.organiserRef.id) ?? null;
    if (!person && event?.organiser) person = people.find(contact => contact.name.toLocaleLowerCase() === event.organiser.toLocaleLowerCase()) ?? null;
    if (!person) person = people[0] ?? null;
    if (person) state.taskBoardPersonId = person.id;
    return person;
  }

  function taskBelongsToPerson(task, event, person) {
    if (!person) return false;
    const reference = taskAssignmentReference(task.state);
    if (reference?.kind === 'person') return reference.id === person.id;
    if (reference?.kind === 'role') {
      const recipient = contactForRole(reference.id, event);
      if (recipient?.id === person.id) return true;
      if (recipient?.email && person.email && recipient.email.toLocaleLowerCase() === person.email.toLocaleLowerCase()) return true;
      return Boolean(recipient?.name && recipient.name.toLocaleLowerCase() === person.name.toLocaleLowerCase());
    }
    const assigned = String(task.state.assignee ?? '').trim().toLocaleLowerCase();
    return Boolean(assigned && (assigned === person.name.toLocaleLowerCase() || assigned === person.email?.toLocaleLowerCase()));
  }

  function taskDaysUntilDue(task) {
    if (!task.dueDate) return null;
    const today = new Date(`${toIsoDate(new Date())}T12:00:00`);
    const due = new Date(`${task.dueDate}T12:00:00`);
    if (Number.isNaN(due.getTime())) return null;
    return Math.round((due - today) / 86400000);
  }

  function taskHorizon(task) {
    if (task.state.notRelevant === true) return 'not-relevant';
    if (task.state.completed) return 'completed';
    if (task.expired) return 'expired';
    const days = taskDaysUntilDue(task);
    if (days === null) return 'undated';
    if (days <= 2) return 'attention';
    if (days <= 7) return 'next-days';
    if (days <= 28) return 'next-weeks';
    return 'later';
  }

  function taskDueRelativeLabel(task) {
    if (task.state.notRelevant === true) return 'Not relevant';
    if (task.state.completed) return 'Completed';
    if (task.expired) return task.expiresOn ? `Expired after ${formatDate(task.expiresOn)}` : 'Expired';
    const days = taskDaysUntilDue(task);
    if (days === null) return 'Date not configured';
    if (days < -1) return `${Math.abs(days)} days overdue`;
    if (days === -1) return '1 day overdue';
    if (days === 0) return 'Due today';
    if (days === 1) return 'Due tomorrow';
    return `Due in ${days} days`;
  }

  function applyRequestedTaskDeepLink(params) {
    if (params.get('view') !== 'tasks') return false;
    const eventId = params.get('event');
    const taskId = params.get('task');
    if (!eventId || !taskId) return false;

    const event = state.events.find(candidate => candidate.id === eventId);
    if (!event || event.closedAt || normaliseEventLifecycle(event).status === 'completed') return false;
    const task = getActiveTasks(event).find(candidate => candidate.item.id === taskId);
    if (!task) return false;

    state.activeEventId = event.id;
    state.activeView = 'tasks';
    state.taskBoardMode = 'overview';
    state.taskBoardHorizon = taskHorizon(task);
    taskBoardDeepLinkTarget = { eventId: event.id, taskId: task.item.id };
    return true;
  }

  function focusTaskBoardDeepLink() {
    if (!taskBoardDeepLinkTarget || state.activeView !== 'tasks' ||
        state.activeEventId !== taskBoardDeepLinkTarget.eventId) return;
    const card = [...document.querySelectorAll('[data-task-card-id]')]
      .find(candidate => candidate.dataset.taskCardId === taskBoardDeepLinkTarget.taskId);
    if (!card) return;

    taskBoardDeepLinkTarget = null;
    card.dataset.taskDeepLinkTarget = 'true';
    card.setAttribute('tabindex', '-1');
    const details = card.querySelector('.task-card-manage');
    if (details) details.open = true;
    window.requestAnimationFrame(() => {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.focus({ preventScroll: true });
    });
  }

  function taskHorizonDefinition(horizon, tasks) {
    const overdue = tasks.filter(task => (taskDaysUntilDue(task) ?? 0) < 0).length;
    const definitions = {
      attention: {
        label: 'Needs attention',
        description: overdue ? `${overdue} overdue; the remainder are due today or within two days.` : 'Due today or within the next two days.',
        icon: '!'
      },
      'next-days': { label: 'Next few days', description: 'Due in three to seven days.', icon: '7' },
      'next-weeks': { label: 'Next few weeks', description: 'Due in eight to twenty-eight days.', icon: '28' },
      later: { label: 'Later', description: 'Planned more than four weeks ahead.', icon: '→' },
      undated: { label: 'Date needed', description: 'Waiting for a planning milestone or event date.', icon: '?' },
      completed: { label: 'Completed', description: 'Finished tasks retained for the event record.', icon: '✓' },
      expired: { label: 'Expired', description: 'No longer actionable because the configured cutoff has passed.', icon: '—' },
      'not-relevant': { label: 'Not relevant', description: 'Removed from the active plan because it does not apply to this event.', icon: '×' }
    };
    return definitions[horizon] ?? definitions.later;
  }

  function renderTaskTimelineGroup(horizon, tasks, event) {
    if (!tasks.length) return '';
    const definition = taskHorizonDefinition(horizon, tasks);
    const expanded = ['attention', 'next-days', 'next-weeks'].includes(horizon);
    return `
      <details class="task-timeline-group horizon-${escapeHtml(horizon)}" ${expanded ? 'open' : ''}>
        <summary>
          <span class="task-timeline-icon">${escapeHtml(definition.icon)}</span>
          <span class="task-timeline-heading"><strong>${escapeHtml(definition.label)}</strong><small>${escapeHtml(definition.description)}</small></span>
          <span class="task-timeline-count">${tasks.length}</span>
          <span class="task-timeline-chevron" aria-hidden="true"></span>
        </summary>
        <div class="task-group-list">${tasks.map(task => renderTaskBoardCard(task, event)).join('')}</div>
      </details>`;
  }

  function dashboardEvents() {
    return (state.events ?? []).filter(event => {
      const lifecycle = normaliseEventLifecycle(event);
      return !event.closedAt && lifecycle.status !== 'completed';
    });
  }

  function dashboardEventTone(event) {
    const identity = `${event?.id ?? ''}|${event?.name ?? ''}`;
    let hash = 0;
    for (let index = 0; index < identity.length; index += 1) {
      hash = ((hash * 31) + identity.charCodeAt(index)) >>> 0;
    }
    return hash % 6;
  }

  function dashboardTaskRecords(person) {
    const records = [];
    for (const event of dashboardEvents()) {
      normaliseAnswers(event);
      normaliseMilestoneDates(event);
      const tasks = getActiveTasks(event);
      for (const task of tasks) {
        if (task.expired) continue;
        if (taskBelongsToPerson(task, event, person)) records.push({ task, event });
      }
    }
    return records.sort((left, right) => {
      if (left.task.state.completed !== right.task.state.completed) return left.task.state.completed ? 1 : -1;
      const dateOrder = (left.task.dueDate ?? '9999-99-99').localeCompare(right.task.dueDate ?? '9999-99-99');
      if (dateOrder) return dateOrder;
      return (left.event.eventDate ?? '9999-99-99').localeCompare(right.event.eventDate ?? '9999-99-99');
    });
  }

  function renderDashboardTimelineGroup(horizon, records) {
    if (!records.length) return '';
    const tasks = records.map(record => record.task);
    const definition = taskHorizonDefinition(horizon, tasks);
    const expanded = ['attention', 'next-days', 'next-weeks'].includes(horizon);
    return `
      <details class="task-timeline-group dashboard-timeline-group horizon-${escapeHtml(horizon)}" ${expanded ? 'open' : ''}>
        <summary>
          <span class="task-timeline-icon">${escapeHtml(definition.icon)}</span>
          <span class="task-timeline-heading"><strong>${escapeHtml(definition.label)}</strong><small>${escapeHtml(definition.description)}</small></span>
          <span class="task-timeline-count">${records.length}</span>
          <span class="task-timeline-chevron" aria-hidden="true"></span>
        </summary>
        <div class="task-group-list">${records.map(record => renderDashboardTaskCard(record)).join('')}</div>
      </details>`;
  }

  function renderDashboardTaskCard({ task, event }) {
    const { item, module, dueDate } = task;
    const taskState = task.state;
    const horizon = taskHorizon(task);
    const dueLabel = dueDate ? formatDate(dueDate) : item.deadlineCode ? `Deadline ${item.deadlineCode} is not configured` : 'No due date';
    const milestoneLabel = item.deadlineCode ? (MILESTONE_LABELS[item.deadlineCode] ?? item.deadlineCode) : 'No milestone';
    const owner = taskState.assignee || (item.defaultOwnerRoleId ? roleById(item.defaultOwnerRoleId)?.name : '') || 'Awaiting owner';
    const detail = getTaskDetail(item, event);
    const artwork = event.publishedCataloguePosterThumbnail || event.cataloguePosterThumbnail || '';
    const eventTone = dashboardEventTone(event);
    const completionControl = taskCompletionControl(item, event, taskState);
    return `
      <article class="task-card dashboard-task-card event-tone-${eventTone} timing-${escapeHtml(horizon)} ${artwork ? 'has-event-artwork' : ''} ${taskState.completed ? 'completed' : ''}">
        ${completionControl.statusManaged
          ? `<div class="task-card-selection-status ${taskState.completed ? 'completed' : 'status-managed'}" title="${escapeHtml(completionControl.title)}" aria-label="${escapeHtml(completionControl.title)}"><span aria-hidden="true">${taskState.completed ? '✓' : '!'}</span></div>`
          : `<label class="task-card-check ${completionControl.blocked ? 'blocked' : ''}" title="${escapeHtml(completionControl.title)}">
              <input type="checkbox" data-dashboard-task-complete="${escapeHtml(item.id)}" data-dashboard-event-id="${escapeHtml(event.id)}" ${taskState.completed ? 'checked' : ''} ${completionControl.blocked ? 'disabled' : ''}>
              <span></span>
            </label>`}
        <div class="task-card-content">
          ${artwork ? `<span class="dashboard-event-artwork" aria-hidden="true"><img src="${escapeHtml(artwork)}" alt="" loading="lazy" decoding="async"></span>` : ''}
          <div class="dashboard-task-card-body">
            <div class="dashboard-task-main">
              <div class="dashboard-task-event-row">
                <button type="button" class="dashboard-event-name" data-dashboard-open-event="${escapeHtml(event.id)}"><span>${escapeHtml(event.name || 'Untitled event')}</span><small>${escapeHtml(event.eventDate ? formatDate(event.eventDate) : 'Date not set')}</small></button>
                <span>${escapeHtml(module.title)}${item.responsibleArea ? ` · ${escapeHtml(item.responsibleArea)}` : ''}</span>
              </div>
              <div class="task-card-heading">
                <div>
                  <h3>${escapeHtml(item.title)}</h3>
                  <div class="task-card-summary-meta"><span class="task-owner-chip">${escapeHtml(owner)}</span><span class="task-relative-due">${escapeHtml(taskDueRelativeLabel(task))}</span></div>
                </div>
                <div class="dashboard-deadline ${dueDate ? '' : 'missing'} ${horizon === 'attention' ? 'urgent' : ''}">
                  <span class="dashboard-deadline-label"><small>${escapeHtml(item.deadlineCode ?? '—')}</small>${escapeHtml(milestoneLabel)}</span>
                  <strong>${escapeHtml(dueLabel)}</strong>
                </div>
              </div>
              ${renderTaskReviewSummary(item, event, taskState)}
              ${renderTaskStatusDecisionDelivery(item, event)}
              <div class="dashboard-task-actions">
                ${detail ? `<details><summary>Task detail</summary><p>${escapeHtml(detail)}</p></details>` : '<span></span>'}
                <div class="dashboard-task-action-buttons">
                  ${item.reviewSummary ? '' : renderTaskWorkspaceAction(item, event)}
                  ${renderTaskNoteAction(item, event, taskState)}
                  ${renderTaskNotRelevantControl(item, event, taskState)}
                  <button type="button" class="text-button inline" data-dashboard-open-event="${escapeHtml(event.id)}">Open event task board</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </article>`;
  }

  function renderDashboard() {
    const people = taskBoardPeople();
    const person = resolveTaskBoardPerson(null);
    const records = person ? dashboardTaskRecords(person) : [];
    const open = records.filter(record => !record.task.state.completed);
    const done = records.filter(record => record.task.state.completed);
    const attention = open.filter(record => taskHorizon(record.task) === 'attention');
    const overdue = attention.filter(record => (taskDaysUntilDue(record.task) ?? 0) < 0);
    const nextDays = open.filter(record => taskHorizon(record.task) === 'next-days');
    const nextWeeks = open.filter(record => taskHorizon(record.task) === 'next-weeks');
    const later = open.filter(record => ['later', 'undated'].includes(taskHorizon(record.task)));
    const filter = ['open', 'done', 'all'].includes(state.dashboardTaskFilter) ? state.dashboardTaskFilter : 'open';
    const filtered = records.filter(record => filter === 'all' || (filter === 'done' ? record.task.state.completed : !record.task.state.completed));
    const grouped = new Map(['attention', 'next-days', 'next-weeks', 'later', 'undated', 'completed'].map(key => [key, []]));
    for (const record of filtered) grouped.get(taskHorizon(record.task)).push(record);
    const eventCount = new Set(open.map(record => record.event.id)).size;

    return `
      <section class="page-header dashboard-page-header">
        <div>
          <div class="eyebrow">Personal workspace</div>
          <h2>${person ? `${escapeHtml(person.name)}'s dashboard` : 'My dashboard'}</h2>
          <p>Your responsibilities across every active event, ordered by when they need attention.</p>
        </div>
        <div class="page-progress task-progress"><strong>${open.length}</strong><span>open task${open.length === 1 ? '' : 's'} across ${eventCount} event${eventCount === 1 ? '' : 's'}</span></div>
      </section>

      <section class="dashboard-person-bar">
        <div><span class="dashboard-person-icon" aria-hidden="true">●</span><div><strong>Personal daily view</strong><small>Only work assigned directly to you, or to a role that resolves to you, is included.</small></div></div>
        <label><span>Viewing work for</span>${people.length ? `<select data-dashboard-person>${people.map(candidate => `<option value="${escapeHtml(candidate.id)}" ${candidate.id === person?.id ? 'selected' : ''}>${escapeHtml(candidate.name)}</option>`).join('')}</select>` : '<button type="button" class="text-button inline" data-view="directory">Set up people and roles</button>'}</label>
      </section>

      ${person ? `
        <section class="task-focus-banner ${attention.length ? 'urgent' : 'clear'}">
          <span class="task-focus-icon">${attention.length ? '!' : '✓'}</span>
          <div><span>Your focus today</span><h3>${attention.length ? `${attention.length} task${attention.length === 1 ? '' : 's'} need your attention` : 'Nothing requires your urgent attention'}</h3><p>${attention.length ? `${overdue.length ? `${overdue.length} ${overdue.length === 1 ? 'is' : 'are'} overdue. ` : ''}Deal with these first, then look ahead when you have capacity.` : `${nextDays.length} due in the next few days and ${nextWeeks.length} due in the next few weeks.`}</p></div>
        </section>

        <section class="task-horizon-strip" aria-label="Your open tasks by time horizon">
          <div class="${attention.length ? 'urgent' : ''}"><span>Needs attention</span><strong>${attention.length}</strong><small>${overdue.length} overdue</small></div>
          <div><span>Next few days</span><strong>${nextDays.length}</strong><small>3–7 days</small></div>
          <div><span>Next few weeks</span><strong>${nextWeeks.length}</strong><small>8–28 days</small></div>
          <div><span>Later or undated</span><strong>${later.length}</strong><small>Beyond four weeks</small></div>
        </section>

        <section class="task-toolbar dashboard-task-toolbar">
          <div class="filter-tabs">
            ${[['open', `Open (${open.length})`], ['done', `Completed (${done.length})`], ['all', 'All']].map(([value, label]) => `<button class="filter-tab ${filter === value ? 'active' : ''}" data-dashboard-task-filter="${value}">${escapeHtml(label)}</button>`).join('')}
          </div>
          <button type="button" class="button button-secondary" data-view="catalogue">Browse event catalogue</button>
        </section>

        <div class="task-timeline dashboard-timeline">
          ${filtered.length ? ['attention', 'next-days', 'next-weeks', 'later', 'undated', 'completed'].map(horizon => renderDashboardTimelineGroup(horizon, grouped.get(horizon))).join('') : `
            <div class="empty-state"><div class="empty-icon">✓</div><h3>${filter === 'done' ? 'No completed tasks yet' : 'You have no open tasks across active events'}</h3><p>${filter === 'done' ? 'Completed work will appear here as the event plans progress.' : 'There is nothing waiting for you. You can browse the event catalogue or check another person’s view.'}</p></div>`}
        </div>` : `
        <div class="empty-state dashboard-setup-empty"><div class="empty-icon">♙</div><h3>Choose who this dashboard belongs to</h3><p>Add people in People & Roles so the Playbook can resolve task assignments across events.</p><button type="button" class="button button-primary" data-view="directory">Set up people and roles</button></div>`}
    `;
  }

  function prepareTaskBoardSelection(event, tasks, scopeKey) {
    if (taskBoardSelection.eventId !== event.id || taskBoardSelection.scopeKey !== scopeKey) {
      taskBoardSelection.eventId = event.id;
      taskBoardSelection.scopeKey = scopeKey;
      taskBoardSelection.taskIds.clear();
    }

    const selectableIds = new Set(tasks
      .filter(task => task.state.notRelevant !== true && !task.state.completed && !taskCompletionControl(task.item, event, task.state).blocked)
      .map(task => task.item.id));

    for (const taskId of taskBoardSelection.taskIds) {
      if (!selectableIds.has(taskId)) taskBoardSelection.taskIds.delete(taskId);
    }

    return selectableIds;
  }

  function updateTaskBoardSelectionUi() {
    const checkboxes = [...document.querySelectorAll('[data-task-select]')].filter(element => !element.disabled);
    const selected = checkboxes.filter(element => element.checked);
    const selectedCount = selected.length;

    for (const checkbox of checkboxes) {
      checkbox.closest('.task-card')?.classList.toggle('selected', checkbox.checked);
    }

    document.querySelectorAll('[data-task-selection-summary]').forEach(element => {
      element.textContent = `${selectedCount} task${selectedCount === 1 ? '' : 's'} selected`;
    });

    document.querySelectorAll('[data-task-complete-selected]').forEach(element => {
      element.disabled = selectedCount === 0;
      element.textContent = selectedCount ? `Complete selected (${selectedCount})` : 'Complete selected';
    });

    document.querySelectorAll('[data-task-select-all]').forEach(element => {
      element.disabled = checkboxes.length === 0;
      element.checked = checkboxes.length > 0 && selectedCount === checkboxes.length;
      element.indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
    });
  }

  function renderTaskBoard(event, tasks) {
    const mode = state.taskBoardMode === 'overview' ? 'overview' : 'mine';
    const people = taskBoardPeople();
    const person = resolveTaskBoardPerson(event);
    const scoped = mode === 'mine' ? tasks.filter(task => taskBelongsToPerson(task, event, person)) : tasks;
    const allIncludingNotRelevant = getActiveTasks(event, { includeNotRelevant: true });
    const scopedIncludingNotRelevant = mode === 'mine'
      ? allIncludingNotRelevant.filter(task => taskBelongsToPerson(task, event, person))
      : allIncludingNotRelevant;
    const notRelevant = scopedIncludingNotRelevant.filter(task => task.state.notRelevant === true);
    const open = scoped.filter(task => !task.state.completed && !task.expired);
    const done = scoped.filter(task => task.state.completed);
    const expired = scoped.filter(task => task.expired);
    const unassigned = open.filter(task => !task.state.assignee);
    const missingDates = open.filter(task => task.item.deadlineCode && !task.dueDate);
    const attention = open.filter(task => taskHorizon(task) === 'attention');
    const overdue = attention.filter(task => (taskDaysUntilDue(task) ?? 0) < 0);
    const nextDays = open.filter(task => taskHorizon(task) === 'next-days');
    const nextWeeks = open.filter(task => taskHorizon(task) === 'next-weeks');
    const later = open.filter(task => ['later', 'undated'].includes(taskHorizon(task)));
    const scopeLabel = mode === 'mine' && person ? `${person.name}'s` : 'event';
    const horizonTabs = [
      { value: 'attention', label: 'Needs attention', description: `${overdue.length} overdue`, tasks: attention, icon: '!' },
      { value: 'next-days', label: 'Next few days', description: '3–7 days', tasks: nextDays, icon: '7' },
      { value: 'next-weeks', label: 'Next few weeks', description: '8–28 days', tasks: nextWeeks, icon: '28' },
      { value: 'later', label: 'Later or undated', description: 'Beyond four weeks', tasks: later, icon: '→' },
      { value: 'completed', label: 'Completed', description: `${done.length} finished`, tasks: done, icon: '✓' },
      { value: 'expired', label: 'Expired', description: `${expired.length} no longer needed`, tasks: expired, icon: '—' },
      { value: 'not-relevant', label: 'Not relevant', description: `${notRelevant.length} removed`, tasks: notRelevant, icon: '×' }
    ];
    const requestedHorizon = horizonTabs.some(tab => tab.value === state.taskBoardHorizon) ? state.taskBoardHorizon : 'auto';
    const activeHorizon = requestedHorizon === 'auto'
      ? (horizonTabs.find(tab => !['completed', 'expired', 'not-relevant'].includes(tab.value) && tab.tasks.length)?.value ?? (done.length ? 'completed' : expired.length ? 'expired' : notRelevant.length ? 'not-relevant' : 'attention'))
      : requestedHorizon;
    const activeTab = horizonTabs.find(tab => tab.value === activeHorizon) ?? horizonTabs[0];
    const activeDefinition = taskHorizonDefinition(activeHorizon, activeTab.tasks);
    const selectionScopeKey = `${event.id}|${mode}|${mode === 'mine' ? (person?.id ?? '') : ''}|${activeHorizon}`;
    const selectableTaskIds = prepareTaskBoardSelection(event, activeTab.tasks, selectionScopeKey);
    const selectedTaskCount = taskBoardSelection.taskIds.size;
    const allSelectableTasksSelected = selectableTaskIds.size > 0 && selectedTaskCount === selectableTaskIds.size;
    const emptyHeading = activeHorizon === 'completed'
      ? `No completed tasks for ${mode === 'mine' ? escapeHtml(person?.name ?? 'this person') : 'this event'}`
      : activeHorizon === 'expired'
        ? 'No expired tasks for this event'
        : activeHorizon === 'not-relevant'
          ? 'No tasks have been marked not relevant'
        : `No tasks in ${activeTab.label.toLocaleLowerCase()}`;
    const emptyCopy = activeHorizon === 'attention'
      ? 'Nothing is overdue or due within the next two days. Choose another timeframe to work ahead.'
      : activeHorizon === 'completed'
        ? 'Tasks will appear here as they are finished.'
        : activeHorizon === 'expired'
          ? 'Tasks with a configured cutoff remain here as a read-only record after they are no longer needed.'
        : 'Choose another timeframe, or return to the planner if more work needs to be created.';

    return `
      <section class="task-board-viewbar task-board-primary-controls" aria-label="Task board view">
        <div class="task-board-mode-switch">
          <button type="button" class="${mode === 'mine' ? 'active' : ''}" data-task-board-mode="mine" aria-pressed="${mode === 'mine'}"><span>My tasks</span><small>Personal focus</small></button>
          <button type="button" class="${mode === 'overview' ? 'active' : ''}" data-task-board-mode="overview" aria-pressed="${mode === 'overview'}"><span>Event overview</span><small>Organiser view</small></button>
        </div>
        <div class="task-board-viewbar-meta">
          ${mode === 'mine' ? `<label class="task-board-person"><span>Working as</span>${people.length ? `<select data-task-board-person>${people.map(candidate => `<option value="${escapeHtml(candidate.id)}" ${candidate.id === person?.id ? 'selected' : ''}>${escapeHtml(candidate.name)}</option>`).join('')}</select>` : '<button type="button" class="text-button inline" data-view="directory">Add a person in People & Roles</button>'}</label>` : `<div class="task-board-overview-note"><span>${unassigned.length}</span><small>open task${unassigned.length === 1 ? '' : 's'} without an owner</small></div>`}
          <div class="task-board-completion"><strong>${done.length}/${open.length + done.length}</strong><small>${escapeHtml(scopeLabel)} actionable tasks complete${expired.length ? ` · ${expired.length} expired` : ''}</small></div>
        </div>
      </section>

      <section class="task-horizon-strip task-horizon-tabs" role="tablist" aria-label="Tasks by timeframe">
        ${horizonTabs.map(tab => `<button type="button" role="tab" class="task-horizon-tab horizon-${escapeHtml(tab.value)} ${activeHorizon === tab.value ? 'active' : ''} ${tab.value === 'attention' && tab.tasks.length ? 'urgent' : ''}" data-task-board-horizon="${escapeHtml(tab.value)}" aria-selected="${activeHorizon === tab.value}">
          <span>${escapeHtml(tab.label)}</span><strong>${tab.tasks.length}</strong><small>${escapeHtml(tab.description)}</small><i aria-hidden="true">${escapeHtml(tab.icon)}</i>
        </button>`).join('')}
      </section>

      <section class="task-horizon-panel horizon-${escapeHtml(activeHorizon)}" role="tabpanel">
        <header class="task-horizon-panel-header">
          <div class="task-horizon-panel-title">
            <span>${escapeHtml(activeDefinition.icon)}</span>
            <div><strong>${escapeHtml(activeTab.label)}</strong><small>${escapeHtml(activeDefinition.description)}</small></div>
          </div>
          <div class="task-toolbar-actions">
            ${selectableTaskIds.size ? `<div class="task-bulk-actions" aria-label="Bulk task completion">
              <label class="task-select-all" title="Select every task shown that is ready to complete">
                <input type="checkbox" data-task-select-all ${allSelectableTasksSelected ? 'checked' : ''} ${selectableTaskIds.size ? '' : 'disabled'}>
                <span aria-hidden="true"></span><small>Select all</small>
              </label>
              <span class="task-selection-summary" data-task-selection-summary>${selectedTaskCount} task${selectedTaskCount === 1 ? '' : 's'} selected</span>
              <button type="button" class="button button-primary" data-task-complete-selected ${selectedTaskCount ? '' : 'disabled'}>${selectedTaskCount ? `Complete selected (${selectedTaskCount})` : 'Complete selected'}</button>
            </div>` : ''}
            <div class="task-secondary-actions">
              <button class="button button-secondary" data-action="send-notifications">Send queued notifications</button>
              <button class="button button-secondary" data-action="export-csv">Export CSV</button>
              <button class="button button-secondary" data-action="print">Print</button>
            </div>
          </div>
        </header>
        ${activeHorizon === 'later' && missingDates.length ? `<div class="task-horizon-inline-notice"><strong>${missingDates.length} task${missingDates.length === 1 ? '' : 's'} need a date.</strong><span>Configure the relevant milestone or event date.</span><button class="text-button inline" data-view="module:start">Open planning timeline</button></div>` : ''}
        <div class="task-group-list task-horizon-results">
          ${activeTab.tasks.length ? activeTab.tasks.map(task => renderTaskBoardCard(task, event, taskBoardSelection.taskIds.has(task.item.id))).join('') : `
            <div class="empty-state task-horizon-empty"><div class="empty-icon">${activeHorizon === 'attention' ? '✓' : activeTab.icon}</div><h3>${emptyHeading}</h3><p>${emptyCopy}</p></div>`}
        </div>
      </section>
    `;
  }

  function renderTaskBoardCard(task, event, selected = false) {
    const { item, module, dueDate } = task;
    const taskState = task.state;
    const dueLabel = taskState.notRelevant === true
      ? 'Removed from active plan'
      : task.expired
      ? `Expired after ${formatDate(task.expiresOn)}`
      : dueDate ? formatDate(dueDate) : item.deadlineCode ? `Deadline ${item.deadlineCode} is not configured` : 'No due date';
    const detail = getTaskDetail(item, event);
    const horizon = taskHorizon(task);
    const owner = taskState.assignee || (item.defaultOwnerRoleId ? roleById(item.defaultOwnerRoleId)?.name : '') || 'Awaiting owner';
    const relativeDue = taskDueRelativeLabel(task);
    const priorLearning = priorLearningForItem(event, item);
    const completionControl = taskCompletionControl(item, event, taskState);
    return `
      <article class="task-card timing-${escapeHtml(horizon)} ${taskState.completed ? 'completed' : ''} ${task.expired ? 'expired' : ''} ${taskState.notRelevant === true ? 'not-relevant' : ''} ${selected ? 'selected' : ''}" data-task-card-id="${escapeHtml(item.id)}">
        ${taskState.notRelevant === true
          ? `<div class="task-card-selection-status not-relevant" title="Task marked not relevant" aria-label="Task marked not relevant"><span aria-hidden="true">×</span></div>`
          : task.expired
          ? `<div class="task-card-selection-status expired" title="Task expired" aria-label="Task expired"><span aria-hidden="true">—</span></div>`
          : taskState.completed
          ? `<div class="task-card-selection-status completed" title="Task completed" aria-label="Task completed"><span aria-hidden="true">✓</span></div>`
          : `<label class="task-card-check ${completionControl.blocked ? 'blocked' : ''}" title="${escapeHtml(completionControl.blocked ? completionControl.title : `Select ${item.title}`)}">
              <input type="checkbox" data-task-select="${escapeHtml(item.id)}" aria-label="Select ${escapeHtml(item.title)}" ${selected ? 'checked' : ''} ${completionControl.blocked ? 'disabled' : ''}>
              <span aria-hidden="true"></span>
            </label>`}
        <div class="task-card-content">
          <div class="task-card-heading">
            <div>
              <div class="task-module-label">${escapeHtml(module.title)}${item.responsibleArea ? ` · ${escapeHtml(item.responsibleArea)}` : ''}</div>
              <h3>${escapeHtml(item.title)}</h3>
              <div class="task-card-summary-meta"><span class="task-owner-chip">${escapeHtml(owner)}</span><span class="task-relative-due">${escapeHtml(relativeDue)}</span>${staffBriefingPhaseLabel(item) ? `<span class="staff-duty-chip">Staff duty · ${escapeHtml(staffBriefingPhaseLabel(item))}</span>` : ''}${priorLearning.length ? `<span class="task-learning-chip">↺ Learning from last time</span>` : ''}</div>
            </div>
            <div class="task-due-block ${item.deadlineCode && !dueDate ? 'missing' : ''} ${item.deadlineCode ? '' : 'no-milestone'} ${horizon === 'attention' ? 'urgent' : ''}">
              <span class="task-board-milestone-label">
                <small class="task-board-milestone-code">${escapeHtml(item.deadlineCode ?? '—')}</small>
                <span>${escapeHtml(item.deadlineCode ? (MILESTONE_LABELS[item.deadlineCode] ?? item.deadlineCode) : 'No milestone')}</span>
              </span>
              <time class="task-board-due-date" ${dueDate ? `datetime="${escapeHtml(dueDate)}"` : ''}>${escapeHtml(dueLabel)}</time>
            </div>
          </div>
          ${renderTaskBoardLearning(event, item)}
          ${taskState.notRelevant === true ? '' : renderTaskReviewSummary(item, event, taskState, false)}
          ${taskState.notRelevant === true ? '' : renderTaskStatusDecisionDelivery(item, event)}
          <div class="task-card-primary-actions ${task.expired ? 'task-expired-message' : taskState.notRelevant === true ? 'task-expired-message' : completionControl.statusManaged ? 'task-status-managed-message' : ''}">
            ${task.expired
              ? '<span>This task is retained for the event record; no action is required.</span>'
              : taskState.notRelevant === true
                ? '<span>This task has been removed from the active plan.</span>'
              : completionControl.actionRequired
                ? renderTaskWorkspaceAction(item, event)
              : completionControl.statusManaged
                ? '<span>Completion follows the recorded event status and delivery result.</span>'
              : `<button type="button" class="button ${taskState.completed ? 'button-secondary' : 'button-primary'}" data-task-completion-action="${escapeHtml(item.id)}" data-task-target-completed="${taskState.completed ? 'false' : 'true'}" ${completionControl.blocked ? 'disabled' : ''} title="${escapeHtml(completionControl.title)}">${taskState.completed ? 'Reopen task' : 'Complete task'}</button>`}
            ${renderTaskNoteAction(item, event, taskState)}
            ${renderTaskNotRelevantControl(item, event, taskState)}
          </div>
          <details class="task-card-manage">
            <summary><span>${task.expired || taskState.notRelevant === true ? 'Task record' : 'Details and assignment'}</span><span class="task-card-manage-chevron" aria-hidden="true"></span></summary>
            <div class="task-card-manage-body">
              ${detail ? `<p class="task-detail">${escapeHtml(detail)}</p>` : ''}
              ${task.expired || taskState.notRelevant === true ? `<div class="task-expired-record"><span>${taskState.notRelevant === true ? 'Owner when removed' : 'Owner at expiry'}</span><strong>${escapeHtml(owner)}</strong>${taskState.notes ? `<span>Recorded note</span><p>${escapeHtml(taskState.notes)}</p>` : ''}</div>` : `<div class="task-fields">
                <div class="task-assignment-field">
                  <span>Assigned to</span>
                  ${renderAssignmentPicker({ value: taskAssignmentReference(taskState) ?? taskState.assignee, fallback: taskState.assignee, eligibleRoleId: task.item.defaultOwnerRoleId, taskId: item.id })}
                </div>
                <label class="task-notes-field">
                  <span>${escapeHtml(item.reviewSummary?.notesLabel || (item.reviewSummary ? 'Confirmation note (optional)' : 'Task notes'))}</span>
                  <input type="text" maxlength="2000" value="${escapeHtml(taskState.notes ?? '')}" placeholder="${escapeHtml(item.reviewSummary?.notesPlaceholder || (item.reviewSummary ? 'Add context only if needed; the plan is recorded above' : 'Add any event-specific detail'))}" data-task-notes="${item.id}">
                </label>
              </div>`}
              <div class="task-operational-row">
                <span class="notification-chip ${task.expired || taskState.notRelevant === true ? 'expired' : taskState.notificationStatus ?? 'none'}">${taskState.notRelevant === true ? 'Not relevant — reminders and completion disabled' : task.expired ? 'Expired — reminders and completion disabled' : taskState.notificationStatus === 'queued' ? 'Assignment notification queued' : taskState.notificationStatus === 'outbox' ? 'Notification written to development outbox' : taskState.assignee ? 'Owner assigned' : 'Awaiting owner'}</span>
                ${!task.expired && taskState.notRelevant !== true && taskState.assignee && !assignmentRecipient(taskAssignmentReference(taskState) ?? taskState.assignee, event).email ? `<span class="notification-chip warning">No email configured for this person or role</span>` : ''}
                ${!task.expired && taskState.notRelevant !== true && !item.reviewSummary ? renderTaskWorkspaceAction(item, event) : ''}
                ${!task.expired && taskState.notRelevant !== true && item.canCompleteFromLink !== false && item.completionMode !== 'event-status-decision' && taskState.completionToken ? `<button class="text-button inline" data-copy-completion="${escapeHtml(item.id)}">Copy completion link</button>` : ''}
                ${taskState.completedAt ? `<span class="completed-at">Completed ${escapeHtml(formatDate(taskState.completedAt.substring(0,10)))}</span>` : ''}
              </div>
            </div>
          </details>
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
          const taskState = event.taskState?.[item.id] ?? {};
          if (taskState.notRelevant === true) continue;
          const expiresOn = getTaskExpiryDate(item, event);
          tasks.push({
            item,
            module,
            section,
            dueDate: getDueDate(item.deadlineCode, event),
            expiresOn,
            expired: isTaskExpired(item, event, taskState, expiresOn),
            state: taskState
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
    const expired = tasks.filter(task => task.expired).length;
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
            : `<span class="catalogue-poster-placeholder"><img src="${escapeHtml(clubBranding.crestUrl)}" alt="${escapeHtml(clubBranding.clubName)} crest"><small>Artwork not generated yet</small></span>`}
          <span class="catalogue-status status-${escapeHtml(lifecycle.status)}">${escapeHtml(statusDefinition.label)}</span>
          ${current ? '<span class="catalogue-current-badge">Current event</span>' : ''}
        </button>
        <div class="catalogue-card-body">
          <div class="catalogue-card-heading">
            <div>
              <span class="eyebrow">${escapeHtml(event.eventDate ? formatDate(event.eventDate) : 'Date not set')}</span>
              <h3>${escapeHtml(event.name)}</h3>
            </div>
            <button class="catalogue-delete-event" type="button" data-delete-event="${escapeHtml(event.id)}" aria-label="Delete ${escapeHtml(event.name)}" title="Delete this event"><span aria-hidden="true">×</span> Delete</button>
          </div>
          <p class="catalogue-description">${escapeHtml(event.description || 'No event description has been recorded yet.')}</p>
          <div class="catalogue-stats">
            <span><strong>${tasks.length}</strong> tasks</span>
            <span><strong>${completed}</strong> complete</span>
            ${expired ? `<span><strong>${expired}</strong> expired</span>` : ''}
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
    const actionableTasks = tasks.filter(task => !task.expired);
    const expiredTasks = tasks.filter(task => task.expired);
    const retrospectiveFields = playbook.retrospective?.fields ?? [];
    const sentimentLabels = ['', 'Very difficult', 'Difficult', 'Mixed', 'Good', 'Excellent'];
    const sentiment = Number(event.retrospective?.sentimentRating || 0);
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
          <div class="summary-section-heading"><h3>Tasks created</h3><span>${actionableTasks.filter(task => task.state.completed).length}/${actionableTasks.length} actionable tasks complete${expiredTasks.length ? ` · ${expiredTasks.length} expired` : ''}</span></div>
          ${tasks.length ? `<div class="summary-task-list">${tasks.map(task => `
            <div class="summary-task-row ${task.state.completed ? 'complete' : ''} ${task.expired ? 'expired' : ''}">
              <span class="summary-task-status">${task.state.completed ? '✓' : task.expired ? '—' : '○'}</span>
              <div><strong>${escapeHtml(task.item.title)}</strong><small>${escapeHtml(task.module.title)}${task.expired ? ` · Expired after ${escapeHtml(formatDate(task.expiresOn))}` : task.dueDate ? ` · Due ${escapeHtml(formatDate(task.dueDate))}` : ''}${task.state.assignee ? ` · ${escapeHtml(task.state.assignee)}` : ''}</small></div>
            </div>`).join('')}</div>` : '<p class="summary-empty">No tasks were generated for this event.</p>'}
        </section>

        <section class="summary-section">
          <div class="summary-section-heading"><h3>Retrospective</h3></div>
          <div class="summary-retro-grid">
            ${sentiment ? `<div class="summary-retro-item"><span>Overall team feeling</span><strong>${escapeHtml(sentimentLabels[sentiment])} · ${sentiment}/5</strong></div>` : ''}
            ${event.retrospective?.finalisedAt ? `<div class="summary-retro-item"><span>Retrospective status</span><strong>Finalised ${escapeHtml(new Date(event.retrospective.finalisedAt).toLocaleDateString('en-GB'))}</strong></div>` : ''}
            ${retrospectiveFields.map(field => {
              const value = event.retrospective?.[field.id];
              const display = value === true ? 'Yes' : value === false ? 'No' : value === '' || value === null || value === undefined ? 'Not recorded' : String(value);
              return `<div class="summary-retro-item"><span>${escapeHtml(field.label)}</span><strong>${escapeHtml(display)}</strong></div>`;
            }).join('')}
            ${event.retrospective?.memberFeedbackSummary ? `<div class="summary-retro-item summary-retro-wide"><span>AI member-feedback summary</span><strong>${escapeHtml(event.retrospective.memberFeedbackSummary)}</strong></div>` : ''}
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
    const agileFieldIds = new Set(['worked-well', 'did-not-work', 'change-next-time']);
    const agileFields = fields.filter(field => agileFieldIds.has(field.id));
    const outcomeFields = fields.filter(field => !agileFieldIds.has(field.id));
    return `
      <section class="page-header retrospective-page-header"><div><div class="eyebrow">Learn and improve</div><h2>Event retrospective</h2><p>Bring the member voice and the delivery team's experience together, then turn the evidence into useful guidance for the next running.</p></div>${event.retrospective?.finalisedAt ? `<div class="retrospective-finalised-badge"><span>✓ Finalised</span><small>${escapeHtml(new Date(event.retrospective.finalisedAt).toLocaleString('en-GB'))}</small></div>` : ''}</section>
      ${renderAttendeeFeedback(event)}
      ${renderMemberFeedbackSummary(event)}
      <section class="playbook-section retrospective-section agile-retrospective-section">
        <header class="retrospective-section-heading"><div><span class="eyebrow">Delivery team retrospective</span><h3>How did the event feel?</h3></div><p>Choose the face that best represents the team's overall feeling, then use the three agile prompts to capture what should be repeated or changed.</p></header>
        ${renderRetrospectiveSentiment(event)}
        <div class="agile-retrospective-grid">${agileFields.map((field, index) => renderAgileRetrospectiveField(field, event, index)).join('')}</div>
        <details class="retrospective-outcome-details" ${outcomeFields.some(field => event.retrospective?.[field.id] !== undefined && event.retrospective?.[field.id] !== '') ? 'open' : ''}>
          <summary><span>Event outcome and figures</span><small>Attendance, revenue, costs and whether to run it again</small></summary>
          <div class="retrospective-grid">${outcomeFields.map(field => renderRetrospectiveField(field, event)).join('')}</div>
        </details>
      </section>
      ${renderRetrospectiveAnalysis(event)}
      ${renderCarryForwardLibrary(event)}`;
  }

  function renderRetrospectiveSentiment(event) {
    const value = Number(event.retrospective?.sentimentRating || 0);
    const options = [
      { value: 1, icon: '😞', label: 'Very difficult' },
      { value: 2, icon: '🙁', label: 'Difficult' },
      { value: 3, icon: '😐', label: 'Mixed' },
      { value: 4, icon: '🙂', label: 'Good' },
      { value: 5, icon: '😄', label: 'Excellent' }
    ];
    return `<div class="retrospective-sentiment" role="group" aria-label="How the event felt">${options.map(option => `<button type="button" class="sentiment-choice ${value === option.value ? 'selected' : ''}" data-retro-sentiment="${option.value}" aria-pressed="${value === option.value}"><span aria-hidden="true">${option.icon}</span><small>${option.label}</small></button>`).join('')}</div>`;
  }

  function renderAgileRetrospectiveField(field, event, index) {
    const value = event.retrospective?.[field.id] ?? '';
    const prompts = [
      'Successes, strengths and things worth repeating.',
      'Problems, friction, surprises or outcomes that disappointed.',
      'Specific changes that would make the next running better.'
    ];
    return `<label class="agile-retro-card agile-retro-${index + 1}"><span class="agile-retro-number">${index + 1}</span><strong>${escapeHtml(field.label)}</strong><small>${escapeHtml(prompts[index] ?? '')}</small><textarea rows="7" data-retro-field="${escapeHtml(field.id)}" placeholder="Record the team's observations…">${escapeHtml(value)}</textarea></label>`;
  }

  function renderMemberFeedbackSummary(event) {
    const data = feedbackCache.get(event.id);
    const responseCount = data?.responses?.length ?? 0;
    const summary = event.retrospective?.memberFeedbackSummary;
    const summarisedResponseCount = Number(event.retrospective?.memberFeedbackSummaryResponseCount ?? 0);
    const hasNewResponses = Boolean(summary) && responseCount > summarisedResponseCount;
    const canSummarise = responseCount > 0 && !data?.error;
    return `<section class="playbook-section member-feedback-summary-section">
      <header class="retrospective-section-heading"><div><span class="eyebrow">AI member-feedback summary</span><h3>What members told us</h3></div><p>The summary keeps recurring themes and useful minority views visible without attributing comments to individuals.</p></header>
      <div class="member-feedback-summary ${summary ? 'has-summary' : ''}">
        <div class="member-feedback-summary-icon">✦</div>
        <div><strong>${hasNewResponses ? `${responseCount - summarisedResponseCount} new response${responseCount - summarisedResponseCount === 1 ? '' : 's'} since the summary` : summary ? `${responseCount} response${responseCount === 1 ? '' : 's'} summarised` : canSummarise ? `${responseCount} response${responseCount === 1 ? '' : 's'} ready to summarise` : 'Waiting for member feedback'}</strong><p>${escapeHtml(summary || (canSummarise ? 'Generate a concise AI summary when the feedback window has closed, or refresh it whenever more responses arrive.' : 'Once responses arrive, their ratings and comments can be condensed into a neutral summary here.'))}</p>${event.retrospective?.memberFeedbackSummaryAt ? `<small>Last generated ${escapeHtml(new Date(event.retrospective.memberFeedbackSummaryAt).toLocaleString('en-GB'))}</small>` : ''}</div>
        ${canSummarise ? `<button class="button button-secondary" type="button" data-action="summarise-member-feedback">${summary ? 'Refresh summary' : 'Summarise member feedback'}</button>` : ''}
      </div>
    </section>`;
  }

  function renderRetrospectiveAnalysis(event) {
    const analysis = event.retrospective?.taskAnalysis;
    const proposals = analysis?.proposals ?? [];
    return `<section class="playbook-section retrospective-analysis-section">
      <header class="retrospective-section-heading">
        <div><span class="eyebrow">Finalise and carry forward</span><h3>Turn the retrospective into future guidance</h3></div>
        <p>AI reviews the member feedback and team retrospective together, then attaches each supported lesson to the most relevant planning question or task.</p>
      </header>
      <div class="retrospective-analysis-body">
        <label class="retrospective-narrative-field"><span>Additional context <small>optional</small></span><textarea id="retrospectiveNarrative" rows="4" maxlength="12000" placeholder="Add any other evidence or context that does not fit the three prompts above.">${escapeHtml(event.retrospective?.aiNarrative ?? '')}</textarea></label>
        <div class="retrospective-analysis-actions">
          <p>Finalising replaces the previous AI-generated links for this event, while leaving any manually approved learning intact. Avoid names or unnecessary personal information.</p>
          <button class="button button-primary retrospective-finalise-button" type="button" data-action="finalise-retrospective">${event.retrospective?.finalisedAt ? 'Re-finalise retrospective' : 'Finalise retrospective with AI'}</button>
        </div>
        ${analysis ? `<div class="retrospective-analysis-result">
          <header><div><span class="analysis-mode ${analysis.mode === 'openai' ? 'ai' : 'fallback'}">${analysis.mode === 'openai' ? 'AI analysed' : 'Local matching'}</span><h4>${escapeHtml(analysis.summary ?? 'Analysis complete')}</h4></div><small>${analysis.generatedAt ? `Finalised ${escapeHtml(new Date(analysis.generatedAt).toLocaleString('en-GB'))}` : ''}</small></header>
          ${proposals.length ? `<div class="retrospective-proposal-list">${proposals.map(proposal => renderRetrospectiveProposal(proposal, event)).join('')}</div>` : `<div class="feedback-empty"><span>?</span><div><strong>No confident planning links were found</strong><p>Add more specific operational detail, then finalise again. Learning can still be added manually from the member comments above.</p></div></div>`}
        </div>` : ''}
      </div>
    </section>`;
  }

  function renderRetrospectiveProposal(proposal, event) {
    const targetValue = proposal.targetItemId
      ? `item:${proposal.targetItemId}`
      : proposal.targetSectionId
        ? `section:${proposal.targetModuleId ?? ''}:${proposal.targetSectionId}`
        : proposal.targetModuleId
          ? `module:${proposal.targetModuleId}`
          : '';
    const indexed = proposal.targetItemId ? itemIndex.get(proposal.targetItemId) : null;
    const completed = proposal.targetItemId ? event.taskState?.[proposal.targetItemId]?.completed === true : false;
    const alreadyApproved = Boolean(event.learningInsights?.some(insight => insight.sourceProposalId === proposal.id));
    return `<article class="retrospective-proposal ${alreadyApproved ? 'approved' : ''}" data-retrospective-proposal-id="${escapeHtml(proposal.id)}">
      <header>
        <div><span class="proposal-confidence">${escapeHtml(proposal.confidence ?? 0)}% match</span>${completed ? '<span class="proposal-completed">Task completed</span>' : ''}</div>
        <span class="insight-importance ${escapeHtml(proposal.importance ?? 'consider')}">${escapeHtml(proposal.importance ?? 'consider')}</span>
      </header>
      <label><span>Reusable learning title</span><input type="text" maxlength="120" value="${escapeHtml(proposal.title ?? '')}" data-retrospective-proposal-field="title"></label>
      <label><span>Learning for the next organiser</span><textarea rows="4" maxlength="1500" data-retrospective-proposal-field="summary">${escapeHtml(proposal.summary ?? '')}</textarea></label>
      <label><span>Show this beside</span><select data-retrospective-proposal-target>${renderLearningTargetOptions(targetValue)}</select></label>
      <div class="proposal-evidence"><span>Source evidence</span><blockquote>${escapeHtml(proposal.sourceExcerpt ?? '')}</blockquote><p>${escapeHtml(proposal.reason ?? '')}</p>${indexed ? `<small>Attached to ${escapeHtml(indexed.item.type)}: ${escapeHtml(indexed.item.title ?? indexed.item.label)}</small>` : ''}</div>
      <footer>
        ${alreadyApproved ? '<span class="proposal-approved-mark">✓ Attached for the next running</span>' : `<button class="button button-primary" type="button" data-approve-retrospective-proposal="${escapeHtml(proposal.id)}">Attach and carry forward</button>`}
        <button class="button button-secondary" type="button" data-dismiss-retrospective-proposal="${escapeHtml(proposal.id)}">${alreadyApproved ? 'Hide suggestion' : 'Dismiss'}</button>
      </footer>
    </article>`;
  }

  function retrospectiveTextForAnalysis(event) {
    const labels = new Map((playbook.retrospective?.fields ?? []).map(field => [field.id, field.label]));
    const structured = ['worked-well', 'did-not-work', 'change-next-time']
      .map(id => {
        const value = String(event.retrospective?.[id] ?? '').trim();
        return value ? `${labels.get(id) ?? id}: ${value}` : '';
      })
      .filter(Boolean);
    const sentimentLabels = ['', 'Very difficult', 'Difficult', 'Mixed', 'Good', 'Excellent'];
    const sentiment = Number(event.retrospective?.sentimentRating || 0);
    return [sentiment ? `Overall team feeling: ${sentimentLabels[sentiment]} (${sentiment}/5)` : '', ...structured, String(event.retrospective?.aiNarrative ?? '').trim()].filter(Boolean).join('\n\n');
  }

  function retrospectivePlannerContexts(event) {
    const contexts = new Map();
    for (const module of playbook.modules.filter(candidate => isModuleActive(candidate, event))) {
      for (const section of module.sections) {
        for (const item of section.items.filter(candidate => candidate.type === 'question' && isItemVisible(candidate, event))) {
          contexts.set(item.id, {
            id: item.id,
            itemType: 'question',
            title: item.label,
            detail: item.helpText ?? '',
            moduleId: module.id,
            moduleTitle: module.title,
            sectionId: section.id,
            sectionTitle: section.title,
            completed: isQuestionComplete(item, event)
          });
        }
      }
    }
    for (const task of getActiveTasks(event)) {
      contexts.set(task.item.id, {
        id: task.item.id,
        itemType: 'task',
        title: task.item.title,
        detail: getTaskDetail(task.item, event),
        moduleId: task.module.id,
        moduleTitle: task.module.title,
        sectionId: task.section.id,
        sectionTitle: task.section.title,
        completed: task.state.completed === true
      });
    }
    for (const [itemId, taskState] of Object.entries(event.taskState ?? {})) {
      if (taskState?.completed !== true || contexts.has(itemId)) continue;
      const indexed = itemIndex.get(itemId);
      if (!indexed || indexed.item.type !== 'task') continue;
      contexts.set(itemId, {
        id: itemId,
        itemType: 'task',
        title: indexed.item.title,
        detail: getTaskDetail(indexed.item, event),
        moduleId: indexed.module.id,
        moduleTitle: indexed.module.title,
        sectionId: indexed.section.id,
        sectionTitle: indexed.section.title,
        completed: true
      });
    }
    return [...contexts.values()];
  }

  function memberFeedbackTextForAnalysis(event) {
    const data = feedbackCache.get(event.id);
    const campaign = data?.campaign;
    const responses = data?.responses ?? [];
    if (!campaign || !responses.length) return '';
    const questionMap = new Map((campaign.questions ?? []).map(question => [question.id, question.label]));
    const lines = [`Responses received: ${responses.length}`];
    for (const response of responses) {
      const answers = Object.entries(response.answers ?? {})
        .map(([questionId, answer]) => `${questionMap.get(questionId) ?? questionId}: ${String(answer ?? '').trim()}`)
        .filter(line => !line.endsWith(': '));
      if (answers.length) lines.push(answers.join(' | '));
    }
    return lines.join('\n').slice(0, 16000);
  }

  function questionIdsFromCondition(condition, result = []) {
    if (!condition) return result;
    if (condition.questionId) result.push(condition.questionId);
    for (const part of condition.all ?? []) questionIdsFromCondition(part, result);
    for (const part of condition.any ?? []) questionIdsFromCondition(part, result);
    if (condition.not) questionIdsFromCondition(condition.not, result);
    return result;
  }

  function relatedLearningTargetItemIds(itemId) {
    const indexed = itemIndex.get(itemId);
    if (!indexed) return [itemId];
    return [...new Set([
      itemId,
      ...questionIdsFromCondition(indexed.item.showWhen),
      ...questionIdsFromCondition(indexed.module.activation)
    ].filter(id => itemIndex.get(id)?.item?.type === 'question' || id === itemId))];
  }

  function captureRetrospectiveInputs(event) {
    document.querySelectorAll('[data-retro-field]').forEach(element => {
      const value = element.type === 'number' && element.value !== '' ? Number(element.value) : element.value;
      event.retrospective[element.dataset.retroField] = value;
    });
    const narrative = document.getElementById('retrospectiveNarrative');
    if (narrative) event.retrospective.aiNarrative = narrative.value;
  }

  async function runRetrospectiveAnalysis(event, button, { finalise = false } = {}) {
    captureRetrospectiveInputs(event);
    const retrospectiveText = retrospectiveTextForAnalysis(event);
    const customerFeedbackText = memberFeedbackTextForAnalysis(event);
    if (!retrospectiveText && !customerFeedbackText) {
      alert(finalise
        ? 'Record how the event felt, add something to the three retrospective prompts, or collect member feedback before finalising it.'
        : 'There is no member feedback to summarise yet.');
      return;
    }

    const originalText = button?.textContent ?? '';
    if (button) {
      button.disabled = true;
      button.textContent = finalise ? 'Analysing and attaching learning…' : 'Summarising member feedback…';
    }
    saveState();
    try {
      const data = feedbackCache.get(event.id);
      const responseCount = data?.responses?.length ?? 0;
      const response = await fetch('/api/retrospective/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventName: event.name,
          eventDescription: event.description,
          retrospectiveText,
          customerFeedbackText,
          customerFeedbackResponseCount: responseCount,
          sentimentRating: Number(event.retrospective?.sentimentRating || 0) || null,
          tasks: retrospectivePlannerContexts(event)
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'The retrospective could not be analysed.');

      event.retrospective.memberFeedbackSummary = payload.customerFeedbackSummary || 'No member feedback has been received yet.';
      event.retrospective.memberFeedbackSummaryAt = new Date().toISOString();
      event.retrospective.memberFeedbackSummaryResponseCount = responseCount;
      if (finalise) {
        const analysisId = crypto.randomUUID();
        const generatedAt = new Date().toISOString();
        const proposals = (payload.proposals ?? []).map(proposal => ({ ...proposal, approved: true }));
        event.retrospective.taskAnalysis = { ...payload, analysisId, generatedAt, proposals };
        event.retrospective.finalisedAt = generatedAt;
        event.learningInsights ??= [];
        event.learningInsights = event.learningInsights.filter(insight => insight.sourceType !== 'finalised-retrospective');
        for (const proposal of proposals) {
          if (!proposal.title || !proposal.summary || !proposal.targetItemId) continue;
          event.learningInsights.push({
            id: crypto.randomUUID(),
            title: proposal.title,
            summary: proposal.summary,
            importance: proposal.importance ?? 'consider',
            evidenceCount: responseCount,
            targetModuleIds: [],
            targetSectionIds: [],
            targetItemIds: relatedLearningTargetItemIds(proposal.targetItemId),
            sourceEventName: event.name,
            sourceEventDate: event.eventDate,
            sourceType: 'finalised-retrospective',
            sourceProposalId: proposal.id,
            sourceAnalysisId: analysisId,
            sourceExcerpt: proposal.sourceExcerpt,
            confidence: proposal.confidence,
            createdAt: generatedAt
          });
        }
      }
      saveState();
      render();
      requestAnimationFrame(() => document.querySelector(finalise ? '.retrospective-analysis-result' : '.member-feedback-summary-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (error) {
      alert(error.message || 'The retrospective could not be analysed.');
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  async function ensureFeedbackLoaded(eventId, force = false) {
    if ((!force && feedbackCache.has(eventId)) || feedbackRequests.has(eventId)) return;
    feedbackRequests.add(eventId);
    try {
      const response = await fetch(`/api/feedback/events/${encodeURIComponent(eventId)}`);
      if (!response.ok) throw new Error(`Feedback service returned ${response.status}.`);
      feedbackCache.set(eventId, await response.json());
    } catch (error) {
      feedbackCache.set(eventId, { campaign: null, responses: [], error: error.message || 'Feedback could not be loaded.' });
    } finally {
      feedbackRequests.delete(eventId);
      if (state.activeView === 'retrospective' && state.activeEventId === eventId) render();
    }
  }

  function renderAttendeeFeedback(event) {
    const data = feedbackCache.get(event.id);
    if (!data) {
      return `<section class="playbook-section attendee-feedback-section"><div class="feedback-loading"><span>…</span><div><strong>Loading attendee feedback</strong><small>Checking for this event's anonymous feedback form and responses.</small></div></div></section>`;
    }
    if (data.error) {
      return `<section class="playbook-section attendee-feedback-section"><div class="feedback-error"><div><strong>Attendee feedback is temporarily unavailable</strong><p>${escapeHtml(data.error)}</p></div><button class="button button-secondary" data-action="retry-feedback">Try again</button></div></section>`;
    }

    const campaign = data.campaign;
    const responses = data.responses ?? [];
    const availability = data.availability ?? (campaign ? {
      isAcceptingResponses: campaign.isOpen === true,
      message: campaign.isOpen ? 'The form is configured to accept responses.' : 'The organiser has paused this feedback form.'
    } : null);
    const customQuestion = campaign?.questions?.find(question => question.id === 'custom-question')?.label ?? '';
    const closesOn = campaign?.closesOn ?? (event.eventDate ? addDaysToIsoDate(event.eventDate, 7) : '');
    const publicUrl = campaign ? `${location.origin}/feedback.html?token=${encodeURIComponent(campaign.publicToken)}` : '';
    return `<section class="playbook-section attendee-feedback-section">
      <header class="retrospective-section-heading">
        <div><span class="eyebrow">1 · Release member feedback</span><h3>Member feedback form</h3></div>
        <div class="feedback-response-total"><strong>${responses.length}</strong><span>response${responses.length === 1 ? '' : 's'}</span></div>
      </header>
      <div class="feedback-manager-grid ${campaign ? 'has-campaign' : ''}">
        <form id="feedbackCampaignForm" class="feedback-campaign-form">
          <div class="feedback-campaign-copy">
            <h4>${campaign ? 'Manage the public feedback form' : 'Create a public feedback form'}</h4>
            <p>The reusable link and QR code can be emailed, printed or displayed at or after the event. Responses do not contain attendee identities.</p>
          </div>
          <div class="feedback-campaign-fields">
            <label><span>Open from</span><input id="feedbackOpensOn" type="date" value="${escapeHtml(campaign?.opensOn ?? event.eventDate ?? '')}"></label>
            <label><span>Close after</span><input id="feedbackClosesOn" type="date" value="${escapeHtml(closesOn)}"></label>
            <label class="wide"><span>One optional event-specific question</span><input id="feedbackCustomQuestion" type="text" maxlength="240" value="${escapeHtml(customQuestion)}" placeholder="For example: What did you think of the entertainment?"></label>
            <label class="feedback-open-toggle"><input id="feedbackIsOpen" type="checkbox" ${campaign?.isOpen !== false ? 'checked' : ''}><span>Accept responses</span></label>
          </div>
          <button class="button button-primary" type="submit">${campaign ? 'Save feedback form' : 'Create link and QR code'}</button>
        </form>
        ${campaign ? `<aside class="feedback-share-card">
          <img src="/api/feedback/public/${encodeURIComponent(campaign.publicToken)}/qr.svg" alt="QR code linking to feedback for ${escapeHtml(event.name)}">
          <div><span class="feedback-status ${availability?.isAcceptingResponses ? 'open' : 'closed'}">${availability?.isAcceptingResponses ? 'Accepting responses' : 'Not accepting responses'}</span><h4>Share with attendees</h4><p>${escapeHtml(availability?.message ?? '')} Use the same link for email, ticketing integrations or a QR code at the event.</p></div>
          <input id="feedbackPublicUrl" type="text" readonly value="${escapeHtml(publicUrl)}" aria-label="Public feedback link">
          <div class="button-row"><button class="button button-secondary" type="button" data-action="copy-feedback-link">Copy link</button><a class="button button-secondary" href="${escapeHtml(publicUrl)}" target="_blank" rel="noopener">Open form</a><a class="button button-secondary" href="/api/feedback/public/${encodeURIComponent(campaign.publicToken)}/qr.svg" download="${escapeHtml(slugify(event.name))}-feedback-qr.svg">Download QR</a></div>
        </aside>` : ''}
      </div>
      ${campaign ? renderFeedbackResponses(campaign, responses) : ''}
    </section>`;
  }

  function renderFeedbackResponses(campaign, responses) {
    if (!responses.length) {
      return `<div class="feedback-empty"><span>◎</span><div><strong>No attendee responses yet</strong><p>Share the link or QR code. Anonymous responses will appear here as soon as they are submitted.</p></div></div>`;
    }
    const ratingQuestions = campaign.questions.filter(question => question.type === 'rating');
    const choiceQuestions = campaign.questions.filter(question => question.type === 'choice');
    const textQuestions = campaign.questions.filter(question => question.type === 'text');
    const textEntries = [];
    for (const response of responses) {
      for (const question of textQuestions) {
        const answer = feedbackAnswer(response, question.id);
        if (answer) textEntries.push({ response, question, answer });
      }
    }
    return `<div class="feedback-results">
      <header><div><span class="eyebrow">Response detail</span><h4>What members said</h4></div><small>Free-text comments remain anonymous. Finalising the retrospective analyses them and links supported learning to future planning.</small></header>
      <div class="feedback-metrics">
        ${ratingQuestions.map(question => {
          const values = responses.map(response => Number(feedbackAnswer(response, question.id))).filter(value => value >= 1 && value <= 5);
          const average = values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1) : '—';
          return `<div class="feedback-metric"><span>${escapeHtml(question.label)}</span><strong>${average}<small>${values.length ? ' / 5' : ''}</small></strong><em>${values.length} answer${values.length === 1 ? '' : 's'}</em></div>`;
        }).join('')}
        ${choiceQuestions.map(question => {
          const counts = question.options.map(option => [option, responses.filter(response => feedbackAnswer(response, question.id) === option).length]).filter(([, count]) => count > 0);
          return `<div class="feedback-metric choice-metric"><span>${escapeHtml(question.label)}</span>${counts.length ? counts.map(([option, count]) => `<div><strong>${escapeHtml(count)}</strong><em>${escapeHtml(option)}</em></div>`).join('') : '<em>No answers yet</em>'}</div>`;
        }).join('')}
      </div>
      <div class="feedback-comments-heading"><h4>Anonymous comments</h4><span>${textEntries.length}</span></div>
      <div class="feedback-comment-list">
        ${textEntries.length ? textEntries.map(entry => `<article class="feedback-comment"><span>${escapeHtml(entry.question.label)}</span><p>${escapeHtml(entry.answer)}</p><div><small>Submitted ${escapeHtml(new Date(entry.response.submittedAtUtc).toLocaleDateString('en-GB'))}</small><button class="text-button inline" type="button" data-seed-feedback-insight="${escapeHtml(entry.response.id)}" data-feedback-question="${escapeHtml(entry.question.id)}">Carry this learning forward</button></div></article>`).join('') : '<p class="help-text">No free-text comments have been submitted.</p>'}
      </div>
      ${renderInsightBuilder(campaign, responses)}
    </div>`;
  }

  function feedbackAnswer(response, questionId) {
    const value = response?.answers?.[questionId];
    return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
  }

  function renderInsightBuilder(campaign, responses) {
    return `<form id="carryForwardInsightForm" class="carry-forward-builder">
      <div class="carry-forward-builder-copy"><span class="eyebrow">Organiser approval</span><h4>Carry useful learning into the next event</h4><p>Review and rewrite the evidence as an operationally useful note. Only approved notes appear beside questions and tasks in a cloned event.</p></div>
      <div class="carry-forward-builder-fields">
        <label><span>Short title</span><input id="insightTitle" type="text" maxlength="120" required placeholder="For example: Include a non-spicy meal option"></label>
        <label><span>Show this learning beside</span><select id="insightTarget" required><option value="">Choose a planner area or task</option>${renderLearningTargetOptions()}</select></label>
        <label class="wide"><span>Learning for the next organiser</span><textarea id="insightSummary" rows="4" maxlength="1500" required placeholder="State what should be considered next time and why."></textarea></label>
        <label><span>Evidence</span><input id="insightEvidenceCount" type="number" min="1" max="${responses.length}" value="1"></label>
        <label><span>Importance</span><select id="insightImportance"><option value="consider">Consider</option><option value="important">Important</option><option value="critical">Critical</option></select></label>
      </div>
      <button class="button button-primary" type="submit">Approve and carry forward</button>
    </form>`;
  }

  function renderLearningTargetOptions(selectedValue = '') {
    return playbook.modules.map(module => `<optgroup label="${escapeHtml(module.title)}">
      <option value="module:${escapeHtml(module.id)}" ${selectedValue === `module:${module.id}` ? 'selected' : ''}>Whole module — ${escapeHtml(module.title)}</option>
      ${module.sections.map(section => `<option value="section:${escapeHtml(module.id)}:${escapeHtml(section.id)}" ${selectedValue === `section:${module.id}:${section.id}` ? 'selected' : ''}>Section — ${escapeHtml(section.title)}</option>${section.items.filter(item => ['question', 'task'].includes(item.type)).map(item => `<option value="item:${escapeHtml(item.id)}" ${selectedValue === `item:${item.id}` ? 'selected' : ''}>${item.type === 'task' ? 'Task' : 'Question'} — ${escapeHtml(item.title ?? item.label)}</option>`).join('')}`).join('')}
    </optgroup>`).join('');
  }

  function renderCarryForwardLibrary(event) {
    const insights = event.learningInsights ?? [];
    return `<section class="playbook-section carry-forward-library">
      <header class="retrospective-section-heading"><div><span class="eyebrow">Reusable knowledge</span><h3>Attached to the next running</h3></div><p>These notes will be shown directly beside the relevant questions and task cards when this event is cloned.</p></header>
      ${insights.length ? `<div class="carry-forward-list">${insights.map(insight => `<article><div><span class="insight-importance ${escapeHtml(insight.importance ?? 'consider')}">${escapeHtml(insight.importance ?? 'consider')}</span><h4>${escapeHtml(insight.title)}</h4><p>${escapeHtml(insight.summary)}</p><small>${escapeHtml(learningTargetLabel(insight))}${insight.sourceType === 'internal-retrospective' ? ' · internal retrospective' : Number(insight.evidenceCount) > 0 ? ` · ${escapeHtml(insight.evidenceCount)} member response${Number(insight.evidenceCount) === 1 ? '' : 's'}` : ' · organiser retrospective'}</small></div><button class="button button-secondary" type="button" data-remove-learning-insight="${escapeHtml(insight.id)}">Remove</button></article>`).join('')}</div>` : `<div class="feedback-empty"><span>↺</span><div><strong>No learning has been attached yet</strong><p>Complete the agile retrospective and finalise it to attach useful evidence to future planning.</p></div></div>`}
    </section>`;
  }

  function learningTargetLabel(insight) {
    const itemId = insight.targetItemIds?.[0];
    if (itemId) {
      const indexed = itemIndex.get(itemId);
      return indexed ? `${indexed.item.type === 'task' ? 'Task' : 'Question'}: ${indexed.item.title ?? indexed.item.label}` : 'Specific planner item';
    }
    const sectionId = insight.targetSectionIds?.[0];
    if (sectionId) {
      for (const module of playbook.modules) {
        const section = module.sections.find(candidate => candidate.id === sectionId);
        if (section) return `Section: ${section.title}`;
      }
    }
    const module = moduleIndex.get(insight.targetModuleIds?.[0]);
    return module ? `Module: ${module.title}` : 'Planner context';
  }

  function learningTargetFromValue(value) {
    const [targetType, firstId, secondId] = String(value ?? '').split(':');
    if (targetType === 'item' && firstId) {
      const indexed = itemIndex.get(firstId);
      return {
        targetItemId: firstId,
        targetModuleId: indexed?.module?.id ?? '',
        targetSectionId: indexed?.section?.id ?? ''
      };
    }
    if (targetType === 'section' && firstId && secondId) {
      return { targetItemId: '', targetModuleId: firstId, targetSectionId: secondId };
    }
    if (targetType === 'module' && firstId) {
      return { targetItemId: '', targetModuleId: firstId, targetSectionId: '' };
    }
    return { targetItemId: '', targetModuleId: '', targetSectionId: '' };
  }

  function renderRetrospectiveField(field, event) {
    const value = event.retrospective?.[field.id] ?? '';
    if (field.type === 'textarea') return `<label class="retro-field wide"><span>${escapeHtml(field.label)}</span><textarea rows="5" data-retro-field="${escapeHtml(field.id)}">${escapeHtml(value)}</textarea></label>`;
    if (field.type === 'yesNo') return `<div class="retro-field"><span>${escapeHtml(field.label)}</span><div class="choice-group yes-no-group"><button class="choice-button ${value === true ? 'selected' : ''}" data-retro-choice="${escapeHtml(field.id)}" data-value="true">Yes</button><button class="choice-button ${value === false ? 'selected' : ''}" data-retro-choice="${escapeHtml(field.id)}" data-value="false">No</button></div></div>`;
    const type = field.type === 'number' || field.type === 'currency' ? 'number' : 'text';
    const step = field.type === 'currency' ? '0.01' : '1';
    return `<label class="retro-field"><span>${escapeHtml(field.label)}</span><input type="${type}" step="${step}" value="${escapeHtml(value)}" data-retro-field="${escapeHtml(field.id)}"></label>`;
  }

  function roleRouteSummary(role) {
    if (role.id === 'event-coordinator') return 'Uses the organiser selected separately for each event';
    const linked = role.ownerContactId ? contactById(role.ownerContactId) : null;
    if (linked) return `${linked.name}${linked.email ? ` · ${linked.email}` : ' · no email configured'}`;
    if (role.mailboxEmail) return role.mailboxEmail;
    const inherited = role.fallbackRoleId ? roleById(role.fallbackRoleId) : null;
    return inherited ? `Falls back to ${inherited.name}` : 'No contact route configured';
  }

  function roleHasContactRoute(role) {
    if (!role) return false;
    if (role.id === 'event-coordinator') return true;
    return Boolean(contactForRole(role.id, null)?.email);
  }

  function explicitDirectoryReference(value) {
    return value && typeof value === 'object' && ['person', 'role'].includes(value.kind) && value.id
      ? { kind: value.kind, id: String(value.id) }
      : null;
  }

  function eventDirectoryAssignmentValues(event) {
    const values = [
      event.organiserRef,
      event.organiser,
      event.lifecycle?.decisionOwnerRef,
      event.lifecycle?.decisionOwner,
      event.lifecycle?.communicationsOwnerRef,
      event.lifecycle?.communicationsOwner,
      ...Object.values(event.answers ?? {})
    ];
    for (const taskState of Object.values(event.taskState ?? {})) {
      values.push(
        taskState?.assignmentKind && taskState?.assignmentId
          ? { kind: taskState.assignmentKind, id: taskState.assignmentId }
          : taskState?.assignee
      );
    }
    return values.filter(value => value !== undefined && value !== null && value !== '');
  }

  function roleReferenceUsesContact(roleId, event, contactId) {
    const role = roleById(roleId);
    if (!role) return false;
    if (role.ownerContactId === contactId) return true;
    return contactForRole(roleId, event)?.id === contactId;
  }

  function legacyAssignmentUsesContact(value, event, contact) {
    if (typeof value !== 'string') return false;
    const search = value.trim().toLocaleLowerCase();
    if (!search) return false;
    const matchingRole = responsibilityRoles().find(role => role.id.toLocaleLowerCase() === search || role.name.toLocaleLowerCase() === search);
    if (matchingRole && contact.type === 'mailbox' && !contact.email) return false;
    if (matchingRole && roleReferenceUsesContact(matchingRole.id, event, contact.id)) return true;
    const matchesContact = contact.name.toLocaleLowerCase() === search || Boolean(contact.email && contact.email.toLocaleLowerCase() === search);
    if (!matchesContact) return false;
    // Old prototype data sometimes created an empty mailbox contact with the
    // same name as a role. Treat that ambiguous string as the role so the
    // obsolete duplicate contact can still be removed safely.
    return true;
  }

  function contactEventUsage(contact) {
    return (state.events ?? []).filter(event => eventDirectoryAssignmentValues(event).some(value => {
      const reference = explicitDirectoryReference(value);
      if (reference?.kind === 'person') return reference.id === contact.id;
      if (reference?.kind === 'role') return roleReferenceUsesContact(reference.id, event, contact.id);
      return legacyAssignmentUsesContact(value, event, contact);
    }));
  }

  function roleEventUsage(role) {
    const roleId = role.id.toLocaleLowerCase();
    const roleName = role.name.toLocaleLowerCase();
    return (state.events ?? []).filter(event => eventDirectoryAssignmentValues(event).some(value => {
      const reference = explicitDirectoryReference(value);
      if (reference?.kind === 'role') return reference.id === role.id;
      if (typeof value !== 'string') return false;
      const search = value.trim().toLocaleLowerCase();
      return search === roleId || search === roleName;
    }));
  }

  function directoryRoleDeletionUsage(role) {
    const events = roleEventUsage(role);
    const taskDefinitions = [...itemIndex.values()].filter(indexed => indexed.item.defaultOwnerRoleId === role.id);
    const contacts = (state.contacts ?? []).filter(contact => contact.roleIds?.includes(role.id));
    const fallbackRoles = responsibilityRoles().filter(candidate => candidate.id !== role.id && candidate.fallbackRoleId === role.id);
    return {
      events,
      taskDefinitions,
      contacts,
      fallbackRoles,
      canDelete: events.length === 0 && taskDefinitions.length === 0 && contacts.length === 0 && fallbackRoles.length === 0
    };
  }

  function directoryRoleDeletionSummary(usage) {
    const reasons = [];
    if (usage.events.length) reasons.push(`${usage.events.length} event${usage.events.length === 1 ? '' : 's'}`);
    if (usage.taskDefinitions.length) reasons.push(`${usage.taskDefinitions.length} task definition${usage.taskDefinitions.length === 1 ? '' : 's'}`);
    if (usage.contacts.length) reasons.push(`${usage.contacts.length} contact${usage.contacts.length === 1 ? '' : 's'}`);
    if (usage.fallbackRoles.length) reasons.push(`the fallback route for ${usage.fallbackRoles.map(role => role.name).join(', ')}`);
    return reasons.join(', ');
  }

  function renderDirectory() {
    const activeContacts = (state.contacts ?? []).filter(contact => contact.active !== false);
    const activeRoles = responsibilityRoles().filter(role => role.active !== false);
    const loginContacts = activeContacts.filter(contact => contact.canLogin);
    const unroutedRoles = activeRoles.filter(role => !roleHasContactRoute(role));
    return `
      <section class="directory-overview">
        <div><span class="eyebrow">Shared directory</span><h2>People, contact routes and responsibilities</h2><p>Use stable people and role records everywhere the Playbook asks who owns a decision or task. Changing an email address or the person behind a role updates future notifications without rewriting every event.</p></div>
        <div class="directory-stats">
          <div><strong>${activeContacts.length}</strong><span>active contacts</span></div>
          <div><strong>${activeRoles.length}</strong><span>active roles</span></div>
          <div><strong>${loginContacts.length}</strong><span>login-enabled</span></div>
          <div class="${unroutedRoles.length ? 'warning' : ''}"><strong>${unroutedRoles.length}</strong><span>roles without a route</span></div>
        </div>
      </section>
      <section class="directory-login-note"><span>Login-ready directory</span><p>Platform permissions and login eligibility are recorded here now. Individual invitations and enforced access will use these records when production identity is connected.</p></section>
      <section class="directory-model-note"><strong>Roles describe the responsibility; contacts describe who can perform it.</strong><p>Event Coordinator is deliberately different: it always follows the named organiser selected for that event. Departmental roles such as Communications or Food &amp; Beverage may instead use a linked person or a shared fallback mailbox.</p></section>
      <div class="directory-layout">
        <section class="directory-panel directory-people-panel">
          <div class="directory-panel-heading"><div><span class="eyebrow">Contacts</span><h3>People and shared mailboxes</h3><p>Only active contacts allowed to receive tasks appear in assignment controls, and only for the operational roles they can perform.</p></div><button class="button button-primary" data-action="add-directory-contact">Add person</button></div>
          <div class="directory-card-list">${(state.contacts ?? []).map(renderDirectoryContact).join('')}</div>
        </section>
        <section class="directory-panel directory-roles-panel">
          <div class="directory-panel-heading"><div><span class="eyebrow">Responsibilities</span><h3>Assignable roles</h3><p>Most roles may route to a named person, shared mailbox or fallback role. Event Coordinator is resolved from each event instead.</p></div><button class="button button-secondary" data-action="add-directory-role">Add role</button></div>
          <div class="directory-card-list">${responsibilityRoles().map(renderDirectoryRole).join('')}</div>
        </section>
      </div>`;
  }

  function renderDirectoryContact(contact) {
    const roles = responsibilityRoles();
    const eventUsage = contactEventUsage(contact);
    const linkedRoles = roles.filter(role => role.ownerContactId === contact.id);
    const recordLabel = contact.type === 'mailbox' ? 'mailbox' : 'person';
    const usageNames = eventUsage.map(event => event.name || 'Untitled event');
    return `<article class="directory-card ${contact.active === false ? 'inactive' : ''}" data-directory-contact-id="${escapeHtml(contact.id)}">
      <div class="directory-card-heading">
        <div class="directory-avatar ${contact.type === 'mailbox' ? 'mailbox' : ''}">${contact.type === 'mailbox' ? '@' : escapeHtml((contact.name || '?').trim().charAt(0).toUpperCase())}</div>
        <div><strong>${escapeHtml(contact.name || 'New person')}</strong><small>${escapeHtml(contact.type === 'mailbox' ? 'Shared mailbox' : 'Person')}${contact.active === false ? ' · Inactive' : ''}</small></div>
        <label class="directory-active-toggle"><input type="checkbox" data-directory-contact-boolean="active" ${contact.active !== false ? 'checked' : ''}><span>Active</span></label>
      </div>
      <div class="directory-form-grid">
        <label><span>Contact type</span><select data-directory-contact-field="type"><option value="person" ${contact.type !== 'mailbox' ? 'selected' : ''}>Person</option><option value="mailbox" ${contact.type === 'mailbox' ? 'selected' : ''}>Shared mailbox</option></select></label>
        <label><span>Name</span><input type="text" value="${escapeHtml(contact.name)}" data-directory-contact-field="name" required></label>
        <label><span>Email address</span><input type="email" value="${escapeHtml(contact.email ?? '')}" data-directory-contact-field="email" placeholder="name@example.com"></label>
        <label><span>Telephone</span><input type="tel" value="${escapeHtml(contact.phone ?? '')}" data-directory-contact-field="phone" placeholder="Optional"></label>
      </div>
      <div class="directory-option-row">
        <label><input type="checkbox" data-directory-contact-boolean="canReceiveTasks" ${contact.canReceiveTasks !== false ? 'checked' : ''}><span>Can receive tasks</span></label>
        <label><input type="checkbox" data-directory-contact-boolean="canLogin" ${contact.canLogin ? 'checked' : ''}><span>Login enabled</span></label>
      </div>
      <fieldset class="directory-check-group"><legend>Operational roles this contact can perform</legend><div>
        ${roles.map(role => `<label><input type="checkbox" data-directory-contact-role="${escapeHtml(role.id)}" ${contact.roleIds?.includes(role.id) ? 'checked' : ''}><span>${escapeHtml(role.name)}</span></label>`).join('')}
      </div></fieldset>
      <fieldset class="directory-check-group platform"><legend>Platform permissions</legend><div>
        ${PLATFORM_ROLE_DEFINITIONS.map(role => `<label title="${escapeHtml(role.description)}"><input type="checkbox" data-directory-platform-role="${escapeHtml(role.id)}" ${contact.platformRoleIds?.includes(role.id) ? 'checked' : ''}><span>${escapeHtml(role.name)}</span></label>`).join('')}
      </div></fieldset>
      <label class="directory-notes"><span>Notes</span><input type="text" value="${escapeHtml(contact.notes ?? '')}" data-directory-contact-field="notes" placeholder="Optional contact or availability note"></label>
      <div class="directory-record-actions ${eventUsage.length ? 'protected' : ''}">
        <span>${eventUsage.length
          ? `<strong>Cannot delete:</strong> used by ${eventUsage.length} event${eventUsage.length === 1 ? '' : 's'} — ${escapeHtml(usageNames.slice(0, 3).join(', '))}${usageNames.length > 3 ? ` and ${usageNames.length - 3} more` : ''}`
          : linkedRoles.length
            ? `Not used by an event. Deleting will also unlink ${linkedRoles.length} role${linkedRoles.length === 1 ? '' : 's'}.`
            : 'Not used by an event and safe to delete.'}</span>
        <button type="button" class="directory-delete-button" data-delete-directory-contact="${escapeHtml(contact.id)}" ${eventUsage.length ? `disabled title="Used by ${escapeHtml(usageNames.join(', '))}"` : ''}>Delete ${recordLabel}</button>
      </div>
    </article>`;
  }

  function renderDirectoryRole(role) {
    const contacts = (state.contacts ?? []).filter(contact => contact.active !== false);
    const roles = responsibilityRoles().filter(candidate => candidate.id !== role.id);
    const deletionUsage = directoryRoleDeletionUsage(role);
    const usage = deletionUsage.taskDefinitions.length;
    const deletionSummary = directoryRoleDeletionSummary(deletionUsage);
    const dynamicEventCoordinator = role.id === 'event-coordinator';
    return `<article class="directory-card directory-role-card ${role.active === false ? 'inactive' : ''}" data-directory-role-id="${escapeHtml(role.id)}">
      <div class="directory-card-heading">
        <div class="directory-avatar role">R</div>
        <div><strong>${escapeHtml(role.name)}</strong><small>${escapeHtml(role.area || 'No area')} · default for ${usage} task${usage === 1 ? '' : 's'}</small></div>
        <label class="directory-active-toggle"><input type="checkbox" data-directory-role-boolean="active" ${role.active !== false ? 'checked' : ''}><span>Active</span></label>
      </div>
      <div class="directory-route-summary ${dynamicEventCoordinator ? 'dynamic' : roleHasContactRoute(role) ? '' : 'warning'}"><span>${dynamicEventCoordinator ? 'Per-event role' : 'Current route'}</span><strong>${escapeHtml(roleRouteSummary(role))}</strong></div>
      <div class="directory-form-grid">
        <label><span>Role name</span><input type="text" value="${escapeHtml(role.name)}" data-directory-role-field="name" required></label>
        <label><span>Operational area</span><input type="text" value="${escapeHtml(role.area ?? '')}" data-directory-role-field="area" placeholder="For example Communications"></label>
        ${dynamicEventCoordinator
          ? `<div class="directory-dynamic-role-note"><strong>No default mailbox is needed.</strong><span>Mark the appropriate people as able to perform Event Coordinator. The organiser chosen when an event is created becomes its coordinator.</span></div>`
          : `<label><span>Linked person or mailbox</span><select data-directory-role-field="ownerContactId"><option value="">Not linked</option>${contacts.map(contact => `<option value="${escapeHtml(contact.id)}" ${role.ownerContactId === contact.id ? 'selected' : ''}>${escapeHtml(contact.name)}${contact.email ? ` · ${escapeHtml(contact.email)}` : ''}</option>`).join('')}</select></label>
            <label><span>Fallback mailbox email</span><input type="email" value="${escapeHtml(role.mailboxEmail ?? '')}" data-directory-role-field="mailboxEmail" placeholder="Optional, used when no person is linked"><small>Use this for a genuine shared departmental address. It does not create another contact record.</small></label>
            <label><span>Fallback role</span><select data-directory-role-field="fallbackRoleId"><option value="">No fallback</option>${roles.map(candidate => `<option value="${escapeHtml(candidate.id)}" ${role.fallbackRoleId === candidate.id ? 'selected' : ''}>${escapeHtml(candidate.name)}</option>`).join('')}</select></label>`}
      </div>
      <div class="directory-option-row"><label><input type="checkbox" data-directory-role-boolean="selectableForTasks" ${role.selectableForTasks !== false ? 'checked' : ''}><span>Available in task assignment controls</span></label></div>
      <small class="directory-record-id">Stable role ID: ${escapeHtml(role.id)}</small>
      <div class="directory-record-actions ${deletionUsage.canDelete ? '' : 'protected'}">
        <span>${deletionUsage.canDelete
          ? 'Not used by an event, task, contact or fallback role and safe to delete.'
          : `<strong>Cannot delete:</strong> used by ${escapeHtml(deletionSummary)}.`}</span>
        <button type="button" class="directory-delete-button" data-delete-directory-role="${escapeHtml(role.id)}" ${deletionUsage.canDelete ? '' : `disabled title="Used by ${escapeHtml(deletionSummary)}"`}>Delete role</button>
      </div>
    </article>`;
  }

  async function ensurePluginSettingsLoaded(force = false) {
    if (pluginSettingsCache && !force) return pluginSettingsCache;
    if (pluginSettingsRequest && !force) return pluginSettingsRequest;

    pluginSettingsRequest = (async () => {
      try {
        const response = await fetch('/api/admin/plugins', { cache: 'no-store' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `Plugin settings could not be loaded (${response.status}).`);
        pluginSettingsCache = payload;
        updatePluginCapabilities(payload);
      } catch (error) {
        pluginSettingsCache = { error: error.message || 'Plugin settings could not be loaded.' };
      } finally {
        pluginSettingsRequest = null;
      }

      if (state.activeView === 'plugins') render();
      return pluginSettingsCache;
    })();

    return pluginSettingsRequest;
  }

  async function ensureIntegrationActivityLoaded(force = false) {
    if (integrationActivityCache && !force) return integrationActivityCache;
    if (integrationActivityRequest && !force) return integrationActivityRequest;

    integrationActivityRequest = (async () => {
      try {
        const response = await fetch('/api/admin/integration-activity?limit=100', { cache: 'no-store' });
        const payload = await response.json().catch(() => ([]));
        if (!response.ok) {
          throw new Error(payload.error || `Integration activity could not be loaded (${response.status}).`);
        }
        integrationActivityCache = Array.isArray(payload) ? payload : [];
      } catch (error) {
        integrationActivityCache = { error: error.message || 'Integration activity could not be loaded.' };
      } finally {
        integrationActivityRequest = null;
      }

      if (state.activeView === 'plugins') render();
      return integrationActivityCache;
    })();

    return integrationActivityRequest;
  }

  const pluginUiDefinitions = Object.freeze({
    'intelligent-golf': {
      name: 'Intelligent Golf',
      cacheKey: 'intelligentGolf',
      capabilityKey: 'intelligentGolfEnabled',
      dialogId: 'intelligent-golf-plugin-dialog',
      enabledInputId: 'ig-plugin-enabled'
    },
    monday: {
      name: 'Monday.com',
      cacheKey: 'monday',
      capabilityKey: 'mondayEnabled',
      dialogId: 'monday-plugin-dialog',
      enabledInputId: 'monday-plugin-enabled'
    },
    yodeck: {
      name: 'Yodeck',
      cacheKey: 'yodeck',
      capabilityKey: 'yodeckEnabled',
      dialogId: 'yodeck-plugin-dialog',
      enabledInputId: 'yodeck-plugin-enabled'
    }
  });

  function pluginUiDefinition(pluginId) {
    return pluginUiDefinitions[String(pluginId ?? '').trim().toLowerCase()] ?? null;
  }

  function pluginStatus(summary) {
    if (summary?.enabled && summary?.configured) return { label: 'Active', className: 'enabled' };
    if (summary?.configured) return { label: 'Ready', className: 'configured' };
    return { label: 'Setup required', className: 'unconfigured' };
  }

  function renderPluginModuleSwitch(pluginId, pluginName, summary) {
    const enabled = summary?.enabled === true;
    return `<button class="plugin-module-switch ${enabled ? 'on' : 'off'}" type="button" data-toggle-plugin="${escapeHtml(pluginId)}" aria-pressed="${enabled}" aria-label="Turn ${escapeHtml(pluginName)} ${enabled ? 'off' : 'on'}">
      <span class="plugin-module-switch-copy"><small>Module</small><strong>${enabled ? 'On' : 'Off'}</strong></span>
      <span class="plugin-module-switch-track" aria-hidden="true"><i></i></span>
    </button>`;
  }

  function pluginUpdatedLabel(value) {
    if (!value) return 'Not configured yet';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? 'Settings saved'
      : `Updated ${date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`;
  }

  function integrationActivityDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? 'Time unavailable'
      : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium' });
  }

  function renderIntegrationActivity() {
    if (!integrationActivityCache) {
      return `<section class="integration-activity-panel" aria-busy="true">
        <header><div><span class="eyebrow">Diagnostics</span><h3>Integration activity</h3><p>Loading recent operations…</p></div></header>
      </section>`;
    }

    if (integrationActivityCache.error) {
      return `<section class="integration-activity-panel">
        <header><div><span class="eyebrow">Diagnostics</span><h3>Integration activity</h3><p>${escapeHtml(integrationActivityCache.error)}</p></div><button class="button button-secondary" type="button" data-refresh-integration-activity>Try again</button></header>
      </section>`;
    }

    const entries = integrationActivityCache;
    return `<section class="integration-activity-panel">
      <header><div><span class="eyebrow">Diagnostics</span><h3>Integration activity</h3><p>Recent external operations are retained here without credentials, session cookies or submitted request bodies.</p></div><button class="button button-secondary" type="button" data-refresh-integration-activity>Refresh</button></header>
      ${entries.length
        ? `<div class="integration-activity-list">${entries.map(entry => {
            const succeeded = entry.outcome === 'succeeded';
            const actionRequired = entry.outcome === 'action-required';
            const outcomeLabel = succeeded ? 'Succeeded' : actionRequired ? 'Action required' : 'Failed';
            const outcomeIcon = succeeded ? '✓' : actionRequired ? '?' : '!';
            const eventLabel = entry.eventName || entry.eventPlaybookEventId || 'No event recorded';
            const integration = entry.integration || 'Integration';
            const isIntelligentGolf = integration.toLowerCase() === 'intelligent golf';
            const isYodeck = integration.toLowerCase() === 'yodeck';
            const identifiers = [
              integration,
              entry.externalEventId ? `${isIntelligentGolf ? 'IG' : 'External'} event ${entry.externalEventId}` : '',
              entry.externalRecordId ? `${isYodeck ? 'Yodeck media' : isIntelligentGolf ? 'IG record' : 'External record'} ${entry.externalRecordId}` : '',
              entry.stage ? `Stage: ${entry.stage}` : '',
              entry.statusCode ? `HTTP ${entry.statusCode}` : ''
            ].filter(Boolean);
            return `<article class="integration-activity-row ${succeeded ? 'succeeded' : actionRequired ? 'action-required' : 'failed'}">
              <span class="integration-activity-result" aria-label="${outcomeLabel}">${outcomeIcon}</span>
              <div class="integration-activity-copy"><div><strong>${escapeHtml(entry.operation || 'Integration operation')}</strong><time datetime="${escapeHtml(entry.occurredAtUtc || '')}">${escapeHtml(integrationActivityDate(entry.occurredAtUtc))}</time></div><p>${escapeHtml(entry.message || '')}</p><small>${escapeHtml(eventLabel)}${identifiers.length ? ` · ${escapeHtml(identifiers.join(' · '))}` : ''}</small></div>
            </article>`;
          }).join('')}</div>`
        : `<div class="integration-activity-empty"><strong>No integration activity yet</strong><p>Attempts to synchronise an event, publish a member diary entry or send artwork to the clubhouse screens will appear here.</p></div>`}
    </section>`;
  }

  function renderPluginAdministration() {
    if (!pluginSettingsCache) {
      return `<section class="plugin-admin-intro"><div><span class="eyebrow">Application administration</span><h2>Plugins & integrations</h2><p>Connect the Playbook to the systems used by the club without putting passwords or tokens into the browser.</p></div></section>
        <section class="plugin-admin-grid" aria-busy="true">
          <article class="plugin-card plugin-card-loading"><div class="plugin-card-icon">IG</div><div><h3>Intelligent Golf</h3><p>Loading secure configuration…</p></div></article>
          <article class="plugin-card plugin-card-loading"><div class="plugin-card-icon monday">M</div><div><h3>Monday.com</h3><p>Loading secure configuration…</p></div></article>
          <article class="plugin-card plugin-card-loading"><div class="plugin-card-icon yodeck">YD</div><div><h3>Yodeck</h3><p>Loading secure configuration…</p></div></article>
        </section>`;
    }

    if (pluginSettingsCache.error) {
      return `<section class="plugin-admin-intro"><div><span class="eyebrow">Application administration</span><h2>Plugins & integrations</h2><p>Connect the Playbook to the systems used by the club without putting passwords or tokens into the browser.</p></div></section>
        <section class="plugin-load-error" role="alert"><strong>Plugin settings could not be loaded</strong><span>${escapeHtml(pluginSettingsCache.error)}</span><button class="button button-secondary" type="button" data-action="reload-plugin-settings">Try again</button></section>`;
    }

    const intelligentGolf = pluginSettingsCache.intelligentGolf ?? {};
    const monday = pluginSettingsCache.monday ?? {};
    const yodeck = pluginSettingsCache.yodeck ?? {};
    const intelligentGolfStatus = pluginStatus(intelligentGolf);
    const mondayStatus = pluginStatus(monday);
    const yodeckStatus = pluginStatus(yodeck);

    return `
      <section class="plugin-admin-intro">
        <div><span class="eyebrow">Application administration</span><h2>Plugins & integrations</h2><p>Connect the Playbook to the systems used by the club. Credentials are encrypted on the server and are never shown again after they have been saved.</p></div>
      </section>
      ${pluginSettingsNotice ? `<div class="plugin-settings-notice" role="status">${escapeHtml(pluginSettingsNotice)}</div>` : ''}
      <section class="plugin-admin-grid">
        <article class="plugin-card ${intelligentGolf.enabled ? 'plugin-on' : 'plugin-off'}">
          <header class="plugin-card-header"><div class="plugin-card-icon">IG</div><div class="plugin-card-title"><span class="plugin-status ${intelligentGolfStatus.className}">${escapeHtml(intelligentGolfStatus.label)}</span><h3>Intelligent Golf</h3><p>Club diary, member communications and event information.</p></div>${renderPluginModuleSwitch('intelligent-golf', 'Intelligent Golf', intelligentGolf)}</header>
          <div class="plugin-card-body">
            <p>Keep the club login credentials and member-communication sender details together in one protected integration.</p>
            <dl class="plugin-facts">
              <div><dt>Club site</dt><dd>${escapeHtml(intelligentGolf.siteUrl || 'Not set')}</dd></div>
              <div><dt>Member ID / username</dt><dd>${intelligentGolf.hasMemberId ? 'Saved securely' : 'Not set'}</dd></div>
              <div><dt>Member PIN / password</dt><dd>${intelligentGolf.hasMemberPassword ? 'Saved securely' : 'Not set'}</dd></div>
              <div><dt>Administrator password</dt><dd>${intelligentGolf.hasAdminPassword ? 'Saved securely' : 'Not set'}</dd></div>
              <div><dt>Member email sender</dt><dd>${intelligentGolf.emailConfigured ? escapeHtml(`${intelligentGolf.emailFromName} · ${intelligentGolf.emailFromAddress} · member ${intelligentGolf.emailSenderMemberNumber}`) : 'Not configured'}</dd></div>
            </dl>
          </div>
          <footer class="plugin-card-actions"><small>${escapeHtml(pluginUpdatedLabel(intelligentGolf.updatedAtUtc))}</small><button class="button button-primary" type="button" data-configure-plugin="intelligent-golf">${intelligentGolf.configured ? 'Update settings' : 'Configure'}</button></footer>
        </article>

        <article class="plugin-card ${monday.enabled ? 'plugin-on' : 'plugin-off'}">
          <header class="plugin-card-header"><div class="plugin-card-icon monday">M</div><div class="plugin-card-title"><span class="plugin-status ${mondayStatus.className}">${escapeHtml(mondayStatus.label)}</span><h3>Monday.com</h3><p>Workflow and task integration for operational teams.</p></div>${renderPluginModuleSwitch('monday', 'Monday.com', monday)}</header>
          <div class="plugin-card-body">
            <p>Use a personal API token for this club-owned prototype. Workspace and board IDs identify the initial destination for future task synchronisation.</p>
            <dl class="plugin-facts">
              <div><dt>API token</dt><dd>${monday.hasApiToken ? 'Saved securely' : 'Not set'}</dd></div>
              <div><dt>Workspace ID</dt><dd>${escapeHtml(monday.workspaceId || 'Not set')}</dd></div>
              <div><dt>Board ID</dt><dd>${escapeHtml(monday.boardId || 'Not set')}</dd></div>
              <div><dt>Authentication</dt><dd>Personal API token</dd></div>
            </dl>
          </div>
          <footer class="plugin-card-actions"><small>${escapeHtml(pluginUpdatedLabel(monday.updatedAtUtc))}</small><button class="button button-primary" type="button" data-configure-plugin="monday">${monday.configured ? 'Update settings' : 'Configure'}</button></footer>
        </article>

        <article class="plugin-card ${yodeck.enabled ? 'plugin-on' : 'plugin-off'}">
          <header class="plugin-card-header"><div class="plugin-card-icon yodeck">YD</div><div class="plugin-card-title"><span class="plugin-status ${yodeckStatus.className}">${escapeHtml(yodeckStatus.label)}</span><h3>Yodeck</h3><p>Clubhouse digital-screen artwork and playlist publishing.</p></div>${renderPluginModuleSwitch('yodeck', 'Yodeck', yodeck)}</header>
          <div class="plugin-card-body">
            <p>Upload finished campaign artwork to Yodeck, keep it in the configured clubhouse playlist and push playlist changes to the screens.</p>
            <dl class="plugin-facts">
              <div><dt>API token</dt><dd>${yodeck.hasApiToken ? 'Saved securely' : 'Not set'}</dd></div>
              <div><dt>Playlist ID</dt><dd>${yodeck.playlistId > 0 ? escapeHtml(String(yodeck.playlistId)) : 'Not set'}</dd></div>
              <div><dt>Destination name</dt><dd>${escapeHtml(yodeck.playlistName || 'Clubhouse')}</dd></div>
              <div><dt>Artwork duration</dt><dd>${Number(yodeck.mediaDurationSeconds) > 0 ? `${escapeHtml(String(yodeck.mediaDurationSeconds))} seconds` : '15 seconds'}</dd></div>
            </dl>
          </div>
          <footer class="plugin-card-actions"><small>${escapeHtml(pluginUpdatedLabel(yodeck.updatedAtUtc))}</small><button class="button button-primary" type="button" data-configure-plugin="yodeck">${yodeck.configured ? 'Update settings' : 'Configure'}</button></footer>
        </article>
      </section>
      ${renderIntegrationActivity()}`;
  }

  function renderPluginDialogs() {
    if (!pluginSettingsCache || pluginSettingsCache.error) return '';
    const intelligentGolf = pluginSettingsCache.intelligentGolf ?? {};
    const monday = pluginSettingsCache.monday ?? {};
    const yodeck = pluginSettingsCache.yodeck ?? {};
    return `
      <dialog id="intelligent-golf-plugin-dialog" class="plugin-dialog">
        <form id="intelligent-golf-plugin-form">
          <header class="modal-heading"><div><span class="eyebrow">Plugin settings</span><h2>Configure Intelligent Golf</h2><p>Save the club login and the identity used for member communications.</p></div><button class="icon-button" type="button" data-close-plugin-dialog aria-label="Close">×</button></header>
          <div class="plugin-dialog-body">
            <div class="plugin-dialog-guidance"><strong>Login secrets cannot be revealed</strong><p>Saved passwords are never returned to this page. Leave a login secret blank to retain it; the non-secret email sender details remain visible and editable below.</p></div>
            <label class="wide"><span>Intelligent Golf club site</span><input id="ig-plugin-site-url" type="url" inputmode="url" autocomplete="url" placeholder="https://yourclub.intelligentgolf.co.uk" value="${escapeHtml(intelligentGolf.siteUrl || '')}"><small>Use the complete https address for the club’s Intelligent Golf site.</small></label>
            <label><span>Member ID / username</span><input id="ig-plugin-member-id" type="password" autocomplete="new-password" spellcheck="false" placeholder="${intelligentGolf.hasMemberId ? 'Saved — leave blank to keep' : 'Enter the member ID'}"></label>
            <label><span>Member PIN / password</span><input id="ig-plugin-member-password" type="password" autocomplete="new-password" spellcheck="false" placeholder="${intelligentGolf.hasMemberPassword ? 'Saved — leave blank to keep' : 'Enter the member PIN or password'}"></label>
            <label class="wide"><span>Administrator password</span><input id="ig-plugin-admin-password" type="password" autocomplete="new-password" spellcheck="false" placeholder="${intelligentGolf.hasAdminPassword ? 'Saved — leave blank to keep' : 'Enter the administrator password'}"><small>This is the separate administrator credential used when the integration performs privileged actions.</small></label>
            <div class="plugin-dialog-subheading"><strong>Member email sender</strong><p>These details identify the club account used for tests and campaigns sent through Intelligent Golf.</p></div>
            <label><span>Sender member number</span><input id="ig-plugin-email-sender-member-number" type="number" min="1" step="1" inputmode="numeric" value="${escapeHtml(intelligentGolf.emailSenderMemberNumber || '')}" placeholder="3104"><small>The Intelligent Golf member record used to send the message.</small></label>
            <label><span>Sender name</span><input id="ig-plugin-email-from-name" type="text" maxlength="500" value="${escapeHtml(intelligentGolf.emailFromName || '')}" placeholder="Simon Parsons"></label>
            <label class="wide"><span>Sender email address</span><input id="ig-plugin-email-from-address" type="email" maxlength="500" value="${escapeHtml(intelligentGolf.emailFromAddress || '')}" placeholder="comms@botgc.co.uk"><small>This appears in the From field of test and member campaign emails.</small></label>
            <label class="plugin-enabled-control wide"><input id="ig-plugin-enabled" type="checkbox" ${intelligentGolf.enabled ? 'checked' : ''}><span><strong>Enable this plugin</strong><small>When enabled, the server validates these credentials and establishes a secure API session.</small></span></label>
          </div>
          <footer class="modal-actions">${intelligentGolf.configured ? '<button class="button button-danger plugin-disconnect-button" type="button" data-disconnect-plugin="intelligent-golf">Remove credentials</button>' : ''}<span></span><button class="button button-secondary" type="button" data-close-plugin-dialog>Cancel</button><button class="button button-primary" type="submit">Save Intelligent Golf</button></footer>
        </form>
      </dialog>

      <dialog id="monday-plugin-dialog" class="plugin-dialog">
        <form id="monday-plugin-form">
          <header class="modal-heading"><div><span class="eyebrow">Plugin settings</span><h2>Configure Monday.com</h2><p>Connect the prototype using a personal API token held by an appropriate Monday.com user.</p></div><button class="icon-button" type="button" data-close-plugin-dialog aria-label="Close">×</button></header>
          <div class="plugin-dialog-body">
            <div class="plugin-dialog-guidance"><strong>Token permissions follow the Monday.com user</strong><p>The integration can only see and change boards that the token owner is allowed to access. Leave the token blank to retain the saved value.</p></div>
            <label class="wide"><span>Personal API token</span><input id="monday-plugin-token" type="password" autocomplete="new-password" spellcheck="false" placeholder="${monday.hasApiToken ? 'Saved — leave blank to keep' : 'Paste the Monday.com API token'}"></label>
            <label><span>Workspace ID <em>optional</em></span><input id="monday-plugin-workspace" type="text" inputmode="numeric" autocomplete="off" value="${escapeHtml(monday.workspaceId || '')}" placeholder="Workspace ID"></label>
            <label><span>Board ID <em>optional</em></span><input id="monday-plugin-board" type="text" inputmode="numeric" autocomplete="off" value="${escapeHtml(monday.boardId || '')}" placeholder="Board ID"></label>
            <label class="plugin-enabled-control wide"><input id="monday-plugin-enabled" type="checkbox" ${monday.enabled ? 'checked' : ''}><span><strong>Enable this plugin</strong><small>The token must be saved before the plugin can be enabled.</small></span></label>
          </div>
          <footer class="modal-actions">${monday.configured ? '<button class="button button-danger plugin-disconnect-button" type="button" data-disconnect-plugin="monday">Remove credentials</button>' : ''}<span></span><button class="button button-secondary" type="button" data-close-plugin-dialog>Cancel</button><button class="button button-primary" type="submit">Save Monday.com</button></footer>
        </form>
      </dialog>

      <dialog id="yodeck-plugin-dialog" class="plugin-dialog">
        <form id="yodeck-plugin-form">
          <header class="modal-heading"><div><span class="eyebrow">Plugin settings</span><h2>Configure Yodeck</h2><p>Connect Event Playbook to the existing clubhouse-screen playlist.</p></div><button class="icon-button" type="button" data-close-plugin-dialog aria-label="Close">×</button></header>
          <div class="plugin-dialog-body">
            <div class="plugin-dialog-guidance"><strong>The API token cannot be revealed</strong><p>Use a Yodeck token with Media, Playlists, Screens and Push to Screens access. Leave the token blank to retain the saved value.</p></div>
            <label class="wide"><span>API token</span><input id="yodeck-plugin-token" type="password" autocomplete="new-password" spellcheck="false" placeholder="${yodeck.hasApiToken ? 'Saved — leave blank to keep' : 'Paste the Yodeck API token'}"></label>
            <label><span>Clubhouse playlist ID</span><input id="yodeck-plugin-playlist-id" type="number" min="1" step="1" inputmode="numeric" value="${yodeck.playlistId > 0 ? escapeHtml(String(yodeck.playlistId)) : ''}" placeholder="12345"><small>The numeric ID of the existing playlist assigned to the clubhouse screens.</small></label>
            <label><span>Destination name</span><input id="yodeck-plugin-playlist-name" type="text" maxlength="500" value="${escapeHtml(yodeck.playlistName || 'Clubhouse')}" placeholder="Clubhouse"><small>The friendly name shown to people publishing artwork.</small></label>
            <label><span>Artwork duration</span><input id="yodeck-plugin-media-duration" type="number" min="5" max="300" step="1" inputmode="numeric" value="${escapeHtml(String(yodeck.mediaDurationSeconds || 15))}"><small>Seconds each poster remains visible within the playlist.</small></label>
            <label class="plugin-enabled-control wide"><input id="yodeck-plugin-enabled" type="checkbox" ${yodeck.enabled ? 'checked' : ''}><span><strong>Enable this plugin</strong><small>The token and playlist ID must be saved before clubhouse-screen controls are shown.</small></span></label>
          </div>
          <footer class="modal-actions">${yodeck.configured ? '<button class="button button-danger plugin-disconnect-button" type="button" data-disconnect-plugin="yodeck">Remove credentials</button>' : ''}<span></span><button class="button button-secondary" type="button" data-close-plugin-dialog>Cancel</button><button class="button button-primary" type="submit">Save Yodeck</button></footer>
        </form>
      </dialog>`;
  }

  function renderAdmin() {
    return `
      <section class="page-header"><div><div class="eyebrow">Configuration</div><h2>Playbook admin</h2><p>Extend the data-driven Playbook without changing application code. People and responsibilities are maintained on the dedicated People & Roles page.</p></div><button class="button button-secondary" data-view="directory">Open People & Roles</button></section>
      <section id="playbook-assistant-root" class="playbook-assistant-host" aria-label="Playbook Assistant"></section>
      <section class="admin-branding-card" aria-labelledby="club-identity-heading">
        <div class="admin-branding-preview">
          <span class="eyebrow">Club identity</span>
          <div class="admin-branding-lockup">
            <span class="admin-branding-crest"><img id="club-branding-preview" src="${escapeHtml(clubBranding.crestUrl)}" alt="${escapeHtml(clubBranding.clubName)} crest"></span>
            <div><h3 id="club-identity-heading">${escapeHtml(clubBranding.clubName)}</h3><p>Event Playbook</p></div>
          </div>
          <small>This is the identity people see in the navigation, login and shared event pages.</small>
        </div>
        <form id="club-branding-form" class="admin-branding-form">
          <div class="admin-branding-heading"><div><span class="eyebrow">Application branding</span><h3>Club name and crest</h3></div><span class="admin-branding-status">${clubBranding.hasCustomCrest ? 'Custom crest in use' : 'Default crest in use'}</span></div>
          <label class="admin-branding-field"><span>Club name</span><input id="club-branding-name" name="clubName" type="text" maxlength="120" required autocomplete="organization" value="${escapeHtml(clubBranding.clubName)}"><small>Used anywhere the application identifies the club.</small></label>
          <label class="admin-branding-upload" for="club-branding-crest">
            <span class="admin-branding-upload-icon" aria-hidden="true">↑</span>
            <span><strong>Upload a club crest</strong><small>PNG, JPEG or WebP · up to 5 MB. A transparent PNG works best.</small></span>
            <input id="club-branding-crest" name="crest" type="file" accept="image/png,image/jpeg,image/webp">
          </label>
          <div class="admin-branding-actions">
            <button class="button button-primary" type="submit">Save club identity</button>
            ${clubBranding.hasCustomCrest ? '<button class="button button-secondary" type="button" data-remove-custom-crest>Use default crest</button>' : ''}
          </div>
          ${clubBrandingNotice ? `<div class="admin-branding-notice" role="status">${escapeHtml(clubBrandingNotice)}</div>` : ''}
        </form>
      </section>
      <section class="admin-grid">
        <article class="admin-card"><div class="section-heading"><h3>Add a question or task</h3></div>
          <div class="admin-form">
            <label><span>Module</span><select id="admin-module">${playbook.modules.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.title)}</option>`).join('')}</select></label>
            <label><span>Section</span><select id="admin-section">${playbook.modules[0].sections.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.title)}</option>`).join('')}</select></label>
            <label><span>Type</span><select id="admin-type"><option value="question">Question</option><option value="task">Task</option></select></label>
            <label class="wide"><span>Question / task wording</span><input id="admin-wording" type="text"></label>
            <label><span>Answer type</span><select id="admin-answer-type"><option value="yesNo">Yes / No</option><option value="text">Text</option><option value="time">Time</option><option value="number">Number</option><option value="assignment">Person or role</option></select></label>
            <label><span>Deadline code (tasks)</span><select id="admin-deadline"><option value="">None</option>${playbook.deadlineCodes.map(d => `<option value="${escapeHtml(d.code)}">${escapeHtml(d.code)}</option>`).join('')}</select></label>
            <label><span>Include in staff briefing</span><select id="admin-staff-briefing-phase"><option value="">No — planning task</option><option value="before-event">Before guests arrive</option><option value="event-day">During the event</option><option value="after-event">Close-down / afterwards</option></select></label>
            <label><span>Staff audience</span><input id="admin-staff-briefing-audience" type="text" placeholder="e.g. Kitchen, Bar or Greens"></label>
            <label class="wide"><span>Staff briefing instruction</span><input id="admin-staff-briefing-instruction" type="text" placeholder="A direct practical instruction for the staff delivering the event"></label>
            <label><span>Default owner role</span><select id="admin-role"><option value="">None</option>${responsibilityRoles().map(r => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`).join('')}</select></label>
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

  function applyPlaybookTemplateDocument(document, { renderAfter = true } = {}) {
    if (!document?.template || typeof document.template !== 'object') {
      throw new Error('The server returned an invalid Playbook template.');
    }
    const candidate = migratePlaybookMilestoneCodes(structuredClone(document.template));
    validatePlaybook(candidate);
    playbook = candidate;
    playbookTemplateRevision = Number(document.revision) || 0;
    if (pendingPlaybookTemplateDocument && Number(pendingPlaybookTemplateDocument.revision) <= playbookTemplateRevision) {
      pendingPlaybookTemplateDocument = null;
    }
    protectedQuestionIds = Array.isArray(document.protectedQuestionIds) ? document.protectedQuestionIds.map(String) : protectedQuestionIds;
    playbookTemplateNeedsMigration = false;
    localStorage.setItem(STORAGE_TEMPLATE, JSON.stringify(playbook));
    indexPlaybook();
    migrateAdmissionPlanningState();
    migrateAdmissionModelV38();
    migrateAdmissionPricingState();
    migrateFoodServiceReviewCompletionState();
    migrateEventControlStateV37();
    saveState();
    if (renderAfter) render();
  }

  function mountPendingPlaybookTemplateNotice() {
    document.getElementById('playbook-template-update-notice')?.remove();
    if (!pendingPlaybookTemplateDocument || Number(pendingPlaybookTemplateDocument.revision) <= playbookTemplateRevision) return;
    const notice = document.createElement('aside');
    notice.id = 'playbook-template-update-notice';
    notice.className = 'playbook-template-update-notice';
    notice.setAttribute('role', 'status');
    notice.innerHTML = `
      <div>
        <strong>The club Playbook configuration has changed.</strong>
        <span>Load the approved question and task updates when you are ready. Your event answers and task history are retained by their stable IDs.</span>
      </div>
      <button class="button button-primary" type="button">Load latest Playbook</button>`;
    notice.querySelector('button')?.addEventListener('click', () => {
      const latest = pendingPlaybookTemplateDocument;
      if (!latest) return;
      applyPlaybookTemplateDocument(latest);
    });
    (document.querySelector('.main-content') ?? app).prepend(notice);
  }

  async function pollPlaybookTemplate() {
    if (!playbook || document.visibilityState === 'hidden') return;
    try {
      const response = await fetch('/api/playbook/template', { cache: 'no-store' });
      if (!response.ok) return;
      const document = await response.json();
      if (!document?.template || Number(document.revision) <= playbookTemplateRevision) return;
      pendingPlaybookTemplateDocument = document;
      mountPendingPlaybookTemplateNotice();
    } catch (error) {
      console.warn('The latest club Playbook configuration could not be checked.', error);
    }
  }

  function startPlaybookTemplatePolling() {
    if (playbookTemplatePollTimer) return;
    playbookTemplatePollTimer = window.setInterval(pollPlaybookTemplate, 30_000);
  }

  async function persistPlaybookTemplate(candidate, source = 'administrator') {
    validatePlaybook(candidate);
    const response = await fetch('/api/admin/playbook/template', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedRevision: playbookTemplateRevision,
        template: candidate,
        source
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 409 && result.current?.template) {
        applyPlaybookTemplateDocument(result.current, { renderAfter: false });
        window.setTimeout(render, 0);
        const conflict = new Error('Another administrator updated the club Playbook while you were working. The latest version has been loaded; your draft changes are still available to review and publish again.');
        conflict.status = response.status;
        conflict.current = result.current;
        throw conflict;
      }
      const error = new Error(result.error || result.detail || `The Playbook could not be published (${response.status}).`);
      error.status = response.status;
      error.current = result.current;
      throw error;
    }
    applyPlaybookTemplateDocument(result, { renderAfter: false });
    return result;
  }

  function validTicketTypesAnswer(value) {
    return Array.isArray(value) && value.length > 0 && value.every(entry => {
      const name = String(entry?.name ?? '').trim();
      const price = Number(entry?.price);
      return name.length > 0 && Number.isFinite(price) && price >= 0;
    });
  }

  function collectTicketTypeAnswer(questionId) {
    const controls = [...document.querySelectorAll(`[data-ticket-type-question-id="${CSS.escape(questionId)}"]`)];
    const rows = new Map();
    for (const control of controls) {
      const index = Number(control.dataset.ticketTypeIndex);
      if (!Number.isInteger(index) || index < 0) continue;
      const row = rows.get(index) ?? { name: '', price: '' };
      row[control.dataset.ticketTypeField] = control.value;
      rows.set(index, row);
    }
    return [...rows.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, row]) => ({ name: String(row.name ?? '').trim(), price: row.price }))
      .filter(row => row.name || String(row.price ?? '').trim());
  }

  function renderNewEventDialog() {
    return `
      <dialog id="new-event-dialog" class="modal new-event-dialog">
        <form method="dialog" id="new-event-form">
          <div class="modal-heading">
            <div>
              <span class="eyebrow">New event</span>
              <h2>Create an event plan</h2>
              <p>Record the event clearly now so the Playbook, task engine and Communications Centre all start from the same information.</p>
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
                ${pluginCapabilities.intelligentGolfEnabled ? `<label>
                  <span>Intelligent Golf event type</span>
                  <select id="new-event-type">${renderIntelligentGolfEventTypeOptions(0)}</select>
                </label>` : ''}
                <label>
                  <span>Expected attendees</span>
                  <input id="new-event-attendees" type="number" min="0" step="1" value="0">
                </label>
                <label>
                  <span>Start time <em>optional</em></span>
                  <input id="new-event-start-time" type="time">
                </label>
                <label>
                  <span>End time <em>optional</em></span>
                  <input id="new-event-end-time" type="time">
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

  function resetNewEventForm() {
    const form = document.getElementById('new-event-form');
    form?.reset();
    const organiserInput = document.getElementById('new-event-organiser');
    if (organiserInput) {
      organiserInput.dataset.selectedKind = '';
      organiserInput.dataset.selectedId = '';
      organiserInput.setCustomValidity('');
    }
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

    if (event.clonedAnswerHints) delete event.clonedAnswerHints[questionId];
    if (hasRecordedQuestionValue(value)) clearQuestionNotRelevant(event, questionId);
    if (indexed.item.bind === 'eventDate') {
      reanchorEventDate(event, value);
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
    invalidateTaskReviewConfirmations(event, questionId);
    normaliseEventLifecycle(event);
    const decisionTask = buildDontKnowTask(indexed.item);
    if (decisionTask && value !== 'dont-know') delete event.taskState[decisionTask.id];
    normaliseAnswers(event);
    for (const candidate of itemIndex.values()) {
      if (candidate.item.type === 'task' && candidate.item.ownerFromQuestionId === questionId) {
        ensureOperationalTaskState(event, { item: candidate.item });
      }
    }
    for (const rule of playbook.advisoryRules ?? []) {
      if (rule.targetQuestionId === questionId && value !== rule.triggerAnswer) delete event.advisoryOverrides?.[rule.id];
    }
    saveState();
    render();
  }

  function setQuestionNotRelevant(event, questionId, notRelevant) {
    const indexed = itemIndex.get(questionId);
    if (!indexed || indexed.item.type !== 'question') return false;

    const questionMeta = normaliseQuestionMeta(event);
    if (notRelevant) {
      questionMeta[questionId] = { notRelevant: true };
      if (indexed.item.bind === 'eventDate') {
        reanchorEventDate(event, '');
      } else {
        delete event.answers[questionId];
      }
      if (questionId === 'event-communications-owner') {
        event.lifecycle ??= {};
        event.lifecycle.communicationsOwnerRef = null;
        event.lifecycle.communicationsOwner = '';
      }
      if (event.clonedAnswerHints) delete event.clonedAnswerHints[questionId];
      const decisionTask = buildDontKnowTask(indexed.item);
      if (decisionTask) delete event.taskState[decisionTask.id];
    } else {
      delete questionMeta[questionId];
    }

    invalidateTaskReviewConfirmations(event, questionId);
    normaliseAnswers(event);
    saveState();
    render();
    return true;
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

  function openEventStatusDialog(eventId = state.activeEventId, preferredStatus = '') {
    if (eventId && eventId !== state.activeEventId && state.events.some(event => event.id === eventId)) {
      state.activeEventId = eventId;
      saveState();
      document.getElementById('event-summary-dialog')?.close();
      render();
      requestAnimationFrame(() => openEventStatusDialog(eventId, preferredStatus));
      return;
    }
    const dialog = document.getElementById('event-status-dialog');
    if (!dialog) return;
    const statusSelect = document.getElementById('event-status-value');
    if (preferredStatus && EVENT_STATUS_DEFINITIONS[preferredStatus] && statusSelect) statusSelect.value = preferredStatus;
    updateEventStatusDialogFields();
    dialog.showModal();
    requestAnimationFrame(() => document.getElementById('event-status-value')?.focus());
  }

  function applyEventStatusChange(event) {
    const lifecycle = normaliseEventLifecycle(event);
    const nextStatus = document.getElementById('event-status-value')?.value;
    const decisionOwnerInput = document.getElementById('event-status-decision-owner');
    const communicationsOwnerInput = document.getElementById('event-status-communications-owner');
    const decisionOwnerRef = assignmentReferenceFromInput(decisionOwnerInput, 'person');
    const communicationsOwnerRef = assignmentReferenceFromInput(communicationsOwnerInput, 'person-or-role');
    const decisionOwner = assignmentDisplay(decisionOwnerRef, decisionOwnerInput?.value.trim() ?? '');
    const communicationsOwner = assignmentDisplay(communicationsOwnerRef, communicationsOwnerInput?.value.trim() ?? '');
    const isChangeResponse = CHANGE_RESPONSE_STATUSES.has(nextStatus);
    const requiresCommunicationsOwner = isChangeResponse && hasCancellationEvidence(event, 'Communications');
    const needsReason = isChangeResponse || nextStatus === 'at-risk';
    const reason = needsReason ? document.getElementById('event-status-reason')?.value.trim() ?? '' : '';
    const memberUpdate = isChangeResponse ? document.getElementById('event-status-member-update')?.value.trim() ?? '' : '';
    if (decisionOwnerInput?.value.trim() && !decisionOwnerRef) {
      decisionOwnerInput.setCustomValidity('Choose a person from People & Roles.');
      decisionOwnerInput.reportValidity();
      return false;
    }
    if (communicationsOwnerInput?.value.trim() && !communicationsOwnerRef) {
      communicationsOwnerInput.setCustomValidity('Choose a person or role from People & Roles.');
      communicationsOwnerInput.reportValidity();
      return false;
    }
    decisionOwnerInput?.setCustomValidity('');
    communicationsOwnerInput?.setCustomValidity('');
    if (!EVENT_STATUS_DEFINITIONS[nextStatus] || !decisionOwnerRef || (needsReason && !reason) || (requiresCommunicationsOwner && !communicationsOwnerRef)) return false;

    const now = new Date().toISOString();
    const previousStatus = lifecycle.status;
    const statusChanged = nextStatus !== previousStatus;
    const statusNotification = statusChanged && NOTIFIABLE_EVENT_STATUSES.has(nextStatus)
      ? createEventStatusNotification(event, nextStatus, now)
      : null;
    const interestedParties = isChangeResponse ? deriveCancellationStakeholders(event) : [];
    const changed = statusChanged ||
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
        decisionOwnerRef: structuredClone(decisionOwnerRef),
        communicationsOwnerRef: structuredClone(communicationsOwnerRef),
        reason,
        memberUpdate,
        statusNotificationId: statusNotification?.id ?? null,
        interestedParties: structuredClone(interestedParties)
      });
    }

    lifecycle.status = nextStatus;
    if (statusChanged) {
      lifecycle.statusChangedAt = now;
      lifecycle.resolvedFromAtRisk = previousStatus === 'at-risk' &&
        ['confirmed', 'postponed', 'cancelled'].includes(nextStatus);
    }
    lifecycle.decisionOwner = decisionOwner;
    lifecycle.decisionOwnerRef = decisionOwnerRef;
    lifecycle.communicationsOwner = communicationsOwner;
    lifecycle.communicationsOwnerRef = communicationsOwnerRef;
    lifecycle.changedBy = decisionOwner;
    lifecycle.reason = reason;
    lifecycle.memberUpdate = memberUpdate;
    lifecycle.interestedParties = interestedParties;
    if (statusChanged) lifecycle.statusNotification = statusNotification;
    event.answers['event-decision-owner'] = decisionOwnerRef;
    event.answers['event-communications-owner'] = communicationsOwnerRef;
    updateTeam(event, assignmentRecipient(decisionOwnerRef, event).name || decisionOwner);
    updateTeam(event, assignmentRecipient(communicationsOwnerRef, event).name || communicationsOwner);

    event.milestoneDates ??= {};
    if (isChangeResponse) {
      event.milestoneDates.CX = localDateFromTimestamp(now);
      if (nextStatus === 'cancelled') event.cancelledAt = now;
      if (nextStatus === 'postponed') event.postponedAt = now;
      const cancellationCoordinatorRef = event.organiserRef ?? decisionOwnerRef;
      const explicitOwners = [
        ['notify-operational-leads-of-event-change', cancellationCoordinatorRef],
        ['issue-authoritative-event-change-message', communicationsOwnerRef],
        ['stop-scheduled-event-publicity', communicationsOwnerRef]
      ];
      for (const [taskId, ownerRef] of explicitOwners) {
        const indexed = itemIndex.get(taskId);
        if (indexed?.item && ownerRef && isItemVisible(indexed.item, event)) {
          assignTaskToReference(event, indexed.item, ownerRef, 'event-status');
        }
      }
    } else {
      delete event.milestoneDates.CX;
    }
    if (nextStatus === 'confirmed') event.confirmedAt = now;
    if (nextStatus === 'completed') event.closedAt ??= now;
    else if (event.closedAt) event.closedAt = null;

    if (statusChanged && nextStatus === 'cancelled') {
      state.activeView = 'cancellation';
    } else if (state.activeView === 'cancellation' && nextStatus !== 'cancelled') {
      state.activeView = 'module:start';
    }

    saveState();
    if (statusNotification) void dispatchEventStatusNotification(event);
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
    resetNewEventForm();
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

  function assignmentReferenceFromInput(input, mode = 'person-or-role') {
    if (!input) return null;
    const selected = input.dataset.selectedKind && input.dataset.selectedId
      ? assignmentReference({ kind: input.dataset.selectedKind, id: input.dataset.selectedId })
      : null;
    if (selected && assignmentDisplay(selected).toLocaleLowerCase() === input.value.trim().toLocaleLowerCase()) return selected;
    return findAssignmentReference(input.value, mode);
  }

  function setAssignmentPickerValidation(picker, message = '') {
    const input = picker?.querySelector('[data-assignment-input]');
    const error = picker?.querySelector('[data-assignment-error]');
    if (input) {
      input.setCustomValidity(message);
      input.setAttribute('aria-invalid', message ? 'true' : 'false');
    }
    if (error) error.textContent = message;
  }

  function revealDirectoryRecord(recordSelector, fieldSelector) {
    requestAnimationFrame(() => {
      const record = document.querySelector(recordSelector);
      if (!record) return;
      record.classList.add('directory-card-new');
      record.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const field = record.querySelector(fieldSelector);
      field?.focus({ preventScroll: true });
      field?.select();
      window.setTimeout(() => record.classList.remove('directory-card-new'), 1800);
    });
  }

  function commitAssignmentPicker(picker, reference) {
    const input = picker.querySelector('[data-assignment-input]');
    const resolved = assignmentReference(reference);
    input.value = resolved ? assignmentDisplay(resolved) : '';
    input.dataset.selectedKind = resolved?.kind ?? '';
    input.dataset.selectedId = resolved?.id ?? '';
    setAssignmentPickerValidation(picker);

    const event = getActiveEvent();
    if (picker.dataset.taskAssignment && event) {
      const indexed = itemIndex.get(picker.dataset.taskAssignment);
      if (indexed) assignTaskToReference(event, indexed.item, resolved, 'manual');
      saveState();
      render();
      return;
    }
    if (picker.dataset.questionAssignment && event) {
      setQuestionAnswer(event, picker.dataset.questionAssignment, resolved);
      return;
    }
    if (picker.dataset.eventAssignmentField === 'organiser' && event) {
      event.organiserRef = resolved;
      event.organiser = assignmentDisplay(resolved);
      updateTeam(event, assignmentRecipient(resolved, event).name || event.organiser);
      saveState();
      render();
    }
  }

  function bindAssignmentPickers() {
    document.querySelectorAll('[data-assignment-picker]').forEach(picker => {
      const input = picker.querySelector('[data-assignment-input]');
      const menu = picker.querySelector('.assignment-picker-menu');
      const toggle = picker.querySelector('[data-assignment-toggle]');
      const options = [...picker.querySelectorAll('[data-assignment-option]')];
      if (!input || !menu) return;
      const clippingContainer = picker.closest('.playbook-section, .task-card');

      const showMenu = () => {
        menu.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        toggle?.setAttribute('aria-expanded', 'true');
        clippingContainer?.classList.add('assignment-menu-open');
      };
      const hideMenu = () => {
        menu.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        toggle?.setAttribute('aria-expanded', 'false');
        clippingContainer?.classList.remove('assignment-menu-open');
      };
      const filter = () => {
        const search = input.value.trim().toLocaleLowerCase();
        for (const option of options) option.hidden = Boolean(search) && !option.dataset.search.includes(search);
      };
      const commitTypedValue = () => {
        const typed = input.value.trim();
        if (!typed) {
          commitAssignmentPicker(picker, null);
          return true;
        }
        const reference = assignmentReferenceFromInput(input, picker.dataset.assignmentMode);
        if (!reference) {
          setAssignmentPickerValidation(picker, 'Choose a person or role from the directory.');
          return false;
        }
        commitAssignmentPicker(picker, reference);
        return true;
      };

      input.addEventListener('focus', () => { filter(); showMenu(); });
      input.addEventListener('input', () => {
        input.dataset.selectedKind = '';
        input.dataset.selectedId = '';
        setAssignmentPickerValidation(picker);
        filter();
        showMenu();
      });
      input.addEventListener('change', commitTypedValue);
      input.addEventListener('keydown', eventArgs => {
        if (eventArgs.key === 'Escape') {
          hideMenu();
          return;
        }
        if (eventArgs.key === 'ArrowDown') {
          eventArgs.preventDefault();
          showMenu();
          options.find(option => !option.hidden)?.focus();
          return;
        }
        if (eventArgs.key === 'Enter' && !menu.hidden) {
          const first = options.find(option => !option.hidden);
          if (first) {
            eventArgs.preventDefault();
            first.click();
          }
        }
      });
      toggle?.addEventListener('click', () => {
        if (menu.hidden) {
          filter(); showMenu(); input.focus();
        } else hideMenu();
      });
      for (const option of options) {
        option.addEventListener('pointerdown', eventArgs => eventArgs.preventDefault());
        option.addEventListener('click', () => commitAssignmentPicker(picker, { kind: option.dataset.kind, id: option.dataset.id }));
      }
      picker.addEventListener('focusout', () => setTimeout(() => {
        if (!picker.contains(document.activeElement)) hideMenu();
      }, 0));
    });
  }

  function refreshStructuredAssignments() {
    for (const event of state.events ?? []) {
      event.organiserRef = assignmentReference(event.organiserRef ?? event.organiser);
      if (event.organiserRef) event.organiser = assignmentDisplay(event.organiserRef, event.organiser);
      normaliseEventLifecycle(event);
      for (const taskState of Object.values(event.taskState ?? {})) {
        const reference = taskAssignmentReference(taskState);
        if (!reference) continue;
        const recipient = assignmentRecipient(reference, event);
        taskState.assignee = assignmentDisplay(reference, taskState.assignee);
        taskState.assigneeEmail = recipient.email;
      }
    }
  }

  async function savePluginConfiguration(dialog, endpoint, payload, successMessage, submitButton) {
    const originalLabel = submitButton?.textContent ?? 'Save';
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Saving…';
    }

    try {
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `Plugin settings could not be saved (${response.status}).`);

      const definition = pluginUiDefinition(endpoint.split('/').pop());
      if (definition) {
        pluginCapabilities[definition.capabilityKey] = result.enabled === true;
      }
      if (definition?.cacheKey === 'intelligentGolf') {
        invalidateIntelligentGolfEventStatusCache();
      }
      dialog?.close();
      pluginSettingsCache = null;
      pluginSettingsNotice = successMessage;
      render();
    } catch (error) {
      alert(error.message || 'Plugin settings could not be saved.');
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalLabel;
      }
    }
  }

  async function setPluginEnabledState(trigger) {
    const pluginId = trigger.dataset.togglePlugin;
    const definition = pluginUiDefinition(pluginId);
    if (!definition) return;
    const summary = pluginSettingsCache?.[definition.cacheKey];
    const name = definition.name;
    const shouldEnable = summary?.enabled !== true;

    if (shouldEnable && summary?.configured !== true) {
      const dialog = document.getElementById(definition.dialogId);
      const enabledInput = document.getElementById(definition.enabledInputId);
      if (enabledInput) enabledInput.checked = true;
      dialog?.showModal();
      return;
    }

    trigger.disabled = true;
    trigger.classList.add('saving');
    try {
      const response = await fetch(`/api/admin/plugins/${encodeURIComponent(pluginId)}/enabled`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: shouldEnable })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `${name} could not be turned ${shouldEnable ? 'on' : 'off'}.`);
      pluginSettingsCache = result;
      updatePluginCapabilities(result);
      pluginSettingsNotice = '';
      render();
    } catch (error) {
      alert(error.message || `${name} could not be turned ${shouldEnable ? 'on' : 'off'}.`);
      trigger.disabled = false;
      trigger.classList.remove('saving');
    }
  }

  function resetPluginDialogEnabledState(dialog) {
    const definition = Object.values(pluginUiDefinitions).find(candidate => candidate.dialogId === dialog?.id);
    if (!definition) return;
    const summary = pluginSettingsCache?.[definition.cacheKey];
    const enabledInput = document.getElementById(definition.enabledInputId);
    if (enabledInput) enabledInput.checked = summary?.enabled === true;
  }

  function bindEvents() {
    bindAssignmentPickers();

    const plannerMatchDialog = document.getElementById('ig-planner-match-dialog');
    document.querySelector('[data-review-ig-planner-match]')?.addEventListener('click', () => {
      if (!plannerMatchDialog || plannerMatchDialog.open || document.querySelector('dialog[open]')) return;
      deferredIntelligentGolfMatches.delete(plannerMatchDialog.dataset.matchSignature);
      plannerMatchDialog.showModal();
      plannerMatchDialog.querySelector('input[name="ig-planner-match-candidate"]:checked')?.focus();
    });
    document.querySelector('[data-dismiss-ig-planner-notice]')?.addEventListener('click', () => {
      const event = getActiveEvent();
      if (!event) return;
      intelligentGolfResolutionNotices.delete(event.id);
      render();
    });
    plannerMatchDialog?.addEventListener('cancel', eventArgs => {
      eventArgs.preventDefault();
      deferIntelligentGolfPlannerMatch(plannerMatchDialog);
    });
    plannerMatchDialog?.querySelectorAll('[data-defer-ig-planner-match]').forEach(button => {
      button.addEventListener('click', () => deferIntelligentGolfPlannerMatch(plannerMatchDialog));
    });
    plannerMatchDialog?.querySelectorAll('input[name="ig-planner-match-candidate"]').forEach(input => {
      input.addEventListener('change', () => {
        const adoptButton = plannerMatchDialog.querySelector('[data-resolve-ig-planner-match="adopt"]');
        if (adoptButton) adoptButton.disabled = !plannerMatchDialog.querySelector('input[name="ig-planner-match-candidate"]:checked:not(:disabled)');
      });
    });
    plannerMatchDialog?.querySelectorAll('[data-resolve-ig-planner-match]').forEach(button => {
      button.addEventListener('click', () => resolveIntelligentGolfPlannerMatch(
        plannerMatchDialog,
        button.dataset.resolveIgPlannerMatch));
    });

    const plannerLinkDialog = document.getElementById('ig-planner-link-dialog');
    document.querySelectorAll('[data-action="change-ig-planner-link"]').forEach(button => {
      button.addEventListener('click', () => openIntelligentGolfPlannerLinkDialog(button));
    });
    plannerLinkDialog?.addEventListener('cancel', eventArgs => {
      eventArgs.preventDefault();
      closeIntelligentGolfPlannerLinkDialog(plannerLinkDialog);
    });
    plannerLinkDialog?.querySelectorAll('[data-close-ig-planner-link]').forEach(button => {
      button.addEventListener('click', () => closeIntelligentGolfPlannerLinkDialog(plannerLinkDialog));
    });
    plannerLinkDialog?.querySelector('[data-retry-ig-planner-link]')?.addEventListener('click', () => {
      closeIntelligentGolfPlannerLinkDialog(plannerLinkDialog, false);
      openIntelligentGolfPlannerLinkDialog();
    });
    plannerLinkDialog?.querySelectorAll('input[name="ig-planner-link-candidate"]').forEach(input => {
      input.addEventListener('change', () => {
        const selected = plannerLinkDialog.querySelector('input[name="ig-planner-link-candidate"]:checked:not(:disabled)');
        const currentPlannerEntryId = Number(plannerLinkDialog.dataset.currentPlannerEntryId) || 0;
        if (intelligentGolfPlannerLinkDialogState) {
          intelligentGolfPlannerLinkDialogState.selectedPlannerEntryId = Number(selected?.value) || currentPlannerEntryId;
        }
        const confirmButton = plannerLinkDialog.querySelector('[data-confirm-ig-planner-link]');
        if (confirmButton) confirmButton.disabled = !selected || Number(selected.value) === currentPlannerEntryId;
      });
    });
    const plannerEntryIdInput = plannerLinkDialog?.querySelector('#ig-planner-entry-id');
    plannerEntryIdInput?.addEventListener('input', () => {
      if (intelligentGolfPlannerLinkDialogState) {
        intelligentGolfPlannerLinkDialogState.lookupEntryId = plannerEntryIdInput.value;
        intelligentGolfPlannerLinkDialogState.lookupMessage = '';
        intelligentGolfPlannerLinkDialogState.lookupError = '';
      }
    });
    plannerEntryIdInput?.addEventListener('keydown', eventArgs => {
      if (eventArgs.key !== 'Enter') return;
      eventArgs.preventDefault();
      plannerLinkDialog.querySelector('[data-check-ig-planner-entry]')?.click();
    });
    plannerLinkDialog?.querySelector('[data-check-ig-planner-entry]')?.addEventListener('click', () => {
      lookupIntelligentGolfPlannerEntry(plannerLinkDialog);
    });
    plannerLinkDialog?.querySelector('[data-confirm-ig-planner-link]')?.addEventListener('click', () => {
      saveIntelligentGolfPlannerLink(plannerLinkDialog);
    });

    const brandingForm = document.getElementById('club-branding-form');
    const brandingCrestInput = document.getElementById('club-branding-crest');
    const brandingPreview = document.getElementById('club-branding-preview');
    let temporaryBrandingPreviewUrl = '';

    brandingCrestInput?.addEventListener('change', () => {
      if (temporaryBrandingPreviewUrl) URL.revokeObjectURL(temporaryBrandingPreviewUrl);
      temporaryBrandingPreviewUrl = '';
      const file = brandingCrestInput.files?.[0];
      if (!file || !brandingPreview) {
        if (brandingPreview) brandingPreview.src = clubBranding.crestUrl;
        return;
      }
      temporaryBrandingPreviewUrl = URL.createObjectURL(file);
      brandingPreview.src = temporaryBrandingPreviewUrl;
    });

    brandingForm?.addEventListener('submit', async eventArgs => {
      eventArgs.preventDefault();
      const submitButton = eventArgs.submitter;
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Saving identity…';
      }
      try {
        const formData = new FormData();
        formData.set('clubName', document.getElementById('club-branding-name')?.value.trim() ?? '');
        const file = brandingCrestInput?.files?.[0];
        if (file) formData.set('crest', file);
        const response = await fetch('/api/admin/branding', { method: 'PUT', body: formData });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `The club identity could not be saved (${response.status}).`);
        if (temporaryBrandingPreviewUrl) URL.revokeObjectURL(temporaryBrandingPreviewUrl);
        temporaryBrandingPreviewUrl = '';
        setClubBranding(result);
        clubBrandingNotice = 'The club identity was saved and is now being used throughout the Event Playbook.';
        render();
      } catch (error) {
        alert(error.message || 'The club identity could not be saved.');
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = 'Save club identity';
        }
      }
    });

    document.querySelector('[data-remove-custom-crest]')?.addEventListener('click', async eventArgs => {
      if (!confirm('Use the built-in crest instead of the uploaded club crest?')) return;
      const button = eventArgs.currentTarget;
      button.disabled = true;
      button.textContent = 'Restoring…';
      try {
        const formData = new FormData();
        formData.set('clubName', document.getElementById('club-branding-name')?.value.trim() ?? clubBranding.clubName);
        formData.set('removeCustomCrest', 'true');
        const response = await fetch('/api/admin/branding', { method: 'PUT', body: formData });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `The default crest could not be restored (${response.status}).`);
        setClubBranding(result);
        clubBrandingNotice = 'The built-in crest is now being used throughout the Event Playbook.';
        render();
      } catch (error) {
        alert(error.message || 'The default crest could not be restored.');
        button.disabled = false;
        button.textContent = 'Use default crest';
      }
    });

    const financeDirection = document.getElementById('finance-direction');
    const financeCategory = document.getElementById('finance-category');
    const financeCalculation = document.getElementById('finance-calculation');
    const updateFinanceAddForm = () => {
      if (financeCategory && financeDirection) {
        const previousCategory = financeCategory.value;
        financeCategory.innerHTML = financeCategoryOptions(financeDirection.value, previousCategory);
        if (!financeCategory.value) financeCategory.value = FINANCE_CATEGORIES[financeDirection.value]?.[0] ?? '';
      }
      const calculation = FINANCE_CALCULATIONS[financeCalculation?.value] ?? FINANCE_CALCULATIONS.total;
      const calculated = financeCalculation?.value !== 'total';
      const totalField = document.getElementById('finance-total-field');
      const quantityField = document.getElementById('finance-quantity-field');
      const unitField = document.getElementById('finance-unit-field');
      if (totalField) totalField.hidden = calculated;
      if (quantityField) quantityField.hidden = !calculated;
      if (unitField) unitField.hidden = !calculated;
      const quantityLabel = document.getElementById('finance-quantity-label');
      const unitLabel = document.getElementById('finance-unit-label');
      if (quantityLabel) quantityLabel.textContent = calculation.quantityLabel || 'Quantity';
      if (unitLabel) unitLabel.textContent = calculation.unitLabel || 'Unit amount';
    };
    financeDirection?.addEventListener('change', updateFinanceAddForm);
    financeCalculation?.addEventListener('change', updateFinanceAddForm);

    document.getElementById('finance-entry-form')?.addEventListener('submit', eventArgs => {
      eventArgs.preventDefault();
      const activeEvent = getActiveEvent();
      if (!activeEvent) return;
      const form = eventArgs.currentTarget;
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      const calculation = financeCalculation?.value || 'total';
      const entry = {
        id: crypto.randomUUID(),
        direction: financeDirection?.value === 'expense' ? 'expense' : 'income',
        category: financeCategory?.value || 'Other income',
        description: document.getElementById('finance-description')?.value.trim() || '',
        calculation,
        quantity: Math.max(0, Number(document.getElementById('finance-quantity')?.value) || 0),
        unitAmount: Math.max(0, Number(document.getElementById('finance-unit-amount')?.value) || 0),
        totalAmount: Math.max(0, Number(document.getElementById('finance-total-amount')?.value) || 0),
        status: document.getElementById('finance-status')?.value === 'actual' ? 'actual' : 'estimate',
        notes: document.getElementById('finance-notes')?.value.trim() || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      normaliseEventFinances(activeEvent).entries.unshift(entry);
      saveState();
      render();
    });

    document.querySelectorAll('[data-finance-field]').forEach(element => {
      element.addEventListener('change', () => {
        const activeEvent = getActiveEvent();
        const entry = activeEvent?.finances?.entries?.find(candidate => candidate.id === element.closest('[data-finance-entry]')?.dataset.financeEntry);
        if (!entry) return;
        const field = element.dataset.financeField;
        entry[field] = ['quantity', 'unitAmount', 'totalAmount'].includes(field)
          ? Math.max(0, Number(element.value) || 0)
          : element.value.trim();
        if (field === 'direction' && !(FINANCE_CATEGORIES[entry.direction] ?? []).includes(entry.category)) {
          entry.category = FINANCE_CATEGORIES[entry.direction]?.[0] ?? entry.category;
        }
        entry.updatedAt = new Date().toISOString();
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-delete-finance-entry]').forEach(element => {
      element.addEventListener('click', () => {
        const activeEvent = getActiveEvent();
        const entry = activeEvent?.finances?.entries?.find(candidate => candidate.id === element.dataset.deleteFinanceEntry);
        if (!activeEvent || !entry || !confirm(`Delete the ${entry.description || entry.category} figure from this event P&L?`)) return;
        activeEvent.finances.entries = activeEvent.finances.entries.filter(candidate => candidate.id !== entry.id);
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-view]').forEach(element => {
      element.addEventListener('click', () => {
        const requestedView = element.dataset.view;
        if (ADMIN_VIEWS.has(requestedView) && !accessSession.isAdmin) {
          location.assign(adminLoginUrl(requestedView));
          return;
        }
        if (requestedView === 'plugins') integrationActivityCache = null;
        state.activeView = requestedView;
        if (state.activeView === 'tasks') state.taskBoardHorizon = 'auto';
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-retry-briefing]').forEach(element => {
      element.addEventListener('click', () => {
        const event = getActiveEvent();
        if (!event) return;
        ensureEventBriefing(event, true);
        render();
      });
    });

    document.querySelectorAll('[data-copy-planner-summary]').forEach(element => {
      element.addEventListener('click', async () => {
        const event = getActiveEvent();
        const copy = plannerSummaryText(event?.briefing ?? {});
        if (!copy) return;
        try {
          await navigator.clipboard.writeText(copy);
          element.textContent = 'Copied';
          setTimeout(() => { if (element.isConnected) element.textContent = 'Copy summary'; }, 1800);
        } catch {
          alert('The planner summary could not be copied. Select the text and copy it manually.');
        }
      });
    });

    document.querySelectorAll('[data-print-staff-briefing]').forEach(element => {
      element.addEventListener('click', () => {
        const event = getActiveEvent();
        if (!event || element.disabled) return;
        const originalTitle = document.title;
        document.title = `${event.name} - Staff briefing`;
        document.body.classList.add('printing-staff-briefing');
        try {
          window.print();
        } finally {
          document.body.classList.remove('printing-staff-briefing');
          document.title = originalTitle;
        }
      });
    });

    document.querySelectorAll('[data-configure-plugin]').forEach(element => {
      element.addEventListener('click', () => {
        const definition = pluginUiDefinition(element.dataset.configurePlugin);
        if (definition) document.getElementById(definition.dialogId)?.showModal();
      });
    });

    document.querySelectorAll('[data-toggle-plugin]').forEach(element => {
      element.addEventListener('click', () => setPluginEnabledState(element));
    });

    document.querySelectorAll('[data-close-plugin-dialog]').forEach(element => {
      element.addEventListener('click', () => element.closest('dialog')?.close());
    });

    document.querySelectorAll('.plugin-dialog').forEach(dialog => {
      dialog.addEventListener('close', () => resetPluginDialogEnabledState(dialog));
    });

    document.querySelectorAll('[data-action="reload-plugin-settings"]').forEach(element => {
      element.addEventListener('click', () => {
        pluginSettingsCache = null;
        render();
      });
    });

    document.querySelectorAll('[data-refresh-integration-activity]').forEach(element => {
      element.addEventListener('click', () => {
        integrationActivityCache = null;
        render();
      });
    });

    document.getElementById('intelligent-golf-plugin-form')?.addEventListener('submit', eventArgs => {
      eventArgs.preventDefault();
      const dialog = eventArgs.currentTarget.closest('dialog');
      savePluginConfiguration(dialog, '/api/admin/plugins/intelligent-golf', {
        enabled: document.getElementById('ig-plugin-enabled')?.checked === true,
        siteUrl: document.getElementById('ig-plugin-site-url')?.value ?? '',
        memberId: document.getElementById('ig-plugin-member-id')?.value ?? '',
        memberPassword: document.getElementById('ig-plugin-member-password')?.value ?? '',
        adminPassword: document.getElementById('ig-plugin-admin-password')?.value ?? '',
        emailSenderMemberNumber: document.getElementById('ig-plugin-email-sender-member-number')?.value ?? '',
        emailFromName: document.getElementById('ig-plugin-email-from-name')?.value ?? '',
        emailFromAddress: document.getElementById('ig-plugin-email-from-address')?.value ?? ''
      }, 'Intelligent Golf settings were saved securely.', eventArgs.submitter);
    });

    document.getElementById('monday-plugin-form')?.addEventListener('submit', eventArgs => {
      eventArgs.preventDefault();
      const dialog = eventArgs.currentTarget.closest('dialog');
      savePluginConfiguration(dialog, '/api/admin/plugins/monday', {
        enabled: document.getElementById('monday-plugin-enabled')?.checked === true,
        apiToken: document.getElementById('monday-plugin-token')?.value ?? '',
        workspaceId: document.getElementById('monday-plugin-workspace')?.value ?? '',
        boardId: document.getElementById('monday-plugin-board')?.value ?? ''
      }, 'Monday.com settings were saved securely.', eventArgs.submitter);
    });

    document.getElementById('yodeck-plugin-form')?.addEventListener('submit', eventArgs => {
      eventArgs.preventDefault();
      const dialog = eventArgs.currentTarget.closest('dialog');
      const playlistIdValue = document.getElementById('yodeck-plugin-playlist-id')?.value ?? '';
      savePluginConfiguration(dialog, '/api/admin/plugins/yodeck', {
        enabled: document.getElementById('yodeck-plugin-enabled')?.checked === true,
        apiToken: document.getElementById('yodeck-plugin-token')?.value ?? '',
        playlistId: playlistIdValue ? Number(playlistIdValue) : null,
        playlistName: document.getElementById('yodeck-plugin-playlist-name')?.value ?? '',
        mediaDurationSeconds: Number(document.getElementById('yodeck-plugin-media-duration')?.value || 15)
      }, 'Yodeck settings were saved securely.', eventArgs.submitter);
    });

    document.querySelectorAll('[data-disconnect-plugin]').forEach(element => {
      element.addEventListener('click', async () => {
        const pluginId = element.dataset.disconnectPlugin;
        const definition = pluginUiDefinition(pluginId);
        if (!definition) return;
        const name = definition.name;
        if (!confirm(`Remove all saved ${name} credentials and disable this plugin?`)) return;

        element.disabled = true;
        try {
          const response = await fetch(`/api/admin/plugins/${encodeURIComponent(pluginId)}`, { method: 'DELETE' });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || `The ${name} credentials could not be removed.`);
          element.closest('dialog')?.close();
          pluginSettingsCache = result;
          updatePluginCapabilities(result);
          pluginSettingsNotice = `${name} was disconnected and its saved credentials were removed.`;
          render();
        } catch (error) {
          alert(error.message || `The ${name} credentials could not be removed.`);
          element.disabled = false;
        }
      });
    });

    document.querySelectorAll('[data-action="manage-event-status"]').forEach(element => {
      element.addEventListener('click', () => openEventStatusDialog());
    });

    document.querySelectorAll('[data-task-manage-event-status]').forEach(element => {
      element.addEventListener('click', () => openEventStatusDialog(
        element.dataset.taskManageEventStatus || state.activeEventId,
        element.dataset.eventStatusPrefill || 'confirmed'));
    });

    document.querySelectorAll('[data-retry-event-status-notification]').forEach(element => {
      element.addEventListener('click', () => {
        const event = state.events.find(candidate => candidate.id === element.dataset.retryEventStatusNotification) ?? getActiveEvent();
        if (event) void dispatchEventStatusNotification(event);
      });
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
        if (!confirm(`Permanently delete “${target.name}” from the Event Catalogue?\n\nThis removes its plan, answers, task state and retrospective from the Playbook. Generated files and media already sent to external services are not deleted automatically.`)) return;
        state.events = state.events.filter(item => item.id !== eventId);
        state.notificationOutbox = (state.notificationOutbox ?? []).filter(notification => notification.eventId !== eventId);
        feedbackCache.delete(eventId);
        feedbackRequests.delete(eventId);
        briefingGenerationRequests.delete(eventId);
        if (state.activeEventId === eventId) {
          state.activeEventId = state.events.find(candidate => !candidate.closedAt)?.id ?? state.events[0]?.id ?? null;
        }
        document.getElementById('event-summary-dialog')?.close();
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

    document.querySelectorAll('[data-question-not-relevant]').forEach(element => {
      element.addEventListener('click', () => {
        const event = getActiveEvent();
        if (!event) return;
        setQuestionNotRelevant(
          event,
          element.dataset.questionNotRelevant,
          element.getAttribute('aria-pressed') !== 'true');
      });
    });

    document.querySelectorAll('[data-question-input]').forEach(element => {
      element.addEventListener('input', () => {
        const event = getActiveEvent();
        if (!event) return;
        const indexed = itemIndex.get(element.dataset.questionInput);
        if (!indexed || indexed.item.type !== 'question') return;
        if (event.clonedAnswerHints) delete event.clonedAnswerHints[element.dataset.questionInput];
        element.classList.remove('prior-answer-hint');
        delete element.dataset.priorAnswerHint;
        if (indexed.item.bind === 'eventDate') return;
        event.answers[element.dataset.questionInput] = element.value;
        if (hasRecordedQuestionValue(element.value)) {
          const clearedNotRelevant = clearQuestionNotRelevant(event, element.dataset.questionInput);
          if (clearedNotRelevant) {
            const questionCard = element.closest('.question-item');
            questionCard?.classList.remove('not-relevant');
            questionCard?.classList.add('answered');
            const stateMark = questionCard?.querySelector('.question-state-mark');
            const stateLabel = questionCard?.querySelector('.question-flow-rail small');
            if (stateMark) stateMark.textContent = '✓';
            if (stateLabel) stateLabel.textContent = 'Answered';
            const notRelevantButton = questionCard?.querySelector('[data-question-not-relevant]');
            notRelevantButton?.classList.remove('selected');
            notRelevantButton?.setAttribute('aria-pressed', 'false');
            if (notRelevantButton) notRelevantButton.textContent = 'Not relevant';
          }
        }
        invalidateTaskReviewConfirmations(event, element.dataset.questionInput);
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

    document.querySelectorAll('[data-ticket-type-question-id]').forEach(element => {
      element.addEventListener('input', () => {
        const event = getActiveEvent();
        const questionId = element.dataset.ticketTypeQuestionId;
        if (!event || !questionId) return;
        event.answers[questionId] = collectTicketTypeAnswer(questionId);
        clearQuestionNotRelevant(event, questionId);
        invalidateTaskReviewConfirmations(event, questionId);
        saveState();
      });
      element.addEventListener('change', () => render());
    });

    document.querySelectorAll('[data-ticket-type-add]').forEach(element => {
      element.addEventListener('click', () => {
        const event = getActiveEvent();
        const questionId = element.dataset.ticketTypeAdd;
        if (!event || !questionId) return;
        const rows = collectTicketTypeAnswer(questionId);
        rows.push({ name: '', price: '' });
        event.answers[questionId] = rows;
        clearQuestionNotRelevant(event, questionId);
        invalidateTaskReviewConfirmations(event, questionId);
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-ticket-type-remove]').forEach(element => {
      element.addEventListener('click', () => {
        const event = getActiveEvent();
        const questionId = element.dataset.ticketTypeRemoveQuestion;
        const removeIndex = Number(element.dataset.ticketTypeRemove);
        if (!event || !questionId || !Number.isInteger(removeIndex)) return;
        const rows = Array.isArray(event.answers[questionId])
          ? event.answers[questionId].map(row => ({ ...row }))
          : [];
        rows.splice(removeIndex, 1);
        event.answers[questionId] = rows;
        invalidateTaskReviewConfirmations(event, questionId);
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-task-complete]').forEach(element => {
      element.addEventListener('change', () => {
        const event = getActiveEvent();
        if (!event) return;
        const indexed = itemIndex.get(element.dataset.taskComplete);
        if (!indexed || markTaskComplete(event, indexed.item, element.checked) === false) {
          render();
          return;
        }
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-task-select]').forEach(element => {
      element.addEventListener('change', () => {
        const event = getActiveEvent();
        if (!event || taskBoardSelection.eventId !== event.id) return;
        const taskId = element.dataset.taskSelect;
        if (element.checked) taskBoardSelection.taskIds.add(taskId);
        else taskBoardSelection.taskIds.delete(taskId);
        updateTaskBoardSelectionUi();
      });
    });

    document.querySelector('[data-task-select-all]')?.addEventListener('change', eventArgs => {
      const event = getActiveEvent();
      if (!event || taskBoardSelection.eventId !== event.id) return;
      const checked = eventArgs.currentTarget.checked;
      document.querySelectorAll('[data-task-select]').forEach(element => {
        if (element.disabled) return;
        element.checked = checked;
        if (checked) taskBoardSelection.taskIds.add(element.dataset.taskSelect);
        else taskBoardSelection.taskIds.delete(element.dataset.taskSelect);
      });
      updateTaskBoardSelectionUi();
    });

    if (document.querySelector('[data-task-select]')) updateTaskBoardSelectionUi();

    document.querySelectorAll('[data-task-completion-action]').forEach(element => {
      element.addEventListener('click', () => {
        const event = getActiveEvent();
        const indexed = itemIndex.get(element.dataset.taskCompletionAction);
        const completed = element.dataset.taskTargetCompleted === 'true';
        if (!event || !indexed || markTaskComplete(event, indexed.item, completed) === false) {
          render();
          return;
        }
        taskBoardSelection.taskIds.delete(indexed.item.id);
        saveState();
        render();
      });
    });

    document.querySelector('[data-task-complete-selected]')?.addEventListener('click', () => {
      const event = getActiveEvent();
      if (!event || taskBoardSelection.eventId !== event.id || !taskBoardSelection.taskIds.size) return;
      const tasksById = new Map(getActiveTasks(event).map(task => [task.item.id, task]));
      let completedCount = 0;
      let skippedCount = 0;

      for (const taskId of taskBoardSelection.taskIds) {
        const task = tasksById.get(taskId);
        if (!task || task.state.completed) continue;
        if (markTaskComplete(event, task.item, true) === false) skippedCount += 1;
        else completedCount += 1;
      }

      taskBoardSelection.taskIds.clear();
      if (completedCount) saveState();
      render();
      if (skippedCount) alert(`${skippedCount} selected task${skippedCount === 1 ? ' was' : 's were'} not completed because required answers are still missing.`);
    });

    document.querySelectorAll('[data-task-confirm]').forEach(element => {
      element.addEventListener('click', () => {
        const eventId = element.dataset.taskConfirmEventId;
        const event = eventId
          ? state.events.find(candidate => candidate.id === eventId)
          : getActiveEvent();
        const indexed = itemIndex.get(element.dataset.taskConfirm);
        if (!event || !indexed || markTaskComplete(event, indexed.item, true) === false) {
          render();
          return;
        }
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-configure-ig-tickets]').forEach(element => {
      element.addEventListener('click', async () => {
        const eventId = element.dataset.configureIgTicketsEventId;
        const event = state.events.find(candidate => candidate.id === eventId) ?? getActiveEvent();
        const indexed = itemIndex.get(element.dataset.configureIgTickets);
        if (!event || !indexed) return;
        await configureIntelligentGolfTickets(event, indexed.item);
      });
    });

    document.querySelectorAll('[data-task-notes]').forEach(element => {
      element.addEventListener('change', () => {
        const event = getActiveEvent();
        if (!event) return;
        const taskState = ensureTaskState(event, element.dataset.taskNotes);
        const note = element.value.trim();
        if (note) taskState.notes = note;
        else delete taskState.notes;
        taskState.notesUpdatedAt = new Date().toISOString();
        saveState();
      });
    });

    document.querySelectorAll('[data-task-not-relevant]').forEach(element => {
      element.addEventListener('change', () => {
        const eventId = element.dataset.taskNotRelevantEventId;
        const targetEvent = state.events.find(candidate => candidate.id === eventId) ?? getActiveEvent();
        if (!targetEvent) return;
        const task = getActiveTasks(targetEvent, { includeNotRelevant: true })
          .find(candidate => candidate.item.id === element.dataset.taskNotRelevant);
        if (!task || markTaskNotRelevant(targetEvent, task.item, element.checked) === false) {
          render();
          return;
        }
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-task-note-action]').forEach(element => {
      element.addEventListener('click', () => openTaskNoteDialog(element));
    });

    const taskNoteDialog = document.getElementById('task-note-dialog');
    document.querySelectorAll('[data-close-task-note-dialog]').forEach(element => {
      element.addEventListener('click', () => taskNoteDialog?.close());
    });
    taskNoteDialog?.addEventListener('close', () => {
      if (taskNoteReturnFocus?.isConnected) taskNoteReturnFocus.focus();
      taskNoteReturnFocus = null;
    });
    document.getElementById('task-note-form')?.addEventListener('submit', eventArgs => {
      eventArgs.preventDefault();
      const eventId = document.getElementById('task-note-event-id')?.value ?? '';
      const taskId = document.getElementById('task-note-task-id')?.value ?? '';
      const targetEvent = state.events.find(candidate => candidate.id === eventId);
      const indexed = itemIndex.get(taskId);
      if (!targetEvent || !indexed || indexed.item.type !== 'task') return;
      const taskState = ensureTaskState(targetEvent, taskId);
      const note = document.getElementById('task-note-text')?.value.trim() ?? '';
      if (note) taskState.notes = note;
      else delete taskState.notes;
      taskState.notesUpdatedAt = new Date().toISOString();
      saveState();
      taskNoteReturnFocus = null;
      taskNoteDialog?.close();
      render();
      requestAnimationFrame(() => document.querySelector(`[data-task-note-action="${CSS.escape(taskId)}"][data-task-note-event-id="${CSS.escape(eventId)}"]`)?.focus());
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
        const value = element.value.trim();
        const candidateStart = field === 'startTime' ? value : event.startTime;
        const candidateEnd = field === 'endTime' ? value : event.endTime;
        if ((field === 'startTime' || field === 'endTime') &&
            candidateStart && candidateEnd && candidateEnd <= candidateStart) {
          element.setCustomValidity('Choose an end time after the start time.');
          element.reportValidity();
          element.setCustomValidity('');
          return;
        }
        if (field === 'eventDate') {
          if (!reanchorEventDate(event, value)) {
            element.setCustomValidity('Choose a valid event date.');
            element.reportValidity();
            element.setCustomValidity('');
            return;
          }
        } else {
          event[field] = field === 'intelligentGolfEventTypeId' || field === 'expectedAttendees'
            ? Math.max(0, Number(value) || 0)
            : value;
        }
        if (field === 'organiser') {
          updateTeam(event, event.organiser);
        }
        saveState();
        scheduleIntelligentGolfStatusRefresh(event.id);
        render();
      });
    });

    document.querySelectorAll('[data-milestone-code]').forEach(element => {
      element.addEventListener('change', () => {
        const event = getActiveEvent();
        if (!event) return;
        const code = element.dataset.milestoneCode;
        if (code === 'DT') {
          if (!reanchorEventDate(event, element.value)) {
            element.setCustomValidity('Choose a valid event date.');
            element.reportValidity();
            element.setCustomValidity('');
            return;
          }
        } else {
          event.milestoneDates ??= {};
          event.milestoneDates[code] = element.value;
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

    document.querySelectorAll('[data-dashboard-task-filter]').forEach(element => {
      element.addEventListener('click', () => {
        state.dashboardTaskFilter = element.dataset.dashboardTaskFilter;
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-task-board-mode]').forEach(element => {
      element.addEventListener('click', () => {
        state.taskBoardMode = element.dataset.taskBoardMode === 'overview' ? 'overview' : 'mine';
        if (state.taskBoardMode === 'mine' && state.taskFilter === 'unassigned') state.taskFilter = 'open';
        state.taskBoardHorizon = 'auto';
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-task-board-horizon]').forEach(element => {
      element.addEventListener('click', () => {
        state.taskBoardHorizon = element.dataset.taskBoardHorizon;
        saveState();
        render();
      });
    });

    document.querySelector('[data-task-board-person]')?.addEventListener('change', eventArgs => {
      state.taskBoardPersonId = eventArgs.currentTarget.value;
      state.taskFilter = 'open';
      state.taskBoardHorizon = 'auto';
      saveState();
      render();
    });

    document.querySelector('[data-dashboard-person]')?.addEventListener('change', eventArgs => {
      state.taskBoardPersonId = eventArgs.currentTarget.value;
      state.dashboardTaskFilter = 'open';
      saveState();
      render();
    });

    document.querySelectorAll('[data-dashboard-open-event]').forEach(element => {
      element.addEventListener('click', () => {
        const eventId = element.dataset.dashboardOpenEvent;
        if (!state.events.some(event => event.id === eventId)) return;
        state.activeEventId = eventId;
        state.activeView = 'tasks';
        state.taskBoardMode = 'mine';
        state.taskFilter = 'open';
        state.taskBoardHorizon = 'auto';
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-task-workspace-view]').forEach(element => {
      element.addEventListener('click', () => {
        const eventId = element.dataset.taskWorkspaceEventId;
        if (eventId && state.events.some(event => event.id === eventId)) state.activeEventId = eventId;
        state.activeView = element.dataset.taskWorkspaceView;
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-dashboard-task-complete]').forEach(element => {
      element.addEventListener('change', () => {
        const event = state.events.find(candidate => candidate.id === element.dataset.dashboardEventId);
        if (!event) return;
        const task = getActiveTasks(event).find(candidate => candidate.item.id === element.dataset.dashboardTaskComplete);
        if (!task) return;
        if (markTaskComplete(event, task.item, element.checked) === false) {
          render();
          return;
        }
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-action="new-event"]').forEach(element => {
      element.addEventListener('click', () => {
        const dialog = document.getElementById('new-event-dialog');
        resetNewEventForm();
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

    document.querySelectorAll('[data-retro-sentiment]').forEach(element => {
      element.addEventListener('click', () => {
        const event = getActiveEvent();
        if (!event) return;
        event.retrospective.sentimentRating = Number(element.dataset.retroSentiment);
        saveState();
        render();
      });
    });

    document.getElementById('retrospectiveNarrative')?.addEventListener('change', elementEvent => {
      const event = getActiveEvent();
      if (!event) return;
      event.retrospective.aiNarrative = elementEvent.currentTarget.value;
      saveState();
    });

    document.querySelectorAll('[data-action="summarise-member-feedback"]').forEach(element => {
      element.addEventListener('click', () => {
        const event = getActiveEvent();
        if (event) runRetrospectiveAnalysis(event, element, { finalise: false });
      });
    });

    document.querySelectorAll('[data-action="finalise-retrospective"]').forEach(element => {
      element.addEventListener('click', () => {
        const event = getActiveEvent();
        if (event) runRetrospectiveAnalysis(event, element, { finalise: true });
      });
    });

    document.querySelectorAll('[data-retrospective-proposal-field]').forEach(element => {
      element.addEventListener('change', () => {
        const event = getActiveEvent();
        const proposal = event?.retrospective?.taskAnalysis?.proposals?.find(candidate => candidate.id === element.closest('[data-retrospective-proposal-id]')?.dataset.retrospectiveProposalId);
        if (!proposal) return;
        proposal[element.dataset.retrospectiveProposalField] = element.value.trim();
        saveState();
      });
    });

    document.querySelectorAll('[data-retrospective-proposal-target]').forEach(element => {
      element.addEventListener('change', () => {
        const event = getActiveEvent();
        const proposal = event?.retrospective?.taskAnalysis?.proposals?.find(candidate => candidate.id === element.closest('[data-retrospective-proposal-id]')?.dataset.retrospectiveProposalId);
        if (!proposal) return;
        Object.assign(proposal, learningTargetFromValue(element.value));
        saveState();
      });
    });

    document.querySelectorAll('[data-approve-retrospective-proposal]').forEach(element => {
      element.addEventListener('click', () => {
        const event = getActiveEvent();
        const proposal = event?.retrospective?.taskAnalysis?.proposals?.find(candidate => candidate.id === element.dataset.approveRetrospectiveProposal);
        const row = element.closest('[data-retrospective-proposal-id]');
        if (!event || !proposal || !row) return;
        proposal.title = row.querySelector('[data-retrospective-proposal-field="title"]')?.value.trim() ?? proposal.title;
        proposal.summary = row.querySelector('[data-retrospective-proposal-field="summary"]')?.value.trim() ?? proposal.summary;
        Object.assign(proposal, learningTargetFromValue(row.querySelector('[data-retrospective-proposal-target]')?.value ?? ''));
        if (!proposal.title || !proposal.summary || (!proposal.targetItemId && !proposal.targetSectionId && !proposal.targetModuleId)) {
          alert('Give the learning a title, summary and planner target before approving it.');
          return;
        }
        event.learningInsights ??= [];
        event.learningInsights = event.learningInsights.filter(insight => insight.sourceProposalId !== proposal.id);
        event.learningInsights.push({
          id: crypto.randomUUID(),
          title: proposal.title,
          summary: proposal.summary,
          importance: proposal.importance ?? 'consider',
          evidenceCount: 0,
          targetModuleIds: proposal.targetModuleId && !proposal.targetItemId ? [proposal.targetModuleId] : [],
          targetSectionIds: proposal.targetSectionId && !proposal.targetItemId ? [proposal.targetSectionId] : [],
          targetItemIds: proposal.targetItemId ? relatedLearningTargetItemIds(proposal.targetItemId) : [],
          sourceEventName: event.name,
          sourceEventDate: event.eventDate,
          sourceType: 'internal-retrospective',
          sourceProposalId: proposal.id,
          sourceExcerpt: proposal.sourceExcerpt,
          confidence: proposal.confidence,
          createdAt: new Date().toISOString()
        });
        proposal.approved = true;
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-dismiss-retrospective-proposal]').forEach(element => {
      element.addEventListener('click', () => {
        const event = getActiveEvent();
        const analysis = event?.retrospective?.taskAnalysis;
        if (!event || !analysis) return;
        analysis.proposals = (analysis.proposals ?? []).filter(proposal => proposal.id !== element.dataset.dismissRetrospectiveProposal);
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-action="retry-feedback"]').forEach(element => {
      element.addEventListener('click', () => {
        const event = getActiveEvent();
        if (!event) return;
        feedbackCache.delete(event.id);
        ensureFeedbackLoaded(event.id, true);
        render();
      });
    });

    document.getElementById('feedbackCampaignForm')?.addEventListener('submit', async eventArgs => {
      eventArgs.preventDefault();
      const event = getActiveEvent();
      if (!event) return;
      const button = eventArgs.currentTarget.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = 'Saving feedback form…';
      try {
        const response = await fetch(`/api/feedback/events/${encodeURIComponent(event.id)}/campaign`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventName: event.name,
            eventDate: event.eventDate,
            opensOn: document.getElementById('feedbackOpensOn')?.value || null,
            closesOn: document.getElementById('feedbackClosesOn')?.value || null,
            customQuestion: document.getElementById('feedbackCustomQuestion')?.value.trim() || null,
            isOpen: document.getElementById('feedbackIsOpen')?.checked !== false
          })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'The feedback form could not be saved.');
        feedbackCache.delete(event.id);
        await ensureFeedbackLoaded(event.id, true);
      } catch (error) {
        alert(error.message || 'The feedback form could not be saved.');
        button.disabled = false;
        button.textContent = 'Save feedback form';
      }
    });

    document.querySelectorAll('[data-action="copy-feedback-link"]').forEach(element => {
      element.addEventListener('click', async () => {
        const input = document.getElementById('feedbackPublicUrl');
        if (!input) return;
        await navigator.clipboard.writeText(input.value);
        element.textContent = 'Copied';
        setTimeout(() => { if (element.isConnected) element.textContent = 'Copy link'; }, 1800);
      });
    });

    document.querySelectorAll('[data-seed-feedback-insight]').forEach(element => {
      element.addEventListener('click', () => {
        const event = getActiveEvent();
        const data = event ? feedbackCache.get(event.id) : null;
        const response = data?.responses?.find(candidate => candidate.id === element.dataset.seedFeedbackInsight);
        const question = data?.campaign?.questions?.find(candidate => candidate.id === element.dataset.feedbackQuestion);
        if (!response || !question) return;
        const answer = feedbackAnswer(response, question.id);
        document.getElementById('insightTitle').value = question.id === 'dietary-choice-comment' ? 'Review food and dietary choice' : question.label;
        document.getElementById('insightSummary').value = answer;
        document.getElementById('insightEvidenceCount').value = '1';
        const preferredTargetItemId = question.targetItemIds?.find(itemId => itemIndex.get(itemId)?.item?.type === 'task') ?? question.targetItemIds?.[0];
        const target = preferredTargetItemId
          ? `item:${preferredTargetItemId}`
          : question.targetSectionId
            ? `section:${question.targetModuleId ?? ''}:${question.targetSectionId}`
            : question.targetModuleId
              ? `module:${question.targetModuleId}`
              : '';
        document.getElementById('insightTarget').value = target;
        document.getElementById('carryForwardInsightForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        requestAnimationFrame(() => document.getElementById('insightSummary')?.focus());
      });
    });

    document.getElementById('carryForwardInsightForm')?.addEventListener('submit', eventArgs => {
      eventArgs.preventDefault();
      const event = getActiveEvent();
      if (!event) return;
      const targetValue = document.getElementById('insightTarget').value;
      if (!targetValue) return;
      const [targetType, targetModuleId, targetSectionId] = targetValue.split(':');
      const insight = {
        id: crypto.randomUUID(),
        title: document.getElementById('insightTitle').value.trim(),
        summary: document.getElementById('insightSummary').value.trim(),
        importance: document.getElementById('insightImportance').value,
        evidenceCount: Number(document.getElementById('insightEvidenceCount').value || 0),
        targetModuleIds: targetType === 'module' ? [targetModuleId] : targetType === 'section' ? [targetModuleId] : [],
        targetSectionIds: targetType === 'section' ? [targetSectionId] : [],
        targetItemIds: targetType === 'item' ? [targetModuleId] : [],
        sourceEventName: event.name,
        sourceEventDate: event.eventDate,
        createdAt: new Date().toISOString()
      };
      event.learningInsights ??= [];
      event.learningInsights.push(insight);
      saveState();
      render();
    });

    document.querySelectorAll('[data-remove-learning-insight]').forEach(element => {
      element.addEventListener('click', () => {
        const event = getActiveEvent();
        const insight = event?.learningInsights?.find(candidate => candidate.id === element.dataset.removeLearningInsight);
        if (!event || !insight || !confirm(`Remove the carry-forward learning “${insight.title}”?`)) return;
        event.learningInsights = event.learningInsights.filter(candidate => candidate.id !== insight.id);
        saveState();
        render();
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
      const saveButton = referenceLibraryForm.querySelector('[data-reference-save]');
      if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = 'Analysing relevance…';
      }
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
        if (saveButton) {
          saveButton.disabled = false;
          saveButton.textContent = 'Save and analyse reference';
        }
        return;
      }
      const metadata = {
        title: document.getElementById('reference-library-title').value.trim(),
        category: document.getElementById('reference-library-category').value.trim(),
        tags: parseReferenceTags(document.getElementById('reference-library-tags').value),
        description: document.getElementById('reference-library-description').value.trim()
      };
      const relevanceProfile = await compileReferenceProfile(metadata);
      const next = {
        id,
        title: metadata.title,
        category: metadata.category,
        priority: Number(document.getElementById('reference-library-priority').value || 0),
        tags: metadata.tags,
        description: metadata.description,
        relevanceProfile,
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

    document.querySelectorAll('[data-directory-contact-field]').forEach(element => {
      element.addEventListener('change', () => {
        const row = element.closest('[data-directory-contact-id]');
        const contact = state.contacts.find(item => item.id === row?.dataset.directoryContactId);
        if (!contact) return;
        const field = element.dataset.directoryContactField;
        const next = element.value.trim();
        if (field === 'name' && !next) {
          element.setCustomValidity('Enter a name for this directory record.');
          element.reportValidity();
          return;
        }
        element.setCustomValidity('');
        contact[field] = next;
        refreshStructuredAssignments();
        saveState();
        if (field === 'type') render();
      });
    });

    document.querySelectorAll('[data-directory-contact-boolean]').forEach(element => {
      element.addEventListener('change', () => {
        const contact = state.contacts.find(item => item.id === element.closest('[data-directory-contact-id]')?.dataset.directoryContactId);
        if (!contact) return;
        contact[element.dataset.directoryContactBoolean] = element.checked;
        refreshStructuredAssignments();
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-directory-contact-role]').forEach(element => {
      element.addEventListener('change', () => {
        const contact = state.contacts.find(item => item.id === element.closest('[data-directory-contact-id]')?.dataset.directoryContactId);
        if (!contact) return;
        const roleId = element.dataset.directoryContactRole;
        contact.roleIds = element.checked
          ? [...new Set([...(contact.roleIds ?? []), roleId])]
          : (contact.roleIds ?? []).filter(id => id !== roleId);
        saveState();
      });
    });

    document.querySelectorAll('[data-directory-platform-role]').forEach(element => {
      element.addEventListener('change', () => {
        const contact = state.contacts.find(item => item.id === element.closest('[data-directory-contact-id]')?.dataset.directoryContactId);
        if (!contact) return;
        const roleId = element.dataset.directoryPlatformRole;
        contact.platformRoleIds = element.checked
          ? [...new Set([...(contact.platformRoleIds ?? []), roleId])]
          : (contact.platformRoleIds ?? []).filter(id => id !== roleId);
        saveState();
      });
    });

    document.querySelectorAll('[data-delete-directory-contact]').forEach(element => {
      element.addEventListener('click', () => {
        const contact = state.contacts.find(item => item.id === element.dataset.deleteDirectoryContact);
        if (!contact) return;
        const eventUsage = contactEventUsage(contact);
        if (eventUsage.length) {
          alert(`${contact.name} cannot be deleted because it is used by ${eventUsage.map(event => event.name || 'Untitled event').join(', ')}.`);
          render();
          return;
        }

        const linkedRoles = responsibilityRoles().filter(role => role.ownerContactId === contact.id);
        const recordLabel = contact.type === 'mailbox' ? 'shared mailbox' : 'person';
        const unlinkMessage = linkedRoles.length
          ? `\n\nThis will also remove it as the contact route for: ${linkedRoles.map(role => role.name).join(', ')}.`
          : '';
        if (!confirm(`Delete the ${recordLabel} “${contact.name}”? This cannot be undone.${unlinkMessage}`)) return;

        state.contacts = state.contacts.filter(item => item.id !== contact.id);
        for (const role of linkedRoles) role.ownerContactId = '';
        refreshStructuredAssignments();
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-directory-role-field]').forEach(element => {
      element.addEventListener('change', () => {
        const role = state.roles.find(item => item.id === element.closest('[data-directory-role-id]')?.dataset.directoryRoleId);
        if (!role) return;
        const field = element.dataset.directoryRoleField;
        const next = element.value.trim();
        if (field === 'name' && !next) {
          element.setCustomValidity('Enter a role name.');
          element.reportValidity();
          return;
        }
        element.setCustomValidity('');
        role[field] = field === 'fallbackRoleId' ? (next || null) : next;
        refreshStructuredAssignments();
        saveState();
        if (field === 'ownerContactId' || field === 'fallbackRoleId') render();
      });
    });

    document.querySelectorAll('[data-directory-role-boolean]').forEach(element => {
      element.addEventListener('change', () => {
        const role = state.roles.find(item => item.id === element.closest('[data-directory-role-id]')?.dataset.directoryRoleId);
        if (!role) return;
        role[element.dataset.directoryRoleBoolean] = element.checked;
        refreshStructuredAssignments();
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-delete-directory-role]').forEach(element => {
      element.addEventListener('click', () => {
        const role = state.roles.find(item => item.id === element.dataset.deleteDirectoryRole);
        if (!role) return;
        const usage = directoryRoleDeletionUsage(role);
        if (!usage.canDelete) {
          alert(`${role.name} cannot be deleted because it is used by ${directoryRoleDeletionSummary(usage)}.`);
          render();
          return;
        }
        if (!confirm(`Delete the role “${role.name}”? This cannot be undone.`)) return;

        state.roles = state.roles.filter(item => item.id !== role.id);
        state.deletedRoleIds = [...new Set([...(state.deletedRoleIds ?? []), role.id])];
        refreshStructuredAssignments();
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-action="add-directory-contact"]').forEach(element => {
      element.addEventListener('click', () => {
        const contact = normaliseDirectoryContact({ id: crypto.randomUUID(), type: 'person', name: 'New person', email: '', roleIds: [], platformRoleIds: ['team-member'], canLogin: false, canReceiveTasks: true, active: true });
        state.contacts.push(contact);
        state.activeView = 'directory';
        saveState();
        render();
        revealDirectoryRecord(
          `[data-directory-contact-id="${CSS.escape(contact.id)}"]`,
          'input[data-directory-contact-field="name"]');
      });
    });

    document.querySelectorAll('[data-action="add-directory-role"]').forEach(element => {
      element.addEventListener('click', () => {
        const role = normaliseDirectoryRole({ id: `role-${crypto.randomUUID()}`, name: 'New role', area: '', active: true, selectableForTasks: true, source: 'directory' });
        state.roles.push(role);
        saveState();
        render();
        revealDirectoryRecord(
          `[data-directory-role-id="${CSS.escape(role.id)}"]`,
          'input[data-directory-role-field="name"]');
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
        const staffBriefingPhase = document.getElementById('admin-staff-briefing-phase')?.value || undefined;
        const staffBriefingInstructionElement = document.getElementById('admin-staff-briefing-instruction');
        const staffBriefingInstruction = staffBriefingInstructionElement?.value.trim() || undefined;
        if (type === 'task' && staffBriefingPhase && !staffBriefingInstruction) {
          alert('Enter a practical staff briefing instruction for this operational task.');
          staffBriefingInstructionElement?.focus();
          return;
        }
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
          staffBriefingPhase,
          staffBriefingAudience: document.getElementById('admin-staff-briefing-audience')?.value.trim() || undefined,
          staffBriefingInstruction,
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
      element.addEventListener('click', async () => {
        element.disabled = true;
        try {
          const candidate = structuredClone(playbook);
          candidate.responsibilityRoles = responsibilityRoles().map(role => ({
            id: role.id,
            name: role.name,
            area: role.area,
            fallbackRoleId: role.fallbackRoleId ?? null
          }));
          for (const draft of state.adminDraftItems) {
            const module = candidate.modules.find(item => item.id === draft.moduleId);
            const section = module?.sections.find(item => item.id === draft.sectionId);
            if (!section) throw new Error(`Draft target ${draft.moduleId}/${draft.sectionId} no longer exists.`);
            const showWhen = draft.conditionQuestion ? { all: [{ questionId: draft.conditionQuestion, operator: 'equals', value: draft.conditionValue }] } : undefined;
            if (draft.type === 'task') {
              const role = (candidate.responsibilityRoles ?? []).find(item => item.id === draft.defaultOwnerRoleId);
              const staffBriefing = draft.staffBriefingPhase
                ? {
                    phase: draft.staffBriefingPhase,
                    audience: draft.staffBriefingAudience || role?.area || role?.name || 'Event team',
                    instruction: draft.staffBriefingInstruction
                  }
                : undefined;
              section.items.push({ id: draft.id, type: 'task', title: draft.wording, deadlineCode: draft.deadlineCode, defaultOwnerRoleId: draft.defaultOwnerRoleId, responsibleArea: role?.area, staffBriefing, showWhen, source: 'admin' });
            } else {
              section.items.push({ id: draft.id, type: 'question', label: draft.wording, answerType: draft.answerType, assignmentMode: draft.answerType === 'assignment' ? 'personOrRole' : undefined, required: true, showWhen, source: 'admin' });
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
              requireOverrideReason: true,
              source: 'admin'
            });
          }
          validatePlaybook(candidate);
          const nextVersion = Number.parseFloat(candidate.schemaVersion || '1') + 0.1;
          candidate.schemaVersion = nextVersion.toFixed(1);
          await persistPlaybookTemplate(candidate, 'manual-admin');
          state.adminDraftItems = [];
          state.adminDraftAdvisories = [];
          saveState();
          alert(`Playbook v${playbook.schemaVersion} validated and published for the club.`);
          render();
        } catch (error) {
          alert(`Cannot publish: ${error.message}`);
        } finally {
          element.disabled = false;
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
        const expired = (state.notificationOutbox ?? []).filter(item => item.status === 'queued' && isExpiredTaskNotification(item));
        for (const notification of expired) notification.status = 'expired';
        const queued = (state.notificationOutbox ?? []).filter(item => item.status === 'queued');
        if (expired.length) saveState();
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
      element.addEventListener('click', async () => {
        if (!confirm('Reset the playbook template to the bundled sample? Your event answers will be retained where IDs still match.')) {
          return;
        }
        element.disabled = true;
        try {
          const response = await fetch('/api/admin/playbook/template/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expectedRevision: playbookTemplateRevision })
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) {
            if (response.status === 409 && result.current?.template) {
              applyPlaybookTemplateDocument(result.current);
              throw new Error('Another administrator updated the club Playbook first. The latest version has been loaded; review it before restoring the bundled core.');
            }
            throw new Error(result.error || result.detail || 'The bundled Playbook could not be restored.');
          }
          applyPlaybookTemplateDocument(result);
        } catch (error) {
          alert(error.message);
          element.disabled = false;
        }
      });
    });

    const newEventForm = document.getElementById('new-event-form');
    const newEventDialog = document.getElementById('new-event-dialog');

    document.querySelectorAll('[data-cancel-new-event]').forEach(button => {
      button.addEventListener('click', () => {
        resetNewEventForm();
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
        const eventTypeInput = document.getElementById('new-event-type');
        const attendeesInput = document.getElementById('new-event-attendees');
        const startTimeInput = document.getElementById('new-event-start-time');
        const endTimeInput = document.getElementById('new-event-end-time');

        const name = nameInput.value.trim();
        const eventDate = eventDateInput.value;
        const organiserInput = document.getElementById('new-event-organiser');
        const organiser = organiserInput.value.trim();
        const organiserRef = assignmentReferenceFromInput(organiserInput, 'person');
        const description = descriptionInput.value.trim();

        if (startTimeInput.value && endTimeInput.value && endTimeInput.value <= startTimeInput.value) {
          endTimeInput.setCustomValidity('Choose an end time after the start time.');
          endTimeInput.reportValidity();
          endTimeInput.setCustomValidity('');
          return;
        }

        if (organiser && !organiserRef) {
          organiserInput.setCustomValidity('Choose an organiser from People & Roles.');
          organiserInput.reportValidity();
          return;
        }
        organiserInput.setCustomValidity('');

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
        createEvent(name, organiser, eventDate, description, milestoneDates, organiserRef, {
          eventTypeId: Number(eventTypeInput?.value) || 0,
          expectedAttendees: Math.max(0, Number(attendeesInput.value) || 0),
          startTime: startTimeInput.value,
          endTime: endTimeInput.value
        });
        newEventDialog?.close();
        render();
      });
    }
  }

  function exportEventPlan() {
    const event = getActiveEvent();
    if (!event) return;
    const tasks = getActiveTasks(event).map(task => {
      const assignment = taskAssignmentReference(task.state);
      const recipient = assignmentRecipient(assignment ?? task.state.assignee, event);
      return {
        id: task.item.id,
        module: task.module.title,
        title: task.item.title,
        deadlineCode: task.item.deadlineCode ?? null,
        dueDate: task.dueDate,
        expiresOn: task.expiresOn,
        expired: task.expired,
        assignment,
        assignee: assignmentDisplay(assignment, task.state.assignee ?? '') || null,
        recipient: recipient.name || recipient.email ? recipient : null,
        completed: Boolean(task.state.completed),
        status: task.state.completed ? 'completed' : task.expired ? 'expired' : 'open',
        notes: task.state.notes ?? null
      };
    });

    const exportData = {
      playbookId: playbook.id,
      playbookSchemaVersion: playbook.schemaVersion,
      exportedAt: new Date().toISOString(),
      event: {
        id: event.id,
        name: event.name,
        organiser: event.organiser,
        organiserRef: event.organiserRef ?? null,
        eventDate: event.eventDate,
        description: event.description,
        lifecycle: structuredClone(event.lifecycle),
        deadlineOffsets: Object.fromEntries(playbook.deadlineCodes.map(code => [code.code, getDeadlineOffset(code.code, event)])),
        answers: event.answers,
        questionMeta: structuredClone(event.questionMeta ?? {}),
        previousAnswerHints: structuredClone(event.clonedAnswerHints ?? {}),
        finances: structuredClone(normaliseEventFinances(event)),
        financeSummary: financeTotals(event),
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
      ['Event', 'Module', 'Task', 'Deadline code', 'Due date', 'Expires after', 'Assigned to', 'Status', 'Notes']
    ];
    for (const task of getActiveTasks(event)) {
      rows.push([
        event.name,
        task.module.title,
        task.item.title,
        task.item.deadlineCode ?? '',
        task.dueDate ?? '',
        task.expiresOn ?? '',
        task.state.assignee ?? '',
        task.state.completed ? 'Complete' : task.expired ? 'Expired' : 'Open',
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
    if (!accessSession.isAdmin) {
      location.assign(adminLoginUrl('admin'));
      return;
    }
    if (!file) return;

    try {
      let candidate = JSON.parse(await file.text());
      candidate = migratePlaybookMilestoneCodes(candidate);
      validatePlaybook(candidate);
      if (state.events.length > 0 && !confirm('Load this playbook template? Existing event data will be retained, but questions or tasks with different IDs may no longer appear.')) {
        return;
      }
      await persistPlaybookTemplate(candidate, 'json-import');
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
      migrateFoodServiceReviewCompletionState();
      migrateEventControlStateV37();
      await initialiseClubBranding();
      await initialiseAccessSession();
      if (accessSession.isAdmin && playbookTemplateNeedsMigration) {
        try {
          await persistPlaybookTemplate(playbook, 'browser-admin-migration');
        } catch (error) {
          console.warn('The previous browser Playbook customisations could not be migrated to shared storage.', error);
        }
      }
      await initialisePluginStatus();
      await initialiseSharedState();
      migrateMilestoneState();
      migrateAdmissionPlanningState();
      migrateAdmissionModelV38();
      migrateAdmissionPricingState();
      migrateFoodServiceReviewCompletionState();
      migrateEventControlStateV37();
      initialiseOperationalState();
      const params = new URLSearchParams(location.search);
      const requestedView = params.get('view');
      if (requestedView && ADMIN_VIEWS.has(requestedView) && !accessSession.isAdmin) {
        location.replace(adminLoginUrl(requestedView));
        return;
      }
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
            state.taskBoardHorizon = 'auto';
            history.replaceState({}, '', location.pathname);
          }
        }
      }
      await syncServerCompletions();
      if (applyRequestedTaskDeepLink(params)) saveState();
      render();
      startPlaybookTemplatePolling();
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

  window.addEventListener('pagehide', () => {
    if (playbookTemplatePollTimer) window.clearInterval(playbookTemplatePollTimer);
    playbookTemplatePollTimer = null;
  });
  window.addEventListener('pageshow', startPlaybookTemplatePolling);
})();
