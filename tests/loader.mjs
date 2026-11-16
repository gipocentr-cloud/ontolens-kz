/** Загрузчик hosting/index.html: берёт коммит из GitHub API и сборку из jsDelivr (сеть подменяется локальными файлами). */
import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
import { readFileSync } from 'node:fs';
const html = readFileSync('hosting/index.html', 'utf8').replace("'OWNER/REPO'", "'test/ontolens-kz'");
const b = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage();
const seen = [];
await p.route('https://onto.buildingsmart.kz/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
await p.route('https://api.github.com/**', (r) => { seen.push(r.request().url()); r.fulfill({ body: 'abc123def\n' }); });
await p.route('https://cdn.jsdelivr.net/**', (r) => {
  const u = r.request().url(); seen.push(u);
  const f = u.endsWith('config.js') ? 'dist/config.js' : 'dist/platform.js';
  r.fulfill({ contentType: 'application/javascript; charset=utf-8', body: readFileSync(f, 'utf8') });
});
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('https://onto.buildingsmart.kz/');
await p.waitForSelector('.gbtn', { timeout: 15000 });
const ok = seen.some((u) => u.includes('@abc123def/dist/platform.js')) && !errs.length;
console.log(JSON.stringify({ ok, seen, errs }, null, 1));
await b.close();
if (!ok) process.exit(1);
