/* ═══════════════════════════════════════════
   Admin Panel — Logic
   ═══════════════════════════════════════════ */

(function () {
    'use strict';

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // ── Theme Toggle ──
    const themeToggle = $('#themeToggle');
    const themeIcon = themeToggle ? themeToggle.querySelector('.theme-icon') : null;

    function initAdminTheme() {
        const saved = localStorage.getItem('ip-query-theme') || 'dark';
        document.body.setAttribute('data-theme', saved);
        if (themeIcon) themeIcon.textContent = saved === 'dark' ? '🌙' : '🌞';
    }

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const current = document.body.getAttribute('data-theme');
            const next = current === 'dark' ? 'light' : 'dark';
            document.body.setAttribute('data-theme', next);
            if (themeIcon) themeIcon.textContent = next === 'dark' ? '🌙' : '🌞';
            localStorage.setItem('ip-query-theme', next);
        });
    }

    initAdminTheme();

    // ── DOM ──
    const loginOverlay = $('#loginOverlay');
    const loginForm = $('#loginForm');
    const loginPassword = $('#loginPassword');
    const loginError = $('#loginError');
    const adminApp = $('#adminApp');
    const btnLogout = $('#btnLogout');
    const adminTabs = $('#adminTabs');
    const btnSave = $('#btnSave');
    const saveStatus = $('#saveStatus');
    const btnTogglePwd = $('#btnTogglePwd');

    // ── State ──
    let token = localStorage.getItem('admin-token') || '';

    // ═══════════════════════════════════════════
    // 认证
    // ═══════════════════════════════════════════
    async function checkAuth() {
        if (!token) {
            showLogin();
            return;
        }
        try {
            const res = await api('GET', '/api/admin/settings');
            if (res.error) throw new Error();
            showAdmin(res);
        } catch {
            token = '';
            localStorage.removeItem('admin-token');
            showLogin();
        }
    }

    function showLogin() {
        loginOverlay.classList.remove('hidden');
        adminApp.classList.add('hidden');
        loginPassword.focus();
    }

    function showAdmin(data) {
        loginOverlay.classList.add('hidden');
        adminApp.classList.remove('hidden');
        populateFields(data);
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginError.classList.add('hidden');
        const pwd = loginPassword.value.trim();
        if (!pwd) return;

        try {
            const res = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pwd }),
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                loginError.textContent = data.message || '密码错误';
                loginError.classList.remove('hidden');
                return;
            }

            token = data.token;
            localStorage.setItem('admin-token', token);
            loginPassword.value = '';
            checkAuth();
        } catch (err) {
            loginError.textContent = '登录失败: ' + err.message;
            loginError.classList.remove('hidden');
        }
    });

    btnLogout.addEventListener('click', async () => {
        try { await api('POST', '/api/admin/logout'); } catch { }
        token = '';
        localStorage.removeItem('admin-token');
        showLogin();
    });

    // ═══════════════════════════════════════════
    // API 请求
    // ═══════════════════════════════════════════
    async function api(method, url, body) {
        const opts = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
        };
        if (body) opts.body = JSON.stringify(body);
        const res = await fetch(url, opts);
        return res.json();
    }

    // ═══════════════════════════════════════════
    // 填充表单
    // ═══════════════════════════════════════════
    function populateFields(data) {
        // SEO
        $('#seoTitle').value = data.seo?.title || '';
        $('#seoDesc').value = data.seo?.description || '';
        $('#seoKeywords').value = data.seo?.keywords || '';

        // API Keys
        const abuseKeys = data.apiKeys?.abuseipdb || [];
        $('#apiAbuseKeys').value = abuseKeys.join('\n');
        $('#apiDklyKey').value = data.apiKeys?.dkly || '';

        // Map
        $('#nominatimEmail').value = data.apiKeys?.nominatimEmail || '';

        // Security
        $('#adminPassword').value = data.admin?.password || '';
    }

    // ═══════════════════════════════════════════
    // 收集表单
    // ═══════════════════════════════════════════
    function collectFields() {
        return {
            seo: {
                title: $('#seoTitle').value.trim(),
                description: $('#seoDesc').value.trim(),
                keywords: $('#seoKeywords').value.trim(),
            },
            apiKeys: {
                abuseipdb: $('#apiAbuseKeys').value.split('\n').map(s => s.trim()).filter(Boolean),
                dkly: $('#apiDklyKey').value.trim(),
                nominatimEmail: $('#nominatimEmail').value.trim(),
            },
            admin: {
                password: $('#adminPassword').value.trim(),
            },
        };
    }

    // ═══════════════════════════════════════════
    // 保存设置
    // ═══════════════════════════════════════════
    btnSave.addEventListener('click', async () => {
        btnSave.disabled = true;
        btnSave.textContent = '保存中...';
        saveStatus.classList.add('hidden');

        try {
            const data = collectFields();

            // 校验
            if (!data.admin.password) {
                throw new Error('管理密码不能为空');
            }

            const res = await api('PUT', '/api/admin/settings', data);

            if (res.error) throw new Error(res.message);

            showStatus('✅ 保存成功！设置已实时生效', 'success');
        } catch (err) {
            showStatus('❌ 保存失败: ' + err.message, 'error');
        } finally {
            btnSave.disabled = false;
            btnSave.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17,21 17,13 7,13 7,21"/><polyline points="7,3 7,8 15,8"/></svg>
                保存设置
            `;
        }
    });

    function showStatus(msg, type) {
        saveStatus.textContent = msg;
        saveStatus.className = `save-status ${type}`;
        saveStatus.classList.remove('hidden');
        setTimeout(() => saveStatus.classList.add('hidden'), 4000);
    }

    // ═══════════════════════════════════════════
    // Tab 导航
    // ═══════════════════════════════════════════
    adminTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('.tab-btn');
        if (!btn) return;

        $$('.tab-btn').forEach(b => b.classList.remove('active'));
        $$('.tab-panel').forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        const panel = $(`#panel-${btn.dataset.tab}`);
        if (panel) panel.classList.add('active');
    });

    // ═══════════════════════════════════════════
    // 密码可见切换
    // ═══════════════════════════════════════════
    if (btnTogglePwd) {
        btnTogglePwd.addEventListener('click', () => {
            const input = $('#adminPassword');
            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            btnTogglePwd.textContent = isPassword ? '🙈' : '👁️';
        });
    }

    // ═══════════════════════════════════════════
    // 初始化
    // ═══════════════════════════════════════════
    checkAuth();

})();
