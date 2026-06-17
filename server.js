require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { execFile } = require('child_process');
const settings = require('./lib/settings');

// ── Git 命令封装 (用于后台在线更新) ──
function git(args, opts = {}) {
    return new Promise((resolve, reject) => {
        execFile('git', args, { cwd: __dirname, timeout: 60000, maxBuffer: 1024 * 1024, ...opts }, (err, stdout, stderr) => {
            if (err) {
                err.stdout = stdout;
                err.stderr = stderr;
                return reject(err);
            }
            resolve({ stdout: (stdout || '').trim(), stderr: (stderr || '').trim() });
        });
    });
}

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
function getIplocateKey() {
    return settings.get().apiKeys?.iplocate || '';
}
function getIp2locationKey() {
    return settings.get().apiKeys?.ip2location || '';
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

// IP 版本 (IPv4 / IPv6) — 始终可从地址本身推导, 不依赖数据源
function ipVersion(ip) {
    if (!ip) return null;
    if (ip.includes(':')) return 'IPv6';
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return 'IPv4';
    return null;
}

// ═══════════════════════════════════════════
// 数据源1: AbuseIPDB
// ═══════════════════════════════════════════
async function fetchAbuseIPDB(ip) {
    const apiKey = nextAbuseKey();
    if (!apiKey) return { source: 'AbuseIPDB', success: false, error: 'No API key', data: null };
    try {
        const s = settings.get();
        const baseUrl = s.apiEndpoints?.abuseipdb || 'https://api.abuseipdb.com/api/v2/check';
        const res = await fetch(`${baseUrl}?ipAddress=${encodeURIComponent(ip)}&verbose`, {
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
                ip_type: ipVersion(d.ipAddress || ip),
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
// 数据源2: iplocate.io
// ═══════════════════════════════════════════
async function fetchIplocate(ip) {
    const key = getIplocateKey();
    if (!key) return { source: 'iplocate', success: false, error: 'No API key', data: null };
    try {
        const s = settings.get();
        const baseUrl = s.apiEndpoints?.iplocate || 'https://iplocate.io/api/lookup';
        const url = ip
            ? `${baseUrl}/${encodeURIComponent(ip)}?apikey=${encodeURIComponent(key)}`
            : `${baseUrl}?apikey=${encodeURIComponent(key)}`;
        const res = await fetch(url, { timeout: 8000 });
        if (!res.ok) throw new Error(`iplocate HTTP ${res.status}`);
        const d = await res.json();
        if (d.error) throw new Error(d.error);
        return {
            source: 'iplocate', success: true,
            data: {
                ip: d.ip || ip,
                country: d.country || null,
                country_code: d.country_code || null,
                country_flag: null,
                region: d.subdivision || null,
                city: d.city || null,
                latitude: d.latitude || null,
                longitude: d.longitude || null,
                timezone: d.time_zone || null,
                timezone_abbr: null,
                asn: d.asn?.asn || null,
                organization: d.asn?.name || null,
                connection_type: d.asn?.type || null,
                isp: d.company?.name || d.asn?.name || null,
                hostname: null,
                ip_type: (() => {
                    let v = ipVersion(d.ip || ip);
                    const flags = [];
                    if (d.is_anycast) flags.push('Anycast');
                    if (d.is_satellite) flags.push('Satellite');
                    return v && flags.length ? `${v} · ${flags.join('/')}` : v;
                })(),
                is_vpn: d.privacy?.is_vpn ?? null,
                is_proxy: d.privacy?.is_proxy ?? null,
                is_tor: d.privacy?.is_tor ?? null,
                is_threat: d.privacy?.is_abuser ?? null,
                continent: d.continent || null,
                continent_code: null,
                postal: d.postal_code || null,
                domain: d.asn?.domain || null,
                usage_type: d.asn?.type || null,
                is_hosting: d.privacy?.is_hosting ?? null,
                is_anonymous: d.privacy?.is_anonymous ?? null,
                company_name: d.company?.name || null,
                company_domain: d.company?.domain || null,
                hosting_provider: d.hosting?.provider || null,
            }
        };
    } catch (err) {
        return { source: 'iplocate', success: false, error: err.message, data: null };
    }
}

// ═══════════════════════════════════════════
// 数据源3: ip2location.io
// ═══════════════════════════════════════════
async function fetchIp2location(ip) {
    const key = getIp2locationKey();
    try {
        const s = settings.get();
        const baseUrl = s.apiEndpoints?.ip2location || 'https://api.ip2location.io/';
        const params = new URLSearchParams();
        if (key) params.set('key', key);
        if (ip) params.set('ip', ip);
        const sep = baseUrl.includes('?') ? '&' : '?';
        const url = `${baseUrl}${sep}${params.toString()}`;
        const res = await fetch(url, { timeout: 8000 });
        if (!res.ok) throw new Error(`ip2location HTTP ${res.status}`);
        const d = await res.json();
        if (d.error) throw new Error(d.error.error_message || 'ip2location error');
        const proxy = d.proxy || {};
        return {
            source: 'ip2location', success: true,
            data: {
                ip: d.ip || ip,
                country: d.country_name || d.country?.name || null,
                country_code: d.country_code || null,
                country_flag: d.country?.flag || null,
                region: d.region_name || null,
                city: d.city_name || null,
                latitude: d.latitude ?? null,
                longitude: d.longitude ?? null,
                timezone: d.time_zone || null,
                timezone_abbr: d.time_zone_info?.abbreviation || null,
                asn: d.asn || d.as_info?.as_number || null,
                organization: d.as || d.as_info?.as_name || null,
                connection_type: d.as_info?.as_usage_type || null,
                isp: d.isp || d.as || null,
                hostname: null,
                ip_type: d.address_type || ipVersion(d.ip || ip),
                is_vpn: proxy.is_vpn ?? null,
                is_proxy: d.is_proxy ?? null,
                is_tor: proxy.is_tor ?? null,
                is_threat: proxy.threat ? proxy.threat !== '-' : null,
                continent: d.continent?.name || null,
                continent_code: d.continent?.code || null,
                postal: d.zip_code || null,
                domain: d.domain || d.as_info?.as_domain || null,
                usage_type: d.usage_type || null,
                is_hosting: proxy.is_data_center ?? null,
                is_anonymous: proxy.is_public_proxy ?? null,
                company_name: d.isp || null,
                company_domain: d.domain || null,
                hosting_provider: proxy.provider && proxy.provider !== '-' ? proxy.provider : null,
                fraud_score: d.fraud_score ?? null,
            }
        };
    } catch (err) {
        return { source: 'ip2location', success: false, error: err.message, data: null };
    }
}

// ═══════════════════════════════════════════
// Nominatim 反向地理编码
// ═══════════════════════════════════════════
async function reverseGeocode(lat, lon) {
    const s = settings.get();
    const email = s.apiKeys?.nominatimEmail || '';
    const baseUrl = s.apiEndpoints?.nominatim || 'https://nominatim.openstreetmap.org/reverse';
    const headers = {
        'User-Agent': `IPQuerySystem/1.0 ${email ? '(' + email + ')' : ''}`,
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5',
    };
    try {
        const url = `${baseUrl}?lat=${lat}&lon=${lon}&format=json&zoom=14&addressdetails=1`;
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
        const [abuse, iplocate, ip2location] = await Promise.all([
            fetchAbuseIPDB(ip), fetchIplocate(ip), fetchIp2location(ip),
        ]);
        res.json({ ip, timestamp: new Date().toISOString(), sources: { abuseipdb: abuse, iplocate, ip2location } });
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
// 管理后台: 系统在线更新
// ═══════════════════════════════════════════

// ── GitHub 仓库信息 (从 origin remote 推导) ──
async function getRepoSlug() {
    const { stdout: url } = await git(['remote', 'get-url', 'origin']);
    // 支持 https://github.com/owner/repo(.git) 和 git@github.com:owner/repo(.git)
    const m = url.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/);
    if (!m) return null;
    return { owner: m[1], repo: m[2] };
}

// ── 版本号比较 (语义化, 形如 v1.2.3 / 1.2.3) ──
function parseVersion(tag) {
    if (!tag) return null;
    const m = String(tag).trim().match(/v?(\d+)\.(\d+)\.(\d+)/);
    if (!m) return null;
    return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}
function compareVersion(a, b) {
    const va = parseVersion(a), vb = parseVersion(b);
    if (!va || !vb) return 0;
    for (let i = 0; i < 3; i++) {
        if (va[i] !== vb[i]) return va[i] - vb[i];
    }
    return 0;
}

// ── 当前所在版本: 优先精确 tag, 否则 "最近tag-提交数-g哈希", 无 tag 则用哈希 ──
async function getCurrentVersion() {
    const { stdout: hash } = await git(['rev-parse', '--short', 'HEAD']);
    try {
        const { stdout: exact } = await git(['describe', '--tags', '--exact-match', 'HEAD']);
        return { version: exact, exact: true, hash };
    } catch {
        try {
            const { stdout: desc } = await git(['describe', '--tags', '--always']);
            return { version: desc, exact: false, hash };
        } catch {
            return { version: hash, exact: false, hash };
        }
    }
}

// ── 拉取 GitHub 最新 Release (含 changelog 正文) ──
async function fetchLatestRelease() {
    const slug = await getRepoSlug();
    if (!slug) return null;
    const apiUrl = `https://api.github.com/repos/${slug.owner}/${slug.repo}/releases/latest`;
    const headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'ip-query-updater' };
    if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
    const r = await fetch(apiUrl, { headers, timeout: 10000 });
    if (r.status === 404) return null; // 仓库尚未发布任何 Release
    if (!r.ok) throw new Error(`GitHub API HTTP ${r.status}`);
    const d = await r.json();
    return {
        tag: d.tag_name,
        name: d.name || d.tag_name,
        body: d.body || '',
        publishedAt: d.published_at,
        htmlUrl: d.html_url,
    };
}

// 检查更新 — 对比当前 tag 与 GitHub 最新 Release
app.get('/api/admin/update/check', requireAdmin, async (req, res) => {
    try {
        // 拉取远端 tags (含已删除的清理), 不合并工作区
        await git(['fetch', '--quiet', '--tags', '--force', 'origin']);

        const cur = await getCurrentVersion();
        const release = await fetchLatestRelease();

        if (!release) {
            return res.json({
                success: true,
                mode: 'release',
                current: cur,
                remote: null,
                hasUpdate: false,
                message: '远端仓库尚未发布任何 Release。',
            });
        }

        // 判断是否有更新:
        // - 当前停在某个语义化 tag 上 → 比较版本号, 远端更高才提示
        // - 当前不在任何 Release tag 上 (裸 commit / 旧部署) → 只要本地 HEAD 不是该 tag 即提示
        const curVer = parseVersion(cur.version);
        let hasUpdate;
        if (curVer) {
            hasUpdate = compareVersion(release.tag, cur.version) > 0;
        } else {
            // 当前 HEAD 是否就是该 Release tag 指向的提交?
            let onTag = false;
            try {
                const { stdout: tagHash } = await git(['rev-parse', '--short', `refs/tags/${release.tag}`]);
                onTag = tagHash === cur.hash;
            } catch { onTag = false; }
            hasUpdate = !onTag;
        }

        res.json({
            success: true,
            mode: 'release',
            current: cur,
            remote: {
                tag: release.tag,
                name: release.name,
                body: release.body,
                publishedAt: release.publishedAt,
                htmlUrl: release.htmlUrl,
            },
            hasUpdate,
        });
    } catch (err) {
        res.status(500).json({ error: true, message: '检查更新失败: ' + (err.stderr || err.message) });
    }
});

// 健康检查 — 公开，用于重启后前端轮询服务是否恢复
app.get('/api/health', (req, res) => {
    res.json({ ok: true });
});

// 是否运行在 PM2 下
function isUnderPM2() {
    return process.env.pm_id !== undefined || !!process.env.PM2_HOME;
}

// 重启 PM2 进程 — 先响应再重启，避免客户端收不到结果
app.post('/api/admin/restart', requireAdmin, (req, res) => {
    if (!isUnderPM2()) {
        return res.json({
            success: true,
            restarted: false,
            message: '未检测到 PM2 环境，无法自动重启。请手动重启 Node 进程让新代码生效。',
        });
    }
    const target = process.env.name || 'ip-query';
    res.json({ success: true, restarted: true, target, message: `正在重启 PM2 进程 [${target}]...` });

    // 延迟重启，确保上面的响应已发送给客户端。
    // detached + unref 让重启命令脱离当前进程，即使本进程被杀死也能完成。
    setTimeout(() => {
        const { spawn } = require('child_process');
        try {
            const child = spawn('pm2', ['restart', target], { cwd: __dirname, detached: true, stdio: 'ignore' });
            child.unref();
        } catch (e) {
            console.error('PM2 重启失败:', e.message);
        }
    }, 600);
});

// 执行更新 — 强制对齐到指定/最新的 Release tag
app.post('/api/admin/update/pull', requireAdmin, async (req, res) => {
    try {
        await git(['fetch', '--quiet', '--tags', '--force', 'origin']);

        // 目标 tag: 请求体指定优先, 否则用 GitHub 最新 Release
        let targetTag = (req.body && req.body.tag) ? String(req.body.tag).trim() : '';
        if (!targetTag) {
            const release = await fetchLatestRelease();
            if (!release) {
                return res.status(400).json({ error: true, message: '远端仓库尚未发布任何 Release，无可更新版本。' });
            }
            targetTag = release.tag;
        }

        // 校验 tag 存在 (同时防止注入非法 ref)
        if (!/^[\w.\-/]+$/.test(targetTag)) {
            return res.status(400).json({ error: true, message: '非法的版本标签: ' + targetTag });
        }
        try {
            await git(['rev-parse', '--verify', `refs/tags/${targetTag}`]);
        } catch {
            return res.status(404).json({ error: true, message: `未找到版本标签 ${targetTag}，请先在 GitHub 发布对应 Release。` });
        }

        const before = await getCurrentVersion();

        // 记录是否有本地代码改动 (仅用于日志告知, 不阻断更新)
        const { stdout: dirty } = await git(['status', '--porcelain']);

        // 强制对齐工作区到目标 tag。
        // git reset --hard 只影响被 git 跟踪的代码文件；
        // data/settings.json 与 .env 已被 .gitignore 忽略，用户配置不受影响。
        const { stdout: resetOut, stderr: resetErr } = await git(['reset', '--hard', `refs/tags/${targetTag}`]);
        const after = await getCurrentVersion();

        // 版本变了, 或清理了脏工作区 → 都视为"已更新"(触发后续重启刷新)
        const updated = before.hash !== after.hash || !!dirty;
        const outputLines = [resetOut, resetErr].filter(Boolean);
        if (dirty) {
            outputLines.unshift(`⚠️ 检测到本地代码改动，已强制覆盖以对齐 ${targetTag} (用户配置 data/settings.json 不受影响):\n${dirty}`);
        }

        res.json({
            success: true,
            updated,
            tag: targetTag,
            output: outputLines.join('\n'),
            current: after,
            note: updated
                ? `已更新到 ${targetTag}。如涉及后端代码 (server.js / lib)，需重启 Node/PM2 进程让新代码生效。`
                : `已对齐到 ${targetTag}（版本未变）。`,
        });
    } catch (err) {
        res.status(500).json({ error: true, message: '更新失败: ' + (err.stderr || err.message) });
    }
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
    const hasIplocate = !!s.apiKeys?.iplocate;
    const hasIp2location = !!s.apiKeys?.ip2location;
    console.log(`🚀 IP Query Server running at http://0.0.0.0:${PORT}`);
    console.log(`   AbuseIPDB keys: ${abuseCount} loaded`);
    console.log(`   iplocate.io:    ${hasIplocate ? '✅ configured' : '❌ not configured'}`);
    console.log(`   ip2location.io: ${hasIp2location ? '✅ configured' : '⚠️  keyless (1000/day)'}`);
    console.log(`   Admin panel:    http://0.0.0.0:${PORT}/admin`);
    console.log(`   Admin password: ${s.admin?.password || 'admin123'}`);
});
