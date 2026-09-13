import test from 'node:test';
import assert from 'node:assert/strict';
import {
  points,
  blankCard,
  validateCard,
  issues,
  checkDuplicates,
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
  assert.throws(() => validateCard(c), /Resolve/);
  c.pairs[0].writtenPoints[0] = 10;
  c.pairs[0].writtenTotal = 41;
  c.pairs[0].writtenStrokesTotal = 25;
  assert.deepEqual(issues(c), []);
  assert.doesNotThrow(() => validateCard(c));
});
test('all colours roll up to one club; drafts excluded; ties share rank', () => {
  const a = card(1),
    b = card(2),
    draft = card(3);
  a.pairs[0].colour = 'Orange';
  b.pairs[0].colour = 'Black';
  b.pairs[0].club = ' ASHBOURNE ';
  draft.status = 'draft';
  const rows = leaderboard([a, b, draft]);
  assert.equal(rows.length, 3);
  assert.ok(
    rows.every((r) => r.points === 82 && r.pairs === 2 && r.rank === 1),
  );
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
test('duplicate club/pair assignments are rejected across colours and cards', () => {
  const a = card(),
    b = card(2);
  b.pairs[0].club = ' ashbourne ';
  b.pairs[0].pairNumber = 1;
  b.pairs[0].colour = 'Black';
  assert.throws(() => checkDuplicates(b, [a]), /already assigned/);
  assert.doesNotThrow(() => checkDuplicates(a, [a]));
});
test('integer bounds and review check enforced server-side', () => {
  const a = card();
  a.pairs[0].strokes[0] = 11;
  assert.throws(() => validateCard(a), /whole numbers/);
  a.pairs[0].strokes[0] = 1;
  a.reviewed = false;
  assert.throws(() => validateCard(a), /Review/);
});
test('known clubs appear awaiting results without a rank', () => {
  const rows = leaderboard([], { ...DEFAULT_SETTINGS, clubs: ['Ashbourne'] });
  assert.equal(rows[0].rank, null);
  assert.equal(rows[0].pairs, 0);
});

test('drafts retain out-of-range handwriting for review rather than losing the extraction',()=>{const c=card();c.status='draft';c.pairs[0].strokes[0]=12;c.pairs[1].writtenPoints[0]=0;c.pairs[2].writtenTotal=99;const saved=validateCard(c);assert.equal(saved.pairs[0].strokes[0],12);assert.equal(saved.pairs[1].writtenPoints[0],0);assert.equal(issues(saved).length,3);assert.throws(()=>validateCard({...saved,status:'confirmed'}),/whole numbers/);});
