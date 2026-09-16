'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Plus,
  RefreshCw,
  Trash2,
  ArrowLeftRight,
  GripVertical,
} from 'lucide-react';
import { Field, dateLabel, type AppTools } from './widgets';
import {
  availableHostingDates,
  fixtureChoiceKey,
  hostingClubs,
  planningKey,
  reviewFixtureDraft,
  sortFixtureDraft,
  type FixturePlanSettings,
  type PlannedFixture,
  type suggestFixtures,
} from '@/lib/season-planning';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

type Proposal = ReturnType<typeof suggestFixtures> & {
  key: string;
  visibleKey: string;
};
export function FixturePlanEditor({
  tools,
  leagueId,
  settings,
  initial,
  onClose,
  onCreated,
}: {
  tools: AppTools;
  leagueId: string;
  settings: FixturePlanSettings;
  initial: Proposal;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { s } = tools;
  const league = s.leagues.find((l) => l.id === leagueId)!;
  const clubs = hostingClubs(s, leagueId);
  const [draft, setDraft] = useState(initial.fixtures);
  const [variant, setVariant] = useState(0);
  const [replace, setReplace] = useState<string | null>(null);
  const [showDates, setShowDates] = useState(false);
  const datesHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (showDates) datesHeading.current?.focus();
  }, [showDates, replace]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [arrival, setArrival] = useState('13:30');
  const [start, setStart] = useState('14:00');
  const stale = initial.visibleKey !== planningKey(s, leagueId);
  const review = reviewFixtureDraft(s, leagueId, settings, draft);
  const dates = availableHostingDates(s, leagueId, settings);
  const clubName = (id: string) =>
    clubs.find((c) => c.id === id)?.name || 'Club';
  const candidateDraft = (f: PlannedFixture, replacing: string | null) =>
    sortFixtureDraft([
      ...draft.filter((d) => fixtureChoiceKey(d) !== replacing),
      f,
    ]);
  const reason = (f: PlannedFixture, replacing: string | null) =>
    reviewFixtureDraft(s, leagueId, settings, candidateDraft(f, replacing))
      .errors[0];
  function choose(f: PlannedFixture, replacing: string | null) {
    if (working || stale) return;
    const problem = reason(f, replacing);
    if (problem) {
      setError(problem);
      return;
    }
    setDraft(candidateDraft(f, replacing));
    setReplace(null);
    setError('');
    setMessage(
      `${replacing ? 'Replaced with' : 'Added'} ${clubName(f.clubId)}, ${dateLabel(f.date)}.`,
    );
  }
  function drop(e: React.DragEvent, replacing: string | null) {
    e.preventDefault();
    e.stopPropagation();
    // Accept only a key for an offered date from this draft's date tray.
    const f = dates.find(
      (d) => fixtureChoiceKey(d) === e.dataTransfer.getData('text/plain'),
    );
    if (f) choose(f, replacing);
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !working && onClose()}>
      <DialogContent
        className="editor-dialog fixture-plan-review fixture-draft-editor"
        initialFocus={false}
      >
        <DialogHeader>
          <DialogTitle>Review suggested fixtures</DialogTitle>
          <DialogDescription>
            {league.name} · {league.year}. Edit this draft before creating your
            fixtures.
          </DialogDescription>
        </DialogHeader>
        <div className="fixture-draft-toolbar">
          <div>
            <h3>
              {draft.length} fixture{draft.length === 1 ? '' : 's'} in your
              draft
            </h3>
            <p>Target: {settings.count} · Nothing created yet</p>
          </div>
          <button
            className="btn small"
            disabled={working || stale}
            onClick={async () => {
              setWorking(true);
              setError('');
              try {
                const result = await tools.act({
                  type: 'fixture-plan-suggest',
                  leagueId,
                  planningKey: initial.key,
                  variant: variant + 1,
                  previous: draft,
                });
                const next = result.fixtureProposal
                  .fixtures as PlannedFixture[];
                const same =
                  JSON.stringify(next) ===
                  JSON.stringify(sortFixtureDraft(draft));
                setDraft(next);
                setVariant(variant + 1);
                setReplace(null);
                setMessage(
                  same
                    ? 'No different suggestion found with these dates and hosting limits. You can still edit the draft below.'
                    : 'Another suggestion is ready. Your previous draft has been replaced.',
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setWorking(false);
              }
            }}
          >
            <RefreshCw size={16} />
            {working ? 'Working…' : 'Try another suggestion'}
          </button>
        </div>
        <div className="fixture-draft-counts">
          {clubs.map((c) => {
            const count = draft.filter((f) => f.clubId === c.id).length;
            const capacity =
              s.hostingOffers?.find(
                (o) => o.leagueId === leagueId && o.clubId === c.id,
              )?.capacity || 0;
            return (
              <span key={c.id}>
                {c.name}{' '}
                <strong>
                  {count}/{capacity}
                </strong>
              </span>
            );
          })}
        </div>
        <div className="fixture-draft-columns">
          <section
            aria-label="Draft fixtures"
            className="fixture-draft-schedule"
          >
            <div className="fixture-plan-list">
              {draft.map((f, i) => {
                const key = fixtureChoiceKey(f);
                const offer = s.hostingOffers?.find(
                  (o) => o.clubId === f.clubId && o.leagueId === leagueId,
                );
                return (
                  <div
                    key={key}
                    className={`fixture-draft-row ${replace === key ? 'is-replacing' : ''}`}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => drop(e, key)}
                  >
                    <span className="fixture-plan-number">{i + 1}</span>
                    <div className="fixture-draft-info">
                      <strong>{dateLabel(f.date)}</strong>
                      <span>{clubName(f.clubId)}</span>
                      <small>
                        {offer?.shotgun === 'yes'
                          ? 'Shotgun start'
                          : 'Tee times'}
                        {offer?.food === 'yes' ? ' · Food planned' : ''}
                        {review.presentationConfirmed && i === draft.length - 1
                          ? ' · Presentation evening'
                          : ''}
                      </small>
                    </div>
                    <div className="fixture-draft-row-actions">
                      <button
                        className="btn small"
                        disabled={working || stale}
                        aria-label={`Replace ${clubName(f.clubId)} on ${dateLabel(f.date)}`}
                        onClick={() => {
                          setReplace(key);
                          setShowDates(true);
                          setError('');
                        }}
                      >
                        <ArrowLeftRight size={16} />
                        <span>Replace</span>
                      </button>
                      <button
                        className="btn small icon-btn"
                        disabled={working || stale}
                        aria-label={`Remove ${clubName(f.clubId)} on ${dateLabel(f.date)}`}
                        onClick={() => {
                          setDraft(
                            draft.filter((d) => fixtureChoiceKey(d) !== key),
                          );
                          setReplace(null);
                          setError('');
                          setMessage(
                            'Fixture removed from this draft. Its date is available to add again.',
                          );
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              className="fixture-draft-dropzone"
              disabled={working || stale}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => drop(e, null)}
              onClick={() => {
                setReplace(null);
                setShowDates(true);
              }}
            >
              <Plus size={18} />
              Add an offered date <span>or drag one here</span>
            </button>
          </section>
          {showDates && (
            <aside
              className="fixture-draft-dates"
              aria-label="Other offered dates"
            >
              <div className="fixture-draft-dates-heading">
                <h3 ref={datesHeading} tabIndex={-1}>
                  {replace ? 'Choose a replacement' : 'Other offered dates'}
                </h3>
                <button
                  className="btn small"
                  onClick={() => {
                    setShowDates(false);
                    setReplace(null);
                  }}
                >
                  Done
                </button>
              </div>
              <p>
                {replace
                  ? 'Choose a date below or drop it onto a fixture to replace it.'
                  : 'Add a date, or drag it onto a fixture to replace it.'}
              </p>
              {dates
                .filter(
                  (f) =>
                    !draft.some(
                      (d) => fixtureChoiceKey(d) === fixtureChoiceKey(f),
                    ),
                )
                .map((f) => {
                  const problem = reason(f, replace);
                  return (
                    <div
                      key={fixtureChoiceKey(f)}
                      className="fixture-draft-option"
                      draggable={!working && !stale}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(
                          'text/plain',
                          fixtureChoiceKey(f),
                        );
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                    >
                      <GripVertical size={16} aria-hidden="true" />
                      <div>
                        <strong>{dateLabel(f.date)}</strong>
                        <span>{clubName(f.clubId)}</span>
                        {problem && <small>{problem}</small>}
                      </div>
                      <button
                        className="btn small"
                        disabled={!!problem || working || stale}
                        title={problem}
                        aria-label={`${replace ? 'Use' : 'Add'} ${clubName(f.clubId)} on ${dateLabel(f.date)}`}
                        onClick={() => choose(f, replace)}
                      >
                        {replace ? 'Use date' : 'Add'}
                      </button>
                    </div>
                  );
                })}
              {!dates.some(
                (f) =>
                  !draft.some(
                    (d) => fixtureChoiceKey(d) === fixtureChoiceKey(f),
                  ),
              ) && <p>All offered dates are already in this draft.</p>}
            </aside>
          )}
        </div>
        {message && (
          <p role="status" className="setup-hint">
            {message}
          </p>
        )}
        {review.warnings.map((w) => (
          <p className="notice" key={w}>
            {w}
          </p>
        ))}
        {review.errors.map((w) => (
          <p className="error" key={w}>
            {w}
          </p>
        ))}
        {draft.length > 0 && (
          <div className="form-grid">
            <Field
              label="Provisional arrival time"
              type="time"
              value={arrival}
              onChange={setArrival}
              required
            />
            <Field
              label="Provisional start time"
              type="time"
              value={start}
              onChange={setStart}
              required
            />
          </div>
        )}
        {stale && (
          <p className="error" role="alert">
            Hosting information changed. Close this draft and suggest the list
            again.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="btn" disabled={working} onClick={onClose}>
            Back to planning
          </button>
          <button
            className="btn primary"
            disabled={
              working ||
              tools.busy ||
              stale ||
              !draft.length ||
              !!review.errors.length
            }
            onClick={async () => {
              setWorking(true);
              setError('');
              try {
                await tools.act({
                  type: 'fixture-plan-apply',
                  leagueId,
                  planningKey: initial.key,
                  fixtures: draft,
                  arrival,
                  start,
                });
                onCreated();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setWorking(false);
              }
            }}
          >
            {working
              ? 'Working…'
              : `Create ${draft.length} fixture${draft.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
