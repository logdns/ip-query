const { defineConfig } = require('@playwright/test');
const fs = require('node:fs');

const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    || (process.platform === 'darwin' && fs.existsSync(macChrome) ? macChrome : undefined);

module.exports = defineConfig({
    testDir: './test/browser',
    workers: 1,
    use: { headless: true, launchOptions: executablePath ? { executablePath } : {} },
});
