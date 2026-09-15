export type ImportedClub = {
  website?: string;
  county?: string;
  postcode?: string;
  name: string;
  address: string;
  instructions: string;
};
export function parseClubCsv(input: string): ImportedClub[] {
  if (input.length > 90000) throw new Error('Choose a CSV smaller than 90 KB.');
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  input = input.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(field.trim());
      field = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (quoted)
    throw new Error('A quoted field is unfinished. Check the CSV file.');
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  const headers =
    rows.shift()?.map((v) => v.toLowerCase().replace(/\s+/g, '_')) || [];
  const nameIndex = headers.findIndex((v) =>
    ['club_name', 'name', 'club'].includes(v),
  );
  if (nameIndex < 0)
    throw new Error(
      'The CSV needs a club_name column. Optional columns: address, county, postcode, instructions, website.',
    );
  if (!rows.length || rows.length > 200)
    throw new Error('Include between 1 and 200 clubs.');
  return rows.map((r, i) => {
    const name = r[nameIndex] || '',
      address = r[headers.indexOf('address')] || '',
      county = r[headers.indexOf('county')] || '',
      postcode = r[headers.indexOf('postcode')] || '',
      website = r[headers.indexOf('website')] || '',
      instructions = r[headers.indexOf('instructions')] || '';
    if (
      !name ||
      name.length > 100 ||
      address.length > 500 ||
      county.length > 100 ||
      postcode.length > 20 ||
      instructions.length > 2000
    )
      throw new Error(
        `Check row ${i + 2}: a club name is required (up to 100 characters). Address is limited to 500 and instructions to 2,000.`,
      );
    return {
      name,
      address,
      instructions,
      ...(county ? { county } : {}),
      ...(postcode ? { postcode } : {}),
      ...(website ? { website } : {}),
    };
  });
}
