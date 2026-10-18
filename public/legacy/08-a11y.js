// ===================== Trợ năng (accessibility) =====================
// Bổ sung bằng mã, không đổi giao diện:
//  1) Thanh tab: role tablist/tab/tabpanel, aria-selected, phím mũi tên / Home / End, chỉ 1 tab nằm trong thứ tự Tab (roving tabindex)
//  2) Menu thả xuống: role menu/menuitem, aria-expanded, mũi tên lên/xuống, Esc đóng và trả tiêu điểm về nút mở
//  3) Hộp thoại (modal): role dialog + aria-modal, nhốt tiêu điểm trong hộp, Esc đóng, trả tiêu điểm về nơi mở
//  4) Liên kết "Bỏ qua đến nội dung", vùng thông báo (toast) đọc được bằng trình đọc màn hình
(function () {
    'use strict';
    const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
    let usingKeyboard = false;
    addEventListener('keydown', () => { usingKeyboard = true; }, true);
    addEventListener('pointerdown', () => { usingKeyboard = false; }, true);

    const parse = (btn, fn) => {
        const m = new RegExp(fn + "\\('([^']+)'").exec(btn.getAttribute('onclick') || '');
        return m ? m[1] : null;
    };
    const tabIdOf = (b) => parse(b, 'switchTab');
    const menuIdOf = (b) => parse(b, 'toggleMenu');
    const visible = (el) => el.offsetParent !== null || el.getClientRects().length > 0;

    /* ---------- 1) Tab ---------- */
    function syncTabs() {
        const list = document.querySelector('.nav-tabs');
        if (!list) return;
        const tabs = $$('.tab-btn', list);
        let any = tabs.find((t) => t.classList.contains('active'));
        tabs.forEach((t) => {
            const on = t === any;
            t.setAttribute('aria-selected', on ? 'true' : 'false');
            t.tabIndex = on ? 0 : -1;
        });
        if (!any && tabs[0]) tabs[0].tabIndex = 0;
    }

    function setupTabs() {
        const list = document.querySelector('.nav-tabs');
        if (!list) return;
        list.setAttribute('role', 'tablist');
        list.setAttribute('aria-label', 'Chức năng chính');
        $$('.tab-btn', list).forEach((b, i) => {
            b.setAttribute('role', 'tab');
            if (!b.id) b.id = 'navtab-' + i;
            const t = tabIdOf(b), m = menuIdOf(b);
            if (t) {
                b.setAttribute('aria-controls', t);
                const p = document.getElementById(t);
                if (p) { p.setAttribute('role', 'tabpanel'); p.setAttribute('aria-labelledby', b.id); }
            }
            if (m) { b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-controls', m); b.setAttribute('aria-expanded', 'false'); }
        });
        list.addEventListener('keydown', (e) => {
            const tabs = $$('.tab-btn', list).filter(visible);
            const i = tabs.indexOf(document.activeElement);
            if (i < 0) return;
            let n = -1;
            if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
            else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
            else if (e.key === 'Home') n = 0;
            else if (e.key === 'End') n = tabs.length - 1;
            else if (e.key === 'ArrowDown' && tabs[i].classList.contains('has-menu')) { e.preventDefault(); tabs[i].click(); return; }
            if (n < 0) return;
            e.preventDefault();
            tabs.forEach((t) => { t.tabIndex = -1; });
            tabs[n].tabIndex = 0;
            tabs[n].focus();
        });
        // chuyển tab bằng chuột/phím: cập nhật trạng thái
        const orig = window.switchTab;
        if (typeof orig === 'function') {
            window.switchTab = function () { const r = orig.apply(this, arguments); syncTabs(); return r; };
        }
        syncTabs();
    }

    /* ---------- 2) Menu ---------- */
    function syncMenu(menu) {
        const owner = document.getElementById(menu.dataset.owner);
        const open = menu.classList.contains('open');
        if (owner) owner.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open && usingKeyboard) {
            const items = $$('.menu-item', menu).filter(visible);
            const first = items.find((x) => x.classList.contains('active')) || items[0];
            if (first) first.focus();
        }
    }

    function setupMenus() {
        $$('.nav-menu').forEach((menu) => {
            menu.setAttribute('role', 'menu');
            const owner = document.getElementById(menu.dataset.owner);
            if (owner) menu.setAttribute('aria-labelledby', owner.id);
            $$('.menu-item', menu).forEach((it, i) => {
                it.setAttribute('role', 'menuitem');
                it.tabIndex = -1;
                if (!it.id) it.id = (menu.id || 'menu') + '-item-' + i;
                const t = tabIdOf(it);
                if (t && owner) {                                  // vùng nội dung được gắn nhãn bởi nút mở menu
                    const p = document.getElementById(t);
                    if (p && !p.getAttribute('aria-labelledby')) { p.setAttribute('role', 'tabpanel'); p.setAttribute('aria-labelledby', owner.id); }
                }
            });
            $$('.menu-sep', menu).forEach((s) => s.setAttribute('role', 'presentation'));
            new MutationObserver(() => syncMenu(menu)).observe(menu, { attributes: true, attributeFilter: ['class'] });
            menu.addEventListener('keydown', (e) => {
                const items = $$('.menu-item', menu).filter(visible);
                const i = items.indexOf(document.activeElement);
                let n = -1;
                if (e.key === 'ArrowDown') n = (i + 1) % items.length;
                else if (e.key === 'ArrowUp') n = (i - 1 + items.length) % items.length;
                else if (e.key === 'Home') n = 0;
                else if (e.key === 'End') n = items.length - 1;
                else if (e.key === 'Escape') { e.preventDefault(); if (typeof closeMenus === 'function') closeMenus(); if (owner) owner.focus(); return; }
                else if (e.key === 'Tab') { if (typeof closeMenus === 'function') closeMenus(); return; }
                if (n < 0) return;
                e.preventDefault();
                items[n].focus();
            });
        });
    }

    /* ---------- 3) Hộp thoại ---------- */
    const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const dialogs = new Map();

    function enhanceDialog(el) {
        if (dialogs.has(el)) return;
        const opener = document.activeElement;
        if (!el.getAttribute('role')) el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        const head = el.querySelector('h1,h2,h3,h4');
        if (head && !el.getAttribute('aria-labelledby')) {
            if (!head.id) head.id = 'dlg-title-' + Math.random().toString(36).slice(2, 8);
            el.setAttribute('aria-labelledby', head.id);
        }
        const keydown = (e) => {
            if (e.key === 'Escape') {
                const close = el.querySelector('.auth-modal-close,[data-close],[aria-label*="Đóng"],[aria-label*="Close"],button.close');
                if (close) { e.preventDefault(); e.stopPropagation(); close.click(); }
                return;
            }
            if (e.key !== 'Tab') return;
            const f = $$(FOCUSABLE, el).filter(visible);
            if (!f.length) { e.preventDefault(); return; }
            const first = f[0], last = f[f.length - 1];
            if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
        };
        el.addEventListener('keydown', keydown);
        dialogs.set(el, { opener: opener, keydown: keydown });
        requestAnimationFrame(() => {
            if (el.contains(document.activeElement)) return;
            const f = $$(FOCUSABLE, el).filter(visible);
            (f.find((x) => /^(INPUT|SELECT|TEXTAREA)$/.test(x.tagName)) || f[0] || el).focus();
        });
    }

    function releaseDialog(el) {
        const d = dialogs.get(el);
        if (!d) return;
        dialogs.delete(el);
        if (d.opener && document.contains(d.opener) && typeof d.opener.focus === 'function') d.opener.focus();
    }

    const isModal = (n) => n.nodeType === 1 && /modal|dialog/i.test(typeof n.className === 'string' ? n.className : '') && !/overlay-(canvas|wrapper|container)/.test(n.className);

    function watchDialogs() {
        new MutationObserver((ms) => {
            ms.forEach((m) => {
                m.addedNodes.forEach((n) => { if (isModal(n)) enhanceDialog(n); });
                m.removedNodes.forEach((n) => { if (n.nodeType === 1 && dialogs.has(n)) releaseDialog(n); });
            });
        }).observe(document.body, { childList: true });
    }

    /* ---------- 4) Khác ---------- */
    function setupMisc() {
        const link = document.createElement('a');
        link.href = '#';
        link.className = 'skip-link';
        link.textContent = 'Bỏ qua đến nội dung chính';
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const p = document.querySelector('.tab-content.active');
            if (p) { p.setAttribute('tabindex', '-1'); p.focus(); }
        });
        document.body.insertBefore(link, document.body.firstChild);
        const toast = document.getElementById('toast-box');
        if (toast) { toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite'); }
        else {
            // toast-box được tạo sau: gắn khi xuất hiện
            const mo = new MutationObserver(() => {
                const t = document.getElementById('toast-box');
                if (t) { t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); mo.disconnect(); }
            });
            mo.observe(document.body, { childList: true });
        }
    }

    function init() {
        setupTabs();
        setupMenus();
        watchDialogs();
        setupMisc();
    }
    window.PDFA11y = { tabIdOf: tabIdOf, menuIdOf: menuIdOf };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
