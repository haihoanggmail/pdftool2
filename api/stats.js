// GET /api/stats  (header x-stats-key hoặc ?key=)  → tổng quan lượt dùng; khóa đặt ở biến STATS_KEY trên Vercel
import { storeReady, pipeline, dayKey } from './_store.js';

export default async function handler(req, res) {
  const need = process.env.STATS_KEY;
  const given = req.headers['x-stats-key'] || req.query?.key;
  if (!need || given !== need) return res.status(401).json({ ok: false, error: 'Sai khóa hoặc chưa đặt STATS_KEY' });
  if (!storeReady()) return res.status(503).json({ ok: false, error: 'Chưa cấu hình Upstash Redis' });
  const days = Math.min(90, Math.max(1, parseInt(req.query?.days || '30', 10) || 30));
  const list = Array.from({ length: days }, (_, i) => dayKey(new Date(Date.now() - i * 864e5)));
  const cmds = [['HGETALL', 'pdftool:actions'], ['PFCOUNT', 'pdftool:users']];
  list.forEach((d) => cmds.push(['HGETALL', `pdftool:actions:${d}`], ['PFCOUNT', `pdftool:users:${d}`]));
  const out = await pipeline(cmds);
  const toObj = (a) => Object.fromEntries((a || []).reduce((r, v, i, arr) => (i % 2 ? r : [...r, [v, +arr[i + 1]]]), []));
  const daily = list.map((d, i) => ({ date: d, users: out[3 + i * 2], actions: toObj(out[2 + i * 2]) }));
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, totalActions: toObj(out[0]), totalUsers: out[1], daily });
}
