import {
  requireThat,
  type Fixture,
  type Pair,
  type Slot,
  type Team,
} from './model';

export type StartSettings = {
  format: 'shotgun' | 'tee-times';
  holes: number[];
  firstTime: string;
  intervalMinutes: number;
  capacity: number;
};
export function validateStartSettings(value: any): StartSettings {
  requireThat(
    value && ['shotgun', 'tee-times'].includes(value.format),
    'Choose shotgun or tee times.',
  );
  requireThat(
    Array.isArray(value.holes) &&
      value.holes.length > 0 &&
      value.holes.length <= 36 &&
      value.holes.every((n: any) => Number.isInteger(n) && n >= 1 && n <= 36) &&
      new Set(value.holes).size === value.holes.length,
    'Enter different starting holes between 1 and 36.',
  );
  requireThat(
    value.format !== 'tee-times' || value.holes.length === 1,
    'Choose one starting hole for tee times.',
  );
  requireThat(
    typeof value.firstTime === 'string' &&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(value.firstTime),
    'Enter a valid start time.',
  );
  requireThat(
    Number.isInteger(value.intervalMinutes) &&
      value.intervalMinutes >= 1 &&
      value.intervalMinutes <= 60,
    'Use a tee-time interval between 1 and 60 minutes.',
  );
  requireThat(
    Number.isInteger(value.capacity) &&
      value.capacity >= 2 &&
      value.capacity <= 6,
    'Choose between 2 and 6 pairs per starting slot.',
  );
  return {
    format: value.format,
    holes: [...value.holes],
    firstTime: value.firstTime,
    intervalMinutes: value.intervalMinutes,
    capacity: value.capacity,
  };
}
export function startingPairsKey(f: Fixture) {
  return JSON.stringify(
    f.pairs
      .map((p) => [p.id, p.teamId, [...p.players].sort()])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
}
export function startingSlotLabel(slot: Slot, format: StartSettings['format']) {
  return format === 'shotgun'
    ? `Hole ${slot.startHole}`
    : `${slot.startTime} · Hole ${slot.startHole}`;
}
export function makeStartingSlot(settings: StartSettings, index: number): Slot {
  const [h, m] = settings.firstTime.split(':').map(Number);
  const minutes =
    h * 60 +
    m +
    (settings.format === 'tee-times' ? index * settings.intervalMinutes : 0);
  requireThat(
    minutes < 24 * 60,
    'These tee times run into the next day. Use an earlier start or a shorter interval.',
  );
  const startHole =
    settings.format === 'shotgun' ? settings.holes[index] : settings.holes[0];
  requireThat(
    !!startHole,
    'There are more groups than starting holes. Add more holes or increase pairs per slot.',
  );
  const slot = {
    id: crypto.randomUUID(),
    label: '',
    capacity: settings.capacity,
    startHole,
    startTime: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
  };
  slot.label = startingSlotLabel(slot, settings.format);
  return slot;
}
export function suggestStartingAllocations(
  f: Fixture,
  teams: Team[],
  input: StartSettings,
) {
  const settings = validateStartSettings(input);
  const pairs = f.pairs;
  requireThat(
    pairs.length >= 2,
    'At least two pairs are needed so nobody plays alone.',
  );
  requireThat(
    pairs.every((p) => p.players.length === 2),
    'Choose both children in each pair before suggesting starting slots.',
  );
  const count = Math.ceil(pairs.length / settings.capacity);
  requireThat(
    count * 2 <= pairs.length,
    `${pairs.length} pairs cannot fill groups of two without leaving a pair alone. Increase pairs per slot to 3 or more.`,
  );
  requireThat(count <= 50, 'This fixture needs more than 50 starting slots.');
  requireThat(
    settings.format !== 'shotgun' || settings.holes.length >= count,
    `${count} groups need ${count} different starting holes. Add more starting holes or increase pairs per slot.`,
  );
  const sizes = Array.from({ length: count }, (_, i) =>
    Math.min(settings.capacity, pairs.length - i * settings.capacity),
  );
  if (sizes.at(-1) === 1) {
    sizes[sizes.length - 2]--;
    sizes[sizes.length - 1]++;
  }
  const org = (p: Pair) =>
    teams.find((t) => t.id === p.teamId)?.orgId || p.teamId;
  const cost = (group: Pair[]) =>
    group.reduce(
      (sum, a, i) =>
        sum +
        group
          .slice(i + 1)
          .reduce(
            (n, b) =>
              n +
              (a.teamId === b.teamId ? 1000 : 0) +
              (org(a) === org(b) ? 10 : 0),
            0,
          ),
      0,
    );
  const ordered = [...pairs].sort(
    (a, b) =>
      pairs.filter((p) => org(p) === org(b)).length -
        pairs.filter((p) => org(p) === org(a)).length ||
      pairs.filter((p) => p.teamId === b.teamId).length -
        pairs.filter((p) => p.teamId === a.teamId).length ||
      a.teamId.localeCompare(b.teamId) ||
      a.id.localeCompare(b.id),
  );
  const groups: Pair[][] = sizes.map(() => []);
  for (const pair of ordered) {
    const choices = groups
      .map((group, i) => ({
        i,
        score: cost([...group, pair]) - cost(group),
        fill: group.length / sizes[i],
      }))
      .filter((v) => groups[v.i].length < sizes[v.i])
      .sort((a, b) => a.score - b.score || a.fill - b.fill || a.i - b.i);
    groups[choices[0].i].push(pair);
  }
  // Improve the complete allocation without changing group sizes or leaving lone pairs.
  for (let pass = 0; pass < 100; pass++) {
    let improved = false;
    for (let a = 0; a < groups.length; a++)
      for (let b = a + 1; b < groups.length; b++) {
        for (let i = 0; i < groups[a].length; i++)
          for (let j = 0; j < groups[b].length; j++) {
            const before = cost(groups[a]) + cost(groups[b]);
            [groups[a][i], groups[b][j]] = [groups[b][j], groups[a][i]];
            if (cost(groups[a]) + cost(groups[b]) < before) improved = true;
            else [groups[a][i], groups[b][j]] = [groups[b][j], groups[a][i]];
          }
      }
    if (!improved) break;
  }
  const slots = groups.map((_, i) => makeStartingSlot(settings, i));
  const assignments = Object.fromEntries(
    groups.flatMap((group, i) => group.map((p) => [p.id, slots[i].id])),
  );
  return {
    slots,
    assignments,
    repeatedClub: groups.some(
      (group) => new Set(group.map(org)).size < group.length,
    ),
  };
}
