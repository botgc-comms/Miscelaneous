import { spawn } from 'node:child_process';
if (!process.env.DATA_DIR) throw new Error('DATA_DIR must point to the mounted persistent disk');
const child = spawn(process.execPath, ['node_modules/vinext/dist/cli.js', 'start', '--hostname', '0.0.0.0', '--port', process.env.PORT || '3000'], { stdio: 'inherit', env: { ...process.env, GOLFSIXES_TARGET: 'node' } });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));
