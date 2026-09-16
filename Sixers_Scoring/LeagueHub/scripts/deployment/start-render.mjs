import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
if (!process.env.DATA_DIR)
  throw new Error('DATA_DIR must point to the mounted persistent disk');
const workerSecret = randomBytes(32).toString('hex');
const child = spawn(
  process.execPath,
  [
    'node_modules/vinext/dist/cli.js',
    'start',
    '--hostname',
    '0.0.0.0',
    '--port',
    process.env.PORT || '3000',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      GOLFSIXES_TARGET: 'node',
      EMAIL_WORKER_SECRET: workerSecret,
    },
  },
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));

// The worker shares the web service's persistent SQLite database. No second disk mount is needed.
let running = false;
const tick = async () => {
  if (running) return;
  running = true;
  try {
    const r = await fetch(
      `http://127.0.0.1:${process.env.PORT || '3000'}/api/internal/email`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + workerSecret },
        signal: AbortSignal.timeout(55000),
      },
    );
    if (!r.ok) console.error('Email worker request failed:', r.status);
  } catch {
    console.error('Email worker could not reach the application. Will retry.');
  } finally {
    running = false;
  }
};
setTimeout(tick, 15000).unref();
setInterval(tick, 60000).unref();
