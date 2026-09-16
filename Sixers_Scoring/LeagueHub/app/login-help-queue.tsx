'use client';
import { useState } from 'react';
import { type AppTools, Pick } from './widgets';
import { canHelpLogin } from '@/lib/model';
import { helpReasons } from './login-help';
export function LoginHelpQueue({
  tools,
  history = false,
}: {
  tools: AppTools;
  history?: boolean;
}) {
  const { s, me } = tools;
  const [showResolved, setShowResolved] = useState(false),
    [selected, setSelected] = useState<Record<string, string>>({}),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const all = (s.loginHelpRequests || []).filter((r) =>
    canHelpLogin(s, me, r.orgId),
  );
  const active = all.filter((r) => r.status !== 'resolved');
  const requests = (history && showResolved ? all : active)
    .slice()
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  if (!all.length || (!history && !active.length)) return null;
  async function status(id: string, value: string) {
    setError('');
    try {
      await tools.act({ type: 'login-help-status', id, status: value });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="card mb-6" aria-label="Parent login help">
      <div className="row wrap">
        <h2>
          Parents needing help signing in{' '}
          <span className="badge">{active.length} open</span>
        </h2>
        {history && (
          <button
            className="text-link"
            onClick={() => setShowResolved((v) => !v)}
          >
            {showResolved ? 'Hide resolved' : 'Show resolved requests'}
          </button>
        )}
      </div>
      <p className="muted mt-3">
        Requests come from the sign-in page; the sender’s identity has not been
        verified. Use a phone number already on the family’s record to confirm
        who they are before sharing their registered email.
      </p>
      {message && (
        <p className="notice mt-3" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error mt-3" role="alert">
          {error}
        </p>
      )}
      {requests.map((r) => {
        const parentIds = new Set(
          s.players
            .filter((p) =>
              s.enrollments?.some(
                (e) =>
                  e.playerId === p.id &&
                  ['approved', 'pending'].includes(e.status) &&
                  s.teams.some((t) => t.id === e.teamId && t.orgId === r.orgId),
              ),
            )
            .map((p) => p.parentId),
        );
        const parents = s.members.filter((m) => parentIds.has(m.id));
        const parent = parents.find((p) => p.id === selected[r.id]);
        const club = s.orgs.find((o) => o.id === r.orgId)?.name || 'Club';
        return (
          <article className="roster-child" key={r.id}>
            <div className="row wrap">
              <strong>{r.name}</strong>
              <span className="badge">
                {r.status === 'new'
                  ? 'Needs help'
                  : r.status === 'contacted'
                    ? 'Contacted'
                    : 'Resolved'}
              </span>
            </div>
            <p>
              {club} · {new Date(r.requestedAt).toLocaleDateString('en-GB')}
            </p>
            <p>{helpReasons.find((v) => v.value === r.reason)?.label}</p>
            <p className="muted">
              Contact supplied in request: {r.phone}
              {r.email ? ` · ${r.email}` : ''}
            </p>
            {r.status !== 'resolved' && (
              <div className="stack mt-3">
                <Pick
                  label="Find the parent in your club’s registered families"
                  value={selected[r.id] || ''}
                  onChange={(v) => {
                    setSelected({ ...selected, [r.id]: v });
                    setMessage('');
                  }}
                  options={parents.map((p) => ({ value: p.id, label: p.name }))}
                />
                {parent && (
                  <div className="notice">
                    <strong>Details already on file for {parent.name}</strong>
                    <p>
                      {parent.phone || 'No phone recorded'} ·{' '}
                      {parent.email || 'No email recorded'}
                    </p>
                    <p>
                      {parent.id.startsWith('email-')
                        ? 'Ask the parent to enter this registered email and request a fresh sign-in code.'
                        : 'This account uses ChatGPT sign-in. Ask the parent to choose Continue with ChatGPT using their original account.'}
                    </p>
                    <button
                      className="text-link"
                      onClick={() => {
                        const instruction = parent.id.startsWith('email-')
                          ? `Use your registered email (${parent.email}) to request a fresh sign-in code.`
                          : 'Choose Continue with ChatGPT and use the account you originally registered with.';
                        void navigator.clipboard
                          .writeText(
                            `Sign in to GolfSixes: ${location.origin}/?role=parent\n${instruction}\nYour existing children and team places will be there when you sign in to the same account.`,
                          )
                          .then(() =>
                            setMessage(
                              'Sign-in instructions copied. Share them with the parent after confirming their identity.',
                            ),
                          )
                          .catch(() =>
                            setError(
                              'Could not copy. You can read the sign-in instructions above to the parent.',
                            ),
                          );
                      }}
                    >
                      Copy sign-in instructions
                    </button>
                  </div>
                )}
                {r.reason === 'lost-email' && (
                  <p className="muted">
                    Start with recovery through the parent’s email or ChatGPT
                    provider. If that is not possible, contact the Foundation;
                    this request does not transfer their children to a new
                    account.
                  </p>
                )}
                <div className="row wrap">
                  <button
                    className="btn small"
                    disabled={tools.busy || r.status === 'contacted'}
                    onClick={() => void status(r.id, 'contacted')}
                  >
                    Mark contacted
                  </button>
                  <button
                    className="btn primary small"
                    disabled={tools.busy}
                    onClick={() => void status(r.id, 'resolved')}
                  >
                    Mark resolved
                  </button>
                </div>
              </div>
            )}
            {r.status === 'resolved' && history && (
              <button
                className="text-link"
                disabled={tools.busy}
                onClick={() => void status(r.id, 'new')}
              >
                Reopen request
              </button>
            )}
          </article>
        );
      })}
    </section>
  );
}
