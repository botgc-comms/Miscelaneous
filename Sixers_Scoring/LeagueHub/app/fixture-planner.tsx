'use client';
import { useState } from 'react';
import { CalendarDays, Check, WandSparkles, Mail } from 'lucide-react';
import { Field, dateLabel, type AppTools } from './widgets';
import {
  hostingClubs,
  planningKey,
  suggestFixtures,
  type FixturePlanSettings,
} from '@/lib/season-planning';
import { invitationStatus } from '@/lib/invitations';
import { organiserClubs } from '@/lib/model';
import { FixturePlanEditor } from './fixture-plan-editor';

export function FixturePlanner({
  tools,
  leagueId,
}: {
  tools: AppTools;
  leagueId: string;
}) {
  const { s } = tools;
  const league = s.leagues.find((l) => l.id === leagueId)!;
  const clubs = hostingClubs(s, leagueId);
  const [settings, setSettings] = useState<FixturePlanSettings>(
    league.fixturePlanning || {
      count: 12,
      start: `${league.year}-04-01`,
      end: `${league.year}-09-30`,
      minGap: 7,
    },
  );
  const [proposal, setProposal] = useState<
    | (ReturnType<typeof suggestFixtures> & { key: string; visibleKey: string })
    | null
  >(null);
  const [error, setError] = useState(''),
    [created, setCreated] = useState(false);
  const existing = s.fixtures.some(
    (f) => f.leagueId === leagueId && f.status !== 'cancelled',
  );
  const replied = clubs.filter((c) =>
    s.hostingOffers?.some((o) => o.clubId === c.id && o.leagueId === leagueId),
  ).length;
  return (
    <section className="card fixture-planner setup-panel">
      <div className="section-top">
        <div>
          <h2>
            <CalendarDays size={22} /> Plan the season’s fixtures
          </h2>
          <p>
            {replied} of {clubs.length} clubs have shared hosting availability.
          </p>
        </div>
      </div>
      {!clubs.length ? (
        <p>Add the clubs’ teams to this league first.</p>
      ) : (
        <>
          <div className="hosting-admin-list">
            {clubs.map((club) => {
              const offer = s.hostingOffers?.find(
                (o) => o.clubId === club.id && o.leagueId === leagueId,
              );
              const organisers = s.members.filter(
                (m) =>
                  (m.role === 'organiser' && m.orgIds.includes(club.orgId)) ||
                  organiserClubs(m).includes(club.orgId),
              );
              const pending = s.invites.some(
                (i) =>
                  i.role === 'organiser' &&
                  i.orgIds.includes(club.orgId) &&
                  invitationStatus(i) === 'Invite pending',
              );
              return (
                <details key={club.id} className="hosting-admin-club">
                  <summary>
                    <span>
                      <strong>{club.name}</strong>
                      <small>
                        {offer
                          ? `${offer.capacity} matches · ${offer.dates.length} possible dates`
                          : 'Hosting availability not received'}
                      </small>
                    </span>
                    <span className={`setup-status ${offer ? 'is-done' : ''}`}>
                      {offer ? 'Received' : 'Waiting'}
                    </span>
                  </summary>
                  <div className="hosting-admin-details">
                    <p>
                      {organisers.length
                        ? `Organiser: ${organisers.map((m) => m.name).join(', ')}`
                        : pending
                          ? 'Organiser invitation pending'
                          : 'No junior organiser assigned yet.'}
                    </p>
                    {!organisers.length && !pending && (
                      <button
                        className="btn small"
                        onClick={() =>
                          tools.edit('invite', {
                            role: 'organiser',
                            orgIds: [club.orgId],
                          })
                        }
                      >
                        <Mail size={16} />
                        Invite junior organiser
                      </button>
                    )}
                    {offer && (
                      <>
                        <p>
                          Shotgun start:{' '}
                          {offer.shotgun === 'unsure'
                            ? 'Not sure yet'
                            : offer.shotgun}{' '}
                          · Presentation evening:{' '}
                          {offer.presentation === 'unsure'
                            ? 'Not sure yet'
                            : offer.presentation}{' '}
                          · Food:{' '}
                          {offer.food === 'unsure'
                            ? 'Not sure yet'
                            : offer.food}
                        </p>
                        <div className="hosting-dates">
                          {offer.dates.map((d) => (
                            <span key={d}>{dateLabel(d)}</span>
                          ))}
                        </div>
                        {offer.notes && <p>{offer.notes}</p>}
                        <small>
                          Updated{' '}
                          {new Date(offer.updatedAt).toLocaleDateString(
                            'en-GB',
                          )}
                        </small>
                      </>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
          {existing ? (
            <p className="setup-success">
              <Check size={18} />
              {created
                ? 'Your fixtures are ready below. You can edit each one to agree the details.'
                : 'Fixtures already exist. Manage them below; this planner will keep them intact.'}
            </p>
          ) : (
            <form
              className="fixture-planning-settings"
              onSubmit={async (e) => {
                e.preventDefault();
                setError('');
                try {
                  const result = await tools.act({
                    type: 'fixture-planning',
                    leagueId,
                    ...settings,
                  });
                  setProposal({
                    ...result.fixtureProposal,
                    visibleKey: planningKey(result.state, leagueId),
                  });
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <p>
                Choose your season window. Suggestions balance hosting duties,
                spread fixtures evenly and favour shotgun starts. We’ll suggest
                as many as the clubs can host, up to your target, and favour a
                presentation host for the last fixture.
              </p>
              <div className="form-grid">
                <Field
                  label="Target number of fixtures"
                  type="number"
                  min={2}
                  max={36}
                  required
                  value={settings.count}
                  onChange={(v) =>
                    setSettings({ ...settings, count: Number(v) })
                  }
                />
                <Field
                  label="Season starts"
                  type="date"
                  required
                  value={settings.start}
                  onChange={(v) => setSettings({ ...settings, start: v })}
                />
                <Field
                  label="Season ends"
                  type="date"
                  required
                  value={settings.end}
                  onChange={(v) => setSettings({ ...settings, end: v })}
                />
                <Field
                  label="At least this many days between fixtures"
                  type="number"
                  min={1}
                  max={60}
                  required
                  value={settings.minGap}
                  onChange={(v) =>
                    setSettings({ ...settings, minGap: Number(v) })
                  }
                />
              </div>
              <button className="btn primary" disabled={tools.busy}>
                <WandSparkles size={18} />
                {tools.busy ? 'Preparing…' : 'Suggest fixture list'}
              </button>
              <p className="setup-hint">
                You’ll review the list before any fixtures are created.
              </p>
            </form>
          )}
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {proposal && (
        <FixturePlanEditor
          tools={tools}
          leagueId={leagueId}
          settings={settings}
          initial={proposal}
          onClose={() => setProposal(null)}
          onCreated={() => {
            setProposal(null);
            setCreated(true);
          }}
        />
      )}
    </section>
  );
}
