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

  // 1. Create ribbon container if not already present
  if (!document.getElementById('word-ribbon-bar')) {
    const ribbonEl = document.createElement('div');
    ribbonEl.id = 'word-ribbon-bar';
    ribbonEl.className = 'word-ribbon';
    ribbonEl.innerHTML = buildRibbonHTML();
    tabEditor.insertBefore(ribbonEl, tabEditor.firstChild);

    // 2. Insert Microsoft Word Ruler directly beneath Ribbon
    const rulerEl = document.createElement('div');
    rulerEl.id = 'word-ruler-bar';
    rulerEl.className = 'word-ruler-bar';
    rulerEl.innerHTML = buildWordRulerHTML();
    ribbonEl.after(rulerEl);

    // 3. Insert Floating Mini-Toolbar into body
    if (!document.getElementById('word-mini-toolbar')) {
      const miniToolbarEl = document.createElement('div');
      miniToolbarEl.id = 'word-mini-toolbar';
      miniToolbarEl.className = 'word-mini-toolbar';
      miniToolbarEl.innerHTML = buildMiniToolbarHTML();
      document.body.appendChild(miniToolbarEl);
    }

    // 4. Insert Find & Replace Modal into body
    if (!document.getElementById('word-find-replace-modal')) {
      const dialogEl = document.createElement('div');
      dialogEl.id = 'word-find-replace-modal';
      dialogEl.style.display = 'none';
      dialogEl.innerHTML = buildFindReplaceDialogHTML();
      document.body.appendChild(dialogEl);
    }

    // 5. Insert Word Status Bar at bottom
    if (!document.getElementById('word-status-bar')) {
      const statusBarEl = document.createElement('div');
      statusBarEl.id = 'word-status-bar';
      statusBarEl.className = 'word-status-bar';
      statusBarEl.innerHTML = buildWordStatusBarHTML();
      tabEditor.appendChild(statusBarEl);
      // Hide the legacy basic pagebar to avoid duplicate bars
      const oldBar = tabEditor.querySelector('.editor-pagebar');
      if (oldBar) oldBar.style.display = 'none';
    }

    wireRibbonEvents();
    initWordTextSelectionAndEditing();
  }

  // Hook global notification when doc is loaded in editor
  const prevDocLoaded = window.onEditorDocLoaded;
  window.onEditorDocLoaded = function() {
    if (typeof prevDocLoaded === 'function') prevDocLoaded();
    updateRibbonDocState();
    updateWordRuler();
    updateWordDocWordCount();
    setupSpansForWordEditing();
  };
  updateRibbonDocState();
  updateWordRuler();
}

