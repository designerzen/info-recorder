/** Reads the uncompressed .npz that Underdog Woof ships its weights in: a stored zip of .npy arrays, plus a
 * "__tree__" JSON string that nests them, with arrays referenced as {"@": key}. */

export type NpyArray = {
  dtype: "f4" | "f2" | "i1";
  shape: number[];
  data: Float32Array | Int8Array;
};

export type Tree = NpyArray | number | string | Tree[] | { [key: string]: Tree };

function halfToFloat(bits: Uint16Array) {
  const out = new Float32Array(bits.length);
  for (let i = 0; i < bits.length; i++) {
    const h = bits[i];
    const sign = h & 0x8000 ? -1 : 1;
    const exponent = (h >> 10) & 0x1f;
    const fraction = h & 0x3ff;
    out[i] = exponent === 0
      ? sign * 2 ** -14 * (fraction / 1024)
      : exponent === 0x1f
        ? fraction ? NaN : sign * Infinity
        : sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
  }
  return out;
}

function readNpy(bytes: Uint8Array): NpyArray | string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const major = bytes[6];
  const headerLength = major === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
  const headerStart = major === 1 ? 10 : 12;
  const header = new TextDecoder().decode(bytes.subarray(headerStart, headerStart + headerLength));
  const descr = /'descr':\s*'([^']+)'/.exec(header)?.[1] ?? "";
  if (/'fortran_order':\s*True/.test(header)) throw new Error("Woof weights: Fortran-ordered arrays are not supported.");
  const shape = (/'shape':\s*\(([^)]*)\)/.exec(header)?.[1] ?? "").split(",").map((part) => part.trim()).filter(Boolean).map(Number);
  const count = shape.reduce((total, size) => total * size, 1);
  const start = headerStart + headerLength;
  // Copy so every array is aligned and owns its memory.
  const raw = bytes.slice(start);
  if (descr === "<f4") return { dtype: "f4", shape, data: new Float32Array(raw.buffer, 0, count) };
  if (descr === "<f2") return { dtype: "f2", shape, data: halfToFloat(new Uint16Array(raw.buffer, 0, count)) };
  if (descr === "|i1") return { dtype: "i1", shape, data: new Int8Array(raw.buffer, 0, count) };
  const unicode = /^<U(\d+)$/.exec(descr);
  if (unicode) {
    const codes = new Uint32Array(raw.buffer, 0, Number(unicode[1]) * Math.max(count, 1));
    let text = "";
    for (const code of codes) {
      if (code === 0) break;
      text += String.fromCodePoint(code);
    }
    return text;
  }
  throw new Error(`Woof weights: unsupported array type ${descr}.`);
}

/** Lists the stored entries of a zip from its central directory. */
function readZip(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error("Woof weights: not a zip file.");
  let entries = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  // Zip64 keeps the real counts in its own end record.
  if (entries === 0xffff || offset === 0xffffffff) {
    const locator = end - 20;
    const record = Number(view.getBigUint64(locator + 8, true));
    entries = Number(view.getBigUint64(record + 32, true));
    offset = Number(view.getBigUint64(record + 48, true));
  }
  const files = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  for (let i = 0; i < entries; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("Woof weights: broken zip directory.");
    const method = view.getUint16(offset + 10, true);
    let size = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    let local = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    // Zip64 extra field: sizes and offset that did not fit in 32 bits.
    for (let extra = offset + 46 + nameLength; extra < offset + 46 + nameLength + extraLength;) {
      const id = view.getUint16(extra, true);
      const length = view.getUint16(extra + 2, true);
      if (id === 0x0001) {
        let field = extra + 4;
        if (view.getUint32(offset + 24, true) === 0xffffffff) field += 8;
        if (size === 0xffffffff) { size = Number(view.getBigUint64(field, true)); field += 8; }
        if (local === 0xffffffff) local = Number(view.getBigUint64(field, true));
      }
      extra += 4 + length;
    }
    if (method !== 0) throw new Error(`Woof weights: ${name} is compressed, expected a stored .npz.`);
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    files.set(name, bytes.subarray(dataStart, dataStart + size));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

export function loadNpz(buffer: ArrayBuffer): Tree {
  const files = readZip(buffer);
  const tree = readNpy(files.get("__tree__.npy") ?? new Uint8Array());
  if (typeof tree !== "string") throw new Error("Woof weights: missing __tree__.");
  const build = (node: unknown): Tree => {
    if (Array.isArray(node)) return node.map(build);
    if (node && typeof node === "object") {
      const entries = Object.entries(node);
      if (entries.length === 1 && entries[0][0] === "@") {
        const file = files.get(`${entries[0][1]}.npy`);
        if (!file) throw new Error(`Woof weights: missing ${entries[0][1]}.`);
        const array = readNpy(file);
        if (typeof array === "string") throw new Error(`Woof weights: ${entries[0][1]} is not numeric.`);
        return array;
      }
      return Object.fromEntries(entries.map(([key, value]) => [key, build(value)]));
    }
    return node as number | string;
  };
  return build(JSON.parse(tree));
}
