// Tiện ích dùng chung cho các tab tính năng mới
export const $ = (s, r = document) => r.querySelector(s);

// Thêm một tab mới (nút + vùng nội dung) ngay trước tab "Giới thiệu"
export function addTab(id, label, html) {
  const aboutTab = document.getElementById('tab-about');
  const aboutBtn = [...document.querySelectorAll('.tab-btn')].find((b) => b.getAttribute('onclick')?.includes('tab-about'));
  if (!aboutTab || !aboutBtn) return null;
  const sec = Object.assign(document.createElement('div'), { id, className: 'tab-content', innerHTML: html });
  aboutTab.parentNode.insertBefore(sec, aboutTab);
  const btn = Object.assign(document.createElement('button'), { className: 'tab-btn', textContent: label });
  btn.setAttribute('onclick', `switchTab('${id}', this)`);
  aboutBtn.parentNode.insertBefore(btn, aboutBtn);
  return sec;
}

export const toast = (m, t) => window.toast?.(m, t);
export const log = (a) => { try { window.logAction?.(a); } catch (e) { /* bỏ qua */ } };

export function download(bytes, name, type = 'application/pdf') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// Lấy file font nhúng (base64 → Uint8Array); trả về null nếu font nền chưa tải xong
export function embeddedFontBytes(key = 'roboto', style = 'regular') {
  // Roboto nằm ở EMBEDDED_ROBOTO, các font còn lại ở EMBEDDED_FONTS
  const src = key === 'roboto' ? window.EMBEDDED_ROBOTO : window.EMBEDDED_FONTS?.[key];
  const b64 = src?.[style];
  if (!b64) return null;
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
