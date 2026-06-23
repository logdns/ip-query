/**
 * 设置管理模块 — 读写 data/settings.json
 */
const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, '..', 'data', 'settings.json');

const DEFAULT_SETTINGS = {
    seo: {
        title: 'IP Query System — Multi-source Comparison',
        description: 'A multi-source IP geolocation, network information, and security detection system.',
        keywords: 'IP lookup,IP address,geolocation,GeoIP,security detection,IP location',
        localized: {
            en: {
                title: 'IP Query System — Multi-source Comparison',
                description: 'A multi-source IP geolocation, network information, and security detection system.',
                keywords: 'IP lookup,IP address,geolocation,GeoIP,security detection,IP location',
            },
            zh: {
                title: 'IP 信息查询系统 — 多源数据对比',
                description: '多数据源 IP 地理位置、网络信息、安全检测查询系统。',
                keywords: 'IP查询,IP地址,地理位置,GeoIP,安全检测,IP定位',
            },
            'zh-Hant': {
                title: 'IP 資訊查詢系統 — 多來源資料對比',
                description: '多資料來源 IP 地理位置、網路資訊與安全檢測查詢系統。',
                keywords: 'IP查詢,IP位址,地理位置,GeoIP,安全檢測,IP定位',
            },
            ja: {
                title: 'IP 情報検索システム — 複数ソース比較',
                description: '複数データソースによる IP 位置情報、ネットワーク情報、セキュリティ検出システム。',
                keywords: 'IP検索,IPアドレス,位置情報,GeoIP,セキュリティ検出,IPロケーション',
            },
        },
    },
    apiKeys: {
        abuseipdb: [],
        iplocate: '',
        ip2location: '',
        nominatimEmail: '',
    },
    apiEndpoints: {
        abuseipdb: 'https://api.abuseipdb.com/api/v2/check',
        iplocate: 'https://iplocate.io/api/lookup',
        ip2location: 'https://api.ip2location.io/',
        nominatim: 'https://nominatim.openstreetmap.org/reverse',
    },
    ads: {
        head: {
            enabled: false,
            code: '',
        },
        top: {
            enabled: false,
            code: '',
        },
        search: {
            enabled: false,
            code: '',
        },
        result: {
            enabled: false,
            code: '',
        },
        footer: {
            enabled: false,
            code: '',
        },
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
    const iplocateKey = process.env.IPLOCATE_API_KEY;
    if (iplocateKey) s.apiKeys.iplocate = iplocateKey;
    const ip2locationKey = process.env.IP2LOCATION_API_KEY;
    if (ip2locationKey) s.apiKeys.ip2location = ip2locationKey;
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
        const saved = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
        // 升级迁移: 用新版默认配置回填缺失字段，保留用户已有值
        const merged = deepMerge(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), saved);
        return migrateSeo(merged, saved);
    } catch {
        return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
}

function migrateSeo(settings, saved) {
    const savedSeo = saved?.seo || {};
    if (!savedSeo.localized && (savedSeo.title || savedSeo.description || savedSeo.keywords)) {
        settings.seo.localized.en = {
            title: savedSeo.title || settings.seo.localized.en.title,
            description: savedSeo.description || settings.seo.localized.en.description,
            keywords: savedSeo.keywords || settings.seo.localized.en.keywords,
        };
    }
    settings.seo.title = settings.seo.localized?.en?.title || settings.seo.title;
    settings.seo.description = settings.seo.localized?.en?.description || settings.seo.description;
    settings.seo.keywords = settings.seo.localized?.en?.keywords || settings.seo.keywords;
    return settings;
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
