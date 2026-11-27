/* js/zip.js: a tiny zip writer and reader, no compression ("stored"), no libraries. A .spores file is a zip of
 * song.json (and, later, audio/<id>.wav), so any zip tool can open it.
 *
 * crc32 and the layout of the headers are adapted from ...Thunder Plus (its crc32 + zipBlob, index.html); the reader
 * and the Uint8Array / list-of-{name, bytes} API are new. Files are always a list of {name, bytes}.
 *
 *   zipWrite([{name: 'song.json', bytes: Uint8Array}, …]) → Uint8Array
 *   zipBlob(files)                                        → Blob (application/zip)
 *   zipRead(bytes)                                        → [{name, bytes}, …]  (throws on anything it cannot read)
 *   isZip(bytes)                                          → true if it starts like a zip file
 */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

export function crc32(u){
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const LOCAL = 0x04034b50, CENTRAL = 0x02014b50, END = 0x06054b50;

export function isZip(bytes){
  return !!bytes && bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4;
}

export function zipWrite(files){
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0, size = 0;
  const d = new Date();
  const dt = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const tm = (d.getHours() << 11) | (d.getMinutes() << 5);
  for (const f of files){
    const nm = enc.encode(f.name), bytes = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes);
    const crc = crc32(bytes), len = bytes.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, LOCAL, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);   // 0x0800: UTF-8 names; 0: stored
    h.setUint16(10, tm, true); h.setUint16(12, dt, true); h.setUint32(14, crc, true); h.setUint32(18, len, true); h.setUint32(22, len, true);
    h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), nm, bytes);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, CENTRAL, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, tm, true); c.setUint16(14, dt, true); c.setUint32(16, crc, true); c.setUint32(20, len, true); c.setUint32(24, len, true);
    c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nm);
    off += 30 + nm.length + len;
  }
  let cdSize = 0;
  for (const p of central) cdSize += p.length;
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, END, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
  for (const p of [...parts, ...central, new Uint8Array(e.buffer)]) size += p.length;
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of [...parts, ...central, new Uint8Array(e.buffer)]){ out.set(p, o); o += p.length; }
  return out;
}

export const zipBlob = files => new Blob([zipWrite(files)], {type: 'application/zip'});

/* Reads the zips we write (and any other stored, non-zip64 zip). Walks the central directory from the end-of-
   directory record, checks every file's crc. Compressed entries are refused: Spores never writes them. */
export function zipRead(bytes){
  if (!bytes || bytes.length < 22) throw new Error('not a zip');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), dec = new TextDecoder();
  let e = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--){
    if (dv.getUint32(i, true) === END){ e = i; break; }
  }
  if (e < 0) throw new Error('not a zip');
  const n = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const out = [];
  for (let k = 0; k < n; k++){
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== CENTRAL) throw new Error('damaged zip');
    const method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true), len = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + xl + cl;
    if (name.endsWith('/')) continue;                       // a folder entry
    if (method !== 0) throw new Error('compressed zip entries are not supported');
    if (lo + 30 > bytes.length || dv.getUint32(lo, true) !== LOCAL) throw new Error('damaged zip');
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    if (start + len > bytes.length) throw new Error('damaged zip');
    const data = bytes.slice(start, start + len);
    if (crc32(data) !== crc) throw new Error('damaged zip');
    out.push({name, bytes: data});
  }
  return out;
}
