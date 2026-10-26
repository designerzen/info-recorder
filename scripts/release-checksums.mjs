import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.argv[2] || 'release';
const files = (await readdir(directory)).filter((name) => /\.(exe|dmg|zip|AppImage|deb)$/.test(name)).sort();
if (!files.length) throw new Error(`No installers found in ${directory}`);
const lines = [];
for (const name of files) {
  const hash = createHash('sha256').update(await readFile(join(directory, name))).digest('hex');
  lines.push(`${hash}  ${name}`);
}
await writeFile(join(directory, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
console.log(`Checksummed ${files.length} release assets.`);
