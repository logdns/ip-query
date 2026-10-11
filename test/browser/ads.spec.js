const { test, expect } = require('@playwright/test');
const { startServer, PASSWORD } = require('../helpers/server');

let server;
test.beforeAll(async () => { server = await startServer(); });
test.afterAll(async () => { await server?.stop(); });
test.beforeEach(async ({ page }) => {
    await saveAds(server.initial.ads);
    await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== server.url) return route.abort();
        if (url.pathname === '/api/myip') return route.fulfill({ json: { ip: '8.8.8.8' } });
        if (url.pathname === '/api/ua') return route.fulfill({ json: { raw: 'Test browser' } });
        if (url.pathname === '/api/query') return route.fulfill({ json: { ip: '8.8.8.8', sources: {} } });
        return route.continue();
    });
});

async function saveAds(ads) {
    const res = await fetch(`${server.url}/api/admin/settings`, {
        method: 'PUT', headers: server.headers, body: JSON.stringify({ ads }),
    });
    expect(res.ok).toBeTruthy();
}

test('HTML, plain JavaScript and head scripts display with measurable slots on desktop and mobile', async ({ page }) => {
    await saveAds({
        head: { enabled: true, type: 'javascript', code: 'window.headReady = true; window.headLiteral = "$& </script>";' },
        top: { enabled: true, code: '<b id="html-ad">HTML banner</b>' },
        search: { enabled: true, type: 'javascript', code: 'if (!window.headReady || !document.currentScript.parentElement.offsetWidth) throw new Error("hidden container"); document.currentScript.insertAdjacentHTML("beforebegin", "<b id=js-ad>JS banner</b>");' },
        footer: { enabled: true, code: '<iframe title="Static banner" srcdoc="<p>Iframe banner</p>"></iframe>' },
    });
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        await page.goto(server.url);
        await expect(page.locator('#html-ad')).toBeVisible();
        await expect(page.locator('#js-ad')).toBeVisible();
        expect(await page.evaluate(() => window.headLiteral)).toBe('$& </script>');
        await expect(page.locator('#adSearch')).toHaveAttribute('data-ad-status', 'loaded');
        await expect(page.frameLocator('iframe[title="Static banner"]').locator('p')).toHaveText('Iframe banner');
        for (const id of ['adTop', 'adSearch', 'adFooter']) {
            const box = await page.locator(`#${id}`).boundingBox();
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        }
    }
});

test('non-async external scripts finish before inline initialization', async ({ page }) => {
    await page.route('**/fixture-sdk.js', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 250));
        await route.fulfill({ contentType: 'application/javascript', body: 'window.fixtureSdk = {text: "SDK loaded"};' });
    });
    await saveAds({ top: { enabled: true, code: '<script src="/fixture-sdk.js"></script><script>document.currentScript.insertAdjacentHTML("beforebegin", "<b id=sdk-ad>" + fixtureSdk.text + "</b>");</script>' } });
    await page.goto(server.url);
    await expect(page.locator('#sdk-ad')).toHaveText('SDK loaded');
    await expect(page.locator('#adTop')).toHaveAttribute('data-ad-status', 'loaded');
});

test('direct document.write renders in an auto-sized iframe without replacing the main page', async ({ page }) => {
    await saveAds({ top: { enabled: true, type: 'javascript', code: 'document.write("<div id=legacy-ad style=height:180px>Legacy banner</div>");' } });
    await page.goto(server.url);
    await expect(page.frameLocator('#adTop .ad-frame').locator('#legacy-ad')).toBeVisible();
    await expect(page.locator('#adTop .ad-frame')).toHaveCSS('height', '180px');
    await expect(page.locator('#ipInput')).toBeVisible();
    await expect(page.locator('#adTop')).toHaveAttribute('data-ad-status', 'loaded');
});

test('explicit iframe mode supports external document.write scripts', async ({ page }) => {
    await page.route('**/fixture-legacy.js', (route) => route.fulfill({
        contentType: 'application/javascript', body: 'document.write("<b id=external-legacy>External legacy</b>");',
    }));
    await saveAds({ search: { enabled: true, mode: 'iframe', code: '<script src="/fixture-legacy.js"></script>' } });
    await page.goto(server.url);
    await expect(page.frameLocator('#adSearch .ad-frame').locator('#external-legacy')).toHaveText('External legacy');
    await expect(page.locator('#ipInput')).toBeVisible();
});

