import test from 'node:test';
import assert from 'node:assert/strict';
import {
  leagueAwards,
  leagueLeaderboard,
  leaderboard,
  blankCard,
  validateSettings,
  DEFAULT_SETTINGS,
} from '../server/scoring.mjs';
const match = (totals) =>
  totals.map((points, i) => ({ key: String(i), points, pairs: 1 }));
test('league awards are 6 through 1 and first-place tie gets 5.5 each', () => {
  assert.deepEqual(
    [...leagueAwards(match([60, 59, 58, 57, 56, 55])).values()],
    [6, 5, 4, 3, 2, 1],
  );
  assert.deepEqual(
    [...leagueAwards(match([60, 60, 58, 57, 56, 55])).values()],
    [5.5, 5.5, 4, 3, 2, 1],
  );
});
test('three-way ties and lower ties share all occupied positions, conserving 21 points', () => {
  const result = [...leagueAwards(match([60, 60, 60, 57, 56, 56])).values()];
  assert.deepEqual(result, [5, 5, 5, 3, 1.5, 1.5]);
  assert.equal(
    result.reduce((a, b) => a + b, 0),
    21,
  );
  assert.deepEqual(
    [...leagueAwards(match([10, 10, 10, 10, 10, 10])).values()],
    Array(6).fill(3.5),
  );
});
test('draft teams do not take league places; below sixth is zero', () => {
  const rows = match([7, 6, 5, 4, 3, 2, 1]);
  rows.unshift({ key: 'draft', points: 99, pairs: 0 });
  const awards = leagueAwards(rows);
  assert.equal(awards.has('draft'), false);
  assert.equal(awards.get('6'), 0);
});
function fixture() {
  const c = blankCard();
  c.status = 'confirmed';
  c.pairs.forEach((p, i) => {
    p.club = ['Burton', 'Chevin', 'Chevin'][i];
    p.colour = ['', 'Navy', 'Green'][i];
    p.strokes = Array(6).fill(i + 1);
  });
  return c;
}
const settings = {
  ...DEFAULT_SETTINGS,
  expectedCards: 1,
  leagueStandings: [
    { club: 'Burton', colour: '', startingPoints: 32.5 },
    { club: 'Chevin', colour: 'Navy', startingPoints: 30.5 },
    { club: 'Chevin', colour: 'Green', startingPoints: 22 },
  ],
};
test('starting scores plus today are derived once; card edits recalculate without double counting', () => {
  const c = fixture();
  let board = leagueLeaderboard([c], settings);
  assert.equal(board.rows[0].total, 38.5);
  assert.equal(board.provisional, false);
  assert.equal(board.startingComplete, true);
  assert.deepEqual(leagueLeaderboard([c], settings), board);
  c.pairs[0].strokes = Array(6).fill(10);
  board = leagueLeaderboard([c], settings);
  assert.equal(board.rows.find((r) => r.club === 'Burton').total, 36.5);
  assert.equal(board.rows.find((r) => r.colour === 'Navy').today, 6);
  c.status = 'draft';
  board = leagueLeaderboard([c], settings);
  assert.equal(board.provisional, true);
  assert.equal(board.rows.find((r) => r.club === 'Burton').total, 32.5);
});
test('unknown starting points remain unknown, zero is a valid supplied starting score', () => {
  const c = fixture();
  const board = leagueLeaderboard([c], { ...settings, leagueStandings: [] });
  assert.equal(board.startingComplete, false);
  assert.ok(board.rows.every((r) => r.total === null && r.rank === null));
  const zero = leagueLeaderboard([], {
    ...settings,
    leagueStandings: [{ club: 'Other', colour: '', startingPoints: 0 }],
  });
  assert.equal(zero.rows[0].total, 0);
});
test('official single-team clubs combine their three pairs without combining Chevin colours', () => {
  const a = fixture(),
    b = fixture();
  b.id = 'second';
  b.pairs[0].colour = 'Red';
  const rows = leaderboard([a, b], settings);
  assert.equal(rows.length, 3);
  assert.equal(rows.find((r) => r.team === 'Burton').pairs, 2);
  assert.equal(rows.filter((r) => r.club === 'Chevin').length, 2);
});
test('invalid and duplicate league baselines are rejected; half-points retained', () => {
  assert.equal(
    validateSettings(settings).leagueStandings[0].startingPoints,
    32.5,
  );
  assert.throws(
    () =>
      validateSettings({
        ...settings,
        leagueStandings: [
          ...settings.leagueStandings,
          settings.leagueStandings[0],
        ],
      }),
    /twice/,
  );
  for (const startingPoints of [-1, '32.5', Infinity])
    assert.throws(
      () =>
        validateSettings({
          ...settings,
          leagueStandings: [{ club: 'Test', colour: '', startingPoints }],
        }),
      /non-negative/,
    );
});
