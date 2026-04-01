/* ═══════════════════════════════════════════
   IP Query System — Frontend Logic
   ═══════════════════════════════════════════ */

(function () {
    'use strict';

    const $ = (sel) => document.querySelector(sel);
    const themeToggle = $('#themeToggle');
    const themeIcon = $('.theme-icon');
    const langToggle = $('#langToggle');
    const ipInput = $('#ipInput');
    const btnSearch = $('#btnSearch');
    const btnClear = $('#btnClear');
    const btnQuerySelf = $('#btnQuerySelf');
    const myIpValue = $('#myIpValue');
    const browserInfo = $('#browserInfo');
    const uaDetail = $('#uaDetail');
    const uaRaw = $('#uaRaw');
    const btnUaToggle = $('#btnUaToggle');
    const loadingSection = $('#loadingSection');
    const errorSection = $('#errorSection');
    const errorText = $('#errorText');
    const resultsSection = $('#resultsSection');
    const resultOverview = $('#resultOverview');
    const locationSection = $('#locationSection');
    const coordsInfo = $('#coordsInfo');
    const addressInfo = $('#addressInfo');
    const compTableHead = $('#compTableHead');
    const compTableBody = $('#compTableBody');
    const securityGrid = $('#securityGrid');
    const bgParticles = $('#bgParticles');

    let detectedIP = null;
    let leafletMap = null;
    let mapMarker = null;
    let currentLang = 'zh';

    // ═══════════════════════════════════════════
    // 多语言 i18n
    // ═══════════════════════════════════════════
    function t(zh, en) {
        return currentLang === 'zh' ? zh : en;
    }

    function initLang() {
        currentLang = localStorage.getItem('ip-query-lang') || 'zh';
        document.body.setAttribute('data-lang', currentLang);
        updateLangToggleLabel();
        updatePlaceholder();
    }

    function updateLangToggleLabel() {
        const label = langToggle.querySelector('.lang-label');
        if (label) label.textContent = currentLang === 'zh' ? '中/EN' : 'EN/中';
    }

    function updatePlaceholder() {
        if (ipInput) {
            const key = currentLang === 'zh' ? 'data-placeholder-zh' : 'data-placeholder-en';
            ipInput.placeholder = ipInput.getAttribute(key) || '';
        }
    }

    langToggle.addEventListener('click', () => {
        currentLang = currentLang === 'zh' ? 'en' : 'zh';
        document.body.setAttribute('data-lang', currentLang);
        localStorage.setItem('ip-query-lang', currentLang);
        updateLangToggleLabel();
        updatePlaceholder();
        // Re-render dynamic content if results are visible
        if (lastResultData) renderResults(lastResultData);
    });

    // ═══════════════════════════════════════════
    // 主题切换
    // ═══════════════════════════════════════════
    function initTheme() {
        const saved = localStorage.getItem('ip-query-theme') || 'dark';
        document.body.setAttribute('data-theme', saved);
        themeIcon.textContent = saved === 'dark' ? '🌙' : '🌞';
    }

    themeToggle.addEventListener('click', () => {
        const current = document.body.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.body.setAttribute('data-theme', next);
        themeIcon.textContent = next === 'dark' ? '🌙' : '🌞';
        localStorage.setItem('ip-query-theme', next);
        if (leafletMap) updateMapTiles();
    });

    // ═══════════════════════════════════════════
    // 背景粒子
    // ═══════════════════════════════════════════
    function createParticles() {
        const count = Math.min(25, Math.floor(window.innerWidth / 50));
        for (let i = 0; i < count; i++) {
            const p = document.createElement('div');
            p.className = 'particle';
            p.style.left = Math.random() * 100 + '%';
            p.style.width = (Math.random() * 2 + 1) + 'px';
            p.style.height = p.style.width;
            p.style.animationDuration = (Math.random() * 15 + 10) + 's';
            p.style.animationDelay = (Math.random() * 10) + 's';
            bgParticles.appendChild(p);
        }
    }

    // ═══════════════════════════════════════════
    // 搜索框交互
    // ═══════════════════════════════════════════
    ipInput.addEventListener('input', () => {
        btnClear.classList.toggle('visible', ipInput.value.length > 0);
    });

    btnClear.addEventListener('click', () => {
        ipInput.value = '';
        btnClear.classList.remove('visible');
        ipInput.focus();
    });

    ipInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') searchIP();
    });

    btnSearch.addEventListener('click', searchIP);

    btnQuerySelf.addEventListener('click', () => {
        if (detectedIP) {
            ipInput.value = detectedIP;
            btnClear.classList.add('visible');
            searchIP();
        }
    });

    if (btnUaToggle) {
        btnUaToggle.addEventListener('click', () => {
            uaDetail.classList.toggle('hidden');
            btnUaToggle.classList.toggle('expanded');
        });
    }

    // ═══════════════════════════════════════════
    // 检测 IP + 浏览器
    // ═══════════════════════════════════════════
    async function detectMyIP() {
        try {
            const res = await fetch('/api/myip');
            const data = await res.json();
            if (data.ip) {
                detectedIP = data.ip;
                myIpValue.textContent = data.ip;
                btnQuerySelf.disabled = false;
            } else {
                myIpValue.textContent = t('无法检测', 'Detection Failed');
            }
        } catch {
            myIpValue.textContent = t('检测失败', 'Detection Failed');
        }
    }

    async function detectBrowser() {
        try {
            const res = await fetch('/api/useragent');
            const data = await res.json();
            const p = data.parsed || {};
            const deviceIcon = p.device === 'Mobile' ? '📱' : p.device === 'Tablet' ? '📱' : '💻';
            browserInfo.innerHTML = `
                <span class="ua-chip">${deviceIcon} ${p.device || 'Unknown'}</span>
                <span class="ua-chip">🌐 ${p.browser || 'Unknown'} ${p.version ? p.version.split('.')[0] : ''}</span>
                <span class="ua-chip">🖥️ ${p.os || 'Unknown'}</span>
            `;
            if (data.accept_language) {
                browserInfo.innerHTML += `<span class="ua-chip">🗣️ ${data.accept_language.split(',')[0]}</span>`;
            }
            uaRaw.textContent = data.raw || navigator.userAgent;
        } catch {
            browserInfo.textContent = navigator.userAgent.substring(0, 60) + '...';
            uaRaw.textContent = navigator.userAgent;
        }
    }

    // ═══════════════════════════════════════════
    // IP 查询
    // ═══════════════════════════════════════════
    let lastResultData = null;

    async function searchIP() {
        const ip = ipInput.value.trim();
        if (!ip) { shakeElement(ipInput); return; }
        showSection('loading');

        try {
            const res = await fetch(`/api/query?ip=${encodeURIComponent(ip)}`);
            const data = await res.json();
            if (data.error) { showError(data.message); return; }
            lastResultData = data;
            renderResults(data);
        } catch (err) {
            showError(t('网络请求失败: ', 'Network error: ') + err.message);
        }
    }

    function showSection(section) {
        loadingSection.classList.toggle('hidden', section !== 'loading');
        errorSection.classList.toggle('hidden', section !== 'error');
        resultsSection.classList.toggle('hidden', section !== 'results');
    }

    function showError(msg) {
        errorText.textContent = msg;
        showSection('error');
    }

    function shakeElement(el) {
        el.style.animation = 'none';
        el.offsetHeight;
        el.style.animation = 'shake 0.4s ease';
        setTimeout(() => { el.style.animation = ''; }, 400);
    }

    const shakeStyle = document.createElement('style');
    shakeStyle.textContent = `@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}50%{transform:translateX(6px)}75%{transform:translateX(-4px)}}`;
    document.head.appendChild(shakeStyle);

    // ═══════════════════════════════════════════
    // Leaflet 地图
    // ═══════════════════════════════════════════
    let currentTileLayer = null;

    function getMapTileUrl() {
        const theme = document.body.getAttribute('data-theme');
        return theme === 'dark'
            ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
            : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    }

    function updateMapTiles() {
        if (!leafletMap) return;
        if (currentTileLayer) leafletMap.removeLayer(currentTileLayer);
        currentTileLayer = L.tileLayer(getMapTileUrl(), {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/">CARTO</a>',
            maxZoom: 19,
        }).addTo(leafletMap);
    }

    function initMap(lat, lon) {
        if (leafletMap) {
            leafletMap.setView([lat, lon], 13);
            if (mapMarker) mapMarker.setLatLng([lat, lon]);
            else mapMarker = L.marker([lat, lon]).addTo(leafletMap);
            updateMapTiles();
            return;
        }
        leafletMap = L.map('leafletMap', { center: [lat, lon], zoom: 13 });
        updateMapTiles();
        mapMarker = L.marker([lat, lon]).addTo(leafletMap);
        setTimeout(() => leafletMap.invalidateSize(), 300);
    }

    // ═══════════════════════════════════════════
    // 渲染结果
    // ═══════════════════════════════════════════
    function renderResults(data) {
        const abuse = data.sources.abuseipdb;
        const iplocate = data.sources.iplocate;
        const best = mergeBestData(abuse, iplocate);

        renderOverview(data.ip, best);
        renderComparisonTable(abuse, iplocate);
        renderSecurity(abuse, iplocate);
        renderLocation(best, iplocate);
        showSection('results');
    }

    function mergeBestData(abuse, iplocate) {
        const a = abuse?.data || {};
        const d = iplocate?.data || {};
        return {
            ip: d.ip || a.ip,
            country: d.country || a.country,
            country_code: d.country_code || a.country_code,
            country_flag: d.country_flag || '',
            region: d.region,
            city: d.city,
            isp: a.isp || d.isp || d.organization,
            asn: d.asn,
            organization: d.organization || a.isp,
            hostname: d.hostname || a.hostname,
            timezone: d.timezone,
            usage_type: a.usage_type || d.usage_type || d.connection_type,
            latitude: d.latitude,
            longitude: d.longitude,
            ip_type: d.ip_type || null,
        };
    }

    // ── 总览卡片 ──
    function renderOverview(ip, best) {
        const flag = best.country_flag || '';
        const cards = [
            { label: t('IP 地址', 'IP Address'), value: ip, accent: true },
            { label: t('国家/地区', 'Country'), value: flag + ' ' + (best.country || 'N/A') },
            { label: t('省/州', 'Region'), value: best.region || 'N/A' },
            { label: t('城市', 'City'), value: best.city || 'N/A' },
            { label: t('运营商', 'ISP'), value: best.isp || 'N/A' },
            { label: 'ASN', value: best.asn || 'N/A', accent: true },
            { label: t('时区', 'Timezone'), value: best.timezone || 'N/A' },
            { label: t('网络类型', 'Network'), value: formatUsageType(best.usage_type) || 'N/A', highlight: true },
            { label: t('IP 类型', 'IP Type'), value: best.ip_type || 'N/A' },
        ];

        resultOverview.innerHTML = cards.map(c => `
            <div class="overview-card">
                <div class="overview-label">${c.label}</div>
                <div class="overview-value${c.accent ? ' accent' : ''}${c.highlight ? ' highlight' : ''}">${c.value}</div>
            </div>
        `).join('');
    }

    function formatUsageType(type) {
        if (!type) return null;
        const map = {
            'hosting': t('🏢 主机托管', '🏢 Hosting'),
            'isp': t('🏠 家庭宽带', '🏠 ISP'),
            'business': t('🏗️ 企业网络', '🏗️ Business'),
            'edu': t('🎓 教育网络', '🎓 Education'),
            'gov': t('🏛️ 政府网络', '🏛️ Government'),
            'mil': t('🪖 军事网络', '🪖 Military'),
        };
        const lower = type.toLowerCase();
        for (const [k, v] of Object.entries(map)) {
            if (lower.includes(k)) return v;
        }
        return type;
    }

    // ── 地理位置 & 地址 ──
    function renderLocation(best, iplocate) {
        const d = iplocate?.data || {};
        const lat = d.latitude || null;
        const lon = d.longitude || null;

        if (!lat || !lon) { locationSection.classList.add('hidden'); return; }
        locationSection.classList.remove('hidden');

        coordsInfo.innerHTML = `
            <div class="coord-row">
                <div class="coord-item">
                    <span class="coord-label">${t('纬度', 'Latitude')}</span>
                    <span class="coord-value">${lat}</span>
                </div>
                <div class="coord-item">
                    <span class="coord-label">${t('经度', 'Longitude')}</span>
                    <span class="coord-value">${lon}</span>
                </div>
                <div class="coord-item">
                    <a href="https://www.google.com/maps?q=${lat},${lon}" target="_blank" class="coord-link">📍 Google Maps</a>
                </div>
            </div>
        `;

        setTimeout(() => initMap(lat, lon), 100);
        fetchAddress(lat, lon);
    }

    async function fetchAddress(lat, lon) {
        addressInfo.innerHTML = `<div class="address-loading">${t('正在查询街道地址...', 'Querying address...')}</div>`;

        try {
            const res = await fetch(`/api/geocode?lat=${lat}&lon=${lon}`);
            const data = await res.json();

            if (data.error) {
                addressInfo.innerHTML = `<div class="address-error">${t('地址查询失败', 'Address query failed')}: ${data.error}</div>`;
                return;
            }

            const addr = data.address || {};
            const display = cleanAddr(data.display_name || '');

            if (mapMarker && display) {
                mapMarker.bindPopup(`<div style="font-size:13px;max-width:260px;line-height:1.5">${escapeHtml(display)}</div>`).openPopup();
            }

            // 去重逻辑: 收集唯一值
            const items = [];
            const seen = new Set();

            function addUnique(label, value) {
                value = cleanAddr(value);
                if (!value || seen.has(value)) return;
                seen.add(value);
                items.push(addrItem(label, value));
            }

            addUnique(t('国家', 'Country'), addr.country);
            addUnique(t('省/州', 'State'), addr.state || addr.province);
            addUnique(t('城市', 'City'), addr.city || addr.town || addr.village);
            addUnique(t('区/县', 'District'), addr.county || addr.suburb || addr.district);
            addUnique(t('街道', 'Street'), addr.road || addr.street);
            addUnique(t('邮编', 'Postal'), addr.postcode);

            addressInfo.innerHTML = `
                <div class="address-card address-main">
                    <div class="address-full-label">${t('完整地址', 'Full Address')}</div>
                    <div class="address-full-value">${escapeHtml(display)}</div>
                </div>
                <div class="address-detail-grid">${items.join('')}</div>
            `;
        } catch (err) {
            addressInfo.innerHTML = `<div class="address-error">${t('地址查询失败', 'Address query failed')}: ${err.message}</div>`;
        }
    }

    // 清理 Nominatim 多语言地址 (取分号/斜杠分隔的第一个值)
    function cleanAddr(str) {
        if (!str) return '';
        // 先按逗号分段，每段内取第一个语言变体
        return str.split(',').map(part => {
            part = part.trim();
            // 处理分号分隔 (如 "美国;美國")
            if (part.includes(';')) part = part.split(';')[0].trim();
            // 处理斜杠分隔 (如 "弗吉尼亚州 / 維吉尼亞州")
            if (part.includes(' / ')) part = part.split(' / ')[0].trim();
            return part;
        }).join(', ');
    }

    function addrItem(label, value) {
        return `<div class="address-item"><span class="address-item-label">${label}</span><span class="address-item-value">${escapeHtml(value)}</span></div>`;
    }

    // ── 对比表 ──
    function renderComparisonTable(abuse, iplocate) {
        const a = abuse?.success ? abuse.data : null;
        const d = iplocate?.success ? iplocate.data : null;

        const activeSources = [];
        if (a) activeSources.push({ key: 'abuse', label: 'AbuseIPDB', badge: 'badge-abuse', icon: '🛡️' });
        if (d) activeSources.push({ key: 'iplocate', label: 'iplocate.io', badge: 'badge-dkly', icon: '📡' });

        if (!activeSources.length) {
            compTableHead.innerHTML = '';
            compTableBody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:32px;color:var(--text-tertiary)">${t('所有数据源均查询失败', 'All sources failed')}</td></tr>`;
            return;
        }

        compTableHead.innerHTML = `<tr><th>${t('字段', 'Field')}</th>${activeSources.map(s => `<th><span class="source-badge ${s.badge}">${s.icon} ${s.label}</span></th>`).join('')}</tr>`;

        const rows = [
            { label: t('IP 地址', 'IP Address'), keys: ['ip'] },
            { label: t('国家', 'Country'), keys: ['country'] },
            { label: t('国家代码', 'Code'), keys: ['country_code'] },
            { label: t('地区/省份', 'Region'), keys: ['region'] },
            { label: t('城市', 'City'), keys: ['city'] },
            { label: 'ASN', keys: ['asn'] },
            { label: t('组织/ISP', 'Organization'), keys: ['organization', 'isp'] },
            { label: t('主机名', 'Hostname'), keys: ['hostname'] },
            { label: t('时区', 'Timezone'), keys: ['timezone'] },
            { label: t('网络类型', 'Network'), keys: ['usage_type', 'connection_type'] },
            { label: t('域名', 'Domain'), keys: ['domain'] },
            { label: t('邮编', 'Postal'), keys: ['postal'] },
            { label: t('大洲', 'Continent'), keys: ['continent'] },
            { label: t('IP 类型', 'Type'), keys: ['ip_type'] },
        ];

        const sourceDataMap = {};
        if (a) sourceDataMap.abuse = a;
        if (d) sourceDataMap.iplocate = d;

        compTableBody.innerHTML = rows.map(row => {
            const values = activeSources.map(s => {
                const data = sourceDataMap[s.key];
                if (!data) return null;
                for (const k of row.keys) {
                    if (data[k] != null && data[k] !== '') return String(data[k]);
                }
                return null;
            });
            const nonNull = values.filter(v => v !== null);
            if (!nonNull.length) return '';
            const hasDiff = new Set(nonNull).size > 1;
            const cells = values.map(v => v === null ? `<td class="td-na">—</td>` : `<td class="${hasDiff ? 'td-diff' : ''}">${escapeHtml(v)}</td>`).join('');
            return `<tr><td>${row.label}</td>${cells}</tr>`;
        }).filter(Boolean).join('');

        const failed = [];
        if (!abuse?.success) failed.push(`AbuseIPDB: ${abuse?.error || t('未知', 'Unknown')}`);
        if (!iplocate?.success) failed.push(`iplocate: ${iplocate?.error || t('未知', 'Unknown')}`);
        if (failed.length) {
            compTableBody.innerHTML += `<tr><td colspan="${activeSources.length + 1}" style="padding:12px 24px;font-size:0.82rem;color:var(--status-warning)">⚠️ ${t('部分数据源不可用', 'Some sources unavailable')}: ${failed.join(' | ')}</td></tr>`;
        }
    }

    // ── 安全检测 ──
    function renderSecurity(abuse, iplocate) {
        const d = iplocate?.success ? iplocate.data : {};
        const a = abuse?.success ? abuse.data : {};

        const items = [
            { label: 'VPN', value: d.is_vpn, source: d.is_vpn != null ? 'iplocate' : null },
            { label: t('代理', 'Proxy'), value: d.is_proxy, source: d.is_proxy != null ? 'iplocate' : null },
            { label: 'Tor', value: d.is_tor ?? a.is_tor, source: d.is_tor != null ? 'iplocate' : (a.is_tor != null ? 'AbuseIPDB' : null) },
            { label: t('威胁', 'Threat'), value: d.is_threat ?? a.is_threat, source: d.is_threat != null ? 'iplocate' : (a.is_threat != null ? 'AbuseIPDB' : null) },
        ];
        if (a.abuse_score !== undefined) items.push({ label: t('滥用评分', 'Abuse Score'), value: a.abuse_score, source: 'AbuseIPDB', isScore: true });
        if (a.total_reports !== undefined) items.push({ label: t('举报次数', 'Reports'), value: a.total_reports, source: 'AbuseIPDB', isCount: true });

        securityGrid.innerHTML = items.map(item => {
            let cls, icon, val;
            if (item.isScore) {
                const s = parseInt(item.value);
                cls = s > 50 ? 'danger' : s > 0 ? 'unknown' : 'safe';
                icon = s > 50 ? '🚨' : s > 0 ? '⚡' : '✅';
                val = s + '%';
            } else if (item.isCount) {
                const c = parseInt(item.value);
                cls = c > 10 ? 'danger' : c > 0 ? 'unknown' : 'safe';
                icon = c > 10 ? '📢' : c > 0 ? '📝' : '🔇';
                val = c + ' ' + t('次', 'times');
            } else if (item.value == null) {
                cls = 'unknown'; icon = '❓'; val = t('暂无数据', 'N/A');
            } else if (item.value === true) {
                cls = 'danger'; icon = '🚫'; val = t('是', 'Yes');
            } else {
                cls = 'safe'; icon = '✅'; val = t('否', 'No');
            }
            return `<div class="security-card"><div class="security-status ${cls}">${icon}</div><div class="security-label">${item.label}</div><div class="security-value ${cls}">${val}</div>${item.source ? `<div style="font-size:0.7rem;color:var(--text-tertiary);margin-top:4px">${t('来源', 'Source')}: ${item.source}</div>` : ''}</div>`;
        }).join('');
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ═══════════════════════════════════════════
    // 初始化
    // ═══════════════════════════════════════════
    function init() {
        initLang();
        initTheme();
        createParticles();
        detectMyIP();
        detectBrowser();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
