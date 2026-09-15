'use client';
import { useState } from 'react';
import { Flag, LoaderCircle } from 'lucide-react';
import type { Club } from '@/lib/model';
import type { AppTools } from './widgets';
export function ClubLogo({
  club,
  workspace,
}: {
  club?: Club;
  workspace: string;
}) {
  const [failed, setFailed] = useState('');
  const src = club?.logoKey
    ? '/api/club-logo?' +
      new URLSearchParams({
        workspace,
        clubId: club.id,
        v: club.logoKey.split('/').pop() || '',
      })
    : '';
  return (
    <span className="club-logo">
      {src && failed !== src ? (
        <img
          src={src}
          alt={`${club!.name} logo`}
          onError={() => setFailed(src)}
        />
      ) : (
        <Flag size={22} />
      )}
    </span>
  );
}
export function ClubLogoSettings({
  club,
  tools,
}: {
  club: Club;
  tools: AppTools;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pending = ['queued', 'working', 'identifying', 'cleaning'].includes(
    club.logoStatus || '',
  );
  async function action(type: string, file?: File) {
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.set('workspace', tools.workspace);
      form.set('view', tools.view);
      form.set('clubId', club.id);
      form.set('action', type);
      if (file) form.set('file', file);
      const r = await fetch('/api/club-logo', { method: 'POST', body: form }),
        v: any = await r.json();
      if (!r.ok) throw new Error(v.error);
      await tools.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="club-logo-settings">
      <div className="club-logo-heading">
        <ClubLogo club={club} workspace={tools.workspace} />
        <div>
          <strong>Club logo</strong>
          <p className="muted" role="status">
            {pending ? (
              <>
                <LoaderCircle size={14} className="logo-spinner" />
                {club.logoStatus === 'cleaning'
                  ? 'Preparing logo…'
                  : 'Finding the club’s logo…'}
              </>
            ) : (
              club.logoMessage ||
              (club.logoKey
                ? 'Logo ready'
                : club.website
                  ? 'No logo selected'
                  : 'Add a website to find the club’s logo automatically.')
            )}
          </p>
        </div>
      </div>
      <details className="asset-controls">
        <summary>Change logo</summary>
        <div className="action-bar">
          <label className="btn small">
            {busy ? 'Saving…' : 'Upload logo'}
            <input
              type="file"
              className="sr-only"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void action('upload', f);
              }}
            />
          </label>
          {club.website && (
            <button
              className="btn small"
              disabled={busy || pending}
              onClick={() => void action('retry')}
            >
              Find on website
            </button>
          )}
          {club.logoOriginal && (
            <button
              className="btn small"
              disabled={busy}
              onClick={() => void action('original')}
            >
              Use original logo
            </button>
          )}
          {(club.logoKey || pending) && (
            <button
              className="btn small"
              disabled={busy}
              onClick={() => void action('remove')}
            >
              Remove logo
            </button>
          )}
        </div>
      </details>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
