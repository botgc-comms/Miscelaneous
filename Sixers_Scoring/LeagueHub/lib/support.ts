import {
  AppError,
  text,
  requireThat,
  type State,
  type Member,
  type Action,
} from './model';

export const INCIDENT_FORM_URL =
  'https://drive.google.com/file/d/1qC6vZsblLX21oSCiaTjb4BjnqAcNHJHu/view';
export const SAFEGUARDING_URL = 'https://www.golf-foundation.org/safeguarding';
export const incidentFields = [
  ['involved', 'People involved'],
  ['handledBy', 'People who dealt with the incident'],
  ['date', 'Date of incident'],
  ['venue', 'Venue'],
  ['location', 'Location at the venue'],
  ['nature', 'Nature of the incident'],
  ['before', 'What happened before the incident?'],
  ['after', 'What happened afterwards, including action taken?'],
] as const;
export type IncidentReport = Record<(typeof incidentFields)[number][0], string>;
export type SupportMessage = {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string;
};
export type SupportTicket = {
  id: string;
  leagueId: string;
  orgId: string;
  organiserId: string;
  createdBy: string;
  subject: string;
  kind: 'support' | 'incident';
  status: 'open' | 'waiting' | 'resolved';
  createdAt: string;
  updatedAt: string;
  messages: SupportMessage[];
  incident?: IncidentReport;
};
export function supportAdmins(s: State, leagueId: string) {
  const league = s.leagues.find((l) => l.id === leagueId);
  const assigned = s.members.filter(
    (m) =>
      ['admin', 'league-admin'].includes(m.role) &&
      [league?.adminId, league?.assistantId].includes(m.id),
  );
  return assigned.length
    ? assigned
    : s.members.filter(
        (m) =>
          m.role === 'admin' ||
          (m.role === 'league-admin' && m.leagueIds.includes(leagueId)),
      );
}
export function canReadSupport(s: State, m: Member, ticket: SupportTicket) {
  return (
    m.role === 'admin' ||
    (m.role === 'organiser' &&
      ticket.organiserId === m.id &&
      m.orgIds.includes(ticket.orgId)) ||
    (m.role === 'league-admin' &&
      supportAdmins(s, ticket.leagueId).some((a) => a.id === m.id))
  );
}
export function applySupportAction(
  source: State,
  m: Member,
  a: Action,
  now: string,
): State {
  const s = structuredClone(source);
  requireThat(
    ['admin', 'league-admin', 'organiser'].includes(m.role),
    'Support is available to organisers and Foundation administrators.',
    403,
  );
  s.supportTickets ??= [];
  let ticket = s.supportTickets.find((t) => t.id === a.ticketId);
  if (a.type === 'support-create') {
    const leagueId = text(a.leagueId || '', 'League', 100, false);
    const orgId = text(a.orgId, 'Club', 100);
    const organiser = s.members.find(
      (p) =>
        p.id === (m.role === 'organiser' ? m.id : a.organiserId) &&
        p.role === 'organiser',
    );
    requireThat(
      organiser &&
        organiser.orgIds.includes(orgId) &&
        s.orgs.some((o) => o.id === orgId),
      'Choose an organiser for this club.',
    );
    if (leagueId)
      requireThat(
        s.leagues.some((l) => l.id === leagueId) &&
          s.teams.some(
            (t) =>
              t.orgId === orgId && t.leagueId === leagueId && !t.withdrawnAt,
          ),
        'Choose a league for this club.',
      );
    requireThat(
      m.role !== 'league-admin' ||
        supportAdmins(s, leagueId).some((p) => p.id === m.id),
      'You are not assigned to support this league.',
      403,
    );
    requireThat(
      ['support', 'incident'].includes(a.kind),
      'Choose support or an incident report.',
    );
    const admins = supportAdmins(s, leagueId);
    requireThat(
      admins.length > 0,
      'A Foundation administrator must be assigned before this request can be sent.',
    );
    let incident: IncidentReport | undefined;
    if (a.kind === 'incident') {
      incident = Object.fromEntries(
        incidentFields.map(([key, label]) => [
          key,
          text(a.incident?.[key], label, key === 'date' ? 10 : 4000),
        ]),
      ) as IncidentReport;
      requireThat(
        /^\d{4}-\d{2}-\d{2}$/.test(incident.date) &&
          !Number.isNaN(Date.parse(incident.date)) &&
          new Date(incident.date).toISOString().slice(0, 10) === incident.date,
        'Enter a valid incident date.',
      );
    }
    ticket = {
      id: crypto.randomUUID(),
      leagueId,
      orgId,
      organiserId: organiser.id,
      createdBy: m.id,
      subject: text(a.subject, 'Subject', 120),
      kind: a.kind,
      status: m.role === 'organiser' ? 'open' : 'waiting',
      createdAt: now,
      updatedAt: now,
      incident,
      messages: [
        {
          id: crypto.randomUUID(),
          authorId: m.id,
          authorName: m.name,
          text:
            text(a.message, 'Message', 5000, a.kind !== 'incident') ||
            'Incident report submitted for review.',
          createdAt: now,
        },
      ],
    };
    s.supportTickets.unshift(ticket);
  } else {
    requireThat(
      ticket && canReadSupport(s, m, ticket),
      'This support request is not available to you.',
      403,
    );
    if (a.type === 'support-read') {
      for (const n of s.notifications || [])
        if (n.recipient === m.id && n.supportTicketId === ticket.id)
          n.readAt = now;
      return s;
    }
    if (a.type === 'support-reply') {
      ticket.messages.push({
        id: crypto.randomUUID(),
        authorId: m.id,
        authorName: m.name,
        text: text(a.message, 'Message', 5000),
        createdAt: now,
      });
      ticket.status = m.role === 'organiser' ? 'open' : 'waiting';
    } else if (a.type === 'support-status') {
      requireThat(
        ['open', 'resolved'].includes(a.status),
        'Choose open or resolved.',
      );
      ticket.status = a.status;
      ticket.messages.push({
        id: crypto.randomUUID(),
        authorId: m.id,
        authorName: m.name,
        text:
          a.status === 'resolved'
            ? 'Marked this request as resolved.'
            : 'Reopened this request.',
        createdAt: now,
      });
    } else throw new AppError('Unknown support action.');
    ticket.updatedAt = now;
  }
  const recipients = [
    ticket.organiserId,
    ...supportAdmins(s, ticket.leagueId).map((p) => p.id),
  ];
  s.notifications ??= [];
  for (const recipient of new Set(
    recipients.filter(
      (id) =>
        id !== m.id &&
        s.members.some((p) => p.id === id && canReadSupport(s, p, ticket!)),
    ),
  )) {
    s.notifications.unshift({
      id: crypto.randomUUID(),
      recipient,
      supportTicketId: ticket.id,
      createdAt: now,
      text: `Support request ${ticket.id.slice(0, 8).toUpperCase()} has an update. Sign in to read and reply.`,
    });
  }
  // Keep incident descriptions, names and replies out of the general activity feed and emails.
  s.activity.unshift({
    id: crypto.randomUUID(),
    at: now,
    by: m.id,
    text: 'Updated a private support request',
  });
  s.activity = s.activity.slice(0, 500);
  return s;
}

