'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { AppTools } from './widgets';
export function TeamRemoval({
  tools,
  teamId,
  close,
}: {
  tools: AppTools;
  teamId: string;
  close: () => void;
}) {
  const team = tools.s.teams.find((t) => t.id === teamId)!;
  const league = tools.s.leagues.find((l) => l.id === team.leagueId);
  const hasPlayers = tools.s.enrollments?.some(
    (e) => e.teamId === teamId && ['pending', 'approved'].includes(e.status),
  );
  const [error, setError] = useState('');
  return (
    <Dialog open onOpenChange={(v) => !v && !tools.busy && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {team.name}?</DialogTitle>
          <DialogDescription>
            Remove this team from {league?.name}. You can then use “Add a club”
            to fill the place.
            {hasPlayers
              ? ' Current team memberships and future player selections will end. Children’s profiles and past results are kept.'
              : ''}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="btn" disabled={tools.busy} onClick={close}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={tools.busy}
            onClick={async () => {
              try {
                await tools.act({ type: 'team-remove', teamId });
                close();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            {tools.busy ? 'Removing…' : 'Remove team'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
