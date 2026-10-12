// POST /api/track  { action, uid }
// Chạy ở phía server nên link Google Apps Script nằm trong biến môi trường Vercel (APPS_SCRIPT_URL), không lộ ra trình duyệt.
//  - Có APPS_SCRIPT_URL  → chuyển tiếp { action } sang Apps Script (giống cách cũ, ghi vào Google Sheet của bạn)
//  - Có KV_REST_API_*    → đồng thời đếm vào Upstash Redis (xem ở /stats.html)
// Dùng một trong hai hoặc cả hai; chưa đặt biến nào thì bỏ qua êm.
import { storeReady, pipeline, ACTIONS, dayKey } from './_store.js';

async function forwardToAppsScript(action) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 5000);
  try {
    // Apps Script trả 302 sang script.googleusercontent.com → để fetch tự theo redirect
    const form = new URLSearchParams({ action });
    if (process.env.APPS_SCRIPT_KEY) form.set('key', process.env.APPS_SCRIPT_KEY);   // mật khẩu chung với Apps Script (Script property SECRET)
    await fetch(process.env.APPS_SCRIPT_URL, { method: 'POST', body: form, redirect: 'follow', signal: ctl.signal });
  } finally { clearTimeout(t); }
}

async function countInRedis(action, uid) {
  const d = dayKey(), dayHash = `pdftool:actions:${d}`, dayUsers = `pdftool:users:${d}`, TTL = 60 * 60 * 24 * 400;
  const cmds = [['HINCRBY', 'pdftool:actions', action, 1], ['HINCRBY', dayHash, action, 1], ['EXPIRE', dayHash, TTL]];
  if (uid) cmds.push(['PFADD', 'pdftool:users', uid], ['PFADD', dayUsers, uid], ['EXPIRE', dayUsers, TTL]);
  await pipeline(cmds);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  const action = String(b?.action || ''), uid = String(b?.uid || '').slice(0, 64);
  if (!ACTIONS.has(action)) return res.status(400).json({ ok: false, error: 'action không hợp lệ' });

  const jobs = [];
  if (process.env.APPS_SCRIPT_URL) jobs.push(forwardToAppsScript(action));
  if (storeReady()) jobs.push(countInRedis(action, uid));
  if (!jobs.length) return res.status(202).json({ ok: true, stored: false });

  await Promise.allSettled(jobs);               // lỗi một bên không ảnh hưởng người dùng
  res.status(200).json({ ok: true, stored: true });
}
