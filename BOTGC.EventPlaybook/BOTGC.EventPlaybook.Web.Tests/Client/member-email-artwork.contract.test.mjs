import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const programSource = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/Program.cs', import.meta.url),
  'utf8');

test('member email drafts always stage artwork at the public email-artwork endpoint', () => {
  const endpointStart = programSource.indexOf('app.MapPost("/api/poster/member-email/draft"');
  const endpointEnd = programSource.indexOf('app.MapPost("/api/poster/member-email/cancellation-draft"', endpointStart);
  assert.ok(endpointStart >= 0 && endpointEnd > endpointStart);
  const endpoint = programSource.slice(endpointStart, endpointEnd);

  assert.match(endpoint, /ResolveStoredPosterArtworkBytesAsync/);
  assert.match(endpoint, /artworkStore\.SaveAsync\(draft\.EventId, artworkBytes/);
  assert.match(endpoint, /\/api\/poster\/member-email\/artwork\/\{artworkToken\}/);
  assert.doesNotMatch(endpoint, /ResolveStoredPosterArtworkUrlAsync/);
});

test('the public email artwork route remains available without the Playbook session', () => {
  assert.match(programSource, /path\.StartsWithSegments\("\/api\/poster\/member-email\/artwork"\)/);
  assert.match(programSource, /app\.MapGet\("\/api\/poster\/member-email\/artwork\/\{token\}"/);
});
