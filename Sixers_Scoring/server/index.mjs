import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createHash,
  createHmac,
  timingSafeEqual,
  randomUUID,
} from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  blankCard,
  validateCard,
  leaderboard,
  leagueLeaderboard,
  DEFAULT_SETTINGS,
  validateSettings,
} from './scoring.mjs';
import { readScorecard } from './scan.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.DATA_PATH || path.join(root, 'data'));
mkdirSync(path.join(dataDir, 'photos'), { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'scores.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
db.exec(
  'CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, slot INTEGER NOT NULL UNIQUE, json TEXT NOT NULL, revision INTEGER NOT NULL, photo TEXT, hash TEXT UNIQUE); CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY, card_id TEXT NOT NULL, json TEXT NOT NULL, saved_at TEXT NOT NULL);',
);
db.prepare('INSERT OR IGNORE INTO settings (id,json) VALUES (1,?)').run(
  JSON.stringify(DEFAULT_SETTINGS),
);
const password = process.env.APP_PASSWORD || '';
if (process.env.NODE_ENV === 'production' && password.length < 12)
  throw new Error(
    'Set APP_PASSWORD to at least 12 characters before starting in production.',
  );
const digest = (v) => createHash('sha256').update(String(v)).digest();
const equal = (a, b) => timingSafeEqual(digest(a), digest(b));
const signature = (value) =>
  createHmac('sha256', password).update(value).digest('hex');
function authorized(req) {
  if (!password) return true;
  const token =
    (req.headers.cookie || '')
      .split('; ')
      .find((c) => c.startsWith('sixes='))
      ?.slice(6) || '';
  const [expiry, mac] = token.split('.');
  return (
    Number(expiry) > Date.now() &&
    Number(expiry) < Date.now() + 8 * 86400000 &&
    equal(mac || '', signature(expiry))
  );
}
function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}
async function body(req) {
  if (Number(req.headers['content-length']) > 12 * 1024 * 1024)
    throw Object.assign(new Error('Choose a photo smaller than 8 MB.'), {
      status: 413,
    });
  let n = 0,
    parts = [];
  for await (const part of req) {
    n += part.length;
    if (n > 12 * 1024 * 1024)
      throw Object.assign(new Error('Photo is too large.'), { status: 413 });
    parts.push(part);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString());
  } catch {
    throw new Error('Invalid request.');
  }
}
const rowCard = (row) =>
  row
    ? {
        ...JSON.parse(row.json),
        id: row.id,
        revision: row.revision,
        photo: row.photo ? `/api/photos/${row.id}` : null,
      }
    : null;
const cards = () =>
  db.prepare('SELECT * FROM cards ORDER BY slot').all().map(rowCard);
