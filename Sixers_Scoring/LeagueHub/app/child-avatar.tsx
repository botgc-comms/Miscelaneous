'use client';
import { useState } from 'react';
import type { Player } from '@/lib/model';
export function ChildAvatar({
  player,
  workspace,
  view = 'parent',
  size = 36,
}: {
  player: Player;
  workspace?: string;
  view?: string;
  size?: number;
}) {
  const [failed, setFailed] = useState('');
  const query = new URLSearchParams({
    playerId: player.id,
    v: player.photoKey?.split('/').pop() || '',
  });
  if (workspace) {
    query.set('workspace', workspace);
    query.set('view', view);
  }
  const src = `${workspace ? '/api/photo' : '/api/family-photo'}?${query}`;
  return (
    <span
      className="child-avatar"
      style={{ width: size, height: size, fontSize: Math.max(14, size * 0.36) }}
      aria-hidden="true"
    >
      {player.photoKey && failed !== src ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailed(src)} />
      ) : (
        player.name
          .split(/\s+/)
          .map((v) => v[0])
          .slice(0, 2)
          .join('')
          .toUpperCase()
      )}
    </span>
  );
}
export function ChildName({
  player,
  workspace,
  view,
  size,
  short = false,
}: {
  player: Player;
  workspace?: string;
  view?: string;
  size?: number;
  short?: boolean;
}) {
  return (
    <span className="child-name">
      <ChildAvatar
        player={player}
        workspace={workspace}
        view={view}
        size={size}
      />
      <span>{short ? player.name.split(' ')[0] : player.name}</span>
    </span>
  );
}
