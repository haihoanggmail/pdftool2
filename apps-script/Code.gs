/**
 * HACHIHI PDF Tool – nhận thống kê lượt dùng từ Vercel (/api/track) và ghi vào Google Sheet.
 *
 * Vercel gửi POST dạng form: action=<tên thao tác>  (+ key=<mật khẩu> nếu bạn đặt APPS_SCRIPT_KEY)
 * Kết quả: sheet "log" (mỗi thao tác một dòng) và sheet "tong_hop" (tổng, hôm nay, 7 ngày, 30 ngày).
 */

const SHEET_LOG = 'log';
const SHEET_SUM = 'tong_hop';
const TZ = 'Asia/Ho_Chi_Minh';
const KNOWN_ACTIONS = ['visit', 'pdf_to_word', 'pdf_to_excel', 'save_pdf', 'goppdf', 'edit_pdf', 'compare_pdf', 'sign_pdf', 'fill_form', 'redact_pdf', 'stamp_pdf', 'batch_pdf'];

function getSS_() {
  // Script gắn với Sheet (Extensions → Apps Script) thì dùng sheet đang mở; script độc lập thì đặt Script property SHEET_ID
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
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
    sh.appendRow([new Date(), action]);
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

/** CHẠY MỘT LẦN: tạo sheet log + tổng hợp. Chọn hàm "thietLap" rồi bấm Run. */
function thietLap() {
  setup_(getSS_());
}

function setup_(ss) {
  ss.setSpreadsheetTimeZone(TZ);

  let log = ss.getSheetByName(SHEET_LOG);
  if (!log) {
    log = ss.insertSheet(SHEET_LOG);
    log.getRange(1, 1, 1, 2).setValues([['Thời gian', 'Thao tác']]).setFontWeight('bold');
    log.setFrozenRows(1);
    log.getRange('A:A').setNumberFormat('dd/MM/yyyy HH:mm:ss');
    log.setColumnWidth(1, 160); log.setColumnWidth(2, 140);
  }

  let sum = ss.getSheetByName(SHEET_SUM);
  if (!sum) {
    sum = ss.insertSheet(SHEET_SUM);
    sum.getRange(1, 1, 1, 5).setValues([['Thao tác', 'Tổng', 'Hôm nay', '7 ngày', '30 ngày']]).setFontWeight('bold');
    KNOWN_ACTIONS.forEach(function (a, i) {
      const r = i + 2;
      sum.getRange(r, 1).setValue(a);
      sum.getRange(r, 2).setFormula('=COUNTIF(log!B:B,A' + r + ')');
      sum.getRange(r, 3).setFormula('=COUNTIFS(log!B:B,A' + r + ',log!A:A,">="&TODAY())');
      sum.getRange(r, 4).setFormula('=COUNTIFS(log!B:B,A' + r + ',log!A:A,">="&(TODAY()-6))');
      sum.getRange(r, 5).setFormula('=COUNTIFS(log!B:B,A' + r + ',log!A:A,">="&(TODAY()-29))');
    });
    const t = KNOWN_ACTIONS.length + 2;
    sum.getRange(t, 1).setValue('TỔNG').setFontWeight('bold');
    ['B', 'C', 'D', 'E'].forEach(function (c) { sum.getRange(c + t).setFormula('=SUM(' + c + '2:' + c + (t - 1) + ')').setFontWeight('bold'); });
    sum.setColumnWidth(1, 150);
  }

  const first = ss.getSheetByName('Sheet1') || ss.getSheetByName('Trang tính1');
  if (first && ss.getSheets().length > 2 && first.getLastRow() === 0) ss.deleteSheet(first);
  return ss;
}
