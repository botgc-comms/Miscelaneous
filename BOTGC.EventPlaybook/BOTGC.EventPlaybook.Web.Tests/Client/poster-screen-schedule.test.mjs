import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const modulePath = new URL('../../BOTGC.EventPlaybook.Web/wwwroot/poster-screen-schedule.js', import.meta.url);
const source = await readFile(modulePath, 'utf8');
const schedule = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const { defaultScreenStartDate, oneCalendarMonthBeforeIso } = schedule;

test('screen artwork defaults to one calendar month before the event', () => {
    assert.equal(defaultScreenStartDate('2026-12-25', '2026-10-26'), '2026-11-25');
});

test('calendar month subtraction clamps to the final valid day', () => {
    assert.equal(oneCalendarMonthBeforeIso('2027-03-31'), '2027-02-28');
    assert.equal(oneCalendarMonthBeforeIso('2028-03-31'), '2028-02-29');
    assert.equal(oneCalendarMonthBeforeIso('2027-01-31'), '2026-12-31');
});

test('an event less than one month away starts showing today', () => {
    assert.equal(defaultScreenStartDate('2026-11-10', '2026-10-26'), '2026-10-26');
});

test('a past event keeps its event date as the safe fallback', () => {
    assert.equal(defaultScreenStartDate('2026-10-20', '2026-10-26'), '2026-10-20');
});
