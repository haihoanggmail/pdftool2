// Microsoft Word style Ribbon Bar for PDF Editor
// Allows picking tools, margins, removing blank pages, page numbering, signing, watermarking,
// and 1-click multi-step pipelines directly on the opened document!

let docUndoStack = [];
let signatureModal = null;
let ribbonCollapsed = false;

// Initialize Word Ribbon in tab-editor
export function initEditorWordRibbon() {
  const tabEditor = document.getElementById('tab-editor');
  if (!tabEditor) return;

  // Create ribbon container if not already present
  if (!document.getElementById('word-ribbon-bar')) {
    const ribbonEl = document.createElement('div');
    ribbonEl.id = 'word-ribbon-bar';
    ribbonEl.className = 'word-ribbon';
    ribbonEl.innerHTML = buildRibbonHTML();
    tabEditor.insertBefore(ribbonEl, tabEditor.firstChild);

    wireRibbonEvents();
  }

  // Hook global notification when doc is loaded in editor
  window.onEditorDocLoaded = updateRibbonDocState;
  updateRibbonDocState();
}

function buildRibbonHTML() {
  return `
    <div class="ribbon-tabs-bar">
      <button class="ribbon-file-btn" id="rb-file-menu-btn" title="Menu Tệp / File">📁 TỆP</button>
      <button class="ribbon-tab-btn active" data-tab="home">🏠 Trang chủ</button>
      <button class="ribbon-tab-btn" data-tab="layout">📐 Bố trí & Canh lề</button>
      <button class="ribbon-tab-btn" data-tab="insert">➕ Chèn & Ký tên</button>
      <button class="ribbon-tab-btn highlight" data-tab="pipeline">⚡ Chuỗi liên hoàn & Công cụ</button>

      <div class="ribbon-right-tools">
        <div class="ribbon-doc-badge" id="rb-doc-badge">
          <span>📄 Chưa mở file</span>
        </div>
        <button class="rb-btn-compact" id="rb-doc-undo-btn" style="display:none; color:#b91c1c; font-weight:bold;" title="Khôi phục trạng thái tài liệu trước khi chạy công cụ">
          ↩ Hoàn tác công cụ (<span id="rb-undo-count">0</span>)
        </button>
        <button class="rb-btn-compact" id="rb-save-btn" style="background:#059669; color:#fff; border-color:#047857; font-weight:bold;" title="Tải file PDF đã chỉnh sửa về máy">
          💾 Lưu file
        </button>
        <button class="rb-btn-compact" id="rb-toggle-collapse" title="Thu gọn / Mở rộng thanh công cụ">▲</button>
      </div>
    </div>

    <div class="ribbon-panels" id="rb-panels-container">
      <!-- 1. HOME PANEL -->
      <div class="ribbon-panel active" id="rb-panel-home">
        <div class="ribbon-group">
          <div class="ribbon-group-body">
            <button class="rb-btn-large active" data-tool="text" title="Chọn và sửa văn bản trực tiếp">
              <span class="rb-icon">🔤</span><span class="rb-label">Chọn Chữ</span>
            </button>
            <button class="rb-btn-large" data-tool="region" title="Chọn và di chuyển cả khối / vùng">
              <span class="rb-icon">▣</span><span class="rb-label">Chọn Vùng</span>
            </button>
            <button class="rb-btn-large" data-tool="addtext" title="Thêm văn bản mới vào trang">
              <span class="rb-icon">🅣</span><span class="rb-label">Thêm Chữ</span>
            </button>
            <div class="rb-column">
              <button class="rb-btn-compact" data-tool="free" title="Vẽ tự do"><span class="rb-icon">✏️</span> Bút vẽ</button>
              <button class="rb-btn-compact" data-tool="line" title="Kẻ đường thẳng"><span class="rb-icon">📏</span> Đường thẳng</button>
            </div>
            <div class="rb-column">
              <button class="rb-btn-compact" data-tool="rect" title="Hình chữ nhật"><span class="rb-icon">⬜</span> Hình hộp</button>
              <button class="rb-btn-compact" data-tool="ellipse" title="Hình elip / tròn"><span class="rb-icon">⭕</span> Hình elip</button>
            </div>
            <button class="rb-btn-large" data-tool="arrow" title="Vẽ mũi tên chỉ dẫn">
              <span class="rb-icon">➡️</span><span class="rb-label">Mũi Tên</span>
            </button>
          </div>
          <div class="ribbon-group-title">VĂN BẢN & VẼ</div>
        </div>

        <div class="ribbon-group">
          <div class="ribbon-group-body">
            <div class="rb-column">
              <div class="rb-row">
                <select id="rb-font-select" class="rb-select" style="width:130px;" title="Phông chữ">
                  <option value="roboto">Roboto (Mặc định)</option>
                  <option value="times">Times New Roman</option>
                  <option value="arial">Arial</option>
                  <option value="tahoma">Tahoma</option>
                  <option value="courier">Courier New</option>
                </select>
                <input type="number" id="rb-font-size" class="rb-input-num" value="12" min="4" max="200" step="0.5" title="Cỡ chữ (pt)">
                <span style="font-size:11px;color:#666;">pt</span>
              </div>
              <div class="rb-row">
                <button class="rb-btn-compact" id="rb-bold-btn" style="font-weight:900;" title="In đậm (Ctrl+B)">𝗕</button>
                <button class="rb-btn-compact" id="rb-italic-btn" style="font-style:italic;" title="In nghiêng (Ctrl+I)">𝐼</button>
                <span style="font-size:11px;color:#555;margin-left:4px;">Màu chữ:</span>
                <input type="color" id="rb-text-color" value="#000000" style="width:28px;height:24px;padding:0;border:1px solid #cbd5e1;cursor:pointer;" title="Màu chữ">
              </div>
            </div>
          </div>
          <div class="ribbon-group-title">ĐỊNH DẠNG CHỮ</div>
        </div>

        <div class="ribbon-group">
          <div class="ribbon-group-body">
            <div class="rb-column">
              <div class="rb-row">
                <span style="font-size:11px;color:#555;">Màu nét:</span>
                <input type="color" id="rb-stroke-color" value="#ff0000" style="width:28px;height:24px;padding:0;border:1px solid #cbd5e1;cursor:pointer;" title="Màu nét vẽ">
              </div>
              <div class="rb-row">
                <span style="font-size:11px;color:#666;" id="rb-brush-size-text">Nét: 3px</span>
              </div>
            </div>
          </div>
          <div class="ribbon-group-title">MÀU CỌ</div>
        </div>

        <div class="ribbon-group">
          <div class="ribbon-group-body">
            <button class="rb-btn-large" id="rb-undo-btn" title="Hoàn tác (Ctrl+Z)">
              <span class="rb-icon">↩</span><span class="rb-label">Hoàn tác</span>
            </button>
            <button class="rb-btn-large" id="rb-redo-btn" title="Làm lại (Ctrl+Y)">
              <span class="rb-icon">↪</span><span class="rb-label">Làm lại</span>
            </button>
          </div>
          <div class="ribbon-group-title">LỊCH SỬ SỬA</div>
        </div>
      </div>

      <!-- 2. LAYOUT PANEL (CANH LỀ & TRANG) -->
      <div class="ribbon-panel" id="rb-panel-layout">
        <div class="ribbon-group">
          <div class="ribbon-group-body">
            <div class="rb-presets-grid">
              <button class="rb-preset-chip" id="rb-preset-vn30" title="Chuẩn văn bản VN: Trái 30, Phải 15, Trên 20, Dưới 20 mm">
                🇻🇳 <b>Chuẩn NĐ30</b>
              </button>
              <button class="rb-preset-chip" id="rb-preset-normal" title="Lề đều 20mm">
                📄 Bình thường (20)
              </button>
              <button class="rb-preset-chip" id="rb-preset-narrow" title="Lề hẹp 12.7mm">
                📏 Lề Hẹp (12.7)
              </button>
              <button class="rb-preset-chip" id="rb-preset-wide" title="Lề rộng 30-30-25-25 mm">
                📐 Lề Rộng (30)
              </button>
            </div>

            <div class="rb-column" style="margin-left:4px;">
              <div class="rb-row">
                <span style="font-size:11px;color:#555;width:24px;">Trái:</span>
                <input type="number" id="rb-mg-left" class="rb-input-num" value="30" min="0" max="100">
                <span style="font-size:11px;color:#555;width:24px;margin-left:4px;">Phải:</span>
                <input type="number" id="rb-mg-right" class="rb-input-num" value="15" min="0" max="100">
                <span style="font-size:10px;color:#666;">mm</span>
              </div>
              <div class="rb-row">
                <span style="font-size:11px;color:#555;width:24px;">Trên:</span>
                <input type="number" id="rb-mg-top" class="rb-input-num" value="20" min="0" max="100">
                <span style="font-size:11px;color:#555;width:24px;margin-left:4px;">Dưới:</span>
                <input type="number" id="rb-mg-bottom" class="rb-input-num" value="20" min="0" max="100">
                <span style="font-size:10px;color:#666;">mm</span>
              </div>
            </div>

            <div class="rb-column" style="margin-left:4px;">
              <select id="rb-mg-mode" class="rb-select" style="width:125px;" title="Chế độ canh lề">
                <option value="scale">Co nội dung (Khổ A4)</option>
                <option value="expand">Mở rộng khổ giấy</option>
              </select>
              <label style="font-size:11px;display:flex;align-items:center;gap:4px;cursor:pointer;">
                <input type="checkbox" id="rb-mg-mirror"> Đối xứng 2 mặt
              </label>
            </div>

            <button class="rb-btn-large primary-action" id="rb-apply-margin-btn" title="Áp dụng canh lề ngay lên tài liệu PDF đang mở">
              <span class="rb-icon">🚀</span><span class="rb-label">Áp Dụng<br>Canh Lề</span>
            </button>
          </div>
          <div class="ribbon-group-title">CANH LỀ TRANG (MARGINS)</div>
        </div>

        <div class="ribbon-group">
          <div class="ribbon-group-body">
            <div class="rb-column">
              <select id="rb-blank-sens" class="rb-select" style="width:120px;" title="Độ nhạy phát hiện trang trắng">
                <option value="normal">Tiêu chuẩn (Khuyên dùng)</option>
                <option value="strict">Nghiêm ngặt (100% trống)</option>
                <option value="loose">Rộng (lọc chấm scan)</option>
              </select>
              <span style="font-size:10px;color:#6b7280;">Tự động lọc trang trống</span>
            </div>
            <button class="rb-btn-large warning-action" id="rb-apply-blank-btn" title="Quét toàn bộ tài liệu và xóa các trang trắng tự động">
              <span class="rb-icon">🧽</span><span class="rb-label">Xóa Trang<br>Trắng</span>
            </button>
          </div>
          <div class="ribbon-group-title">LOẠI BỎ TRANG TRẮNG</div>
        </div>

        <div class="ribbon-group">
          <div class="ribbon-group-body">
            <div class="rb-column">
              <button class="rb-btn-compact" id="rb-rot-right-btn" title="Xoay trang sang phải 90°">
                🔄 Xoay Phải 90°
              </button>
              <button class="rb-btn-compact" id="rb-rot-left-btn" title="Xoay trang sang trái 90°">
                🔄 Xoay Trái 90°
              </button>
            </div>
            <div class="rb-column">
              <button class="rb-btn-compact" id="rb-rot-180-btn" title="Lật ngược trang 180°">
                🔃 Lật 180°
              </button>
              <select id="rb-rot-target" class="rb-select" style="width:105px;">
                <option value="current">Trang hiện tại</option>
                <option value="all">Tất cả trang</option>
              </select>
            </div>
          </div>
          <div class="ribbon-group-title">HƯỚNG & XOAY TRANG</div>
        </div>

        <div class="ribbon-group">
          <div class="ribbon-group-body">
            <button class="rb-btn-large" id="rb-del-page-btn" style="color:#b91c1c;" title="Xóa trang PDF đang xem khỏi tài liệu">
              <span class="rb-icon">🗑️</span><span class="rb-label">Xóa<br>Trang Này</span>
            </button>
            <button class="rb-btn-large" id="rb-add-blank-page-btn" title="Chèn 1 trang trắng sau trang hiện tại">
              <span class="rb-icon">➕</span><span class="rb-label">Thêm<br>Trang Trắng</span>
            </button>
          </div>
          <div class="ribbon-group-title">QUẢN LÝ TRANG</div>
        </div>
      </div>

      <!-- 3. INSERT & SIGN PANEL -->
      <div class="ribbon-panel" id="rb-panel-insert">
        <div class="ribbon-group">
          <div class="ribbon-group-body">
            <div class="rb-column">
              <div class="rb-row">
                <span style="font-size:11px;color:#555;">Vị trí:</span>
                <select id="rb-pn-pos" class="rb-select" style="width:100px;">
                  <option value="bc">Dưới - Giữa</option>
                  <option value="br">Dưới - Phải</option>
                  <option value="bl">Dưới - Trái</option>
                  <option value="tc">Trên - Giữa</option>
                  <option value="tr">Trên - Phải</option>
                </select>
              </div>
              <div class="rb-row">
                <span style="font-size:11px;color:#555;">Kiểu:</span>
                <select id="rb-pn-fmt" class="rb-select" style="width:100px;">
                  <option value="{n}">1, 2, 3...</option>
                  <option value="Trang {n} / {N}">Trang {n} / {N}</option>
                  <option value="- {n} -">- {n} -</option>
                </select>
              </div>
            </div>
            <div class="rb-column">
              <div class="rb-row">
                <span style="font-size:11px;color:#555;">Từ trang:</span>
                <input type="number" id="rb-pn-from" class="rb-input-num" value="1" min="1" max="999">
              </div>
              <div class="rb-row">
                <span style="font-size:11px;color:#555;">Cỡ chữ:</span>
                <input type="number" id="rb-pn-size" class="rb-input-num" value="11" min="6" max="36">
              </div>
            </div>
            <button class="rb-btn-large primary-action" id="rb-apply-pagenum-btn" title="Đánh số thứ tự các trang trên tài liệu">
              <span class="rb-icon">🔢</span><span class="rb-label">Đánh Số<br>Trang</span>
            </button>
          </div>
          <div class="ribbon-group-title">ĐÁNH SỐ TRANG</div>
        </div>

        <div class="ribbon-group">
          <div class="ribbon-group-body">
            <div class="rb-column">
              <div class="rb-row">
                <input type="text" id="rb-wm-text" class="rb-input-text" value="BẢN NHÁP" style="width:115px;" placeholder="Chữ watermark...">
                <input type="color" id="rb-wm-color" value="#e11d48" style="width:26px;height:24px;padding:0;border:1px solid #cbd5e1;cursor:pointer;" title="Màu watermark">
              </div>
              <div class="rb-row">
                <select id="rb-wm-rot" class="rb-select" style="width:75px;">
                  <option value="45">Góc 45°</option>
                  <option value="0">Ngang 0°</option>
                </select>
                <select id="rb-wm-op" class="rb-select" style="width:66px;">
                  <option value="20">Mờ 20%</option>
                  <option value="35">Mờ 35%</option>
                  <option value="50">Mờ 50%</option>
                </select>
              </div>
            </div>
            <button class="rb-btn-large" id="rb-apply-watermark-btn" style="background:#fef2f2; border-color:#fca5a5; color:#b91c1c;" title="Đóng dấu bản quyền chìm toàn bộ trang">
              <span class="rb-icon">💧</span><span class="rb-label">Đóng Dấu<br>Chìm</span>
            </button>
          </div>
          <div class="ribbon-group-title">WATERMARK (BẢN QUYỀN)</div>
        </div>

        <div class="ribbon-group">
          <div class="ribbon-group-body">
            <button class="rb-btn-large success-action" id="rb-open-sign-btn" title="Vẽ hoặc tải ảnh chữ ký để chèn trực tiếp vào trang hiện tại">
              <span class="rb-icon">✍️</span><span class="rb-label">Ký Tên Vào<br>Trang Này</span>
            </button>
            <div class="rb-column" style="max-width:130px; font-size:11px; color:#4b5563; line-height:1.3;">
              <span>• Vẽ chữ ký tay</span>
              <span>• Tải ảnh (tự lọc nền)</span>
              <span>• Kéo thả định vị</span>
            </div>
          </div>
          <div class="ribbon-group-title">CHỮ KÝ ĐIỆN TỬ</div>
        </div>
      </div>

      <!-- 4. PIPELINE & TOOLS PANEL -->
      <div class="ribbon-panel" id="rb-panel-pipeline">
        <div class="ribbon-group">
          <div class="ribbon-group-body">
            <div class="rb-column" style="gap:2px;">
              <label style="font-size:11px;font-weight:600;display:flex;align-items:center;gap:5px;cursor:pointer;">
                <input type="checkbox" id="rb-pipe-blank" checked> 1. Loại bỏ trang trắng tự động
              </label>
              <label style="font-size:11px;font-weight:600;display:flex;align-items:center;gap:5px;cursor:pointer;">
                <input type="checkbox" id="rb-pipe-margin" checked> 2. Canh lề chuẩn (30-15-20-20mm)
              </label>
              <label style="font-size:11px;font-weight:600;display:flex;align-items:center;gap:5px;cursor:pointer;">
                <input type="checkbox" id="rb-pipe-pagenum" checked> 3. Đánh số trang tự động (Dưới - Giữa)
              </label>
              <div class="rb-row" style="gap:12px; margin-top:1px;">
                <label style="font-size:11px;display:flex;align-items:center;gap:4px;cursor:pointer;color:#6b7280;">
                  <input type="checkbox" id="rb-pipe-wm"> 4. Watermark
                </label>
                <label style="font-size:11px;display:flex;align-items:center;gap:4px;cursor:pointer;color:#6b7280;">
                  <input type="checkbox" id="rb-pipe-comp"> 5. Nén PDF
                </label>
              </div>
            </div>

            <button class="rb-btn-large warning-action" id="rb-run-pipeline-btn" style="min-width:140px; font-weight:bold;" title="Thực thi chuỗi thao tác liên hoàn chỉ với 1 click ngay trên file đang mở">
              <span class="rb-icon">⚡</span><span class="rb-label">THỰC THI CHUỖI<br>1-CLICK NGAY</span>
            </button>
          </div>
          <div class="ribbon-group-title">CHUỖI LIÊN HOÀN TỰ ĐỘNG (NHIỀU BƯỚC 1 LẦN)</div>
        </div>

        <div class="ribbon-group">
          <div class="ribbon-group-body">
            <div class="rb-column">
              <select id="rb-comp-level" class="rb-select" style="width:110px;">
                <option value="balanced">Cân bằng</option>
                <option value="strong">Nén mạnh</option>
              </select>
            </div>
            <button class="rb-btn-large" id="rb-apply-compress-btn" title="Giảm dung lượng file PDF trực tiếp">
              <span class="rb-icon">🗜️</span><span class="rb-label">Nén<br>PDF</span>
            </button>
          </div>
          <div class="ribbon-group-title">NÉN & TỐI ƯU</div>
        </div>

        <div class="ribbon-group">
          <div class="ribbon-group-body">
            <input type="password" id="rb-protect-pass" class="rb-input-text" placeholder="Nhập mật khẩu..." style="width:115px;">
            <button class="rb-btn-large" id="rb-apply-protect-btn" title="Bảo vệ file bằng mật khẩu mở">
              <span class="rb-icon">🔒</span><span class="rb-label">Đặt<br>Mật Khẩu</span>
            </button>
          </div>
          <div class="ribbon-group-title">BẢO MẬT</div>
        </div>
      </div>
    </div>
  `;
}

