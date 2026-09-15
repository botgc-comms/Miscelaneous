'use client';
import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useOrganiserGuide } from './organiser-guide';
import { type AppTools } from './widgets';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export function FixtureSeasonStatus({
  tools,
  leagueId,
}: {
  tools: AppTools;
  leagueId: string;
}) {
  const league = tools.s.leagues.find((l) => l.id === leagueId)!;
  const fixtures = tools.s.fixtures.filter(
    (f) => f.leagueId === leagueId && f.status !== 'cancelled',
  );
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const guide = useOrganiserGuide();
  if (!fixtures.length && !league.fixturesConfirmedAt) return null;
  return (
    <>
      <section
        className="fixture-season-status"
        aria-label="Season fixture status"
      >
        <div>
          {league.fixturesConfirmedAt ? (
            <strong>
              <CheckCircle2 size={18} /> Season fixtures confirmed
            </strong>
          ) : (
            <strong>Fixture list awaiting confirmation</strong>
          )}
          <p>
            {league.fixturesConfirmedAt
              ? 'You can still change fixtures and continue registering players.'
              : 'Review the fixtures below, then confirm the list so families and organisers can prepare.'}
          </p>
        </div>
        <button
          className={`btn ${league.fixturesConfirmedAt ? 'small' : 'primary'}`}
          disabled={tools.busy}
          onClick={() =>
            league.fixturesConfirmedAt ? guide('Fixtures') : setConfirming(true)
          }
        >
          {league.fixturesConfirmedAt
            ? 'Where can I make changes?'
            : 'Confirm season fixtures'}
        </button>
      </section>
      {confirming && (
        <Dialog open onOpenChange={setConfirming}>
          <DialogContent className="editor-dialog">
            <DialogHeader>
              <DialogTitle>Confirm the season fixture list?</DialogTitle>
              <DialogDescription>
                {league.name} · {fixtures.length} fixtures
              </DialogDescription>
            </DialogHeader>
            <p>
              Families and junior organisers will receive an in-app notification
              that these fixtures are confirmed. Parents can record
              availability, and organisers can prepare their teams.
            </p>
            <p>
              You can still edit fixtures, clubs and teams later. Player
              registration stays as it is.
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button className="btn" onClick={() => setConfirming(false)}>
                Keep reviewing
              </button>
              <button
                className="btn primary"
                disabled={tools.busy}
                onClick={async () => {
                  try {
                    await tools.act({ type: 'fixtures-confirm', leagueId });
                    setConfirming(false);
                    guide('Fixtures');
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {tools.busy ? 'Confirming…' : 'Confirm & notify families'}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
