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
        const mode = localStorage.getItem('ip-query-theme-mode');
        const saved = localStorage.getItem('ip-query-theme');
        const theme = mode === 'manual' && saved ? saved : getAutoTheme();
        applyAdminTheme(theme);
        setInterval(() => {
            if (localStorage.getItem('ip-query-theme-mode') !== 'manual') {
                applyAdminTheme(getAutoTheme());
            }
        }, 60 * 1000);
    }

    function getAutoTheme() {
        const hour = new Date().getHours();
        return hour >= 18 || hour < 6 ? 'dark' : 'light';
    }

    function applyAdminTheme(theme) {
        document.body.setAttribute('data-theme', theme);
        if (themeIcon) themeIcon.textContent = theme === 'dark' ? '🌙' : '🌞';
    }

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const current = document.body.getAttribute('data-theme');
            const next = current === 'dark' ? 'light' : 'dark';
            applyAdminTheme(next);
            localStorage.setItem('ip-query-theme-mode', 'manual');
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
                loginError.textContent = data.message || 'Incorrect password';
                loginError.classList.remove('hidden');
                return;
            }

            token = data.token;
            localStorage.setItem('admin-token', token);
            loginPassword.value = '';
            checkAuth();
        } catch (err) {
            loginError.textContent = 'Sign in failed: ' + err.message;
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
        $('#apiIplocateKey').value = data.apiKeys?.iplocate || '';
        $('#apiIp2locationKey').value = data.apiKeys?.ip2location || '';

        // API Endpoints
        $('#endpointAbuseipdb').value = data.apiEndpoints?.abuseipdb || '';
        $('#endpointIplocate').value = data.apiEndpoints?.iplocate || '';
        $('#endpointIp2location').value = data.apiEndpoints?.ip2location || '';
        $('#endpointNominatim').value = data.apiEndpoints?.nominatim || '';

        // Map
        $('#nominatimEmail').value = data.apiKeys?.nominatimEmail || '';

        // Security
        $('#adminPassword').value = data.admin?.password || '';

        // Ads
        const ads = data.ads || {};
        $('#adHeadEnabled').checked = !!ads.head?.enabled;
        $('#adHeadCode').value = ads.head?.code || '';
        $('#adTopEnabled').checked = !!ads.top?.enabled;
        $('#adTopCode').value = ads.top?.code || '';
        $('#adSearchEnabled').checked = !!ads.search?.enabled;
        $('#adSearchCode').value = ads.search?.code || '';
        $('#adResultEnabled').checked = !!ads.result?.enabled;
        $('#adResultCode').value = ads.result?.code || '';
        $('#adFooterEnabled').checked = !!ads.footer?.enabled;
        $('#adFooterCode').value = ads.footer?.code || '';
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
                iplocate: $('#apiIplocateKey').value.trim(),
                ip2location: $('#apiIp2locationKey').value.trim(),
                nominatimEmail: $('#nominatimEmail').value.trim(),
            },
            apiEndpoints: {
                abuseipdb: $('#endpointAbuseipdb').value.trim(),
                iplocate: $('#endpointIplocate').value.trim(),
                ip2location: $('#endpointIp2location').value.trim(),
                nominatim: $('#endpointNominatim').value.trim(),
            },
            admin: {
                password: $('#adminPassword').value.trim(),
            },
            ads: {
                head: {
                    enabled: $('#adHeadEnabled').checked,
                    code: $('#adHeadCode').value,
                },
                top: {
                    enabled: $('#adTopEnabled').checked,
                    code: $('#adTopCode').value,
                },
                search: {
                    enabled: $('#adSearchEnabled').checked,
                    code: $('#adSearchCode').value,
                },
                result: {
                    enabled: $('#adResultEnabled').checked,
                    code: $('#adResultCode').value,
                },
                footer: {
                    enabled: $('#adFooterEnabled').checked,
                    code: $('#adFooterCode').value,
                },
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
            if (res.settings) populateFields(res.settings);

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

        // 在线更新页不涉及设置保存，隐藏底部保存栏
        const saveBar = $('.save-bar');
        if (saveBar) saveBar.classList.toggle('hidden', btn.dataset.tab === 'update');
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
    // 系统在线更新
    // ═══════════════════════════════════════════
    const btnCheckUpdate = $('#btnCheckUpdate');
    const btnDoUpdate = $('#btnDoUpdate');
    const updCurrent = $('#updCurrent');
    const updRemote = $('#updRemote');
    const updState = $('#updState');
    const updLog = $('#updLog');

    function setLog(html) {
        if (updLog) updLog.innerHTML = html;
    }
    function appendLog(html) {
        if (updLog) updLog.innerHTML += '\n' + html;
    }
    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    // 极简 Markdown 渲染 (Release 正文): 标题/列表/粗体/代码/链接
    function renderMarkdown(md) {
        const esc = escapeHtml(md);
        return esc
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/^### (.+)$/gm, '<span class="log-add">$1</span>')
            .replace(/^## (.+)$/gm, '<span class="log-add">$1</span>')
            .replace(/^# (.+)$/gm, '<span class="log-add">$1</span>')
            .replace(/^\s*[-*] (.+)$/gm, '  • $1')
            .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 ($2)');
    }

    // 待更新的目标 tag (检查更新后填充)
    let pendingTag = '';

    if (btnCheckUpdate) {
        btnCheckUpdate.addEventListener('click', async () => {
            btnCheckUpdate.disabled = true;
            btnDoUpdate.disabled = true;
            pendingTag = '';
            updState.textContent = '检查中...';
            updState.className = 'update-stat-value';
            setLog('正在连接 GitHub 检查最新 Release...');

            try {
                const res = await api('GET', '/api/admin/update/check');
                if (res.error) throw new Error(res.message);

                updCurrent.textContent = res.current.version || res.current.hash;

                if (!res.remote) {
                    updRemote.textContent = '无 Release';
                    updState.textContent = '无可用版本';
                    updState.className = 'update-stat-value';
                    setLog(`<span class="log-add">ℹ️ ${escapeHtml(res.message || '远端仓库尚未发布任何 Release。')}</span>`);
                    return;
                }

                updRemote.textContent = res.remote.tag;

                if (res.hasUpdate) {
                    pendingTag = res.remote.tag;
                    updState.textContent = `发现新版本 ${res.remote.tag}`;
                    updState.className = 'update-stat-value has-update';
                    btnDoUpdate.disabled = false;
                    btnDoUpdate.textContent = `更新到 ${res.remote.tag}`;

                    let log = `<span class="log-add">🎉 发现新版本: ${escapeHtml(res.remote.name)} (${escapeHtml(res.remote.tag)})</span>`;
                    log += `\n当前版本: ${escapeHtml(res.current.version)}`;
                    if (res.remote.publishedAt) {
                        log += `\n发布时间: ${escapeHtml(new Date(res.remote.publishedAt).toLocaleString())}`;
                    }
                    if (res.remote.body && res.remote.body.trim()) {
                        log += `\n\n<span class="log-add">━━ 更新说明 ━━</span>\n${renderMarkdown(res.remote.body.trim())}`;
                    }
                    log += `\n\n点击「更新到 ${escapeHtml(res.remote.tag)}」开始更新。`;
                    setLog(log);
                } else {
                    updState.textContent = '已是最新';
                    updState.className = 'update-stat-value up-to-date';
                    setLog(`<span class="log-ok">✅ 已是最新版本 (${escapeHtml(res.current.version)})，无需更新。</span>`);
                }
            } catch (err) {
                updState.textContent = '检查失败';
                updState.className = 'update-stat-value error';
                setLog(`<span class="log-err">❌ ${escapeHtml(err.message)}</span>`);
            } finally {
                btnCheckUpdate.disabled = false;
            }
        });
    }

    if (btnDoUpdate) {
        btnDoUpdate.addEventListener('click', async () => {
            const tagLabel = pendingTag || '最新版本';
            if (!confirm(`确定要更新到 ${tagLabel} 吗？`)) return;
            btnDoUpdate.disabled = true;
            btnCheckUpdate.disabled = true;
            updState.textContent = '更新中...';
            updState.className = 'update-stat-value';
            appendLog(`\n<span class="log-add">⏳ 正在切换到 ${escapeHtml(tagLabel)}...</span>`);

            try {
                const res = await api('POST', '/api/admin/update/pull', pendingTag ? { tag: pendingTag } : undefined);
                if (res.error) throw new Error(res.message);

                updCurrent.textContent = res.current.version || res.current.hash;
                if (res.updated) {
                    updState.textContent = '更新成功';
                    updState.className = 'update-stat-value up-to-date';
                    updRemote.textContent = res.tag || res.current.version;
                    let log = `<span class="log-ok">✅ 已更新到 ${escapeHtml(res.tag || res.current.version)}！</span>`;
                    if (res.output) log += `\n\n${escapeHtml(res.output)}`;
                    appendLog(log);
                    // 更新成功后自动重启进程并刷新页面
                    await restartAndReload();
                } else {
                    updState.textContent = '已是最新';
                    updState.className = 'update-stat-value up-to-date';
                    appendLog(`<span class="log-ok">已是最新版本，无需更新。</span>`);
                    btnCheckUpdate.disabled = false;
                }
            } catch (err) {
                updState.textContent = '更新失败';
                updState.className = 'update-stat-value error';
                appendLog(`<span class="log-err">❌ ${escapeHtml(err.message)}</span>`);
                btnDoUpdate.disabled = false;
                btnCheckUpdate.disabled = false;
            }
        });
    }

    // 重启进程 → 轮询健康检查 → 刷新页面
    async function restartAndReload() {
        updState.textContent = '重启中...';
        updState.className = 'update-stat-value';
        appendLog(`\n<span class="log-add">⏳ 正在重启服务进程...</span>`);

        let restartRes;
        try {
            restartRes = await api('POST', '/api/admin/restart');
        } catch {
            restartRes = null; // 进程可能已被杀死导致请求中断，属预期
        }

        if (restartRes && restartRes.restarted === false) {
            // 非 PM2 环境，无法自动重启
            updState.textContent = '需手动重启';
            updState.className = 'update-stat-value has-update';
            appendLog(`<span class="log-add">⚠️ ${escapeHtml(restartRes.message)}</span>`);
            appendLog(`<span class="log-add">前端文件已更新，3 秒后刷新页面...</span>`);
            setTimeout(() => location.reload(true), 3000);
            return;
        }

        appendLog(`<span class="log-add">服务重启中，等待恢复...</span>`);

        // 轮询健康检查，最多约 30 秒
        const deadline = Date.now() + 30000;
        await new Promise(r => setTimeout(r, 2000)); // 给进程一点退出时间
        while (Date.now() < deadline) {
            try {
                const res = await fetch('/api/health', { cache: 'no-store' });
                if (res.ok) {
                    appendLog(`<span class="log-ok">✅ 服务已恢复，即将刷新页面...</span>`);
                    setTimeout(() => location.reload(true), 1200);
                    return;
                }
            } catch { /* 服务尚未恢复，继续轮询 */ }
            await new Promise(r => setTimeout(r, 1500));
        }

        // 超时兜底：仍然刷新，让用户看到最新状态
        appendLog(`<span class="log-add">⚠️ 等待服务恢复超时，仍将刷新页面，请确认进程状态。</span>`);
        setTimeout(() => location.reload(true), 1500);
    }

    // ═══════════════════════════════════════════
    // 初始化
    // ═══════════════════════════════════════════
    checkAuth();

})();
