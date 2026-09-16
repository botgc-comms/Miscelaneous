'use client';
import { useState, useEffect } from 'react';
import { Flag, ArrowRight } from 'lucide-react';
import { Field, Pick, CheckField } from './widgets';
import { AccountSignIn } from './account-sign-in';
import { LoginHelp } from './login-help';
import { rememberedEmail, rememberEmail } from '@/lib/remembered-login';

async function request(path: string, body?: unknown) {
  const response = await fetch(path, {
    cache: 'no-store',
    ...(body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const result: any = await response.json();
  if (!response.ok) throw new Error(result.error || 'Please try again.');
  return result;
}
export default function RegistrationGate({
  role,
  children,
}: {
  role: string;
  children: React.ReactNode;
}) {
  const [data, setData] = useState<any>(null);
  const [mode, setMode] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [challenge, setChallenge] = useState('');
  const [code, setCode] = useState('');
  const [search, setSearch] = useState('');
  const [club, setClub] = useState('');
  const [foundation, setFoundation] = useState('');
  const [anotherEmail, setAnotherEmail] = useState(false);
  const [invitation, setInvitation] = useState<any>(null);
  const [inviteToken, setInviteToken] = useState('');
  const [help, setHelp] = useState(false);
  const [remember, setRemember] = useState(false);
  const [requestedWorkspace, setRequestedWorkspace] = useState('');
  const label =
    role === 'parent'
      ? 'Parent or guardian'
      : role === 'staff'
        ? 'Junior organiser'
        : 'Foundation administrator';
  const memberships = data?.memberships?.filter((m: any) =>
    role === 'staff'
      ? m.role === 'organiser' ||
        (m.role === 'admin' && (m.organiserOrgIds?.length || m.organiserOrgId))
      : m.role === 'admin' || m.role === 'league-admin',
  );
  const membership =
    memberships?.find((m: any) => m.workspace === requestedWorkspace) ||
    memberships?.[0];
  const registered = role === 'parent' ? data?.parentRegistered : !!membership;
  const pending = data?.requests?.find(
    (r: any) =>
      r.role === (role === 'staff' ? 'organiser' : 'admin') &&
      r.status === 'pending',
  );
  const declined = data?.requests?.find(
    (r: any) =>
      r.role === (role === 'staff' ? 'organiser' : 'admin') &&
      r.status === 'rejected',
  );
  async function refresh() {
    const result = await request('/api/registration');
    setData(result);
    setName((n) => n || result.user?.name || '');
    setPhone((p) => p || result.user?.phone || '');
    if (result.foundations?.length === 1)
      setFoundation(result.foundations[0].id);
    return result;
  }
  useEffect(() => {
    setRequestedWorkspace(
      new URLSearchParams(location.search).get('workspace') || '',
    );
    if (role === 'parent') {
      if (new URLSearchParams(location.search).get('help') === '1')
        setHelp(true);
      const saved = rememberedEmail();
      if (saved) {
        setEmail(saved);
        setRemember(true);
        setMode('signin');
      }
    }
    void refresh().catch((e) => setError(e.message));
    const token = new URLSearchParams(location.search).get('join');
    if (token) {
      setInviteToken(token);
      setMode('signin');
      void request('/api/invite?token=' + encodeURIComponent(token))
        .then(setInvitation)
        .catch((e) => setError(e.message));
    }
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function enter(workspace = membership?.workspace) {
    if (role === 'parent')
      rememberEmail(remember ? data?.user?.email || email : '');
    const q = new URLSearchParams(location.search);
    q.set('role', role);
    q.set('view', role === 'staff' ? 'organiser' : role);
    if (workspace && role !== 'parent') q.set('workspace', workspace);
    q.delete('auth');
    q.delete('help');
    history.replaceState({}, '', location.pathname + '?' + q);
    setReady(true);
  }
  if (ready || data?.demo) return <>{children}</>;
  const matching = (data?.organisations || [])
    .filter((o: any) =>
      o.name.toLowerCase().includes(search.trim().toLowerCase()),
    )
    .sort((a: any, b: any) => a.name.localeCompare(b.name));
  return (
    <div className="welcome-shell">
      <header className="family-top">
        <a className="family-brand" href="/">
          <Flag />
          Golf<span>Sixes</span>
          <small>LEAGUE</small>
        </a>
      </header>
      <main className="registration-main">
        <a href="/" className="text-link">
          Change role
        </a>
        <section className="card registration-card">
          <span className="eyebrow">{label}</span>
          <h1>
            {!mode
              ? 'Welcome to GolfSixes'
              : mode === 'register'
                ? 'Create your account'
                : 'Sign in'}
          </h1>
          {error && (
            <p className="error mt-4" role="alert">
              {error}
              <button
                className="text-link ml-3"
                onClick={() =>
                  void run(async () => {
                    await refresh();
                  })
                }
              >
                Retry
              </button>
            </p>
          )}
          {help ? (
            <LoginHelp
              onBack={() => {
                setHelp(false);
                setMode('signin');
              }}
            />
          ) : !data ? (
            <p className="muted mt-4">Checking your account…</p>
          ) : !mode && data.user && registered && !inviteToken ? (
            <div className="stack mt-5">
              <h2>Welcome back, {data.user.name}</h2>
              <p className="muted">You’re signed in as {data.user.email}.</p>
              {role === 'parent' && (
                <CheckField
                  checked={remember}
                  onChange={(v) => {
                    setRemember(v);
                    if (!v) rememberEmail('');
                  }}
                >
                  Remember my email on this device
                </CheckField>
              )}
              <button className="btn primary" onClick={() => enter()}>
                Continue to {role === 'parent' ? 'my children' : 'my overview'}{' '}
                <ArrowRight size={17} />
              </button>
              <button
                className="text-link"
                onClick={() => {
                  rememberEmail('');
                  setRemember(false);
                  setEmail('');
                  setMode('signin');
                  setAnotherEmail(true);
                }}
              >
                Use another account
              </button>
            </div>
          ) : !mode ? (
            <>
              <p className="muted mt-3">
                New here? Register to get started. Already registered? Sign in.
              </p>
              <div className="registration-actions">
                <button
                  className="btn primary"
                  onClick={() => setMode('register')}
                >
                  Register <ArrowRight size={17} />
                </button>
                <button className="btn" onClick={() => setMode('signin')}>
                  Sign in
                </button>
              </div>
            </>
          ) : (
            <>
              {!data.user || anotherEmail ? (
                <AccountSignIn
                  initialMode={mode}
                  onDone={async () => {
                    setName('');
                    setPhone('');
                    await refresh();
                    setAnotherEmail(false);
                  }}
                />
              ) : (
                <>
                  <p className="muted mt-3">{data.user.email}</p>
                  {invitation ? (
                    <>
                      <p className="mt-4">
                        You’ve been invited to{' '}
                        {invitation.organisations?.join(', ') ||
                          invitation.name}{' '}
                        as a{' '}
                        {invitation.role === 'organiser'
                          ? 'junior organiser'
                          : invitation.role}
                        .
                      </p>
                      <button
                        className="btn primary mt-4"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const result = await request('/api/invite', {
                              token: inviteToken,
                            });
                            const nextRole =
                              invitation.role === 'admin' ||
                              invitation.role === 'league-admin'
                                ? 'admin'
                                : invitation.role === 'parent'
                                  ? 'parent'
                                  : 'staff';
                            location.href = `/?role=${nextRole}&view=${invitation.role === 'organiser' ? 'organiser' : nextRole}&workspace=${encodeURIComponent(result.workspace)}`;
                          })
                        }
                      >
                        {busy
                          ? 'Joining…'
                          : invitation.accepted
                            ? 'Continue to my club'
                            : 'Accept invitation'}
                      </button>
                    </>
                  ) : registered ? (
                    <>
                      <p className="mt-4">
                        Your {label.toLowerCase()} account is ready.
                      </p>
                      {role === 'parent' && (
                        <CheckField
                          checked={remember}
                          onChange={(v) => {
                            setRemember(v);
                            if (!v) rememberEmail('');
                          }}
                        >
                          Remember my email on this device
                        </CheckField>
                      )}
                      <button
                        className="btn primary mt-5"
                        onClick={() => enter()}
                      >
                        Continue as {data.user.name} <ArrowRight size={17} />
                      </button>
                    </>
                  ) : pending ? (
                    <>
                      <h2 className="mt-5">Awaiting Foundation approval</h2>
                      <p className="mt-3">
                        {role === 'staff'
                          ? `Your application to organise ${pending.clubName} has been sent.`
                          : 'Your Foundation administrator registration has been sent.'}{' '}
                        You’ll have access once the Foundation approves it.
                      </p>
                      <button
                        className="btn mt-5"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await refresh();
                          })
                        }
                      >
                        Check approval status
                      </button>
                    </>
                  ) : mode === 'signin' ? (
                    <>
                      <p className="mt-4">
                        You haven’t registered as a {label.toLowerCase()} yet.
                      </p>
                      <button
                        className="btn primary mt-5"
                        onClick={() => setMode('register')}
                      >
                        Register now
                      </button>
                    </>
                  ) : (
                    <form
                      className="stack mt-5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void run(async () => {
                          const chosen = data.organisations?.find(
                            (o: any) => `${o.workspace}:${o.id}` === club,
                          );
                          const result = await request('/api/registration', {
                            role,
                            name,
                            phone,
                            workspace:
                              role === 'staff' ? chosen?.workspace : foundation,
                            orgId: chosen?.id,
                          });
                          setData(result);
                          if (role === 'parent') enter();
                        });
                      }}
                    >
                      {declined && (
                        <p className="notice">
                          Your previous application was declined. Contact the
                          Foundation if you need help, or submit a corrected
                          application.
                        </p>
                      )}
                      <Field
                        label="Full name"
                        value={name}
                        onChange={setName}
                        required
                      />
                      <Field
                        label="Contact phone number"
                        type="tel"
                        value={phone}
                        onChange={setPhone}
                        required
                      />
                      {role === 'staff' && (
                        <>
                          <Field
                            label="Find your club"
                            value={search}
                            onChange={setSearch}
                          />
                          <Pick
                            label="Club you organise"
                            value={club}
                            onChange={setClub}
                            options={matching.map((o: any) => ({
                              value: `${o.workspace}:${o.id}`,
                              label: o.name,
                            }))}
                          />
                          {!matching.length && (
                            <p className="notice">
                              No matching clubs. The Foundation needs to add
                              your club before you register as its organiser.
                            </p>
                          )}
                          <p className="muted">
                            The Foundation will confirm your club affiliation
                            before you can see its players and manage its teams.
                          </p>
                        </>
                      )}
                      {role === 'admin' && (
                        <>
                          {data.foundations?.length > 1 && (
                            <Pick
                              label="Foundation administration"
                              value={foundation}
                              onChange={setFoundation}
                              options={data.foundations.map((w: any) => ({
                                value: w.id,
                                label: w.name,
                              }))}
                            />
                          )}
                          <p className="muted">
                            An existing Foundation administrator must approve
                            your access.
                          </p>
                        </>
                      )}
                      <button
                        className="btn primary"
                        disabled={
                          busy ||
                          (role === 'staff' && !club) ||
                          (role === 'admin' && !foundation)
                        }
                      >
                        {busy
                          ? 'Saving…'
                          : role === 'parent'
                            ? 'Register & add my children'
                            : 'Submit registration'}{' '}
                        <ArrowRight size={17} />
                      </button>
                    </form>
                  )}
                  <button
                    className="text-link auth-secondary-link"
                    onClick={() => setAnotherEmail(true)}
                  >
                    Use another email
                  </button>
                </>
              )}
              {!inviteToken && data.user && !anotherEmail && (
                <button
                  className="text-link auth-secondary-link"
                  onClick={() => {
                    setMode(mode === 'register' ? 'signin' : 'register');
                    setError('');
                  }}
                >
                  {mode === 'register'
                    ? 'Already registered? Sign in'
                    : 'New here? Register'}
                </button>
              )}
            </>
          )}
          {role === 'parent' && !help && (
            <button
              className="text-link auth-secondary-link"
              onClick={() => {
                setHelp(true);
                setError('');
              }}
            >
              Having trouble signing in? Ask my organiser
            </button>
          )}
        </section>
      </main>
    </div>
  );
}
