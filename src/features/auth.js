// Authentication & User Login feature
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
    btn.innerHTML = `👤 ${user.displayName || user.username || 'Thành viên'} (Pro) ▾`;
    btn.title = 'Tài khoản đã đăng nhập - Bấm để xem thông tin';
  } else {
    btn.classList.remove('logged-in');
    btn.innerHTML = `🔐 Đăng nhập`;
    btn.title = 'Đăng nhập để sử dụng tính năng nâng cao';
  }

  // Update intro notice if present
  const notice = document.getElementById('intro-auth-notice');
  if (notice) {
    if (user) {
      notice.innerHTML = `✅ <b>Đã đăng nhập:</b> Xin chào <b>${user.displayName || user.username}</b>! Mọi tính năng nâng cao (Chuỗi liên hoàn, Ký số, Canh lề NĐ30...) đã sẵn sàng.`;
      notice.style.background = '#f0fdf4';
      notice.style.borderColor = '#86efac';
      notice.style.color = '#166534';
    } else {
      notice.innerHTML = `⭐ <b>Các tính năng cơ bản miễn phí để sử dụng các tính năng nâng cao cấp vui lòng đăng nhập</b>`;
      notice.style.background = '#fffbeb';
      notice.style.borderColor = '#fde68a';
      notice.style.color = '#b45309';
    }
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
    // Show logged-in profile modal
    modal.innerHTML = `
      <div class="auth-modal-dialog">
        <div class="auth-modal-header">
          <h3>👤 Thông Tin Tài Khoản</h3>
          <button class="auth-modal-close" id="auth-close-btn">&times;</button>
        </div>
        <div class="auth-modal-body">
          <div class="auth-user-card">
            <div class="user-title">Xin chào, ${user.displayName || user.username}!</div>
            <div class="user-role">👑 GÓI NÂNG CAO (PRO / ENTERPRISE)</div>
            <div style="font-size:12px; color:#475569; margin-bottom:8px;">
              Email: <b>${user.email || 'user@hachihi.vn'}</b>
            </div>
            <p style="font-weight:600; margin:6px 0 4px 0; font-size:12px; color:#166534;">
              Quyền hạn đã kích hoạt:
            </p>
            <ul class="auth-user-features">
              <li>Xử lý tài liệu và chuỗi tự động hóa không giới hạn</li>
              <li>Canh lề chuẩn NĐ30 & Đóng gáy hồ sơ tự động</li>
              <li>Chèn chữ ký điện tử trong suốt, đánh số trang tự động</li>
              <li>Xóa trang trắng thông minh, nén file PDF chuẩn xuất bản</li>
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

  // Show login form modal
  modal.innerHTML = `
    <div class="auth-modal-dialog">
      <div class="auth-modal-header">
        <h3>🔐 Đăng Nhập Tài Khoản</h3>
        <button class="auth-modal-close" id="auth-close-btn">&times;</button>
      </div>
      <div class="auth-modal-body">
        <p style="font-size:13px; color:#475569; margin:0 0 16px 0; line-height:1.4;">
          Vui lòng nhập tài khoản và mật khẩu để kích hoạt các tính năng nâng cao.
        </p>

        <form id="auth-login-form">
          <div class="auth-form-group">
            <label for="auth-input-user">Tên đăng nhập / Email</label>
            <input type="text" id="auth-input-user" class="auth-input" placeholder="admin hoặc email..." value="admin" required autocomplete="username">
          </div>

          <div class="auth-form-group">
            <label for="auth-input-pass">Mật khẩu</label>
            <input type="password" id="auth-input-pass" class="auth-input" placeholder="Nhập mật khẩu..." value="123456" required autocomplete="current-password">
          </div>

          <div class="auth-checkbox-row">
            <label class="auth-checkbox-label">
              <input type="checkbox" id="auth-remember" checked> Ghi nhớ đăng nhập
            </label>
            <span style="color:#0078d4; cursor:pointer;" id="auth-fill-demo">Điền mẫu nhanh</span>
          </div>

          <div class="auth-actions">
            <button type="submit" class="auth-submit-btn">Đăng Nhập</button>
            <button type="button" class="auth-demo-btn" id="auth-instant-demo">
              ⚡ Đăng nhập nhanh tài khoản dùng thử (admin)
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById('auth-close-btn')?.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  const fillDemo = () => {
    const u = document.getElementById('auth-input-user');
    const p = document.getElementById('auth-input-pass');
    if (u) u.value = 'admin';
    if (p) p.value = '123456';
  };

  document.getElementById('auth-fill-demo')?.addEventListener('click', fillDemo);

  const doLogin = (uVal, pVal) => {
    if (!uVal || !pVal) {
      toast('Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu!', 'error');
      return;
    }
    const displayName = uVal.toLowerCase() === 'admin' ? 'Quản Trị Viên' : uVal;
    saveUser({
      username: uVal,
      displayName,
      email: `${uVal.toLowerCase()}@hachihi.vn`,
      role: 'pro',
      loginAt: new Date().toISOString()
    });
    close();
    toast(`🎉 Đăng nhập thành công! Chào mừng ${displayName}.`, 'success');
  };

  document.getElementById('auth-login-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const u = document.getElementById('auth-input-user')?.value.trim();
    const p = document.getElementById('auth-input-pass')?.value;
    doLogin(u, p);
  });

  document.getElementById('auth-instant-demo')?.addEventListener('click', () => {
    doLogin('admin', '123456');
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
