'use client';
import { useEffect, useState } from 'react';
import { Field, Pick, CheckField } from './widgets';
export const helpReasons = [
  { value: 'forgot-email', label: 'I cannot remember which email I used' },
  { value: 'no-code', label: 'My sign-in code has not arrived' },
  { value: 'lost-email', label: 'I cannot access my old email account' },
  { value: 'other', label: 'Something else is stopping me signing in' },
];
export function LoginHelp({ onBack }: { onBack: () => void }) {
  const [search, setSearch] = useState(''),
    [clubs, setClubs] = useState<any[]>([]),
    [club, setClub] = useState(''),
    [name, setName] = useState(''),
    [phone, setPhone] = useState(''),
    [email, setEmail] = useState(''),
    [reason, setReason] = useState('forgot-email'),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false),
    [error, setError] = useState(''),
    [finding, setFinding] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setClub('');
    setClubs([]);
    setFinding(search.trim().length >= 2);
    const timer = setTimeout(() => {
      if (search.trim().length >= 2)
        void fetch('/api/login-help?q=' + encodeURIComponent(search), {
          signal: controller.signal,
        })
          .then(async (r) => {
            const d = (await r.json()) as any;
            if (!r.ok) throw new Error(d.error);
            setClubs(d.clubs);
            setError('');
          })
          .catch((e) => {
            if (!controller.signal.aborted) setError(e.message);
          })
          .finally(() => {
            if (!controller.signal.aborted) setFinding(false);
          });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search]);
  return (
    <div className="stack mt-5">
      <h2>
        {sent
          ? 'Your request is with the club'
          : 'Ask your junior organiser for help'}
      </h2>
      {sent ? (
        <>
          <p>
            Your request is saved in the club’s login-help queue and the
            Foundation can also see it. Your organiser can contact you on the
            number you provided. This has not changed your account or signed you
            in.
          </p>
          <p className="muted">
            If you need access urgently, contact your club directly and mention
            your login-help request.
          </p>
        </>
      ) : (
        <>
          <p>
            You do not need to sign in or remember your old email. Tell us your
            club and how to reach you.
          </p>
          <p className="notice">
            Waiting for a code? Check junk mail and request a fresh code using
            the email you registered with. If you used ChatGPT to register,
            choose Continue with ChatGPT on the sign-in screen.
          </p>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              const selected = clubs.find(
                (c) => `${c.workspace}:${c.id}` === club,
              );
              void fetch('/api/login-help', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  workspace: selected?.workspace,
                  orgId: selected?.id,
                  name,
                  phone,
                  email,
                  reason,
                  consent,
                }),
              })
                .then(async (r) => {
                  const d = (await r.json()) as any;
                  if (!r.ok) throw new Error(d.error);
                  setSent(true);
                })
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            <Field label="Find your club" value={search} onChange={setSearch} />
            {finding ? (
              <p role="status">Finding clubs…</p>
            ) : search.trim().length >= 2 && !clubs.length ? (
              <p>
                No matching clubs. Try part of the club’s name. If it is not
                listed, contact the club directly.
              </p>
            ) : null}
            {!!clubs.length && (
              <Pick
                label="Your club"
                value={club}
                onChange={setClub}
                options={clubs.map((c) => ({
                  value: `${c.workspace}:${c.id}`,
                  label: c.name,
                }))}
              />
            )}
            <Field
              label="Your full name"
              value={name}
              onChange={setName}
              required
            />
            <Field
              label="Phone number we can reach you on"
              type="tel"
              value={phone}
              onChange={setPhone}
              required
            />
            <Field
              label="Contact email (optional; it can be different from your login)"
              type="email"
              value={email}
              onChange={setEmail}
            />
            <Pick
              label="What do you need help with?"
              value={reason}
              onChange={setReason}
              options={helpReasons}
            />
            <CheckField checked={consent} onChange={setConsent}>
              Share these contact details with my club’s organiser and the
              Foundation so they can help me sign in.
            </CheckField>
            <button
              className="btn primary"
              disabled={busy || !club || !consent}
            >
              {busy ? 'Sending…' : 'Ask my organiser for help'}
            </button>
          </form>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="text-link" onClick={onBack}>
        Back to sign in
      </button>
    </div>
  );
}
