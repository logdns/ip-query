/* ═══════════════════════════════════════════
   IP Query System — Frontend Logic
   ═══════════════════════════════════════════ */

(function () {
    'use strict';

    // ── DOM Elements ──
    const $ = (sel) => document.querySelector(sel);
    const themeToggle = $('#themeToggle');
    const themeIcon = $('.theme-icon');
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

    // ── State ──
    let detectedIP = null;
    let leafletMap = null;
    let mapMarker = null;

    // ═══════════════════════════════════════════
    // 主题切换 Theme Toggle
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
    // 背景粒子 Background Particles
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
    // 搜索框交互 Search Interaction
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

    // ═══════════════════════════════════════════
    // UA 详情折叠
    // ═══════════════════════════════════════════
    if (btnUaToggle) {
        btnUaToggle.addEventListener('click', () => {
            uaDetail.classList.toggle('hidden');
            btnUaToggle.classList.toggle('expanded');
        });
    }

    // ═══════════════════════════════════════════
    // 检测 IP + 浏览器信息
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
                myIpValue.textContent = '无法检测 / Detection Failed';
            }
        } catch {
            myIpValue.textContent = '检测失败 / Detection Failed';
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
                const lang = data.accept_language.split(',')[0] || '';
                browserInfo.innerHTML += `<span class="ua-chip">🗣️ ${lang}</span>`;
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
    async function searchIP() {
        const ip = ipInput.value.trim();
        if (!ip) {
            shakeElement(ipInput);
            return;
        }

        showSection('loading');

        try {
            const res = await fetch(`/api/query?ip=${encodeURIComponent(ip)}`);
            const data = await res.json();

            if (data.error) {
                showError(data.message);
                return;
            }

            renderResults(data);
        } catch (err) {
            showError('网络请求失败 / Network error: ' + err.message);
        }
    }

    // ═══════════════════════════════════════════
    // UI 状态管理
    // ═══════════════════════════════════════════
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
    shakeStyle.textContent = `
        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-6px); }
            50% { transform: translateX(6px); }
            75% { transform: translateX(-4px); }
        }
    `;
    document.head.appendChild(shakeStyle);

    // ═══════════════════════════════════════════
    // Leaflet 地图
    // ═══════════════════════════════════════════
    let currentTileLayer = null;

    function getMapTileUrl() {
        const theme = document.body.getAttribute('data-theme');
        if (theme === 'dark') {
            return 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
        }
        return 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    }

    function updateMapTiles() {
        if (!leafletMap) return;
        if (currentTileLayer) {
            leafletMap.removeLayer(currentTileLayer);
        }
        currentTileLayer = L.tileLayer(getMapTileUrl(), {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/">CARTO</a>',
            maxZoom: 19,
        }).addTo(leafletMap);
    }

    function initMap(lat, lon) {
        const mapEl = document.getElementById('leafletMap');
        if (!mapEl) return;

        if (leafletMap) {
            leafletMap.setView([lat, lon], 13);
            if (mapMarker) {
                mapMarker.setLatLng([lat, lon]);
            } else {
                mapMarker = L.marker([lat, lon]).addTo(leafletMap);
            }
            updateMapTiles();
            return;
        }

        leafletMap = L.map('leafletMap', {
            center: [lat, lon],
            zoom: 13,
            zoomControl: true,
            attributionControl: true,
        });

        updateMapTiles();
        mapMarker = L.marker([lat, lon]).addTo(leafletMap);

        setTimeout(() => { leafletMap.invalidateSize(); }, 300);
    }

    // ═══════════════════════════════════════════
    // 双语辅助函数 Bilingual Helper
    // ═══════════════════════════════════════════
    function bi(zh, en) {
        return `${zh} <span class="label-en">${en}</span>`;
    }

    // ═══════════════════════════════════════════
    // 渲染结果
    // ═══════════════════════════════════════════
    function renderResults(data) {
        const sources = data.sources;
        const abuse = sources.abuseipdb;
        const dkly = sources.dkly;

        const best = mergeBestData(abuse, dkly);

        renderOverview(data.ip, best);
        renderComparisonTable(abuse, dkly);
        renderSecurity(abuse, dkly);
        renderLocation(best, abuse, dkly);

        showSection('results');
    }

    // ── 合并最佳数据 ──
    function mergeBestData(abuse, dkly) {
        const a = abuse?.data || {};
        const d = dkly?.data || {};

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
            connection_type: d.connection_type || null,
        };
    }

    // ── 总览卡片 ──
    function renderOverview(ip, best) {
        const flag = best.country_flag || '';
        const cards = [
            { label: bi('IP 地址', 'IP Address'), value: ip, accent: true },
            { label: bi('国家/地区', 'Country'), value: flag + ' ' + (best.country || 'N/A') },
            { label: bi('省/州', 'Region'), value: best.region || 'N/A' },
            { label: bi('城市', 'City'), value: best.city || 'N/A' },
            { label: bi('运营商', 'ISP'), value: best.isp || 'N/A' },
            { label: 'ASN', value: best.asn || 'N/A', accent: true },
            { label: bi('时区', 'Timezone'), value: best.timezone || 'N/A' },
            { label: bi('网络类型', 'Network Type'), value: formatUsageType(best.usage_type) || 'N/A', highlight: true },
            { label: bi('IP 类型', 'IP Type'), value: best.ip_type || 'N/A' },
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
            'hosting': '🏢 主机托管 Hosting',
            'isp': '🏠 家庭宽带 ISP',
            'business': '🏗️ 企业网络 Business',
            'edu': '🎓 教育网络 Education',
            'gov': '🏛️ 政府网络 Government',
            'mil': '🪖 军事网络 Military',
        };
        const lower = type.toLowerCase();
        for (const [k, v] of Object.entries(map)) {
            if (lower.includes(k)) return v;
        }
        return type;
    }

    // ── 地理位置 & 地址 ──
    function renderLocation(best, abuse, dkly) {
        const d = dkly?.data || {};
        const lat = d.latitude || null;
        const lon = d.longitude || null;

        if (!lat || !lon) {
            locationSection.classList.add('hidden');
            return;
        }

        locationSection.classList.remove('hidden');

        coordsInfo.innerHTML = `
            <div class="coord-row">
                <div class="coord-item">
                    <span class="coord-label">${bi('纬度', 'Latitude')}</span>
                    <span class="coord-value">${lat}</span>
                </div>
                <div class="coord-item">
                    <span class="coord-label">${bi('经度', 'Longitude')}</span>
                    <span class="coord-value">${lon}</span>
                </div>
                <div class="coord-item">
                    <a href="https://www.google.com/maps?q=${lat},${lon}" target="_blank" class="coord-link">
                        📍 Google Maps
                    </a>
                </div>
            </div>
        `;

        setTimeout(() => { initMap(lat, lon); }, 100);
        fetchAddress(lat, lon);
    }

    async function fetchAddress(lat, lon) {
        addressInfo.innerHTML = `<div class="address-loading">${bi('正在查询街道地址...', 'Querying address...')}</div>`;

        try {
            const res = await fetch(`/api/geocode?lat=${lat}&lon=${lon}`);
            const data = await res.json();

            if (data.error) {
                addressInfo.innerHTML = `<div class="address-error">${bi('地址查询失败', 'Address query failed')}: ${data.error}</div>`;
                return;
            }

            const addr = data.address || {};
            const display = data.display_name || '';

            if (mapMarker && display) {
                mapMarker.bindPopup(`<div style="font-size:13px;max-width:260px;line-height:1.5">${escapeHtml(display)}</div>`).openPopup();
            }

            // 去重：如果地址信息中的国家/省与 overview 重复则跳过
            const addrItems = [];
            if (addr.country) addrItems.push(addrItem(bi('国家', 'Country'), addr.country));
            if (addr.state || addr.province) {
                const stateVal = addr.state || addr.province;
                // 避免与国家名重复
                if (stateVal !== addr.country) {
                    addrItems.push(addrItem(bi('省/州', 'State'), stateVal));
                }
            }
            const cityVal = addr.city || addr.town || addr.village;
            if (cityVal) {
                // 避免与省/州重复
                const stateVal = addr.state || addr.province;
                if (cityVal !== stateVal) {
                    addrItems.push(addrItem(bi('城市', 'City'), cityVal));
                }
            }
            const districtVal = addr.county || addr.suburb || addr.district;
            if (districtVal && districtVal !== cityVal) {
                addrItems.push(addrItem(bi('区/县', 'District'), districtVal));
            }
            if (addr.road || addr.street) addrItems.push(addrItem(bi('街道', 'Street'), addr.road || addr.street));
            if (addr.postcode) addrItems.push(addrItem(bi('邮编', 'Postal'), addr.postcode));

            addressInfo.innerHTML = `
                <div class="address-card address-main">
                    <div class="address-full-label">${bi('完整地址', 'Full Address')}</div>
                    <div class="address-full-value">${escapeHtml(display)}</div>
                </div>
                <div class="address-detail-grid">
                    ${addrItems.join('')}
                </div>
            `;
        } catch (err) {
            addressInfo.innerHTML = `<div class="address-error">${bi('地址查询失败', 'Address query failed')}: ${err.message}</div>`;
        }
    }

    function addrItem(label, value) {
        if (!value) return '';
        return `
            <div class="address-item">
                <span class="address-item-label">${label}</span>
                <span class="address-item-value">${escapeHtml(value)}</span>
            </div>
        `;
    }

    // ── 对比表 ──
    function renderComparisonTable(abuse, dkly) {
        const a = abuse?.success ? abuse.data : null;
        const d = dkly?.success ? dkly.data : null;

        const activeSources = [];
        if (a) activeSources.push({ key: 'abuse', label: 'AbuseIPDB', badge: 'badge-abuse', icon: '🛡️' });
        if (d) activeSources.push({ key: 'dkly', label: 'dklyIPdb', badge: 'badge-dkly', icon: '📡' });

        if (activeSources.length === 0) {
            compTableHead.innerHTML = '';
            compTableBody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:32px;color:var(--text-tertiary)">${bi('所有数据源均查询失败', 'All sources failed')}</td></tr>`;
            return;
        }

        compTableHead.innerHTML = `<tr>
            <th>${bi('字段', 'Field')}</th>
            ${activeSources.map(s => `<th><span class="source-badge ${s.badge}">${s.icon} ${s.label}</span></th>`).join('')}
        </tr>`;

        const rows = [
            { label: bi('IP 地址', 'IP Address'), keys: ['ip'] },
            { label: bi('国家', 'Country'), keys: ['country'] },
            { label: bi('国家代码', 'Code'), keys: ['country_code'] },
            { label: bi('地区/省份', 'Region'), keys: ['region'] },
            { label: bi('城市', 'City'), keys: ['city'] },
            { label: 'ASN', keys: ['asn'] },
            { label: bi('组织/ISP', 'Organization'), keys: ['organization', 'isp'] },
            { label: bi('主机名', 'Hostname'), keys: ['hostname'] },
            { label: bi('时区', 'Timezone'), keys: ['timezone'] },
            { label: bi('网络类型', 'Network'), keys: ['usage_type', 'connection_type'] },
            { label: bi('域名', 'Domain'), keys: ['domain'] },
            { label: bi('邮编', 'Postal'), keys: ['postal'] },
            { label: bi('大洲', 'Continent'), keys: ['continent'] },
            { label: bi('IP 类型', 'Type'), keys: ['ip_type'] },
        ];

        const sourceDataMap = {};
        if (a) sourceDataMap.abuse = a;
        if (d) sourceDataMap.dkly = d;

        compTableBody.innerHTML = rows.map(row => {
            const values = activeSources.map(s => {
                const data = sourceDataMap[s.key];
                if (!data) return null;
                for (const k of row.keys) {
                    if (data[k] !== null && data[k] !== undefined && data[k] !== '') {
                        return String(data[k]);
                    }
                }
                return null;
            });

            const nonNullValues = values.filter(v => v !== null);
            const uniqueValues = [...new Set(nonNullValues)];
            const hasDiff = uniqueValues.length > 1;

            if (nonNullValues.length === 0) return '';

            const cells = values.map(v => {
                if (v === null) return `<td class="td-na">—</td>`;
                const cls = hasDiff ? 'td-diff' : '';
                return `<td class="${cls}">${escapeHtml(v)}</td>`;
            }).join('');

            return `<tr><td>${row.label}</td>${cells}</tr>`;
        }).filter(Boolean).join('');

        const failed = [];
        if (!abuse?.success) failed.push(`AbuseIPDB: ${abuse?.error || bi('未知', 'Unknown')}`);
        if (!dkly?.success) failed.push(`dklyIPdb: ${dkly?.error || bi('未知', 'Unknown')}`);

        if (failed.length > 0) {
            compTableBody.innerHTML += `<tr>
                <td colspan="${activeSources.length + 1}" style="padding:12px 24px;font-size:0.82rem;color:var(--status-warning)">
                    ⚠️ ${bi('部分数据源不可用', 'Some sources unavailable')}: ${failed.join(' | ')}
                </td>
            </tr>`;
        }
    }

    // ── 安全检测 ──
    function renderSecurity(abuse, dkly) {
        const d = dkly?.success ? dkly.data : {};
        const a = abuse?.success ? abuse.data : {};

        const items = [
            { label: 'VPN', value: d.is_vpn, source: d.is_vpn != null ? 'dklyIPdb' : null },
            { label: bi('代理', 'Proxy'), value: d.is_proxy, source: d.is_proxy != null ? 'dklyIPdb' : null },
            {
                label: 'Tor', value: d.is_tor ?? a.is_tor,
                source: d.is_tor != null ? 'dklyIPdb' : (a.is_tor != null ? 'AbuseIPDB' : null)
            },
            {
                label: bi('威胁', 'Threat'), value: d.is_threat ?? a.is_threat,
                source: d.is_threat != null ? 'dklyIPdb' : (a.is_threat != null ? 'AbuseIPDB' : null)
            },
        ];

        if (a.abuse_score !== undefined) {
            items.push({ label: bi('滥用评分', 'Abuse Score'), value: a.abuse_score, source: 'AbuseIPDB', isScore: true });
        }
        if (a.total_reports !== undefined) {
            items.push({ label: bi('举报次数', 'Reports'), value: a.total_reports, source: 'AbuseIPDB', isCount: true });
        }

        securityGrid.innerHTML = items.map(item => {
            let statusClass, icon, displayValue;

            if (item.isScore) {
                const score = parseInt(item.value);
                statusClass = score > 50 ? 'danger' : score > 0 ? 'unknown' : 'safe';
                icon = score > 50 ? '🚨' : score > 0 ? '⚡' : '✅';
                displayValue = score + '%';
            } else if (item.isCount) {
                const count = parseInt(item.value);
                statusClass = count > 10 ? 'danger' : count > 0 ? 'unknown' : 'safe';
                icon = count > 10 ? '📢' : count > 0 ? '📝' : '🔇';
                displayValue = count + ` ${bi('次', 'times')}`;
            } else if (item.value === null || item.value === undefined) {
                statusClass = 'unknown';
                icon = '❓';
                displayValue = bi('暂无数据', 'N/A');
            } else if (item.value === true) {
                statusClass = 'danger';
                icon = '🚫';
                displayValue = bi('是', 'Yes');
            } else {
                statusClass = 'safe';
                icon = '✅';
                displayValue = bi('否', 'No');
            }

            return `
                <div class="security-card">
                    <div class="security-status ${statusClass}">${icon}</div>
                    <div class="security-label">${item.label}</div>
                    <div class="security-value ${statusClass}">${displayValue}</div>
                    ${item.source ? `<div style="font-size:0.7rem;color:var(--text-tertiary);margin-top:4px">${bi('来源', 'Source')}: ${item.source}</div>` : ''}
                </div>
            `;
        }).join('');
    }

    // ═══════════════════════════════════════════
    // 工具
    // ═══════════════════════════════════════════
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ═══════════════════════════════════════════
    // 初始化
    // ═══════════════════════════════════════════
    function init() {
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
