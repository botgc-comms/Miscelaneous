'use client';
import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { Copy } from 'lucide-react';
import type { AppTools } from './widgets';
export function TeamInvitation({
  teamId,
  tools,
}: {
  teamId: string;
  tools: AppTools;
}) {
  const [codes, setCodes] = useState<any[]>([]),
    [qr, setQr] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  const current = codes.find(
    (c) => !c.revoked && c.expires > new Date().toISOString(),
  );
  const link = current
    ? `${typeof location === 'undefined' ? '' : location.origin}/?role=parent&code=${current.code}${tools.demo ? '&demo=1&stage=' + encodeURIComponent(tools.workspace.startsWith('family-demo-') ? tools.workspace.split('-').pop() || 'ready' : 'league') : ''}`
    : '';
  async function load() {
    const r = await fetch(
      `/api/team-code?workspace=${encodeURIComponent(tools.workspace)}&teamId=${teamId}&view=${tools.view}`,
    );
    const b: any = await r.json();
    if (!r.ok) throw new Error(b.error);
    setCodes(b);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [teamId]);
  useEffect(() => {
    setQr('');
    if (link)
      QRCode.toDataURL(link, {
        width: 220,
        margin: 2,
        errorCorrectionLevel: 'M',
      })
        .then(setQr)
        .catch(() =>
          setError('Could not generate the QR code. Use the joining link.'),
        );
  }, [link]);
  async function issue(revoke?: string) {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/team-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace: tools.workspace,
          view: tools.view,
          teamId,
          revoke,
        }),
      });
      const b: any = await r.json();
      if (!r.ok) throw new Error(b.error);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="team-invitation mt-6">
      {current ? (
        <>
          <div>
            {qr && (
              <img
                src={qr}
                alt="Scan this QR code to request a team place"
                width={180}
                height={180}
              />
            )}
          </div>
          <div>
            <span className="eyebrow">YOUR TEAM CODE</span>
            <p className="team-code">{current.code}</p>
            <p className="muted">
              Expires {new Date(current.expires).toLocaleDateString('en-GB')}
            </p>
            <div className="row wrap mt-4">
              <button
                className="btn"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link);
                    setCopied(true);
                  } catch {
                    setError('Copy the joining link below.');
                  }
                }}
              >
                <Copy size={15} />
                {copied ? 'Copied' : 'Copy joining link'}
              </button>
              <a className="btn" href={qr} download="team-invitation-qr.png">
                Save QR code
              </a>
              <button
                className="text-link"
                disabled={busy}
                onClick={() => void issue(current.code)}
              >
                Revoke code
              </button>
            </div>
            <input
              aria-label="Team joining link"
              className="invitation-link"
              value={link}
              readOnly
              onFocus={(e) => e.target.select()}
            />
            <p className="muted mt-3">
              Share with parents. They select a child and send you a request.
            </p>
          </div>
        </>
      ) : (
        <button
          className="btn primary"
          disabled={busy}
          onClick={() => void issue()}
        >
          Create joining code & QR invitation
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
