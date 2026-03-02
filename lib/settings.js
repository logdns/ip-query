/**
 * 设置管理模块 — 读写 data/settings.json
 */
const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, '..', 'data', 'settings.json');

const DEFAULT_SETTINGS = {
    seo: {
        title: 'IP 信息查询系统 — 多源数据对比',
        description: '多数据源 IP 地理位置、网络信息、安全检测查询系统，支持 GeoJS、AbuseIPDB、dklyIPdatabase 数据对比。',
        keywords: 'IP查询,IP地址,地理位置,GeoIP,安全检测,AbuseIPDB,IP定位',
    },
    apiKeys: {
        abuseipdb: [],
        dkly: '',
        nominatimEmail: '',
    },
    admin: {
        password: 'admin123',
    },
};

function ensureDir() {
    const dir = path.dirname(SETTINGS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** 首次启动时从 .env 迁移 */
function seedFromEnv() {
    const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    const envKeys = (process.env.ABUSEIPDB_KEYS || '').split(',').filter(Boolean);
    if (envKeys.length) s.apiKeys.abuseipdb = envKeys;
    const dk = process.env.DKLY_API_KEY;
    if (dk && dk !== 'your_dkly_api_key_here') s.apiKeys.dkly = dk;
    if (process.env.ADMIN_PASSWORD) s.admin.password = process.env.ADMIN_PASSWORD;
    if (process.env.NOMINATIM_EMAIL) s.apiKeys.nominatimEmail = process.env.NOMINATIM_EMAIL;
    return s;
}

function load() {
    ensureDir();
    if (!fs.existsSync(SETTINGS_PATH)) {
        const s = seedFromEnv();
        save(s);
        return s;
    }
    try {
        return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    } catch {
        return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
}

function save(settings) {
    ensureDir();
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
}

function get() { return load(); }

function update(patch) {
    const cur = load();
    const merged = deepMerge(cur, patch);
    save(merged);
    return merged;
}

function deepMerge(target, source) {
    const out = { ...target };
    for (const k of Object.keys(source)) {
        if (source[k] && typeof source[k] === 'object' && !Array.isArray(source[k])) {
            out[k] = deepMerge(target[k] || {}, source[k]);
        } else {
            out[k] = source[k];
        }
    }
    return out;
}

module.exports = { get, update, save, load, DEFAULT_SETTINGS };