const setting = () => {
  const s = db.prepare('SELECT * FROM settings WHERE id=1').get();
  return { ...DEFAULT_SETTINGS, ...JSON.parse(s.json), revision: s.revision };
};
function saveCard(id, raw, revision, photo, hash) {
  const card = validateCard(raw);
  db.exec('BEGIN IMMEDIATE');
  try {
    const old = db.prepare('SELECT * FROM cards WHERE id=?').get(id);
    if (old ? revision !== old.revision : revision !== 0)
      throw Object.assign(
        new Error('This card changed elsewhere. Reopen it before saving.'),
        { status: 409 },
      );
    const rev = (old?.revision ?? 0) + 1;
    db.prepare(
      'INSERT INTO cards (id,slot,json,revision,photo,hash) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET slot=excluded.slot,json=excluded.json,revision=excluded.revision,photo=excluded.photo,hash=excluded.hash',
    ).run(
      id,
      card.slot,
      JSON.stringify(card),
      rev,
      photo ?? old?.photo ?? null,
      hash ?? old?.hash ?? null,
    );
    db.prepare(
      'INSERT INTO history (card_id,json,saved_at) VALUES (?,?,?)',
    ).run(
      id,
      JSON.stringify({ ...card, revision: rev }),
      new Date().toISOString(),
    );
    db.exec('COMMIT');
    return rowCard(db.prepare('SELECT * FROM cards WHERE id=?').get(id));
  } catch (e) {
    db.exec('ROLLBACK');
    if (String(e.message).includes('UNIQUE constraint failed'))
      throw Object.assign(
        new Error(
          'This card number or photo is already recorded. Open the existing card.',
        ),
        { status: 409 },
      );
    throw e;
  }
}
function deleteCard(id, revision) {
  let old;
  db.exec('BEGIN IMMEDIATE');
  try {
    old = db.prepare('SELECT * FROM cards WHERE id=?').get(id);
    if (!old)
      throw Object.assign(
        new Error(
          'This card has already been deleted. Refresh the scorecards.',
        ),
        { status: 404 },
      );
    if (!Number.isInteger(revision) || revision !== old.revision)
      throw Object.assign(
        new Error('This card changed elsewhere. Reopen it before deleting.'),
        { status: 409 },
      );
    db.prepare(
      'INSERT INTO history (card_id,json,saved_at) VALUES (?,?,?)',
    ).run(
      id,
      JSON.stringify({
        ...JSON.parse(old.json),
        status: 'deleted',
        revision: old.revision + 1,
      }),
      new Date().toISOString(),
    );
    db.prepare('DELETE FROM cards WHERE id=?').run(id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  // Photo filenames are generated by this server. Never delete an arbitrary path.
  if (old.photo && /^[a-zA-Z0-9-]+\.(jpeg|png|webp)$/.test(old.photo)) {
    try {
      unlinkSync(path.join(dataDir, 'photos', old.photo));
    } catch (error) {
      if (error.code !== 'ENOENT')
        console.warn('Deleted card photo cleanup could not finish.');
    }
  }
  return { id, slot: old.slot, deleted: true };
}
const attempts = new Map();
let scanning = false;
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/health') {
      json(res, 200, { ok: true });
      return;
    }
    if (
      url.pathname.startsWith('/api/') &&
      !['GET', 'HEAD'].includes(req.method) &&
      req.headers.origin &&
      new URL(req.headers.origin).host !== req.headers.host
    ) {
      json(res, 403, { error: 'Request origin rejected.' });
      return;
    }
    if (url.pathname === '/api/session') {
      json(res, 200, {
        authenticated: authorized(req),
        passwordRequired: !!password,
      });
      return;
    }
    if (url.pathname === '/api/login' && req.method === 'POST') {
      const ip = req.socket.remoteAddress;
      const a = attempts.get(ip) ?? { count: 0, until: Date.now() + 60000 };
      if (Date.now() > a.until) {
        a.count = 0;
        a.until = Date.now() + 60000;
      }
      if (++a.count > 10) {
        json(res, 429, { error: 'Too many attempts. Wait one minute.' });
        return;
      }
      attempts.set(ip, a);
      const input = await body(req);
      if (!equal(input.password, password)) {
        json(res, 401, { error: 'Incorrect event password.' });
        return;
      }
      const expiry = String(Date.now() + 7 * 86400000);
      res.setHeader(
        'Set-Cookie',
        `sixes=${expiry}.${signature(expiry)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
      );
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname.startsWith('/api/') && !authorized(req)) {
      json(res, 401, { error: 'Enter the event password to continue.' });
      return;
    }
    if (url.pathname === '/api/state' && req.method === 'GET') {
      const all = cards(),
        settings = setting();
      json(res, 200, {
        cards: all,
        settings,
        leaderboard: leaderboard(all, settings),
        league: leagueLeaderboard(all, settings),
        scannerAvailable: !!process.env.OPENAI_API_KEY,
      });
      return;
    }
    if (
      ['/api/settings', '/api/league'].includes(url.pathname) &&
      req.method === 'PUT'
    ) {
      const raw = await body(req),
        s = validateSettings(
          url.pathname === '/api/league'
            ? { ...setting(), leagueStandings: raw.entries }
            : { ...setting(), ...raw },
        );
      const result = db
        .prepare(
          'UPDATE settings SET json=?,revision=revision+1 WHERE id=1 AND revision=?',
        )
        .run(JSON.stringify(s), raw.revision);
      if (!result.changes)
        throw Object.assign(
          new Error('Event settings changed. Refresh before saving.'),
          { status: 409 },
        );
      json(res, 200, setting());
      return;
    }
    if (url.pathname === '/api/scan' && req.method === 'POST') {
      if (!process.env.OPENAI_API_KEY)
        throw new Error(
          'Add OPENAI_API_KEY on the server to enable photo reading. Manual scoring is available.',
        );
      if (scanning)
        throw Object.assign(
          new Error('Another photo is being read. Please try again shortly.'),
          { status: 429 },
        );
      const raw = await body(req);
      const match =
        /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
          raw.image || '',
        );
      if (!match) throw new Error('Use a JPEG, PNG or WebP photo.');
      const bytes = Buffer.from(match[2], 'base64');
      if (bytes.length > 8 * 1024 * 1024 || bytes.length < 50)
        throw new Error('Photo must be between 50 bytes and 8 MB.');
      const type = match[1];
      if (
        !(
          (type === 'jpeg' && bytes[0] === 255 && bytes[1] === 216) ||
          (type === 'png' &&
            bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
          (type === 'webp' &&
            bytes.toString('ascii', 0, 4) === 'RIFF' &&
            bytes.toString('ascii', 8, 12) === 'WEBP')
        )
      )
        throw new Error('The file contents do not match the photo type.');
      const hash = createHash('sha256').update(bytes).digest('hex');
      const duplicate = db
        .prepare('SELECT * FROM cards WHERE hash=?')
        .get(hash);
      if (duplicate) {
        json(res, 409, {
          error: `This photo is already saved as card ${duplicate.slot}.`,
          card: rowCard(duplicate),
        });
        return;
      }
      const base = blankCard(raw.slot);
      const photo = `${randomUUID()}.${type}`;
      writeFileSync(path.join(dataDir, 'photos', photo), bytes);
      let saved = saveCard(base.id, base, 0, photo, hash);
      scanning = true;
      try {
        const extraction = await readScorecard(
          raw.image,
          setting().clubs,
          process.env.OPENAI_API_KEY,
          process.env.OPENAI_MODEL || 'gpt-5.6-terra',
        );
        saved = saveCard(
          base.id,
          {
            ...saved,
            notes: extraction.notes,
            pairs: extraction.pairs.map((p) => ({ ...p, pairNumber: null })),
          },
          saved.revision,
        );
        json(res, 200, { card: saved });
      } catch (e) {
        json(res, 502, { error: e.message, card: saved });
      } finally {
        scanning = false;
      }
      return;
    }
    if (
      url.pathname.match(/^\/api\/cards\/[a-zA-Z0-9-]+\/scan$/) &&
      req.method === 'POST'
    ) {
      if (!process.env.OPENAI_API_KEY)
        throw new Error('The photo reader is not configured.');
      if (scanning)
        throw Object.assign(
          new Error('Another photo is being read. Try again shortly.'),
          { status: 429 },
        );
      const raw = await body(req);
      const id = url.pathname.split('/')[3],
        row = db.prepare('SELECT * FROM cards WHERE id=?').get(id),
        card = rowCard(row);
      if (!card || !row.photo) throw new Error('No saved photo to read.');
      if (card.status === 'confirmed')
        throw new Error(
          'Save this card as a draft before reading its photo again.',
        );
      if (raw.revision !== card.revision)
        throw Object.assign(new Error('This card changed. Reopen it first.'), {
          status: 409,
        });
      scanning = true;
      try {
        const bytes = readFileSync(path.join(dataDir, 'photos', row.photo));
        const image = `data:image/${path.extname(row.photo).slice(1)};base64,${bytes.toString('base64')}`;
        const extraction = await readScorecard(
          image,
          setting().clubs,
          process.env.OPENAI_API_KEY,
          process.env.OPENAI_MODEL || 'gpt-5.6-terra',
        );
        const saved = saveCard(
          id,
          {
            ...card,
            reviewed: false,
            notes: extraction.notes,
            pairs: extraction.pairs.map((p, i) => ({
              ...p,
              pairNumber: card.pairs[i].pairNumber,
            })),
          },
          card.revision,
        );
        json(res, 200, { card: saved });
      } finally {
        scanning = false;
      }
      return;
    }
    if (
      url.pathname.match(/^\/api\/cards\/[a-zA-Z0-9-]+$/) &&
      req.method === 'DELETE'
    ) {
      const raw = await body(req);
      json(res, 200, deleteCard(url.pathname.split('/').pop(), raw.revision));
      return;
    }
    if (
      url.pathname.match(/^\/api\/cards\/[a-zA-Z0-9-]+$/) &&
      req.method === 'PUT'
    ) {
      const raw = await body(req);
      json(res, 200, {
        card: saveCard(url.pathname.split('/').pop(), raw, raw.revision),
      });
      return;
    }
    if (
      url.pathname.match(/^\/api\/photos\/[a-zA-Z0-9-]+$/) &&
      req.method === 'GET'
    ) {
      const row = db
        .prepare('SELECT photo FROM cards WHERE id=?')
        .get(url.pathname.split('/').pop());
      if (!row?.photo) {
        json(res, 404, { error: 'Photo not found.' });
        return;
      }
      const file = path.join(dataDir, 'photos', row.photo);
      res.writeHead(200, {
        'Content-Type': `image/${path.extname(file).slice(1)}`,
        'Cache-Control': 'private, max-age=3600',
      });
      res.end(await readFile(file));
      return;
    }
    if (url.pathname === '/api/export' && req.method === 'GET') {
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="golf-sixes-backup.json"',
      );
      json(res, 200, {
        exportedAt: new Date().toISOString(),
        settings: setting(),
        cards: cards(),
        history: db.prepare('SELECT * FROM history ORDER BY id').all(),
      });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      json(res, 404, { error: 'Not found.' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      json(res, 405, { error: 'Method not allowed.' });
      return;
    }
    const dist = path.join(root, 'dist');
    let file = path.resolve(dist, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(dist + path.sep)) {
      file = path.join(dist, 'index.html');
    }
    if (!existsSync(file) || url.pathname === '/')
      file = path.join(dist, 'index.html');
    const bytes = await readFile(file);
    res.writeHead(200, {
      'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
      'Cache-Control':
        path.extname(file) === '.html' ? 'no-cache' : 'public,max-age=3600',
    });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch (e) {
    const status = e.status || (e.code === 'ENOENT' ? 404 : 400);
    json(res, status, {
      error:
        status === 404
          ? 'Build the app first, or use the development preview.'
          : e.message || 'Unable to complete the request.',
    });
  }
});
const port = Number(process.env.PORT || 3001);
server.listen(port, '0.0.0.0', () =>
  console.log(
    `Golf Sixes server listening on http://localhost:${server.address().port}`,
  ),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
