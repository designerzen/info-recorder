import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

const profile = await mkdtemp(join(tmpdir(), 'word-trail-smoke-'));
const env = { ...process.env, WORD_TRAIL_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.WORD_TRAIL_DEV_URL;
let application;
try {
  const packaged = process.argv[2] === '--executable';
  const target = resolve(process.argv[packaged ? 3 : 2] || '.desktop-app');
  application = await electron.launch({
    ...(packaged ? { executablePath: target } : {}),
    args: ['--force-device-scale-factor=1', `--user-data-dir=${profile}`, ...(packaged ? [] : [target])], env
  });
  assert.equal(await application.evaluate(({ app }) => app.getPath('userData')), profile);
  const page = await application.firstWindow();
  page.on('pageerror', (error) => console.error('Renderer error:', error.message));
  page.on('console', (message) => { if (message.type() === 'error') console.error('Renderer console:', message.text()); });
  page.on('requestfailed', (request) => console.error('Request failed:', request.url(), request.failure()?.errorText));
  // Arm diagnostics before loading renderer code, including startup failures.
  await page.waitForLoadState('load');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Start recording', exact: true }).waitFor();
  const capabilities = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const file = await root.getFileHandle('desktop-smoke.txt', { create: true });
    const writer = await file.createWritable();
    await writer.write('word trail');
    await writer.close();
    const stored = await (await file.getFile()).text();
    await root.removeEntry('desktop-smoke.txt');
    const cache = await caches.open('desktop-smoke');
    // Model caches use HTTPS keys; Chromium's Cache API does not accept custom
    // protocol keys, even when the document itself has a secure custom origin.
    const modelUrl = 'https://huggingface.co/word-trail-smoke/model.bin';
    await cache.put(modelUrl, new Response('cached model'));
    const cached = await (await cache.match(modelUrl)).text();
    await caches.delete('desktop-smoke');
    const shared = new SharedArrayBuffer(4);
    const workerUrl = URL.createObjectURL(new Blob(['onmessage = ({ data }) => { Atomics.add(new Int32Array(data), 0, 1); postMessage("ok"); };'], { type: 'text/javascript' }));
    const worker = new Worker(workerUrl);
    await new Promise((resolve, reject) => { worker.onmessage = resolve; worker.onerror = reject; worker.postMessage(shared); });
    worker.terminate();
    URL.revokeObjectURL(workerUrl);
    const context = new AudioContext();
    const workletUrl = URL.createObjectURL(new Blob(['registerProcessor("smoke", class extends AudioWorkletProcessor { process() { return true; } });'], { type: 'text/javascript' }));
    await context.audioWorklet.addModule(workletUrl);
    const worklet = new AudioWorkletNode(context, 'smoke');
    worklet.disconnect();
    await context.close();
    URL.revokeObjectURL(workletUrl);
    return { secure: isSecureContext, isolated: crossOriginIsolated, stored, cached, shared: new Int32Array(shared)[0], node: typeof window.require, worklet: true };
  });
  assert.equal(capabilities.secure, true);
  assert.equal(capabilities.isolated, true);
  assert.equal(capabilities.stored, 'word trail');
  assert.equal(capabilities.cached, 'cached model');
  assert.equal(capabilities.shared, 1);
  assert.equal(capabilities.node, 'undefined');
  const security = await application.evaluate(({ BrowserWindow }) => {
    const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration };
  });
  assert.deepEqual(security, { sandbox: true, contextIsolation: true, nodeIntegration: false });
  await application.evaluate(({ Menu }) => {
    const downloads = Menu.getApplicationMenu().getMenuItemById('downloads');
    downloads.click();
  });
  await page.getByRole('heading', { name: 'A little space. Now on your desktop.' }).waitFor();
  assert.equal(await page.title(), 'Downloads — Word Trail');
  assert.equal(await page.getByRole('link', { name: 'View latest release' }).getAttribute('href'), 'https://github.com/designerzen/info-recorder/releases/latest');
  await page.screenshot({ path: 'test-results/desktop-downloads.png', fullPage: true });
  console.log('Electron smoke passed:', capabilities, security);
} catch (error) {
  console.error('Desktop smoke failed:', error.message);
  if (application) {
    const page = application.windows()[0];
    if (page && !page.isClosed()) {
      console.error('Electron page:', new URL(page.url()).pathname, (await page.locator('body').innerText()).slice(0, 1500));
      await page.screenshot({ path: 'test-results/desktop-failure.png' });
    }
  }
  throw error;
} finally {
  if (application) await application.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
}
