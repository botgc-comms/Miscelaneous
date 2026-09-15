'use client';
import { useEffect, useState } from 'react';
import {
  Flag,
  HeartHandshake,
  Users,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react';
import LeagueApp from './league-app';
import ParentPortal from './parent-portal';
import RegistrationGate from './registration-gate';
import { rememberedEmail, rememberEmail } from '@/lib/remembered-login';
import {
  readJourney,
  roleHref,
  type JourneyContext,
} from '@/lib/journey-context';
export default function Entry() {
  const [role, setRole] = useState('');
  const [returning, setReturning] = useState(false);
  const [journey, setJourney] = useState<JourneyContext | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    setJourney(readJourney());
    setReturning(!!rememberedEmail());
    setRole(
      q.get('role') || (q.has('workspace') || q.has('join') ? 'staff' : ''),
    );
  }, []);
  if (role === 'parent')
    return (
      <RegistrationGate role="parent">
        <ParentPortal />
      </RegistrationGate>
    );
  if (role)
    return (
      <RegistrationGate role={role === 'admin' ? 'admin' : 'staff'}>
        <LeagueApp />
      </RegistrationGate>
    );
  return (
    <div className="welcome-shell">
      <header className="family-top">
        <a className="family-brand" href="/">
          <Flag />
          Golf<span>Sixes</span>
          <small>LEAGUE</small>
        </a>
        <span className="muted">A great season starts here.</span>
      </header>
      <main className="welcome-main">
        <span className="eyebrow">HELLO, GOLF FAMILY</span>
        <h1>
          A little golf.
          <br />A lot to look forward to.
        </h1>
        <p>
          First, tell us how you’re taking part.
          <br />
          We’ll help you with the rest.
        </p>
        <div className="role-choices">
          {returning && (
            <div className="card">
              <h2>Welcome back</h2>
              <p>Your parent sign-in email is remembered on this device.</p>
              <a className="btn primary mt-3" href="/?role=parent">
                Continue as a parent <ArrowRight size={17} />
              </a>
              <button
                className="text-link mt-3 block"
                onClick={() => {
                  rememberEmail('');
                  setReturning(false);
                }}
              >
                Forget my remembered email
              </button>
            </div>
          )}
          {[
            [
              HeartHandshake,
              'parent',
              'I’m a parent or guardian',
              'Get your children ready, find their team and follow their fixtures.',
            ],
            [
              Users,
              'staff',
              'I’m a junior organiser',
              'Welcome your families and get your teams ready to play.',
            ],
            [
              ShieldCheck,
              'admin',
              'I’m a Foundation administrator',
              'Bring the leagues, clubs and organisers together.',
            ],
          ].map(([Icon, id, title, desc]: any) => (
            <a className="role-choice" key={id} href={roleHref(id, journey)}>
              <Icon />
              <div>
                <h2>{title}</h2>
                <p>{desc}</p>
              </div>
              <ArrowRight />
            </a>
          ))}
        </div>
        <p className="welcome-note">
          Got a team code? Choose “parent or guardian” to add it.
        </p>
      </main>
    </div>
  );
}
