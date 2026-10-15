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
    btn.innerHTML = `👤 Tài khoản`;
    btn.title = 'Lưu thông tin cá nhân hoặc chữ ký của bạn';
  }

  const notice = document.getElementById('intro-auth-notice');
  if (notice) {
    notice.innerHTML = `🎉 <b>Miễn phí 100% cho mọi người</b> — Toàn bộ tính năng cao cấp (Chuỗi liên hoàn, Ký tên, Canh lề NĐ30...) đều mở sẵn trên máy bạn.`;
    notice.style.background = '#f0fdf4';
    notice.style.borderColor = '#86efac';
    notice.style.color = '#166534';
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

  // Show login/profile form modal
  modal.innerHTML = `
    <div class="auth-modal-dialog">
      <div class="auth-modal-header">
        <h3>👤 Hồ Sơ Người Dùng (Cục Bộ)</h3>
        <button class="auth-modal-close" id="auth-close-btn">&times;</button>
      </div>
      <div class="auth-modal-body">
        <p style="font-size:13px; color:#475569; margin:0 0 16px 0; line-height:1.4;">
          Lưu họ tên và email hiển thị trên trình duyệt này để tự động điền khi ký tên số và đóng dấu tài liệu. Dữ liệu được lưu trữ an toàn trong máy của bạn (100% riêng tư).
        </p>

        <form id="auth-login-form">
          <div class="auth-form-group">
            <label for="auth-input-user">Họ và tên / Tên hiển thị:</label>
            <input type="text" id="auth-input-user" class="auth-input" placeholder="Ví dụ: Nguyễn Văn An" required autocomplete="name">
          </div>

          <div class="auth-form-group">
            <label for="auth-input-email">Email liên hệ (tùy chọn):</label>
            <input type="email" id="auth-input-email" class="auth-input" placeholder="Ví dụ: an.nguyen@gmail.com" autocomplete="email">
          </div>

          <div class="auth-actions">
            <button type="submit" class="auth-submit-btn">💾 Lưu Hồ Sơ</button>
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

  const doSave = (uVal, eVal) => {
    if (!uVal) {
      toast('Vui lòng nhập họ và tên!', 'error');
      return;
    }
    saveUser({
      username: uVal,
      displayName: uVal,
      email: eVal || `${uVal.toLowerCase().replace(/\s+/g, '.')}@local`,
      role: 'user',
      savedAt: new Date().toISOString()
    });
    close();
    toast(`🎉 Đã lưu hồ sơ thành công! Xin chào ${uVal}.`, 'success');
  };

  document.getElementById('auth-login-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const u = document.getElementById('auth-input-user')?.value.trim();
    const em = document.getElementById('auth-input-email')?.value.trim();
    doSave(u, em);
  });

  setTimeout(() => {
    document.getElementById('auth-input-user')?.focus();
  }, 100);
}

export function initAuth() {
  window.openLoginModal = openLoginModal;
  window.logoutUser = logoutUser;
  window.isUserLoggedIn = isLoggedIn;

  updateAuthUI();
}
