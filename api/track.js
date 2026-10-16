// POST /api/track  { action, detail, uid, sid, lang, screen }
// Chạy ở phía server nên link Google Apps Script nằm trong biến môi trường Vercel (APPS_SCRIPT_URL), không lộ ra trình duyệt.
// IP, quốc gia, thành phố, User-Agent được lấy từ header của request (Vercel tự thêm).
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

// Làm sạch chuỗi: bỏ ký tự điều khiển, cắt độ dài
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const safeDecode = (v) => { try { return decodeURIComponent(String(v ?? '')); } catch { return String(v ?? ''); } };
const header = (req, k) => { const v = req.headers[k]; return Array.isArray(v) ? v[0] : v; };

function getClientIp(req) {
  const xff = String(header(req, 'x-forwarded-for') || '').split(',')[0].trim();
  return xff || String(header(req, 'x-real-ip') || '') || req.socket?.remoteAddress || 'unknown';
}

async function forwardToAppsScript(rec) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
  try {
    const form = new URLSearchParams(rec);
    if (process.env.APPS_SCRIPT_KEY) form.set('key', process.env.APPS_SCRIPT_KEY);
    const r = await fetch(process.env.APPS_SCRIPT_URL, { method: 'POST', body: form, redirect: 'follow', signal: ctl.signal });
    const txt = await r.text();
    let j;
    try { j = JSON.parse(txt); }
    catch { throw new Error('Apps Script trả về HTML (sai URL hoặc chưa cho "Anyone" truy cập): ' + txt.slice(0, 120)); }
    if (!j.ok) throw new Error('Apps Script: ' + j.error);
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
  const ip = getClientIp(req);
  if (isRateLimited(ip)) return res.status(429).json({ ok: false, error: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' });

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};
  const action = String(b.action || ''), uid = clean(b.uid, 64);
  if (!ACTIONS.has(action)) return res.status(400).json({ ok: false, error: 'action không hợp lệ' });

  // Bản ghi gửi sang Google Sheet (thứ tự cột do Apps Script quyết định)
  const rec = {
    action,
    detail: clean(b.detail, 200),
    ip: clean(ip, 64),
    country: clean(header(req, 'x-vercel-ip-country'), 8),
    city: clean(safeDecode(header(req, 'x-vercel-ip-city')), 80),
    visitorId: uid,
    sessionId: clean(b.sid, 64),
    userAgent: clean(header(req, 'user-agent'), 300),
    lang: clean(b.lang, 20),
    screen: clean(b.screen, 20),
  };

  const jobs = [];
  if (process.env.APPS_SCRIPT_URL) jobs.push(forwardToAppsScript(rec));
  if (storeReady()) jobs.push(countInRedis(action, uid));
  if (!jobs.length) return res.status(202).json({ ok: true, stored: false });

  const results = await Promise.allSettled(jobs);
  results.forEach((r) => { if (r.status === 'rejected') console.error('[track]', r.reason?.message || r.reason); });
  const failed = results.some((r) => r.status === 'rejected');
  res.status(failed ? 502 : 200).json({ ok: !failed, stored: !failed });
}
