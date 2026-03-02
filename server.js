require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const settings = require('./lib/settings');

const app = express();
const PORT = process.env.PORT || 3008;

app.use(express.json());

// ── SEO 模板渲染: 替换 index.html 中的 SEO 占位符 ──
app.get(['/', '/index.html'], (req, res) => {
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    fs.readFile(htmlPath, 'utf8', (err, html) => {
        if (err) return res.status(500).send('Internal Server Error');
        const seo = settings.get().seo || {};
        const rendered = html
            .replace('{{SEO_TITLE}}', seo.title || 'IP 信息查询系统')
            .replace('{{SEO_DESC}}', seo.description || '多数据源 IP 地理位置查询系统')
            .replace('{{SEO_KEYWORDS}}', seo.keywords || 'IP查询,IP地址,地理位置,GeoIP');
        res.set('Content-Type', 'text/html');
        res.send(rendered);
    });
});

app.use(express.static(path.join(__dirname, 'public')));

// ═══════════════════════════════════════════
// 管理员 Token 存储 (内存)
// ═══════════════════════════════════════════
const adminTokens = new Map(); // token → { createdAt }
const TOKEN_TTL = 24 * 60 * 60 * 1000; // 24h

function cleanExpiredTokens() {
    const now = Date.now();
    for (const [t, v] of adminTokens) {
        if (now - v.createdAt > TOKEN_TTL) adminTokens.delete(t);
    }
}
setInterval(cleanExpiredTokens, 60 * 60 * 1000);

function requireAdmin(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: true, message: '未授权' });
    }
    const token = auth.slice(7);
    const entry = adminTokens.get(token);
    if (!entry || Date.now() - entry.createdAt > TOKEN_TTL) {
        adminTokens.delete(token);
        return res.status(401).json({ error: true, message: 'Token 已过期' });
    }
    next();
}

// ═══════════════════════════════════════════
// API Key 轮询器 (动态从 settings 读取)
// ═══════════════════════════════════════════
function getAbuseKeys() {
    return settings.get().apiKeys?.abuseipdb || [];
}
function getDklyKey() {
    return settings.get().apiKeys?.dkly || '';
}

let abuseKeyIndex = 0;
function nextAbuseKey() {
    const keys = getAbuseKeys();
    if (!keys.length) return '';
    const key = keys[abuseKeyIndex % keys.length];
    abuseKeyIndex = (abuseKeyIndex + 1) % keys.length;
    return key;
}

// ═══════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════
function getClientIP(req) {
    let ip = (
        req.headers['x-real-ip'] ||
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.connection?.remoteAddress ||
        req.ip
    );
    // Strip IPv4-mapped IPv6 prefix
    if (ip && ip.startsWith('::ffff:')) {
        ip = ip.substring(7);
    }
    return ip;
}