function wireRibbonEvents() {
  // Ribbon Tab Switcher
  document.querySelectorAll('.ribbon-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ribbon-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.ribbon-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const tabId = btn.dataset.tab;
      const targetPanel = document.getElementById(`rb-panel-${tabId}`);
      if (targetPanel) targetPanel.classList.add('active');
    });
  });

  // Toggle Collapse
  const colBtn = document.getElementById('rb-toggle-collapse');
  const panelsContainer = document.getElementById('rb-panels-container');
  if (colBtn && panelsContainer) {
    colBtn.addEventListener('click', () => {
      ribbonCollapsed = !ribbonCollapsed;
      panelsContainer.style.display = ribbonCollapsed ? 'none' : 'flex';
      colBtn.textContent = ribbonCollapsed ? '▼' : '▲';
      colBtn.title = ribbonCollapsed ? 'Mở rộng thanh công cụ' : 'Thu gọn thanh công cụ';
    });
  }

  // File Menu Button
  const fileMenuBtn = document.getElementById('rb-file-menu-btn');
  if (fileMenuBtn) {
    fileMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openFileDropdown(fileMenuBtn);
    });
  }

  // Tool buttons sync
  document.querySelectorAll('.rb-btn-large[data-tool], .rb-btn-compact[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      if (tool === 'region') {
        const sideReg = document.getElementById('region-mode-btn');
        if (sideReg) sideReg.click();
      } else if (typeof window.setEditorTool === 'function') {
        window.setEditorTool(tool);
      }
      syncActiveToolRibbon(tool);
    });
  });

  // Sync font formatting controls
  const fSelect = document.getElementById('rb-font-select');
  const fSize = document.getElementById('rb-font-size');
  const fColor = document.getElementById('rb-text-color');
  const sColor = document.getElementById('rb-stroke-color');

  if (fSelect) {
    fSelect.addEventListener('change', () => {
      const orig = document.getElementById('editor-text-font');
      if (orig) { orig.value = fSelect.value; orig.dispatchEvent(new Event('change')); }
    });
  }
  if (fSize) {
    fSize.addEventListener('input', () => {
      const orig = document.getElementById('editor-text-size');
      if (orig) { orig.value = fSize.value; orig.dispatchEvent(new Event('input')); }
    });
  }
  if (fColor) {
    fColor.addEventListener('input', () => {
      const orig = document.getElementById('editor-text-color');
      if (orig) { orig.value = fColor.value; orig.dispatchEvent(new Event('input')); }
    });
  }
  if (sColor) {
    sColor.addEventListener('input', () => {
      const orig = document.getElementById('editor-stroke-color');
      if (orig) { orig.value = sColor.value; orig.dispatchEvent(new Event('change')); }
    });
  }

  // Bold & Italic
  const boldBtn = document.getElementById('rb-bold-btn');
  if (boldBtn) {
    boldBtn.addEventListener('click', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true }));
    });
  }
  const italicBtn = document.getElementById('rb-italic-btn');
  if (italicBtn) {
    italicBtn.addEventListener('click', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', ctrlKey: true }));
    });
  }

  // Undo / Redo
  const undoBtn = document.getElementById('rb-undo-btn');
  if (undoBtn) undoBtn.addEventListener('click', () => { if (typeof window.editorUndo === 'function') window.editorUndo(); });
  const redoBtn = document.getElementById('rb-redo-btn');
  if (redoBtn) redoBtn.addEventListener('click', () => { if (typeof window.editorRedo === 'function') window.editorRedo(); });

  // Save / Export
  const saveBtn = document.getElementById('rb-save-btn');
  if (saveBtn) saveBtn.addEventListener('click', () => { if (typeof window.editorExportPDF === 'function') window.editorExportPDF(); });

  // Document Undo
  const docUndoBtn = document.getElementById('rb-doc-undo-btn');
  if (docUndoBtn) docUndoBtn.addEventListener('click', editorDocUndo);

  // Margins Presets
  document.getElementById('rb-preset-vn30')?.addEventListener('click', () => setMarginInputs(30, 15, 20, 20));
  document.getElementById('rb-preset-normal')?.addEventListener('click', () => setMarginInputs(20, 20, 20, 20));
  document.getElementById('rb-preset-narrow')?.addEventListener('click', () => setMarginInputs(12.7, 12.7, 12.7, 12.7));
  document.getElementById('rb-preset-wide')?.addEventListener('click', () => setMarginInputs(30, 30, 25, 25));

  // Apply Margins
  document.getElementById('rb-apply-margin-btn')?.addEventListener('click', applyMarginToEditor);

  // Blank Pages
  document.getElementById('rb-apply-blank-btn')?.addEventListener('click', applyRemoveBlankPagesToEditor);

  // Rotate buttons
  document.getElementById('rb-rot-right-btn')?.addEventListener('click', () => applyRotatePagesToEditor(90));
  document.getElementById('rb-rot-left-btn')?.addEventListener('click', () => applyRotatePagesToEditor(270));
  document.getElementById('rb-rot-180-btn')?.addEventListener('click', () => applyRotatePagesToEditor(180));

  // Page management
  document.getElementById('rb-del-page-btn')?.addEventListener('click', applyDeleteCurrentPageToEditor);
  document.getElementById('rb-add-blank-page-btn')?.addEventListener('click', applyAddBlankPageToEditor);

  // Page numbers
  document.getElementById('rb-apply-pagenum-btn')?.addEventListener('click', applyPageNumbersToEditor);

  // Watermark
  document.getElementById('rb-apply-watermark-btn')?.addEventListener('click', applyWatermarkToEditor);

  // Digital Signature
  document.getElementById('rb-open-sign-btn')?.addEventListener('click', openSignatureModal);

  // Pipeline (Chuỗi liên hoàn 1-Click)
  document.getElementById('rb-run-pipeline-btn')?.addEventListener('click', applyPipelineToEditor);

  // Compress
  document.getElementById('rb-apply-compress-btn')?.addEventListener('click', applyCompressToEditor);

  // Protect
  document.getElementById('rb-apply-protect-btn')?.addEventListener('click', applyProtectToEditor);
}

