// sync.mjs - Netlify Function v2: cloud sync via Netlify Blobs
import { getStore } from '@netlify/blobs';

const STORE = 'goal-board-sync';

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
      await store.setJSON(key, body);
      return json({ ok: true });
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

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }
  });
}
