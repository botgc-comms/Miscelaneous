'use client';
import { useState } from 'react';
import {
  ArrowRight,
  Check,
  Copy,
  Mail,
  Plus,
  Trash2,
  CalendarDays,
} from 'lucide-react';
import { Field, Pick, CheckField, dateLabel, type AppTools } from './widgets';
import {
  type Club,
  type Team,
  leagueAcceptsRegistrations,
  capOrder,
} from '@/lib/model';
import { type HostingOffer } from '@/lib/season-planning';
import { Cap } from './parent-portal';
import { TeamRoster } from './team-roster';
import { OrganiserPriorities } from './organiser-priorities';
import { ClubOrganisers } from './invitations';
import { LoginHelpQueue } from './login-help-queue';
import { teamPriority } from '@/lib/team-priority';
import { useOrganiserGuide, useOrganiserSelection } from './organiser-guide';

export function ClubDetails({
  tools,
  club,
  confirm = false,
  done,
}: {
  tools: AppTools;
  club: Club;
  confirm?: boolean;
  done?: () => void;
}) {
  const [draft, setDraft] = useState(club),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  const set = (key: keyof Club, value: any) => {
    setDraft({ ...draft, [key]: value });
    setSaved(false);
  };
  return (
    <form
      className="setup-club-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setError('');
        try {
          await tools.act({ ...draft, type: 'club' });
          if (confirm)
            await tools.act({ type: 'club-confirm', clubId: club.id });
          setSaved(true);
          done?.();
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <div className="form-grid">
        <Field
          label="Club name"
          value={draft.name}
          onChange={(v) => set('name', v)}
          required
        />
        <Field
          label="Website"
          value={draft.website || ''}
          onChange={(v) => set('website', v)}
        />
        <Field
          label="Address"
          value={draft.address}
          onChange={(v) => set('address', v)}
        />
        <Field
          label="Postcode"
          value={draft.postcode || ''}
          onChange={(v) => set('postcode', v)}
        />
        <Field
          label="County"
          value={draft.county || ''}
          onChange={(v) => set('county', v)}
        />
      </div>
      <Field
        label="Anything visiting families need to know?"
        hint="For example, where to park or which entrance to use."
        large
        value={draft.instructions}
        onChange={(v) => set('instructions', v)}
      />
      <details className="setup-details">
        <summary>Welfare contact & SafeGolf</summary>
        <p>
          Fill in what you know. Missing details won’t stop you getting started.
        </p>
        <div className="form-grid">
          <Field
            label="Welfare contact name"
            value={draft.welfareName}
            onChange={(v) => set('welfareName', v)}
          />
          <Field
            label="Welfare contact email"
            type="email"
            value={draft.welfareEmail}
            onChange={(v) => set('welfareEmail', v)}
          />
        </div>
        <CheckField
          checked={draft.safeGolf}
          onChange={(v) => set('safeGolf', v)}
        >
          Our club is SafeGolf accredited
        </CheckField>
      </details>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="setup-action-row">
        <button className="btn primary" disabled={tools.busy}>
          {tools.busy
            ? 'Saving…'
            : confirm
              ? 'Confirm details & continue'
              : 'Save club details'}
          <ArrowRight size={18} />
        </button>
        {saved && (
          <span role="status">
            <Check size={16} /> Details saved
          </span>
        )}
      </div>
    </form>
  );
}

export function HostingForm({
  tools,
  club,
  leagueId,
  onShared,
}: {
  tools: AppTools;
  club: Club;
  leagueId: string;
  onShared?: () => void;
}) {
  const league = tools.s.leagues.find((l) => l.id === leagueId)!;
  const saved = tools.s.hostingOffers?.find(
    (o) => o.clubId === club.id && o.leagueId === leagueId,
  );
  const [draft, setDraft] = useState<Partial<HostingOffer>>(
    saved || {
      capacity: 1,
      dates: [],
      shotgun: 'unsure',
      presentation: 'unsure',
      food: 'unsure',
      notes: '',
    },
  );
  const [date, setDate] = useState(''),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const set = (key: keyof HostingOffer, value: any) => {
    setDraft({ ...draft, [key]: value });
    setMessage('');
  };
  const options = [
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' },
    { value: 'unsure', label: 'Not sure yet' },
  ];
  return (
    <form
      className="hosting-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setError('');
        if (date) {
          setError('Add your selected date to the list before saving.');
          return;
        }
        try {
          await tools.act({
            ...draft,
            type: 'hosting-offer',
            clubId: club.id,
            leagueId,
          });
          setMessage(
            'Saved. Your league administrator can now see your hosting availability.',
          );
          onShared?.();
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <p>
        While families register, tell us when {club.name} could host. These are
        possible dates, not confirmed fixtures.
      </p>
      <label className="field">
        <span>How many matches could you host?</span>
        <Pick
          label="Number of matches we can host"
          value={String(draft.capacity)}
          onChange={(v) => set('capacity', Number(v))}
          options={[0, 1, 2, 3].map((n) => ({
            value: String(n),
            label: n
              ? `${n} ${n === 1 ? 'match' : 'matches'}`
              : 'We cannot host this season',
          }))}
        />
      </label>
      {!!draft.capacity && (
        <>
          <div className="hosting-date-entry">
            <Field
              label="A possible hosting date"
              type="date"
              min={`${league.year}-01-01`}
              max={`${league.year + 1}-12-31`}
              value={date}
              onChange={setDate}
            />
            <button
              type="button"
              className="btn"
              disabled={!date}
              onClick={() => {
                if (
                  Number(date.slice(0, 4)) < league.year ||
                  Number(date.slice(0, 4)) > league.year + 1
                ) {
                  setError(
                    'Choose a date in the season year or the following year.',
                  );
                  return;
                }
                set(
                  'dates',
                  [...new Set([...(draft.dates || []), date])].sort(),
                );
                setDate('');
                setError('');
              }}
            >
              <Plus size={18} /> Add date
            </button>
          </div>
          <p className="setup-hint">
            Offer as many dates as you can — more than {draft.capacity} helps us
            give every club a fair schedule.
          </p>
          <ul className="hosting-dates">
            {draft.dates?.map((d) => (
              <li key={d}>
                {dateLabel(d)}
                <button
                  type="button"
                  className="league-icon-button"
                  aria-label={`Remove ${dateLabel(d)}`}
                  onClick={() =>
                    set(
                      'dates',
                      draft.dates!.filter((v) => v !== d),
                    )
                  }
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
          <div className="form-grid">
            {(['shotgun', 'presentation', 'food'] as const).map((key) => (
              <label className="field" key={key}>
                <span>
                  {
                    {
                      shotgun: 'Could you offer a shotgun start?',
                      presentation:
                        'Could you host the final presentation evening?',
                      food: 'Are you planning to provide food?',
                    }[key]
                  }
                </span>
                <Pick
                  label={
                    key === 'shotgun'
                      ? 'Shotgun start'
                      : key === 'presentation'
                        ? 'Presentation evening'
                        : 'Food planned'
                  }
                  value={draft[key] || 'unsure'}
                  onChange={(v) => set(key, v)}
                  options={options}
                />
              </label>
            ))}
          </div>
          <details className="setup-details">
            <summary>How could a shotgun start work at our club?</summary>
            <p>
              With a shotgun start, groups begin on different holes and finish
              at roughly the same time. That makes it easier to bring families
              together afterwards.
            </p>
            <p>
              <strong>A traditional shotgun</strong> uses a six-hole loop. Each
              group starts on a different hole and works around the loop until
              it has played all six.
            </p>
            <p>
              <strong>A modified shotgun</strong>, as used at Burton-on-Trent,
              can work with short junior holes of around 100–150 yards. Groups
              start together on different holes and each plays six consecutive
              holes: one plays holes 1–6, another 2–7, another 3–8, and so on.
              They finish after their sixth hole rather than returning around a
              loop.
            </p>
            <p>
              This can shorten the tee-sheet closure while keeping the shared
              start and similar finishing times. Plan enough holes for every
              group’s six-hole route, then agree the start time, safe access and
              return routes, adult supervision and how other golfers will be
              kept clear with your club. Your league administrator can help you
              work through the options.
            </p>
          </details>
          <Field
            label="Anything else for the league administrator?"
            large
            value={draft.notes || ''}
            onChange={(v) => set('notes', v)}
            hint="Mention any dates that cannot include food or a presentation, or any arrangements still to be confirmed."
          />
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="btn primary" disabled={tools.busy}>
        {tools.busy
          ? 'Saving…'
          : saved
            ? 'Save availability changes'
            : 'Share hosting availability'}
      </button>
      {message && (
        <p className="setup-success" role="status">
          <Check size={18} />
          {message}
        </p>
      )}
    </form>
  );
}

function JoiningInstructions({ tools, team }: { tools: AppTools; team: Team }) {
  const [copied, setCopied] = useState(false),
    [email, setEmail] = useState(''),
    [emailOpen, setEmailOpen] = useState(false),
    [message, setMessage] = useState(''),
    [sending, setSending] = useState(false);
  const league = tools.s.leagues.find((l) => l.id === team.leagueId)!;
  const club = tools.s.orgs.find((o) => o.id === team.orgId)!;
  const query = new URLSearchParams({
    role: 'parent',
    joinWorkspace: tools.workspace,
    joinClub: team.orgId,
    joinLeague: team.leagueId,
    joinTeam: team.id,
  });
  const link = `${typeof location === 'undefined' ? '' : location.origin}/?${query}`;
  const text = `Join ${club.name} for ${league.name} (${league.year}) on GolfSixes.\n\nRegister or sign in, add your children, then request their places here:\n${link}\n\nYour junior organiser will confirm each child's team. We look forward to welcoming you!`;
  return (
    <div className="setup-invitation">
      <p>
        Share this link with parents. As children register, they’ll appear below
        for you to confirm their places. Come back here whenever you need to.
      </p>
      <label className="field">
        <span>Parent joining link</span>
        <input readOnly value={link} onFocus={(e) => e.target.select()} />
      </label>
      <div className="setup-action-row">
        <button
          className="btn primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
            } catch {
              setMessage('Select the link above to copy it.');
            }
          }}
        >
          <Copy size={18} />
          {copied ? 'Link copied' : 'Copy joining link'}
        </button>
        <button className="btn" onClick={() => setEmailOpen(!emailOpen)}>
          <Mail size={18} />
          Invite by email
        </button>
      </div>
      {emailOpen && (
        <div className="setup-email">
          <Field
            label="Parent’s email address"
            type="email"
            value={email}
            onChange={setEmail}
          />
          <div className="setup-action-row">
            <button
              className="btn"
              disabled={sending || !email.includes('@')}
              onClick={async () => {
                setSending(true);
                setMessage('');
                try {
                  const r = await fetch('/api/parent-invitation', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      workspace: tools.workspace,
                      view: tools.view,
                      teamId: team.id,
                      email,
                    }),
                  });
                  const result: any = await r.json();
                  if (!r.ok) throw new Error(result.error);
                  setMessage(
                    'Invitation sent. The parent’s application will appear below when they register their child.',
                  );
                } catch (e) {
                  setMessage((e as Error).message);
                } finally {
                  setSending(false);
                }
              }}
            >
              {sending ? 'Sending…' : 'Send invitation'}
            </button>
            <a
              className="btn"
              href={`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`Join ${club.name} for GolfSixes`)}&body=${encodeURIComponent(text)}`}
            >
              Open in my email app
            </a>
          </div>
          <p className="setup-hint">
            If club email delivery is not connected, use your own email app or
            copy the link.
          </p>
        </div>
      )}
      {message && (
        <p role="status" className="setup-hint">
          {message}
        </p>
      )}
    </div>
  );
}

export function OrganiserHome({
  tools,
  year,
  setYear,
  navigate,
  openLeague,
  openFixture,
  detailsOnly = false,
  availabilityOnly = false,
}: {
  tools: AppTools;
  year: string;
  setYear: (v: string) => void;
  navigate: (v: string) => void;
  openLeague: (id: string, page?: string) => void;
  openFixture: (id: string) => void;
  detailsOnly?: boolean;
  availabilityOnly?: boolean;
}) {
  const { s, me } = tools;
  const { clubId, setClubId, teamId, setTeamId } = useOrganiserSelection();
  const guide = useOrganiserGuide();
  const clubs = s.clubs.filter((c) => me.orgIds.includes(c.orgId));
  const unconfirmed = clubs.find((c) => !c.confirmedAt);
  const club =
    (!detailsOnly && unconfirmed) ||
    clubs.find((c) => c.id === clubId) ||
    clubs[0];
  const teams = s.teams
    .filter(
      (t) =>
        !t.withdrawnAt &&
        t.orgId === club?.orgId &&
        s.leagues.some((l) => l.id === t.leagueId && l.year === Number(year)),
    )
    .sort(
      (a, b) =>
        teamPriority(s, a).urgency - teamPriority(s, b).urgency ||
        capOrder(a, b),
    );
  const team = teams.find((t) => t.id === teamId) || teams[0];
  const league = s.leagues.find((l) => l.id === team?.leagueId);
  const hostingOffer = s.hostingOffers?.find(
    (o) => o.clubId === club?.id && o.leagueId === team?.leagueId,
  );
  const clubLeagues = s.leagues.filter((l) =>
    s.teams.some(
      (t) => !t.withdrawnAt && t.orgId === club?.orgId && t.leagueId === l.id,
    ),
  );
  const seasonLeagues = clubLeagues.filter((l) => l.year === Number(year));
  const welcomeLeagues = seasonLeagues.length ? seasonLeagues : clubLeagues;
  const entryOpen =
    !!team &&
    team.enrollmentOpen !== false &&
    leagueAcceptsRegistrations(league);
  const setup = !league?.fixturesConfirmedAt;
  if (!club)
    return (
      <section className="season-empty">
        <h1>Your club is being connected.</h1>
        <p>
          Your Foundation administrator needs to assign your club before you can
          get started.
        </p>
      </section>
    );
  if (!club.confirmedAt && !detailsOnly)
    return (
      <div className="organiser-setup">
        <header className="setup-welcome">
          <span className="eyebrow">LET’S GET STARTED</span>
          <h1>
            {welcomeLeagues.length === 1
              ? `Welcome to the ${welcomeLeagues[0].name}.`
              : 'Welcome to GolfSixes.'}
          </h1>
          <p>
            Before we get going, please confirm your club’s details. If you
            don’t have them all yet, don’t worry — you can update them at any
            point.
          </p>
        </header>
        <section className="card setup-panel">
          <div className="setup-team-identities">
            {s.teams
              .filter((t) => !t.withdrawnAt && t.orgId === club.orgId)
              .sort(capOrder)
              .map((t) => (
                <div key={t.id}>
                  <Cap color={t.color} size={34} label={`${t.cap} caps`} />
                  <div>
                    <strong>{t.name}</strong>
                    <span>
                      {s.leagues.find((l) => l.id === t.leagueId)?.name} ·{' '}
                      {s.leagues.find((l) => l.id === t.leagueId)?.year} ·{' '}
                      {t.cap} caps
                    </span>
                  </div>
                </div>
              ))}
          </div>
          <ClubDetails
            key={club.id}
            tools={tools}
            club={club}
            confirm
            done={() => {
              guide('My club');
              requestAnimationFrame(() =>
                window.scrollTo({ top: 0, behavior: 'auto' }),
              );
            }}
          />
        </section>
      </div>
    );
  return (
    <div className="organiser-setup">
      <header className="setup-home-heading">
        <div>
          <span className="eyebrow">
            {detailsOnly
              ? 'MY CLUB'
              : availabilityOnly
                ? 'OUR AVAILABILITY'
                : setup
                  ? 'GETTING READY FOR THE SEASON'
                  : 'YOUR NEXT FIXTURE'}
          </span>
          <h1>{club.name}</h1>
        </div>
        <div className="setup-action-row">
          {clubs.length > 1 && (
            <Pick
              label="My club"
              value={club.id}
              onChange={setClubId}
              options={clubs.map((c) => ({ value: c.id, label: c.name }))}
            />
          )}
          {!detailsOnly && !availabilityOnly && (
            <button className="btn" onClick={() => navigate('My club')}>
              My club
            </button>
          )}
          {(detailsOnly || availabilityOnly) && (
            <button className="btn" onClick={() => navigate('Overview')}>
              Back to home
            </button>
          )}
        </div>
      </header>
      {detailsOnly ? (
        <>
          <section className="card setup-panel">
            <ClubDetails key={club.id} tools={tools} club={club} />
          </section>
          <details className="card setup-panel">
            <summary>Other junior organisers at your club</summary>
            <ClubOrganisers
              tools={tools}
              orgId={club.orgId}
              onInvite={() =>
                tools.edit('invite', {
                  role: 'organiser',
                  orgIds: [club.orgId],
                })
              }
            />
          </details>
        </>
      ) : (
        <>
          <div className="setup-team-picker">
            <Pick
              label="Season"
              value={year}
              onChange={setYear}
              options={[
                ...new Set([Number(year), ...s.leagues.map((l) => l.year)]),
              ]
                .sort((a, b) => b - a)
                .map((y) => ({ value: String(y), label: `${y} season` }))}
            />
            {teams.length > 1 && (
              <Pick
                label="Your team"
                value={team?.id || ''}
                onChange={setTeamId}
                options={teams.map((t) => ({
                  value: t.id,
                  label: `${t.name} · ${t.cap} · ${s.leagues.find((l) => l.id === t.leagueId)?.name}`,
                }))}
              />
            )}
          </div>
          {!team ? (
            <section className="card setup-panel">
              <h2>Your team will appear here.</h2>
              <p>
                The Foundation will assign your team to a league. Your club
                details are saved.
              </p>
            </section>
          ) : (
            <>
              {availabilityOnly ? (
                <section className="card setup-panel">
                  <h2>When could you host a match?</h2>
                  <p>
                    {league?.name} · {league?.year}
                  </p>
                  <HostingForm
                    key={`${club.id}:${team.leagueId}`}
                    tools={tools}
                    club={club}
                    leagueId={team.leagueId}
                  />
                </section>
              ) : setup ? (
                <>
                  <section
                    className="card setup-panel setup-joining"
                    style={{ borderTopColor: team.color }}
                  >
                    <div className="setup-team-heading">
                      <Cap
                        color={team.color}
                        size={52}
                        label={`${team.cap} caps`}
                      />
                      <div>
                        <h2>
                          {entryOpen
                            ? 'It’s time to invite your players.'
                            : 'Your players are registered.'}
                        </h2>
                        <p>
                          {team.name} · {league?.name} ·{' '}
                          <strong>{team.cap} caps</strong>
                        </p>
                      </div>
                    </div>
                    {entryOpen ? (
                      <JoiningInstructions
                        key={team.id}
                        tools={tools}
                        team={team}
                      />
                    ) : (
                      <p>
                        Registration is closed. Your league administrator is
                        arranging the fixtures.
                      </p>
                    )}
                  </section>
                  <section
                    className="card setup-panel setup-players"
                    style={{ borderTopColor: team.color }}
                  >
                    <h2>Your players</h2>
                    <TeamRoster
                      key={team.id}
                      tools={tools}
                      teamId={team.id}
                      embedded
                    />
                  </section>
                  {hostingOffer ? (
                    <div className="hosting-saved-summary" role="status">
                      <Check size={20} />
                      <p>
                        <strong>Hosting availability shared</strong>
                        <span>
                          {hostingOffer.capacity === 0
                            ? 'Your administrator knows you cannot host this season.'
                            : `${hostingOffer.capacity} ${hostingOffer.capacity === 1 ? 'match' : 'matches'} · ${hostingOffer.dates.length} possible dates`}
                        </span>
                      </p>
                      <button
                        className="btn small"
                        onClick={() => navigate('Our availability')}
                      >
                        Edit availability
                      </button>
                    </div>
                  ) : (
                    <section className="card setup-panel">
                      <div className="setup-team-heading">
                        <CalendarDays size={28} />
                        <div>
                          <h2>When could you host a match?</h2>
                          <p>
                            {league?.name} · {league?.year}
                          </p>
                        </div>
                      </div>
                      <HostingForm
                        key={`${club.id}:${team.leagueId}`}
                        tools={tools}
                        club={club}
                        leagueId={team.leagueId}
                        onShared={() => guide('Our availability')}
                      />
                    </section>
                  )}
                </>
              ) : (
                <>
                  <OrganiserPriorities
                    tools={tools}
                    teams={[team]}
                    openLeague={openLeague}
                    openFixture={openFixture}
                  />
                  <details className="card setup-panel">
                    <summary>Players & joining instructions</summary>
                    <p>
                      You can keep registering and managing children throughout
                      the season.
                    </p>
                    {entryOpen && (
                      <JoiningInstructions
                        key={team.id}
                        tools={tools}
                        team={team}
                      />
                    )}
                    <TeamRoster tools={tools} teamId={team.id} />
                  </details>
                </>
              )}
            </>
          )}
          <LoginHelpQueue tools={tools} />
        </>
      )}
    </div>
  );
}
