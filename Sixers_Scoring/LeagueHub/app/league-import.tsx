'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { applyAction } from '@/lib/model';
import {
  csvRows,
  leagueImportRows,
  LEAGUE_TEMPLATE,
} from '@/lib/league-import';
import { Pick, type AppTools } from './widgets';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
export function LeagueImport({
  tools,
  close,
}: {
  tools: AppTools;
  close: () => void;
}) {
  const [sheets, setSheets] = useState<{ sheet: string; data: unknown[][] }[]>(
      [],
    ),
    [sheet, setSheet] = useState('0'),
    [error, setError] = useState(''),
    [reading, setReading] = useState(false);
  let rows: Record<string, string>[] = [],
    preview = '',
    validation = '';
  if (sheets.length)
    try {
      rows = leagueImportRows(sheets[Number(sheet)].data);
      const next = applyAction(tools.s, tools.me, {
        type: 'league-import',
        rows,
      });
      preview = `${next.leagues.length - tools.s.leagues.length} new leagues · ${next.orgs.length - tools.s.orgs.length} new clubs · ${next.teams.length - tools.s.teams.length} new teams`;
    } catch (e) {
      validation = (e as Error).message;
    }
  async function read(file?: File) {
    setError('');
    setSheets([]);
    setSheet('0');
    if (!file) return;
    setReading(true);
    try {
      if (file.size > 2_000_000)
        throw new Error('Choose a file smaller than 2 MB.');
      if (/\.csv$/i.test(file.name))
        setSheets([{ sheet: file.name, data: csvRows(await file.text()) }]);
      else if (/\.xlsx$/i.test(file.name)) {
        const { default: readExcel } = await import('read-excel-file/browser');
        setSheets(await readExcel(file));
      } else
        throw new Error(
          'Choose an Excel .xlsx or CSV file. Save older .xls files as .xlsx first.',
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && close()}>
      <DialogContent className="editor-dialog">
        <DialogHeader>
          <DialogTitle>Import leagues</DialogTitle>
          <DialogDescription>
            One row per team. Repeat the league and year to add more clubs or
            teams to it. Leave club blank to create an empty league.
          </DialogDescription>
        </DialogHeader>
        <div className="stack">
          <a
            className="text-link"
            download="golfsixes-league-template.csv"
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(LEAGUE_TEMPLATE)}`}
          >
            Download spreadsheet template
          </a>
          <p className="muted">
            Existing leagues and teams are matched by name and season. New clubs
            are created if needed. Blank cap colours use the first free colour.
            Optional admin_email and assistant_email must match registered
            Foundation accounts.
          </p>
          <label className="field">
            <span>Excel or CSV spreadsheet</span>
            <input
              type="file"
              accept=".xlsx,.csv"
              disabled={reading || tools.busy}
              onChange={(e) => void read(e.target.files?.[0])}
            />
          </label>
          {reading && <p role="status">Reading spreadsheet…</p>}
          {sheets.length > 1 && (
            <Pick
              label="Worksheet to import"
              value={sheet}
              onChange={setSheet}
              options={sheets.map((s, i) => ({
                value: String(i),
                label: s.sheet,
              }))}
            />
          )}
          {!!rows.length && (
            <div className="import-preview">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>League</TableHead>
                    <TableHead>Year</TableHead>
                    <TableHead>Club / team</TableHead>
                    <TableHead>Cap</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{r.league}</TableCell>
                      <TableCell>{r.year}</TableCell>
                      <TableCell>
                        {r.club || 'Empty league'}
                        {r.team && ` / ${r.team}`}
                      </TableCell>
                      <TableCell>{r.cap || 'First available'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {preview && !validation && (
            <p className="notice" role="status">
              {preview}. Existing matches are kept unchanged. New leagues open
              for registration with countback and a 12-player target unless
              specified.
            </p>
          )}
          {(error || validation) && (
            <p className="error" role="alert">
              {error || validation}
            </p>
          )}
          <div className="dialog-actions">
            <button className="btn" onClick={close}>
              Cancel
            </button>
            <button
              className="btn primary"
              disabled={tools.busy || reading || !rows.length || !!validation}
              onClick={async () => {
                try {
                  await tools.act({ type: 'league-import', rows });
                  close();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Import this worksheet
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
