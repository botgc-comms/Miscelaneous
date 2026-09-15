'use client';
import { useEffect, useState } from 'react';
import { Copy, Mail, Plus, Trash2, Check, Users } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Field, Pick, CheckField, type AppTools } from './widgets';
import { canOrg, organiserClubs, type Invite } from '@/lib/model';
import { invitationStatus, canManageInvite } from '@/lib/invitations';
async function request(tools: AppTools, body: any) {
  const r = await fetch('/api/invitations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspace: tools.workspace,
      view: tools.view,
      ...body,
    }),
  });
  const data: any = await r.json();
  if (!r.ok) throw new Error(data.error);
  return data;
}
export function InviteDialog({
  tools,
  data,
  close,
}: {
  tools: AppTools;
  data: any;
  close: () => void;
}) {
  const [role, setRole] = useState(
    data.role || (tools.me.role === 'organiser' ? 'organiser' : 'parent'),
  );
  const [email, setEmail] = useState(''),
    [query, setQuery] = useState(''),
    [orgIds, setOrgIds] = useState<string[]>(data.orgIds || []),
    [leagueIds, setLeagueIds] = useState<string[]>([]);
  const [result, setResult] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const orgs = tools.s.orgs
    .filter((o) => canOrg(tools.s, tools.me, o.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const roles =
    tools.me.role === 'admin'
      ? ['organiser', 'parent', 'league-admin', 'admin']
      : ['organiser', 'parent'];
  const labels: Record<string, string> = {
    organiser: 'Junior organiser',
    parent: 'Parent or guardian',
    'league-admin': 'League administrator',
    admin: 'Foundation administrator',
  };
  const clubBound = data.role === 'organiser' && data.orgIds?.length === 1;
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && close()}>
      <DialogContent className="editor-dialog invite-dialog">
        <DialogHeader>
          <DialogTitle>
            {result
              ? 'Invitation ready'
              : clubBound
                ? 'Invite a junior organiser'
                : 'Invite someone'}
          </DialogTitle>
          <DialogDescription>
            {result
              ? 'Their club access starts when they accept. You can track this invitation in the club’s organiser list.'
              : clubBound
                ? tools.s.orgs.find((o) => o.id === data.orgIds[0])?.name
                : 'Choose their role and where they’ll help.'}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="notice">
            {message}
          </p>
        )}
        {result ? (
          <div className="stack">
            <div className="invite-ready">
              <Mail size={22} />
              <div>
                <strong>{email || 'Shared parent invitation'}</strong>
                <p>Invite pending · valid for 14 days</p>
              </div>
            </div>
            <label className="field">
              <span>Invitation link</span>
              <input
                readOnly
                value={result.link}
                onFocus={(e) => e.target.select()}
              />
            </label>
            <div className="action-bar">
              <button
                className="btn primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await navigator.clipboard.writeText(result.link);
                    setMessage('Invitation link copied.');
                  })
                }
              >
                <Copy size={16} />
                Copy invitation link
              </button>
              {result.emailReady && email && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await request(tools, { type: 'send', id: result.id });
                      await tools.refresh();
                      setMessage(
                        'Invitation emailed. It stays pending until accepted.',
                      );
                    })
                  }
                >
                  <Mail size={16} />
                  Send email
                </button>
              )}
            </div>
            {!result.emailReady && (
              <p className="muted">
                Email delivery isn’t connected yet. Copy this link and share it
                with the recipient.
              </p>
            )}
            <div className="invite-footer">
              <button
                className="text-link"
                onClick={() => {
                  setResult(null);
                  setEmail('');
                  setMessage('');
                }}
              >
                {role === 'organiser'
                  ? 'Invite another organiser'
                  : 'Invite someone else'}
              </button>
              <button className="btn" onClick={close}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                setResult(
                  await request(tools, {
                    type: 'create',
                    role,
                    email,
                    orgIds: ['parent', 'organiser'].includes(role)
                      ? orgIds
                      : [],
                    leagueIds: role === 'league-admin' ? leagueIds : [],
                  }),
                );
                await tools.refresh();
              });
            }}
          >
            {!clubBound && (
              <div className="field">
                <span>Role</span>
                <Pick
                  label="Role"
                  value={role}
                  onChange={setRole}
                  options={roles.map((value) => ({
                    value,
                    label: labels[value],
                  }))}
                />
              </div>
            )}
            <Field
              label={
                role === 'parent'
                  ? 'Recipient email (optional for a shared link)'
                  : 'Recipient email'
              }
              type="email"
              value={email}
              onChange={setEmail}
              required={role !== 'parent'}
            />
            {['organiser', 'parent'].includes(role) && !clubBound && (
              <div className="stack">
                <Field label="Find a club" value={query} onChange={setQuery} />
                {!!orgIds.length && (
                  <div className="invite-selection">
                    {orgs
                      .filter((o) => orgIds.includes(o.id))
                      .map((o) => (
                        <button
                          type="button"
                          key={o.id}
                          onClick={() =>
                            setOrgIds(orgIds.filter((id) => id !== o.id))
                          }
                        >
                          {o.name}
                          <span aria-label="Remove selection">×</span>
                        </button>
                      ))}
                  </div>
                )}
                <div className="invite-club-picker">
                  {orgs
                    .filter((o) =>
                      o.name.toLowerCase().includes(query.toLowerCase()),
                    )
                    .map((o) => (
                      <CheckField
                        key={o.id}
                        checked={orgIds.includes(o.id)}
                        onChange={(yes) =>
                          setOrgIds(
                            yes
                              ? [...orgIds, o.id]
                              : orgIds.filter((id) => id !== o.id),
                          )
                        }
                      >
                        {o.name}
                      </CheckField>
                    ))}
                  {!orgs.length && <p className="muted">Add a club first.</p>}
                </div>
              </div>
            )}
            {role === 'league-admin' && (
              <div className="invite-club-picker">
                {tools.s.leagues.map((l) => (
                  <CheckField
                    key={l.id}
                    checked={leagueIds.includes(l.id)}
                    onChange={(yes) =>
                      setLeagueIds(
                        yes
                          ? [...leagueIds, l.id]
                          : leagueIds.filter((id) => id !== l.id),
                      )
                    }
                  >
                    {l.name} · {l.year}
                  </CheckField>
                ))}
              </div>
            )}
            <div className="invite-footer">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={close}
              >
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={
                  busy ||
                  (['parent', 'organiser'].includes(role) && !orgIds.length) ||
                  (role === 'league-admin' && !leagueIds.length)
                }
              >
                {busy ? 'Creating…' : 'Create invitation'}
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
export function InvitationList({
  tools,
  orgId,
}: {
  tools: AppTools;
  orgId?: string;
}) {
  const [busy, setBusy] = useState(''),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [emailReady, setEmailReady] = useState(false),
    [renew, setRenew] = useState(''),
    [revoke, setRevoke] = useState(''),
    [link, setLink] = useState('');
  useEffect(() => {
    fetch(
      '/api/invitations?' +
        new URLSearchParams({ workspace: tools.workspace, view: tools.view }),
    )
      .then((r) => r.json())
      .then((v: any) => setEmailReady(!!v.emailReady))
      .catch(() => {});
  }, [tools.workspace, tools.view]);
  const invitations = tools.s.invites.filter(
    (i) =>
      (!orgId || (i.orgIds.includes(orgId) && !i.acceptedAt && !i.revoked)) &&
      canManageInvite(tools.s, tools.me, i),
  );
  async function run(i: Invite, type: string) {
    setBusy(i.id);
    setError('');
    setMessage('');
    setLink('');
    try {
      const r = await request(tools, { type, id: i.id });
      if (type !== 'send') {
        setLink(r.link);
        try {
          await navigator.clipboard.writeText(r.link);
          setMessage('Invitation link copied.');
        } catch {
          setMessage('Select and copy the link below.');
        }
      } else setMessage('Invitation emailed.');
      setRenew('');
      await tools.refresh();
    } catch (e) {
      setError((e as Error).message);
      if (type === 'link') setRenew(i.id);
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="invitation-list">
      {invitations.map((i) => (
        <div className="invitation-row" key={i.id}>
          <div>
            <strong>{i.email || 'Shared parent link'}</strong>
            <p className="muted">
              {invitationStatus(i)}
              {i.sentAt && !i.acceptedAt && !i.revoked ? ' · Email sent' : ''}
            </p>
          </div>
          {!i.revoked && !i.acceptedAt && (
            <div className="action-bar">
              {Date.parse(i.expires) > Date.now() && (
                <>
                  <button
                    className="btn small"
                    disabled={!!busy}
                    onClick={() => void run(i, 'link')}
                  >
                    <Copy size={15} />
                    Copy link
                  </button>
                  {emailReady && i.email && (
                    <button
                      className="btn small"
                      disabled={!!busy}
                      onClick={() => void run(i, 'send')}
                    >
                      <Mail size={15} />
                      {i.sentAt ? 'Resend' : 'Email'}
                    </button>
                  )}
                </>
              )}
              {(renew === i.id || Date.parse(i.expires) <= Date.now()) && (
                <button
                  className="btn small"
                  disabled={!!busy}
                  onClick={() => void run(i, 'renew')}
                >
                  Create replacement link
                </button>
              )}
              <button
                className="league-icon-button"
                aria-label={`Revoke invitation to ${i.email}`}
                disabled={!!busy}
                onClick={() => setRevoke(i.id)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          )}
          {revoke === i.id && (
            <div className="inline-confirm">
              <p>Cancel this invitation? Its link will stop working.</p>
              <div className="action-bar">
                <button className="btn small" onClick={() => setRevoke('')}>
                  Keep invitation
                </button>
                <button
                  className="btn small"
                  disabled={!!busy}
                  onClick={async () => {
                    setBusy(i.id);
                    try {
                      await tools.act({ type: 'revoke', id: i.id });
                      setRevoke('');
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy('');
                    }
                  }}
                >
                  Revoke invitation
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
      {renew && (
        <p className="muted">
          Creating a replacement invalidates the previous link.
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {link && (
        <input
          className="invite-copy-field"
          aria-label="Invitation link"
          readOnly
          value={link}
          onFocus={(e) => e.target.select()}
        />
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
export function ClubOrganisers({
  tools,
  orgId,
  onInvite,
}: {
  tools: AppTools;
  orgId: string;
  onInvite: () => void;
}) {
  const [remove, setRemove] = useState(''),
    [error, setError] = useState('');
  const members = tools.s.members.filter(
    (m) =>
      (m.role === 'organiser' && m.orgIds.includes(orgId)) ||
      organiserClubs(m).includes(orgId),
  );
  return (
    <section className="club-organisers">
      <div className="section-heading">
        <div>
          <h3>Junior organisers</h3>
          <p className="muted">People helping run this club’s teams.</p>
        </div>
        <button className="btn small" onClick={onInvite}>
          <Plus size={16} />
          Invite organiser
        </button>
      </div>
      {!members.length && (
        <p className="muted">No organisers have joined yet.</p>
      )}
      {members.map((m) => (
        <div className="invitation-row" key={m.id}>
          <div>
            <strong>{m.name}</strong>
            <p className="muted">{m.email}</p>
          </div>
          <div className="action-bar">
            <span className="status-accepted">
              <Check size={14} />
              Joined
            </span>
            {tools.me.role === 'admin' && (
              <button
                className="league-icon-button"
                aria-label={`Remove ${m.name} as organiser`}
                onClick={() => setRemove(m.id)}
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
          {remove === m.id && (
            <div className="inline-confirm">
              <p>Remove {m.name}’s organiser access to this club?</p>
              <div className="action-bar">
                <button className="btn small" onClick={() => setRemove('')}>
                  Cancel
                </button>
                <button
                  className="btn small"
                  disabled={tools.busy}
                  onClick={async () => {
                    try {
                      await tools.act({
                        type: 'organiser-remove',
                        memberId: m.id,
                        orgId,
                      });
                      setRemove('');
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Remove organiser
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
      <InvitationList tools={tools} orgId={orgId} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
