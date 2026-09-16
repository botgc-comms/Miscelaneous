'use client';
import { useEffect, useState } from 'react';
import './account.css';
export function AccountSignIn({
  onDone,
  initialMode = 'signin',
}: {
  onDone: () => Promise<void>;
  initialMode?: string;
}) {
  const [mode, setMode] = useState(
      initialMode === 'register' ? 'register' : 'signin',
    ),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [name, setName] = useState(''),
    [code, setCode] = useState(''),
    [challenge, setChallenge] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [auth, setAuth] = useState<any>(null);
  useEffect(() => {
    fetch('/api/auth')
      .then((r) => r.json())
      .then(setAuth)
      .catch(() =>
        setError('Unable to check sign-in options. Please refresh.'),
      );
    if (new URLSearchParams(location.search).get('auth') === 'google-error')
      setError(
        'Google sign-in could not be completed. Please try again or sign in with your email.',
      );
  }, []);
  const changeMode = (next: string) => {
    setMode(next);
    setChallenge('');
    setCode('');
    setError('');
    setMessage('');
    setPassword('');
  };
  return (
    <div className="account-form">
      <p className="muted">
        {challenge
          ? 'Check your inbox for a six-digit code.'
          : mode === 'register'
            ? 'Create your account to join your club’s season.'
            : mode === 'reset'
              ? 'Choose a new password. We’ll email a code to confirm it’s you.'
              : 'Welcome back. Sign in to continue your season.'}
      </p>
      {!challenge && auth?.googleReady && mode !== 'reset' && (
        <a
          className="btn account-google"
          href={
            '/api/auth/google?return=' +
            encodeURIComponent(
              typeof location === 'undefined'
                ? '/'
                : location.pathname + location.search,
            )
          }
        >
          Continue with Google
        </a>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            const r = await fetch('/api/auth', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(
                challenge
                  ? { type: 'account-verify', challenge, code }
                  : {
                      type: mode === 'signin' ? 'password' : mode,
                      email,
                      password,
                      name,
                    },
              ),
            });
            const a: any = await r.json();
            if (!r.ok) throw new Error(a.error);
            if (a.challenge) {
              setChallenge(a.challenge);
              setPassword('');
              setMessage(a.message);
            } else {
              setPassword('');
              window.dispatchEvent(new Event('golfsixes-auth'));
              await onDone();
            }
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {challenge ? (
          <label className="field">
            <span>Verification code</span>
            <input
              autoFocus
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </label>
        ) : (
          <>
            {mode === 'register' && (
              <label className="field">
                <span>Your full name</span>
                <input
                  autoComplete="name"
                  required
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            )}
            <label className="field">
              <span>Email address</span>
              <input
                type="email"
                autoComplete="username"
                maxLength={254}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="field">
              <span>{mode === 'reset' ? 'New password' : 'Password'}</span>
              <input
                type="password"
                autoComplete={
                  mode === 'signin' ? 'current-password' : 'new-password'
                }
                minLength={mode === 'signin' ? 1 : 12}
                maxLength={200}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {mode !== 'signin' && (
                <small>
                  At least 12 characters. A few memorable words work well.
                </small>
              )}
            </label>
          </>
        )}
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary" disabled={busy}>
          {busy
            ? 'Please wait…'
            : challenge
              ? 'Verify & continue'
              : mode === 'register'
                ? 'Create my account'
                : mode === 'reset'
                  ? 'Send reset code'
                  : 'Sign in'}
        </button>
      </form>
      <div className="account-links">
        <button
          className="text-link"
          onClick={() => changeMode(mode === 'signin' ? 'register' : 'signin')}
        >
          {mode === 'signin'
            ? 'New here? Create an account'
            : 'Back to sign in'}
        </button>
        {mode === 'signin' && (
          <button className="text-link" onClick={() => changeMode('reset')}>
            Forgot your password?
          </button>
        )}
        {challenge && (
          <button
            className="text-link"
            onClick={() => {
              setChallenge('');
              setCode('');
              setMessage('');
            }}
          >
            Use another email or request a new code
          </button>
        )}
      </div>
    </div>
  );
}