test('result advertising initializes once, only after a successful query', async ({ page }) => {
    await saveAds({ result: { enabled: true, type: 'javascript', code: 'if (!document.currentScript.parentElement.offsetWidth) throw new Error("hidden result"); window.resultRuns = (window.resultRuns || 0) + 1; document.currentScript.insertAdjacentHTML("beforebegin", "<b id=result-ad>Result banner</b>");' } });
    await page.goto(server.url);
    await expect(page.locator('#adResult')).toHaveAttribute('data-ad-status', 'pending');
    expect(await page.evaluate(() => window.resultRuns)).toBeUndefined();
    await page.locator('#ipInput').fill('8.8.8.8');
    await page.locator('#btnSearch').click();
    await expect(page.locator('#result-ad')).toBeVisible();
    await expect(page.locator('#adResult')).toHaveAttribute('data-ad-status', 'loaded');
    await page.locator('#btnSearch').click();
    await expect(page.locator('#result-ad')).toBeVisible();
    expect(await page.evaluate(() => window.resultRuns)).toBe(1);
});

test('a failed advertising script reports errors without breaking other slots or IP queries', async ({ page }) => {
    await page.route('**/missing-sdk.js', (route) => route.fulfill({ status: 404, body: '' }));
    await saveAds({
        top: { enabled: true, code: '<script src="/missing-sdk.js"></script>' },
        search: { enabled: true, code: '<b id=healthy-ad>Healthy banner</b>' },
    });
    await page.goto(server.url);
    await expect(page.locator('#adTop')).toHaveAttribute('data-ad-status', 'error');
    await expect(page.locator('#healthy-ad')).toBeVisible();
    await page.locator('#ipInput').fill('8.8.8.8');
    await page.locator('#btnSearch').click();
    await expect(page.locator('#resultsSection')).toBeVisible();
});

