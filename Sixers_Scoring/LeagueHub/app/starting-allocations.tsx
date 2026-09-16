'use client';
import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, WandSparkles } from 'lucide-react';
import { canHost, type Fixture, type Slot } from '@/lib/model';
import {
  makeStartingSlot,
  startingPairsKey,
  startingSlotLabel,
  suggestStartingAllocations,
  validateStartSettings,
  type StartSettings,
} from '@/lib/starting-allocations';
import { Field, Pick, type AppTools } from './widgets';
import { ChildName } from './child-avatar';
import { Cap } from './parent-portal';

function parseHoles(value: string) {
  return value.split(',').flatMap((part) => {
    const range = part.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (!range) return [Number(part.trim())];
    const start = Number(range[1]),
      end = Number(range[2]);
    return start > 0 && end <= 36 && end >= start
      ? Array.from({ length: end - start + 1 }, (_, i) => start + i)
      : [NaN];
  });
}
export function StartingSlots({ f, tools }: { f: Fixture; tools: AppTools }) {
  const { s, me, busy, act } = tools;
  const allowed = canHost(s, me, f) && f.status === 'scheduled';
  const defaults: StartSettings = f.startSettings || {
    format: f.format,
    holes:
      f.format === 'shotgun'
        ? Array.from(
            { length: s.leagues.find((l) => l.id === f.leagueId)!.holes },
            (_, i) => i + 1,
          )
        : [f.slots[0]?.startHole || 1],
    firstTime: f.start,
    intervalMinutes: 10,
    capacity: Math.max(3, ...f.slots.map((v) => v.capacity)),
  };
  const [format, setFormat] = useState(defaults.format);
  const [holes, setHoles] = useState(
    (defaults.format === 'shotgun'
      ? defaults.holes
      : Array.from(
          { length: s.leagues.find((l) => l.id === f.leagueId)!.holes },
          (_, i) => i + 1,
        )
    ).join(', '),
  );
  const [teeHole, setTeeHole] = useState(String(defaults.holes[0]));
  const [firstTime, setFirstTime] = useState(defaults.firstTime);
  const [interval, setInterval] = useState(String(defaults.intervalMinutes));
  const [capacity, setCapacity] = useState(String(defaults.capacity));
  const settingsKey = JSON.stringify([
    format,
    holes,
    teeHole,
    firstTime,
    interval,
    capacity,
  ]);
  const [preparedFor, setPreparedFor] = useState(settingsKey);
  const changed = settingsKey !== preparedFor;
  const [slots, setSlots] = useState<Slot[]>(() =>
    f.slots.map((slot) => ({
      ...slot,
      capacity: allowed ? defaults.capacity : slot.capacity,
      startHole:
        slot.startHole || Number(slot.label.match(/hole\s+(\d+)/i)?.[1]) || 1,
      startTime:
        slot.startTime || slot.label.match(/\b\d{2}:\d{2}\b/)?.[0] || f.start,
    })),
  );
  const [assign, setAssign] = useState<Record<string, string>>(() =>
    Object.fromEntries(f.pairs.map((p) => [p.id, p.slotId])),
  );
  const [pairsKey, setPairsKey] = useState(() => startingPairsKey(f));
  const [error, setError] = useState('');
  const errorBox = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error)
      errorBox.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [error]);
  const [note, setNote] = useState('');
  const unassigned = f.pairs.filter(
    (p) => !slots.some((slot) => slot.id === assign[p.id]),
  );
  const settings = () =>
    validateStartSettings({
      format,
      holes: format === 'shotgun' ? parseHoles(holes) : [Number(teeHole)],
      firstTime,
      intervalMinutes: Number(interval),
      capacity: Number(capacity),
    });
  const changeSlot = (id: string, patch: Partial<Slot>) =>
    setSlots((old) =>
      old.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)),
    );
  const generate = () => {
    try {
      const result = suggestStartingAllocations(f, s.teams, settings());
      setSlots(result.slots);
      setAssign(result.assignments);
      setPreparedFor(settingsKey);
      setPairsKey(startingPairsKey(f));
      setError('');
      setNote(
        result.repeatedClub
          ? 'Some pairs from the same club share a group because of the available team mix. You can review and move pairs below.'
          : '',
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="stack starting-allocations">
      {allowed && (
        <section className="card start-settings">
          <header>
            <h2>Starting order</h2>
            <p className="muted">
              Choose how play will start, then build the groups.
            </p>
          </header>
          <fieldset className="start-format">
            <legend>Start format</legend>
            <div>
              <button
                type="button"
                aria-pressed={format === 'shotgun'}
                onClick={() => setFormat('shotgun')}
              >
                Shotgun start
              </button>
              <button
                type="button"
                aria-pressed={format === 'tee-times'}
                onClick={() => setFormat('tee-times')}
              >
                Tee times
              </button>
            </div>
          </fieldset>
          <div className="start-settings-grid">
            {format === 'shotgun' ? (
              <Field
                label="Starting holes"
                value={holes}
                onChange={setHoles}
                hint="Enter a range such as 1-6, or a list such as 1, 3, 5, 7. One group per hole."
              />
            ) : (
              <Field
                label="Starting hole"
                type="number"
                min={1}
                max={36}
                value={teeHole}
                onChange={setTeeHole}
              />
            )}
            <Field
              label={
                format === 'shotgun' ? 'Shotgun start time' : 'First tee time'
              }
              type="time"
              value={firstTime}
              onChange={setFirstTime}
            />
            {format === 'tee-times' && (
              <Field
                label="Minutes between tee times"
                type="number"
                min={1}
                max={60}
                value={interval}
                onChange={setInterval}
              />
            )}
            <Field
              label="Pairs per starting slot"
              type="number"
              min={2}
              max={6}
              value={capacity}
              onChange={setCapacity}
              hint="The same maximum applies to every group."
            />
          </div>
          <footer>
            <div>
              <strong>{f.pairs.length} pairs to allocate</strong>
              <p className="muted">
                Fill each group where possible, keep at least two pairs together
                and mix clubs and teams.
              </p>
            </div>
            <button className="btn primary" disabled={busy} onClick={generate}>
              <WandSparkles size={17} />
              Suggest allocations
            </button>
          </footer>
          {changed && (
            <p className="notice">
              Settings changed. Suggest allocations again to rebuild the slots
              before saving.
            </p>
          )}
          {error && (
            <p ref={errorBox} role="alert" className="error">
              {error}
            </p>
          )}
        </section>
      )}
      <div className="section-top">
        <div>
          <h2>
            {(allowed ? format : f.format) === 'shotgun'
              ? 'Starting holes'
              : 'Tee times'}
          </h2>
          <p className="muted mt-2">
            {slots.length} starting {slots.length === 1 ? 'group' : 'groups'} ·{' '}
            {f.pairs.length - unassigned.length} of {f.pairs.length} pairs
            allocated{allowed ? ' · Save below when ready.' : ''}
          </p>
        </div>
      </div>
      {note && <p className="notice">{note}</p>}
      {!slots.length && (
        <p className="notice">
          {allowed
            ? 'Use Suggest allocations above once the teams have chosen their pairs.'
            : 'The host has not saved any starting slots yet.'}
        </p>
      )}
      <div className="slot-grid">
        {slots.map((slot, i) => {
          const pairs = f.pairs.filter((p) => assign[p.id] === slot.id);
          return (
            <section
              className="card start-slot"
              key={slot.id}
              aria-label={`Starting group ${i + 1}`}
            >
              <header>
                <strong>Group {i + 1}</strong>
                <span className="muted">
                  {pairs.length} / {slot.capacity} pairs
                </span>
                {allowed && (
                  <button
                    className="icon-btn"
                    aria-label={`Remove starting group ${i + 1}`}
                    onClick={() => {
                      setSlots((old) => old.filter((v) => v.id !== slot.id));
                      setError('');
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </header>
              {allowed ? (
                <div className="start-slot-fields">
                  <Field
                    label="Starting hole"
                    type="number"
                    min={1}
                    max={36}
                    value={slot.startHole || 1}
                    onChange={(v) =>
                      changeSlot(slot.id, { startHole: Number(v) })
                    }
                  />
                  {format === 'tee-times' && (
                    <Field
                      label="Tee time"
                      type="time"
                      value={slot.startTime || firstTime}
                      onChange={(v) => changeSlot(slot.id, { startTime: v })}
                    />
                  )}
                </div>
              ) : (
                <h3>{startingSlotLabel(slot, f.format)}</h3>
              )}
              {pairs.map((p) => {
                const team = s.teams.find((t) => t.id === p.teamId);
                return (
                  <div className="slot-pair" key={p.id}>
                    <div className="start-pair-team">
                      {team && (
                        <Cap
                          color={team.color}
                          label={`${team.cap} caps`}
                          size={24}
                        />
                      )}
                      <strong>{team?.name || 'Team'}</strong>
                    </div>
                    <div className="start-pair-children">
                      {p.players.map((id) => {
                        const player = s.players.find((v) => v.id === id);
                        return player ? (
                          <ChildName
                            key={id}
                            player={player}
                            workspace={tools.workspace}
                            view={tools.view}
                            size={28}
                          />
                        ) : (
                          <span key={id}>Player</span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {pairs.length === 1 && (
                <p className="start-slot-warning">
                  Add another pair so they do not play alone.
                </p>
              )}
              {pairs.length > slot.capacity && (
                <p className="start-slot-warning">
                  Move a pair to another group: this slot is full.
                </p>
              )}
              {!pairs.length && (
                <p className="muted mt-3">
                  Move pairs here using the list below.
                </p>
              )}
            </section>
          );
        })}
      </div>
      {allowed && (
        <>
          <button
            className="btn self-start"
            disabled={changed || busy}
            onClick={() => {
              try {
                const value = settings();
                let slot = makeStartingSlot(value, slots.length);
                if (format === 'shotgun') {
                  const hole = value.holes.find(
                    (h) => !slots.some((v) => v.startHole === h),
                  );
                  if (!hole)
                    throw new Error(
                      'Add another starting hole in the settings before creating another group.',
                    );
                  slot = { ...slot, startHole: hole };
                } else if (slots.some((v) => v.startTime === slot.startTime))
                  throw new Error(
                    'That tee time is already in use. Adjust the existing slots or suggest allocations again.',
                  );
                setSlots((old) => [...old, slot]);
                setError('');
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <Plus size={16} />
            Add starting slot
          </button>
          {!!f.pairs.length && (
            <details
              className="card start-moves"
              open={unassigned.length > 0 ? true : undefined}
            >
              <summary>
                {unassigned.length
                  ? `${unassigned.length} pairs need a starting slot`
                  : 'Move pairs between slots'}
              </summary>
              <p className="muted">
                Choose a different group for any pair. Keep at least two pairs
                in each occupied group.
              </p>
              {f.pairs.map((p) => (
                <div className="allocation" key={p.id}>
                  <div>
                    <strong>
                      {s.teams.find((t) => t.id === p.teamId)?.name}
                    </strong>
                    <p className="muted">
                      {p.players
                        .map(
                          (id) =>
                            s.players.find((v) => v.id === id)?.name ||
                            'Player',
                        )
                        .join(' & ')}
                    </p>
                  </div>
                  <Pick
                    label={`Starting slot for ${s.teams.find((t) => t.id === p.teamId)?.name} pair ${f.pairs.filter((v) => v.teamId === p.teamId).findIndex((v) => v.id === p.id) + 1}`}
                    value={assign[p.id] || ''}
                    onChange={(v) => {
                      setAssign((old) => ({ ...old, [p.id]: v }));
                      setError('');
                    }}
                    options={[
                      { value: '', label: 'Not allocated' },
                      ...slots.map((v, i) => ({
                        value: v.id,
                        label: `Group ${i + 1} · ${startingSlotLabel(v, format)}`,
                      })),
                    ]}
                  />
                </div>
              ))}
            </details>
          )}
          {!!slots.length && (
            <div className="start-save">
              <p className="muted">
                Saving shares the starting details with the teams and families.
              </p>
              <button
                className="btn primary"
                disabled={busy || changed}
                onClick={async () => {
                  try {
                    const value = settings();
                    await act({
                      type: 'slots',
                      fixtureId: f.id,
                      settings: value,
                      expectedPairsKey: pairsKey,
                      slots: slots.map((slot) => ({
                        ...slot,
                        capacity: value.capacity,
                        startTime:
                          format === 'shotgun'
                            ? value.firstTime
                            : slot.startTime,
                        label: startingSlotLabel(slot, format),
                      })),
                      assignments: assign,
                    });
                    setError('');
                    setNote('Starting details saved and shared.');
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Save starting slots
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
