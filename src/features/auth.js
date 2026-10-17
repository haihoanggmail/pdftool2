// Authentication & User Profile
import { toast } from './ui.js';

const STORAGE_KEY = 'pdf_tool_user';

export function getLoggedInUser() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function isLoggedIn() {
  return !!getLoggedInUser();
}

export function saveUser(user) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  } catch (e) {}
  updateAuthUI();
}

export function logoutUser() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {}
  updateAuthUI();
  toast('Đã đăng xuất tài khoản.', 'info');
}

export function updateAuthUI() {
  const btn = document.getElementById('nav-login-btn');
  if (!btn) return;

  const user = getLoggedInUser();
  if (user) {
    btn.classList.add('logged-in');
    btn.innerHTML = `👤 ${user.displayName || user.username || 'Thành viên'} ▾`;
    btn.title = 'Tài khoản người dùng - Bấm để xem thông tin';
  } else {
    btn.classList.remove('logged-in');
    btn.innerHTML = `👤 Đăng nhập`;
    btn.title = 'Đăng nhập tài khoản nội bộ';
  }
}

export function openLoginModal() {
  const existing = document.getElementById('auth-modal-overlay');
  if (existing) existing.remove();

  const user = getLoggedInUser();
  const modal = document.createElement('div');
  modal.id = 'auth-modal-overlay';
  modal.className = 'auth-modal-overlay';

  if (user) {
    modal.innerHTML = `
      <div class="auth-modal-dialog">
        <div class="auth-modal-header">
          <h3>👤 Thông Tin Tài Khoản</h3>
          <button class="auth-modal-close" id="auth-close-btn">&times;</button>
        </div>
        <div class="auth-modal-body">
          <div class="auth-user-card">
            <div class="user-title">Xin chào, ${user.displayName || user.username}!</div>
            <div class="user-role" style="background:#0284c7; color:#fff;">✨ TOÀN BỘ TÍNH NĂNG ĐÃ SẴN SÀNG</div>
            <div style="font-size:12px; color:#475569; margin-bottom:8px;">
              Email / Định danh: <b>${user.email || user.username || 'user@hachihi.vn'}</b>
            </div>
            <p style="font-weight:600; margin:6px 0 4px 0; font-size:12px; color:#166534;">
              Các công cụ hỗ trợ xử lý ngay trên trình duyệt:
            </p>
            <ul class="auth-user-features">
              <li>Chỉnh sửa trực tiếp file PDF giao diện Microsoft Word</li>
              <li>Canh lề trang theo Nghị định 30/2020/NĐ-CP & đóng gáy</li>
              <li>Chèn chữ ký điện tử độc lập, kéo thả di chuyển dễ dàng</li>
              <li>Bỏ trang trắng thông minh, nén PDF & tự động hóa</li>
            </ul>
          </div>

          <div class="auth-actions">
            <button class="auth-logout-btn" id="auth-logout-action">Đăng Xuất</button>
            <button class="auth-demo-btn" id="auth-close-action">Đóng</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    const close = () => modal.remove();
    document.getElementById('auth-close-btn')?.addEventListener('click', close);
    document.getElementById('auth-close-action')?.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.getElementById('auth-logout-action')?.addEventListener('click', () => {
      logoutUser();
      close();
    });
    return;
  }

  // Form đăng nhập
  modal.innerHTML = `
    <div class="auth-modal-dialog">
      <div class="auth-modal-header">
        <h3>🔐 Đăng nhập</h3>
        <button class="auth-modal-close" id="auth-close-btn">&times;</button>
      </div>
      <div class="auth-modal-body">
        <p style="font-size:13px; color:#475569; margin:0 0 16px 0; line-height:1.4;">
          Đăng nhập để sử dụng các tính năng cao cấp dành riêng cho nội bộ.
        </p>

        <form id="auth-login-form" autocomplete="on">
          <div class="auth-form-group">
            <label for="auth-input-user">Tên đăng nhập:</label>
            <input type="text" id="auth-input-user" class="auth-input" required autocomplete="username" autocapitalize="none" spellcheck="false">
          </div>

          <div class="auth-form-group">
            <label for="auth-input-pass">Mật khẩu:</label>
            <input type="password" id="auth-input-pass" class="auth-input" required autocomplete="current-password">
          </div>

          <div class="auth-error" id="auth-error" role="alert" style="display:none;"></div>

          <div class="auth-actions">
            <button type="submit" class="auth-submit-btn" id="auth-submit-btn">Đăng nhập</button>
            <button type="button" class="auth-demo-btn" id="auth-cancel-btn">Hủy</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById('auth-close-btn')?.addEventListener('click', close);
  document.getElementById('auth-cancel-btn')?.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  document.getElementById('auth-login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const uEl = document.getElementById('auth-input-user');
    const pEl = document.getElementById('auth-input-pass');
    const errEl = document.getElementById('auth-error');
    const btn = document.getElementById('auth-submit-btn');
    const u = (uEl?.value || '').trim();
    const p = pEl?.value || '';

    btn.disabled = true;
    btn.textContent = 'Đang kiểm tra...';
    errEl.style.display = 'none';

    const result = await verifyLogin(u, p);

    if (result && result.ok) {
      saveUser(result.user || { username: u, displayName: u, role: 'user', savedAt: new Date().toISOString() });
      close();
      toast(`🎉 Đăng nhập thành công! Xin chào ${u}.`, 'success');
      return;
    }

    errEl.textContent = (result && result.error) || 'Sai tên đăng nhập hoặc mật khẩu.';
    errEl.style.display = 'block';
    errEl.classList.remove('shake'); void errEl.offsetWidth; errEl.classList.add('shake');
    if (pEl) { pEl.value = ''; pEl.focus(); }
    btn.disabled = false;
    btn.textContent = 'Đăng nhập';
  });

  setTimeout(() => {
    document.getElementById('auth-input-user')?.focus();
  }, 100);
}

/**
 * KIỂM TRA ĐĂNG NHẬP.
 * Hiện tại LUÔN báo sai (chưa có hệ thống tài khoản).
 * Sau này thay thân hàm này bằng gọi API thật, ví dụ:
 *   const r = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'},
 *                                          body: JSON.stringify({ username, password }) });
 *   const j = await r.json();
 *   return j.ok ? { ok:true, user:{ username, displayName: j.name || username, role: j.role || 'user' } }
 *               : { ok:false, error:'Sai tên đăng nhập hoặc mật khẩu.' };
 * Lưu ý: KHÔNG kiểm tra mật khẩu bằng JavaScript phía trình duyệt (ai cũng đọc được), phải kiểm tra ở server.
 */
async function verifyLogin(username, password) {
  await new Promise((r) => setTimeout(r, 400));
  return { ok: false, error: 'Sai tên đăng nhập hoặc mật khẩu.' };
}

export function initAuth() {
  window.openLoginModal = openLoginModal;
  window.logoutUser = logoutUser;
  window.isUserLoggedIn = isLoggedIn;

  // Bản cũ cho lưu hồ sơ bất kỳ; nay phải đăng nhập thật nên bỏ hồ sơ cũ còn sót trong trình duyệt
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}

  updateAuthUI();
}