test('administrator UI saves advertising type/mode, reloads settings, and applies them on the frontend', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${server.url}/admin`);
    await page.locator('#loginPassword').fill(PASSWORD);
    await page.locator('#loginForm').evaluate((form) => form.requestSubmit());
    await expect(page.locator('#adminApp')).toBeVisible();
    await page.locator('[data-tab="ads"]').click();
    await page.locator('#adTopEnabled').check();
    await page.locator('#adTopType').selectOption('javascript');
    await page.locator('#adTopMode').selectOption('iframe');
    await page.locator('#adTopCode').fill('document.write("<b id=admin-banner>Saved from admin</b>");');
    await page.locator('#btnSave').click();
    await expect(page.locator('#saveStatus')).toContainText('保存成功');
    await page.reload();
    await page.locator('[data-tab="ads"]').click();
    await expect(page.locator('#adTopType')).toHaveValue('javascript');
    await expect(page.locator('#adTopMode')).toHaveValue('iframe');
    await expect(page.locator('#adTopEnabled')).toBeChecked();
    await page.goto(server.url);
    await expect(page.frameLocator('#adTop .ad-frame').locator('#admin-banner')).toHaveText('Saved from admin');
});

test('disabled slots remain hidden even when saved code exists', async ({ page }) => {
    await saveAds({ top: { enabled: false, code: '<b id=disabled-ad>Disabled banner</b>' } });
    await page.goto(server.url);
    await expect(page.locator('#adTop')).toHaveAttribute('data-ad-status', 'disabled');
    await expect(page.locator('#adTop')).toBeHidden();
    await expect(page.locator('#disabled-ad')).toHaveCount(0);
});

test('async scripts retain asynchronous execution and module snippets execute', async ({ page }) => {
    await page.route('**/fixture-async.js', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 250));
        await route.fulfill({ contentType: 'application/javascript', body: 'window.asyncReady = true;' });
    });
    await saveAds({
        top: { enabled: true, code: '<script async src="/fixture-async.js"></script><script>window.inlineBeforeAsync = !window.asyncReady;</script><script type="module">document.getElementById("adTop").insertAdjacentHTML("beforeend", "<b id=module-ad>Module banner</b>");</script>' },
    });
    await page.goto(server.url);
    await expect(page.locator('#module-ad')).toHaveText('Module banner');
    await expect(page.locator('#adTop')).toHaveAttribute('data-ad-status', 'loaded');
    expect(await page.evaluate(() => window.inlineBeforeAsync && window.asyncReady)).toBeTruthy();
});

test('inline and iframe script execution failures are exposed as advertising errors', async ({ page }) => {
    await saveAds({
        top: { enabled: true, type: 'javascript', code: 'throw new Error("inline ad failure");' },
        search: { enabled: true, mode: 'iframe', type: 'javascript', code: 'throw new Error("frame ad failure");' },
    });
    await page.goto(server.url);
    await expect(page.locator('#adTop')).toHaveAttribute('data-ad-status', 'error');
    await expect(page.locator('#adTop')).toHaveAttribute('data-ad-error', /inline ad failure/);
    await expect(page.locator('#adSearch')).toHaveAttribute('data-ad-status', 'error');
    await expect(page.locator('#adSearch')).toHaveAttribute('data-ad-error', /frame ad failure/);
    await expect(page.locator('#ipInput')).toBeVisible();
});

test('administrator rejects empty enabled slots and script tags in JavaScript mode', async ({ page }) => {
    await page.goto(`${server.url}/admin`);
    await page.locator('#loginPassword').fill(PASSWORD);
    await page.locator('#loginForm').evaluate((form) => form.requestSubmit());
    await expect(page.locator('#adminApp')).toBeVisible();
    await page.locator('[data-tab="ads"]').click();
    await page.locator('#adTopEnabled').check();
    await page.locator('#btnSave').click();
    await expect(page.locator('#saveStatus')).toContainText('已启用的广告位不能为空');
    await page.locator('#adTopType').selectOption('javascript');
    await page.locator('#adTopCode').fill('<script>window.example = true;</script>');
    await page.locator('#btnSave').click();
    await expect(page.locator('#saveStatus')).toContainText('纯 JavaScript 类型不需要');
    const res = await fetch(`${server.url}/api/ads`);
    expect((await res.json()).top.enabled).toBeFalsy();
});

test('identical singleton advertising code renders independently in all six visible slots', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.route('**/fixture-singleton.js', (route) => route.fulfill({
        contentType: 'application/javascript',
        body: 'if (!window.widgetStarted) { window.widgetStarted = true; setTimeout(function () { document.getElementById(widgetOptions.target).textContent = "Repeated banner"; }, 100); }',
    }));
    const code = '<div id="shared-widget"></div><script>var widgetOptions = {target: "shared-widget"};</script><script src="/fixture-singleton.js"></script>';
    await saveAds(Object.fromEntries(['top', 'search', 'result', 'footer', 'left', 'right'].map((key) => [key, {
        enabled: true, type: 'html', mode: 'auto', code,
    }])));
    await page.goto(server.url);
    for (const id of ['adTop', 'adSearch', 'adFooter', 'adLeft', 'adRight']) {
        await expect(page.frameLocator(`#${id} .ad-frame`).locator('#shared-widget')).toHaveText('Repeated banner');
    }
    await expect(page.locator('#adResult')).toHaveAttribute('data-ad-status', 'pending');
    await page.locator('#ipInput').fill('8.8.8.8');
    await page.locator('#btnSearch').click();
    await expect(page.frameLocator('#adResult .ad-frame').locator('#shared-widget')).toHaveText('Repeated banner');
    await page.locator('#btnSearch').click();
    for (const id of ['adTop', 'adSearch', 'adResult', 'adFooter', 'adLeft', 'adRight']) {
        expect(await page.frameLocator(`#${id} .ad-frame`).locator('#shared-widget').count()).toBe(1);
    }
});

test('duplicate legacy async loaders keep parser document.write and global options isolated', async ({ page }) => {
    await page.route('**/fixture-async-write.js', (route) => route.fulfill({
        contentType: 'application/javascript',
        body: 'document.write("<b id=legacy-copy>" + atOptions.label + "</b>");',
    }));
    const code = '<script>var atOptions = {label: "Independent legacy"};</script><script async src="/fixture-async-write.js"></script>';
    await saveAds({ top: { enabled: true, code }, search: { enabled: true, code } });
    await page.goto(server.url);
    for (const id of ['adTop', 'adSearch']) {
        await expect(page.frameLocator(`#${id} .ad-frame`).locator('#legacy-copy')).toHaveText('Independent legacy');
        await expect(page.locator(`#${id}`)).toHaveAttribute('data-ad-frame-reason', 'repeated-code');
    }
    expect(await page.evaluate(() => window.atOptions)).toBeUndefined();
    await expect(page.locator('#ipInput')).toBeVisible();
});

