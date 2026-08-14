// deploy-netlify.mjs - deploy files + a serverless function to Netlify via REST API
// env: NETLIFY_AUTH_TOKEN (required), NETLIFY_SITE_ID (optional; else resolved by name)
// usage: node scripts/deploy.mjs [siteName]
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const token = process.env.NETLIFY_AUTH_TOKEN;
if (!token) { console.error('Missing NETLIFY_AUTH_TOKEN'); process.exit(1); }
const siteName = process.argv[2] || 'lifelong-goal-board';
const siteIdEnv = process.env.NETLIFY_SITE_ID || '';
const root = process.cwd();

const API = 'https://api.netlify.com/api/v1';
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    method: opts.method || 'GET',
    headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) },
    body: opts.body
  });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error('API ' + res.status + ' ' + path + ': ' + text.slice(0, 300)), { status: res.status });
  return text ? JSON.parse(text) : null;
}

// ---- site ----
let site = null;
if (siteIdEnv) {
  site = await api('/sites/' + siteIdEnv);
  console.log('site (by id):', site.url);
} else {
  try {
    site = await api('/sites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: siteName }) });
    console.log('created site:', site.url);
  } catch (e) {
    const list = await api('/sites?filter=all&per_page=200');
    site = list.find(x => x.name === siteName) || null;
    if (!site) throw new Error('site not found: ' + siteName);
    console.log('reusing site:', site.url);
  }
}

// ---- files ----
const files = {};
function walk(d) {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else {
      const rel = relative(root, p).split(sep).join('/');
      files[rel] = createHash('sha1').update(readFileSync(p)).digest('hex');
    }
  }
}
walk(root);
for (const k of Object.keys(files)) {
  if (k.startsWith('.git/') || k.startsWith('node_modules/') || k.startsWith('build/') || k.startsWith('.github/') || k.startsWith('netlify/') || k === 'package.json' || k === 'package-lock.json' || k === 'pnpm-lock.yaml' || k === 'netlify.toml' || k === 'README.md' || k === '.gitignore' || k.endsWith('.mjs') && k.startsWith('scripts/')) delete files[k];
}
console.log('files:', Object.keys(files).join(','));

// ---- manual recursive copy (fs.cpSync crashes on this Windows setup) ----
function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const sp = join(src, name);
    const dp = join(dst, name);
    if (statSync(sp).isDirectory()) copyDir(sp, dp);
    else { mkdirSync(dirname(dp), { recursive: true }); writeFileSync(dp, readFileSync(sp)); }
  }
}

// ---- pure-JS zip writer ----
let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c; }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}
function zipDir(dir) {
  const entries = [];
  (function walkZip(d, rel) {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const r = rel ? rel + '/' + name : name;
      if (statSync(p).isDirectory()) walkZip(p, r);
      else entries.push({ path: r, data: readFileSync(p) });
    }
  })(dir, '');
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.path, 'utf8');
    const crc = crc32(e.data);
    const comp = deflateRawSync(e.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(0, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(8, 12);
    lh.writeUInt32LE(0, 14); lh.writeUInt32LE(0, 18);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    chunks.push(lh, nameBuf, comp);
    central.push({ nameBuf, crc, compLen: comp.length, size: e.data.length, offset });
    offset += lh.length + nameBuf.length + comp.length;
  }
  const cdStart = offset;
  const cdChunks = [];
  for (const c of central) {
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10); cd.writeUInt16LE(0, 12); cd.writeUInt16LE(8, 14);
    cd.writeUInt32LE(c.crc, 16); cd.writeUInt32LE(c.compLen, 20); cd.writeUInt32LE(c.size, 24);
    cd.writeUInt16LE(c.nameBuf.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32); cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38); cd.writeUInt32LE(c.offset, 42);
    cdChunks.push(cd, c.nameBuf);
  }
  const cdSize = cdChunks.reduce((a, c) => a + c.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(cdStart, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, ...cdChunks, eocd]);
}

// ---- function bundle ----
const fnDir = join(root, 'netlify/functions');
let functions = null;
let fnZipBuf = null;
if (existsSync(fnDir)) {
  const build = join(root, 'build/fn-sync');
  rmSync(build, { recursive: true, force: true });
  mkdirSync(build, { recursive: true });
  const entryName = ['sync.cjs', 'sync.js', 'sync.mjs'].find(n => existsSync(join(fnDir, n))) || 'sync.mjs';
  writeFileSync(join(build, entryName), readFileSync(join(fnDir, entryName)));
  if (entryName.endsWith('.mjs')) writeFileSync(join(build, 'package.json'), '{"type":"module","main":"sync.mjs"}');
  if (existsSync(join(fnDir, 'vendor'))) copyDir(join(fnDir, 'vendor'), join(build, 'vendor'));
  fnZipBuf = zipDir(build);
  const dotnetZip = join(root, 'build/sync-dotnet.zip');
  if (existsSync(dotnetZip)) { fnZipBuf = readFileSync(dotnetZip); console.log('using dotnet-built zip'); }
  functions = { sync: createHash('sha1').update(fnZipBuf).digest('hex') };
  console.log('function bundle:', functions.sync, '| zip bytes:', fnZipBuf.length);
}

// ---- create deploy ----
const body = { files };
if (functions) body.functions = functions;
const deploy = await api('/sites/' + site.id + '/deploys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
console.log('deploy id:', deploy.id, '| state:', deploy.state);
console.log('deploy keys:', Object.keys(deploy).sort().join(','));

// ---- upload files ----
const required = Array.isArray(deploy.required) ? deploy.required : [];
const shaToRel = {};
for (const [rel, sha] of Object.entries(files)) shaToRel[sha] = rel;
const base = deploy.upload_url || ('https://api.netlify.com/api/v1/deploys/' + deploy.id + '/files');
let uploadedFiles = 0;
for (const sha of required) {
  const rel = shaToRel[sha];
  if (!rel) continue;
  const res = await fetch(base + '/' + sha, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/octet-stream' }, body: readFileSync(join(root, rel.split('/').join(sep))) });
  if (!res.ok) throw new Error('file upload failed ' + rel + ' ' + res.status);
  uploadedFiles++;
}
console.log('uploaded files:', uploadedFiles);

// ---- upload function ----
let uploadedFns = 0;
if (functions && fnZipBuf) {
  const rf = deploy.required_functions;
  console.log('required_functions:', JSON.stringify(rf).slice(0, 200));
  let fnNames = Object.keys(functions);
  for (const name of fnNames) {
    const res = await fetch(base + '/functions/' + name, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/zip' }, body: fnZipBuf });
    const txt = await res.text();
    console.log('function upload', name, 'status:', res.status, res.ok ? 'OK' : txt.slice(0, 200));
    if (res.ok) uploadedFns++;
  }
}
console.log('uploaded functions:', uploadedFns);

const fin = await api('/deploys/' + deploy.id);
console.log('final state:', fin.state);
console.log('LIVE:', site.url);