function setMarginInputs(left, right, top, bottom) {
  const l = document.getElementById('rb-mg-left');
  const r = document.getElementById('rb-mg-right');
  const t = document.getElementById('rb-mg-top');
  const b = document.getElementById('rb-mg-bottom');
  if (l) l.value = left;
  if (r) r.value = right;
  if (t) t.value = top;
  if (b) b.value = bottom;
  if (window.toast) window.toast(`Đã chọn mẫu lề: Trái ${left}mm, Phải ${right}mm, Trên ${top}mm, Dưới ${bottom}mm`, 'info', 2000);
}

function syncActiveToolRibbon(tool) {
  document.querySelectorAll('.rb-btn-large[data-tool], .rb-btn-compact[data-tool]').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === tool);
  });
}

export function updateRibbonDocState() {
  const badge = document.getElementById('rb-doc-badge');
  const doc = typeof window.getEditorPdfDoc === 'function' ? window.getEditorPdfDoc() : null;
  const fileName = typeof window.getEditorFileName === 'function' ? window.getEditorFileName() : '';
  const page = typeof window.getEditorPage === 'function' ? window.getEditorPage() : 1;

  if (badge) {
    if (doc) {
      badge.className = 'ribbon-doc-badge has-file';
      badge.innerHTML = `<span>✓ <b>${escapeHtml(fileName || 'tailieu')}.pdf</b> (${page} / ${doc.numPages} trang)</span>`;
    } else {
      badge.className = 'ribbon-doc-badge';
      badge.innerHTML = '<span>📄 Chưa mở file</span>';
    }
  }

  // Update undo count
  const undoBtn = document.getElementById('rb-doc-undo-btn');
  const undoCountEl = document.getElementById('rb-undo-count');
  if (undoBtn && undoCountEl) {
    if (docUndoStack.length > 0) {
      undoBtn.style.display = 'inline-flex';
      undoCountEl.textContent = docUndoStack.length;
    } else {
      undoBtn.style.display = 'none';
    }
  }
}

