const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { DEFAULT_SETTINGS } = require('../../lib/settings');

const PASSWORD = 'ads-test-password';

async function startServer() {
    const root = path.resolve(__dirname, '../..');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ip-query-ads-'));
    for (const name of ['server.js', 'package.json', 'lib', 'public']) {
        fs.cpSync(path.join(root, name), path.join(dir, name), { recursive: true });
    }
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
    fs.mkdirSync(path.join(dir, 'data'));
    const initial = structuredClone(DEFAULT_SETTINGS);
    initial.admin.password = PASSWORD;
    fs.writeFileSync(path.join(dir, 'data/settings.json'), JSON.stringify(initial));
    const port = await new Promise((resolve, reject) => {
        const listener = net.createServer();
        listener.on('error', reject);
        listener.listen(0, '127.0.0.1', () => {
            const assigned = listener.address().port;
            listener.close(() => resolve(assigned));
        });
    });
    const child = spawn(process.execPath, ['server.js'], {
        cwd: dir,
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const stop = async () => {
        if (child.exitCode === null && child.signalCode === null) {
            await new Promise((resolve) => {
                child.once('exit', resolve);
                child.kill();
            });
        }
        fs.rmSync(dir, { recursive: true, force: true });
    };
    const url = `http://127.0.0.1:${port}`;
    try {
        for (let i = 0; i < 100; i++) {
            if (child.exitCode !== null) throw new Error(output);
            try {
                const res = await fetch(`${url}/api/ads`);
                if (res.ok) break;
            } catch { /* Wait for the isolated server to listen. */ }
            if (i === 99) throw new Error(`Test server did not start: ${output}`);
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const login = await fetch(`${url}/api/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: PASSWORD }),
        });
        const { token } = await login.json();
        if (!token) throw new Error('Test administrator login failed');
        const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
        return { url, dir, token, headers, stop, initial };
    } catch (error) {
        await stop();
        throw error;
    }
}

module.exports = { startServer, PASSWORD };
