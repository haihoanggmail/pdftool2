import './styles/ux.css';
import './styles/word-ribbon.css';
import './styles/auth.css';
import { initSign } from './features/sign.js';
import { initForm } from './features/form.js';
import { initRedact } from './features/redact.js';
import { initEditorWordRibbon } from './features/editorWordRibbon.js';
import { initAuth } from './features/auth.js';

// Bảo mật: vá lỗ hổng CVE-2024-4367 trong pdfjs-dist bằng cách tắt hoàn toàn eval
(function patchPdfJsEvalSecurity() {
  function applyPatch() {
    if (window.pdfjsLib && window.pdfjsLib.getDocument && !window.pdfjsLib.__evalPatched) {
      const originalGetDocument = window.pdfjsLib.getDocument;
      window.pdfjsLib.getDocument = function (src) {
        if (typeof src === 'string' || src instanceof URL) {
          src = { url: String(src), isEvalSupported: false };
        } else if (src && typeof src === 'object') {
          if (src.isEvalSupported === undefined) src.isEvalSupported = false;
        }
        return originalGetDocument.apply(this, arguments);
      };
      window.pdfjsLib.__evalPatched = true;
    }
  }
  applyPatch();
  document.addEventListener('DOMContentLoaded', applyPatch);
  window.addEventListener('load', applyPatch);
})();

// ---------- Toast ----------
const toastBox = Object.assign(document.createElement('div'), { id: 'toast-box' });
document.body.appendChild(toastBox);
window.toast = function (msg, type = 'info', ms = 3500) {
  const el = Object.assign(document.createElement('div'), { className: 'toast toast-' + type, textContent: msg });
  toastBox.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
};

// ---------- Thanh tiến trình toàn cục ----------
const bar = Object.assign(document.createElement('div'), { id: 'global-progress', innerHTML: '<div class="gp-fill"></div><span class="gp-text"></span>' });
document.body.appendChild(bar);
window.Progress = {
  show(text = 'Đang xử lý...', pct = null) {
    bar.classList.add('on');
    bar.querySelector('.gp-text').textContent = text + (pct != null ? ` ${Math.round(pct)}%` : '');
    const f = bar.querySelector('.gp-fill');
    f.style.width = pct == null ? '100%' : pct + '%';
    f.classList.toggle('indeterminate', pct == null);
  },
  hide() { bar.classList.remove('on'); },
};

// ---------- Kéo thả file vào bất kỳ đâu ----------
const activeTabId = () => document.querySelector('.tab-content.active')?.id;
const targets = {
  'tab-main': 'file-input',
  'tab-merge': 'merge-input',
  'tab-editor': 'editor-file-input',
  'tab-word': 'w2d-input',
  'tab-excel': 'w2x-input',
  'tab-sign': 'sg-pdf',
  'tab-form': 'fm-pdf',
  'tab-redact': 'rd-pdf',
  'tab-tools': 'tl-input'
};
const overlay = Object.assign(document.createElement('div'), { id: 'drop-overlay', textContent: '📥 Thả file PDF / ảnh vào đây' });
document.body.appendChild(overlay);
let depth = 0;
const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; overlay.classList.add('on'); } });
addEventListener('dragleave', (e) => { if (hasFiles(e) && --depth <= 0) { depth = 0; overlay.classList.remove('on'); } });
addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('drop', (e) => {
  depth = 0; overlay.classList.remove('on');
  if (!hasFiles(e)) return;
  const inId = targets[activeTabId()];
  const input = inId && document.getElementById(inId);
  // Nếu thả đúng vào vùng đã có xử lý riêng của app thì để nguyên
  if (e.defaultPrevented || !input) return;
  e.preventDefault();
  const files = [...e.dataTransfer.files].filter((f) => /pdf|image/.test(f.type));
  if (!files.length) return window.toast('Chỉ hỗ trợ file PDF hoặc ảnh', 'error');
  const dt = new DataTransfer();
  (input.multiple ? files : files.slice(0, 1)).forEach((f) => dt.items.add(f));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  window.toast(`Đã nhận ${dt.files.length} file`, 'success');
});

// ---------- Phím tắt ----------
initSign();
initForm();
initRedact();
initEditorWordRibbon();
initAuth();
const tabs = ['tab-main', 'tab-merge', 'tab-compare', 'tab-editor'];
const help = Object.assign(document.createElement('div'), {
  id: 'shortcut-help',
  innerHTML: '<div class="sh-card"><h3>⌨️ Phím tắt</h3><p><kbd>Alt</kbd>+<kbd>1..4</kbd> Chuyển tab Xoay / Gộp / So sánh / Chỉnh sửa</p><p><kbd>Ctrl</kbd>+<kbd>O</kbd> Mở file ở tab hiện tại</p><p><kbd>Alt</kbd>+<kbd>D</kbd> Đổi sáng / tối</p><p><kbd>?</kbd> Hiện / ẩn bảng này &nbsp; <kbd>Esc</kbd> Đóng</p></div>',
});
help.addEventListener('click', () => help.classList.remove('on'));
document.body.appendChild(help);
addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable;
  if (e.key === 'Escape') help.classList.remove('on');
  if (typing) return;
  if (e.key === '?') return help.classList.toggle('on');
  if (e.altKey && /^[1-4]$/.test(e.key)) {
    e.preventDefault();
    const id = tabs[+e.key - 1];
    const btn = [...document.querySelectorAll('.tab-btn')].find((b) => b.getAttribute('onclick')?.includes(`'${id}'`));
    window.switchTab?.(id, btn);
  }
  if (e.altKey && e.key.toLowerCase() === 'd') { e.preventDefault(); window.toggleTheme?.(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
    const inId = targets[activeTabId()];
    if (inId) { e.preventDefault(); document.getElementById(inId).click(); }
  }
});