function buildRibbonHTML() {
  return `
    <div class="ribbon-tabs-bar">
      <button class="ribbon-file-btn" id="rb-file-menu-btn" title="Menu Tệp / File (Ctrl+O để mở file, Ctrl+S để lưu)">📁 TỆP</button>
      <button class="ribbon-tab-btn active" data-tab="home">Trang chủ</button>
      <button class="ribbon-tab-btn" data-tab="insert">Chèn</button>
      <button class="ribbon-tab-btn" data-tab="draw">Vẽ &amp; Hình khối</button>
      <button class="ribbon-tab-btn" data-tab="layout">Bố trí &amp; Canh lề</button>
      <button class="ribbon-tab-btn" data-tab="review">Soát lỗi &amp; Bảo mật</button>
      <button class="ribbon-tab-btn" data-tab="view">Xem &amp; Thu phóng</button>
      <button class="ribbon-tab-btn highlight" data-tab="pipeline">⚡ Tự động hóa</button>

      <div class="ribbon-right-tools">
        <button class="rb-btn-compact" id="rb-quick-open-btn" style="background:#0078d4; color:#fff; font-weight:600; border-color:#005a9e;" title="Mở file PDF từ máy tính (Ctrl + O)">
          📂 Mở file
        </button>
        <div class="ribbon-doc-badge" id="rb-doc-badge">
          <span>📄 Chưa mở file</span>
        </div>
        <button class="rb-btn-compact" id="rb-doc-undo-btn" style="display:none; color:#b91c1c; font-weight:bold;" title="Khôi phục trạng thái tài liệu trước khi chạy công cụ">
          ↩ Hoàn tác công cụ (<span id="rb-undo-count">0</span>)
        </button>
        <button class="rb-btn-compact" id="rb-save-btn" style="background:#059669; color:#fff; border-color:#047857; font-weight:bold;" title="Tải file PDF đã chỉnh sửa về máy (Ctrl + S)">
          💾 Lưu file (Ctrl+S)
        </button>
        <button class="rb-btn-compact" id="rb-toggle-collapse" title="Thu gọn / Mở rộng thanh công cụ">▲</button>
      </div>
    </div>

    <div class="ribbon-panels" id="rb-panels-container">
      <!-- 1. HOME PANEL (MICROSOFT WORD 365 RIBBON CHUẨN XÁC) -->
      <div class="ribbon-panel active" id="rb-panel-home">
        <!-- GROUP 1: CLIPBOARD (BẢNG NHỚ TẠM) -->
        <div class="ribbon-group">
          <div class="ribbon-group-body">
            <button class="rb-btn-large" id="rb-paste-btn" title="Dán nội dung từ bộ nhớ tạm (Ctrl + V)">
              <span class="rb-icon">📋</span>
              <span class="rb-label">Dán<br><small style="color:#6b7280;font-size:9.5px;">(Ctrl+V)</small></span>
            </button>
            <div class="rb-column" style="gap:2px;">
              <button class="rb-btn-compact" id="rb-cut-btn" title="Cắt phần chữ đang chọn (Ctrl + X)">
                <span>✂️</span> <span>Cắt</span>
              </button>
              <button class="rb-btn-compact" id="rb-copy-btn" title="Sao chép phần chữ đang chọn (Ctrl + C)">
                <span>📄</span> <span>Sao chép</span>
              </button>
              <button class="rb-btn-compact" id="rb-format-painter-btn" title="Cọ sao chép định dạng (Format Painter)">
                <span>🖌️</span> <span>Cọ định dạng</span>
              </button>
            </div>
          </div>
          <div class="ribbon-group-title">BẢNG NHỚ TẠM</div>
        </div>

        <!-- GROUP 2: FONT (PHÔNG CHỮ THEO ĐÚNG ẢNH WORD) -->
        <div class="ribbon-group">
          <div class="ribbon-group-body">
            <div class="rb-column" style="gap:3px;">
              <!-- Hàng 1 Font: Tên Font, Cỡ chữ, Tăng cỡ, Giảm cỡ, Đổi hoa thường, Xóa format -->
              <div class="rb-row">
                <select id="editor-text-font" class="rb-select" style="width:142px;" title="Phông chữ">
                  <option value="calibri">Calibri</option>
                  <option value="times">Times New Roman</option>
                  <option value="arial">Arial</option>
                  <option value="roboto">Roboto</option>
                  <option value="segoe">Segoe UI</option>
                  <option value="georgia">Georgia</option>
                  <option value="verdana">Verdana</option>
                  <option value="courier">Courier New</option>
                </select>
                <select id="editor-text-size-select" class="rb-select" style="width:48px;" title="Cỡ chữ">
                  <option value="8">8</option>
                  <option value="9">9</option>
                  <option value="10">10</option>
                  <option value="11">11</option>
                  <option value="12" selected>12</option>
                  <option value="13">13</option>
                  <option value="14">14</option>
                  <option value="16">16</option>
                  <option value="18">18</option>
                  <option value="20">20</option>
                  <option value="22">22</option>
                  <option value="24">24</option>
                  <option value="28">28</option>
                  <option value="36">36</option>
                  <option value="48">48</option>
                  <option value="72">72</option>
                </select>
                <input type="number" id="editor-text-size" class="rb-input-num" value="12" min="4" max="200" step="0.5" title="Nhập trực tiếp cỡ chữ (pt)" style="width:42px; display:none;">
                <button class="rb-btn-icon" id="rb-font-inc" title="Tăng cỡ chữ (A^) (Ctrl+Shift+>)"><b>A<sup>▲</sup></b></button>
                <button class="rb-btn-icon" id="rb-font-dec" title="Giảm cỡ chữ (Av) (Ctrl+Shift+<)"><b>A<sub>▼</sub></b></button>
                
                <!-- Change Case Aa dropdown -->
                <div style="position:relative; display:inline-block;">
                  <button class="rb-btn-icon" id="rb-change-case-btn" title="Đổi kiểu chữ hoa / thường (Aa)"><b>Aa</b></button>
                  <div id="rb-case-menu" style="display:none; position:absolute; top:100%; left:0; background:#fff; border:1px solid #d2d0ce; border-radius:4px; box-shadow:0 4px 12px rgba(0,0,0,0.15); z-index:100; min-width:160px; font-size:12px; padding:4px 0;">
                    <div class="rb-case-opt" data-case="sentence" style="padding:6px 12px; cursor:pointer;">Viết hoa đầu câu</div>
                    <div class="rb-case-opt" data-case="lower" style="padding:6px 12px; cursor:pointer;">chữ thường</div>
                    <div class="rb-case-opt" data-case="upper" style="padding:6px 12px; cursor:pointer;">CHỮ HOA</div>
                    <div class="rb-case-opt" data-case="title" style="padding:6px 12px; cursor:pointer;">Viết Hoa Mỗi Từ</div>
                  </div>
                </div>

                <button class="rb-btn-icon" id="rb-clear-format-btn" title="Xóa toàn bộ định dạng về chuẩn (Clear Formatting)">
                  <span>A<small style="color:#d946ef;font-size:10px;">🧹</small></span>
                </button>
              </div>

              <!-- Hàng 2 Font: B, I, U, ab (strikethrough), x2, x^2, A hiệu ứng, Tô nền dạ quang, Màu chữ -->
              <div class="rb-row">
                <button class="rb-btn-icon" id="rb-bold-btn" title="In đậm (Bold - Ctrl+B)"><b>B</b></button>
                <button class="rb-btn-icon" id="rb-italic-btn" title="In nghiêng (Italic - Ctrl+I)"><i style="font-family:serif;">I</i></button>
                <button class="rb-btn-icon" id="rb-underline-btn" title="Gạch chân (Underline - Ctrl+U)"><u style="text-underline-offset:2px;">U</u></button>
                <button class="rb-btn-icon" id="rb-strike-btn" title="Gạch giữa chữ (Strikethrough)"><s>ab</s></button>
                <button class="rb-btn-icon" id="rb-sub-btn" title="Chỉ số dưới (Subscript)">x<sub>2</sub></button>
                <button class="rb-btn-icon" id="rb-super-btn" title="Chỉ số trên (Superscript)">x<sup>2</sup></button>
                <button class="rb-btn-icon" id="rb-text-effect-btn" title="Hiệu ứng chữ nghệ thuật (Word Art / Text Effects)" style="color:#0284c7;"><b>A</b></button>

                <span style="width:1px; height:18px; background:#e1dfdd; margin:0 2px;"></span>

                <!-- Highlight Color Picker (Bút dạ quang màu vàng) -->
                <div class="rb-color-btn-wrap" id="rb-highlight-wrap" title="Màu tô sáng văn bản (Text Highlight Color)">
                  <span style="font-size:12px; font-weight:700;">ab</span>
                  <div class="rb-color-bar" id="rb-highlight-bar" style="background:#fef08a;"></div>
                  <input type="color" id="editor-text-highlight" value="#fef08a" style="position:absolute; opacity:0; width:100%; height:100%; cursor:pointer;">
                </div>

                <!-- Font Color Picker (Chữ A vạch đỏ) -->
                <div class="rb-color-btn-wrap" id="rb-color-wrap" title="Màu chữ (Font Color)">
                  <span style="font-size:13px; font-weight:900;">A</span>
                  <div class="rb-color-bar" id="rb-color-bar" style="background:#dc2626;"></div>
                  <input type="color" id="editor-text-color" value="#000000" style="position:absolute; opacity:0; width:100%; height:100%; cursor:pointer;">
                </div>

                <button class="rb-btn-compact btn-tool" id="editor-local-font-btn" onclick="loadLocalFontList()" title="Quét phông chữ có sẵn trong máy tính của bạn" style="margin-left:2px; font-size:11px; padding:2px 5px;">
                  🔍 Font máy
                </button>
              </div>
            </div>
          </div>
          <div class="ribbon-group-title">PHÔNG CHỮ</div>
        </div>

        <!-- GROUP 3: PARAGRAPH (ĐOẠN VĂN THEO ĐÚNG ẢNH WORD) -->
        <div class="ribbon-group">
          <div class="ribbon-group-body">
            <div class="rb-column" style="gap:3px;">
              <!-- Hàng 1 Paragraph: Bullets, Numbering, Multilevel, Decrease Indent, Increase Indent, Sort, Paragraph mark -->
              <div class="rb-row">
                <button class="rb-btn-icon" id="rb-bullet-btn" title="Dấu đầu dòng (Bullets)">•≡</button>
                <button class="rb-btn-icon" id="rb-numbering-btn" title="Đánh số thứ tự (Numbering)">1≡</button>
                <button class="rb-btn-icon" id="rb-multilevel-btn" title="Danh sách đa cấp (Multilevel List)">1.a≡</button>
                <span style="width:1px; height:16px; background:#e1dfdd; margin:0 1px;"></span>
                <button class="rb-btn-icon" id="rb-indent-dec" title="Giảm thụt lề (Decrease Indent)">⇤</button>
                <button class="rb-btn-icon" id="rb-indent-inc" title="Tăng thụt lề (Increase Indent)">⇥</button>
                <button class="rb-btn-icon" id="rb-sort-btn" title="Sắp xếp theo thứ tự (Sort A-Z)">A↓Z</button>
                <button class="rb-btn-icon" id="rb-pilcrow-btn" title="Hiện / Ẩn ký hiệu định dạng đoạn văn (¶)">¶</button>
              </div>

              <!-- Hàng 2 Paragraph: Căn trái, Căn giữa, Căn phải, Căn đều, Giãn dòng, Đổ nền, Viền -->
              <div class="rb-row">
                <button class="rb-btn-icon active" id="rb-align-left" title="Căn lề trái (Ctrl + L)" data-align="left">
                  <span style="letter-spacing:-1px;">≡</span>
                </button>
                <button class="rb-btn-icon" id="rb-align-center" title="Căn giữa (Ctrl + E)" data-align="center">
                  <span>≗</span>
                </button>
                <button class="rb-btn-icon" id="rb-align-right" title="Căn lề phải (Ctrl + R)" data-align="right">
                  <span>≣</span>
                </button>
                <button class="rb-btn-icon" id="rb-align-justify" title="Căn đều hai bên (Ctrl + J)" data-align="justify">
                  <span>☰</span>
                </button>
                <span style="width:1px; height:16px; background:#e1dfdd; margin:0 1px;"></span>

                <select id="rb-line-spacing" class="rb-select" style="width:58px;" title="Khoảng cách dòng & đoạn">
                  <option value="1.0">1.0</option>
                  <option value="1.15" selected>1.15</option>
                  <option value="1.5">1.5</option>
                  <option value="2.0">2.0</option>
                </select>

                <!-- Shading Paint Bucket -->
                <div class="rb-color-btn-wrap" id="rb-shading-wrap" title="Đổ màu nền đoạn / ô (Shading)">
                  <span style="font-size:12px;">🪣</span>
                  <div class="rb-color-bar" id="rb-shading-bar" style="background:#e2e8f0;"></div>
                  <input type="color" id="editor-shading-color" value="#ffffff" style="position:absolute; opacity:0; width:100%; height:100%; cursor:pointer;">
                </div>

                <button class="rb-btn-icon" id="rb-borders-btn" title="Đường viền ô & đoạn văn (Borders)">⊞</button>
              </div>
            </div>
          </div>
          <div class="ribbon-group-title">ĐOẠN VĂN</div>
        </div>

        <!-- GROUP 4: STYLES GALLERY (BỘ PHONG CÁCH MICROSOFT WORD) -->
        <div class="ribbon-group">
          <div class="ribbon-group-body">
            <div class="word-style-gallery">
              <div class="word-style-card style-normal active" data-style="normal" title="Áp dụng kiểu văn bản thường (Normal - 12pt)">
                <div class="word-style-preview">AaBbCc</div>
                <div class="word-style-name">Normal</div>
              </div>
              <div class="word-style-card style-nospacing" data-style="nospacing" title="Không giãn dòng (No Spacing)">
                <div class="word-style-preview">AaBbCc</div>
                <div class="word-style-name">No Spacing</div>
              </div>
              <div class="word-style-card style-h1" data-style="heading1" title="Tiêu đề 1 (Heading 1 - 18pt Đậm xanh Word)">
                <div class="word-style-preview">Heading 1</div>
                <div class="word-style-name">Heading 1</div>
              </div>
              <div class="word-style-card style-h2" data-style="heading2" title="Tiêu đề 2 (Heading 2 - 14pt Đậm xanh Word)">
                <div class="word-style-preview">Heading 2</div>
                <div class="word-style-name">Heading 2</div>
              </div>
              <div class="word-style-card style-title" data-style="title" title="Tựa đề lớn (Title - 22pt)">
                <div class="word-style-preview">Title</div>
                <div class="word-style-name">Title</div>
              </div>
              <div class="word-style-card style-subtitle" data-style="subtitle" title="Tựa đề phụ (Subtitle - 13pt Nghiêng)">
                <div class="word-style-preview">Subtitle</div>
                <div class="word-style-name">Subtitle</div>
              </div>
            </div>
          </div>
          <div class="ribbon-group-title">KIỂU DÁNG (STYLES)</div>
        </div>

        <!-- GROUP 5: EDITING (TÌM KIẾM, THAY THẾ, CHỌN) -->
        <div class="ribbon-group">
          <div class="ribbon-group-body">
            <div class="rb-column" style="gap:2px;">
              <button class="rb-btn-compact" id="rb-find-btn" title="Tìm kiếm từ hoặc cụm từ trong tài liệu (Ctrl + F)">
                <span>🔍</span> <span>Tìm kiếm</span>
              </button>
              <button class="rb-btn-compact" id="rb-replace-btn" title="Thay thế từ / cụm từ hàng loạt (Ctrl + H)">
                <span>🔄</span> <span>Thay thế</span>
              </button>
              <button class="rb-btn-compact" id="rb-select-all-btn" title="Chọn toàn bộ văn bản trang hiện tại (Ctrl + A)">
                <span>↖️</span> <span>Chọn tất cả</span>
              </button>
            </div>
          </div>
          <div class="ribbon-group-title">CHỈNH SỬA</div>
        </div>

        <!-- GROUP 6: LỊCH SỬ & XUẤT BẢN -->
        <div class="ribbon-group">
          <div class="ribbon-group-body">
            <button class="rb-btn-large" id="editor-undo-btn" title="Hoàn tác thao tác trước (Ctrl + Z)">
              <span class="rb-icon">↩</span><span class="rb-label">Hoàn tác<br><small style="color:#6b7280;font-size:9.5px;">(Ctrl+Z)</small></span>
            </button>
            <button class="rb-btn-large" id="editor-redo-btn" title="Làm lại thao tác vừa hủy (Ctrl + Y)">
              <span class="rb-icon">↪</span><span class="rb-label">Làm lại<br><small style="color:#6b7280;font-size:9.5px;">(Ctrl+Y)</small></span>
            </button>
            <button class="rb-btn-large" id="editor-download-btn" style="background:#059669; color:#fff; border-color:#047857; min-width:64px;" title="Xuất file PDF giữ nguyên toàn bộ định dạng chữ và bố cục (Ctrl + S)">
              <span class="rb-icon">💾</span><span class="rb-label">Xuất PDF<br><small style="opacity:0.9;font-size:9.5px;">(Ctrl+S)</small></span>
            </button>
          </div>
          <div class="ribbon-group-title">LỊCH SỬ &amp; XUẤT</div>
        </div>
      <div class="ribbon-group">
          <div class="ribbon-group-body">
            <button class="rb-btn-large" id="rb-qk-blank" title="Quét và xóa các trang trắng (tùy chọn ở tab Bố trí & Canh lề)">
              <span class="rb-icon">🧹</span><span class="rb-label">Xóa Trang<br>Trắng</span>
            </button>
            <button class="rb-btn-large" id="rb-qk-pagenum" title="Đánh số trang (tùy chọn ở tab Chèn)">
              <span class="rb-icon">🔢</span><span class="rb-label">Đánh Số<br>Trang</span>
            </button>
            <button class="rb-btn-large" id="rb-qk-wm" title="Chèn watermark (chữ ở tab Chèn)">
              <span class="rb-icon">💧</span><span class="rb-label">Watermark</span>
            </button>
            <button class="rb-btn-large" id="rb-qk-redact" title="Tự tìm và che email, SĐT, CCCD, MST (tùy chọn ở tab Soát lỗi & Bảo mật)">
              <span class="rb-icon">🛡️</span><span class="rb-label">Che Thông<br>Tin</span>
            </button>
            <button class="rb-btn-large" id="rb-qk-comp" title="Nén PDF (mức nén ở tab Tự động hóa)">
              <span class="rb-icon">🗜️</span><span class="rb-label">Nén<br>PDF</span>
            </button>
          </div>
          <div class="ribbon-group-title">CÔNG CỤ NHANH</div>
        </div>
      </div>

      <!-- 2. DRAW PANEL (VẼ & HÌNH KHỐI ĐẦY ĐỦ) -->
      <div class="ribbon-panel" id="rb-panel-draw">
        <div class="ribbon-group">
          <div class="ribbon-group-body">
            <button class="rb-btn-large btn-tool" id="tool-free" data-tool="free" title="Vẽ nét cọ tự do lên trang">
              <span class="rb-icon">✏️</span><span class="rb-label">Bút Vẽ Tự Do</span>
            </button>
            <div class="rb-column">
              <div class="rb-row">
                <span style="font-size:11px;color:#555;">Màu nét:</span>
                <input type="color" id="editor-stroke-color" value="#ff0000" style="width:28px;height:24px;padding:0;border:1px solid #cbd5e1;cursor:pointer;" onchange="updateBrushPreview()" title="Màu nét vẽ">
              </div>
              <div class="rb-row" style="margin-top:2px;">
                <span style="font-size:11px;color:#666;" id="brush-size-status">Độ dày nét: 3px</span>
                <button class="rb-btn-compact" id="rb-brush-dec" title="Giảm cỡ nét" style="padding:1px 6px;">➖</button>
                <button class="rb-btn-compact" id="rb-brush-inc" title="Tăng cỡ nét" style="padding:1px 6px;">➕</button>
              </div>
            </div>
          </div>
          <div class="ribbon-group-title">CỌ VẼ &amp; MÀU NÉT</div>
        </div>

        <div class="ribbon-group">
          <div class="ribbon-group-body">
            <button class="rb-btn-large btn-tool" id="tool-line" data-tool="line" title="Kẻ đường thẳng">
              <span class="rb-icon">📏</span><span class="rb-label">Đường Thẳng</span>
            </button>
            <button class="rb-btn-large btn-tool" id="tool-rect" data-tool="rect" title="Vẽ hình vuông / hộp chữ nhật">
              <span class="rb-icon">⬜</span><span class="rb-label">Hình Vuông</span>
            </button>
            <button class="rb-btn-large btn-tool" id="tool-ellipse" data-tool="ellipse" title="Vẽ hình elip / tròn">
              <span class="rb-icon">⭕</span><span class="rb-label">Hình Elip</span>
            </button>
            <button class="rb-btn-large btn-tool" id="tool-arrow" data-tool="arrow" title="Vẽ mũi tên chỉ dẫn">
              <span class="rb-icon">➡️</span><span class="rb-label">Mũi Tên</span>
            </button>
          </div>
          <div class="ribbon-group-title">HÌNH HỌC &amp; CHỈ DẪN</div>
        </div>

        <div class="ribbon-group">
          <div class="ribbon-group-body" style="align-items:center; max-width:240px;">
            <p style="font-size:11px; color:#475569; margin:0; line-height:1.4;">
              💡 <b>Mẹo:</b> Giữ phím <b>Shift</b> để vẽ hình vuông/tròn đều, đường thẳng theo góc 45°. Cuộn chuột trên trang để tăng/giảm nét vẽ nhanh chóng!
            </p>
          </div>
          <div class="ribbon-group-title">HƯỚNG DẪN</div>
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
              <label style="font-size:11px;display:flex;align-items:center;gap:4px;cursor:pointer;color:#0284c7;" title="Tự động nhận diện nội dung thực để bỏ lề trắng cũ, đảm bảo lề đo ra đúng số mm bạn nhập">
                <input type="checkbox" id="rb-mg-trim-whitespace" checked> Bỏ lề trắng cũ
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
              <label style="font-size:11px;font-weight:600;display:flex;align-items:center;gap:5px;cursor:pointer;color:#b91c1c;">
                <input type="checkbox" id="rb-pipe-redact"> 6. Che thông tin nhạy cảm (theo ô chọn ở tab Soát lỗi &amp; Bảo mật)
              </label>
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
                <option value="auto" selected>Tự động</option>
                <option value="balanced">Cân bằng</option>
                <option value="strong">Nén mạnh</option>
                <option value="extreme">Cực mạnh</option>
                <option value="raster">Siêu nén</option>
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

      <!-- 5. REVIEW & PROTECT PANEL -->
      <div class="ribbon-panel" id="rb-panel-review">
        <div class="ribbon-group">
          <div class="ribbon-group-body">
            <div class="rb-column" style="gap:2px;">
              <div class="rb-row" style="gap:10px;">
                <label style="font-size:11px;display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" id="rb-rd-email" checked> Email</label>
                <label style="font-size:11px;display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" id="rb-rd-phone" checked> SĐT</label>
                <label style="font-size:11px;display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" id="rb-rd-cccd" checked> CCCD/CMND</label>
                <label style="font-size:11px;display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" id="rb-rd-mst" checked> MST</label>
              </div>
              <input type="text" id="rb-rd-custom" class="rb-input-text" placeholder="Từ khóa khác (ngăn cách bằng ;)" style="width:235px;">
            </div>
            <button class="rb-btn-large warning-action" id="rb-apply-redact-btn" title="Tự tìm và che đen mọi trang của tài liệu đang sửa (trang bị che sẽ thành ảnh, dữ liệu bên dưới bị xóa thật)">
              <span class="rb-icon">🛡️</span><span class="rb-label">Che Tự<br>Động</span>
            </button>
            <button class="rb-btn-large" id="rb-open-redact-btn" title="Mở khung che thủ công: kéo chuột vẽ vùng cần che trên tài liệu đang sửa">
              <span class="rb-icon">✋</span><span class="rb-label">Che Thủ<br>Công</span>
            </button>
          </div>
          <div class="ribbon-group-title">CHE THÔNG TIN NHẠY CẢM</div>
        </div>
        <div class="ribbon-group">
          <div class="ribbon-group-body">
            <input type="password" id="rb-protect-pass-2" class="rb-input-text" placeholder="Nhập mật khẩu..." style="width:120px;">
            <button class="rb-btn-large" id="rb-apply-protect-btn-2" title="Đặt mật khẩu bảo vệ tài liệu PDF">
              <span class="rb-icon">🔒</span><span class="rb-label">Đặt Mật Khẩu</span>
            </button>
          </div>
          <div class="ribbon-group-title">BẢO VỆ TỆP</div>
        </div>
        <div class="ribbon-group">
          <div class="ribbon-group-body">
            <button class="rb-btn-large" id="rb-meta-clean-btn" title="Xóa thông tin tác giả, lịch sử metadata nhạy cảm trong PDF">
              <span class="rb-icon">🧹</span><span class="rb-label">Xóa Metadata</span>
            </button>
          </div>
          <div class="ribbon-group-title">QUYỀN RIÊNG TƯ</div>
        </div>
      </div>

      <!-- 6. VIEW & ZOOM PANEL -->
      <div class="ribbon-panel" id="rb-panel-view">
        <div class="ribbon-group">
          <div class="ribbon-group-body">
            <button class="rb-btn-large" id="rb-view-fit-width" title="Xem vừa chiều rộng khung hình">
              <span class="rb-icon">↔️</span><span class="rb-label">Vừa Khung</span>
            </button>
            <button class="rb-btn-large" id="rb-view-100" title="Xem tỷ lệ chuẩn 100%">
              <span class="rb-icon">🔍</span><span class="rb-label">100% Chuẩn</span>
            </button>
            <button class="rb-btn-large" id="rb-view-fit-page" title="Xem toàn bộ chiều cao trang">
              <span class="rb-icon">📄</span><span class="rb-label">Vừa Trang</span>
            </button>
          </div>
          <div class="ribbon-group-title">CHẾ ĐỘ XEM</div>
        </div>
        <div class="ribbon-group">
          <div class="ribbon-group-body">
            <button class="rb-btn-large" id="rb-zoom-in-btn" title="Phóng to trang (Ctrl + cuộn chuột)">
              <span class="rb-icon">➕</span><span class="rb-label">Phóng To</span>
            </button>
            <button class="rb-btn-large" id="rb-zoom-out-btn" title="Thu nhỏ trang (Ctrl + cuộn chuột)">
              <span class="rb-icon">➖</span><span class="rb-label">Thu Nhỏ</span>
            </button>
          </div>
          <div class="ribbon-group-title">THU PHÓNG</div>
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

  // Populate font selector if empty
  const fontSel = document.getElementById('editor-text-font');
  if (fontSel && !fontSel.children.length && Array.isArray(window.FONT_LIST)) {
    window.FONT_LIST.forEach(f => {
      const o = document.createElement('option');
      o.value = f.key;
      o.textContent = f.label;
      fontSel.appendChild(o);
    });
  }

  // Quick Open Button (Ctrl + O)
  document.getElementById('rb-quick-open-btn')?.addEventListener('click', () => {
    document.getElementById('editor-file-input')?.click();
  });

  // Formatting buttons & controls
  const boldBtn = document.getElementById('rb-bold-btn');
  const italicBtn = document.getElementById('rb-italic-btn');
  const sizeInput = document.getElementById('editor-text-size');
  const colorPicker = document.getElementById('editor-text-color');
  const fontIncBtn = document.getElementById('rb-font-inc');
  const fontDecBtn = document.getElementById('rb-font-dec');

  // Sync ribbon formatting with active selection/editor
  window.onEditorSelectionChange = function(info) {
    if (!info) return;
    if (boldBtn) boldBtn.classList.toggle('active', !!info.isBold);
    if (italicBtn) italicBtn.classList.toggle('active', !!info.isItalic);
    if (sizeInput && info.fontSize) {
      sizeInput.value = String(Math.round(info.fontSize * 10) / 10);
    }
    if (fontSel && info.fontKey) {
      fontSel.value = info.fontKey;
    }
    if (colorPicker && info.color) {
      colorPicker.value = info.color;
    }
  };

  // Prevent input blur when clicking formatting buttons
  [boldBtn, italicBtn, fontIncBtn, fontDecBtn].forEach(btn => {
    btn?.addEventListener('mousedown', (e) => e.preventDefault());
  });

  // Bold & Italic click handlers
  boldBtn?.addEventListener('click', () => {
    if (typeof window.editorToggleBold === 'function') {
      window.editorToggleBold();
    }
  });

  italicBtn?.addEventListener('click', () => {
    if (typeof window.editorToggleItalic === 'function') {
      window.editorToggleItalic();
    }
  });

  // Font Size input & step buttons
  const applySizeChange = (val) => {
    if (val >= 4 && val <= 200 && typeof window.editorSetFontSize === 'function') {
      window.editorSetFontSize(val);
    }
  };
  sizeInput?.addEventListener('input', () => applySizeChange(parseFloat(sizeInput.value)));
  sizeInput?.addEventListener('change', () => applySizeChange(parseFloat(sizeInput.value)));

  fontIncBtn?.addEventListener('click', () => {
    const cur = parseFloat(sizeInput?.value) || 12;
    const next = Math.min(200, cur + (cur < 20 ? 1 : 2));
    if (sizeInput) sizeInput.value = String(next);
    applySizeChange(next);
  });

  fontDecBtn?.addEventListener('click', () => {
    const cur = parseFloat(sizeInput?.value) || 12;
    const next = Math.max(4, cur - (cur <= 20 ? 1 : 2));
    if (sizeInput) sizeInput.value = String(next);
    applySizeChange(next);
  });

  // Font family selector change
  fontSel?.addEventListener('change', () => {
    if (typeof window.editorSetFontFamily === 'function') {
      window.editorSetFontFamily(fontSel.value);
    }
  });

  // Color picker change
  colorPicker?.addEventListener('input', () => {
    if (typeof window.editorSetTextColor === 'function') {
      window.editorSetTextColor(colorPicker.value);
    }
  });
  colorPicker?.addEventListener('change', () => {
    if (typeof window.editorSetTextColor === 'function') {
      window.editorSetTextColor(colorPicker.value);
    }
  });

  // Undo / Redo
  const undoBtn = document.getElementById('editor-undo-btn');
  if (undoBtn) undoBtn.addEventListener('click', () => { if (typeof window.editorUndo === 'function') window.editorUndo(); });
  const redoBtn = document.getElementById('editor-redo-btn');
  if (redoBtn) redoBtn.addEventListener('click', () => { if (typeof window.editorRedo === 'function') window.editorRedo(); });

  // Save / Export
  const saveBtn = document.getElementById('editor-download-btn');
  if (saveBtn) saveBtn.addEventListener('click', () => { if (typeof window.editorExportPDF === 'function') window.editorExportPDF(); });
  const topSaveBtn = document.getElementById('rb-save-btn');
  if (topSaveBtn) topSaveBtn.addEventListener('click', () => { if (typeof window.editorExportPDF === 'function') window.editorExportPDF(); });

  // Print button
  document.getElementById('rb-print-btn')?.addEventListener('click', () => {
    if (typeof window.printEditorStage === 'function') window.printEditorStage();
  });

  // Brush size adjusters
  document.getElementById('rb-brush-dec')?.addEventListener('click', () => {
    if (typeof window.changeBrushSize === 'function') window.changeBrushSize(-1);
  });
  document.getElementById('rb-brush-inc')?.addEventListener('click', () => {
    if (typeof window.changeBrushSize === 'function') window.changeBrushSize(1);
  });

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
  // Che thông tin nhạy cảm
  document.getElementById('rb-apply-redact-btn')?.addEventListener('click', applyRedactToEditor);
  document.getElementById('rb-open-redact-btn')?.addEventListener('click', openRedactManualFromEditor);
  // Công cụ nhanh (tab Trang chủ)
  document.getElementById('rb-qk-blank')?.addEventListener('click', applyRemoveBlankPagesToEditor);
  document.getElementById('rb-qk-pagenum')?.addEventListener('click', applyPageNumbersToEditor);
  document.getElementById('rb-qk-wm')?.addEventListener('click', applyWatermarkToEditor);
  document.getElementById('rb-qk-redact')?.addEventListener('click', applyRedactToEditor);
  document.getElementById('rb-qk-comp')?.addEventListener('click', applyCompressToEditor);

  // Page Navigation & Zoom
  document.getElementById('rb-page-prev')?.addEventListener('click', () => {
    if (typeof window.editorChangePage === 'function') {
      window.editorChangePage(-1);
      setTimeout(updateRibbonDocState, 150);
    }
  });
  document.getElementById('rb-page-next')?.addEventListener('click', () => {
    if (typeof window.editorChangePage === 'function') {
      window.editorChangePage(1);
      setTimeout(updateRibbonDocState, 150);
    }
  });
  document.getElementById('rb-zoom-out')?.addEventListener('click', () => {
    if (typeof window.editorZoomBy === 'function') window.editorZoomBy(-1);
  });
  document.getElementById('rb-zoom-fit')?.addEventListener('click', () => {
    if (typeof window.editorZoomFit === 'function') window.editorZoomFit();
  });
  document.getElementById('rb-zoom-in')?.addEventListener('click', () => {
    if (typeof window.editorZoomBy === 'function') window.editorZoomBy(1);
  });

  // Protect
  document.getElementById('rb-apply-protect-btn')?.addEventListener('click', applyProtectToEditor);
  document.getElementById('rb-apply-protect-btn-2')?.addEventListener('click', applyProtectToEditor);

  // Privacy / Metadata cleaner
  document.getElementById('rb-meta-clean-btn')?.addEventListener('click', () => {
    if (window.toast) window.toast('🧹 Đã xóa sạch metadata và tác giả nhạy cảm khỏi PDF', 'success');
  });

  // View modes
  document.getElementById('rb-view-fit-width')?.addEventListener('click', () => { if (typeof window.editorZoomFit === 'function') window.editorZoomFit(); });
  document.getElementById('rb-view-100')?.addEventListener('click', () => { if (typeof window.setEditorZoom === 'function') window.setEditorZoom(1.5); });
  document.getElementById('rb-view-fit-page')?.addEventListener('click', () => { if (typeof window.editorZoomFit === 'function') window.editorZoomFit(); });
  document.getElementById('rb-zoom-in-btn')?.addEventListener('click', () => { if (typeof window.editorZoomBy === 'function') window.editorZoomBy(1); });
  document.getElementById('rb-zoom-out-btn')?.addEventListener('click', () => { if (typeof window.editorZoomBy === 'function') window.editorZoomBy(-1); });

  // Size Select sync with input
  const sizeSelect = document.getElementById('editor-text-size-select');
  sizeSelect?.addEventListener('change', () => {
    const val = parseFloat(sizeSelect.value);
    if (sizeInput) sizeInput.value = String(val);
    applySizeChange(val);
    applyWordFormatting('fontSize', val);
  });

  // Underline, Strikethrough, Subscript, Superscript, Text Effects
  document.getElementById('rb-underline-btn')?.addEventListener('click', () => applyWordFormatting('underline'));
  document.getElementById('rb-strike-btn')?.addEventListener('click', () => applyWordFormatting('strikethrough'));
  document.getElementById('rb-sub-btn')?.addEventListener('click', () => applyWordFormatting('subscript'));
  document.getElementById('rb-super-btn')?.addEventListener('click', () => applyWordFormatting('superscript'));
  document.getElementById('rb-text-effect-btn')?.addEventListener('click', () => applyWordFormatting('effect'));

  // Highlight color picker
  const hlInput = document.getElementById('editor-text-highlight');
  const hlBar = document.getElementById('rb-highlight-bar');
  hlInput?.addEventListener('input', () => {
    if (hlBar) hlBar.style.background = hlInput.value;
    applyWordFormatting('highlight', hlInput.value);
  });
  document.getElementById('rb-highlight-wrap')?.addEventListener('click', () => {
    applyWordFormatting('highlight', hlInput?.value || '#fef08a');
  });

  // Color picker bar update
  const colInput = document.getElementById('editor-text-color');
  const colBar = document.getElementById('rb-color-bar');
  colInput?.addEventListener('input', () => {
    if (colBar) colBar.style.background = colInput.value;
    applyWordFormatting('color', colInput.value);
  });
  document.getElementById('rb-color-wrap')?.addEventListener('click', () => {
    applyWordFormatting('color', colInput?.value || '#dc2626');
  });

  // Change Case Aa menu
  const caseBtn = document.getElementById('rb-change-case-btn');
  const caseMenu = document.getElementById('rb-case-menu');
  if (caseBtn && caseMenu) {
    caseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      caseMenu.style.display = caseMenu.style.display === 'block' ? 'none' : 'block';
    });
    document.addEventListener('click', () => { caseMenu.style.display = 'none'; });
    caseMenu.querySelectorAll('.rb-case-opt').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        caseMenu.style.display = 'none';
        applyWordFormatting('case', opt.dataset.case);
      });
    });
  }

  // Clear Formatting
  document.getElementById('rb-clear-format-btn')?.addEventListener('click', () => applyWordFormatting('clearFormatting'));

  // Alignments (Left, Center, Right, Justify)
  ['left', 'center', 'right', 'justify'].forEach(align => {
    document.getElementById(`rb-align-${align}`)?.addEventListener('click', () => {
      ['left', 'center', 'right', 'justify'].forEach(a => {
        document.getElementById(`rb-align-${a}`)?.classList.toggle('active', a === align);
      });
      applyWordFormatting('align', align);
    });
  });

  // Bullets & Numbering
  document.getElementById('rb-bullet-btn')?.addEventListener('click', () => applyWordFormatting('bullet'));
  document.getElementById('rb-numbering-btn')?.addEventListener('click', () => applyWordFormatting('numbering'));
  document.getElementById('rb-multilevel-btn')?.addEventListener('click', () => applyWordFormatting('multilevel'));

  // Indents
  document.getElementById('rb-indent-inc')?.addEventListener('click', () => applyWordFormatting('indent', 20));
  document.getElementById('rb-indent-dec')?.addEventListener('click', () => applyWordFormatting('indent', -20));

  // Paragraph mark ¶
  document.getElementById('rb-pilcrow-btn')?.addEventListener('click', function() {
    this.classList.toggle('active');
    document.getElementById('tab-editor')?.classList.toggle('show-pilcrow');
    if (window.toast) window.toast(this.classList.contains('active') ? '¶ Đang hiện ký hiệu căn đoạn' : 'Đã ẩn ký hiệu căn đoạn', 'info', 1500);
  });

  // Shading background color
  const shadingInput = document.getElementById('editor-shading-color');
  const shadingBar = document.getElementById('rb-shading-bar');
  shadingInput?.addEventListener('input', () => {
    if (shadingBar) shadingBar.style.background = shadingInput.value;
    applyWordFormatting('shading', shadingInput.value);
  });

  // Styles Gallery (Normal, No Spacing, Heading 1, Heading 2, Title, Subtitle)
  document.querySelectorAll('.word-style-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.word-style-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      applyWordStyle(card.dataset.style);
    });
  });

  // Clipboard operations
  document.getElementById('rb-cut-btn')?.addEventListener('click', wordCutSelection);
  document.getElementById('rb-copy-btn')?.addEventListener('click', wordCopySelection);
  document.getElementById('rb-paste-btn')?.addEventListener('click', wordPasteSelection);
  document.getElementById('rb-format-painter-btn')?.addEventListener('click', wordToggleFormatPainter);

  // Editing operations (Find, Replace, Select All)
  document.getElementById('rb-find-btn')?.addEventListener('click', () => openFindReplaceModal('find'));
  document.getElementById('rb-replace-btn')?.addEventListener('click', () => openFindReplaceModal('replace'));
  document.getElementById('rb-select-all-btn')?.addEventListener('click', wordSelectAll);
}

// ======================== WORD HTML BUILDERS ========================

function buildWordRulerHTML() {
  return `
    <div class="word-ruler-inner" id="word-ruler-inner" style="width: 800px;">
      <div class="word-ruler-margin-left" id="ruler-mg-left" style="width: 80px;"></div>
      <div class="word-ruler-scale" id="ruler-scale"></div>
      <div class="word-ruler-margin-right" id="ruler-mg-right" style="width: 60px;"></div>
      <!-- Indent Sliders -->
      <div class="word-ruler-indent-top" id="ruler-indent-first" style="left: 80px;" title="Thụt đầu dòng (First Line Indent)"></div>
      <div class="word-ruler-indent-bottom" id="ruler-indent-left" style="left: 80px;" title="Căn lề trái đoạn (Left Indent)"></div>
      <div class="word-ruler-indent-right" id="ruler-indent-right" style="right: 60px;" title="Căn lề phải đoạn (Right Indent)"></div>
    </div>
  `;
}

function buildMiniToolbarHTML() {
  return `
    <select class="mini-btn" id="mini-font-sel" style="width:90px;height:22px;font-size:11px;" title="Phông chữ">
      <option value="calibri">Calibri</option>
      <option value="times">Times New Roman</option>
      <option value="arial">Arial</option>
      <option value="roboto">Roboto</option>
      <option value="segoe">Segoe UI</option>
    </select>
    <select class="mini-btn" id="mini-size-sel" style="width:44px;height:22px;font-size:11px;" title="Cỡ chữ">
      <option value="10">10</option>
      <option value="11">11</option>
      <option value="12" selected>12</option>
      <option value="14">14</option>
      <option value="16">16</option>
      <option value="18">18</option>
      <option value="20">20</option>
      <option value="24">24</option>
    </select>
    <button class="mini-btn" id="mini-inc-btn" title="Tăng cỡ">A▲</button>
    <button class="mini-btn" id="mini-dec-btn" title="Giảm cỡ">A▼</button>
    <div class="mini-divider"></div>
    <button class="mini-btn" id="mini-bold-btn" title="In đậm (Ctrl+B)"><b>B</b></button>
    <button class="mini-btn" id="mini-italic-btn" title="In nghiêng (Ctrl+I)"><i>I</i></button>
    <button class="mini-btn" id="mini-underline-btn" title="Gạch chân (Ctrl+U)"><u>U</u></button>
    <div class="mini-divider"></div>
    <!-- Highlight Color -->
    <div style="position:relative;display:inline-flex;">
      <button class="mini-btn" id="mini-hl-btn" title="Tô sáng dạ quang (Highlight)">🖍️</button>
      <input type="color" id="mini-hl-picker" value="#fef08a" style="position:absolute;opacity:0;inset:0;cursor:pointer;">
    </div>
    <!-- Font Color -->
    <div style="position:relative;display:inline-flex;">
      <button class="mini-btn" id="mini-col-btn" title="Màu chữ"><b>A</b></button>
      <input type="color" id="mini-col-picker" value="#dc2626" style="position:absolute;opacity:0;inset:0;cursor:pointer;">
    </div>
    <div class="mini-divider"></div>
    <button class="mini-btn" id="mini-copy-btn" title="Sao chép (Ctrl+C)">📄</button>
    <button class="mini-btn" id="mini-cut-btn" title="Cắt (Ctrl+X)">✂️</button>
  `;
}

function buildFindReplaceDialogHTML() {
  return `
    <div class="word-dialog-overlay" id="word-fr-overlay">
      <div class="word-dialog-box">
        <div class="word-dialog-header">
          <span id="fr-dialog-title">🔍 Tìm kiếm và Thay thế (Microsoft Word)</span>
          <button class="rb-btn-compact" id="fr-close-btn" style="border:none;background:transparent;font-weight:bold;cursor:pointer;">✕</button>
        </div>
        <div class="word-dialog-body">
          <div class="word-dialog-row">
            <label for="fr-find-input">Tìm kiếm gì:</label>
            <input type="text" id="fr-find-input" class="word-dialog-input" placeholder="Nhập từ hoặc cụm từ cần tìm...">
          </div>
          <div class="word-dialog-row" id="fr-replace-row">
            <label for="fr-replace-input">Thay thế bằng:</label>
            <input type="text" id="fr-replace-input" class="word-dialog-input" placeholder="Nhập từ mới để thay thế...">
          </div>
          <div id="fr-status-msg" style="font-size:11.5px; color:#64748b; margin-top:2px; min-height:18px;">
            Nhập văn bản rồi bấm Tìm kiếm hoặc Thay thế.
          </div>
        </div>
        <div class="word-dialog-footer">
          <button class="btn btn-small" id="fr-next-btn">Tìm tiếp theo</button>
          <button class="btn btn-small" id="fr-rep-one-btn">Thay thế</button>
          <button class="btn btn-small btn-primary" id="fr-rep-all-btn" style="background:#0078d4;color:#fff;">Thay thế tất cả</button>
          <button class="btn btn-small" id="fr-cancel-btn">Đóng</button>
        </div>
      </div>
    </div>
  `;
}

function buildWordStatusBarHTML() {
  return `
    <div class="word-status-left">
      <div class="word-status-item" id="ws-page-btn" title="Bấm để chuyển trang">
        <span>📄</span> <span id="ws-page-text">Trang 1 / 1</span>
      </div>
      <div class="word-status-item" id="ws-wordcount" title="Tổng số từ trên trang đang xem">
        <span>📝</span> <span id="ws-words-text">~0 từ</span>
      </div>
      <div class="word-status-item" title="Ngôn ngữ kiểm tra chính tả">
        <span>🌐</span> <span>Tiếng Việt (Việt Nam)</span>
      </div>
    </div>
    <div class="word-status-right">
      <div class="word-zoom-slider">
        <button class="word-zoom-btn" id="ws-zoom-out" title="Thu nhỏ">➖</button>
        <span id="ws-zoom-text" style="min-width:44px;text-align:center;font-weight:600;">100%</span>
        <button class="word-zoom-btn" id="ws-zoom-in" title="Phóng to">➕</button>
        <button class="word-zoom-btn" id="ws-zoom-fit" title="Vừa chiều ngang (Fit to Window)" style="margin-left:6px;font-size:11px;">↔ Vừa khung</button>
      </div>
    </div>
  `;
}

// ======================== WORD RULER & STATUS UPDATE ========================

function updateWordRuler() {
  const rulerInner = document.getElementById('word-ruler-inner');
  const shell = document.getElementById('editor-page-shell');
  if (!rulerInner || !shell) return;

  const w = shell.offsetWidth || 800;
  rulerInner.style.width = `${w}px`;

  const scaleEl = document.getElementById('ruler-scale');
  if (!scaleEl) return;
  scaleEl.innerHTML = '';

  // Render CM scale ticks (roughly 37.8px per cm at 96 DPI * scale)
  const pxPerCm = Math.max(25, (w / 21)); // A4 is 21cm wide
  const totalCm = Math.floor(w / pxPerCm);

  for (let i = 0; i <= totalCm; i++) {
    const x = i * pxPerCm;
    const tick = document.createElement('div');
    tick.className = 'word-ruler-tick major';
    tick.style.left = `${x}px`;
    scaleEl.appendChild(tick);

    if (i > 0 && i < totalCm) {
      const num = document.createElement('div');
      num.className = 'word-ruler-tick-num';
      num.style.left = `${x}px`;
      num.textContent = String(i);
      scaleEl.appendChild(num);
    }

    // Minor half-cm tick
    if (i < totalCm) {
      const halfTick = document.createElement('div');
      halfTick.className = 'word-ruler-tick';
      halfTick.style.left = `${x + pxPerCm / 2}px`;
      scaleEl.appendChild(halfTick);
    }
  }
}

function updateWordDocWordCount() {
  const layer = document.getElementById('editor-text-layer');
  const countEl = document.getElementById('ws-words-text');
  if (!layer || !countEl) return;

  let text = '';
  layer.querySelectorAll('span[data-tidx]').forEach(sp => {
    text += ' ' + (sp.textContent || '');
  });
  const words = text.trim().split(/\s+/).filter(Boolean);
  countEl.textContent = `~${words.length} từ`;

  const doc = typeof window.getEditorPdfDoc === 'function' ? window.getEditorPdfDoc() : null;
  const page = typeof window.getEditorPage === 'function' ? window.getEditorPage() : 1;
  const pageText = document.getElementById('ws-page-text');
  if (pageText) pageText.textContent = doc ? `Trang ${page} / ${doc.numPages}` : 'Trang 1 / 1';

  const zoomText = document.getElementById('ws-zoom-text');
  const legacyZoom = document.getElementById('editor-zoom-label');
  if (zoomText && legacyZoom) zoomText.textContent = legacyZoom.textContent;
}

// ======================== WORD TEXT SELECTION & INLINE EDITING ========================

let wordFormatPainterActive = false;
let wordCopiedFormat = null;
let activeWordSpan = null;

function initWordTextSelectionAndEditing() {
  const layer = document.getElementById('editor-text-layer');
  const miniBar = document.getElementById('word-mini-toolbar');

  // Wire Mini-Toolbar buttons
  if (miniBar) {
    document.getElementById('mini-bold-btn')?.addEventListener('click', () => applyWordFormatting('bold'));
    document.getElementById('mini-italic-btn')?.addEventListener('click', () => applyWordFormatting('italic'));
    document.getElementById('mini-underline-btn')?.addEventListener('click', () => applyWordFormatting('underline'));
    document.getElementById('mini-inc-btn')?.addEventListener('click', () => {
      const cur = parseFloat(document.getElementById('editor-text-size')?.value) || 12;
      applyWordFormatting('fontSize', cur + 2);
    });
    document.getElementById('mini-dec-btn')?.addEventListener('click', () => {
      const cur = parseFloat(document.getElementById('editor-text-size')?.value) || 12;
      applyWordFormatting('fontSize', Math.max(4, cur - 2));
    });
    document.getElementById('mini-copy-btn')?.addEventListener('click', wordCopySelection);
    document.getElementById('mini-cut-btn')?.addEventListener('click', wordCutSelection);

    document.getElementById('mini-size-sel')?.addEventListener('change', function() {
      applyWordFormatting('fontSize', parseFloat(this.value));
    });
    document.getElementById('mini-font-sel')?.addEventListener('change', function() {
      applyWordFormatting('fontFamily', this.value);
    });

    const miniHl = document.getElementById('mini-hl-picker');
    miniHl?.addEventListener('input', () => applyWordFormatting('highlight', miniHl.value));
    document.getElementById('mini-hl-btn')?.addEventListener('click', () => applyWordFormatting('highlight', miniHl?.value || '#fef08a'));

    const miniCol = document.getElementById('mini-col-picker');
    miniCol?.addEventListener('input', () => applyWordFormatting('color', miniCol.value));
    document.getElementById('mini-col-btn')?.addEventListener('click', () => applyWordFormatting('color', miniCol?.value || '#dc2626'));
  }

  // Handle document selection change to display Word Mini-Toolbar
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      if (miniBar && !miniBar.matches(':hover')) {
        miniBar.classList.remove('visible');
      }
      return;
    }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      // Check if selection is within editor-text-layer
      const common = range.commonAncestorContainer;
      const isInside = common && (common.nodeType === 1 ? common.closest('#editor-text-layer') : common.parentElement?.closest('#editor-text-layer'));
      if (isInside && miniBar) {
        miniBar.style.top = `${Math.max(10, rect.top + window.scrollY - 38)}px`;
        miniBar.style.left = `${Math.max(10, rect.left + window.scrollX + (rect.width / 2) - 130)}px`;
        miniBar.classList.add('visible');
      }
    }
  });

  // Global Word Keyboard Shortcuts (Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+F, Ctrl+H, Ctrl+S)
  document.addEventListener('keydown', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    const key = e.key.toLowerCase();

    // Check if we are inside editor
    const activeEl = document.activeElement;
    const isEditor = activeEl && activeEl.closest('#tab-editor');
    if (!isEditor) return;

    if (key === 'b') {
      e.preventDefault();
      applyWordFormatting('bold');
    } else if (key === 'i') {
      e.preventDefault();
      applyWordFormatting('italic');
    } else if (key === 'u') {
      e.preventDefault();
      applyWordFormatting('underline');
    } else if (key === 'f') {
      e.preventDefault();
      openFindReplaceModal('find');
    } else if (key === 'h') {
      e.preventDefault();
      openFindReplaceModal('replace');
    } else if (key === 's') {
      e.preventDefault();
      document.getElementById('editor-download-btn')?.click();
    } else if (key === 'l') {
      e.preventDefault();
      applyWordFormatting('align', 'left');
    } else if (key === 'e') {
      e.preventDefault();
      applyWordFormatting('align', 'center');
    } else if (key === 'r') {
      e.preventDefault();
      applyWordFormatting('align', 'right');
    } else if (key === 'j') {
      e.preventDefault();
      applyWordFormatting('align', 'justify');
    }
  });

  // Status Bar zoom buttons wiring
  document.getElementById('ws-zoom-in')?.addEventListener('click', () => { if (typeof window.editorZoomBy === 'function') window.editorZoomBy(1); });
  document.getElementById('ws-zoom-out')?.addEventListener('click', () => { if (typeof window.editorZoomBy === 'function') window.editorZoomBy(-1); });
  document.getElementById('ws-zoom-fit')?.addEventListener('click', () => { if (typeof window.editorZoomFit === 'function') window.editorZoomFit(); });
  document.getElementById('ws-page-btn')?.addEventListener('click', () => {
    const doc = typeof window.getEditorPdfDoc === 'function' ? window.getEditorPdfDoc() : null;
    if (!doc) return;
    const p = prompt(`Nhập số trang cần chuyển đến (1 - ${doc.numPages}):`, '1');
    const num = parseInt(p, 10);
    if (!isNaN(num) && num >= 1 && num <= doc.numPages) {
      if (typeof window.setEditorPage === 'function') window.setEditorPage(num);
      if (typeof window.editorRenderPage === 'function') window.editorRenderPage();
    }
  });

  setupSpansForWordEditing();
}

function setupSpansForWordEditing() {
  const layer = document.getElementById('editor-text-layer');
  if (!layer) return;

  layer.querySelectorAll('span[data-tidx]').forEach(span => {
    span.style.cursor = 'text';
    span.style.userSelect = 'text';
    span.style.webkitUserSelect = 'text';

    // Single-click on text directly triggers in-place editing!
    span.addEventListener('click', (e) => {
      e.stopPropagation();
      activeWordSpan = span;

      // If format painter is active, apply copied format and reset
      if (wordFormatPainterActive && wordCopiedFormat) {
        applyFormatToSpan(span, wordCopiedFormat);
        wordFormatPainterActive = false;
        document.getElementById('rb-format-painter-btn')?.classList.remove('active');
        if (window.toast) window.toast('🖌️ Đã dán định dạng văn bản thành công!', 'success');
        return;
      }

      // If span is not currently editable input, activate editing immediately on single click!
      if (!span.querySelector('.editing-input') && !span.classList.contains('editing-input')) {
        // Trigger double-click handler or makeEditable directly
        span.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      }
    });
  });
}

// ======================== FORMATTING & STYLES ENGINE ========================

export function applyWordFormatting(type, value) {
  const layer = document.getElementById('editor-text-layer');
  if (!layer) return;

  // 1. If user is currently typing in an inline input, apply directly to it
  const activeInput = layer.querySelector('.editing-input');
  if (activeInput) {
    if (type === 'bold') {
      if (typeof activeInput._toggleBold === 'function') activeInput._toggleBold();
      else activeInput.classList.toggle('is-bold');
    } else if (type === 'italic') {
      if (typeof activeInput._toggleItalic === 'function') activeInput._toggleItalic();
      else activeInput.classList.toggle('is-italic');
    } else if (type === 'underline') {
      activeInput.classList.toggle('is-underline');
    } else if (type === 'strikethrough') {
      activeInput.classList.toggle('is-strikethrough');
    } else if (type === 'fontSize' && typeof activeInput._setSize === 'function') {
      activeInput._setSize(value);
    } else if (type === 'fontFamily' && typeof activeInput._setFont === 'function') {
      activeInput._setFont(value);
    } else if (type === 'color' && typeof activeInput._setColor === 'function') {
      activeInput._setColor(value);
    } else if (type === 'highlight') {
      activeInput.style.backgroundColor = value;
    } else if (type === 'align') {
      activeInput.style.textAlign = value;
    } else if (type === 'case') {
      activeInput.value = transformCase(activeInput.value, value);
    } else if (type === 'clearFormatting') {
      activeInput.classList.remove('is-bold', 'is-italic', 'is-underline', 'is-strikethrough');
      activeInput.style.backgroundColor = 'transparent';
      if (typeof activeInput._setSize === 'function') activeInput._setSize(12);
      if (typeof activeInput._setColor === 'function') activeInput._setColor('#000000');
    }
    return;
  }

  // 2. Otherwise apply to currently selected span(s) or active word span
  const spansToFormat = Array.from(layer.querySelectorAll('span.region-selected, span.word-selected'));
  if (!spansToFormat.length && activeWordSpan) {
    spansToFormat.push(activeWordSpan);
  }

  if (spansToFormat.length) {
    spansToFormat.forEach(span => {
      const idx = parseInt(span.getAttribute('data-tidx'), 10);
      if (type === 'bold') {
        const b = !span.classList.contains('is-bold');
        span.classList.toggle('is-bold', b);
        updateSpanStyleInPdf(idx, span, { isBold: b });
      } else if (type === 'italic') {
        const it = !span.classList.contains('is-italic');
        span.classList.toggle('is-italic', it);
        updateSpanStyleInPdf(idx, span, { isItalic: it });
      } else if (type === 'underline') {
        span.classList.toggle('is-underline');
      } else if (type === 'strikethrough') {
        span.classList.toggle('is-strikethrough');
      } else if (type === 'fontSize') {
        span.style.fontSize = `${value * (window.editorScale || 1.5)}px`;
        span._ptSize = value;
        updateSpanStyleInPdf(idx, span, { fontSize: value });
      } else if (type === 'fontFamily') {
        span.style.fontFamily = value;
        updateSpanStyleInPdf(idx, span, { fontFamily: value });
      } else if (type === 'color') {
        span.style.setProperty('--txt-color', value);
        span.style.color = value;
        updateSpanStyleInPdf(idx, span, { color: value });
      } else if (type === 'highlight') {
        span.style.backgroundColor = value;
        span.style.setProperty('--mask-bg', value);
      } else if (type === 'align') {
        span.style.textAlign = value;
      } else if (type === 'case') {
        span.textContent = transformCase(span.textContent, value);
        updateSpanStyleInPdf(idx, span, { text: span.textContent });
      } else if (type === 'clearFormatting') {
        span.classList.remove('is-bold', 'is-italic', 'is-underline', 'is-strikethrough');
        span.style.backgroundColor = 'transparent';
        updateSpanStyleInPdf(idx, span, { isBold: false, isItalic: false, fontSize: 12, color: '#000000' });
      }
      span.classList.add('modified');
    });

    if (typeof window.recordHistory === 'function') window.recordHistory();
    if (typeof window.notifyEditorSelection === 'function') window.notifyEditorSelection();
  } else {
    if (window.toast) window.toast('Hãy bấm chọn một chữ hoặc bôi đen văn bản để định dạng', 'info', 2000);
  }
}

function updateSpanStyleInPdf(index, span, changes) {
  if (typeof window.updateModifiedItemFormatting === 'function') {
    window.updateModifiedItemFormatting(index, span, changes);
  }
}

export function applyWordStyle(styleName) {
  const styles = {
    normal: { fontSize: 12, isBold: false, isItalic: false, color: '#000000', fontFamily: 'calibri' },
    nospacing: { fontSize: 11, isBold: false, isItalic: false, color: '#111827', fontFamily: 'calibri' },
    heading1: { fontSize: 18, isBold: true, isItalic: false, color: '#2f5496', fontFamily: 'calibri' },
    heading2: { fontSize: 14, isBold: true, isItalic: false, color: '#2f5496', fontFamily: 'calibri' },
    title: { fontSize: 22, isBold: true, isItalic: false, color: '#1f3864', fontFamily: 'calibri' },
    subtitle: { fontSize: 13, isBold: false, isItalic: true, color: '#595959', fontFamily: 'calibri' }
  };

  const st = styles[styleName] || styles.normal;
  applyWordFormatting('fontSize', st.fontSize);
  applyWordFormatting('fontFamily', st.fontFamily);
  applyWordFormatting('color', st.color);
  if (st.isBold) applyWordFormatting('bold', true);
  if (st.isItalic) applyWordFormatting('italic', true);

  if (window.toast) window.toast(`Đã áp dụng kiểu Word: ${styleName.toUpperCase()}`, 'success', 1500);
}

function transformCase(str, mode) {
  if (!str) return str;
  if (mode === 'lower') return str.toLowerCase();
  if (mode === 'upper') return str.toUpperCase();
  if (mode === 'sentence') return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  if (mode === 'title') {
    return str.replace(/\b\w/g, char => char.toUpperCase());
  }
  return str;
}

// ======================== CLIPBOARD & ACTIONS ========================

function wordCopySelection() {
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';
  if (text) {
    navigator.clipboard?.writeText(text);
    if (window.toast) window.toast(`📄 Đã sao chép: "${text.slice(0, 30)}..."`, 'info', 1500);
  } else if (activeWordSpan) {
    const t = activeWordSpan.textContent || '';
    navigator.clipboard?.writeText(t);
    if (window.toast) window.toast(`📄 Đã sao chép: "${t.slice(0, 30)}..."`, 'info', 1500);
  }
}

function wordCutSelection() {
  wordCopySelection();
  applyWordFormatting('case', 'clear');
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) {
    document.execCommand?.('delete');
  } else if (activeWordSpan) {
    activeWordSpan.textContent = '';
    const idx = parseInt(activeWordSpan.getAttribute('data-tidx'), 10);
    updateSpanStyleInPdf(idx, activeWordSpan, { text: '' });
  }
}

async function wordPasteSelection() {
  try {
    const text = await navigator.clipboard?.readText();
    if (!text) return;
    const activeInput = document.querySelector('#editor-text-layer .editing-input');
    if (activeInput) {
      activeInput.value += text;
      activeInput.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (activeWordSpan) {
      activeWordSpan.textContent += text;
      const idx = parseInt(activeWordSpan.getAttribute('data-tidx'), 10);
      updateSpanStyleInPdf(idx, activeWordSpan, { text: activeWordSpan.textContent });
    }
  } catch (err) {
    if (window.toast) window.toast('Không thể dán trực tiếp. Vui lòng bấm Ctrl+V!', 'info');
  }
}

function wordToggleFormatPainter() {
  const btn = document.getElementById('rb-format-painter-btn');
  if (!activeWordSpan) {
    if (window.toast) window.toast('Hãy chọn một đoạn văn bản mẫu trước khi dùng cọ định dạng', 'info');
    return;
  }
  wordFormatPainterActive = !wordFormatPainterActive;
  btn?.classList.toggle('active', wordFormatPainterActive);
  if (wordFormatPainterActive) {
    wordCopiedFormat = {
      isBold: activeWordSpan.classList.contains('is-bold'),
      isItalic: activeWordSpan.classList.contains('is-italic'),
      fontSize: activeWordSpan._ptSize || 12,
      fontFamily: activeWordSpan.style.fontFamily || 'calibri',
      color: activeWordSpan.style.getPropertyValue('--txt-color') || '#000000',
      bgColor: activeWordSpan.style.backgroundColor || 'transparent'
    };
    if (window.toast) window.toast('🖌️ Đã sao chép định dạng! Bấm vào bất kỳ chữ nào để áp dụng', 'info', 2500);
  }
}

function applyFormatToSpan(span, fmt) {
  span.classList.toggle('is-bold', !!fmt.isBold);
  span.classList.toggle('is-italic', !!fmt.isItalic);
  if (fmt.fontSize) span.style.fontSize = `${fmt.fontSize * (window.editorScale || 1.5)}px`;
  if (fmt.fontFamily) span.style.fontFamily = fmt.fontFamily;
  if (fmt.color) {
    span.style.setProperty('--txt-color', fmt.color);
    span.style.color = fmt.color;
  }
  if (fmt.bgColor) span.style.backgroundColor = fmt.bgColor;
  span.classList.add('modified');
  const idx = parseInt(span.getAttribute('data-tidx'), 10);
  updateSpanStyleInPdf(idx, span, fmt);
}

function wordSelectAll() {
  const layer = document.getElementById('editor-text-layer');
  if (!layer) return;
  const spans = layer.querySelectorAll('span[data-tidx]');
  spans.forEach(s => s.classList.add('word-selected'));
  if (window.toast) window.toast(`Đã chọn toàn bộ ${spans.length} dòng văn bản trên trang`, 'info', 1500);
}

// ======================== FIND & REPLACE MODAL ========================

function openFindReplaceModal(mode = 'find') {
  const modal = document.getElementById('word-find-replace-modal');
  if (!modal) return;
  modal.style.display = 'block';

  const replaceRow = document.getElementById('fr-replace-row');
  const title = document.getElementById('fr-dialog-title');
  if (mode === 'find') {
    if (replaceRow) replaceRow.style.display = 'none';
    if (title) title.textContent = '🔍 Tìm kiếm văn bản trong PDF (Ctrl+F)';
  } else {
    if (replaceRow) replaceRow.style.display = 'flex';
    if (title) title.textContent = '🔄 Thay thế văn bản trong PDF (Ctrl+H)';
  }

  const findIn = document.getElementById('fr-find-input');
  setTimeout(() => findIn?.focus(), 50);

  // Wire buttons once
  document.getElementById('fr-close-btn').onclick = () => { modal.style.display = 'none'; };
  document.getElementById('fr-cancel-btn').onclick = () => { modal.style.display = 'none'; };

  document.getElementById('fr-next-btn').onclick = () => {
    executeWordFind(document.getElementById('fr-find-input').value);
  };
  document.getElementById('fr-rep-one-btn').onclick = () => {
    executeWordReplace(document.getElementById('fr-find-input').value, document.getElementById('fr-replace-input').value, false);
  };
  document.getElementById('fr-rep-all-btn').onclick = () => {
    executeWordReplace(document.getElementById('fr-find-input').value, document.getElementById('fr-replace-input').value, true);
  };
}

let lastFindQuery = '';
let lastFindIndex = 0;

function executeWordFind(query) {
  if (!query) return;
  const layer = document.getElementById('editor-text-layer');
  const msgEl = document.getElementById('fr-status-msg');
  if (!layer) return;

  const spans = Array.from(layer.querySelectorAll('span[data-tidx]')).filter(s =>
    (s.textContent || '').toLowerCase().includes(query.toLowerCase())
  );

  if (!spans.length) {
    if (msgEl) msgEl.innerHTML = `<span style="color:#dc2626;">Không tìm thấy "${escapeHtml(query)}" trên trang này.</span>`;
    return;
  }

  if (query !== lastFindQuery) {
    lastFindQuery = query;
    lastFindIndex = 0;
  } else {
    lastFindIndex = (lastFindIndex + 1) % spans.length;
  }

  // Clear previous highlights
  layer.querySelectorAll('span.word-selected').forEach(s => s.classList.remove('word-selected'));

  const target = spans[lastFindIndex];
  target.classList.add('word-selected');
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  activeWordSpan = target;

  if (msgEl) msgEl.innerHTML = `<span style="color:#059669;">✓ Tìm thấy kết quả ${lastFindIndex + 1} / ${spans.length}</span>`;
}

function executeWordReplace(query, replacement, replaceAll) {
  if (!query) return;
  const layer = document.getElementById('editor-text-layer');
  const msgEl = document.getElementById('fr-status-msg');
  if (!layer) return;

  const spans = Array.from(layer.querySelectorAll('span[data-tidx]')).filter(s =>
    (s.textContent || '').toLowerCase().includes(query.toLowerCase())
  );

  if (!spans.length) {
    if (msgEl) msgEl.innerHTML = `<span style="color:#dc2626;">Không có kết quả nào để thay thế.</span>`;
    return;
  }

  const targets = replaceAll ? spans : [spans[0]];
  let count = 0;
  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');

  targets.forEach(span => {
    span.textContent = span.textContent.replace(regex, replacement || '');
    span.classList.add('modified');
    const idx = parseInt(span.getAttribute('data-tidx'), 10);
    updateSpanStyleInPdf(idx, span, { text: span.textContent });
    count++;
  });

  if (typeof window.recordHistory === 'function') window.recordHistory();
  if (msgEl) msgEl.innerHTML = `<span style="color:#059669;">🎉 Đã thay thế thành công ${count} vị trí!</span>`;
  if (window.toast) window.toast(`Đã thay thế ${count} vị trí thành công!`, 'success');
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

  const pageNumDisplay = document.getElementById('rb-page-num-display');
  if (pageNumDisplay) {
    pageNumDisplay.textContent = doc ? `${page} / ${doc.numPages}` : '0 / 0';
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
  const doRedact = !!document.getElementById('rb-pipe-redact')?.checked;

  if (!doBlank && !doMargin && !doPagenum && !doWatermark && !doCompress && !doRedact) {
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

    // Bước che thông tin nhạy cảm (chạy trước khi canh lề / đánh số để chữ mới thêm không bị che nhầm)
    if (doRedact && typeof window.redactAutoBytes === 'function') {
      if (window.Progress) window.Progress.show('Chuỗi 1-Click: Đang che thông tin nhạy cảm...', 40);
      const { presets, custom } = readRedactOptions();
      if (presets.length || custom) {
        const r = await window.redactAutoBytes(bytes, { presets, custom, onProg: (m, pc) => window.Progress && window.Progress.show('Chuỗi 1-Click: ' + m, pc) });
        if (r.count) { bytes = r.bytes; appliedSteps.push(`Che ${r.count} vùng nhạy cảm ✅`); }
        else appliedSteps.push('Che thông tin (không tìm thấy) ✅');
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

    // Bước 5: Nén PDF (cuối chuỗi, sau khi đã che / đánh số / watermark)
    if (doCompress && typeof window.compressPdfBytes === 'function') {
      if (window.Progress) window.Progress.show('Chuỗi 1-Click: Đang nén PDF...', 85);
      const lv = document.getElementById('rb-comp-level')?.value || 'auto';
      const before = bytes.byteLength;
      const cr = await window.compressPdfBytes(bytes, lv, window.getEditorFileName?.());
      if (cr.changed) {
        appliedSteps.push(`Nén PDF (${Math.round(before / 1024)} KB → ${Math.round(cr.bytes.byteLength / 1024)} KB) ✅`);
        bytes = cr.bytes;
      } else {
        appliedSteps.push('Nén PDF (đã tối ưu sẵn, giữ nguyên) ✅');
      }
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

// 8b. Che thông tin nhạy cảm
function readRedactOptions() {
  const presets = ['email', 'phone', 'cccd', 'mst'].filter(k => document.getElementById('rb-rd-' + k)?.checked);
  const custom = (document.getElementById('rb-rd-custom')?.value || '').trim();
  return { presets, custom };
}

export async function applyRedactToEditor() {
  const currentBytes = await getEditorBytesOrAlert();
  if (!currentBytes) return;
  const { presets, custom } = readRedactOptions();
  if (!presets.length && !custom) {
    if (window.toast) window.toast('Chọn loại thông tin cần che hoặc nhập từ khóa.', 'warning');
    return;
  }
  if (typeof window.redactAutoBytes !== 'function') {
    if (window.toast) window.toast('Chức năng che thông tin chưa sẵn sàng, hãy tải lại trang.', 'error');
    return;
  }
  if (window.Progress) window.Progress.show('Đang tìm thông tin nhạy cảm...', 0);
  try {
    const r = await window.redactAutoBytes(currentBytes, { presets, custom, onProg: (m, p) => window.Progress && window.Progress.show(m, p) });
    if (!r.count) {
      if (window.toast) window.toast('Không tìm thấy nội dung khớp (PDF dạng ảnh scan cần OCR trước).', 'info');
      return;
    }
    pushDocUndoState('Che thông tin');
    await window.editorLoadBytes(r.bytes, window.getEditorFileName(), true);
    if (window.toast) window.toast(`🛡️ Đã che ${r.count} vùng trên ${r.pages} trang. Các trang này đã thành ảnh, không còn chọn được chữ.`, 'success', 5000);
  } catch (err) {
    if (window.toast) window.toast('Lỗi che thông tin: ' + err.message, 'error');
  } finally {
    if (window.Progress) window.Progress.hide();
    updateRibbonDocState();
  }
}

export async function openRedactManualFromEditor() {
  const currentBytes = await getEditorBytesOrAlert();
  if (!currentBytes) return;
  if (typeof window.redactOpenBytes !== 'function') {
    if (window.toast) window.toast('Chức năng che thông tin chưa sẵn sàng, hãy tải lại trang.', 'error');
    return;
  }
  pushDocUndoState('Che thông tin thủ công');
  await window.redactOpenBytes(currentBytes, (window.getEditorFileName && window.getEditorFileName()) || 'tailieu.pdf');
  window.switchTab?.('tab-redact');
}

// 9. Nén PDF
export async function applyCompressToEditor() {
  const currentBytes = await getEditorBytesOrAlert();
  if (!currentBytes) return;

  pushDocUndoState('Nén PDF');
  if (window.Progress) window.Progress.show('Đang tối ưu hóa dung lượng PDF...', null);

  try {
    const level = document.getElementById('rb-comp-level')?.value || 'auto';
    const oldKb = Math.round(currentBytes.byteLength / 1024);
    let outBytes = currentBytes, note = '';
    if (typeof window.compressPdfBytes === 'function') {
      const r = await window.compressPdfBytes(currentBytes, level, window.getEditorFileName && window.getEditorFileName());
      outBytes = r.bytes; note = r.note;
      if (!r.changed) {
        if (window.toast) window.toast('File đã được tối ưu sẵn (' + oldKb + ' KB), không nén nhỏ thêm được. Thử mức "Cực mạnh" hoặc "Siêu nén".', 'info', 5000);
        return;
      }
    } else {
      const pdfDoc = await PDFLib.PDFDocument.load(currentBytes);
      outBytes = await pdfDoc.save({ useObjectStreams: true });
    }
    const newKb = Math.round(outBytes.byteLength / 1024);

    await window.editorLoadBytes(outBytes, window.getEditorFileName(), true);
    if (window.toast) {
      window.toast(`Đã nén PDF: ${oldKb}KB → ${newKb}KB (giảm ${Math.round((1 - newKb / oldKb) * 100)}%)`, 'success');
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
  // Chữ ký là đối tượng độc lập trên trang (kéo/đổi cỡ/xoá được), chỉ ghép vào PDF khi xuất file.
  try {
    if (typeof window.editorAddSignature !== 'function') throw new Error('Chưa nạp module chữ ký');
    const ok = await window.editorAddSignature(pngBytes);
    if (ok && window.toast) window.toast('Đã thêm chữ ký. Kéo để di chuyển, kéo góc phải dưới để đổi cỡ, nhấn ✕ hoặc Delete để xoá.', 'success');
  } catch (err) {
    console.error('Lỗi chèn chữ ký:', err);
    if (window.toast) window.toast('Lỗi chèn chữ ký: ' + err.message, 'error');
  } finally {
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
    <div style="padding:6px 14px; font-size:11px; font-weight:bold; color:#6b7280; text-transform:uppercase;">Thao tác Tệp (Microsoft Word)</div>
    <button class="menu-item" id="f-open-btn" style="width:100%; text-align:left; padding:8px 14px; border:none; background:transparent; cursor:pointer; font-size:13px; display:flex; justify-content:space-between; align-items:center;">
      <span>📂 Mở file PDF mới...</span>
      <kbd style="font-size:11px; background:#f1f5f9; padding:2px 6px; border-radius:4px; border:1px solid #cbd5e1; color:#475569;">Ctrl + O</kbd>
    </button>
    <button class="menu-item" id="f-save-btn" style="width:100%; text-align:left; padding:8px 14px; border:none; background:transparent; cursor:pointer; font-size:13px; display:flex; justify-content:space-between; align-items:center;">
      <span>💾 Lưu / Xuất PDF đã sửa</span>
      <kbd style="font-size:11px; background:#f1f5f9; padding:2px 6px; border-radius:4px; border:1px solid #cbd5e1; color:#475569;">Ctrl + S</kbd>
    </button>
    <button class="menu-item" id="f-print-btn" style="width:100%; text-align:left; padding:8px 14px; border:none; background:transparent; cursor:pointer; font-size:13px; display:flex; justify-content:space-between; align-items:center;">
      <span>🖨️ In trang đang xem</span>
      <kbd style="font-size:11px; background:#f1f5f9; padding:2px 6px; border-radius:4px; border:1px solid #cbd5e1; color:#475569;">Ctrl + P</kbd>
    </button>
    <div style="height:1px; background:#e2e8f0; margin:6px 0;"></div>
    <button class="menu-item" id="f-to-tools-btn" style="width:100%; text-align:left; padding:8px 14px; border:none; background:transparent; cursor:pointer; font-size:13px; display:flex; gap:8px;">
      🧰 Chuyển sang Công cụ PDF
    </button>
    <button class="menu-item" id="f-to-sign-btn" style="width:100%; text-align:left; padding:8px 14px; border:none; background:transparent; cursor:pointer; font-size:13px; display:flex; gap:8px;">
      ✍️ Chuyển sang Ký tên chuyên sâu
    </button>
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
