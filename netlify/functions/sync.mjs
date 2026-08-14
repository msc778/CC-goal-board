// sync.mjs - Netlify Function v2: cloud sync via Netlify Blobs (item-level 3-way merge)
import { getStore } from '@netlify/blobs';

const STORE = 'goal-board-sync';
const COLLECTIONS = ['goals','tasks','checkins','events','pomodoros','ledgers','bills','memos','clothes'];

export default async (req, context) => {
  const url = new URL(req.url);
  const key = (url.searchParams.get('key') || '').trim();
  if (!key) return json({ error: 'missing key' }, 400);
  const store = getStore(STORE);
  try {
    if (req.method === 'GET') {
      const data = await store.get(key, { type: 'json', consistency: 'strong' });
      return json({ data: data || null });
    }
    if (req.method === 'POST') {
      const body = await req.json();
      if (!body || typeof body !== 'object') return json({ error: 'bad body' }, 400);
      const existing = await store.get(key, { type: 'json', consistency: 'strong' });
      const merged = mergeDB(existing, body);
      await store.setJSON(key, merged);
      return json({ ok: true, data: merged });
    }
    if (req.method === 'DELETE') {
      await store.delete(key);
      return json({ ok: true });
    }
    return json({ error: 'method not allowed' }, 405);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
};

function obj(x){ return (x && typeof x === 'object') ? x : {}; }
function num(x){ return Number(x) || 0; }
function itemTs(it){ return num(it.updatedAt) || num(it.createdAt); }

export function mergeDB(existing, incoming) {
  const a = obj(existing), b = obj(incoming);
  const del = mergeDeleted(a.deleted, b.deleted);
  const out = { schemaVersion: 1, deleted: del };
  for (const col of COLLECTIONS) out[col] = mergeCol(a[col], b[col], del[col] || {});
  out.settings = mergeSettings(a.settings, b.settings, metaTs(a.meta), metaTs(b.meta), del.rewards || {});
  out.meta = mergeMeta(a.meta, b.meta);
  return out;
}

function mergeCol(al, bl, tombs) {
  const map = new Map();
  for (const it of (Array.isArray(al) ? al : [])) if (it && it.id) map.set(it.id, it);
  for (const it of (Array.isArray(bl) ? bl : [])) if (it && it.id) {
    const cur = map.get(it.id);
    map.set(it.id, cur ? pickItem(cur, it) : it);
  }
  const out = [];
  for (const it of map.values()) {
    if (tombs[it.id] && tombs[it.id] >= itemTs(it)) continue;
    out.push(it);
  }
  return out;
}

function pickItem(a, b) {
  const au = num(a.updatedAt), bu = num(b.updatedAt);
  if (au || bu) {
    if (bu > au) return b;
    if (au > bu) return a;
    return b;
  }
  return num(b.createdAt) >= num(a.createdAt) ? b : a;
}

function mergeDeleted(a, b) {
  const A = obj(a), B = obj(b);
  const out = {};
  for (const col of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const ma = obj(A[col]), mb = obj(B[col]);
    const m = {};
    for (const id of new Set([...Object.keys(ma), ...Object.keys(mb)])) {
      const v = Math.max(num(ma[id]), num(mb[id]));
      if (v > 0) m[id] = v;
    }
    if (Object.keys(m).length) out[col] = m;
  }
  return out;
}

function mergeSettings(a, b, ta, tb, rewardTombs) {
  const A = obj(a), B = obj(b);
  const newer = (tb || 0) >= (ta || 0) ? B : A;
  const out = {};
  out.rewards = mergeCol(A.rewards, B.rewards, rewardTombs);
  out.kw = mergeKw(A.kw, B.kw);
  out.expCats = unionArr(A.expCats, B.expCats);
  out.holidays = unionArr(A.holidays, B.holidays);
  out.autoDefer = typeof newer.autoDefer === 'boolean' ? newer.autoDefer : true;
  out.budget = mergeBudget(A.budget, B.budget);
  const As = obj(A.sync), Bs = obj(B.sync);
  out.sync = {
    enabled: !!(As.enabled || Bs.enabled),
    key: String(As.key || Bs.key || '').trim(),
    lastSyncAt: Math.max(num(As.lastSyncAt), num(Bs.lastSyncAt)) || null,
    serverUpdatedAt: Math.max(num(As.serverUpdatedAt), num(Bs.serverUpdatedAt)) || 0
  };
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
    if (!(k in out)) out[k] = (k in newer) ? newer[k] : (k in A ? A[k] : B[k]);
  }
  return out;
}

function mergeKw(a, b) {
  const A = obj(a), B = obj(b);
  const out = {};
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const x = Array.isArray(A[k]) ? A[k] : [];
    const y = Array.isArray(B[k]) ? B[k] : [];
    out[k] = [...new Set([...x, ...y])];
  }
  return out;
}

function unionArr(a, b) {
  const x = Array.isArray(a) ? a : [];
  const y = Array.isArray(b) ? b : [];
  const seen = new Set();
  const out = [];
  for (const it of [...x, ...y]) {
    if (it !== undefined && it !== null && !seen.has(it)) { seen.add(it); out.push(it); }
  }
  return out;
}

function mergeBudget(a, b) {
  const A = obj(a), B = obj(b);
  const out = {};
  for (const lid of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const x = A[lid], y = B[lid];
    if (x && y) {
      out[lid] = {
        monthly: Math.max(num(x.monthly), num(y.monthly)),
        categories: Object.assign({}, obj(x.categories), obj(y.categories))
      };
    } else {
      out[lid] = x || y;
    }
  }
  return out;
}

function metaTs(m) { return num(obj(m).updatedAt); }

function mergeMeta(a, b) {
  const A = obj(a), B = obj(b);
  const ca = num(A.createdAt), cb = num(B.createdAt);
  const ua = num(A.updatedAt), ub = num(B.updatedAt);
  return {
    createdAt: ca && cb ? Math.min(ca, cb) : (ca || cb || Date.now()),
    updatedAt: Math.max(ua, ub) || Date.now(),
    lastAutoDeferDate: maxStr(A.lastAutoDeferDate, B.lastAutoDeferDate)
  };
}

function maxStr(x, y) {
  const s = [x, y].filter(v => typeof v === 'string' && v);
  return s.length ? s.slice().sort().pop() : null;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }
  });
}