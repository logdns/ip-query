const SLOT_KEYS = ['head', 'top', 'search', 'result', 'footer'];
const MAX_CODE_LENGTH = 64 * 1024;

function validateAds(ads) {
    if (!ads || typeof ads !== 'object' || Array.isArray(ads)) {
        throw new Error('广告配置必须是对象');
    }
    for (const [key, ad] of Object.entries(ads)) {
        if (!SLOT_KEYS.includes(key) || !ad || typeof ad !== 'object' || Array.isArray(ad)) {
            throw new Error('无效的广告位配置');
        }
        if (ad.enabled !== undefined && typeof ad.enabled !== 'boolean') {
            throw new Error(`${key}: 启用状态必须是布尔值`);
        }
        if (ad.code !== undefined && (typeof ad.code !== 'string' || ad.code.length > MAX_CODE_LENGTH)) {
            throw new Error(`${key}: 广告代码必须是字符串，且不能超过 64K 字符`);
        }
        if (ad.type !== undefined && !['html', 'javascript'].includes(ad.type)) {
            throw new Error(`${key}: 无效的代码类型`);
        }
        if (ad.mode !== undefined && !['auto', 'inline', 'iframe'].includes(ad.mode)) {
            throw new Error(`${key}: 无效的加载方式`);
        }
        if (key === 'head' && ad.mode && ad.mode !== 'auto' && ad.mode !== 'inline') {
            throw new Error('Head 脚本位不支持 iframe 加载');
        }
    }
}

function adMarkup(ad) {
    const code = typeof ad?.code === 'string' ? ad.code : '';
    if (ad?.type !== 'javascript') return code;
    return `<script>${code.replace(/<\/script/gi, '<\\/script')}</script>`;
}

module.exports = { SLOT_KEYS, validateAds, adMarkup };
