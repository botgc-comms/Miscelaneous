import {
  context,
  mutate,
  json,
  failure,
  sameOrigin,
  files,
  hash,
  saveCAS,
} from '@/lib/server';
import { AppError } from '@/lib/model';
import { canManageInvite } from '@/lib/invitations';
import { emailReady, sendInvitationEmail, limit } from '@/lib/email';
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const c = await context(
      q.get('workspace') || undefined,
      q.get('view') || undefined,
    );
    if (!['admin', 'league-admin', 'organiser'].includes(c.me.role))
      throw new AppError('Access denied.', 403);
    return json({ emailReady: emailReady() });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const b: any = await req.json();
    if (b.type === 'create') {
      const c = await context(b.workspace, b.view);
      await limit('invite-create:' + c.u.userId, 30, 3600);
      const token = crypto.randomUUID() + crypto.randomUUID(),
        digest = await hash(token);
      // The reusable token stays in private object storage, never in a projected workspace snapshot.
      const key = `invite-links/${c.row.id}/${digest}`;
      await files().put(key, token);
      let result;
      try {
        result = await mutate(b.workspace, b.view, {
          type: 'invite',
          role: b.role,
          orgIds: b.orgIds,
          leagueIds: b.leagueIds || [],
          email: b.email || '',
          hash: digest,
        });
      } catch (e) {
        await files().delete(key);
        throw e;
      }
      return json({
        link: `${new URL(req.url).origin}/?join=${token}`,
        emailReady: emailReady(),
        id: result.state.invites.at(-1)?.id,
      });
    }
    const c = await context(b.workspace, b.view);
    const i = c.state.invites.find((i) => i.id === b.id);
    if (!i || !canManageInvite(c.state, c.me, i))
      throw new AppError('You cannot manage this invitation.', 403);
    if (i.revoked || i.acceptedAt)
      throw new AppError('This invitation is no longer pending.');
    let token = await (
      await files().get(`invite-links/${c.row.id}/${i.hash}`)
    )?.text();
    if (!token || Date.parse(i.expires) <= Date.now()) {
      if (b.type !== 'renew')
        throw new AppError(
          'Create a replacement link for this older or expired invitation.',
        );
      token = crypto.randomUUID() + crypto.randomUUID();
      i.hash = await hash(token);
      i.expires = new Date(Date.now() + 14 * 86400000).toISOString();
      delete i.sentAt;
      await files().put(`invite-links/${c.row.id}/${i.hash}`, token);
      if (!(await saveCAS(c.row, c.state)))
        throw new AppError('Another change arrived. Please try again.', 409);
    }
    const link = `${new URL(req.url).origin}/?join=${token}`;
    if (b.type === 'send') {
      if (!i.email)
        throw new AppError(
          'This shared invitation has no recipient email. Copy its link instead.',
        );
      await limit('invite-send:' + i.id, 3, 900);
      await sendInvitationEmail(
        i.email,
        c.state.orgs
          .filter((o) => i.orgIds.includes(o.id))
          .map((o) => o.name)
          .join(', ') || c.row.name,
        link,
      );
      for (let n = 0; n < 4; n++) {
        const latest = await context(b.workspace, b.view),
          invite = latest.state.invites.find((v) => v.id === i.id);
        if (!invite || invite.hash !== i.hash) break;
        invite.sentAt = new Date().toISOString();
        if (await saveCAS(latest.row, latest.state)) break;
      }
    } else if (!['link', 'renew'].includes(b.type))
      throw new AppError('Unknown invitation action.');
    return json({ link, emailReady: emailReady(), sent: b.type === 'send' });
  } catch (e) {
    return failure(e);
  }
}
