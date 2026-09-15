'use client';
import { useState } from 'react';
import type { Action, State } from '@/lib/model';

export function FixtureConversation({
  s,
  fixtureId,
  teamId,
  playerId,
  busy,
  send,
  parent = false,
}: {
  s: State;
  fixtureId: string;
  teamId: string;
  playerId: string;
  busy: boolean;
  send: (action: Action) => Promise<any>;
  parent?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const messages = (s.fixtureMessages || []).filter(
    (m) =>
      m.fixtureId === fixtureId &&
      m.teamId === teamId &&
      m.playerId === playerId,
  );
  return (
    <details className="fixture-conversation">
      <summary>
        {parent ? 'Message your organiser' : 'Family messages'}
        {messages.length ? ` (${messages.length})` : ''}
      </summary>
      <p className="muted mt-3">
        About this fixture and this child. Only their family and team
        administrators can see this conversation.
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
              text: draft,
            });
            setDraft('');
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <label className="field">
          <span>
            {parent
              ? 'Plans changed or a question about the pairing?'
              : 'Reply to the family'}
          </span>
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
