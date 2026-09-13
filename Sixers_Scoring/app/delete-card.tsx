import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import type { Card } from './page';
export default function DeleteCard({
  card,
  onDeleted,
  disabled = false,
}: {
  card: Card;
  onDeleted: (card: Card) => Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function remove() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/cards/${card.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: card.revision }),
      });
      const result: any = await response.json();
      if (!response.ok)
        throw new Error(result.error || 'Could not delete this card.');
      setOpen(false);
      await onDeleted(card);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="ghost"
        className="delete-card-button"
        disabled={disabled}
        aria-label={`Delete card ${card.slot}`}
        onClick={() => {
          setError('');
          setOpen(true);
        }}
      >
        <Trash2 size={16} />
        Delete
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete card {card.slot}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes all three pairs and the photo from this event. Match
              standings and today's league awards will recalculate. Starting
              league points stay unchanged. You can scan the card again if
              needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="delete-team-list">
            {card.pairs
              .map((p) =>
                [p.club || 'Unassigned', p.colour].filter(Boolean).join(' '),
              )
              .join(' · ')}
          </p>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep card</AlertDialogCancel>
            <AlertDialogAction
              className="delete-confirm"
              disabled={busy}
              onClick={remove}
            >
              {busy ? 'Deleting…' : 'Delete card'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
