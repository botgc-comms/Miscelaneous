import { currentIdentity, sitesSignInAvailable } from './identity';
import { db, user, unifyOwnedRecords, saveCAS, type Row } from './server';
import { emailReady, limit } from './email';
import {
  AppError,
  requireThat,
  upgradeState,
  applyAction,
  notify,
  organiserClubs,
  type State,
} from './model';
import type { Family } from './families';

export async function registrationSnapshot() {
  const u = await currentIdentity();
  if (!u)
    return {
      user: null,
      emailReady: emailReady(),
      sitesSignIn: sitesSignInAvailable(),
    };
  await unifyOwnedRecords(u);
  const records = (
    await db().prepare('SELECT * FROM workspaces WHERE demo=0').all<Row>()
  ).results;
  const familyRow = await db()
    .prepare('SELECT data FROM families WHERE id=?')
    .bind(u.userId)
    .first<{ data: string }>();
  const family: Family | undefined = familyRow
    ? JSON.parse(familyRow.data)
    : undefined;
  const memberships = records.flatMap((w) => {
    const s = upgradeState(JSON.parse(w.data) as State),
      m = s.members.find((m) => m.id === u.userId);
    return m
      ? [
          {
            workspace: w.id,
            name: w.name,
            role: m.role,
            organiserOrgId: m.organiserOrgId,
            organiserOrgIds: organiserClubs(m),
            orgIds: m.orgIds,
          },
        ]
      : [];
  });
  return {
    user: {
      name: family?.registration?.name || u.displayName,
      email: u.email,
      phone: family?.registration?.phone || '',
    },
    emailReady: emailReady(),
    sitesSignIn: sitesSignInAvailable(),
    parentRegistered:
      !!family?.registration?.parent || !!family?.children?.length,
    memberships,
    organisations: records.flatMap((w) =>
      (JSON.parse(w.data) as State).orgs.map((o) => ({
        workspace: w.id,
        id: o.id,
        name: o.name,
      })),
    ),
    foundations: records.map((w) => ({ id: w.id, name: w.name })),
    requests: records.flatMap((w) =>
      ((JSON.parse(w.data) as State).accessRequests || [])
        .filter((r) => r.userId === u.userId)
        .map((r) => ({
          ...r,
          workspace: w.id,
          clubName: (JSON.parse(w.data) as State).orgs.find(
            (o) => o.id === r.orgId,
          )?.name,
        })),
    ),
  };
}

export async function register(a: any) {
  const u = await user();
  requireThat(
    ['parent', 'staff', 'admin'].includes(a.role),
    'Choose how you are taking part.',
  );
  requireThat(
    typeof a.name === 'string' && !!a.name.trim() && a.name.length <= 100,
    'Enter your full name.',
  );
  requireThat(
    typeof a.phone === 'string' &&
      a.phone.trim().length >= 5 &&
      a.phone.length <= 40,
    'Enter your contact phone number.',
  );
  await limit(`register:${u.userId}`, 15, 600);
  // The authenticated identity supplies the email; form values never grant identity or access.
  const profile = {
    name: a.name.trim(),
    phone: a.phone.trim(),
    parent: a.role === 'parent',
  };
  await db()
    .prepare('INSERT OR IGNORE INTO families(id,data,revision) VALUES (?,?,0)')
    .bind(u.userId, JSON.stringify({ children: [], pendingSync: {} }))
    .run();
  await db()
    .prepare(
      "UPDATE families SET data=json_set(data,'$.registration.name',?,'$.registration.phone',?,'$.registration.parent',json(CASE WHEN json_extract(data,'$.registration.parent')=1 OR ?=1 THEN 'true' ELSE 'false' END)),revision=revision+1 WHERE id=?",
    )
    .bind(profile.name, profile.phone, profile.parent ? 1 : 0, u.userId)
    .run();
  if (a.role === 'parent') return registrationSnapshot();
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await db()
      .prepare('SELECT * FROM workspaces WHERE id=? AND demo=0')
      .bind(typeof a.workspace === 'string' ? a.workspace : '')
      .first<Row>();
    requireThat(
      row,
      'Choose the club or Foundation you are registering with.',
      404,
    );
    const s = upgradeState(JSON.parse(row.data) as State);
    const orgId = a.role === 'staff' ? a.orgId : '';
    requireThat(
      a.role !== 'staff' || s.orgs.some((o) => o.id === orgId),
      'Choose an existing club.',
    );
    const existing = s.members.find((m) => m.id === u.userId);
    if (existing?.role === 'admin') {
      if (a.role === 'staff') {
        const next = applyAction(s, existing, {
          type: 'organiser-club',
          orgId,
        });
        if (!(await saveCAS(row, next))) continue;
      }
      return registrationSnapshot();
    }
    if (
      a.role === 'staff' &&
      existing?.role === 'organiser' &&
      existing.orgIds.includes(orgId)
    )
      return registrationSnapshot();
    const role = a.role === 'staff' ? 'organiser' : 'admin';
    s.accessRequests ??= [];
    if (
      s.accessRequests.some(
        (r) =>
          r.userId === u.userId &&
          r.role === role &&
          r.orgId === orgId &&
          r.status === 'pending',
      )
    )
      return registrationSnapshot();
    s.accessRequests.push({
      id: crypto.randomUUID(),
      userId: u.userId,
      name: profile.name,
      phone: profile.phone,
      email: u.email,
      role,
      orgId,
      status: 'pending',
      requestedAt: new Date().toISOString(),
    });
    notify(
      s,
      s.members.filter((m) => m.role === 'admin').map((m) => m.id),
      `${profile.name} has requested ${role === 'organiser' ? 'junior organiser' : 'Foundation administrator'} access${orgId ? ' for ' + s.orgs.find((o) => o.id === orgId)?.name : ''}.`,
    );
    if (await saveCAS(row, s)) return registrationSnapshot();
  }
  throw new AppError('Another registration arrived. Please try again.', 409);
}
