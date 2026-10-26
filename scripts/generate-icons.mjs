import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import sharp from 'sharp';

const source = await readFile(new URL('../public/icon.svg', import.meta.url));
const output = new URL('../build/icons/', import.meta.url);
await mkdir(output, { recursive: true });
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
const pngs = new Map();
for (const size of sizes) {
  const png = await sharp(source).resize(size, size).png().toBuffer();
  pngs.set(size, png);
  await writeFile(new URL(`${size}x${size}.png`, output), png);
}

// Modern Windows supports PNG-compressed images in an ICO container.
const header = Buffer.alloc(6 + 16 * 6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(6, 4);
let offset = header.length;
const icoImages = sizes.slice(0, 6).map((size, index) => {
  const image = pngs.get(size);
  const entry = 6 + index * 16;
  header[entry] = header[entry + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(image.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += image.length;
  return image;
});
await writeFile(new URL('icon.ico', output), Buffer.concat([header, ...icoImages]));

// Retina-ready PNG entries in Apple's ICNS container; no host-specific tools.
const chunks = [[16, 'icp4'], [32, 'icp5'], [64, 'icp6'], [128, 'ic07'], [256, 'ic08'], [512, 'ic09'], [1024, 'ic10']].map(([size, type]) => {
  const png = pngs.get(size);
  const chunk = Buffer.alloc(8);
  chunk.write(type);
  chunk.writeUInt32BE(png.length + 8, 4);
  return Buffer.concat([chunk, png]);
});
const icns = Buffer.alloc(8);
icns.write('icns');
icns.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
await writeFile(new URL('icon.icns', output), Buffer.concat([icns, ...chunks]));
await copyFile(new URL('512x512.png', output), new URL('../public/icon.png', import.meta.url));
await writeFile(new URL('../public/apple-touch-icon.png', import.meta.url), await sharp(source).resize(180, 180).png().toBuffer());
console.log('Generated Windows, macOS, Linux, and web icons from public/icon.svg.');
