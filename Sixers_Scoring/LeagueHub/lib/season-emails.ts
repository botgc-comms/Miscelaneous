import {
  type State,
  type Member,
  type Fixture,
  rosterEligible,
  teamManagers,
} from './model';
import { type EmailMessage } from './email-template';
export type PlannedEmail = {
  id: string;
  recipient: string;
  message: EmailMessage;
};
export function fixtureEmail(
  s: State,
  f: Fixture,
  m: Member,
  origin: string,
  workspace: string,
  heading: string,
  text: string,
): EmailMessage {
  const club = s.clubs.find((c) => c.id === f.clubId);
  const q = new URLSearchParams({
    role:
      m.role === 'parent'
        ? 'parent'
        : m.role === 'organiser'
          ? 'staff'
          : 'admin',
    view:
      m.role === 'organiser'
        ? 'organiser'
        : m.role === 'parent'
          ? 'parent'
          : 'admin',
    workspace,
    fixture: f.id,
  });
  return {
    subject: heading,
    heading,
    paragraphs: [`Hello ${m.name.split(' ')[0]},`, text],
    action: {
      label: m.role === 'parent' ? 'View my fixture' : 'Open fixture',
      url: origin + '/?' + q,
    },
    details: [
      { label: 'Venue', value: club?.name || f.name },
      {
        label: 'Date',
        value: new Intl.DateTimeFormat('en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          timeZone: 'Europe/London',
        }).format(new Date(f.date + 'T12:00:00Z')),
      },
      { label: 'Arrive by', value: f.arrival },
      {
        label: 'Start',
        value: `${f.start} · ${f.format === 'shotgun' ? 'Shotgun start' : 'Tee times'}`,
      },
      {
        label: 'Address',
        value: [club?.address, club?.postcode].filter(Boolean).join(', '),
      },
      {
        label: 'Host instructions',
        value:
          f.instructions ||
          club?.instructions ||
          'Check the fixture in the app for the latest host instructions.',
      },
      ...(f.foodBefore || f.foodAfter
        ? [
            {
              label: 'Food',
              value: [f.foodBefore, f.foodAfter].filter(Boolean).join(' · '),
            },
          ]
        : []),
    ],
  };
}
export function eventEmails(
  before: State,
  after: State,
  workspace: string,
  origin: string,
): PlannedEmail[] {
  const known = new Set((before.notifications || []).map((n) => n.id));
  return (after.notifications || [])
    .filter((n) => !known.has(n.id))
    .flatMap((n) => {
      const m = after.members.find((m) => m.id === n.recipient);
      if (!m) return [];
      const f = after.fixtures.find((f) => f.id === n.fixtureId);
      const q = new URLSearchParams({
        role:
          m.role === 'parent'
            ? 'parent'
            : m.role === 'organiser'
              ? 'staff'
              : 'admin',
        view:
          m.role === 'organiser'
            ? 'organiser'
            : m.role === 'parent'
              ? 'parent'
              : 'admin',
        workspace,
      });
      return [
        {
          id: `event:${workspace}:${n.id}`,
          recipient: m.email,
          message: f
            ? fixtureEmail(
                after,
                f,
                m,
                origin,
                workspace,
                n.text.includes('has been selected')
                  ? 'Your child is playing!'
                  : n.text.includes('unavailable')
                    ? 'Availability changed — please review'
                    : n.text.includes('results are confirmed')
                      ? 'Your fixture results are ready'
                      : n.text.includes('cancelled')
                        ? 'Fixture cancelled'
                        : 'An update for your GolfSixes fixture',
                n.text,
              )
            : {
                subject: 'An update from GolfSixes League',
                heading: 'Your season update',
                paragraphs: [`Hello ${m.name.split(' ')[0]},`, n.text],
                action: { label: 'View update', url: origin + '/?' + q },
              },
        },
      ];
    });
}
export function scheduledEmails(
  s: State,
  workspace: string,
  origin: string,
  today: string,
): PlannedEmail[] {
  const out: PlannedEmail[] = [];
  for (const f of s.fixtures) {
    if (
      !s.leagues.find((l) => l.id === f.leagueId)?.fixturesConfirmedAt ||
      !['scheduled', 'live'].includes(f.status)
    )
      continue;
    const days = Math.round(
      (Date.parse(f.date + 'T12:00Z') - Date.parse(today + 'T12:00Z')) /
        86400000,
    );
    if (![14, 7, 3, 1, 0].includes(days)) continue;
    const players = s.players.filter((p) =>
      f.teamIds.some((t) => rosterEligible(s, p.id, t)),
    );
    const parents = s.members.filter(
      (m) => m.role === 'parent' || players.some((p) => p.parentId === m.id),
    );
    for (const m of parents) {
      const children = players.filter((p) => p.parentId === m.id);
      if (!children.length) continue;
      const selected = children.filter((p) =>
        f.pairs.some((pair) => pair.players.includes(p.id)),
      );
      const unanswered = children.filter(
        (p) =>
          !f.pairs.some((pair) => pair.players.includes(p.id)) &&
          !s.availability?.some(
            (a) =>
              a.fixtureId === f.id &&
              a.playerId === p.id &&
              a.status !== 'unsure',
          ),
      );
      let heading = '',
        text = '';
      if ([14, 7].includes(days) && unanswered.length) {
        heading = 'Can your children play?';
        text = `Please tell your organiser whether ${unanswered.map((p) => p.name).join(' and ')} can play. This helps them choose the team fairly.`;
      }
      if (days === 1 && selected.length) {
        heading = 'You’re playing tomorrow';
        text = `${selected.map((p) => p.name).join(' and ')} ${selected.length === 1 ? 'is' : 'are'} selected. Check the host’s details below before you travel. If plans change, update availability in the app so your club can bring in a reserve.`;
      }
      if (days === 0 && selected.length) {
        heading = 'It’s match day!';
        text = `${selected.map((p) => p.name).join(' and ')} ${selected.length === 1 ? 'is' : 'are'} playing today. Open the fixture for your scorecards and live results. Score entry opens when the organiser starts the fixture.`;
      }
      if (heading)
        out.push({
          id: `reminder:${workspace}:${f.id}:${f.date}:${days}:${m.id}`,
          recipient: m.email,
          message: fixtureEmail(
            s,
            f,
            { ...m, role: 'parent' },
            origin,
            workspace,
            heading,
            text,
          ),
        });
    }
    if ([7, 3].includes(days)) {
      const league = s.leagues.find((l) => l.id === f.leagueId)!;
      const incomplete = f.teamIds.filter(
        (t) =>
          f.pairs.filter((p) => p.teamId === t && p.players.length === 2)
            .length < league.pairs,
      );
      const managers = new Set(incomplete.flatMap((t) => teamManagers(s, t)));
      for (const m of s.members.filter(
        (m) =>
          managers.has(m.id) &&
          (m.role === 'organiser' ||
            m.organiserOrgIds?.length ||
            m.organiserOrgId),
      ))
        out.push({
          id: `selection:${workspace}:${f.id}:${f.date}:${days}:${m.id}`,
          recipient: m.email,
          message: fixtureEmail(
            s,
            f,
            m,
            origin,
            workspace,
            'Time to choose your players',
            `The fixture is ${days} days away. Review family availability, choose your pairs and reserves, then publish your selection so families know who is playing.`,
          ),
        });
    }
  }
  return out;
}