test('identical pure JavaScript can reuse top-level constants in separate slot globals', async ({ page }) => {
    const code = 'const bannerLabel = "JS copy"; document.currentScript.insertAdjacentHTML("beforebegin", "<b id=js-copy>" + bannerLabel + "</b>");';
    await saveAds(Object.fromEntries(['top', 'search', 'footer'].map((key) => [key, {
        enabled: true, code, type: 'javascript', mode: 'auto',
    }])));
    await page.goto(server.url);
    for (const id of ['adTop', 'adSearch', 'adFooter']) {
        await expect(page.frameLocator(`#${id} .ad-frame`).locator('#js-copy')).toHaveText('JS copy');
        await expect(page.locator(`#${id}`)).toHaveAttribute('data-ad-status', 'loaded');
    }
});

test('repeated native async widget snippets keep a script-before-container layout working', async ({ page }) => {
    await page.route('**/fixture-native-widget.js', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        await route.fulfill({
            contentType: 'application/javascript',
            body: 'var target = document.getElementById("native-container"); if (!target) throw new Error("native target missing"); target.textContent = "Native banner";',
        });
    });
    const code = '<script async data-cfasync="false" src="/fixture-native-widget.js"></script><div id="native-container"></div>';
    await saveAds({ top: { enabled: true, code }, search: { enabled: true, code } });
    await page.goto(server.url);
    for (const id of ['adTop', 'adSearch']) {
        await expect(page.frameLocator(`#${id} .ad-frame`).locator('#native-container')).toHaveText('Native banner');
        await expect(page.locator(`#${id}`)).toHaveAttribute('data-ad-status', 'loaded');
    }
});

test('auto mode preserves repeated main-page SDK snippets and explicit inline mode', async ({ page }) => {
    const modern = '<ins class="adsbygoogle"></ins><script>window.adsbygoogle = window.adsbygoogle || []; window.adsbygoogle.push({}); document.currentScript.parentElement.querySelector("ins").textContent = "Modern SDK";</script>';
    const inline = 'window.pageAdCount = (window.pageAdCount || 0) + 1; document.currentScript.insertAdjacentHTML("beforebegin", "<b>Explicit page code</b>");';
    await saveAds({
        top: { enabled: true, code: modern, mode: 'auto' },
        search: { enabled: true, code: modern, mode: 'auto' },
        footer: { enabled: true, code: inline, type: 'javascript', mode: 'inline' },
        result: { enabled: true, code: inline, type: 'javascript', mode: 'inline' },
    });
    await page.goto(server.url);
    for (const id of ['adTop', 'adSearch']) {
        await expect(page.locator(`#${id} ins`)).toHaveText('Modern SDK');
        await expect(page.locator(`#${id}`)).toHaveAttribute('data-ad-mode', 'inline');
        await expect(page.locator(`#${id} .ad-frame`)).toHaveCount(0);
    }
    expect(await page.evaluate(() => window.adsbygoogle.length)).toBe(2);
    await page.locator('#ipInput').fill('8.8.8.8');
    await page.locator('#btnSearch').click();
    await expect(page.locator('#adResult b')).toHaveText('Explicit page code');
    expect(await page.evaluate(() => window.pageAdCount)).toBe(2);
});

test('disabled duplicate configurations do not isolate an otherwise unique page snippet', async ({ page }) => {
    const code = 'window.uniqueAdReady = true; document.currentScript.insertAdjacentHTML("beforebegin", "<b>Unique page ad</b>");';
    await saveAds({
        top: { enabled: true, code, type: 'javascript', mode: 'auto' },
        left: { enabled: false, code, type: 'javascript', mode: 'auto' },
        result: { enabled: false, code, type: 'javascript', mode: 'auto' },
    });
    await page.goto(server.url);
    await expect(page.locator('#adTop b')).toHaveText('Unique page ad');
    await expect(page.locator('#adTop')).toHaveAttribute('data-ad-mode', 'inline');
    expect(await page.evaluate(() => window.uniqueAdReady)).toBeTruthy();
});