// Push state to undo stack before any document-level operation
function pushDocUndoState(actionName) {
  const currentBytes = typeof window.getEditorPdfBytes === 'function' ? window.getEditorPdfBytes() : null;
  if (!currentBytes) return;
  const fileName = typeof window.getEditorFileName === 'function' ? window.getEditorFileName() : 'tailieu';
  const page = typeof window.getEditorPage === 'function' ? window.getEditorPage() : 1;

  docUndoStack.push({
    bytes: new Uint8Array(currentBytes.slice(0)),
    fileName,
    page,
    action: actionName
  });
  if (docUndoStack.length > 15) docUndoStack.shift();
  updateRibbonDocState();
}

// Revert document to previous state
export async function editorDocUndo() {
  if (!docUndoStack.length) {
    if (window.toast) window.toast('Không có thao tác công cụ nào để hoàn tác.', 'info');
    return;
  }
  const lastState = docUndoStack.pop();
  if (window.Progress) window.Progress.show('Đang khôi phục tài liệu...', null);
  try {
    await window.editorLoadBytes(lastState.bytes, lastState.fileName, true);
    if (window.toast) window.toast(`↩ Đã hoàn tác thao tác "${lastState.action || 'công cụ'}"`, 'success');
  } catch (err) {
    if (window.toast) window.toast('Lỗi hoàn tác: ' + err.message, 'error');
  } finally {
    if (window.Progress) window.Progress.hide();
    updateRibbonDocState();
  }
}

// ======================== TOOL ACTIONS ========================

// 1. Áp dụng Canh lề (Margins)
export async function applyMarginToEditor() {
  const currentBytes = await getEditorBytesOrAlert();
  if (!currentBytes) return;

  const leftMm = Math.max(0, parseFloat(document.getElementById('rb-mg-left')?.value) || 0);
  const rightMm = Math.max(0, parseFloat(document.getElementById('rb-mg-right')?.value) || 0);
  const topMm = Math.max(0, parseFloat(document.getElementById('rb-mg-top')?.value) || 0);
  const bottomMm = Math.max(0, parseFloat(document.getElementById('rb-mg-bottom')?.value) || 0);
  const mode = document.getElementById('rb-mg-mode')?.value || 'scale';
  const mirror = !!document.getElementById('rb-mg-mirror')?.checked;

  const leftPt = leftMm * 72 / 25.4;
  const rightPt = rightMm * 72 / 25.4;
  const topPt = topMm * 72 / 25.4;
  const bottomPt = bottomMm * 72 / 25.4;

  pushDocUndoState(`Canh lề (${leftMm}-${rightMm}-${topMm}-${bottomMm}mm)`);
  if (window.Progress) window.Progress.show('Đang áp dụng canh lề trang...', null);

  try {
    const pdfDoc = await PDFLib.PDFDocument.load(currentBytes);
    const pages = pdfDoc.getPages();
    const total = pages.length;

    for (let i = 0; i < total; i++) {
      if (window.Progress) window.Progress.show(`Đang canh lề trang ${i + 1}/${total}...`, ((i + 1) / total) * 90);
      const page = pages[i];
      const isEven = (i + 1) % 2 === 0;

      let mL = leftPt, mR = rightPt, mT = topPt, mB = bottomPt;
      if (mirror && isEven) {
        mL = rightPt;
        mR = leftPt;
      }

      const { width: W, height: H } = page.getSize();
      const rot = page.getRotation().angle;

      let availW = W - mL - mR;
      let availH = H - mT - mB;
      if (availW < 10) availW = 10;
      if (availH < 10) availH = 10;

      if (mode === 'expand') {
        const newW = W + mL + mR;
        const newH = H + mT + mB;
        page.setSize(newW, newH);
        page.translateContent(mL, mB);
      } else {
        // Co nội dung vừa khổ A4
        const s = Math.min(availW / W, availH / H, 1);
        const scaledW = W * s;
        const scaledH = H * s;
        const dX = mL + (availW - scaledW) / 2;
        const dY = mB + (availH - scaledH) / 2;

        page.scaleContent(s, s);

        // Adjust for page rotation angle
        let tx = dX, ty = dY;
        if (rot === 90) {
          tx = dY;
          ty = -dX;
        } else if (rot === 180) {
          tx = -dX;
          ty = -dY;
        } else if (rot === 270) {
          tx = -dY;
          ty = dX;
        }
        page.translateContent(tx, ty);
      }
    }

    const outBytes = await pdfDoc.save();
    await window.editorLoadBytes(outBytes, window.getEditorFileName(), true);
    if (window.toast) {
      window.toast(`✓ Đã canh lề thành công: Trái ${leftMm}mm, Phải ${rightMm}mm, Trên ${topMm}mm, Dưới ${bottomMm}mm!`, 'success');
    }
  } catch (err) {
    console.error('Lỗi canh lề:', err);
    if (window.toast) window.toast('Lỗi canh lề: ' + err.message, 'error');
  } finally {
    if (window.Progress) window.Progress.hide();
    updateRibbonDocState();
  }
}

