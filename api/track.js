// POST /api/track  { action, uid }  → tăng bộ đếm thao tác + đếm người dùng duy nhất (HyperLogLog)
import { storeReady, pipeline, ACTIONS, dayKey } from './_store.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  const action = String(b?.action || '');
  const uid = String(b?.uid || '').slice(0, 64);
  if (!ACTIONS.has(action)) return res.status(400).json({ ok: false, error: 'action không hợp lệ' });
  // Chưa cấu hình kho lưu trữ → bỏ qua êm, không làm lỗi app
  if (!storeReady()) return res.status(202).json({ ok: true, stored: false });
  const d = dayKey(), dayHash = `pdftool:actions:${d}`, dayUsers = `pdftool:users:${d}`;
  try {
    const cmds = [
      ['HINCRBY', 'pdftool:actions', action, 1],
      ['HINCRBY', dayHash, action, 1],
      ['EXPIRE', dayHash, 60 * 60 * 24 * 400],
    ];
    if (uid) cmds.push(['PFADD', 'pdftool:users', uid], ['PFADD', dayUsers, uid], ['EXPIRE', dayUsers, 60 * 60 * 24 * 400]);
    await pipeline(cmds);
    res.status(200).json({ ok: true, stored: true });
  } catch (e) {
    res.status(200).json({ ok: false }); // không để lỗi lưu trữ ảnh hưởng người dùng
  }
}
