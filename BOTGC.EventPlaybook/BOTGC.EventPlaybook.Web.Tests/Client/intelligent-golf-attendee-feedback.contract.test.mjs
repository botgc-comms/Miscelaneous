import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook-app.js', import.meta.url),
  'utf8');
const indexSource = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/index.html', import.meta.url),
  'utf8');

test('the retrospective offers booking-derived feedback email only with Intelligent Golf enabled', () => {
  assert.match(source, /pluginCapabilities\.intelligentGolfEnabled[\s\S]*data-action="email-feedback-attendees"/);
  assert.match(source, /records current ticket bookers, not physical check-in/);
  assert.match(source, /one email will be sent to each active member booker/i);
});

test('sending feedback previews fresh bookings and requires explicit confirmation', () => {
  assert.match(source, /ticket-bookings\?refresh=true/);
  assert.match(source, /memberMatched === true/);
  assert.match(source, /window\.confirm\(`Send the anonymous feedback form/);
  assert.match(source, /confirmed-attendees\/email\?resend=/);
});

test('the booking-feedback release is cache-busted', () => {
  assert.match(indexSource, /playbook\.css\?v=20260923-event-ideas-1/);
  assert.match(indexSource, /playbook-app\.js\?v=20260923-event-ideas-1/);
});
