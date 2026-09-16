'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Field, type AppTools } from './widgets';
import { parseClubCsv, type ImportedClub } from '@/lib/club-import';
export function ClubSetup({
  mode,
  tools,
  close,
}: {
  mode: 'add' | 'import';
  tools: AppTools;
  close: () => void;
}) {
  const [name, setName] = useState(''),
    [address, setAddress] = useState(''),
    [county, setCounty] = useState(''),
    [postcode, setPostcode] = useState(''),
    [website, setWebsite] = useState(''),
    [instructions, setInstructions] = useState(''),
    [rows, setRows] = useState<ImportedClub[]>([]),
    [error, setError] = useState('');
  const existing = new Set(tools.s.orgs.map((o) => o.name.toLowerCase()));
  const seen = new Set<string>();
  const fresh = rows.filter((r) => {
    const key = r.name.toLowerCase();
    if (existing.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return (
    <Dialog open onOpenChange={(v) => !v && close()}>
      <DialogContent className="editor-dialog">
        <DialogHeader>
          <DialogTitle>
            {mode === 'add' ? 'Add a club' : 'Import your clubs'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'add'
              ? 'Create the club once, then add its teams to any of your leagues.'
              : 'Upload a CSV, review the clubs below, then confirm. Existing clubs are kept and duplicates skipped.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await tools.act({
                type: 'club-import',
                clubs:
                  mode === 'add'
                    ? [
                        {
                          name,
                          address,
                          county,
                          postcode,
                          instructions,
                          website,
                        },
                      ]
                    : fresh,
              });
              close();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          {mode === 'add' ? (
            <>
              <Field
                label="Club name"
                value={name}
                onChange={setName}
                required
              />
              <Field
                label="Address and postcode (optional for now)"
                value={address}
                onChange={setAddress}
                large
              />
              <Field
                label="Club website (optional)"
                value={website}
                onChange={setWebsite}
                hint="For example, https://www.yourclub.co.uk. We’ll look for a course photo in the background to show on parents’ fixtures."
              />
              <div className="form-grid">
                <Field label="County" value={county} onChange={setCounty} />
                <Field
                  label="Postcode"
                  value={postcode}
                  onChange={setPostcode}
                />
              </div>
              <Field
                label="Visitor instructions (optional)"
                value={instructions}
                onChange={setInstructions}
                large
              />
            </>
          ) : (
            <>
              <a
                className="text-link"
                href="/club-import-template.csv"
                download
              >
                Download CSV template
              </a>
              <label className="field">
                <span>Club CSV file</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={async (e) => {
                    setError('');
                    setRows([]);
                    try {
                      const file = e.target.files?.[0];
                      if (file) {
                        if (file.size > 90000)
                          throw new Error('Choose a CSV smaller than 90 KB.');
                        setRows(parseClubCsv(await file.text()));
                      }
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                />
              </label>
              {rows.length > 0 && (
                <div className="club-import-preview">
                  <strong>
                    {fresh.length} new clubs · {rows.length - fresh.length}{' '}
                    duplicates skipped
                  </strong>
                  {fresh.map((r, i) => (
                    <p key={i}>
                      {r.name}
                      {r.address ? ' · ' + r.address : ''}
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button className="btn" type="button" onClick={close}>
              Cancel
            </button>
            <button
              className="btn primary"
              disabled={tools.busy || (mode === 'import' && !fresh.length)}
            >
              {tools.busy
                ? 'Saving…'
                : mode === 'add'
                  ? 'Add club'
                  : `Import ${fresh.length} clubs`}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