function isPrivateIP(ip) {
    if (!ip) return true;
    // Loopback
    if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
    // Private IPv4 ranges
    if (/^10\./.test(ip)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
    if (/^192\.168\./.test(ip)) return true;
    // Link-local
    if (/^169\.254\./.test(ip)) return true;
    return false;
}

async function getPublicIP() {
    const services = [
        'https://api.ipify.org?format=json',
        'https://api.myip.com',
    ];
    for (const url of services) {
        try {
            const res = await fetch(url, { timeout: 5000 });
            if (!res.ok) continue;
            const data = await res.json();
            return data.ip || null;
        } catch { continue; }
    }
    return null;
}

function isValidIP(ip) {
    const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6 = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
    if (ipv4.test(ip)) {
        return ip.split('.').every(n => parseInt(n) >= 0 && parseInt(n) <= 255);
    }
    return ipv6.test(ip);
}

// ═══════════════════════════════════════════
// 数据源1: AbuseIPDB
// ═══════════════════════════════════════════
async function fetchAbuseIPDB(ip) {
    const apiKey = nextAbuseKey();
    if (!apiKey) return { source: 'AbuseIPDB', success: false, error: 'No API key', data: null };
    try {
        const res = await fetch(`https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ip)}&verbose`, {
            headers: { 'Key': apiKey, 'Accept': 'application/json' }, timeout: 8000
        });
        if (!res.ok) throw new Error(`AbuseIPDB HTTP ${res.status}`);
        const json = await res.json();
        const d = json.data || {};
        return {
            source: 'AbuseIPDB', success: true,
            data: {
                ip: d.ipAddress || ip, country: d.countryName || null,
                country_code: d.countryCode || null, region: null, city: null,
                latitude: null, longitude: null, timezone: null, asn: null,
                organization: null, isp: d.isp || null,
                hostname: d.hostnames?.[0] || null,
                is_vpn: null, is_proxy: null, is_tor: d.isTor || null,
                is_threat: d.totalReports > 0, continent: null, postal: null,
                domain: d.domain || null, usage_type: d.usageType || null,
                abuse_score: d.abuseConfidenceScore || 0,
                total_reports: d.totalReports || 0,
                is_whitelisted: d.isWhitelisted || false,
            }
        };
    } catch (err) {
        return { source: 'AbuseIPDB', success: false, error: err.message, data: null };
    }
}

// ═══════════════════════════════════════════
// 数据源2: dklyIPdatabase
// ═══════════════════════════════════════════
async function fetchDkly(ip) {
    const key = getDklyKey();
    if (!key) return { source: 'dklyIPdatabase', success: false, error: 'No API key', data: null };
    try {
        const url = ip
            ? `https://ipinfo.dkly.net/api/?key=${encodeURIComponent(key)}&ip=${encodeURIComponent(ip)}`
            : `https://ipinfo.dkly.net/api/?key=${encodeURIComponent(key)}`;
        const res = await fetch(url, { timeout: 8000 });
        if (!res.ok) throw new Error(`dklyIPdatabase HTTP ${res.status}`);
        const d = await res.json();
        if (d.code) throw new Error(d.message || d.code);
        return {
            source: 'dklyIPdatabase', success: true,
            data: {
                ip: d.ip || ip,
                country: d.location?.country?.name || null,
                country_code: d.location?.country?.code || null,
                country_flag: d.location?.country?.flag?.emoji || null,
                region: d.location?.region?.name || null,
                city: d.location?.city || null,
                latitude: d.location?.latitude || null,
                longitude: d.location?.longitude || null,
                timezone: d.time_zone?.id || null,
                timezone_abbr: d.time_zone?.abbreviation || null,
                asn: d.connection?.asn || null,
                organization: d.connection?.organization || null,
                connection_type: d.connection?.type || null,
                isp: d.connection?.organization || null,
                hostname: d.hostname || null,
                ip_type: d.type || null,
                is_vpn: d.security?.is_vpn ?? null,
                is_proxy: d.security?.is_proxy ?? null,
                is_tor: d.security?.is_tor ?? null,
                is_threat: d.security?.is_threat ?? null,
                continent: d.location?.continent?.name || null,
                continent_code: d.location?.continent?.code || null,
                postal: d.location?.postal || null,
                domain: null,
                usage_type: d.connection?.type || null,
            }
        };
    } catch (err) {
        return { source: 'dklyIPdatabase', success: false, error: err.message, data: null };
    }
}

// ═══════════════════════════════════════════
// Nominatim 反向地理编码
// ═══════════════════════════════════════════
async function reverseGeocode(lat, lon) {
    const email = settings.get().apiKeys?.nominatimEmail || '';
    const headers = {
        'User-Agent': `IPQuerySystem/1.0 ${email ? '(' + email + ')' : ''}`,
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5',
    };
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=14&addressdetails=1`;
        const res = await fetch(url, { headers, timeout: 8000 });
        if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
        return await res.json();
    } catch (err) {
        return { error: err.message };
    }
}

// ═══════════════════════════════════════════
// API: 获取访客 IP
// ═══════════════════════════════════════════
app.get('/api/myip', async (req, res) => {
    let ip = getClientIP(req);
    // 如果是私有/回环地址，尝试通过外部服务获取真实公网 IP
    if (isPrivateIP(ip)) {
        const publicIP = await getPublicIP();
        if (publicIP) ip = publicIP;
    }
    res.json({ ip });
});

// ═══════════════════════════════════════════
// API: 获取浏览器标识 (User-Agent)
// ═══════════════════════════════════════════
app.get('/api/useragent', (req, res) => {
    const ua = req.headers['user-agent'] || '';
    res.json({
        raw: ua,
        parsed: parseUserAgent(ua),
        accept_language: req.headers['accept-language'] || '',
    });
});

function parseUserAgent(ua) {
    const result = { browser: '', version: '', os: '', device: 'Desktop' };

    // Browser
    if (/Edg\/(\d[\d.]*)/i.test(ua)) { result.browser = 'Microsoft Edge'; result.version = RegExp.$1; }
    else if (/OPR\/(\d[\d.]*)/i.test(ua)) { result.browser = 'Opera'; result.version = RegExp.$1; }
    else if (/Chrome\/(\d[\d.]*)/i.test(ua)) { result.browser = 'Google Chrome'; result.version = RegExp.$1; }
    else if (/Firefox\/(\d[\d.]*)/i.test(ua)) { result.browser = 'Firefox'; result.version = RegExp.$1; }
    else if (/Safari\/(\d[\d.]*)/i.test(ua) && /Version\/(\d[\d.]*)/i.test(ua)) { result.browser = 'Safari'; result.version = RegExp.$1; }
    else { result.browser = 'Unknown'; }

    // OS
    if (/Windows NT 10/i.test(ua)) result.os = 'Windows 10/11';
    else if (/Windows NT 6\.3/i.test(ua)) result.os = 'Windows 8.1';
    else if (/Windows NT 6\.1/i.test(ua)) result.os = 'Windows 7';
    else if (/Mac OS X ([\d_]+)/i.test(ua)) result.os = 'macOS ' + RegExp.$1.replace(/_/g, '.');
    else if (/Linux/i.test(ua) && /Android ([\d.]+)/i.test(ua)) { result.os = 'Android ' + RegExp.$1; result.device = 'Mobile'; }
    else if (/iPhone|iPad/i.test(ua)) { result.os = 'iOS'; result.device = /iPad/i.test(ua) ? 'Tablet' : 'Mobile'; }
    else if (/Linux/i.test(ua)) result.os = 'Linux';
    else result.os = 'Unknown';

    // Device
    if (/Mobile|Android|iPhone/i.test(ua)) result.device = 'Mobile';
    else if (/iPad|Tablet/i.test(ua)) result.device = 'Tablet';

    return result;
}

// ═══════════════════════════════════════════
// API: 查询 IP 信息
// ═══════════════════════════════════════════
app.get('/api/query', async (req, res) => {
    const ip = req.query.ip;
    if (!ip) return res.status(400).json({ error: true, message: '缺少 ip 参数' });
    if (!isValidIP(ip)) return res.status(400).json({ error: true, message: 'IP 地址格式无效' });

    try {
        const [abuse, dkly] = await Promise.all([
            fetchAbuseIPDB(ip), fetchDkly(ip),
        ]);
        res.json({ ip, timestamp: new Date().toISOString(), sources: { abuseipdb: abuse, dkly } });
    } catch (err) {
        res.status(500).json({ error: true, message: '查询失败: ' + err.message });
    }
});

// ═══════════════════════════════════════════
// API: Nominatim 反向地理编码代理
// ═══════════════════════════════════════════
app.get('/api/geocode', async (req, res) => {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: true, message: '缺少 lat/lon 参数' });
    const data = await reverseGeocode(lat, lon);
    res.json(data);
});

// ═══════════════════════════════════════════
// API: 获取 SEO 设置 (公开)
// ═══════════════════════════════════════════
app.get('/api/seo', (req, res) => {
    const s = settings.get();
    res.json(s.seo || {});
});

// ═══════════════════════════════════════════
// 管理后台: 登录
// ═══════════════════════════════════════════
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    const s = settings.get();
    if (password && password === s.admin?.password) {
        const token = crypto.randomBytes(32).toString('hex');
        adminTokens.set(token, { createdAt: Date.now() });
        return res.json({ success: true, token });
    }
    res.status(401).json({ error: true, message: '密码错误' });
});

// ═══════════════════════════════════════════
// 管理后台: 获取设置 (需认证)
// ═══════════════════════════════════════════
app.get('/api/admin/settings', requireAdmin, (req, res) => {
    const s = settings.get();
    // 脱敏返回 — 密码不完整显示
    const safe = JSON.parse(JSON.stringify(s));
    safe.admin.password = s.admin?.password || '';
    res.json(safe);
});

// ═══════════════════════════════════════════
// 管理后台: 更新设置 (需认证)
// ═══════════════════════════════════════════
app.put('/api/admin/settings', requireAdmin, (req, res) => {
    try {
        const updated = settings.update(req.body);
        // 重新加载 key index
        abuseKeyIndex = 0;
        res.json({ success: true, settings: updated });
    } catch (err) {
        res.status(500).json({ error: true, message: err.message });
    }
});

// ═══════════════════════════════════════════
// 管理后台: 登出
// ═══════════════════════════════════════════
app.post('/api/admin/logout', requireAdmin, (req, res) => {
    const token = req.headers.authorization?.slice(7);
    if (token) adminTokens.delete(token);
    res.json({ success: true });
});

// ═══════════════════════════════════════════
// 页面路由: 管理后台
// ═══════════════════════════════════════════
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ═══════════════════════════════════════════
// 页面路由: 首页 (动态 SEO 注入)
// ═══════════════════════════════════════════
app.get('/', (req, res) => {
    const s = settings.get();
    let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    html = html
        .replace(/\{\{SEO_TITLE\}\}/g, s.seo?.title || 'IP 信息查询系统')
        .replace(/\{\{SEO_DESC\}\}/g, s.seo?.description || '')
        .replace(/\{\{SEO_KEYWORDS\}\}/g, s.seo?.keywords || '');
    res.type('html').send(html);
});

// ═══════════════════════════════════════════
// 启动
// ═══════════════════════════════════════════
app.listen(PORT, '0.0.0.0', () => {
    const s = settings.get();
    const abuseCount = s.apiKeys?.abuseipdb?.length || 0;
    const hasDkly = !!s.apiKeys?.dkly;
    console.log(`🚀 IP Query Server running at http://0.0.0.0:${PORT}`);
    console.log(`   AbuseIPDB keys: ${abuseCount} loaded`);
    console.log(`   dklyIPdatabase: ${hasDkly ? '✅ configured' : '❌ not configured'}`);
    console.log(`   Admin panel:    http://0.0.0.0:${PORT}/admin`);
    console.log(`   Admin password: ${s.admin?.password || 'admin123'}`);
});
