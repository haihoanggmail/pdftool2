// Lưu trữ bộ đếm bằng Upstash Redis (REST) – biến môi trường đặt trên Vercel.
// Hỗ trợ cả tên biến của Vercel KV/Upstash Marketplace lẫn tên gốc của Upstash.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const storeReady = () => Boolean(URL_ && TOKEN);

// Gửi nhiều lệnh Redis trong một request: [["HINCRBY","k","f",1], ...]
export async function pipeline(commands) {
  const r = await fetch(`${URL_}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error('Upstash ' + r.status);
  return (await r.json()).map((x) => x.result);
}

// Danh sách thao tác hợp lệ (chặn rác ghi vào bộ đếm)
export const ACTIONS = new Set([
  'pdf_to_word', 'pdf_to_excel', 'save_pdf', 'goppdf', 'edit_pdf', 'compare_pdf',
  'sign_pdf', 'fill_form', 'redact_pdf', 'stamp_pdf', 'batch_pdf', 'visit', 'view', 'open_file',
]);
export const dayKey = (d = new Date()) => d.toISOString().slice(0, 10); // theo UTC
