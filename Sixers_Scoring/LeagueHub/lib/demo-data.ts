import { AppError, type State, type Member } from './model';
const collections = [
  'orgs',
  'clubs',
  'leagues',
  'teams',
  'members',
  'players',
  'fixtures',
  'enrollments',
  'availability',
  'reserves',
  'hostingOffers',
  'fixtureConfirmations',
  'fixtureMessages',
  'accessRequests',
  'loginHelpRequests',
  'profileChanges',
] as const;
/** General data editing is deliberately confined to an owner-only, synthetic sandbox. */
export function editDemoData(state: State, me: Member, action: any): State {
  if (!state.demoSandbox || me.role !== 'admin')
    throw new AppError(
      'General record editing is available in demo mode only.',
      403,
    );
  if (
    !collections.includes(action.collection) ||
    !Array.isArray(action.records) ||
    !Array.isArray(action.removeIds) ||
    action.records.length > 500
  )
    throw new AppError('Choose a demo collection and records to edit.');
  const next = structuredClone(state),
    key = action.collection as (typeof collections)[number];
  const records: any[] = (next[key] || []) as any[];
  const required: Record<string, string[]> = {
    orgs: ['id', 'name'],
    clubs: [
      'id',
      'orgId',
      'name',
      'address',
      'instructions',
      'welfareName',
      'welfareEmail',
      'safeGolf',
    ],
    leagues: [
      'id',
      'name',
      'region',
      'year',
      'holes',
      'pairs',
      'maxStrokes',
      'tiePolicy',
      'status',
    ],
    teams: ['id', 'orgId', 'leagueId', 'name', 'cap', 'color'],
    members: ['id', 'name', 'email', 'phone', 'role', 'orgIds', 'leagueIds'],
    players: [
      'id',
      'orgId',
      'parentId',
      'name',
      'dob',
      'handicap',
      'diet',
      'care',
      'photoConsent',
      'emergencyName',
      'emergencyPhone',
      'consentAt',
    ],
    fixtures: [
      'id',
      'leagueId',
      'clubId',
      'name',
      'date',
      'arrival',
      'start',
      'format',
      'status',
      'teamIds',
      'pairs',
      'slots',
      'scores',
      'results',
      'instructions',
      'foodBefore',
      'foodAfter',
    ],
  };
  for (const patch of action.records) {
    if (
      !patch ||
      typeof patch !== 'object' ||
      Array.isArray(patch) ||
      Object.keys(patch).some((k) =>
        ['__proto__', 'constructor', 'prototype'].includes(k),
      )
    )
      throw new AppError('The proposed demo record is invalid.');
    const id = typeof patch.id === 'string' ? patch.id : crypto.randomUUID();
    const index = records.findIndex((r) => r.id === id),
      old = index >= 0 ? records[index] : undefined;
    const record = { ...old, ...patch, id };
    if ((required[key] || []).some((field) => !(field in record)))
      throw new AppError(
        `The proposed ${key} record is missing required fields. Ask the assistant to include the complete record.`,
      );
    for (const field of [
      'orgIds',
      'leagueIds',
      'teamIds',
      'pairs',
      'slots',
      'results',
    ])
      if (field in record && !Array.isArray(record[field]))
        throw new AppError(`The ${field} field must be a list.`);
    if (key === 'members') {
      record.id = old?.id || `${me.id.split(':')[0]}:${id}`;
      record.email =
        record.id.replace(/[^a-z0-9-]/gi, '-') + '@example.invalid';
      if (old?.id === me.id) record.role = 'admin';
    }
    if (index >= 0) records[index] = record;
    else records.push(record);
  }
  (next as any)[key] = records.filter(
    (r) => r.id === me.id || !action.removeIds.includes(r.id),
  );
  return next;
}
