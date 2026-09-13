import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { readScorecard } from '../server/scan.mjs';
import assert from 'node:assert/strict';
const file = process.argv[2];
const result = await readScorecard(
  'data:image/jpeg;base64,' + readFileSync(file).toString('base64'),
  [],
  process.env.OPENAI_API_KEY,
  process.env.OPENAI_MODEL || 'gpt-5.6-terra',
);
assert.equal(result.pairs.length, 3);
assert.match(result.pairs[0].club, /ashbourne/i);
assert.match(result.pairs[1].club, /ashbourne/i);
assert.match(result.pairs[2].club, /chevin/i);
assert.match(result.pairs[0].colour, /orange/i);
assert.match(result.pairs[1].colour, /black/i);
assert.ok(
  result.pairs.every(
    (p) =>
      p.strokes.length === 6 &&
      p.strokes.every((s) => s === null) &&
      p.writtenPoints.every((s) => s === null),
  ),
);
mkdirSync('outputs', { recursive: true });
writeFileSync(
  'outputs/sample-extraction.json',
  JSON.stringify(result, null, 2),
);
console.log(
  'Live photo extraction passed: three club/colour entries, all blank scores preserved.',
);
