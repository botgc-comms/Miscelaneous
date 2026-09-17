'use client';
import { useState, useRef } from 'react';
import {
  Search,
  Check,
  Phone,
  Printer,
  ArrowLeft,
  ClipboardCheck,
} from 'lucide-react';
import { type AppTools, dateLabel } from './widgets';
import { type Fixture, type Player } from '@/lib/model';
import {
  deskPlayers,
  deskSuggestions,
  deskKey,
  deskFieldsKey,
  registrationTickets,
  type DeskField,
  type DeskSuggestion,
} from '@/lib/registration-desk';
import { Cap } from './parent-portal';
import { SupportCentre } from './support-centre';

export function HostMatchday({
  tools,
  fixtures,
  openFixture,
}: {
  tools: AppTools;
  fixtures: Fixture[];
  openFixture: (id: string) => void;
}) {
  const [id, setId] = useState(fixtures[0].id);
  const f = fixtures.find((f) => f.id === id) || fixtures[0];
  return (
    <>
      <header className="page-heading">
        <div>
          <span className="eyebrow">YOU’RE HOSTING TODAY</span>
          <h1>{tools.s.clubs.find((c) => c.id === f.clubId)?.name}</h1>
          <p>
            {dateLabel(f.date)} · Arrive {f.arrival} · Start {f.start}
          </p>
        </div>
        <button className="btn" onClick={() => openFixture(f.id)}>
          Manage fixture & live scores
        </button>
      </header>
      {fixtures.length > 1 && (
        <div className="row wrap mb-4">
          {fixtures.map((v) => (
            <button
              key={v.id}
              className="btn"
              aria-pressed={v.id === f.id}
              onClick={() => setId(v.id)}
            >
              {v.name}
            </button>
          ))}
        </div>
      )}
      <RegistrationDesk key={f.id} tools={tools} f={f} />
    </>
  );
}
export function RegistrationDesk({
  tools,
  f,
}: {
  tools: AppTools;
  f: Fixture;
}) {
  const { s, busy, act } = tools;
  const changesPanel = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [selected, setSelected] = useState(''),
    [error, setError] = useState(''),
    [incident, setIncident] = useState(false),
    [proposal, setProposal] = useState<DeskSuggestion | null>(null),
    [agreed, setAgreed] = useState(false);
  const [proposalKey, setProposalKey] = useState('');
  const [fields, setFields] = useState<DeskField[]>(f.desk?.fields || []),
    [fieldsKey, setFieldsKey] = useState(deskFieldsKey(f.desk?.fields || []));
  const people = deskPlayers(s, f),
    entry = (id: string) => f.desk?.entries.find((e) => e.playerId === id),
    pair = (id: string) => f.pairs.find((p) => p.players.includes(id));
  const team = (id: string) =>
    s.teams.find(
      (t) =>
        t.id ===
        (pair(id)?.teamId ||
          s.reserves?.find((r) => r.fixtureId === f.id && r.playerId === id)
            ?.teamId),
    ) ||
    s.teams.find(
      (t) =>
        t.orgId === s.players.find((p) => p.id === id)?.orgId &&
        f.teamIds.includes(t.id),
    );
  const status = (id: string) => entry(id)?.status || 'expected';
  const suggestions = deskSuggestions(s, f);
  const filtered = people.filter(
    (p) =>
      (filter === 'all' || status(p.id) === filter) &&
      `${p.name} ${team(p.id)?.name || ''} ${s.orgs.find((o) => o.id === team(p.id)?.orgId)?.name || ''}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  async function run(action: Record<string, unknown>) {
    setError('');
    try {
      await act({ ...action, type: String(action.type), fixtureId: f.id });
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }
  function choose(id: string) {
    setSelected(id);
    if (window.innerWidth <= 760)
      requestAnimationFrame(() =>
        document
          .getElementById('registration-child')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      );
  }
  function print(id?: string) {
    const url = URL.createObjectURL(
      new Blob([registrationTickets(s, f, id)], { type: 'text/html' }),
    );
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function update(id: string, changes: Record<string, unknown>) {
    return run({
      type: 'desk-entry',
      playerId: id,
      expectedVersion: entry(id)?.version || 0,
      ...changes,
    });
  }
  if (incident)
    return (
      <>
        <button
          className="text-link row mb-4"
          onClick={() => setIncident(false)}
        >
          <ArrowLeft size={16} />
          Back to registration
        </button>
        <SupportCentre tools={tools} fixture={f} />
      </>
    );
  const child = people.find((p) => p.id === selected);
  return (
    <div className="registration-desk">
      <div className="desk-heading">
        <div>
          <h2>
            <ClipboardCheck size={23} />
            Registration desk
          </h2>
          <p>
            Find a child, share their starting details and mark them as arrived.
          </p>
        </div>
        <div className="row wrap">
          <button
            className="btn"
            onClick={() => print()}
            disabled={!f.pairs.some((p) => p.players.length)}
          >
            <Printer size={16} />
            Print player tickets
          </button>
          <button className="btn" onClick={() => setIncident(true)}>
            Record an incident
          </button>
        </div>
      </div>
      <div className="desk-counts" aria-live="polite">
        <strong>
          {people.filter((p) => status(p.id) === 'arrived').length}
          <span>Arrived</span>
        </strong>
        <strong>
          {people.filter((p) => status(p.id) === 'expected').length}
          <span>Not here yet</span>
        </strong>
        <strong>
          {people.filter((p) => status(p.id) === 'absent').length}
          <span>Not coming</span>
        </strong>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {f.pairs.some((p) => p.players.length < 2) && (
        <div className="notice">
          <strong>A playing place has opened up.</strong>
          <p>
            Review the remaining players and starting groups before sending them
            out.
          </p>
          <button
            className="btn"
            onClick={() => {
              if (changesPanel.current) {
                changesPanel.current.open = true;
                changesPanel.current.scrollIntoView({
                  behavior: 'smooth',
                  block: 'start',
                });
              }
            }}
          >
            Review last-minute changes
          </button>
        </div>
      )}
      <div className="desk-layout">
        <section className="card desk-search">
          <label htmlFor="desk-search">
            <Search size={18} />
            Find a child or club
          </label>
          <input
            id="desk-search"
            autoComplete="off"
            placeholder="Start typing a first name, surname or club…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="desk-filters">
            {[
              ['all', 'Everyone'],
              ['expected', 'Not here yet'],
              ['arrived', 'Arrived'],
              ['absent', 'Not coming'],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="desk-people">
            {filtered.map((p) => (
              <div
                className={`desk-person ${selected === p.id ? 'selected' : ''}`}
                key={p.id}
              >
                <button
                  className="desk-person-name"
                  onClick={() => choose(p.id)}
                >
                  <strong className="row">
                    {team(p.id) && (
                      <Cap
                        color={team(p.id)!.color}
                        size={22}
                        label={team(p.id)!.cap + ' caps'}
                      />
                    )}{' '}
                    {p.name}
                  </strong>
                  <span>
                    {s.orgs.find((o) => o.id === team(p.id)?.orgId)?.name ||
                      'Club not assigned'}{' '}
                    · {team(p.id)?.name} ·{' '}
                    {pair(p.id) ? 'Playing' : 'Reserve / awaiting allocation'}
                  </span>
                  {entry(p.id)?.note && (
                    <small>Registration note — please read</small>
                  )}
                </button>
                {status(p.id) === 'expected' ? (
                  <button
                    className="btn primary"
                    disabled={busy}
                    onClick={() => {
                      choose(p.id);
                      if (!f.desk?.fields.length)
                        void update(p.id, { status: 'arrived' });
                    }}
                  >
                    Check in
                  </button>
                ) : (
                  <span
                    className={`badge ${status(p.id) === 'arrived' ? 'green' : ''}`}
                  >
                    {status(p.id) === 'arrived' ? 'Arrived' : 'Not coming'}
                  </span>
                )}
              </div>
            ))}
            {!filtered.length && (
              <p className="desk-empty">No children match this search.</p>
            )}
          </div>
        </section>
        <section className="card desk-detail" id="registration-child">
          {child ? (
            <ChildRegistration
              key={`${child.id}:${entry(child.id)?.version || 0}`}
              child={child}
              tools={tools}
              f={f}
              update={(changes) => update(child.id, changes)}
              print={() => print(child.id)}
            />
          ) : (
            <div className="desk-empty">
              <ClipboardCheck size={32} />
              <h3>Ready for arrivals</h3>
              <p>
                Select a child to see their playing partner, starting hole,
                contact details and registration questions.
              </p>
            </div>
          )}
        </section>
      </div>
      <details className="card desk-extra" ref={changesPanel}>
        <summary>
          Last-minute changes{suggestions.length ? ' · review suggestions' : ''}
        </summary>
        <p>
          Mark a child as “Not coming” in their registration card. Review
          replacements below and agree any changes with the children and their
          organiser.
        </p>
        {f.pairs
          .filter((p) => p.players.length < 2)
          .map((p) => (
            <p key={p.id} className="notice">
              {s.teams.find((t) => t.id === p.teamId)?.name}:{' '}
              {p.players.length === 0
                ? 'empty scorecard — needs a player'
                : 'one player on this scorecard'}
              .
            </p>
          ))}
        {f.slots
          .filter(
            (slot) =>
              f.pairs.filter((p) => p.slotId === slot.id && p.players.length)
                .length === 1,
          )
          .map((slot) => (
            <p key={slot.id} className="notice">
              {slot.label}: only one pair or individual — arrange another pair
              for card marking.
            </p>
          ))}
        {!suggestions.length && (
          <p>
            No automatic changes to suggest. Use Team selection and Starting
            allocations to review the line-up with the organisers.
          </p>
        )}
        <div className="desk-suggestions">
          {suggestions.map((v, i) => (
            <div key={i}>
              <strong>{v.label}</strong>
              <p>{v.detail}</p>
              <div className="row wrap">
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    setProposal(v);
                    setProposalKey(deskKey(s, f));
                    setAgreed(false);
                  }}
                >
                  Review change
                </button>
                {v.kind === 'split' && v.playerId && (
                  <button
                    className="text-link"
                    disabled={busy}
                    onClick={() =>
                      void update(v.playerId!, {
                        note: `${entry(v.playerId!)?.note || ''}\nAsk whether they would be happy to play individually. Discuss with their partner and organiser before changing the line-up.`.trim(),
                      })
                    }
                  >
                    Add prompt for registration
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {proposal && (
          <div className="desk-review">
            <h3>{proposal.label}</h3>
            <p>{proposal.detail}</p>
            <p>
              Families and team organisers will receive an update. The affected
              children will have a note at registration to explain the change
              and replace their ticket.
            </p>
            <label className="row">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              I have agreed this with the players and their organiser.
            </label>
            <div className="row wrap">
              <button
                className="btn primary"
                disabled={busy || !agreed}
                onClick={async () => {
                  if (
                    await run({
                      type: 'desk-repair',
                      ...proposal,
                      expectedKey: proposalKey,
                      agreed,
                    })
                  )
                    setProposal(null);
                }}
              >
                Apply agreed change
              </button>
              <button className="btn" onClick={() => setProposal(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </details>
      <details className="card desk-extra">
        <summary>Registration questions & meal choices</summary>
        <p>
          Optional. Add choices for your event, such as meal preferences. Leave
          this empty if you don’t need any. Questions with recorded answers
          cannot be changed.
        </p>
        {fields.map((field, index) => (
          <div className="desk-question" key={field.id}>
            <label>
              Question
              <input
                value={field.label}
                onChange={(e) =>
                  setFields(
                    fields.map((v, i) =>
                      i === index ? { ...v, label: e.target.value } : v,
                    ),
                  )
                }
              />
            </label>
            <label>
              Choices — one per line
              <textarea
                value={field.options.join('\n')}
                onChange={(e) =>
                  setFields(
                    fields.map((v, i) =>
                      i === index
                        ? { ...v, options: e.target.value.split('\n') }
                        : v,
                    ),
                  )
                }
              />
            </label>
            <label className="row">
              <input
                type="checkbox"
                checked={field.multiple}
                onChange={(e) =>
                  setFields(
                    fields.map((v, i) =>
                      i === index ? { ...v, multiple: e.target.checked } : v,
                    ),
                  )
                }
              />
              Allow more than one choice
            </label>
            <button
              className="text-link"
              onClick={() => setFields(fields.filter((_, i) => i !== index))}
            >
              Remove question
            </button>
          </div>
        ))}
        <div className="row wrap">
          <button
            className="btn"
            onClick={() =>
              setFields([
                ...fields,
                {
                  id: crypto.randomUUID(),
                  label: '',
                  options: [],
                  multiple: false,
                },
              ])
            }
          >
            Add a question
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              const clean = fields.map((v) => ({
                ...v,
                options: v.options.map((o) => o.trim()).filter(Boolean),
              }));
              if (
                await run({
                  type: 'desk-fields',
                  fields: clean,
                  expectedKey: fieldsKey,
                })
              ) {
                setFields(clean);
                setFieldsKey(deskFieldsKey(clean));
              }
            }}
          >
            Save questions
          </button>
        </div>
        {(f.desk?.fields || []).map((field) => (
          <div key={field.id} className="desk-tally">
            <h3>{field.label} — arrived children</h3>
            {field.options.map((option) => (
              <span key={option}>
                {option}:{' '}
                <strong>
                  {f.desk?.entries.filter(
                    (e) =>
                      e.status === 'arrived' &&
                      e.answers[field.id]?.includes(option),
                  ).length || 0}
                </strong>
              </span>
            ))}
          </div>
        ))}
      </details>
    </div>
  );
}
function ChildRegistration({
  child,
  tools,
  f,
  update,
  print,
}: {
  child: Player;
  tools: AppTools;
  f: Fixture;
  update: (v: Record<string, unknown>) => Promise<boolean>;
  print: () => void;
}) {
  const { s, busy } = tools,
    e = f.desk?.entries.find((e) => e.playerId === child.id),
    pair = f.pairs.find((p) => p.players.includes(child.id)),
    slot = f.slots.find((v) => v.id === pair?.slotId),
    parent = s.members.find((m) => m.id === child.parentId);
  const [answers, setAnswers] = useState(e?.answers || {}),
    [note, setNote] = useState(e?.note || ''),
    [withdraw, setWithdraw] = useState(false);
  const peers = f.pairs
    .filter((p) => p.slotId && p.slotId === pair?.slotId && p.id !== pair?.id)
    .flatMap((p) =>
      p.players.map((id) => s.players.find((v) => v.id === id)?.name),
    );
  return (
    <>
      <div className="desk-child-title">
        <span className="eyebrow">
          {e?.status === 'arrived'
            ? 'CHECKED IN'
            : e?.status === 'absent'
              ? 'NOT COMING'
              : 'REGISTRATION'}
        </span>
        <h2>{child.name}</h2>
      </div>
      {e?.note && <p className="notice desk-note">{e.note}</p>}
      {pair ? (
        <>
          <div className="desk-start">
            <div>
              <span>Starting hole</span>
              <strong>{slot?.startHole || 'TBC'}</strong>
            </div>
            <div>
              <span>
                {f.format === 'shotgun' ? 'Shotgun start' : 'Tee time'}
              </span>
              <strong>{slot?.startTime || f.start}</strong>
            </div>
          </div>
          <p>
            <strong>Playing with</strong>
            <br />
            {pair.players
              .filter((id) => id !== child.id)
              .map((id) => s.players.find((p) => p.id === id)?.name)
              .join(', ') || 'Playing individually'}
          </p>
          {!!peers.length && (
            <p>
              <strong>Also in their starting group</strong>
              <br />
              {peers.join(', ')}
            </p>
          )}
        </>
      ) : (
        <p className="notice">
          No playing place allocated. Check the line-up before sending this
          child out.
        </p>
      )}
      <div className="desk-contacts">
        {parent?.phone && (
          <a
            className="btn"
            href={`tel:${parent.phone.replace(/[^+\d]/g, '')}`}
          >
            <Phone size={16} />
            Call {parent.name}
          </a>
        )}
        {child.emergencyPhone && child.emergencyPhone !== parent?.phone && (
          <a
            className="btn"
            href={`tel:${child.emergencyPhone.replace(/[^+\d]/g, '')}`}
          >
            <Phone size={16} />
            Call {child.emergencyName || 'emergency contact'}
          </a>
        )}
        {!parent?.phone && !child.emergencyPhone && (
          <p>No contact number recorded. Contact the child’s team organiser.</p>
        )}
      </div>
      {(f.desk?.fields || []).map((field) => (
        <fieldset className="desk-answers" key={field.id}>
          <legend>{field.label}</legend>
          {field.options.map((option) => (
            <label key={option}>
              <input
                type={field.multiple ? 'checkbox' : 'radio'}
                name={field.id}
                checked={answers[field.id]?.includes(option) || false}
                onChange={(ev) =>
                  setAnswers({
                    ...answers,
                    [field.id]: field.multiple
                      ? ev.target.checked
                        ? [...(answers[field.id] || []), option]
                        : (answers[field.id] || []).filter((v) => v !== option)
                      : [option],
                  })
                }
              />
              {option}
            </label>
          ))}
        </fieldset>
      ))}
      <label className="desk-note-input">
        Note for registration
        <textarea
          value={note}
          onChange={(ev) => setNote(ev.target.value)}
          placeholder="Anything to discuss when this child arrives"
        />
      </label>
      <div className="row wrap">
        <button
          className="btn primary"
          disabled={busy}
          onClick={() => void update({ status: 'arrived', answers, note })}
        >
          <Check size={17} />
          {e?.status === 'arrived'
            ? 'Save registration changes'
            : 'Mark arrived'}
        </button>
        {e?.status !== 'arrived' && (
          <button
            className="btn"
            disabled={busy}
            onClick={() => void update({ answers, note })}
          >
            Save note & choices
          </button>
        )}
        {pair && (
          <button className="btn" onClick={print}>
            <Printer size={16} />
            Player ticket
          </button>
        )}
      </div>
      <div className="desk-secondary">
        {e?.status === 'arrived' && (
          <button
            className="text-link"
            disabled={busy}
            onClick={() => void update({ status: 'expected' })}
          >
            Undo check-in
          </button>
        )}
        {e?.status !== 'absent' && (
          <button className="text-link" onClick={() => setWithdraw(true)}>
            Not coming
          </button>
        )}
      </div>
      {withdraw && (
        <div className="desk-review">
          <strong>Mark {child.name} as not coming?</strong>
          <p>
            They will be removed from their pair. Their family and team
            organiser will be notified. Review the replacement suggestions
            afterwards.
          </p>
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              if (await update({ status: 'absent', answers, note }))
                setWithdraw(false);
            }}
          >
            Confirm withdrawal
          </button>{' '}
          <button className="btn" onClick={() => setWithdraw(false)}>
            Cancel
          </button>
        </div>
      )}
    </>
  );
}
