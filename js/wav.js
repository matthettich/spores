/* js/wav.js: WAV files in and out, no libraries.
 *
 *   wavBytes(data, sr, bits = 32)  → Uint8Array   data = a Float32Array (mono) or [L, R, …] (interleaved); bits 32 = 32-bit float (exact, used for loop takes in .spores
 *                                                 files), 24 / 16 = PCM (24-bit: Export). PCM writing adapted from
 *                                                 ...Thunder Plus (wavBytes, index.html).
 *   wavRead(bytes)                 → {sr, data: Float32Array}   PCM 8 / 16 / 24 / 32 and float 32 / 64, any channel
 *                                                 count (mixed to mono); throws on anything else.
 */
export function wavBytes(data, sr, bits = 32){
  const chs = Array.isArray(data) ? data : [data], C = chs.length, bps = bits / 8, n = chs[0].length, float = bits === 32, extra = float ? 12 : 0;   // float files carry a 'fact' chunk
  const buf = new ArrayBuffer(44 + extra + n * bps * C), dv = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + extra + n * bps * C, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, float ? 3 : 1, true); dv.setUint16(22, C, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * bps * C, true);
  dv.setUint16(32, bps * C, true); dv.setUint16(34, bits, true);
  let o = 36;
  if (float){ w(o, 'fact'); dv.setUint32(o + 4, 4, true); dv.setUint32(o + 8, n, true); o += 12; }
  w(o, 'data'); dv.setUint32(o + 4, n * bps * C, true); o += 8;
  if (float && C === 1){ new Float32Array(buf, o, n).set(chs[0]); return new Uint8Array(buf); }   // (o is a multiple of 4; little-endian on every machine we run on)
  const u = new Uint8Array(buf);
  for (let i = 0; i < n; i++) for (let c = 0; c < C; c++){
    const x = chs[c][i];
    if (float){ dv.setFloat32(o, x, true); o += 4; continue; }
    const s = x > 1 ? 1 : x < -1 ? -1 : x || 0;
    if (bits === 16){ dv.setInt16(o, Math.round(s * 32767), true); o += 2; }
    else { const v = Math.round(s * 8388607); u[o] = v & 255; u[o + 1] = (v >> 8) & 255; u[o + 2] = (v >> 16) & 255; o += 3; }
  }
  return u;
}

export function wavRead(bytes){
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const id = o => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (bytes.length < 12 || id(0) !== 'RIFF' || id(8) !== 'WAVE') throw new Error('not a WAV file');
  let fmt = null, p = 12;
  while (p + 8 <= bytes.length){
    const name = id(p), len = dv.getUint32(p + 4, true), body = p + 8;
    if (name === 'fmt '){
      let tag = dv.getUint16(body, true);
      if (tag === 0xFFFE && len >= 26) tag = dv.getUint16(body + 24, true);   // WAVE_FORMAT_EXTENSIBLE: the sub-format's tag
      fmt = {tag, ch: dv.getUint16(body + 2, true), sr: dv.getUint32(body + 4, true), bits: dv.getUint16(body + 14, true)};
    } else if (name === 'data'){
      if (!fmt) throw new Error('WAV file without a format');
      const {tag, ch, sr, bits} = fmt, bps = bits / 8, end = Math.min(bytes.length, body + len), frames = Math.floor((end - body) / (bps * ch));
      if (!ch || !(tag === 1 && [8, 16, 24, 32].includes(bits)) && !(tag === 3 && (bits === 32 || bits === 64))) throw new Error('unsupported WAV format');
      const out = new Float32Array(frames);
      if (tag === 3 && bits === 32 && ch === 1 && (bytes.byteOffset + body) % 4 === 0) out.set(new Float32Array(bytes.buffer, bytes.byteOffset + body, frames));
      else for (let i = 0; i < frames; i++){
        let sum = 0;
        for (let c = 0; c < ch; c++){
          const o = body + (i * ch + c) * bps;
          sum += tag === 3 ? (bits === 32 ? dv.getFloat32(o, true) : dv.getFloat64(o, true))
            : bits === 8 ? (bytes[o] - 128) / 128 : bits === 16 ? dv.getInt16(o, true) / 32768
            : bits === 24 ? (((bytes[o + 2] << 24) | (bytes[o + 1] << 16) | (bytes[o] << 8)) >> 8) / 8388608 : dv.getInt32(o, true) / 2147483648;
        }
        out[i] = sum / ch;
      }
      return {sr, data: out};
    }
    p = body + len + (len & 1);   // chunks are padded to an even length
  }
  throw new Error('WAV file without audio');
}
