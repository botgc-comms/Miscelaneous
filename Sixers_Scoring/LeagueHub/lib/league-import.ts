export function csvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    value = '',
    quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(value.trim());
      value = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = '';
    } else value += c;
  }
  if (quoted) throw new Error('The CSV contains an unfinished quoted field.');
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
export function leagueImportRows(cells: unknown[][]): Record<string, string>[] {
  const aliases: Record<string, string> = {
    league_name: 'league',
    name: 'league',
    season: 'year',
    season_year: 'year',
    club_name: 'club',
    team_name: 'team',
    cap_colour: 'cap',
    cap_color: 'cap',
    administrator_email: 'admin_email',
  };
  const headers = (cells[0] || []).map((v) => {
    const k = String(v ?? '')
      .replace(/^\uFEFF/, '')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
    return aliases[k] || k;
  });
  if (!headers.includes('league') || !headers.includes('year'))
    throw new Error(
      'Include league and year columns. Download the template for an example.',
    );
  if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length)
    throw new Error('There are duplicate column headings.');
  const rows = cells
    .slice(1)
    .filter((r) =>
      r.some((v) => v !== null && v !== undefined && String(v).trim() !== ''),
    )
    .map((r) =>
      Object.fromEntries(
        headers
          .filter(Boolean)
          .map((k) => [k, String(r[headers.indexOf(k)] ?? '').trim()]),
      ),
    );
  if (!rows.length || rows.length > 200)
    throw new Error('Include between 1 and 200 rows.');
  if (JSON.stringify(rows).length > 85000)
    throw new Error('The import is too large. Split it into smaller files.');
  return rows;
}
export const LEAGUE_TEMPLATE =
  'league,year,region,club,team,cap,admin_email,assistant_email,squad_size\r\nSouth Derbyshire,2027,Derbyshire,Burton on Trent,Burton,Royal blue,,,12\r\nStaffordshire,2027,Staffordshire,Burton on Trent,Burton Green,Green,,,12\r\n';
