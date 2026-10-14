// POST /api/track  { action, uid }
// Chạy ở phía server nên link Google Apps Script nằm trong biến môi trường Vercel (APPS_SCRIPT_URL), không lộ ra trình duyệt.
import { storeReady, pipeline, ACTIONS, dayKey } from './_store.js';

// Simple in-memory rate limiter per IP / UID (max 60 requests / minute)
const rateMap = new Map();
function isRateLimited(key) {
  const now = Date.now();
  const win = 60 * 1000;
  const max = 60;
  let entry = rateMap.get(key);
  if (!entry || now - entry.reset > win) {
    entry = { count: 1, reset: now };
    rateMap.set(key, entry);
    // Cleanup old entries
    if (rateMap.size > 5000) {
      for (const [k, v] of rateMap.entries()) {
        if (now - v.reset > win) rateMap.delete(k);
      }
    }
    return false;
  }
  entry.count++;
  return entry.count > max;
}

async function forwardToAppsScript(action) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 5000);
  try {
    const form = new URLSearchParams({ action });
    if (process.env.APPS_SCRIPT_KEY) form.set('key', process.env.APPS_SCRIPT_KEY);
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
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ ok: false, error: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' });

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  const action = String(b?.action || ''), uid = String(b?.uid || '').slice(0, 64);
  if (!ACTIONS.has(action)) return res.status(400).json({ ok: false, error: 'action không hợp lệ' });

  const jobs = [];
  if (process.env.APPS_SCRIPT_URL) jobs.push(forwardToAppsScript(action));
  if (storeReady()) jobs.push(countInRedis(action, uid));
  if (!jobs.length) return res.status(202).json({ ok: true, stored: false });

  await Promise.allSettled(jobs);
  res.status(200).json({ ok: true, stored: true });
}
