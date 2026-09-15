'use client';
import { useState } from 'react';
import { GenderField } from './gender-field';
import { InviteDialog } from './invitations';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Field, Pick, CheckField, type AppTools } from './widgets';
import {
  canOrg,
  canLeague,
  leagueHasTeamSpace,
  availableCaps,
  CAP_COLOURS,
} from '@/lib/model';
import { Copy, ShieldCheck } from 'lucide-react';
export type Editor = { kind: string; data: any };
export function EditDialog(props: {
  editor: Editor;
  close: () => void;
  tools: AppTools;
  onCreated: (v: any) => void;
}) {
  return props.editor.kind === 'invite' ? (
    <InviteDialog
      tools={props.tools}
      data={props.editor.data}
      close={props.close}
    />
  ) : (
    <GeneralEditDialog {...props} />
  );
}
function GeneralEditDialog({
  editor,
  close,
  tools,
  onCreated,
}: {
  editor: Editor;
  close: () => void;
  tools: AppTools;
  onCreated: (v: any) => void;
}) {
  const { s, me, busy, act } = tools;
  const k = editor.kind;
  const orgs = s.orgs.filter(
    (o) =>
      canOrg(s, me, o.id) ||
      me.orgIds.includes(o.id) ||
      (k === 'team' && me.role === 'league-admin'),
  );
  const leagues = s.leagues.filter(
    (l) =>
      canLeague(me, l.id) ||
      s.teams.some(
        (t) => t.leagueId === l.id && orgs.some((o) => o.id === t.orgId),
      ),
  );
  const teamLeagues = leagues.filter(
    (l) => editor.data.id || leagueHasTeamSpace(s, l.id),
  );
  const [d, setD] = useState<any>({
    name: '',
    region: 'England · South East',
    year: new Date().getFullYear(),
    registrationOpen: true,
    holes: 6,
    pairs: 3,
    maxStrokes: 10,
    tiePolicy: 'countback',
    adminId: me.id,
    assistantId: '',
    squadSize: 12,
    orgId: orgs[0]?.id || '',
    leagueId: (k === 'team' ? teamLeagues[0]?.id : leagues[0]?.id) || '',
    color: CAP_COLOURS[0].color,
    cap: CAP_COLOURS[0].cap,
    arrival: '09:00',
    start: '09:30',
    registration: true,
    format: 'shotgun',
    date: new Date().toISOString().slice(0, 10),
    teamIds: s.teams
      .filter(
        (t) =>
          !t.withdrawnAt &&
          t.leagueId === (editor.data?.leagueId || leagues[0]?.id),
      )
      .map((t) => t.id),
    clubId:
      s.clubs.find((c) =>
        s.teams.some(
          (t) =>
            t.orgId === c.orgId &&
            t.leagueId === (editor.data?.leagueId || leagues[0]?.id),
        ),
      )?.id || '',
    role: 'parent',
    orgIds: orgs[0] ? [orgs[0].id] : [],
    leagueIds: [],
    email: '',
    ...editor.data,
    ...(k === 'team' && !editor.data.id
      ? availableCaps(s, editor.data.leagueId || teamLeagues[0]?.id)[0]
      : {}),
  });
  const [error, setError] = useState('');
  const [link, setLink] = useState('');
  const change = (key: string) => (value: any) =>
    setD((old: any) => ({
      ...old,
      [key]: value,
      ...(k === 'team' && key === 'leagueId' && !old.id
        ? availableCaps(s, value)[0]
        : {}),
      ...(k === 'fixture' && key === 'leagueId'
        ? {
            teamIds: s.teams
              .filter((t) => !t.withdrawnAt && t.leagueId === value)
              .map((t) => t.id),
            clubId:
              s.clubs.find((c) =>
                s.teams.some(
                  (t) => t.orgId === c.orgId && t.leagueId === value,
                ),
              )?.id || '',
          }
        : {}),
    }));
  const field = (key: string, label: string, options: any = {}) => (
    <Field label={label} value={d[key]} onChange={change(key)} {...options} />
  );
  const pick = (
    key: string,
    label: string,
    options: { id: string; name: string }[],
  ) => (
    <label className="field">
      <span>{label}</span>
      <Pick
        label={label}
        value={d[key]}
        onChange={change(key)}
        options={options.map((o) => ({ value: o.id, label: o.name }))}
      />
    </label>
  );
  const mult = (key: string, options: { id: string; name: string }[]) =>
    options.map((o) => (
      <CheckField
        key={o.id}
        checked={(d[key] || []).includes(o.id)}
        onChange={(checked) =>
          change(key)(
            checked
              ? [...(d[key] || []), o.id]
              : (d[key] || []).filter((v: string) => v !== o.id),
          )
        }
      >
        {o.name}
      </CheckField>
    ));
  const titles: Record<string, string> = {
    league: d.id ? 'League settings' : 'Create a league',
    organisation: 'Add a club organisation',
    club: d.id ? 'Edit club details' : 'Add a hosting venue',
    team: d.id ? 'Edit team' : 'Approve a club team into a league',
    fixture: d.id ? 'Edit fixture' : 'Create a fixture',
    player: d.id ? 'Update child’s details' : 'Register a child',
    invite: 'Invite your league community',
    profile: 'Your contact details',
    member: 'Manage access',
    'create-workspace': 'Create your league workspace',
  };
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (k === 'invite' && tools.demo)
        throw new Error(
          'Invitations are available in your real workspace. Close this window and choose “New workspace” to begin.',
        );
      const result = await act({
        type: k,
        ...d,
        year: Number(d.year),
        holes: Number(d.holes),
        pairs: Number(d.pairs),
        maxStrokes: Number(d.maxStrokes),
      });
      if (result.inviteToken) {
        setLink(
          `${location.origin}/?join=${encodeURIComponent(result.inviteToken)}`,
        );
        return;
      }
      if (k === 'create-workspace') onCreated(result);
      close();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="editor-dialog">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {titles[k] || 'Edit details'}
          </DialogTitle>
          <DialogDescription>
            {k === 'player'
              ? 'Register one child at a time. You can add another child afterwards.'
              : k === 'invite'
                ? 'Create a link to share directly. No message is sent automatically.'
                : 'Keep everyone ready for a great season.'}
          </DialogDescription>
        </DialogHeader>
        {link ? (
          <div className="stack">
            <p>Your invitation is ready. It expires in 14 days.</p>
            <input
              aria-label="Invitation link"
              className="link-input"
              readOnly
              value={link}
            />
            <button
              className="btn primary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  setError('Link copied.');
                } catch {
                  setError('Select the link above and copy it.');
                }
              }}
            >
              <Copy size={16} />
              Copy invitation link
            </button>
            <p role="status">{error}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="stack">
            {[
              'league',
              'organisation',
              'club',
              'team',
              'player',
              'profile',
              'create-workspace',
            ].includes(k) &&
              field(
                'name',
                k === 'player'
                  ? 'Child’s full name'
                  : k === 'profile'
                    ? 'Your full name'
                    : 'Name',
                { required: true },
              )}
            {k === 'league' && (
              <>
                <div className="form-grid">
                  {field('region', 'Region', { required: true })}
                  {field('year', 'Season year', {
                    type: 'number',
                    required: true,
                    min: 2020,
                    max: 2100,
                  })}
                  {field('holes', 'Scoring holes', {
                    type: 'number',
                    min: 1,
                    max: 18,
                  })}
                  {field('pairs', 'Pairs per team', {
                    type: 'number',
                    min: 1,
                    max: 6,
                  })}
                  {field('maxStrokes', 'Maximum strokes per hole', {
                    type: 'number',
                    min: 2,
                    max: 20,
                  })}
                  {pick('tiePolicy', 'Tied fixture positions', [
                    { id: 'countback', name: 'Countback (default)' },
                    {
                      id: 'average',
                      name: 'Average the available league points',
                    },
                    {
                      id: 'shared',
                      name: 'Award equal points for shared place',
                    },
                  ])}
                  {field(
                    'squadSize',
                    'Players per squad (registration target)',
                    { type: 'number', min: 2, max: 60 },
                  )}
                  {pick('adminId', 'League administrator', [
                    { id: '', name: 'Not assigned' },
                    ...s.members
                      .filter((p) => ['admin', 'league-admin'].includes(p.role))
                      .map((p) => ({ id: p.id, name: p.name })),
                  ])}
                  {pick('assistantId', 'League assistant', [
                    { id: '', name: 'Not assigned' },
                    ...s.members
                      .filter(
                        (p) =>
                          ['admin', 'league-admin'].includes(p.role) &&
                          p.id !== d.adminId,
                      )
                      .map((p) => ({ id: p.id, name: p.name })),
                  ])}
                </div>
                <p className="notice">
                  Countback compares combined team points over the last 3 holes,
                  then last 2, then the last hole. An unresolved tie shares the
                  available league points equally. Season ties use cumulative
                  game points. Scoring settings lock when play begins.
                </p>
                <CheckField
                  checked={d.registrationOpen !== false}
                  onChange={change('registrationOpen')}
                >
                  Allow parents to enter children
                </CheckField>
                <p className="muted">
                  Turn off to stop new requests across this league. You can also
                  close registration for individual teams on the overview.
                </p>
              </>
            )}
            {k === 'organisation' && (
              <p className="notice">
                Use one organisation for a club or a group of clubs joining
                forces. Add its individual venues and teams next.
              </p>
            )}
            {['club', 'team', 'player'].includes(k) &&
              pick('orgId', 'Club / joint-club organisation', orgs)}
            {k === 'club' && (
              <>
                {field('website', 'Club website (optional)', {
                  placeholder: 'https://www.yourclub.co.uk',
                  hint: 'We’ll look for a course photo when you save a new website.',
                })}
                <div className="form-grid">
                  {field('county', 'County')}
                  {field('postcode', 'Postcode')}
                </div>
                {field(
                  'address',
                  'Full address and postcode (optional for now)',
                  {
                    large: true,
                  },
                )}
                {field(
                  'instructions',
                  'Parking, directions and visitor instructions',
                  { large: true },
                )}
                <div className="form-grid">
                  {field('welfareName', 'Welfare officer name')}
                  {field('welfareEmail', 'Welfare officer email', {
                    type: 'email',
                  })}
                </div>
                <CheckField
                  checked={!!d.safeGolf}
                  onChange={change('safeGolf')}
                >
                  This club has current SafeGolf accreditation
                </CheckField>
              </>
            )}
            {k === 'team' && (
              <>
                {pick(
                  'leagueId',
                  'League and season',
                  teamLeagues.map((l) => ({
                    ...l,
                    name: `${l.name} · ${l.year}`,
                  })),
                )}
                {!d.id && !leagueHasTeamSpace(s, d.leagueId) && (
                  <p className="error" role="alert">
                    This league is full. Choose a league with space; each league
                    can have at most six teams.
                  </p>
                )}
                <p className="notice">
                  Saving this team confirms Foundation approval for the club to
                  participate in this league. Parents can find the team
                  immediately while season registration is open. Its organiser
                  approves each child's place.
                </p>
                <p>
                  <strong>{d.cap} caps</strong> · Each colour can be used once
                  in this league.
                </p>
                <div className="swatches">
                  {CAP_COLOURS.map(({ cap: name, color }) => (
                    <button
                      key={color}
                      type="button"
                      title={name}
                      aria-label={`${name} cap`}
                      aria-pressed={d.cap === name}
                      disabled={
                        !availableCaps(s, d.leagueId, d.id).some(
                          (c) => c.cap === name,
                        )
                      }
                      style={{ background: color }}
                      onClick={() =>
                        setD((v: any) => ({ ...v, cap: name, color }))
                      }
                      className={d.color === color ? 'selected' : ''}
                    />
                  ))}
                </div>
              </>
            )}
            {k === 'fixture' && (
              <>
                <div className="form-grid">
                  {pick('leagueId', 'League', leagues)}
                  {pick(
                    'clubId',
                    'Hosting venue',
                    s.clubs.filter((c) =>
                      s.teams.some(
                        (t) => t.orgId === c.orgId && t.leagueId === d.leagueId,
                      ),
                    ),
                  )}
                  {field('date', 'Date', { type: 'date', required: true })}
                  {pick('format', 'Start format', [
                    { id: 'shotgun', name: 'Shotgun · starting holes' },
                    { id: 'tee-times', name: 'Tee times' },
                  ])}
                  {field('arrival', 'Arrival time', {
                    type: 'time',
                    required: true,
                  })}
                  {field('start', 'Play starts', {
                    type: 'time',
                    required: true,
                  })}
                </div>
                <CheckField
                  checked={!!d.registration}
                  onChange={change('registration')}
                >
                  Players must register on arrival
                </CheckField>
                <details className="fixture-team-exceptions">
                  <summary>
                    Exceptions ·{' '}
                    {(d.teamIds || []).length ===
                    s.teams.filter(
                      (t) => !t.withdrawnAt && t.leagueId === d.leagueId,
                    ).length
                      ? `All ${(d.teamIds || []).length} league teams included`
                      : `${(d.teamIds || []).length} of ${s.teams.filter((t) => !t.withdrawnAt && t.leagueId === d.leagueId).length} league teams included`}
                  </summary>
                  <p className="muted mt-3">
                    Every league team takes part by default. Only change this if
                    a team will not be taking part in this fixture.
                  </p>
                  <fieldset className="mt-3">
                    <legend>Participating teams</legend>
                    {mult(
                      'teamIds',
                      s.teams.filter(
                        (t) => !t.withdrawnAt && t.leagueId === d.leagueId,
                      ),
                    )}
                  </fieldset>
                </details>
                {field('foodBefore', 'Food before play')}
                {field('foodAfter', 'Food after play')}
                {field('instructions', 'Welcome and matchday instructions', {
                  large: true,
                })}
              </>
            )}
            {k === 'player' && (
              <>
                <GenderField value={d.gender} onChange={change('gender')} />
                <div className="form-grid">
                  {field('dob', 'Date of birth', {
                    type: 'date',
                    required: true,
                  })}
                  {field('handicap', 'Current handicap', {
                    type: 'number',
                    min: -10,
                    max: 54,
                    hint: 'Leave blank if there is no handicap.',
                  })}
                  {field('emergencyName', 'Emergency contact name', {
                    required: true,
                  })}
                  {field('emergencyPhone', 'Emergency contact phone', {
                    type: 'tel',
                    required: true,
                  })}
                </div>
                {field('diet', 'Allergies and dietary requirements', {
                  large: true,
                  hint: 'Write “None” if there are no requirements.',
                })}
                {field(
                  'care',
                  'Safeguarding, medical or additional support information',
                  {
                    large: true,
                    hint: 'Share only what authorised organisers need to support your child.',
                  },
                )}
                <CheckField
                  checked={!!d.photoConsent}
                  onChange={change('photoConsent')}
                >
                  I permit photographs of my child to be published by the
                  participating club / league.
                </CheckField>
                <p className="notice">
                  <ShieldCheck size={17} />
                  An optional identification photo is private and separate from
                  publication consent. Upload it from the child’s card after
                  registration.
                </p>
                <CheckField checked={!!d.consent} onChange={change('consent')}>
                  I have parental responsibility or permission to register this
                  child. I authorise essential information to be shared with my
                  club’s organisers and the relevant match host.
                </CheckField>
              </>
            )}
            {k === 'profile' && (
              <>
                {field('phone', 'Contact phone', { type: 'tel' })}
                <p className="notice">
                  Your name, account email and phone are shared with the people
                  who need to organise your league or support your child.
                </p>
              </>
            )}
            {['invite', 'member'].includes(k) && (
              <>
                {pick('role', 'Role', [
                  ...(me.role === 'admin'
                    ? [
                        { id: 'admin', name: 'Overall Foundation admin' },
                        { id: 'league-admin', name: 'League administrator' },
                      ]
                    : []),
                  ...(me.role !== 'organiser'
                    ? [{ id: 'organiser', name: 'Junior organiser' }]
                    : []),
                  { id: 'parent', name: 'Parent / guardian' },
                ])}
                {k === 'invite' &&
                  field(
                    'email',
                    d.role === 'parent'
                      ? 'Restrict to email (optional)'
                      : 'Recipient email',
                    { type: 'email', required: d.role !== 'parent' },
                  )}
                {d.role === 'league-admin' && (
                  <fieldset>
                    <legend>Assigned leagues</legend>
                    {mult('leagueIds', s.leagues)}
                  </fieldset>
                )}
                {['organiser', 'parent'].includes(d.role) && (
                  <fieldset>
                    <legend>Club organisations</legend>
                    {mult('orgIds', orgs)}
                  </fieldset>
                )}
                <p className="notice">
                  {d.role === 'parent'
                    ? 'Parents can register children for the selected organisations. Unrestricted parent links can be shared with more than one family.'
                    : d.role === 'admin'
                      ? 'Overall administrators can manage all leagues and access private participant information.'
                      : 'Access is limited to the leagues or club organisations selected above.'}
                </p>
              </>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button className="btn" type="button" onClick={close}>
                Cancel
              </button>
              <button
                disabled={
                  busy ||
                  (k === 'team' && !d.id && !leagueHasTeamSpace(s, d.leagueId))
                }
                className="btn primary"
                type="submit"
              >
                {busy
                  ? 'Saving…'
                  : k === 'invite'
                    ? 'Create invitation link'
                    : k === 'player'
                      ? 'Save registration'
                      : k === 'create-workspace'
                        ? 'Create workspace'
                        : k === 'team' && !d.id
                          ? 'Approve & add team'
                          : 'Save changes'}
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
