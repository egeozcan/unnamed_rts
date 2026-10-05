/* global window */
// Renders 3D models + 2D sprites for every unit/building and copies the cameos into the docs site.
// Usage: node src/scripts/docs/render_assets.mjs   (needs Chromium via playwright-core)
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright-core')); }
catch { ({ chromium } = require('/opt/homebrew/lib/node_modules/@playwright/cli/node_modules/playwright-core')); }

const out = 'docs/site/public/img';
for (const dir of ['3d', '2d']) mkdirSync(`${out}/${dir}`, { recursive: true });
cpSync('src/assets/cameos', `${out}/cameos`, { recursive: true, filter: src => !src.endsWith('.json') });

const server = await createServer({ server: { port: 5199 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
    const page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error') console.error('[page]', m.text()); });
    page.on('pageerror', e => console.error('[pageerror]', e.message));
    await page.goto('http://localhost:5199/src/scripts/docs/render.html');
    await page.waitForFunction(() => typeof window.renderAll === 'function', null, { timeout: 60000 });
    const results = await page.evaluate(() => window.renderAll());
    const save = (path, dataUrl) => writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
    for (const [key, r] of Object.entries(results)) {
        if (r.three) save(`${out}/3d/${key}.png`, r.three);
        if (r.flat) save(`${out}/2d/${key}.png`, r.flat);
    }
    console.log(`rendered ${Object.keys(results).length} entries`);
} finally {
    await browser.close();
    await server.close();
}
