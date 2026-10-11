const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./helpers/server');
const { validateAds, adMarkup } = require('../lib/ads');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server?.stop(); });

test('administrator save persists all five slots and public API only exposes visible slots', async () => {
    const ads = Object.fromEntries(['head', 'top', 'search', 'result', 'footer'].map((key) => [key, {
        enabled: true, code: `<span>${key} $& $\` $'</span>`, type: 'html', mode: 'inline',
    }]));
    const save = await fetch(`${server.url}/api/admin/settings`, {
        method: 'PUT', headers: server.headers, body: JSON.stringify({ ads }),
    });
    assert.equal(save.status, 200);
    assert.deepEqual((await save.json()).settings.ads, ads);
    const stored = JSON.parse(fs.readFileSync(path.join(server.dir, 'data/settings.json'), 'utf8'));
    assert.deepEqual(stored.ads, ads);
    const res = await fetch(`${server.url}/api/ads`);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const visible = await res.json();
    assert.deepEqual(Object.keys(visible), ['top', 'search', 'result', 'footer']);
    assert.deepEqual(visible.top, ads.top);
    for (const route of ['/', '/index.html?lang=zh']) {
        const page = await fetch(server.url + route);
        assert.equal(page.headers.get('cache-control'), 'no-store');
        assert.ok((await page.text()).includes(ads.head.code));
    }
});

test('invalid advertising configuration is rejected without altering saved settings', async () => {
    const invalid = [null, [], { unknown: {} }, { top: { enabled: 'true' } }, { top: { code: 1 } },
        { top: { type: 'js' } }, { top: { mode: 'bad' } }, { head: { mode: 'iframe' } },
        { top: { code: 'x'.repeat(65537) } }];
    const file = path.join(server.dir, 'data/settings.json');
    const previous = fs.readFileSync(file, 'utf8');
    for (const ads of invalid) {
        const res = await fetch(`${server.url}/api/admin/settings`, {
            method: 'PUT', headers: server.headers, body: JSON.stringify({ ads }),
        });
        assert.equal(res.status, 400);
        assert.equal((await res.json()).error, true);
        assert.equal(fs.readFileSync(file, 'utf8'), previous);
    }
});

test('advertising settings cannot be changed without administrator authentication', async () => {
    const res = await fetch(`${server.url}/api/admin/settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ads: {} }),
    });
    assert.equal(res.status, 401);
});

test('large multibyte advertising payloads save successfully', async () => {
    const code = '<span>' + '广告'.repeat(20000) + '</span>';
    const res = await fetch(`${server.url}/api/admin/settings`, {
        method: 'PUT', headers: server.headers,
        body: JSON.stringify({ ads: { top: { enabled: true, code, type: 'html', mode: 'auto' } } }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).settings.ads.top.code, code);
});

test('legacy settings receive advertising type/mode defaults without losing code', async () => {
    const file = path.join(server.dir, 'data/settings.json');
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    stored.ads = { top: { enabled: true, code: '<b>Legacy</b>' } };
    fs.writeFileSync(file, JSON.stringify(stored));
    const data = await (await fetch(`${server.url}/api/ads`)).json();
    assert.deepEqual(data.top, { enabled: true, code: '<b>Legacy</b>', type: 'html', mode: 'auto' });
    assert.equal(data.footer.enabled, false);
});

test('plain JavaScript is wrapped safely and HTML snippets remain unchanged', () => {
    assert.equal(adMarkup({ type: 'javascript', code: 'window.label = "</script>";' }),
        '<script>window.label = "<\\/script>";</script>');
    assert.equal(adMarkup({ code: '<script src="/platform.js"></script>' }), '<script src="/platform.js"></script>');
    assert.doesNotThrow(() => validateAds({ top: { enabled: false, code: '' } }));
});
