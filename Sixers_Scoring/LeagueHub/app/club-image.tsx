'use client';
import { useState } from 'react';
import type { Club } from '@/lib/model';
import type { AppTools } from './widgets';
export function ClubImage({
  club,
  workspace,
  className = '',
}: {
  club?: Club;
  workspace: string;
  className?: string;
}) {
  const [failed, setFailed] = useState('');
  if (!club?.imageKey) return null;
  const src = `/api/club-image?${new URLSearchParams({ workspace, clubId: club.id, v: club.imageKey.split('/').pop() || '' })}`;
  if (failed === src) return null;
  return (
    <div className={`club-course-image ${className}`}>
      <img
        src={src}
        alt={`${club.name} course`}
        loading="lazy"
        onError={() => setFailed(src)}
      />
    </div>
  );
}
export function ClubImageSettings({
  club,
  tools,
}: {
  club: Club;
  tools: AppTools;
}) {
  const [error, setError] = useState(''),
    [uploading, setUploading] = useState(false);
  const pending =
    club.imageStatus === 'pending' &&
    Date.now() - Date.parse(club.imageRequestedAt || '') < 45000;
  return (
    <div className="club-image-settings">
      <ClubImage club={club} workspace={tools.workspace} />
      {club.website && (
        <a
          className="text-link"
          href={club.website}
          target="_blank"
          rel="noreferrer"
        >
          Visit club website ↗
        </a>
      )}
      <p className="muted" role="status">
        {pending
          ? 'Looking for a course photo…'
          : club.imageStatus === 'unavailable' || club.imageStatus === 'pending'
            ? 'We couldn’t find a suitable photo. Try again or upload one.'
            : club.imageKey
              ? 'This photo appears on parents’ fixture cards.'
              : 'Add the club website in venue details to find a course photo automatically, or upload one here.'}
      </p>
      <details className="asset-controls">
        <summary>Change photo</summary>
        <div className="action-bar">
          {club.website && (
            <button
              className="btn small"
              disabled={pending || uploading || tools.busy}
              onClick={async () => {
                setError('');
                try {
                  await tools.act({
                    type: 'club-image-retry',
                    clubId: club.id,
                  });
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              {club.imageKey ? 'Refresh from website' : 'Find website photo'}
            </button>
          )}
          <label className="btn small">
            {uploading
              ? 'Uploading…'
              : club.imageKey
                ? 'Upload replacement'
                : 'Upload course photo'}
            <input
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={uploading || tools.busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setUploading(true);
                setError('');
                try {
                  if (file.size > 4_000_000)
                    throw new Error('Choose a photo smaller than 4 MB.');
                  const data = new FormData();
                  data.set('workspace', tools.workspace);
                  data.set('view', tools.view);
                  data.set('clubId', club.id);
                  data.set('photo', file);
                  const r = await fetch('/api/club-image', {
                    method: 'POST',
                    body: data,
                  });
                  const result = (await r.json()) as any;
                  if (!r.ok) throw new Error(result.error);
                  await tools.refresh();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setUploading(false);
                }
              }}
            />
          </label>
          {(club.imageKey || pending) && (
            <button
              className="text-link"
              disabled={uploading || tools.busy}
              onClick={async () => {
                try {
                  await tools.act({
                    type: 'club-image-clear',
                    clubId: club.id,
                  });
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Remove photo
            </button>
          )}
        </div>
      </details>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
