'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import './account.css';
import { londonDay } from '@/lib/team-priority';
export function ServiceTools() {
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const locateToolbar = () =>
      setToolbarSlot(document.getElementById('service-tools-slot'));
    locateToolbar();
    const observer = new MutationObserver(locateToolbar);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  const [auth, setAuth] = useState<any>(null),
    [demo, setDemo] = useState<any>(null),
    [date, setDate] = useState(''),
    [liveClock, setLiveClock] = useState<any>(null),
    [liveDate, setLiveDate] = useState(''),
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
      fetch('/api/time-travel')
        .then((r) => r.json())
        .then((clock: any) => {
          setLiveClock(clock);
          setLiveDate(clock.today || '');
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
  async function setLiveDateAndReload(today: string | null) {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/time-travel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ today }),
      });
      const result = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(result.error);
      location.reload();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  if (!auth?.user) return null;
  const nextLive = liveClock?.fixtures?.find(
    (f: any) => f.date > (liveClock.today || londonDay()),
  );
  const next =
    demo?.fixtures?.find(
      (f: any) => f.date > (date || new Date().toISOString().slice(0, 10)),
    ) || demo?.fixtures?.[0];
  const controls = (
    <details
      className={'service-tools' + (demo?.active ? ' demo' : '')}
      open={demo?.active || undefined}
    >
      <summary>
        {demo?.active
          ? 'Demo & time travel · no emails are sent'
          : liveClock?.available
            ? 'My account · Live time travel'
            : demo?.available
              ? 'My account · Demo & time travel'
              : 'My account'}
        {demo?.active && date ? ' · ' + date : ''}
        {!demo?.active && liveClock?.today
          ? ' · Viewing ' + liveClock.today
          : ''}
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
              <span>Time travel — demo date</span>
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
            {liveClock?.available && (
              <section className="live-clock-panel">
                <strong>Time travel on the live site</strong>
                <p>
                  Change the date for your view only. Other users and scheduled
                  emails keep the real date. Any edits you make still change
                  live data.
                </p>
                <label className="field">
                  <span>View the live site on</span>
                  <input
                    type="date"
                    value={liveDate}
                    onChange={(e) => setLiveDate(e.target.value)}
                  />
                </label>
                <div className="row wrap">
                  <button
                    className="btn"
                    disabled={busy || !liveDate}
                    onClick={() => void setLiveDateAndReload(liveDate)}
                  >
                    Set live viewing date
                  </button>
                  {nextLive && (
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() => void setLiveDateAndReload(nextLive.date)}
                    >
                      Next fixture · {nextLive.date}
                    </button>
                  )}
                  <button
                    className="btn"
                    disabled={busy || !liveClock.today}
                    onClick={() => void setLiveDateAndReload(null)}
                  >
                    Use today
                  </button>
                </div>
              </section>
            )}
            {demo?.available && (
              <button
                className="btn"
                disabled={busy}
                onClick={() => void act({ type: 'enter' })}
              >
                Open demo & time travel
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
  return toolbarSlot ? createPortal(controls, toolbarSlot) : controls;
}