test('side advertising waits for desktop space, stays outside content, and closes independently', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const code = '<div id=side-widget style="height:600px">Side banner</div><script>window.sideRuns = (window.sideRuns || 0) + 1;</script>';
    await saveAds({ left: { enabled: true, code }, right: { enabled: true, code } });
    await page.goto(server.url);
    for (const id of ['adLeft', 'adRight']) {
        await expect(page.locator(`#${id}`)).toHaveAttribute('data-ad-status', 'pending');
        await expect(page.locator(`#${id} .ad-frame`)).toHaveCount(0);
    }
    for (const width of [1280, 1499]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(page.locator('#adSidebarLeft')).toBeHidden();
        await expect(page.locator('#adSidebarRight')).toBeHidden();
        await expect(page.locator('#adLeft .ad-frame')).toHaveCount(0);
    }
    for (const width of [1500, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        for (const id of ['adLeft', 'adRight']) {
            await expect(page.frameLocator(`#${id} .ad-frame`).locator('#side-widget')).toHaveText('Side banner');
            await expect(page.locator(`#${id}`)).toHaveAttribute('data-ad-status', 'loaded');
        }
        const left = await page.locator('#adSidebarLeft').boundingBox();
        const right = await page.locator('#adSidebarRight').boundingBox();
        const main = await page.locator('.app-container').boundingBox();
        expect(left.x).toBeGreaterThanOrEqual(0);
        expect(left.x + left.width).toBeLessThan(main.x);
        expect(right.x).toBeGreaterThan(main.x + main.width);
        expect(right.x + right.width).toBeLessThanOrEqual(width);
    }
    await page.locator('[data-ad-close="adLeft"]').click();
    await expect(page.locator('#adSidebarLeft')).toBeHidden();
    await expect(page.locator('#adLeft')).toHaveAttribute('data-ad-status', 'dismissed');
    await expect(page.locator('#adLeft .ad-frame')).toHaveCount(0);
    await expect(page.locator('#adSidebarRight')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#adSidebarRight')).toBeHidden();
    await page.setViewportSize({ width: 1920, height: 900 });
    await expect(page.locator('#adSidebarLeft')).toBeHidden();
    await expect(page.locator('#adSidebarRight')).toBeVisible();
    await page.locator('#langSelect').selectOption('zh');
    await page.locator('#themeToggle').click();
    await expect(page.locator('#adSidebarLeft')).toBeHidden();
    await expect(page.locator('#adSidebarRight')).toBeVisible();
    const frame = await page.locator('#adRight .ad-frame').elementHandle();
    const content = await frame.contentFrame();
    expect(await content.evaluate(() => window.sideRuns)).toBe(1);
});

test('administrator saves and reloads both side slots then applies repeated code in separate frames', async ({ page }) => {
    await page.goto(`${server.url}/admin`);
    await page.locator('#loginPassword').fill(PASSWORD);
    await page.locator('#loginForm').evaluate((form) => form.requestSubmit());
    await expect(page.locator('#adminApp')).toBeVisible();
    await page.locator('[data-tab="ads"]').click();
    const code = '<div id=saved-side style="height:200px">Saved side</div><script>var widgetInitialized = true;</script>';
    for (const key of ['Left', 'Right']) {
        await page.locator(`#ad${key}Enabled`).check();
        await page.locator(`#ad${key}Code`).fill(code);
        await page.locator(`#ad${key}Mode`).selectOption('auto');
    }
    await page.locator('#btnSave').click();
    await expect(page.locator('#saveStatus')).toContainText('保存成功');
    await page.reload();
    await page.locator('[data-tab="ads"]').click();
    for (const key of ['Left', 'Right']) {
        await expect(page.locator(`#ad${key}Enabled`)).toBeChecked();
        await expect(page.locator(`#ad${key}Code`)).toHaveValue(code);
    }
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(server.url);
    for (const id of ['adLeft', 'adRight']) {
        await expect(page.frameLocator(`#${id} .ad-frame`).locator('#saved-side')).toHaveText('Saved side');
    }
});
