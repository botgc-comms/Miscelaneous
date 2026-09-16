import { db, json, failure, sameOrigin, saveCAS, type Row } from '@/lib/server';
import {
  AppError,
  requireThat,
  upgradeState,
  canHelpLogin,
  notify,
  type State,
  type LoginHelpRequest,
} from '@/lib/model';
import { limit } from '@/lib/email';
import { digest } from '@/lib/identity';

// Available before app sign-in. This directory contains club names only, never account lookups.
export async function GET(req: Request) {
  try {
    const search = (new URL(req.url).searchParams.get('q') || '')
      .trim()
      .toLowerCase();
    if (search.length < 2) return json({ clubs: [] });
    requireThat(search.length <= 100, 'Use a shorter club name.');
    const rows = (
      await db()
        .prepare('SELECT id,data FROM workspaces WHERE demo=0')
        .all<{ id: string; data: string }>()
    ).results;
    return json({
      clubs: rows
        .flatMap((w) =>
          (JSON.parse(w.data) as State).orgs
            .filter((o) => o.name.toLowerCase().includes(search))
            .map((o) => ({ workspace: w.id, id: o.id, name: o.name })),
        )
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 30),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const raw = await req.text();
    requireThat(raw.length <= 4000, 'This request is too large.');
    const a = JSON.parse(raw);
    const value = (key: string, max: number) => {
      requireThat(
        typeof a[key] === 'string' && a[key].trim().length <= max,
        'Check your contact details.',
      );
      return a[key].trim();
    };
    const name = value('name', 100),
      phone = value('phone', 40),
      email = value('email', 254).toLowerCase(),
      orgId = value('orgId', 100),
      workspace = value('workspace', 200);
    requireThat(
      name.length >= 2 && phone.replace(/\D/g, '').length >= 7,
      'Enter your name and a phone number where your organiser can reach you.',
    );
    requireThat(
      !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
      'Check your contact email address.',
    );
    requireThat(
      ['forgot-email', 'no-code', 'lost-email', 'other'].includes(a.reason),
      'Choose what you need help with.',
    );
    requireThat(
      a.consent === true,
      'Agree to share this help request with your club organiser and the Foundation.',
    );
    await limit(
      `help-ip:${await digest(req.headers.get('cf-connecting-ip') || 'local')}`,
      10,
      3600,
    );
    await limit(
      `help-contact:${await digest(workspace + orgId + phone.replace(/\D/g, ''))}`,
      3,
      600,
    );
    for (let attempt = 0; attempt < 4; attempt++) {
      const row = await db()
        .prepare('SELECT * FROM workspaces WHERE id=? AND demo=0')
        .bind(workspace)
        .first<Row>();
      requireThat(row, 'Choose your club from the search results.', 404);
      const s = upgradeState(JSON.parse(row.data) as State);
      requireThat(
        s.orgs.some((o) => o.id === orgId),
        'Choose your club from the search results.',
        404,
      );
      s.loginHelpRequests ??= [];
      if (
        s.loginHelpRequests.some(
          (r) =>
            r.orgId === orgId &&
            r.phone.replace(/\D/g, '') === phone.replace(/\D/g, '') &&
            r.status !== 'resolved',
        )
      )
        return json({ ok: true });
      const request: LoginHelpRequest = {
        id: crypto.randomUUID(),
        orgId,
        name,
        phone,
        email,
        reason: a.reason,
        status: 'new',
        requestedAt: new Date().toISOString(),
      };
      s.loginHelpRequests.push(request);
      notify(
        s,
        s.members.filter((m) => canHelpLogin(s, m, orgId)).map((m) => m.id),
        `A parent has asked for help signing in to ${s.orgs.find((o) => o.id === orgId)!.name}. Open login help on your overview.`,
      );
      if (await saveCAS(row, s)) return json({ ok: true });
    }
    throw new AppError(
      'Another update arrived. Please send your request again.',
      409,
    );
  } catch (e) {
    return failure(e);
  }
}
