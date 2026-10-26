import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const staging = new URL('.desktop-app/', root);
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
// Fixed staging directory inside this workspace; never package browser-only
// dependencies or their optional native binaries into the Electron application.
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
await cp(new URL('dist/', root), new URL('dist/', staging), {
  recursive: true,
  // Optional local model downloads are ignored by Git and must not silently
  // become part of a release. The app downloads these models on first use.
  filter: (source) => !/[\\/]supertonic[\\/]assets[\\/]onnx[\\/][^\\/]+\.onnx$/i.test(source)
});
await cp(new URL('electron/', root), new URL('electron/', staging), { recursive: true });
await cp(new URL('public/icon.png', root), new URL('electron/icon.png', staging));
await writeFile(new URL('package.json', staging), JSON.stringify({
  name: 'word-trail', productName: 'Word Trail', version: pkg.version,
  description: pkg.description, author: pkg.author, main: 'electron/main.cjs',
  private: true, dependencies: {}
}, null, 2) + '\n');
console.log(`Prepared ${fileURLToPath(staging)}`);
