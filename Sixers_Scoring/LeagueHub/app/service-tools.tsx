'use client';
import { useEffect, useState } from 'react';
import './account.css';
export function ServiceTools() {
  const [auth, setAuth] = useState<any>(null),
    [demo, setDemo] = useState<any>(null),
    [date, setDate] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [mail, setMail] = useState<any>(null);
  useEffect(() => {
    const refresh = () => {
      fetch('/api/auth')
        .then((r) => r.json())
        .then(setAuth)
        .catch(() => {});
      fetch('/api/demo')
        .then((r) => r.json())
        .then((d: any) => {
          setDemo(d);
          setDate(d.today || '');
        })
        .catch(() => {});
    };
    refresh();
    window.addEventListener('golfsixes-auth', refresh);
    return () => window.removeEventListener('golfsixes-auth', refresh);
  }, []);
  async function act(body: any) {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const a: any = await r.json();
      if (!r.ok) throw new Error(a.error);
      sessionStorage.removeItem('golfsixes-journey-context');
      location.href = a.url;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  if (!auth?.user) return null;
  const next =
    demo?.fixtures?.find(
      (f: any) => f.date > (date || new Date().toISOString().slice(0, 10)),
    ) || demo?.fixtures?.[0];
  return (
    <details
      className={'service-tools' + (demo?.active ? ' demo' : '')}
      open={demo?.active || undefined}
    >
      <summary>
        {demo?.active ? 'Demo mode · no emails are sent' : 'My account'}
        {demo?.active && date ? ' · ' + date : ''}
      </summary>
      <div className="service-tools-panel">
        {demo?.active ? (
          <>
            <label className="field">
              <span>View as</span>
              <select
                aria-label="Demo actor"
                value={demo.actor}
                disabled={busy}
                onChange={(e) =>
                  void act({ type: 'update', actor: e.target.value })
                }
              >
                {demo.actors?.map((a: any) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ·{' '}
                    {a.role === 'organiser'
                      ? 'Junior organiser'
                      : a.role === 'parent'
                        ? 'Parent'
                        : 'Administrator'}
                    {a.club ? ' · ' + a.club : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Demo date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <button
              className="btn"
              disabled={busy || !date}
              onClick={() => void act({ type: 'update', today: date })}
            >
              Set date
            </button>
            {next && (
              <button
                className="btn"
                disabled={busy}
                onClick={() => void act({ type: 'update', today: next.date })}
              >
                Next fixture · {next.date}
              </button>
            )}
            <button
              className="btn"
              disabled={busy}
              onClick={() => void act({ type: 'update', today: null })}
            >
              Use today
            </button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => void act({ type: 'exit' })}
            >
              Return to live service
            </button>
          </>
        ) : (
          <>
            <span>{auth.user.email}</span>
            {demo?.available && (
              <button
                className="btn"
                disabled={busy}
                onClick={() => void act({ type: 'enter' })}
              >
                Open demo mode
              </button>
            )}
            {auth.googleReady && (
              <a className="btn" href="/api/auth/google?link=1">
                Connect Google
              </a>
            )}
            <button
              className="text-link"
              onClick={async () => {
                await fetch('/api/auth', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ type: 'logout' }),
                });
                location.href = '/';
              }}
            >
              Sign out
            </button>
            {demo?.available && (
              <button
                className="text-link"
                onClick={async () => {
                  const r = await fetch('/api/service');
                  const a: any = await r.json();
                  if (r.ok) setMail(a);
                  else setError(a.error);
                }}
              >
                Email service status
              </button>
            )}
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {mail && (
          <div className="notice">
            <strong>
              Email delivery {mail.enabled ? 'enabled' : 'paused'}
            </strong>
            <p>
              {mail.sender} · {mail.domainStatus}
            </p>
            <p>
              {mail.counts
                ?.map((c: any) => `${c.count} ${c.status}`)
                .join(' · ') || 'No season emails queued yet.'}
            </p>
          </div>
        )}
      </div>
    </details>
  );
}
