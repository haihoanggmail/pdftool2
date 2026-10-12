(function () {
    var info = document.getElementById('off-info'), btn = document.getElementById('off-btn'), st = document.getElementById('off-status');
    var httpOk = /^https?:$/.test(location.protocol) && 'serviceWorker' in navigator;
    function refresh() {
        if (!info) return;
        if (!httpOk) {
            info.textContent = 'Đang mở trực tiếp từ file nên trình duyệt không cho lưu bộ nhớ offline. Để dùng offline: đặt index.html cùng sw.js, manifest.webmanifest và 2 file icon lên một địa chỉ https (hoặc chạy trên localhost), mở một lần có mạng, bấm nút bên dưới, từ đó dùng được cả khi mất mạng.';
        } else if (navigator.serviceWorker.controller) {
            info.textContent = 'Bộ nhớ offline đang bật: thư viện nào đã dùng một lần sẽ được lưu lại. Bấm nút bên dưới để tải sẵn toàn bộ (khoảng 90 MB), sau đó mọi chức năng chạy được khi mất mạng.';
        } else {
            info.textContent = 'Bộ nhớ offline đang khởi động, hãy tải lại trang một lần.';
        }
    }
    if (httpOk) {
        navigator.serviceWorker.register('./sw.js').then(function () { setTimeout(refresh, 800); }).catch(function () { httpOk = false; refresh(); });
    }
    refresh();
    if (btn) btn.addEventListener('click', async function () {
        if (!httpOk || !navigator.serviceWorker.controller) { alert(info.textContent); return; }
        btn.disabled = true;
        try { await window.warmOffline(function (m) { st.textContent = m; }); st.textContent = '✅ Đã tải sẵn xong. Giờ có thể dùng khi không có mạng.'; }
        catch (e) { st.textContent = '⚠ Chưa tải được hết: ' + ((e && e.message) || e); }
        btn.disabled = false;
    });
})();