// 2. Loại bỏ trang trắng (Remove blank pages)
export async function applyRemoveBlankPagesToEditor() {
  const currentBytes = await getEditorBytesOrAlert();
  if (!currentBytes) return;

  const sens = document.getElementById('rb-blank-sens')?.value || 'normal';
  const BLANK_THRESHOLDS = { strict: 0.000005, normal: 0.0001, loose: 0.0008 };
  const limit = BLANK_THRESHOLDS[sens] || 0.0001;

  pushDocUndoState('Xóa trang trắng');
  if (window.Progress) window.Progress.show('Đang quét và kiểm tra trang trắng...', null);

  try {
    const pdfDoc = await PDFLib.PDFDocument.load(currentBytes);
    const total = pdfDoc.getPageCount();
    const pdfJs = await pdfjsLib.getDocument({ data: new Uint8Array(currentBytes.slice(0)) }).promise;
    const blankIndices = [];

    for (let i = 1; i <= total; i++) {
      if (window.Progress) window.Progress.show(`Đang quét trang ${i}/${total}...`, (i / total) * 85);
      const page = await pdfJs.getPage(i);
      const vp = page.getViewport({ scale: 0.5 });
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(vp.width);
      cv.height = Math.ceil(vp.height);
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;

      const imgData = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let darkPixels = 0;
      for (let k = 0; k < imgData.length; k += 4) {
        const lum = (imgData[k] * 299 + imgData[k + 1] * 587 + imgData[k + 2] * 114) / 1000;
        if (lum < 225) darkPixels++;
      }
      const area = cv.width * cv.height;
      if (darkPixels / area <= limit) {
        blankIndices.push(i - 1);
      }
      cv.width = 0;
      cv.height = 0;
    }

    if (!blankIndices.length) {
      if (window.toast) window.toast(`ℹ️ Không tìm thấy trang trắng nào (đã kiểm tra ${total} trang).`, 'info');
      // Undo the push since no change was made
      docUndoStack.pop();
      return;
    }

    if (blankIndices.length >= total) {
      throw new Error('Tất cả các trang đều bị coi là trắng! Hãy giảm độ nhạy.');
    }

    // Remove from highest to lowest index
    for (let k = blankIndices.length - 1; k >= 0; k--) {
      pdfDoc.removePage(blankIndices[k]);
    }

    const outBytes = await pdfDoc.save();
    await window.editorLoadBytes(outBytes, window.getEditorFileName(), true);
    const removedPageNums = blankIndices.map(idx => idx + 1).join(', ');
    if (window.toast) {
      window.toast(`✓ Đã xóa ${blankIndices.length} trang trắng (trang: ${removedPageNums})! Còn lại ${total - blankIndices.length} trang.`, 'success');
    }
  } catch (err) {
    console.error('Lỗi xóa trang trắng:', err);
    if (window.toast) window.toast('Lỗi xóa trang trắng: ' + err.message, 'error');
  } finally {
    if (window.Progress) window.Progress.hide();
    updateRibbonDocState();
  }
}

// 3. Xoay trang (Rotate pages)
export async function applyRotatePagesToEditor(degrees) {
  const currentBytes = await getEditorBytesOrAlert();
  if (!currentBytes) return;

  const target = document.getElementById('rb-rot-target')?.value || 'current';
  const curPage = typeof window.getEditorPage === 'function' ? window.getEditorPage() : 1;

  pushDocUndoState(`Xoay trang (${degrees}°)`);
  if (window.Progress) window.Progress.show('Đang xoay trang...', null);

  try {
    const pdfDoc = await PDFLib.PDFDocument.load(currentBytes);
    const pages = pdfDoc.getPages();

    if (target === 'current') {
      const p = pages[curPage - 1];
      if (p) {
        const curRot = p.getRotation().angle;
        p.setRotation(PDFLib.degrees((curRot + degrees) % 360));
      }
    } else {
      pages.forEach(p => {
        const curRot = p.getRotation().angle;
        p.setRotation(PDFLib.degrees((curRot + degrees) % 360));
      });
    }

    const outBytes = await pdfDoc.save();
    await window.editorLoadBytes(outBytes, window.getEditorFileName(), true);
    if (window.toast) {
      window.toast(`✓ Đã xoay ${target === 'current' ? `trang ${curPage}` : 'toàn bộ trang'} thành công!`, 'success');
    }
  } catch (err) {
    console.error('Lỗi xoay trang:', err);
    if (window.toast) window.toast('Lỗi xoay trang: ' + err.message, 'error');
  } finally {
    if (window.Progress) window.Progress.hide();
    updateRibbonDocState();
  }
}

// 4. Xóa trang hiện tại
export async function applyDeleteCurrentPageToEditor() {
  const currentBytes = await getEditorBytesOrAlert();
  if (!currentBytes) return;

  const curPage = typeof window.getEditorPage === 'function' ? window.getEditorPage() : 1;
  const pdfDoc = await PDFLib.PDFDocument.load(currentBytes);
  const total = pdfDoc.getPageCount();

  if (total <= 1) {
    if (window.toast) window.toast('Không thể xóa trang duy nhất còn lại của tài liệu.', 'error');
    return;
  }

  if (!confirm(`Bạn có chắc chắn muốn xóa trang ${curPage} khỏi tài liệu này?`)) return;

  pushDocUndoState(`Xóa trang ${curPage}`);
  if (window.Progress) window.Progress.show(`Đang xóa trang ${curPage}...`, null);

  try {
    pdfDoc.removePage(curPage - 1);
    const outBytes = await pdfDoc.save();
    await window.editorLoadBytes(outBytes, window.getEditorFileName(), false);
    if (window.toast) window.toast(`✓ Đã xóa trang ${curPage} thành công!`, 'success');
  } catch (err) {
    console.error('Lỗi xóa trang:', err);
    if (window.toast) window.toast('Lỗi xóa trang: ' + err.message, 'error');
  } finally {
    if (window.Progress) window.Progress.hide();
    updateRibbonDocState();
  }
}

// 5. Thêm trang trắng sau trang hiện tại
export async function applyAddBlankPageToEditor() {
  const currentBytes = await getEditorBytesOrAlert();
  if (!currentBytes) return;

  const curPage = typeof window.getEditorPage === 'function' ? window.getEditorPage() : 1;
  pushDocUndoState('Thêm trang trắng');
  if (window.Progress) window.Progress.show('Đang thêm trang trắng...', null);

  try {
    const pdfDoc = await PDFLib.PDFDocument.load(currentBytes);
    const curP = pdfDoc.getPages()[curPage - 1];
    const { width, height } = curP ? curP.getSize() : { width: 595.28, height: 841.89 }; // A4
    pdfDoc.insertPage(curPage, [width, height]);

    const outBytes = await pdfDoc.save();
    await window.editorLoadBytes(outBytes, window.getEditorFileName(), false);
    if (window.toast) window.toast(`✓ Đã thêm 1 trang trắng mới sau trang ${curPage}!`, 'success');
  } catch (err) {
    console.error('Lỗi thêm trang trắng:', err);
    if (window.toast) window.toast('Lỗi thêm trang: ' + err.message, 'error');
  } finally {
    if (window.Progress) window.Progress.hide();
    updateRibbonDocState();
  }
}

