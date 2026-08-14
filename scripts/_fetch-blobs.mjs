// _fetch-blobs.mjs - download + untar @netlify/blobs into node_modules (no external deps)
import { gunzipSync } from 'node:zlib';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';

const root = process.cwd();
const dest = join(root, 'node_modules/@netlify/blobs');
const url = 'https://registry.npmjs.org/@netlify/blobs/-/blobs-8.1.0.tgz';

const res = await fetch(url);
if (!res.ok) throw new Error('download failed ' + res.status);
const buf = Buffer.from(await res.arrayBuffer());
const tar = gunzipSync(buf);

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

const strip = n => { const parts = n.split('/'); while (parts.length && (parts[0] === 'package' || parts[0] === '')) parts.shift(); return parts.join('/'); };

let offset = 0;
let longName = null;
let count = 0;
while (offset + 512 <= tar.length) {
  const header = tar.subarray(offset, offset + 512);
  if (header.every(b => b === 0)) break;
  let name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
  const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
  const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim() || '0', 8);
  const type = String.fromCharCode(header[156]);
  if (prefix) name = prefix + '/' + name;
  offset += 512;
  const data = tar.subarray(offset, offset + size);
  offset += Math.ceil(size / 512) * 512;
  if (type === 'L') { longName = data.toString('utf8').replace(/\0.*$/, ''); continue; }
  const clean = strip(name);
  if (!clean) continue;
  if (type === '5') { mkdirSync(join(dest, clean), { recursive: true }); continue; }
  if (type === '0' || type === '\u0000' || type === '') {
    if (longName) { name = strip(longName); longName = null; }
    const p = join(dest, clean);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, data);
    count++;
  }
}
console.log('extracted files:', count, '->', dest);