import test from 'node:test';
import assert from 'node:assert/strict';
import {
  points,
  pairSummary,
  blankCard,
  validateCard,
  issues,
  confirmationProblems,
  leaderboard,
  DEFAULT_SETTINGS,
} from '../server/scoring.mjs';
function card(slot = 1) {
  const c = blankCard(slot);
  c.status = 'confirmed';
  c.reviewed = true;
  c.pairs.forEach((p, i) => {
    p.club = ['Ashbourne', 'Chevin', 'Burton'][i];
    p.pairNumber = slot;
    p.strokes = [1, 2, 3, 4, 5, 10];
  });
  return c;
}
test('printed rule maps every legal stroke value and rejects blanks/out of range', () => {
  for (let s = 1; s <= 10; s++) assert.equal(points(s), 11 - s);
  for (const s of [null, 0, 11, -1, 1.5, '3']) assert.equal(points(s), null);
});
test('blank cards cannot become confirmed or manufacture points', () => {
  const c = blankCard();
  assert.equal(leaderboard([c]).length, 0);
  assert.throws(
    () => validateCard({ ...c, status: 'confirmed', reviewed: true }),
    /Every pair/,
  );
  assert.equal(validateCard(c).pairs[0].strokes[0], null);
});
test('written points and both total columns are independently checked', () => {
  const c = card();
  c.pairs[0].writtenPoints[0] = 9;
  c.pairs[0].writtenTotal = 60;
  c.pairs[0].writtenStrokesTotal = 60;
  assert.equal(issues(c).length, 3);
  assert.doesNotThrow(() => validateCard(c));
  c.pairs[0].writtenPoints[0] = 10;
  c.pairs[0].writtenTotal = 41;
  c.pairs[0].writtenStrokesTotal = 25;
  assert.deepEqual(issues(c), []);
  assert.doesNotThrow(() => validateCard(c));
});
test('Chevin Green and Chevin Black remain separate; matching team labels combine', () => {
  const a = card(1),
    b = card(2),
    draft = card(3);
  a.pairs.forEach((p) => (p.colour = 'Green'));
  b.pairs.forEach((p) => (p.colour = 'Green'));
  draft.pairs.forEach((p) => (p.colour = 'Green'));
  a.pairs[1].club = 'Chevin';
  b.pairs[1].club = ' CHEVIN ';
  b.pairs[1].colour = 'Black';
  draft.status = 'draft';
  const rows = leaderboard([a, b, draft]);
  assert.equal(rows.length, 4);
  const chevin = rows.filter((r) => r.club.trim().toLowerCase() === 'chevin');
  assert.equal(chevin.length, 2);
  assert.deepEqual(
    chevin.map((r) => r.points),
    [41, 41],
  );
  assert.deepEqual(
    chevin.map((r) => r.rank),
    [3, 3],
  );
  assert.equal(rows.find((r) => r.club === 'Ashbourne').points, 82);
  b.pairs[1].colour = ' GREEN ';
  assert.equal(
    leaderboard([a, b]).filter((r) => r.club === 'Chevin').length,
    1,
  );
});
test('unlabelled teams never silently roll up by club', () => {
  const c = card();
  c.pairs.forEach((p) => {
    p.club = 'Chevin';
    p.colour = '';
  });
  assert.equal(leaderboard([c]).length, 3);
  assert.ok(leaderboard([c]).every((r) => r.points === 41));
});
test('gross strokes determine points, while paper discrepancies remain visible', () => {
  const p = card().pairs[0];
  let total = pairSummary(p);
  assert.equal(total.gross, 25);
  assert.equal(total.points, 41);
  assert.equal(66 - total.gross, total.points);
  p.writtenPoints[0] = 9;
  p.writtenTotal = 50;
  p.writtenStrokesTotal = 30;
  total = pairSummary(p);
  assert.equal(total.warnings.length, 3);
  assert.equal(total.points, 41);
  assert.match(total.warnings[0], /1 strokes = 10 points/);
  p.strokes[0] = null;
  assert.equal(pairSummary(p).complete, false);
  assert.equal(pairSummary(p).points, null);
});
test('editing replaces scores instead of appending and changes ranking', () => {
  const a = card();
  let rows = leaderboard([a]);
  assert.equal(rows[0].points, 41);
  a.pairs[0].strokes = Array(6).fill(1);
  rows = leaderboard([a]);
  assert.equal(rows[0].club, 'Ashbourne');
  assert.equal(rows[0].points, 60);
  assert.equal(rows[1].rank, 2);
  assert.equal(rows[2].rank, 2);
});
test('scanned scores confirm without pair numbers, written scores or a checkbox', () => {
  const c = card();
  c.reviewed = false;
  c.pairs.forEach((p) => {
    p.pairNumber = null;
    p.writtenPoints = Array(6).fill(99);
    p.writtenTotal = 999;
    p.writtenStrokesTotal = 999;
  });
  assert.deepEqual(confirmationProblems(c), []);
  const saved = validateCard(c);
  assert.equal(saved.reviewed, true);
  assert.equal(leaderboard([saved])[0].points, 41);
  c.pairs.forEach((p) => {
    delete p.writtenPoints;
    delete p.writtenTotal;
    delete p.writtenStrokesTotal;
  });
  assert.doesNotThrow(() => validateCard(c));
});
test('confirmation explains the exact missing club and hole', () => {
  const c = card();
  c.pairs[1].club = '';
  c.pairs[2].strokes[3] = null;
  assert.deepEqual(confirmationProblems(c), [
    'Team 2: enter the club.',
    'Team 3: enter strokes from 1 to 10 for hole 4.',
  ]);
});
test('integer bounds enforced server-side', () => {
  const a = card();
  a.pairs[0].strokes[0] = 11;
  assert.throws(() => validateCard(a), /whole numbers/);
  a.pairs[0].strokes[0] = 1;
  a.reviewed = false;
  assert.equal(validateCard(a).reviewed, true);
});
test('club setup does not create fake team standings', () => {
  assert.deepEqual(
    leaderboard([], { ...DEFAULT_SETTINGS, clubs: ['Chevin'] }),
    [],
  );
});

test('drafts retain out-of-range handwriting for review rather than losing the extraction', () => {
  const c = card();
  c.status = 'draft';
  c.pairs[0].strokes[0] = 12;
  c.pairs[1].writtenPoints[0] = 0;
  c.pairs[2].writtenTotal = 99;
  const saved = validateCard(c);
  assert.equal(saved.pairs[0].strokes[0], 12);
  assert.equal(saved.pairs[1].writtenPoints[0], 0);
  assert.equal(issues(saved).length, 3);
  assert.throws(
    () => validateCard({ ...saved, status: 'confirmed' }),
    /whole numbers/,
  );
});