// 6. Đánh số trang (Page numbers)
export async function applyPageNumbersToEditor() {
  const currentBytes = await getEditorBytesOrAlert();
  if (!currentBytes) return;

  const pos = document.getElementById('rb-pn-pos')?.value || 'bc';
  const fmt = document.getElementById('rb-pn-fmt')?.value || '{n}';
  const from = Math.max(1, parseInt(document.getElementById('rb-pn-from')?.value) || 1);
  const size = Math.max(6, parseInt(document.getElementById('rb-pn-size')?.value) || 11);

  pushDocUndoState('Đánh số trang');
  if (window.Progress) window.Progress.show('Đang đánh số trang...', null);

  try {
    const pdfDoc = await PDFLib.PDFDocument.load(currentBytes);
    const font = await pdfDoc.embedStandardFont(PDFLib.StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();
    const total = pages.length;
    const marginPt = 35; // ~12mm from edge

    for (let i = from - 1; i < total; i++) {
      const page = pages[i];
      const pageNum = i + 1;
      const text = fmt.replace('{n}', String(pageNum)).replace('{N}', String(total));
      const textW = font.widthOfTextAtSize(text, size);
      const { width: W, height: H } = page.getSize();

      let x = (W - textW) / 2;
      let y = marginPt;

      if (pos === 'bl') x = marginPt;
      else if (pos === 'br') x = W - marginPt - textW;
      else if (pos === 'tc') { x = (W - textW) / 2; y = H - marginPt; }
      else if (pos === 'tr') { x = W - marginPt - textW; y = H - marginPt; }

      page.drawText(text, {
        x,
        y,
        size,
        font,
        color: PDFLib.rgb(0.2, 0.2, 0.2)
      });
    }

    const outBytes = await pdfDoc.save();
    await window.editorLoadBytes(outBytes, window.getEditorFileName(), true);
    if (window.toast) window.toast(`✓ Đã đánh số toàn bộ trang từ trang ${from} đến ${total}!`, 'success');
  } catch (err) {
    console.error('Lỗi đánh số trang:', err);
    if (window.toast) window.toast('Lỗi đánh số trang: ' + err.message, 'error');
  } finally {
    if (window.Progress) window.Progress.hide();
    updateRibbonDocState();
  }
}

// 7. Đóng dấu Watermark
export async function applyWatermarkToEditor() {
  const currentBytes = await getEditorBytesOrAlert();
  if (!currentBytes) return;

  const wmText = document.getElementById('rb-wm-text')?.value?.trim() || 'BẢN NHÁP';
  const wmColor = document.getElementById('rb-wm-color')?.value || '#e11d48';
  const wmRot = parseInt(document.getElementById('rb-wm-rot')?.value) || 45;
  const wmOp = (parseInt(document.getElementById('rb-wm-op')?.value) || 25) / 100;

  pushDocUndoState(`Watermark (${wmText})`);
  if (window.Progress) window.Progress.show('Đang đóng dấu Watermark...', null);

  try {
    const pdfDoc = await PDFLib.PDFDocument.load(currentBytes);
    const font = await pdfDoc.embedStandardFont(PDFLib.StandardFonts.HelveticaBold);
    const pages = pdfDoc.getPages();
    const size = 52;
    const textW = font.widthOfTextAtSize(wmText, size);
    const rgb = hexToRgb(wmColor);

    pages.forEach(page => {
      const { width: W, height: H } = page.getSize();
      const cx = W / 2;
      const cy = H / 2;

      page.drawText(wmText, {
        x: cx - (textW / 2) * Math.cos(wmRot * Math.PI / 180),
        y: cy - (size / 2),
        size,
        font,
        color: PDFLib.rgb(rgb.r / 255, rgb.g / 255, rgb.b / 255),
        opacity: wmOp,
        rotate: PDFLib.degrees(wmRot)
      });
    });

    const outBytes = await pdfDoc.save();
    await window.editorLoadBytes(outBytes, window.getEditorFileName(), true);
    if (window.toast) window.toast(`✓ Đã đóng dấu Watermark "${wmText}" lên toàn bộ tài liệu!`, 'success');
  } catch (err) {
    console.error('Lỗi đóng dấu watermark:', err);
    if (window.toast) window.toast('Lỗi đóng dấu watermark: ' + err.message, 'error');
  } finally {
    if (window.Progress) window.Progress.hide();
    updateRibbonDocState();
  }
}

// 8. Chuỗi liên hoàn 1-Click (All-in-one Pipeline on current open document)
export async function applyPipelineToEditor() {
  let bytes = await getEditorBytesOrAlert();
  if (!bytes) return;

  const doBlank = !!document.getElementById('rb-pipe-blank')?.checked;
  const doMargin = !!document.getElementById('rb-pipe-margin')?.checked;
  const doPagenum = !!document.getElementById('rb-pipe-pagenum')?.checked;
  const doWatermark = !!document.getElementById('rb-pipe-wm')?.checked;
  const doCompress = !!document.getElementById('rb-pipe-comp')?.checked;

  if (!doBlank && !doMargin && !doPagenum && !doWatermark && !doCompress) {
    if (window.toast) window.toast('Vui lòng chọn ít nhất 1 thao tác trong chuỗi liên hoàn.', 'warning');
    return;
  }

  pushDocUndoState('Chuỗi liên hoàn 1-Click');
  const appliedSteps = [];

  try {
    // Bước 1: Xóa trang trắng
    if (doBlank) {
      if (window.Progress) window.Progress.show('Chuỗi 1-Click: Đang quét và xóa trang trắng...', 20);
      const pdfJs = await pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
      const pdfDoc = await PDFLib.PDFDocument.load(bytes);
      const total = pdfDoc.getPageCount();
      const blankIndices = [];

      for (let i = 1; i <= total; i++) {
        const page = await pdfJs.getPage(i);
        const vp = page.getViewport({ scale: 0.5 });
        const cv = document.createElement('canvas');
        cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const imgData = ctx.getImageData(0, 0, cv.width, cv.height).data;
        let dark = 0;
        for (let k = 0; k < imgData.length; k += 4) {
          if ((imgData[k] * 299 + imgData[k + 1] * 587 + imgData[k + 2] * 114) / 1000 < 225) dark++;
        }
        if (dark / (cv.width * cv.height) <= 0.0001) blankIndices.push(i - 1);
        cv.width = 0; cv.height = 0;
      }

      if (blankIndices.length > 0 && blankIndices.length < total) {
        for (let k = blankIndices.length - 1; k >= 0; k--) pdfDoc.removePage(blankIndices[k]);
        bytes = await pdfDoc.save();
        appliedSteps.push(`Xóa ${blankIndices.length} trang trắng ✅`);
      } else {
        appliedSteps.push(`Kiểm tra trang trắng (không có) ✅`);
      }
    }

    // Bước 2: Canh lề chuẩn (30-15-20-20mm)
    if (doMargin) {
      if (window.Progress) window.Progress.show('Chuỗi 1-Click: Đang canh lề trang chuẩn...', 50);
      const pdfDoc = await PDFLib.PDFDocument.load(bytes);
      const leftPt = 30 * 72 / 25.4;
      const rightPt = 15 * 72 / 25.4;
      const topPt = 20 * 72 / 25.4;
      const bottomPt = 20 * 72 / 25.4;

      const pages = pdfDoc.getPages();
      pages.forEach((page, i) => {
        const isEven = (i + 1) % 2 === 0;
        let mL = leftPt, mR = rightPt;
        if (isEven) { mL = rightPt; mR = leftPt; }

        const { width: W, height: H } = page.getSize();
        let availW = W - mL - mR;
        let availH = H - topPt - bottomPt;
        if (availW < 10) availW = 10;
        if (availH < 10) availH = 10;

        const s = Math.min(availW / W, availH / H, 1);
        const scaledW = W * s;
        const scaledH = H * s;
        const dX = mL + (availW - scaledW) / 2;
        const dY = bottomPt + (availH - scaledH) / 2;

        page.scaleContent(s, s);
        page.translateContent(dX, dY);
      });

      bytes = await pdfDoc.save();
      appliedSteps.push('Canh lề 30-15-20-20mm ✅');
    }

    // Bước 3: Đánh số trang
    if (doPagenum) {
      if (window.Progress) window.Progress.show('Chuỗi 1-Click: Đang đánh số trang...', 75);
      const pdfDoc = await PDFLib.PDFDocument.load(bytes);
      const font = await pdfDoc.embedStandardFont(PDFLib.StandardFonts.Helvetica);
      const pages = pdfDoc.getPages();
      const total = pages.length;

      pages.forEach((page, i) => {
        const text = String(i + 1);
        const textW = font.widthOfTextAtSize(text, 11);
        const { width: W } = page.getSize();
        page.drawText(text, {
          x: (W - textW) / 2,
          y: 35,
          size: 11,
          font,
          color: PDFLib.rgb(0.2, 0.2, 0.2)
        });
      });

      bytes = await pdfDoc.save();
      appliedSteps.push('Đánh số trang 1..N ✅');
    }

    // Bước 4: Watermark (nếu chọn)
    if (doWatermark) {
      if (window.Progress) window.Progress.show('Chuỗi 1-Click: Đang chèn Watermark...', 90);
      const pdfDoc = await PDFLib.PDFDocument.load(bytes);
      const font = await pdfDoc.embedStandardFont(PDFLib.StandardFonts.HelveticaBold);
      const pages = pdfDoc.getPages();
      const wmText = document.getElementById('rb-wm-text')?.value?.trim() || 'BẢN NHÁP';

      pages.forEach(page => {
        const { width: W, height: H } = page.getSize();
        const textW = font.widthOfTextAtSize(wmText, 48);
        page.drawText(wmText, {
          x: W / 2 - (textW / 2) * 0.707,
          y: H / 2 - 24,
          size: 48,
          font,
          color: PDFLib.rgb(0.8, 0.2, 0.2),
          opacity: 0.25,
          rotate: PDFLib.degrees(45)
        });
      });

      bytes = await pdfDoc.save();
      appliedSteps.push('Đóng dấu Watermark ✅');
    }

    // Nạp lại vào trình sửa PDF
    await window.editorLoadBytes(bytes, window.getEditorFileName(), true);
    if (window.toast) {
      window.toast(`⚡ Hoàn thành chuỗi liên hoàn: ${appliedSteps.join(' ➔ ')}!`, 'success', 5000);
    }
  } catch (err) {
    console.error('Lỗi thực thi chuỗi liên hoàn:', err);
    if (window.toast) window.toast('Lỗi chuỗi liên hoàn: ' + err.message, 'error');
  } finally {
    if (window.Progress) window.Progress.hide();
    updateRibbonDocState();
  }
}

// 9. Nén PDF
export async function applyCompressToEditor() {
  const currentBytes = await getEditorBytesOrAlert();
  if (!currentBytes) return;

  pushDocUndoState('Nén PDF');
  if (window.Progress) window.Progress.show('Đang tối ưu hóa dung lượng PDF...', null);

  try {
    const pdfDoc = await PDFLib.PDFDocument.load(currentBytes);
    // Strip metadata and compress cross-reference streams
    pdfDoc.setTitle('');
    pdfDoc.setAuthor('');
    pdfDoc.setProducer('Hachihi PDF');

    const outBytes = await pdfDoc.save({ useObjectStreams: true });
    const oldKb = Math.round(currentBytes.byteLength / 1024);
    const newKb = Math.round(outBytes.byteLength / 1024);

    await window.editorLoadBytes(outBytes, window.getEditorFileName(), true);
    if (window.toast) {
      window.toast(`✓ Đã nén PDF: ${oldKb}KB → ${newKb}KB!`, 'success');
    }
  } catch (err) {
    if (window.toast) window.toast('Lỗi nén PDF: ' + err.message, 'error');
  } finally {
    if (window.Progress) window.Progress.hide();
    updateRibbonDocState();
  }
}

// 10. Đặt mật khẩu PDF
export async function applyProtectToEditor() {
  const currentBytes = await getEditorBytesOrAlert();
  if (!currentBytes) return;

  const pass = document.getElementById('rb-protect-pass')?.value?.trim();
  if (!pass) {
    if (window.toast) window.toast('Vui lòng nhập mật khẩu cần đặt.', 'warning');
    return;
  }

  pushDocUndoState('Đặt mật khẩu');
  if (window.Progress) window.Progress.show('Đang mã hóa tài liệu PDF...', null);

  try {
    const pdfDoc = await PDFLib.PDFDocument.load(currentBytes);
    pdfDoc.encrypt({
      userPassword: pass,
      ownerPassword: pass + '_owner',
      permissions: {
        printing: 'highResolution',
        modifying: false,
        copying: true,
        annotating: false,
        fillingForms: true,
        contentAccessibility: true,
        documentAssembly: false
      }
    });

    const outBytes = await pdfDoc.save();
    await window.editorLoadBytes(outBytes, window.getEditorFileName(), true);
    if (window.toast) window.toast(`🔒 Đã đặt mật khẩu bảo vệ PDF thành công!`, 'success');
    document.getElementById('rb-protect-pass').value = '';
  } catch (err) {
    if (window.toast) window.toast('Lỗi đặt mật khẩu: ' + err.message, 'error');
  } finally {
    if (window.Progress) window.Progress.hide();
    updateRibbonDocState();
  }
}

// ======================== DIGITAL SIGNATURE MODAL ========================

export function openSignatureModal() {
  if (signatureModal) signatureModal.remove();

  const overlay = document.createElement('div');
  overlay.className = 'rb-modal-overlay';
  overlay.innerHTML = `
    <div class="rb-modal-card">
      <div class="rb-modal-header">
        <h3>✍️ Ký Tên Điện Tử Lên Trang Hiện Tại</h3>
        <button class="rb-btn-compact" id="sig-modal-close" style="font-weight:bold;">✕</button>
      </div>

      <div class="rb-modal-body">
        <div style="display:flex; gap:8px; margin-bottom:12px;">
          <button class="rb-btn-compact active" id="sig-tab-draw" style="flex:1; justify-content:center;">✏️ Vẽ chữ ký tay</button>
          <button class="rb-btn-compact" id="sig-tab-upload" style="flex:1; justify-content:center;">🖼️ Tải ảnh chữ ký</button>
        </div>

        <div id="sig-draw-section">
          <canvas class="rb-sig-canvas" id="sig-canvas" width="480" height="180"></canvas>
          <div style="display:flex; align-items:center; justify-content:space-between; margin-top:8px;">
            <div style="display:flex; align-items:center; gap:6px;">
              <span style="font-size:11px; color:#555;">Màu mực:</span>
              <button class="rb-btn-compact active" data-sig-color="#0284c7" style="color:#0284c7;font-weight:bold;">Xanh mực</button>
              <button class="rb-btn-compact" data-sig-color="#000000" style="color:#000;font-weight:bold;">Đen</button>
              <button class="rb-btn-compact" data-sig-color="#dc2626" style="color:#dc2626;font-weight:bold;">Đỏ</button>
            </div>
            <button class="rb-btn-compact" id="sig-clear-btn" style="color:#b91c1c;">🧹 Xóa vẽ lại</button>
          </div>
        </div>

        <div id="sig-upload-section" style="display:none; padding:15px; border:2px dashed #cbd5e1; border-radius:6px; text-align:center;">
          <input type="file" id="sig-file-input" accept="image/*" style="display:none;">
          <button class="btn btn-small" onclick="document.getElementById('sig-file-input').click()">📁 Chọn ảnh chữ ký từ máy</button>
          <div id="sig-preview-box" style="margin-top:10px; display:none;">
            <img id="sig-preview-img" style="max-height:100px; max-width:100%; border:1px solid #e2e8f0; border-radius:4px;">
            <div style="margin-top:6px;">
              <label style="font-size:11px; cursor:pointer;">
                <input type="checkbox" id="sig-remove-white" checked> Tự động tẩy nền trắng thành trong suốt
              </label>
            </div>
          </div>
        </div>
      </div>

      <div class="rb-modal-footer">
        <button class="btn btn-small" id="sig-cancel-btn">Hủy bỏ</button>
        <button class="btn btn-small btn-success" id="sig-insert-btn" style="font-weight:bold;">✍️ Chèn Chữ Ký Lên Trang</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  signatureModal = overlay;

  // Setup drawing canvas
  const canvas = overlay.querySelector('#sig-canvas');
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#0284c7';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  let drawing = false;
  let hasDrawn = false;
  let currentColor = '#0284c7';

  function getCanvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function startDraw(e) {
    e.preventDefault();
    drawing = true;
    hasDrawn = true;
    const pos = getCanvasPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }

  function moveDraw(e) {
    if (!drawing) return;
    e.preventDefault();
    const pos = getCanvasPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }

  function endDraw() {
    drawing = false;
  }

  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', moveDraw);
  canvas.addEventListener('mouseup', endDraw);
  canvas.addEventListener('mouseleave', endDraw);
  canvas.addEventListener('touchstart', startDraw, { passive: false });
  canvas.addEventListener('touchmove', moveDraw, { passive: false });
  canvas.addEventListener('touchend', endDraw);

  // Clear button
  overlay.querySelector('#sig-clear-btn').addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawn = false;
  });

  // Color buttons
  overlay.querySelectorAll('[data-sig-color]').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('[data-sig-color]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentColor = btn.dataset.sigColor;
      ctx.strokeStyle = currentColor;
    });
  });

  // Tab switcher
  let mode = 'draw';
  const drawTab = overlay.querySelector('#sig-tab-draw');
  const uploadTab = overlay.querySelector('#sig-tab-upload');
  const drawSec = overlay.querySelector('#sig-draw-section');
  const uploadSec = overlay.querySelector('#sig-upload-section');

  drawTab.addEventListener('click', () => {
    mode = 'draw';
    drawTab.classList.add('active');
    uploadTab.classList.remove('active');
    drawSec.style.display = 'block';
    uploadSec.style.display = 'none';
  });

  uploadTab.addEventListener('click', () => {
    mode = 'upload';
    uploadTab.classList.add('active');
    drawTab.classList.remove('active');
    uploadSec.style.display = 'block';
    drawSec.style.display = 'none';
  });

  // Image Upload handler
  let uploadedImgBlob = null;
  const fileInput = overlay.querySelector('#sig-file-input');
  const previewBox = overlay.querySelector('#sig-preview-box');
  const previewImg = overlay.querySelector('#sig-preview-img');

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    uploadedImgBlob = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      previewImg.src = e.target.result;
      previewBox.style.display = 'block';
    };
    reader.readAsDataURL(file);
  });

  // Insert signature
  overlay.querySelector('#sig-insert-btn').addEventListener('click', async () => {
    let pngBytes = null;

    if (mode === 'draw') {
      if (!hasDrawn) {
        if (window.toast) window.toast('Vui lòng vẽ chữ ký trước khi chèn.', 'warning');
        return;
      }
      pngBytes = await new Promise(res => {
        canvas.toBlob(async b => {
          res(new Uint8Array(await b.arrayBuffer()));
        }, 'image/png');
      });
    } else {
      if (!uploadedImgBlob) {
        if (window.toast) window.toast('Vui lòng chọn ảnh chữ ký.', 'warning');
        return;
      }
      const bmp = await createImageBitmap(uploadedImgBlob);
      const cv = document.createElement('canvas');
      cv.width = bmp.width;
      cv.height = bmp.height;
      const cctx = cv.getContext('2d');
      cctx.drawImage(bmp, 0, 0);

      const removeWhite = overlay.querySelector('#sig-remove-white')?.checked;
      if (removeWhite) {
        const imgData = cctx.getImageData(0, 0, cv.width, cv.height);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          // Check if pixel is close to white
          if (r > 215 && g > 215 && b > 215) {
            data[i + 3] = 0; // Transparent
          }
        }
        cctx.putImageData(imgData, 0, 0);
      }

      pngBytes = await new Promise(res => {
        cv.toBlob(async b => {
          res(new Uint8Array(await b.arrayBuffer()));
        }, 'image/png');
      });
    }

    overlay.remove();
    signatureModal = null;
    await stampSignatureOnCurrentPage(pngBytes);
  });

  // Close handlers
  overlay.querySelector('#sig-modal-close').addEventListener('click', () => { overlay.remove(); signatureModal = null; });
  overlay.querySelector('#sig-cancel-btn').addEventListener('click', () => { overlay.remove(); signatureModal = null; });
}

async function stampSignatureOnCurrentPage(pngBytes) {
  const currentBytes = await getEditorBytesOrAlert();
  if (!currentBytes) return;

  const curPage = typeof window.getEditorPage === 'function' ? window.getEditorPage() : 1;
  pushDocUndoState('Ký tên');
  if (window.Progress) window.Progress.show('Đang chèn chữ ký lên trang...', null);

  try {
    const pdfDoc = await PDFLib.PDFDocument.load(currentBytes);
    const pages = pdfDoc.getPages();
    const page = pages[curPage - 1];
    if (!page) throw new Error('Không tìm thấy trang ' + curPage);

    const sigImage = await pdfDoc.embedPng(pngBytes);
    const { width: W, height: H } = page.getSize();
    const sigW = 160;
    const sigH = sigW * (sigImage.height / sigImage.width);

    // Place signature nicely at lower-right section (standard signature location)
    const posX = W - sigW - 60;
    const posY = 100;

    page.drawImage(sigImage, {
      x: posX,
      y: posY,
      width: sigW,
      height: sigH
    });

    const outBytes = await pdfDoc.save();
    await window.editorLoadBytes(outBytes, window.getEditorFileName(), true);
    if (window.toast) {
      window.toast(`✍️ Đã chèn chữ ký thành công vào trang ${curPage}!`, 'success');
    }
  } catch (err) {
    console.error('Lỗi chèn chữ ký:', err);
    if (window.toast) window.toast('Lỗi chèn chữ ký: ' + err.message, 'error');
  } finally {
    if (window.Progress) window.Progress.hide();
    updateRibbonDocState();
  }
}

// ======================== FILE DROPDOWN ========================

function openFileDropdown(btn) {
  const existing = document.getElementById('rb-file-dropdown');
  if (existing) { existing.remove(); return; }

  const rect = btn.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.id = 'rb-file-dropdown';
  menu.style.cssText = `
    position: fixed;
    top: ${rect.bottom + 2}px;
    left: ${rect.left}px;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
    z-index: 10000;
    min-width: 220px;
    padding: 6px 0;
  `;

  menu.innerHTML = `
    <div style="padding:4px 14px; font-size:11px; font-weight:bold; color:#6b7280; text-transform:uppercase;">Thao tác Tệp</div>
    <button class="menu-item" id="f-open-btn" style="width:100%; text-align:left; padding:8px 14px; border:none; background:transparent; cursor:pointer; font-size:12.5px; display:flex; gap:8px;">📁 Mở file PDF mới...</button>
    <button class="menu-item" id="f-save-btn" style="width:100%; text-align:left; padding:8px 14px; border:none; background:transparent; cursor:pointer; font-size:12.5px; display:flex; gap:8px;">💾 Lưu / Xuất PDF đã sửa</button>
    <button class="menu-item" id="f-print-btn" style="width:100%; text-align:left; padding:8px 14px; border:none; background:transparent; cursor:pointer; font-size:12.5px; display:flex; gap:8px;">🖨️ In trang đang xem</button>
    <div style="height:1px; background:#e2e8f0; margin:6px 0;"></div>
    <button class="menu-item" id="f-to-tools-btn" style="width:100%; text-align:left; padding:8px 14px; border:none; background:transparent; cursor:pointer; font-size:12.5px; display:flex; gap:8px;">🧰 Chuyển sang Công cụ PDF</button>
    <button class="menu-item" id="f-to-sign-btn" style="width:100%; text-align:left; padding:8px 14px; border:none; background:transparent; cursor:pointer; font-size:12.5px; display:flex; gap:8px;">✍️ Chuyển sang Ký tên chuyên sâu</button>
  `;

  document.body.appendChild(menu);

  const closeMenu = (e) => {
    if (!menu.contains(e.target) && e.target !== btn) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);

  menu.querySelector('#f-open-btn')?.addEventListener('click', () => {
    menu.remove();
    document.getElementById('editor-file-input')?.click();
  });
  menu.querySelector('#f-save-btn')?.addEventListener('click', () => {
    menu.remove();
    if (typeof window.editorExportPDF === 'function') window.editorExportPDF();
  });
  menu.querySelector('#f-print-btn')?.addEventListener('click', () => {
    menu.remove();
    if (typeof window.printEditorStage === 'function') window.printEditorStage();
  });
  menu.querySelector('#f-to-tools-btn')?.addEventListener('click', async () => {
    menu.remove();
    const bytes = typeof window.getEditorPdfBytes === 'function' ? window.getEditorPdfBytes() : null;
    if (bytes && typeof window.loadFileIntoToolsTab === 'function') {
      await window.loadFileIntoToolsTab(bytes, (window.getEditorFileName() || 'tailieu') + '.pdf', 'margin');
    } else {
      window.switchTab?.('tab-tools');
    }
  });
  menu.querySelector('#f-to-sign-btn')?.addEventListener('click', async () => {
    menu.remove();
    const bytes = typeof window.getEditorPdfBytes === 'function' ? window.getEditorPdfBytes() : null;
    if (bytes && typeof window.loadFileIntoSignTab === 'function') {
      await window.loadFileIntoSignTab(bytes, (window.getEditorFileName() || 'tailieu') + '.pdf');
    } else {
      window.switchTab?.('tab-sign');
    }
  });
}

// ======================== HELPERS ========================

async function getEditorBytesOrAlert() {
  const bytes = typeof window.getEditorCurrentPdfBytes === 'function' ? await window.getEditorCurrentPdfBytes() : null;
  if (!bytes) {
    if (window.toast) window.toast('Vui lòng mở một file PDF trước khi áp dụng công cụ.', 'warning');
    else alert('Vui lòng mở một file PDF trước khi áp dụng công cụ.');
    return null;
  }
  return bytes;
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const bigint = parseInt(clean, 16);
  if (clean.length === 3) {
    const r = (bigint >> 8) & 0xf;
    const g = (bigint >> 4) & 0xf;
    const b = bigint & 0xf;
    return { r: (r << 4) | r, g: (g << 4) | g, b: (b << 4) | b };
  }
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255
  };
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}
