import {
  AppError,
  canOrg,
  addOrganiserClubs,
  type Invite,
  type Member,
  type State,
} from './model';

export function canManageInvite(s: State, m: Member, i: Invite) {
  return (
    m.role === 'admin' ||
    (['organiser', 'league-admin'].includes(m.role) &&
      ['parent', 'organiser'].includes(i.role) &&
      i.orgIds.length > 0 &&
      i.orgIds.every((id) => canOrg(s, m, id)))
  );
}
export function invitationStatus(i: Invite) {
  return i.revoked
    ? 'Revoked'
    : i.acceptedAt
      ? 'Accepted'
      : Date.parse(i.expires) <= Date.now()
        ? 'Expired'
        : 'Invite pending';
}
export function acceptInvitation(
  s: State,
  i: Invite,
  u: { userId: string; email: string; displayName: string },
) {
  if (i.email && i.email.toLowerCase() !== u.email.toLowerCase())
    throw new AppError(
      'Sign in with the email address this invitation was sent to.',
      403,
    );
  if (i.revoked)
    throw new AppError(
      'This invitation was revoked. Ask for a new invitation.',
      410,
    );
  if (i.acceptedAt) {
    if (i.acceptedBy !== u.userId)
      throw new AppError('This invitation has already been accepted.', 403);
    return;
  }
  if (Date.parse(i.expires) <= Date.now())
    throw new AppError(
      'This invitation has expired. Ask for a new invitation.',
      410,
    );
  let m = s.members.find((m) => m.id === u.userId);
  if (!m) {
    m = {
      id: u.userId,
      name: u.displayName,
      email: u.email,
      phone: '',
      role: i.role,
      orgIds: [],
      leagueIds: [],
    };
    s.members.push(m);
  }
  if (m.role === 'admin' && i.role === 'organiser')
    addOrganiserClubs(m, i.orgIds);
  else if (m.role !== 'admin' && i.role !== 'parent') m.role = i.role;
  if (m.role === i.role) {
    m.orgIds = [...new Set([...m.orgIds, ...i.orgIds])];
    m.leagueIds = [...new Set([...m.leagueIds, ...i.leagueIds])];
  }
  if (i.role !== 'parent') {
    i.acceptedAt = new Date().toISOString();
    i.acceptedBy = u.userId;
  }
}
