'use client';
import { useEffect, useState } from 'react';
export function PrivatePreview({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false), [locked, setLocked] = useState(false), [password, setPassword] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { fetch('/api/auth').then((r) => r.json()).then((a: any) => { setLocked(a.privatePreview && !a.user); setReady(true); }).catch(() => setError('Unable to check access. Please refresh.')); }, []);
  if (!ready) return <main className="welcome-main"><p>{error || 'Checking your access…'}</p></main>;
  if (!locked) return children;
  return <main className="welcome-main"><section className="card"><span className="eyebrow">GOLFSIXES · PRIVATE PREVIEW</span><h1 className="mt-4">Welcome back.</h1><p className="muted mt-4">Enter the existing preview password to open the Foundation administrator account. This preview is for testing; family email sign-in will be connected later.</p><form className="mt-5" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(''); try { const r = await fetch('/api/auth', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({type:'preview',password}) }); const a: any=await r.json(); if (!r.ok) throw new Error(a.error); setPassword(''); setLocked(false); } catch(e) { setError((e as Error).message); } finally {setBusy(false);} }}><label className="field"><span>Preview password</span><input type="password" autoComplete="current-password" required value={password} onChange={(e)=>setPassword(e.target.value)} /></label>{error && <p className="error mt-4" role="alert">{error}</p>}<button className="btn primary mt-5" disabled={busy}>{busy?'Signing in…':'Open private preview'}</button></form></section></main>;
}

