import {
  db,
  user,
  json,
  failure,
  hash,
  saveCAS,
  context,
  snapshot,
  sameOrigin,
  type Row,
} from '@/lib/server';
import { AppError, type State, type Member } from '@/lib/model';
import { acceptInvitation } from '@/lib/invitations';
async function find(token: string) {
  if (!token || token.length > 200)
    throw new AppError('Invalid invitation.', 404);
  const digest = await hash(token);
  const row = await db()
    .prepare(
      "SELECT * FROM workspaces WHERE demo = 0 AND EXISTS (SELECT 1 FROM json_each(workspaces.data,'$.invites') AS i WHERE json_extract(i.value,'$.hash') = ?)",
    )
    .bind(digest)
    .first<Row>();
  if (!row)
    throw new AppError(
      'This invitation is not available. Ask your organiser for a new link.',
      404,
    );
  const state = JSON.parse(row.data) as State;
  const invite = state.invites.find((i) => i.hash === digest)!;
  if (invite.revoked || (!invite.acceptedAt && Date.parse(invite.expires) < Date.now()))
    throw new AppError(
      'This invitation has expired or was revoked. Ask for a new link.',
      410,
    );
  return { row, state, invite };
}
export async function GET(req: Request) {
  try {
    const { state, invite, row } = await find(
      new URL(req.url).searchParams.get('token') || '',
    );
    return json({
      name: row.name,
      organisations: state.orgs
        .filter((o) => invite.orgIds.includes(o.id))
        .map((o) => o.name),
      role: invite.role,
      accepted: !!invite.acceptedAt,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const u = await user();
    const { token } = (await req.json()) as { token: string };
    for (let i = 0; i < 4; i++) {
      const { state, row, invite } = await find(token);
      acceptInvitation(state, invite, u);
      if (await saveCAS(row, state))
        return json(await snapshot(await context(row.id)));
    }
    throw new AppError('The workspace is busy. Please try joining again.', 409);
  } catch (e) {
    return failure(e);
  }
}
