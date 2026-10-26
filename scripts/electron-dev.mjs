import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';

const server = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true } });
await server.listen();
server.printUrls();
const env = { ...process.env, WORD_TRAIL_DEV_URL: 'http://127.0.0.1:5173/' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env });
child.on('error', async (error) => { console.error(error); await server.close(); process.exitCode = 1; });
child.on('exit', async (code) => { await server.close(); process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { child.kill(); void server.close(); });
