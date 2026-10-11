(function () {
    'use strict';

    const slots = new Map();
    const SLOT_KEYS = ['top', 'search', 'result', 'footer', 'left', 'right'];
    const SCRIPT_TIMEOUT = 15000;
    let scriptSequence = 0;

    function setStatus(el, status, message = '') {
        if (el.dataset.adStatus === 'dismissed' && status !== 'dismissed') return;
        el.dataset.adStatus = status;
        if (message) el.dataset.adError = message;
        else delete el.dataset.adError;
        if (status === 'error') console.warn(`[Ads:${el.id}] ${message}`);
    }

    function markup(ad) {
        if (ad.type !== 'javascript') return ad.code;
        return `<script>${ad.code.replace(/<\/script/gi, '<\\/script')}</script>`;
    }

    function isPageSdk(ad) {
        return /\b(?:adsbygoogle|googletag)\b|(?:pagead2\.googlesyndication\.com|securepubads\.g\.doubleclick\.net)/i.test(ad.code);
    }

    function frameReason(ad) {
        if (ad.mode === 'iframe') return 'configured';
        if (ad.mode === 'inline') return '';
        if (/\bdocument\s*\.\s*write(?:ln)?\s*\(/i.test(ad.code)) return 'document-write';
        if (ad.repeated && !isPageSdk(ad)) return 'repeated-code';
        return '';
    }

    function findRepeatedCodes(ads) {
        const counts = new Map();
        for (const key of SLOT_KEYS) {
            const ad = ads[key];
            if (!ad?.enabled || typeof ad.code !== 'string' || !ad.code.trim()) continue;
            if (ad.type !== 'javascript' && !/<script\b/i.test(ad.code)) continue;
            const signature = JSON.stringify([ad.type || 'html', ad.code.trim()]);
            counts.set(signature, (counts.get(signature) || 0) + 1);
        }
        return counts;
    }

    function runScript(oldScript, el) {
        const script = document.createElement('script');
        for (const attr of oldScript.attributes) script.setAttribute(attr.name, attr.value);
        script.textContent = oldScript.textContent;
        const module = script.type === 'module';
        const executable = !script.type || /^(?:module|(?:text|application)\/(?:java|ecma)script)$/i.test(script.type);
        if (!executable || (!module && script.noModule && 'noModule' in script)) {
            oldScript.replaceWith(script);
            return Promise.resolve();
        }
        const external = script.hasAttribute('src');
        const sourceName = `ip-query-ad-${el.id}-${++scriptSequence}.js`;
        const completionEvent = `ip-query-ad-complete-${scriptSequence}`;
        if (!external) {
            // Inline modules execute asynchronously but do not emit a load event.
            if (module) script.textContent += `\n;document.dispatchEvent(new Event(${JSON.stringify(completionEvent)}));`;
            script.textContent += `\n//# sourceURL=${sourceName}`;
        }
        // Dynamic classic scripts are async by default; restore snippet order.
        if (external && !script.hasAttribute('async')) script.async = false;
        return new Promise((resolve) => {
            let timer;
            let finished = false;
            const finish = (error) => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                window.removeEventListener('error', onRuntimeError);
                document.removeEventListener(completionEvent, onModuleComplete);
                if (error) setStatus(el, 'error', error);
                resolve();
            };
            const onRuntimeError = (event) => {
                if (external ? event.filename === script.src : event.filename?.endsWith(sourceName)) {
                    finish(event.message || 'Ad script execution failed');
                }
            };
            const onModuleComplete = () => finish();
            window.addEventListener('error', onRuntimeError);
            if (module && !external) document.addEventListener(completionEvent, onModuleComplete, { once: true });
            script.addEventListener('load', () => finish(), { once: true });
            script.addEventListener('error', () => finish(`Script load failed: ${script.src || 'inline module'}`), { once: true });
            if (external || module) timer = setTimeout(() => finish(`Script timed out: ${script.src || 'inline module'}`), SCRIPT_TIMEOUT);
            oldScript.replaceWith(script);
            if (!external && !module) finish();
        });
    }

    async function renderInline(el, ad) {
        el.innerHTML = markup(ad);
        const pending = [];
        for (const script of el.querySelectorAll('script')) {
            const task = runScript(script, el);
            if (script.hasAttribute('async') || script.type === 'module') pending.push(task);
            else await task;
        }
        await Promise.all(pending);
        if (el.dataset.adStatus !== 'error') setStatus(el, 'loaded');
    }

    function renderFrame(el, ad) {
        const frame = document.createElement('iframe');
        frame.className = 'ad-frame';
        frame.title = `${el.id} advertisement`;
        frame.setAttribute('scrolling', 'no');
        frame.style.height = '100px';
        el.replaceChildren(frame);
        // Let the browser parse legacy document.write scripts in their own document.
        // This is compatibility isolation, not a sandbox for untrusted administrator code.
        const bridge = `<script>(function () {
            var queued = false;
            function send(data) { parent.postMessage(Object.assign({ipQueryAd: true}, data), '*'); }
            function resize() {
                if (queued) return;
                queued = true;
                requestAnimationFrame(function () {
                    queued = false;
                    send({height: Math.ceil(document.body.getBoundingClientRect().height)});
                });
            }
            addEventListener('error', function (event) {
                var target = event.target;
                if (target && target.tagName === 'SCRIPT') send({error: 'Script load failed: ' + target.src});
                else if (event.message) send({error: event.message});
            }, true);
            addEventListener('DOMContentLoaded', function () {
                resize();
                new ResizeObserver(resize).observe(document.body);
                new MutationObserver(resize).observe(document.body, {childList: true, subtree: true, attributes: true});
            });
            addEventListener('load', function () { resize(); send({loaded: true}); });
            addEventListener('resize', resize);
        })();<\/script>`;
        const base = document.baseURI.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        const content = document.createElement('template');
        content.innerHTML = markup(ad);
        const hasContainer = !!content.content.querySelector(':not(script):not(style):not(link):not(meta):not(template)');
        const parserLoader = !hasContainer || /\bdocument\s*\.\s*write(?:ln)?\s*\(|\batOptions\s*=/i.test(ad.code);
        // Legacy writers need parser order; native widgets may require their async
        // script to run only after a later container has been parsed.
        if (parserLoader) {
            for (const script of content.content.querySelectorAll('script[src]')) {
                if (script.type === 'module') continue;
                script.removeAttribute('async');
                script.removeAttribute('defer');
            }
        }
        frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${base}"><style>html{margin:0;padding:0}body{margin:0;padding:0;display:flow-root;text-align:center;overflow-wrap:anywhere}img,iframe,ins{max-width:100%}</style>${bridge}</head><body>${content.innerHTML}</body></html>`;
    }

    function renderVisible() {
        for (const [el, ad] of slots) {
            if (el.dataset.adStatus !== 'pending' || el.closest('.hidden')) continue;
            const sidebar = el.closest('.ad-sidebar');
            if (sidebar && !sidebar.getClientRects().length) continue;
            // Ad SDKs need a measurable container before they initialize.
            el.classList.remove('hidden');
            setStatus(el, 'loading');
            const reason = frameReason(ad);
            el.dataset.adMode = reason ? 'iframe' : 'inline';
            if (reason) el.dataset.adFrameReason = reason;
            if (reason) renderFrame(el, ad);
            else renderInline(el, ad).catch((err) => setStatus(el, 'error', err.message));
        }
    }

    async function init() {
        document.querySelectorAll('[data-ad-close]').forEach((button) => {
            button.addEventListener('click', () => {
                const el = document.getElementById(button.dataset.adClose);
                const sidebar = el?.closest('.ad-sidebar');
                if (!sidebar) return;
                setStatus(el, 'dismissed');
                sidebar.classList.add('hidden');
                if (el.querySelector('.ad-frame')) el.replaceChildren();
            });
        });
        window.addEventListener('message', (event) => {
            if (!event.data?.ipQueryAd) return;
            for (const el of slots.keys()) {
                const frame = el.querySelector('.ad-frame');
                if (!frame || event.source !== frame.contentWindow) continue;
                if (Number.isFinite(event.data.height)) frame.style.height = `${Math.max(1, Math.min(10000, event.data.height))}px`;
                if (event.data.error) setStatus(el, 'error', event.data.error);
                else if (event.data.loaded && el.dataset.adStatus !== 'error') setStatus(el, 'loaded');
            }
        });
        try {
            const res = await fetch('/api/ads', { cache: 'no-store' });
            if (!res.ok) throw new Error(`Ad configuration request failed: HTTP ${res.status}`);
            const ads = await res.json();
            const repeated = findRepeatedCodes(ads);
            for (const key of SLOT_KEYS) {
                const el = document.getElementById(`ad${key[0].toUpperCase()}${key.slice(1)}`);
                if (!el) continue;
                const ad = ads[key];
                const sidebar = el.closest('.ad-sidebar');
                if (!ad?.enabled || typeof ad.code !== 'string' || !ad.code.trim()) {
                    el.classList.add('hidden');
                    if (sidebar) sidebar.classList.add('hidden');
                    setStatus(el, 'disabled');
                    continue;
                }
                const signature = JSON.stringify([ad.type || 'html', ad.code.trim()]);
                // Plan every instance before any script runs, including the deferred result slot.
                slots.set(el, { ...ad, repeated: (repeated.get(signature) || 0) > 1 });
                setStatus(el, 'pending');
                el.classList.remove('hidden');
                if (sidebar) sidebar.classList.remove('hidden');
            }
            const results = document.getElementById('resultsSection');
            if (results) new MutationObserver(renderVisible).observe(results, { attributes: true, attributeFilter: ['class'] });
            window.addEventListener('resize', renderVisible);
            renderVisible();
        } catch (err) {
            console.warn('[Ads]', err.message);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
