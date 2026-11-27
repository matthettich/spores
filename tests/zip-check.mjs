/* tests/zip-check.mjs (dev only): js/zip.js round trip + a real unzip. Run: node tests/zip-check.mjs */
import {zipWrite, zipRead, isZip, crc32} from '../js/zip.js';
import {writeFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
const enc = new TextEncoder();
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const wav = new Uint8Array(70000).map((_, i) => (i * 31 + 7) & 255);
const files = [{name: 'song.json', bytes: enc.encode('{"v":1,"é":"ü"}')}, {name: 'audio/t1.wav', bytes: wav}, {name: 'empty.bin', bytes: new Uint8Array(0)}];
const z = zipWrite(files);
ok(isZip(z), 'starts like a zip');
ok(crc32(enc.encode('123456789')) === 0xCBF43926, 'crc32 check value');
const back = zipRead(z);
ok(back.length === 3 && back.every((f, i) => f.name === files[i].name && f.bytes.length === files[i].bytes.length && f.bytes.every((b, j) => b === files[i].bytes[j])), 'write → read gives identical names and bytes');
let threw = false; try { zipRead(z.slice(0, 100)); } catch (e) { threw = true; } ok(threw, 'truncated zip is refused');
const dmg = z.slice(); dmg[40] ^= 255; threw = false; try { zipRead(dmg); } catch (e) { threw = true; } ok(threw, 'flipped byte is refused (crc)');
writeFileSync('/tmp/zipcheck.zip', z);
try { console.log(execSync('python3 -I -c "import zipfile;z=zipfile.ZipFile(\'/tmp/zipcheck.zip\');print(z.testzip(),[i.filename for i in z.infolist()])"').toString().trim()); ok(true, 'python zipfile reads it'); } catch (e) { ok(false, 'python zipfile'); }
try { execSync('unzip -tq /tmp/zipcheck.zip', {stdio: 'pipe'}); ok(true, 'unzip -t passes'); } catch (e) { console.log(String(e.stdout)); ok(false, 'unzip -t'); }
process.exit(bad ? 1 : 0);
