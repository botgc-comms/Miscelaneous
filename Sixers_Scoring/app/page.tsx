'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Flag,
  Trophy,
  Plus,
  Check,
  RefreshCw,
  Download,
  Save,
  ChevronLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { blankCard, points, confirmationProblems } from '../server/scoring.mjs';
type Pair = {
  club: string;
  colour: string;
  players: string;
  pairNumber: number | null;
  strokes: (number | null)[];
  writtenPoints: (number | null)[];
  writtenTotal: number | null;
  writtenStrokesTotal: number | null;
};
type Card = {
  id: string;
  slot: number;
  revision: number;
  status: 'draft' | 'confirmed';
  notes: string;
  reviewed: boolean;
  pairs: Pair[];
  photo?: string | null;
};
type Settings = {
  title: string;
  venue: string;
  date: string;
  expectedCards: number;
  expectedClubs: number;
  pairsPerClub: number;
  clubs: string[];
  revision: number;
};
type Row = {
  club: string;
  pairs: number;
  points: number;
  strokes: number;
  rank: number | null;
};
type State = {
  cards: Card[];
  settings: Settings;
  leaderboard: Row[];
  scannerAvailable: boolean;
};
async function api(url: string, options: RequestInit = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const result: any = await res.json();
  if (!res.ok)
    throw Object.assign(new Error(result.error || 'Request failed.'), {
      data: result,
      status: res.status,
    });
  return result;
}
function num(value: string) {
  return value === '' ? null : Number(value);
}
async function preparePhoto(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type))
    throw new Error(
      'Choose a JPEG, PNG or WebP photo. On iPhone, take a new photo with the camera button.',
    );
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const ratio = Math.min(1, 2400 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * ratio);
    canvas.height = Math.round(img.height * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser could not prepare the photo.');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9);
  } catch {
    throw new Error(
      'This photo format could not be opened. Choose a JPEG/PNG photo or take a new photo.',
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
export default function Home() {
  const [state, setState] = useState<State | null>(null),
    [auth, setAuth] = useState<boolean | null>(null),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [draft, setDraft] = useState<Card | null>(null),
    [dirty, setDirty] = useState(false),
    [settings, setSettings] = useState<Settings | null>(null),
    [clubsText, setClubsText] = useState(''),
    [slot, setSlot] = useState(1),
    [view, setView] = useState<'main' | 'settings'>('main');
  const camera = useRef<HTMLInputElement>(null),
    upload = useRef<HTMLInputElement>(null),
    draftRef = useRef<Card | null>(null);
  draftRef.current = draft;
  async function refresh() {
    const data: State = await api('/api/state');
    setState(data);
    const empty = Array.from(
      { length: data.settings.expectedCards },
      (_, i) => i + 1,
    ).find((n) => !data.cards.some((c) => c.slot === n));
    setSlot(empty ?? data.settings.expectedCards + 1);
    return data;
  }
  useEffect(() => {
    api('/api/session')
      .then(async (s) => {
        setAuth(s.authenticated);
        if (s.authenticated) await refresh();
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!auth) return;
    const timer = setInterval(() => {
      api('/api/state')
        .then(setState)
        .catch(() => {});
    }, 20000);
    return () => clearInterval(timer);
  }, [auth]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, [dirty]);
  useEffect(() => {
    const ctx = (document as any).modelContext;
    if (!ctx?.registerTool) return;
    const lifecycle = new AbortController();
    Promise.resolve(
      ctx.registerTool(
        {
          name: 'read_sixes_standings',
          title: 'Read Golf Sixes standings',
          description:
            'Read confirmed club totals and scorecard progress. Drafts are excluded.',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute: async (input: unknown) => {
            if (
              !input ||
              typeof input !== 'object' ||
              Object.keys(input).length
            )
              throw new Error('No arguments are accepted.');
            const s = await refresh();
            return {
              leaderboard: s.leaderboard,
              confirmedCards: s.cards.filter((c) => c.status === 'confirmed')
                .length,
              expectedCards: s.settings.expectedCards,
            };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
    return () => lifecycle.abort();
  }, []);
  function patchPair(i: number, change: Partial<Pair>) {
    setDraft((d) =>
      d
        ? {
            ...d,
            reviewed: false,
            pairs: d.pairs.map((p, j) => (j === i ? { ...p, ...change } : p)),
          }
        : d,
    );
    setDirty(true);
  }
  function openCard(c: Card) {
    if (dirty && !window.confirm('Discard unsaved edits and open this card?'))
      return;
    setDraft(structuredClone(c));
    setDirty(false);
    setMessage('');
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function run(action: () => Promise<void>, label: string) {
    setError('');
    setMessage('');
    setBusy(label);
    try {
      await action();
    } catch (e: any) {
      setError(e.message);
      if (e.status === 401) setAuth(false);
    } finally {
      setBusy('');
    }
  }
  async function scan(file?: File) {
    if (!file) return;
    await run(async () => {
      const image = await preparePhoto(file);
      try {
        const result = await api('/api/scan', {
          method: 'POST',
          body: JSON.stringify({ image, slot }),
        });
        setDraft(result.card);
        setDirty(false);
        await refresh();
      } catch (e: any) {
        if (e.data?.card) {
          setDraft(e.data.card);
          setDirty(false);
          await refresh();
        }
        throw e;
      }
    }, 'Reading scorecard…');
  }
  async function save(status: 'draft' | 'confirmed') {
    if (!draft) return;
    await run(async () => {
      const { card } = await api(`/api/cards/${draft.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...draft, status, reviewed: status === 'confirmed' }),
      });
      setDraft(card);
      setDirty(false);
      await refresh();
      setMessage(
        status === 'confirmed'
          ? 'Scorecard confirmed. Club totals have been updated.'
          : 'Draft saved. It will count after confirmation.',
      );
    }, 'Saving…');
  }
  const counts = state
    ? {
        confirmed: state.cards.filter((c) => c.status === 'confirmed').length,
        total: state.cards.length,
      }
    : null;
  const problems = draft ? confirmationProblems(draft) : [];
  const canConfirm = draft && !problems.length;
  const knownClubs = state
    ? [
        ...new Set([
          ...state.settings.clubs,
          ...state.cards
            .flatMap((c) => c.pairs.map((p) => p.club))
            .filter(Boolean),
        ]),
      ]
    : [];
  return (
    <main className="app">
      <header>
        <span className="brand">
          <Flag size={22} /> GOLF SIXES
        </span>
        <span className="event-tag">JUNIOR FINAL</span>
      </header>
      {auth === false ? (
        <section className="panel settings">
          <h1>Matchday scoring</h1>
          <p>
            Enter the event password to open the scorecards and leaderboard.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api('/api/login', {
                  method: 'POST',
                  body: JSON.stringify({ password }),
                });
                setAuth(true);
                setPassword('');
                await refresh();
              }, 'Signing in…');
            }}
          >
            <label className="field">
              Event password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <Button type="submit" disabled={!!busy} className="mt-4">
              Open event
            </Button>
          </form>
        </section>
      ) : !state ? (
        <section className="empty">
          <p>Loading your event…</p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </section>
      ) : (
        <>
          <section className="intro">
            <div>
              <p className="eyebrow">MATCHDAY SCORING</p>
              <h1>
                {state.settings.title === 'Junior Golf Sixes Final'
                  ? 'Every shot counts.'
                  : state.settings.title}
              </h1>
              <p>
                {state.settings.venue} · {state.settings.expectedClubs} clubs ·
                6 holes
              </p>
            </div>
            <div className="count">
              <strong>
                {counts?.confirmed}
                <span> / {state.settings.expectedCards}</span>
              </strong>
              <small>cards confirmed</small>
            </div>
          </section>
          {view === 'settings' && settings ? (
            <section className="panel settings">
              <div className="toolbar">
                <h2>Event setup</h2>
                <Button variant="outline" onClick={() => setView('main')}>
                  Back
                </Button>
              </div>
              <label className="field">
                Event title
                <input
                  value={settings.title}
                  onChange={(e) =>
                    setSettings({ ...settings, title: e.target.value })
                  }
                />
              </label>
              <label className="field">
                Venue
                <input
                  value={settings.venue}
                  onChange={(e) =>
                    setSettings({ ...settings, venue: e.target.value })
                  }
                />
              </label>
              <div className="grid">
                {(
                  ['expectedCards', 'expectedClubs', 'pairsPerClub'] as const
                ).map((key, i) => (
                  <label className="field" key={key}>
                    {
                      [
                        'Scorecards expected',
                        'Clubs expected',
                        'Pairs per club',
                      ][i]
                    }
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={settings[key]}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          [key]: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <label className="field">
                Club names — one per line
                <textarea
                  rows={6}
                  value={clubsText}
                  onChange={(e) => setClubsText(e.target.value)}
                  placeholder="Add the six club names to make matching easier"
                />
              </label>
              <p className="muted">
                Colours are kept for identifying pairs. All colours count
                towards their club's total. Tied points share a rank.
              </p>
              <p className="muted">
                Scoring: 1 stroke = 10 points, 2 = 9, through 10 = 1. Scores
                outside 1–10 need clarification before entry.
              </p>
              <Button
                disabled={!!busy}
                onClick={() =>
                  run(async () => {
                    await api('/api/settings', {
                      method: 'PUT',
                      body: JSON.stringify({
                        ...settings,
                        clubs: clubsText.split('\n'),
                      }),
                    });
                    await refresh();
                    setView('main');
                    setMessage('Event setup saved.');
                  }, 'Saving event…')
                }
              >
                Save event setup
              </Button>
            </section>
          ) : draft ? (
            <section className="panel">
              <div className="section-heading">
                <h2>
                  Card {draft.slot}{' '}
                  <span>
                    · {draft.status === 'confirmed' ? 'Confirmed' : 'Draft'}
                  </span>
                </h2>
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (dirty && !window.confirm('Discard unsaved changes?'))
                      return;
                    setDraft(null);
                    setDirty(false);
                    setError('');
                    setMessage('');
                  }}
                >
                  <ChevronLeft size={16} /> Back
                </Button>
              </div>
              <div className="review">
                {draft.photo && draft.status === 'draft' && (
                  <Button
                    variant="outline"
                    className="mb-4"
                    disabled={!!busy || dirty}
                    onClick={() =>
                      run(async () => {
                        const result = await api(
                          `/api/cards/${draft.id}/scan`,
                          {
                            method: 'POST',
                            body: JSON.stringify({ revision: draft.revision }),
                          },
                        );
                        setDraft(result.card);
                        await refresh();
                      }, 'Reading scorecard…')
                    }
                  >
                    Read saved photo again
                  </Button>
                )}
                <p className="muted mb-4">
                  Check the team, players and six strokes, then tap Confirm. Points are calculated automatically.
                </p>
                {draft.photo && (
                  <a href={draft.photo} target="_blank" rel="noreferrer">
                    <img
                      className="photo"
                      src={draft.photo}
                      alt={`Original scorecard ${draft.slot}; tap to enlarge`}
                    />
                  </a>
                )}
                {draft.notes && (
                  <div className="notice">
                    <strong>Reader notes</strong>
                    <p>{draft.notes}</p>
                  </div>
                )}
                <datalist id="clubs">
                  {knownClubs.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                <div className="grid">
                  {draft.pairs.map((pair, i) => (
                    <section className="pair" key={i}>
                      <h3>Team {i + 1}</h3>
                      <div className="field-stack">
                        <label className="field">
                          Club
                          <input
                            list="clubs"
                            value={pair.club}
                            maxLength={100}
                            onChange={(e) =>
                              patchPair(i, { club: e.target.value })
                            }
                            placeholder="Club name"
                          />
                        </label>
                        <label className="field">
                          Team / colour (optional)
                          <input
                            value={pair.colour}
                            maxLength={100}
                            onChange={(e) =>
                              patchPair(i, { colour: e.target.value })
                            }
                            placeholder="e.g. Orange"
                          />
                        </label>
                        <label className="field">
                          Players
                          <input
                            value={pair.players}
                            maxLength={200}
                            onChange={(e) =>
                              patchPair(i, { players: e.target.value })
                            }
                            placeholder="Pair names"
                          />
                        </label>
                      </div>
                      <div className="score-row score-head"><span>Hole</span><span>Strokes</span><span>Points</span></div>
                      {pair.strokes.map((s,h)=>(
                        <div className="score-row" key={h}>
                          <strong>{h+1}</strong>
                          <input aria-label={`Team ${i+1}, hole ${h+1}, strokes`} type="number" inputMode="numeric" min="1" max="10" value={s??''} onChange={e=>patchPair(i,{strokes:pair.strokes.map((v,j)=>h===j?num(e.target.value):v)})}/>
                          <span className="expected">{points(s)??'—'}</span>
                        </div>
                      ))}
                      <div className="pair-total">
                        <span>Calculated points</span>
                        <strong>
                          {pair.strokes.every((s) => points(s) !== null)
                            ? pair.strokes.reduce<number>(
                                (n, s) => n + (points(s) ?? 0),
                                0,
                              )
                            : 'Incomplete'}
                        </strong>
                      </div>
                    </section>
                  ))}
                </div>
                {problems.length > 0 && <div className="notice"><strong>To confirm this card:</strong><ul>{problems.map((problem:string,i:number)=><li key={i}>{problem}</li>)}</ul></div>}
                <p className="muted mt-4 mb-4">Points and totals are calculated from strokes. Tap Confirm to record this card.</p>
                <div className="actions">
                  <Button
                    variant="outline"
                    disabled={!!busy}
                    onClick={() => save('draft')}
                  >
                    <Save size={17} /> Save draft
                  </Button>
                  <Button
                    disabled={!!busy || !canConfirm}
                    onClick={() => save('confirmed')}
                  >
                    <Check size={18} />{' '}
                    {draft.status === 'confirmed'
                      ? 'Update confirmed card'
                      : 'Confirm & update leaderboard'}
                  </Button>
                </div>
                {draft.status === 'confirmed' && (
                  <p className="muted mt-3">
                    Saving as a draft removes this card from club totals until
                    it is confirmed again.
                  </p>
                )}
                {dirty && <p className="muted mt-3">Unsaved changes</p>}
              </div>
            </section>
          ) : (
            <>
              <section className="capture">
                <div>
                  <Camera size={30} />
                  <h2>Record a scorecard</h2>
                  <p>
                    Photograph the whole card, then check the three pairs before
                    saving.
                  </p>
                  <div className="card-picker">
                    <label htmlFor="card-slot">Card number</label>
                    <Select
                      value={String(slot)}
                      onValueChange={(v) => setSlot(Number(v))}
                    >
                      <SelectTrigger
                        id="card-slot"
                        className="min-h-11 bg-white text-green-950 min-w-28"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from(
                          {
                            length: Math.max(
                              state.settings.expectedCards,
                              slot,
                            ),
                          },
                          (_, i) => i + 1,
                        )
                          .filter((n) => !state.cards.some((c) => c.slot === n))
                          .map((n) => (
                            <SelectItem key={n} value={String(n)}>
                              Card {n}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="capture-buttons">
                  <Button
                    disabled={!!busy || !state.scannerAvailable}
                    onClick={() => camera.current?.click()}
                  >
                    <Camera size={18} /> Take photo
                  </Button>
                  <Button
                    disabled={!!busy || !state.scannerAvailable}
                    onClick={() => upload.current?.click()}
                  >
                    Upload photo
                  </Button>
                  <button
                    className="manual"
                    disabled={!!busy}
                    onClick={() => {
                      setDraft(blankCard(slot) as Card);
                      setDirty(true);
                      setError('');
                      setMessage('');
                    }}
                  >
                    <Plus size={16} /> Enter manually
                  </button>
                </div>
                <input
                  ref={camera}
                  className="hidden"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    scan(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <input
                  ref={upload}
                  className="hidden"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                  onChange={(e) => {
                    scan(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </section>
              {!state.scannerAvailable && (
                <div className="notice">
                  Photo reading needs the server's OpenAI key. You can enter and
                  save scores manually now.
                </div>
              )}
              <section className="panel">
                <div className="section-heading">
                  <h2>
                    <Trophy size={21} /> Club leaderboard
                  </h2>
                  <span>
                    {counts?.confirmed === state.settings.expectedCards
                      ? 'All cards confirmed'
                      : 'Provisional standings'}
                  </span>
                </div>
                {state.leaderboard.length ? (
                  state.leaderboard.map((r) => (
                    <div className="club-row" key={r.club}>
                      <span className="rank">{r.rank ?? '—'}</span>
                      <div>
                        <strong>{r.club}</strong>
                        <small>
                          {r.pairs} / {state.settings.pairsPerClub} pairs ·{' '}
                          {r.pairs ? r.strokes + ' strokes' : 'Awaiting scores'}
                        </small>
                      </div>
                      <span className="points">
                        {r.pairs ? r.points : '—'}
                        <small>points</small>
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="empty">
                    <Flag size={32} />
                    <h3>The final starts here</h3>
                    <p>
                      Clubs and standings will appear as you record the cards.
                    </p>
                  </div>
                )}
                <p className="muted px-6 py-4">
                  All team colours combined by club. Most points leads; tied
                  totals share a rank.
                </p>
              </section>
              <section className="panel">
                <div className="section-heading">
                  <h2>Scorecards</h2>
                  <span>{counts?.total} received</span>
                </div>
                {state.cards.length ? (
                  state.cards.map((c) => (
                    <div className="card-row" key={c.id}>
                      <div>
                        <strong>Card {c.slot}</strong>
                        <p className="muted">
                          {c.pairs
                            .map((p) =>
                              [p.club || 'Unassigned', p.colour]
                                .filter(Boolean)
                                .join(' '),
                            )
                            .join(' · ')}
                        </p>
                        <span className={`badge ${c.status}`}>
                          {c.status === 'confirmed'
                            ? 'Confirmed'
                            : 'Needs review'}
                        </span>
                      </div>
                      <Button
                        variant="outline"
                        disabled={!!busy}
                        onClick={() => openCard(c)}
                      >
                        Edit
                      </Button>
                    </div>
                  ))
                ) : (
                  <p className="empty">No scorecards received yet.</p>
                )}
              </section>
              <div className="toolbar">
                <Button
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => {
                    setSettings(structuredClone(state.settings));
                    setClubsText(state.settings.clubs.join('\n'));
                    setView('settings');
                  }}
                >
                  Event setup
                </Button>
                <div className="actions">
                  <Button
                    variant="ghost"
                    disabled={!!busy}
                    onClick={() =>
                      run(async () => {
                        await refresh();
                        setMessage('Standings refreshed.');
                      }, 'Refreshing…')
                    }
                    aria-label="Refresh standings"
                  >
                    <RefreshCw size={18} />
                  </Button>
                  <a className="download" href="/api/export">
                    <Download size={17} /> Backup
                  </a>
                </div>
              </div>
              <p className="footnote">
                Updated every 20 seconds. Only confirmed cards count.
              </p>
            </>
          )}
        </>
      )}
      {busy && (
        <div className="notice status" role="status">
          <span className="spinner" />
          {busy}
          {busy.startsWith('Reading') && (
            <p className="muted">
              Keep this page open. Handwriting can take a minute to read.
            </p>
          )}
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="notice success" role="status">
          {message}
        </div>
      )}
    </main>
  );
}
