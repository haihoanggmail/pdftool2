/**
 * HACHIHI PDF Tool – nhận thống kê từ Vercel (/api/track) và ghi vào Google Sheet.
 *
 * Sheet "log" (mỗi sự kiện một dòng), 11 cột:
 *   Time | IP | Country | City | VisitorId | SessionId | Action | Detail | UserAgent | Lang | Screen
 * Sheet "tong_hop": tổng / hôm nay / 7 ngày / 30 ngày theo từng Action (cột G của sheet log).
 *
 * Vercel gửi POST dạng form (+ key=<mật khẩu> nếu bạn đặt APPS_SCRIPT_KEY).
 * SAU KHI SỬA FILE NÀY: chạy hàm "thietLap" một lần, rồi Deploy → Manage deployments → Edit → New version.
 */

const SHEET_LOG = 'log';
const SHEET_SUM = 'tong_hop';
const TZ = 'Asia/Ho_Chi_Minh';
const HEADERS = ['Time', 'IP', 'Country', 'City', 'VisitorId', 'SessionId', 'Action', 'Detail', 'UserAgent', 'Lang', 'Screen'];
const KNOWN_ACTIONS = ['visit', 'view', 'open_file', 'pdf_to_word', 'pdf_to_excel', 'save_pdf', 'goppdf', 'edit_pdf', 'compare_pdf', 'sign_pdf', 'fill_form', 'redact_pdf', 'stamp_pdf', 'batch_pdf'];

function getSS_() {
  // Script gắn với Sheet (Extensions → Apps Script) thì dùng sheet đang mở; script độc lập thì đặt Script property SHEET_ID
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Chặn "formula injection": ô bắt đầu bằng = + - @ sẽ bị Sheet hiểu là công thức
function safe_(v, max) {
  let s = String(v == null ? '' : v).slice(0, max || 300);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

/** Nhận dữ liệu từ Vercel */
function doPost(e) {
  const p = (e && e.parameter) || {};

  // Mật khẩu chung (tùy chọn): chỉ kiểm tra khi bạn đã đặt Script property SECRET
  const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (secret && p.key !== secret) return out_({ ok: false, error: 'unauthorized' });

  const action = String(p.action || '').trim();
  if (!/^[a-z0-9_]{1,40}$/.test(action)) return out_({ ok: false, error: 'bad action' });

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);                       // tránh ghi chồng khi nhiều người thao tác cùng lúc
    const ss = getSS_();
    const sh = ss.getSheetByName(SHEET_LOG) || setup_(ss).getSheetByName(SHEET_LOG);
    sh.appendRow([
      new Date(),
      safe_(p.ip, 64),
      safe_(p.country, 8),
      safe_(p.city, 80),
      safe_(p.visitorId, 64),
      safe_(p.sessionId, 64),
      action,
      safe_(p.detail, 200),
      safe_(p.userAgent, 300),
      safe_(p.lang, 20),
      safe_(p.screen, 20)
    ]);
    return out_({ ok: true });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) { /* bỏ qua */ }
  }
}

/** Mở link /exec bằng trình duyệt để kiểm tra script đang chạy (không lộ số liệu) */
function doGet() {
  return out_({ ok: true, service: 'hachihi-pdf-tool-stats' });
}

/** CHẠY MỘT LẦN (và chạy lại sau mỗi lần sửa file này): tạo/cập nhật sheet log + tổng hợp. */
function thietLap() {
  setup_(getSS_());
}

function setup_(ss) {
  ss.setSpreadsheetTimeZone(TZ);

  // ---- Sheet log ----
  let log = ss.getSheetByName(SHEET_LOG);
  if (!log) {
    log = ss.insertSheet(SHEET_LOG);
  } else if (String(log.getRange(1, 2).getValue()) === 'Thao tác') {
    // Bản cũ chỉ có 2 cột (Thời gian | Thao tác): chuyển dữ liệu sang bố cục mới
    const n = log.getLastRow() - 1;
    const old = n > 0 ? log.getRange(2, 1, n, 2).getValues() : [];
    log.clear();
    if (old.length) {
      const rows = old.map(function (r) { return [r[0], '', '', '', '', '', r[1], '', '', '', '']; });
      log.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
    }
  }
  log.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  log.setFrozenRows(1);
  log.getRange('A:A').setNumberFormat('dd/MM/yyyy HH:mm:ss');
  const widths = [150, 120, 70, 130, 270, 270, 100, 260, 300, 70, 90];
  widths.forEach(function (w, i) { log.setColumnWidth(i + 1, w); });

  // ---- Sheet tong_hop (ghi lại công thức mỗi lần chạy để luôn đúng cột Action = G) ----
  let sum = ss.getSheetByName(SHEET_SUM);
  if (!sum) sum = ss.insertSheet(SHEET_SUM); else sum.clear();
  sum.getRange(1, 1, 1, 5).setValues([['Thao tác', 'Tổng', 'Hôm nay', '7 ngày', '30 ngày']]).setFontWeight('bold');
  KNOWN_ACTIONS.forEach(function (a, i) {
    const r = i + 2;
    sum.getRange(r, 1).setValue(a);
    sum.getRange(r, 2).setFormula('=COUNTIF(log!G:G,A' + r + ')');
    sum.getRange(r, 3).setFormula('=COUNTIFS(log!G:G,A' + r + ',log!A:A,">="&TODAY())');
    sum.getRange(r, 4).setFormula('=COUNTIFS(log!G:G,A' + r + ',log!A:A,">="&(TODAY()-6))');
    sum.getRange(r, 5).setFormula('=COUNTIFS(log!G:G,A' + r + ',log!A:A,">="&(TODAY()-29))');
  });
  const t = KNOWN_ACTIONS.length + 2;
  sum.getRange(t, 1).setValue('TỔNG').setFontWeight('bold');
  ['B', 'C', 'D', 'E'].forEach(function (c) { sum.getRange(c + t).setFormula('=SUM(' + c + '2:' + c + (t - 1) + ')').setFontWeight('bold'); });
  sum.setColumnWidth(1, 150);

  const first = ss.getSheetByName('Sheet1') || ss.getSheetByName('Trang tính1');
  if (first && ss.getSheets().length > 2 && first.getLastRow() === 0) ss.deleteSheet(first);
  return ss;
}
