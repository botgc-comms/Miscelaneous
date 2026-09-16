/** Node/Render bindings. Kept separate so the Sites build stays unchanged. */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export function createStorage(
  directory: string,
  migrations = resolve('drizzle'),
) {
  const root = resolve(directory);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const objects = join(root, 'objects');
  mkdirSync(objects, { recursive: true, mode: 0o700 });
  const sql = new DatabaseSync(join(root, 'golfsixes.sqlite'));
  sql.exec(
    'PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;',
  );
  sql.exec(
    'CREATE TABLE IF NOT EXISTS _render_migrations (name TEXT PRIMARY KEY)',
  );
  for (const name of readdirSync(migrations)
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    if (
      sql.prepare('SELECT name FROM _render_migrations WHERE name=?').get(name)
    )
      continue;
    sql.exec('BEGIN IMMEDIATE');
    try {
      sql.exec(readFileSync(join(migrations, name), 'utf8'));
      sql.prepare('INSERT INTO _render_migrations VALUES (?)').run(name);
      sql.exec('COMMIT');
    } catch (e) {
      sql.exec('ROLLBACK');
      throw e;
    }
  }
  class Statement {
    constructor(
      readonly query: string,
      readonly values: any[] = [],
    ) {}
    bind(...values: any[]) {
      return new Statement(this.query, values);
    }
    execute() {
      const statement = sql.prepare(this.query);
      const results = statement.columns().length
        ? statement.all(...this.values)
        : [];
      if (!statement.columns().length) statement.run(...this.values);
      const row = sql
        .prepare(
          'SELECT changes() AS changes, last_insert_rowid() AS last_row_id',
        )
        .get()!;
      return {
        success: true,
        results,
        meta: {
          changes: Number(row.changes),
          last_row_id: Number(row.last_row_id),
        },
      };
    }
    async all() {
      return this.execute();
    }
    async run() {
      return this.execute();
    }
    async first(column?: string) {
      const row = this.execute().results[0];
      return row ? (column ? row[column] : row) : null;
    }
  }
  const DB = {
    prepare(query: string) {
      return new Statement(query);
    },
    async batch(statements: Statement[]) {
      sql.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map((s) => s.execute());
        sql.exec('COMMIT');
        return results;
      } catch (e) {
        sql.exec('ROLLBACK');
        throw e;
      }
    },
  };
  const objectPath = (key: string) =>
    join(objects, createHash('sha256').update(key).digest('hex') + '.json');
  const FILES = {
    async put(
      key: string,
      value: string | ArrayBuffer | ArrayBufferView,
      options?: { httpMetadata?: Record<string, string> },
    ) {
      const bytes =
        typeof value === 'string'
          ? Buffer.from(value)
          : ArrayBuffer.isView(value)
            ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
            : Buffer.from(value);
      const path = objectPath(key),
        temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(
        temporary,
        JSON.stringify({
          key,
          body: bytes.toString('base64'),
          httpMetadata: options?.httpMetadata || {},
        }),
        { mode: 0o600 },
      );
      await rename(temporary, path);
      return { key, size: bytes.length };
    },
    async get(key: string) {
      let raw: string;
      try {
        raw = await readFile(objectPath(key), 'utf8');
      } catch (e: any) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
      const record = JSON.parse(raw),
        bytes = Buffer.from(record.body, 'base64');
      if (record.key !== key) throw new Error('Object key mismatch');
      return {
        key,
        body: bytes,
        httpMetadata: record.httpMetadata,
        async text() {
          return bytes.toString('utf8');
        },
        async arrayBuffer() {
          return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          );
        },
      };
    },
    async delete(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        try {
          await unlink(objectPath(key));
        } catch (e: any) {
          if (e.code !== 'ENOENT') throw e;
        }
      }
    },
  };
  return { DB, FILES, close: () => sql.close() };
}

let storage: ReturnType<typeof createStorage> | undefined;
function bindings() {
  if (!process.env.DATA_DIR)
    throw new Error('DATA_DIR must point to persistent storage');
  return (storage ??= createStorage(process.env.DATA_DIR));
}
export const env = new Proxy({} as Record<string, unknown>, {
  get: (_, key) =>
    key === 'DB'
      ? bindings().DB
      : key === 'FILES'
        ? bindings().FILES
        : key === 'GOLFSIXES_RUNTIME'
          ? 'node'
          : process.env[String(key)],
});
const pending = new Set<Promise<unknown>>();
export function waitUntil(promise: Promise<unknown>) {
  pending.add(promise);
  void promise
    .catch(() => console.error('Background work did not complete'))
    .finally(() => pending.delete(promise));
}
export async function drainBackground() {
  await Promise.allSettled([...pending]);
}
