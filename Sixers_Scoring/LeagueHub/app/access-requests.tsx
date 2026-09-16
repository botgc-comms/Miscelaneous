'use client';
import { useState } from 'react';
import type { AppTools } from './widgets';
export function AccessRequests({ tools }: { tools: AppTools }) {
  const [error, setError] = useState('');
  const requests = (tools.s.accessRequests || []).filter(
    (r) => r.status === 'pending',
  );
  if (tools.me.role !== 'admin' || !requests.length) return null;
  async function decide(id: string, decision: string) {
    setError('');
    try {
      await tools.act({ type: 'access-request-decision', id, decision });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="card mb-6" aria-label="Staff registrations">
      <h2>
        Staff registrations{' '}
        <span className="badge">{requests.length} waiting</span>
      </h2>
      {error && (
        <p role="alert" className="error mt-3">
          {error}
        </p>
      )}
      {requests.map((r) => (
        <article className="roster-child" key={r.id}>
          <strong>{r.name}</strong>
          <p>
            {r.role === 'organiser'
              ? `Junior organiser · ${tools.s.orgs.find((o) => o.id === r.orgId)?.name || 'Club unavailable'}`
              : 'Foundation administrator · full administration access'}
          </p>
          <p className="muted">
            {r.email} · {r.phone}
          </p>
          <div className="row wrap mt-3">
            <button
              className="btn primary small"
              disabled={tools.busy}
              onClick={() => void decide(r.id, 'approve')}
            >
              {r.role === 'admin'
                ? 'Approve Foundation admin access'
                : 'Approve organiser'}
            </button>
            <button
              className="btn small"
              disabled={tools.busy}
              onClick={() => void decide(r.id, 'reject')}
            >
              Decline
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
