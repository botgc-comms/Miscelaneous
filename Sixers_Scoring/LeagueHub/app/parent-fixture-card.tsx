'use client';
import { useState } from 'react';
import { Check, ArrowRight, MapPin, Clock, MessageCircle } from 'lucide-react';
import {
  type State,
  type Fixture,
  type Player,
  type Action,
  rosterEligible,
  selectionConfirmed,
  selectionKey,
} from '@/lib/model';
import { Cap } from './parent-portal';
import { ChildName } from './child-avatar';
import { Pick, dateLabel } from './widgets';
import { FixtureConversation } from './fixture-conversation';

export function HostInstructions({
  s,
  f,
  id,
}: {
  s: State;
  f: Fixture;
  id?: string;
}) {
  const club = s.clubs.find((c) => c.id === f.clubId);
  return (
    <section className="family-host-guide" id={id} tabIndex={-1}>
      <div className="family-host-heading">
        <MapPin size={20} />
        <div>
          <h3>Joining instructions</h3>
          <p>From your host · {club?.name || f.name}</p>
        </div>
      </div>
      <div className="family-host-columns">
        <div>
          <h4>Where to go</h4>
          <p>
            {[club?.address, club?.postcode].filter(Boolean).join(' ') ||
              'The host will confirm the address.'}
          </p>
          <p>
            {f.registration
              ? 'Please register on arrival.'
              : 'Meet at the welcome briefing.'}
          </p>
          {club?.instructions && (
            <p className="preserve-lines">{club.instructions}</p>
          )}
        </div>
        <div>
          <h4>Before you travel</h4>
          <p className="preserve-lines">
            {f.instructions ||
              'The host has not added joining instructions yet. Please check again before travelling.'}
          </p>
          {(f.foodBefore || f.foodAfter) && (
            <p>{[f.foodBefore, f.foodAfter].filter(Boolean).join(' · ')}</p>
          )}
        </div>
      </div>
    </section>
  );
}

