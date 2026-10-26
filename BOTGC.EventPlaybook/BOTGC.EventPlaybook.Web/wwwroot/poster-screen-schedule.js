function parseIsoDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return { year, month, day };
}

function toIsoDate(year, month, day) {
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function oneCalendarMonthBeforeIso(value) {
    const parsed = parseIsoDate(value);
    if (!parsed) return '';

    const zeroBasedTargetMonth = parsed.month - 2;
    const targetYear = parsed.year + Math.floor(zeroBasedTargetMonth / 12);
    const targetMonthIndex = ((zeroBasedTargetMonth % 12) + 12) % 12;
    const targetMonth = targetMonthIndex + 1;
    const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
    return toIsoDate(targetYear, targetMonth, Math.min(parsed.day, lastDayOfTargetMonth));
}

export function defaultScreenStartDate(eventDate, today) {
    const parsedEventDate = parseIsoDate(eventDate);
    const parsedToday = parseIsoDate(today);
    if (!parsedEventDate) return parsedToday ? today : '';
    if (!parsedToday || eventDate < today) return eventDate;

    const monthBefore = oneCalendarMonthBeforeIso(eventDate);
    return monthBefore < today ? today : monthBefore;
}
