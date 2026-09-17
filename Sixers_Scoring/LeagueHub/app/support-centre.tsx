'use client';
import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  MessageCircle,
  ShieldCheck,
  Download,
  ExternalLink,
} from 'lucide-react';
import { Field, Pick, type AppTools } from './widgets';
import {
  INCIDENT_FORM_URL,
  SAFEGUARDING_URL,
  incidentFields,
  incidentReportHtml,
  supportAdmins,
  type IncidentReport,
} from '@/lib/support';

const statusNames = {
  open: 'Awaiting admin',
  waiting: 'Awaiting organiser',
  resolved: 'Resolved',
};
const stamp = (value: string) =>
  new Date(value).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
export function SupportCentre({
  tools,
  initialTicket = '',
  fixture,
}: {
  tools: AppTools;
  initialTicket?: string;
  fixture?: import('@/lib/model').Fixture;
}) {
  const { s, me, busy, act } = tools;
  const [selected, setSelected] = useState(initialTicket);
  const [creating, setCreating] = useState<'' | 'support' | 'incident'>(
    fixture ? 'incident' : '',
  );
  const [filter, setFilter] = useState('active');
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const organiser = me.role === 'organiser';
  const clubs = s.orgs.filter((o) =>
    organiser
      ? me.orgIds.includes(o.id)
      : me.role === 'admin' ||
        s.teams.some(
          (t) =>
            t.orgId === o.id &&
            supportAdmins(s, t.leagueId).some((m) => m.id === me.id),
        ),
  );
  const [orgId, setOrgId] = useState(
    s.clubs.find((c) => c.id === fixture?.clubId)?.orgId || clubs[0]?.id || '',
  );
  const leagues = s.leagues.filter((l) =>
    s.teams.some(
      (t) => t.orgId === orgId && t.leagueId === l.id && !t.withdrawnAt,
    ),
  );
  const [leagueId, setLeagueId] = useState(
    fixture?.leagueId || leagues[0]?.id || '',
  );
  const organisers = s.members.filter(
    (m) => m.role === 'organiser' && m.orgIds.includes(orgId),
  );
  const [organiserId, setOrganiserId] = useState(
    organiser ? me.id : organisers[0]?.id || '',
  );
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [incident, setIncident] = useState<IncidentReport>(
    () =>
      Object.fromEntries(
        incidentFields.map(([key]) => [
          key,
          key === 'date'
            ? fixture?.date || ''
            : key === 'venue'
              ? s.clubs.find((c) => c.id === fixture?.clubId)?.name || ''
              : '',
        ]),
      ) as IncidentReport,
  );
  const tickets = [...(s.supportTickets || [])].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  const ticket = tickets.find((t) => t.id === selected);
  const unread = (id: string) =>
    s.notifications?.some(
      (n) => n.recipient === me.id && n.supportTicketId === id && !n.readAt,
    );
  const ticketUnread = ticket && unread(ticket.id);
  useEffect(() => {
    if (ticket && ticketUnread && !busy && !error)
      void act({ type: 'support-read', ticketId: ticket.id }).catch((e) =>
        setError(e.message),
      );
  }, [ticket?.id, ticketUnread, busy, error]);
  const back = () => {
    setSelected('');
    setCreating('');
    setError('');
    setReply('');
  };
  function start(kind: 'support' | 'incident') {
    back();
    setCreating(kind);
    setSubject('');
    setMessage('');
    setIncident(
      Object.fromEntries(
        incidentFields.map(([key]) => [key, '']),
      ) as IncidentReport,
    );
  }
  const formLink = (
    <a
      className="btn"
      href={INCIDENT_FORM_URL}
      target="_blank"
      rel="noreferrer"
    >
      Official incident form <ExternalLink size={16} />
    </a>
  );
  if (ticket)
    return (
      <div className="support-centre">
        <button className="text-link row mb-5" onClick={back}>
          <ArrowLeft size={16} /> All support requests
        </button>
        <header className="page-heading">
          <div>
            <span className="eyebrow">
              {ticket.kind === 'incident' ? 'INCIDENT REPORT' : 'SUPPORT'} ·{' '}
              {ticket.id.slice(0, 8).toUpperCase()}
            </span>
            <h1>{ticket.subject}</h1>
            <p>
              {s.orgs.find((o) => o.id === ticket.orgId)?.name} ·{' '}
              {s.leagues.find((l) => l.id === ticket.leagueId)?.name ||
                'Club support'}
            </p>
          </div>
          <span className="badge">{statusNames[ticket.status]}</span>
        </header>
        <p className="support-routing">
          Foundation support:{' '}
          {supportAdmins(s, ticket.leagueId)
            .map((p) => p.name)
            .join(' · ') || 'Foundation administrators'}
        </p>
        {ticket.incident && (
          <section className="card support-report">
            <div className="section-top">
              <h2>Incident record</h2>
              <button
                className="btn"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob(
                      [
                        incidentReportHtml(
                          ticket,
                          s.orgs.find((o) => o.id === ticket.orgId)?.name || '',
                        ),
                      ],
                      { type: 'text/html;charset=utf-8' },
                    ),
                  );
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `incident-${ticket.id.slice(0, 8)}.html`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                <Download size={16} /> Download printable report
              </button>
            </div>
            <p className="muted mt-3">
              Saved in this workspace for your Foundation admin to review. It
              has not been submitted through an external reporting service. The
              printable copy includes signature spaces.
            </p>
            <dl>
              {incidentFields.map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{ticket.incident![key]}</dd>
                </div>
              ))}
            </dl>
            <div className="row wrap">
              {formLink}
              <a
                className="text-link"
                href={SAFEGUARDING_URL}
                target="_blank"
                rel="noreferrer"
              >
                Safeguarding reporting guidance ↗
              </a>
            </div>
          </section>
        )}
        <section className="card support-conversation">
          <h2>Messages</h2>
          <div className="support-messages">
            {ticket.messages.map((m) => (
              <article
                key={m.id}
                className={m.authorId === me.id ? 'mine' : ''}
              >
                <header>
                  <strong>{m.authorName}</strong>
                  <time dateTime={m.createdAt}>{stamp(m.createdAt)}</time>
                </header>
                <p>{m.text}</p>
              </article>
            ))}
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await act({
                  type: 'support-reply',
                  ticketId: ticket.id,
                  message: reply,
                });
                setReply('');
                setError('');
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <Field
              label={
                ticket.status === 'resolved'
                  ? 'Reply and reopen this request'
                  : 'Your reply'
              }
              value={reply}
              onChange={setReply}
              large
              required
            />
            <div className="support-actions">
              <button className="btn primary" disabled={busy || !reply.trim()}>
                {busy ? 'Sending…' : 'Send reply'}
              </button>
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={async () => {
                  try {
                    await act({
                      type: 'support-status',
                      ticketId: ticket.id,
                      status:
                        ticket.status === 'resolved' ? 'open' : 'resolved',
                    });
                    setError('');
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {ticket.status === 'resolved'
                  ? 'Reopen request'
                  : 'Mark resolved'}
              </button>
            </div>
          </form>
        </section>
        <p className="muted">
          Visible to the organiser involved, Foundation administrators and
          assigned league support admins. Other clubs and parents cannot read
          this conversation.
        </p>
      </div>
    );
  if (creating)
    return (
      <div className="support-centre">
        <button className="text-link row mb-5" onClick={back}>
          <ArrowLeft size={16} /> Back to support
        </button>
        <header className="page-heading">
          <div>
            <h1>
              {creating === 'incident'
                ? 'Report an incident'
                : 'Ask for support'}
            </h1>
            <p>
              {creating === 'incident'
                ? 'Record what happened and share it privately with your Foundation admin.'
                : 'Send a message and keep track of the reply here.'}
            </p>
          </div>
        </header>
        {creating === 'incident' && (
          <aside className="support-guidance">
            <strong>Deal with immediate safety first.</strong>
            <p>
              In immediate danger, call 999. For a safeguarding concern, follow
              the Foundation’s reporting guidance and contact the appropriate
              welfare officer; do not wait for a ticket reply.
            </p>
            <div className="row wrap">
              {formLink}
              <a
                className="text-link"
                href={SAFEGUARDING_URL}
                target="_blank"
                rel="noreferrer"
              >
                Safeguarding guidance ↗
              </a>
            </div>
          </aside>
        )}
        <form
          className="card support-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            try {
              const result = await act({
                type: 'support-create',
                kind: creating,
                orgId,
                leagueId,
                organiserId,
                subject,
                message,
                incident: creating === 'incident' ? incident : undefined,
              });
              const created = result.state.supportTickets.find(
                (t: { id: string }) => !tickets.some((old) => old.id === t.id),
              );
              setCreating('');
              if (created) setSelected(created.id);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <div className="form-grid">
            {clubs.length === 1 && (
              <div>
                <strong>Club</strong>
                <p className="mt-2">
                  {s.orgs.find((o) => o.id === orgId)?.name}
                </p>
              </div>
            )}
            {clubs.length > 1 && (
              <Pick
                label="Choose club"
                value={orgId}
                onChange={(v) => {
                  setOrgId(v);
                  setLeagueId(
                    s.teams.find((t) => t.orgId === v && !t.withdrawnAt)
                      ?.leagueId || '',
                  );
                  setOrganiserId(
                    organiser
                      ? me.id
                      : s.members.find(
                          (m) => m.role === 'organiser' && m.orgIds.includes(v),
                        )?.id || '',
                  );
                }}
                options={clubs.map((o) => ({ value: o.id, label: o.name }))}
              />
            )}
            <Pick
              label="League"
              value={leagueId}
              onChange={setLeagueId}
              options={[
                { value: '', label: 'General club support' },
                ...leagues.map((l) => ({
                  value: l.id,
                  label: `${l.name} · ${l.year}`,
                })),
              ]}
            />
            {!organiser && (
              <Pick
                label="Junior organiser"
                value={organiserId}
                onChange={setOrganiserId}
                options={organisers.map((m) => ({
                  value: m.id,
                  label: m.name,
                }))}
              />
            )}
          </div>
          <p className="support-routing">
            Sent to{' '}
            {supportAdmins(s, leagueId)
              .map((p) => p.name)
              .join(' and ') || 'your Foundation support team'}
            {!organiser &&
              ` and ${organisers.find((m) => m.id === organiserId)?.name || 'the selected organiser'}`}
            .
          </p>
          <Field
            label="Subject"
            value={subject}
            onChange={setSubject}
            required
          />
          {creating === 'incident' && (
            <>
              <Pick
                label="Use a fixture to fill in the date and venue"
                value=""
                onChange={(id) => {
                  const f = s.fixtures.find((f) => f.id === id);
                  if (f)
                    setIncident({
                      ...incident,
                      date: f.date,
                      venue:
                        s.clubs.find((c) => c.id === f.clubId)?.name || f.name,
                    });
                }}
                options={s.fixtures
                  .filter((f) => f.leagueId === leagueId)
                  .map((f) => ({
                    value: f.id,
                    label: `${f.date} · ${s.clubs.find((c) => c.id === f.clubId)?.name || f.name}`,
                  }))}
              />
              <div className="support-incident-fields">
                {incidentFields.map(([key, label]) => (
                  <Field
                    key={key}
                    label={label}
                    type={key === 'date' ? 'date' : 'text'}
                    value={incident[key]}
                    onChange={(v) => setIncident({ ...incident, [key]: v })}
                    large={['nature', 'before', 'after'].includes(key)}
                    required
                  />
                ))}
              </div>
              <p className="muted">
                These fields follow the Foundation’s incident form. Enter
                factual details; use “Not known” where necessary. Signed or
                external reporting may still be required.
              </p>
            </>
          )}
          <Field
            label={
              creating === 'incident'
                ? 'Additional message (optional)'
                : 'How can we help?'
            }
            value={message}
            onChange={setMessage}
            large
            required={creating === 'support'}
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="support-actions">
            <button
              className="btn primary"
              disabled={busy || !orgId || (!organiser && !organiserId)}
            >
              {busy
                ? 'Sending…'
                : creating === 'incident'
                  ? 'Send report to admin'
                  : 'Send support request'}
            </button>
            <button className="btn" type="button" onClick={back}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    );
  return (
    <div className="support-centre">
      <header className="page-heading">
        <div>
          <h1>Support & reports</h1>
          <p>
            {organiser
              ? 'Get help from your Foundation admin. Your requests and replies stay together here.'
              : 'Help your junior organisers and follow up incident reports.'}
          </p>
        </div>
      </header>
      {selected && !ticket && (
        <p className="notice">
          This request is not available to this account. Choose a request below
          or switch to the account that received the notification.
        </p>
      )}
      <div className="support-actions">
        <button className="btn primary" onClick={() => start('support')}>
          <MessageCircle size={18} />
          {organiser ? 'Ask for support' : 'Message an organiser'}
        </button>
        <button className="btn" onClick={() => start('incident')}>
          <ShieldCheck size={18} /> Report an incident
        </button>
      </div>
      <div className="support-filter">
        <Pick
          label="Request status"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'active', label: 'Open requests' },
            { value: 'resolved', label: 'Resolved requests' },
            { value: 'all', label: 'All requests' },
          ]}
        />
      </div>
      <div className="support-request-list">
        {tickets
          .filter(
            (t) =>
              filter === 'all' ||
              (filter === 'resolved'
                ? t.status === 'resolved'
                : t.status !== 'resolved'),
          )
          .map((t) => (
            <button
              key={t.id}
              className="card support-request"
              onClick={() => {
                setSelected(t.id);
                setError('');
                setReply('');
              }}
            >
              <div>
                <span className="eyebrow">
                  {t.kind === 'incident' ? 'Incident report' : 'Support'} ·{' '}
                  {t.id.slice(0, 8).toUpperCase()}
                </span>
                <h2>{t.subject}</h2>
                <p>
                  {s.orgs.find((o) => o.id === t.orgId)?.name} ·{' '}
                  {stamp(t.updatedAt)}
                </p>
              </div>
              <div>
                <span className="badge">{statusNames[t.status]}</span>
                {unread(t.id) && (
                  <strong className="support-unread">New update</strong>
                )}
              </div>
            </button>
          ))}
      </div>
      {!tickets.some(
        (t) =>
          filter === 'all' ||
          (filter === 'resolved'
            ? t.status === 'resolved'
            : t.status !== 'resolved'),
      ) && (
        <section className="card support-empty">
          <h2>No {filter === 'resolved' ? 'resolved' : 'open'} requests</h2>
          <p>
            {organiser
              ? 'Ask for help with your league, players, fixtures or using the app.'
              : 'Requests from your organisers will appear here.'}
          </p>
        </section>
      )}
      <details className="support-resources">
        <summary>Official forms & safeguarding guidance</summary>
        <p>
          The Golf Foundation’s team-manager resources include the incident
          form, event risk assessment and checklists.
        </p>
        <div className="row wrap">
          {formLink}
          <a
            className="btn"
            href="https://www.golf-foundation.org/golfsixes-league"
            target="_blank"
            rel="noreferrer"
          >
            Team-manager resources <ExternalLink size={16} />
          </a>
          <a
            className="text-link"
            href={SAFEGUARDING_URL}
            target="_blank"
            rel="noreferrer"
          >
            Safeguarding guidance ↗
          </a>
        </div>
      </details>
    </div>
  );
}