export function ParentFixtureCard({
  s,
  f,
  kids,
  published,
  detail = false,
  busy,
  send,
  availability,
  open,
}: {
  s: State;
  f: Fixture;
  kids: Player[];
  published: boolean;
  detail?: boolean;
  busy: boolean;
  send: (action: Action) => Promise<any>;
  availability: (p: Player, value: string) => void;
  open: () => void;
}) {
  const [error, setError] = useState('');
  const [contact, setContact] = useState('');
  const club = s.clubs.find((c) => c.id === f.clubId);
  const playing = kids.filter((p) =>
    f.pairs.some((pair) => pair.players.includes(p.id)),
  );
  const others = kids.filter((p) => !playing.includes(p));
  const teamFor = (p: Player) =>
    s.teams.find(
      (t) =>
        t.id === f.pairs.find((pair) => pair.players.includes(p.id))?.teamId,
    ) ||
    s.teams.find(
      (t) => f.teamIds.includes(t.id) && rosterEligible(s, p.id, t.id),
    );
  const teams = s.teams.filter((t) =>
    kids.some((p) => teamFor(p)?.id === t.id),
  );
  const contacts = teams
    .filter((t, i) => teams.findIndex((other) => other.orgId === t.orgId) === i)
    .flatMap((t) => {
      const name = s.orgs.find((o) => o.id === t.orgId)?.name || t.name;
      return [
        { value: `team:${t.id}`, label: `${name} · team organiser` },
        ...(t.orgId !== club?.orgId
          ? [
              {
                value: `host:${t.id}`,
                label: `${club?.name || f.name} · fixture host (copy ${name})`,
              },
            ]
          : []),
      ];
    });
  const destination = contacts.some((c) => c.value === contact)
    ? contact
    : contacts[0]?.value;
  const contactTeam = teams.find(
    (t) => destination === `team:${t.id}` || destination === `host:${t.id}`,
  );
  const contactKids = kids.filter(
    (p) => teamFor(p)?.orgId === contactTeam?.orgId,
  );
  const anchorChild = kids.find((p) => teamFor(p)?.id === contactTeam?.id);
  const selected = playing.length > 0;
  const title = `${playing.map((p) => p.name.split(' ')[0]).join(' & ')} ${playing.length === 1 ? 'is' : 'are'} playing!`;
  return (
    <div className="family-event-group">
      <section
        className={`family-fixture family-event-card${selected ? ' family-playing-card' : ''}`}
      >
        {selected && (
          <div className="family-playing-banner">
            <Check size={24} />
            <div>
              <span>THE TEAM HAS BEEN ANNOUNCED</span>
              <h2>{title}</h2>
            </div>
          </div>
        )}
        <div className="family-fixture-top">
          <div className="date-tile">
            <strong>{f.date.slice(8)}</strong>
            <span>
              {new Date(f.date + 'T12:00:00').toLocaleDateString('en-GB', {
                month: 'short',
              })}
            </span>
          </div>
          <div>
            <span className="eyebrow">
              {dateLabel(f.date)} {f.date.slice(0, 4)}
            </span>
            <h2>{club?.name || f.name}</h2>
            <p>
              Arrive <strong>{f.arrival}</strong> ·{' '}
              {f.format === 'shotgun' ? 'Shotgun start' : 'First tee time'}{' '}
              <strong>{f.start}</strong>
            </p>
            {!published && f.status === 'scheduled' && (
              <span className="badge amber">Provisional date</span>
            )}
          </div>
          {!detail && (
            <button className="btn" onClick={open}>
              Fixture details <ArrowRight size={16} />
            </button>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {selected && (
          <div className="family-selected-grid">
            {playing.map((p) => {
              const pair = f.pairs.find((q) => q.players.includes(p.id))!;
              const team = teamFor(p);
              const slot = f.slots.find((slot) => slot.id === pair.slotId);
              const partner = pair.players
                .filter((id) => id !== p.id)
                .map(
                  (id) =>
                    s.players.find((child) => child.id === id)?.name ||
                    'Partner to be confirmed',
                )
                .join(' & ');
              return (
                <article className="family-selected-child" key={p.id}>
                  <header>
                    <Cap
                      color={team?.color || '#087f6b'}
                      label={`${team?.cap || 'Team'} cap`}
                      size={38}
                    />
                    <div>
                      <h3>
                        <ChildName player={p} short />
                      </h3>
                      <p>
                        {team?.name} · {team?.cap} caps
                      </p>
                    </div>
                  </header>
                  <dl>
                    <div>
                      <dt>Playing partner</dt>
                      <dd>{partner || 'To be confirmed'}</dd>
                    </div>
                    <div>
                      <dt>
                        <Clock size={15} /> Your starting slot
                      </dt>
                      <dd>
                        {slot
                          ? `Hole ${slot.startHole} · ${slot.startTime || f.start}`
                          : 'The host will confirm your starting slot'}
                      </dd>
                    </div>
                  </dl>
                  {f.status === 'scheduled' && (
                    <footer>
                      {selectionConfirmed(s, f, p.id) ? (
                        <span className="family-confirmed-reply">
                          <Check size={16} /> Confirmed to play
                        </span>
                      ) : (
                        <button
                          className="btn primary"
                          disabled={busy}
                          onClick={async () => {
                            setError('');
                            try {
                              await send({
                                type: 'fixture-confirm',
                                fixtureId: f.id,
                                playerId: p.id,
                                selection: selectionKey(f, p.id),
                              });
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        >
                          Confirm {p.name.split(' ')[0]} can play
                        </button>
                      )}
                      <button
                        className="btn family-change-plans"
                        disabled={busy}
                        onClick={() => availability(p, 'no')}
                      >
                        Can no longer play
                      </button>
                    </footer>
                  )}
                  {f.status === 'live' && (
                    <button className="btn primary" onClick={open}>
                      Open our scorecard <ArrowRight size={16} />
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
        {(selected || detail) && (
          <HostInstructions
            s={s}
            f={f}
            id={detail ? 'fixture-host-instructions' : undefined}
          />
        )}
        {!!contacts.length && (
          <div className="family-event-contact">
            <details>
              <summary>
                <MessageCircle size={18} /> Contact an organiser
              </summary>
              <div className="family-contact-body">
                <label className="field">
                  <span>Who can help?</span>
                  <Pick
                    label="Message recipient"
                    value={destination}
                    onChange={setContact}
                    options={contacts}
                  />
                </label>
                {contactTeam && anchorChild && (
                  <FixtureConversation
                    key={destination}
                    s={s}
                    fixtureId={f.id}
                    teamId={contactTeam.id}
                    playerId={anchorChild.id}
                    playerIds={contactKids.map((p) => p.id)}
                    teamIds={teams
                      .filter((t) => t.orgId === contactTeam.orgId)
                      .map((t) => t.id)}
                    audience={
                      destination?.startsWith('host:') ? 'host' : 'team'
                    }
                    busy={busy}
                    send={send}
                    parent
                    title="Messages"
                    expanded
                  />
                )}
              </div>
            </details>
          </div>
        )}
      </section>
      {!!others.length && (
        <section className="family-other-children">
          <header>
            <h3>
              {selected ? 'Your other children' : 'Can your children play?'}
            </h3>
            <p>
              {selected
                ? 'These children are not in the playing team. You can update their availability here.'
                : `Let the team organiser know who is available for ${dateLabel(f.date)}.`}
            </p>
          </header>
          <div className="family-availability-grid">
            {others.map((p) => {
              const av = s.availability?.find(
                (a) => a.fixtureId === f.id && a.playerId === p.id,
              );
              const reserve = s.reserves?.some(
                (r) => r.fixtureId === f.id && r.playerId === p.id,
              );
              return (
                <article key={p.id}>
                  <h4>
                    <ChildName player={p} short />
                  </h4>
                  <p>
                    {reserve
                      ? 'Reserve · We’ll let you know if a place opens up'
                      : av?.status === 'no'
                        ? 'Can’t make it'
                        : av?.status === 'yes'
                          ? 'Available · Awaiting selection'
                          : 'Availability not confirmed'}
                  </p>
                  {f.status === 'scheduled' &&
                    (reserve ? (
                      <button
                        className="btn"
                        disabled={busy}
                        onClick={() => availability(p, 'no')}
                      >
                        Can no longer be a reserve
                      </button>
                    ) : (
                      <div
                        className="availability-buttons"
                        aria-label={`${p.name} availability`}
                      >
                        {[
                          ['yes', 'Available'],
                          ['unsure', 'Not sure yet'],
                          ['no', 'Can’t make it'],
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            disabled={busy}
                            aria-pressed={av?.status === value}
                            className={av?.status === value ? 'active' : ''}
                            onClick={() => availability(p, value)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    ))}
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