export function incidentReportHtml(ticket: SupportTicket, club: string) {
  const escape = (v: string) =>
    v.replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c]!,
    );
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>GolfSixes incident report</title><style>body{font:16px/1.5 Arial,sans-serif;max-width:800px;margin:40px auto;padding:0 24px;color:#143d36}h1{font-size:28px}section{break-inside:avoid;border-bottom:1px solid #ccc;padding:12px 0}h2{font-size:16px;margin:0}p{white-space:pre-wrap;margin:8px 0}.signatures p{margin:32px 0}@media print{button{display:none}body{margin:0}}</style><button onclick="window.print()">Print / save as PDF</button><h1>GolfSixes incident report</h1><p>${escape(club)} · Reference ${escape(ticket.id.slice(0, 8).toUpperCase())}</p><p>Workspace record. This does not confirm submission to the Golf Foundation.</p>${incidentFields.map(([key, label]) => `<section><h2>${escape(label)}</h2><p>${escape(ticket.incident?.[key] || '')}</p></section>`).join('')}<div class="signatures"><p>Adult signature: ____________________________________</p><p>Adult signature: ____________________________________</p><p>Welfare officer signature: ______________________________</p><p>Date: _____________________________________________</p></div><p>Use the Foundation’s official incident form and follow your club’s reporting process where required.</p></html>`;
}
