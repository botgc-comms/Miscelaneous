import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook-app.js', import.meta.url),
  'utf8');
const indexSource = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/index.html', import.meta.url),
  'utf8');
const cssSource = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook.css', import.meta.url),
  'utf8');

test('the retrospective loads a visible ticket total and the current booking identities', () => {
  assert.match(source, /renderTicketBookings\(event\)/);
  assert.match(source, /ensureTicketBookingsLoaded\(event\.id\)/);
  assert.match(source, /ticket-bookings\?refresh=\$\{force \? 'true' : 'false'\}/);
  assert.match(source, /<strong>\$\{ticketCount\}<\/strong><span>ticket/);
  assert.match(source, /View who booked/);
  assert.match(source, /booking\?\.bookerName/);
  assert.match(source, /booking\.bookerMemberNumber/);
  assert.doesNotMatch(source, /ticket-booking-row[\s\S]{0,1200}bookerEmail/);
});

test('the booking evidence can be refreshed and remains usable on small screens', () => {
  assert.match(source, /data-action="refresh-ticket-bookings"/);
  assert.match(source, /ensureTicketBookingsLoaded\(event\.id, true\)/);
  assert.match(cssSource, /\.booking-summary-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,/s);
  assert.match(cssSource, /@media \(max-width: 760px\)[\s\S]*\.ticket-booking-row\s*\{[^}]*grid-template-columns:\s*1fr;/);
});

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
  assert.match(indexSource, /playbook\.css\?v=20260930-shared-rich-text-editor-1/);
  assert.match(indexSource, /playbook-app\.js\?v=20260930-shared-rich-text-editor-1/);
});
