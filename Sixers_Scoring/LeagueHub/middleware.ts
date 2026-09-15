import { NextRequest, NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
export async function middleware(req: NextRequest) {
  const config=env as unknown as Record<string,string>;
  if (config.GOLFSIXES_RUNTIME !== 'node' || config.PRIVATE_PREVIEW !== 'true' || !req.nextUrl.pathname.startsWith('/api/') || ['/api/auth', '/api/backup'].includes(req.nextUrl.pathname)) return NextResponse.next();
  const token=req.cookies.get('golfsixes_session')?.value;
  if (token) {
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
    const hash=Array.from(new Uint8Array(bytes), v=>v.toString(16).padStart(2,'0')).join('');
    const session=await (env as unknown as {DB:D1Database}).DB.prepare('SELECT user_id FROM sessions WHERE hash=? AND expires>?').bind(hash,new Date().toISOString()).first();
    if(session) return NextResponse.next();
  }
  return NextResponse.json({error:'Enter the private preview password to continue.'},{status:401});
}
