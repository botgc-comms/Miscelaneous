'use client';
import { useState } from 'react';
import type { Action, State } from '@/lib/model';

/** Messages routed to the host also stay available to the child's own team. */
export function FixtureMessageInbox({
  s,
  fixtureId,
  busy,
  send,
}: {
  s: State;
  fixtureId: string;
  busy: boolean;
  send: (action: Action) => Promise<any>;
}) {
  const threads = (s.fixtureMessages || []).filter(
    (m, index, all) =>
      m.fixtureId === fixtureId &&
      m.audience === 'host' &&
      all.findIndex(
        (other) =>
          other.fixtureId === fixtureId &&
          other.audience === 'host' &&
          other.teamId === m.teamId &&
          other.playerId === m.playerId,
      ) === index,
  );
  if (!threads.length) return null;
  return (
    <section className="card mb-5">
      <h2>Family messages to the host</h2>
      <p className="muted">
        The child’s team organisers are included in these conversations.
      </p>
      {threads.map((m) => (
        <FixtureConversation
          key={m.id}
          s={s}
          fixtureId={fixtureId}
          teamId={m.teamId}
          playerId={m.playerId}
          audience="host"
          busy={busy}
          send={send}
          title={`${s.teams.find((t) => t.id === m.teamId)?.name || 'Team'} · ${s.players.find((p) => p.id === m.playerId)?.name || m.authorName}`}
        />
      ))}
    </section>
  );
}

export function FixtureConversation({
  s,
  fixtureId,
  teamId,
  playerId,
  busy,
  send,
  parent = false,
  audience = 'team',
  playerIds,
  teamIds,
  title,
  expanded = false,
}: {
  s: State;
  fixtureId: string;
  teamId: string;
  playerId: string;
  busy: boolean;
  send: (action: Action) => Promise<any>;
  parent?: boolean;
  audience?: 'team' | 'host';
  playerIds?: string[];
  teamIds?: string[];
  title?: string;
  expanded?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const messages = (s.fixtureMessages || []).filter(
    (m) =>
      m.fixtureId === fixtureId &&
      (teamIds || [teamId]).includes(m.teamId) &&
      (playerIds || [playerId]).includes(m.playerId) &&
      (m.audience || 'team') === audience,
  );
  return (
    <details className="fixture-conversation" open={expanded || undefined}>
      <summary>
        {title || (parent ? 'Message your organiser' : 'Family messages')}
        {messages.length ? ` (${messages.length})` : ''}
      </summary>
      <p className="muted mt-3">
        {audience === 'host'
          ? 'The fixture host and your team organisers can see this conversation. Your team organisers receive a copy of every reply.'
          : 'Only the family and their team administrators can see this conversation.'}
      </p>
      <div className="conversation-messages">
        {messages.map((m) => (
          <article
            key={m.id}
            className={m.fromParent ? 'from-family' : 'from-organiser'}
          >
            <strong>
              {m.authorName} · {m.fromParent ? 'Parent' : 'Organiser / admin'}
            </strong>
            <time dateTime={m.createdAt}>
              {new Date(m.createdAt).toLocaleString('en-GB', {
                timeZone: 'Europe/London',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </time>
            <p>{m.text}</p>
          </article>
        ))}
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          try {
            await send({
              type: 'fixture-message',
              fixtureId,
              teamId,
              playerId,
              audience,
              text: draft,
            });
            setDraft('');
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <label className="field">
          <span>{parent ? 'Your message' : 'Reply to the family'}</span>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={2000}
            rows={3}
            required
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn mt-3" disabled={busy || !draft.trim()}>
          Send message
        </button>
      </form>
    </details>
  );
}
