// Chạy kiểm thử Python của bộ dựng lưới bảng từ đường kẻ (PDF -> Excel). Bỏ qua nếu máy không có python3.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const r = spawnSync('python3', [path.resolve(__dirname, 'w2x-grid.test.py')], { encoding: 'utf8' });
if (r.error && r.error.code === 'ENOENT') { console.log('SKIP w2x-grid: không có python3'); process.exit(0); }
process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
process.exit(r.status === 0 ? 0 : 1);
