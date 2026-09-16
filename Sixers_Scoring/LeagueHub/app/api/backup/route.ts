import { env } from 'cloudflare:workers';
import { db, files, user, failure } from '@/lib/server';
import { AppError, requireThat } from '@/lib/model';
import { digest } from '@/lib/identity';
const tables = ['workspaces', 'families', 'team_codes', 'assistant_jobs', 'club_logos'] as const;

export async function GET() {
  try {
    const me = await user();
    const results = await db().batch(tables.map((name) => db().prepare(`SELECT * FROM ${name}`)));
    const records = Object.fromEntries(tables.map((name, i) => [name, results[i].results])) as Record<string, any[]>;
    requireThat(records.workspaces.length > 0 && records.workspaces.every((row) => row.owner === me.userId && JSON.parse(row.data).members.some((m: any) => m.id === me.userId && m.role === 'admin')), 'Only the owner of every workspace can export this deployment.', 403);
    const keys = new Set<string>();
    function collect(value: any) {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (typeof child === 'string' && child && ['photoKey', 'imageKey', 'logoKey', 'key', 'original'].includes(key) && !child.startsWith('http') && !child.startsWith('data:')) keys.add(child);
        else if (child && typeof child === 'object') collect(child);
      }
    }
    for (const rows of Object.values(records)) for (const row of rows) if (row.data) collect(JSON.parse(row.data));
    for (const row of records.workspaces) for (const invite of JSON.parse(row.data).invites || []) if (invite.hash) keys.add(`invite-links/${row.id}/${invite.hash}`);
    const objects = [];
    for (const key of keys) {
      const object = await files().get(key);
      if (object) objects.push({ key, body: Buffer.from(await object.arrayBuffer()).toString('base64'), httpMetadata: object.httpMetadata });
    }
    const body = JSON.stringify({ format: 'golfsixes-backup-1', createdAt: new Date().toISOString(), records, objects });
    return new Response(body, { headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="golfsixes-backup.json"', 'Cache-Control': 'no-store' } });
  } catch (e) { return failure(e); }
}

export async function POST(req: Request) {
  try {
    const config = env as unknown as Record<string, string>;
    const token = req.headers.get('x-golfsixes-migration-token') || '';
    requireThat(config.GOLFSIXES_RUNTIME === 'node' && !!config.MIGRATION_IMPORT_TOKEN && !!token && await digest(token) === await digest(config.MIGRATION_IMPORT_TOKEN), 'Migration is not available.', 403);
    const limit = 64 * 1024 * 1024;
    requireThat(Number(req.headers.get('content-length') || 0) <= limit, 'Backup is too large.');
    const raw = await req.text();
    requireThat(raw.length <= limit, 'Backup is too large.');
    const backup = JSON.parse(raw);
    requireThat(backup.format === 'golfsixes-backup-1' && backup.records && Array.isArray(backup.objects), 'Invalid backup.');
    for (const name of tables) requireThat(Array.isArray(backup.records[name]), 'Backup is missing a table.');
    requireThat(backup.records.workspaces.length > 0 && backup.records.workspaces.every((w: any) => typeof w.id === 'string' && JSON.parse(w.data).leagues), 'Backup has no valid workspaces.');
    // Never overwrite an existing deployment. Database constraints also reject concurrent imports.
    for (const name of tables) requireThat(!(await db().prepare(`SELECT 1 AS present FROM ${name} LIMIT 1`).first()), 'This deployment already contains data. Import stopped.', 409);
    const statements = [];
    for (const name of tables) {
      const schema = await db().prepare(`PRAGMA table_info(${name})`).all<{ name: string }>();
      const columns = schema.results.map((c) => c.name);
      for (const row of backup.records[name]) {
        requireThat(columns.every((key) => Object.hasOwn(row, key)), 'Backup row is incomplete.');
        statements.push(db().prepare(`INSERT INTO ${name} (${columns.map((c) => `"${c}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`).bind(...columns.map((key) => row[key])));
      }
    }
    for (const object of backup.objects) {
      requireThat(typeof object.key === 'string' && typeof object.body === 'string', 'Invalid uploaded object.');
      await files().put(object.key, Buffer.from(object.body, 'base64'), { httpMetadata: object.httpMetadata || {} });
    }
    await db().batch(statements);
    return Response.json({ imported: Object.fromEntries(tables.map((name) => [name, backup.records[name].length])), objects: backup.objects.length });
  } catch (e) { return failure(e instanceof SyntaxError ? new AppError('Invalid backup JSON.') : e); }
}
