/** Перенос оценок на новую версию онтологии (переименованный термин сопоставляется по номеру строки). */
import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const b = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(pathToFileURL(join(ROOT, 'dist/index.html')).href + '?demo');
await p.waitForSelector('.card h1');
await p.fill('#rv-expert', 'Перенос П. П.');
const first = [];
for (let i = 0; i < 3; i++) {
  first.push(await p.evaluate(() => window.__ontolens.state.selected));
  await p.locator('.card h1').click(); await p.keyboard.press(String(i + 1 === 3 ? 4 : i + 1));
  if (i === 1) await p.fill('#rv-comment', 'проверка переноса');
  await p.keyboard.press('Control+Enter'); await p.waitForTimeout(100);
}
// новая версия онтологии: первый термин переименован, номер строки прежний
await p.evaluate(() => { document.querySelector('.topbar input[type=file]').classList.remove('sr'); });
const dir = join(ROOT, 'tests/fixtures/v2');
await p.setInputFiles('.topbar input[type=file]', ['demo-geodeticont-kz.ttl', 'demo-geodeticont-kz-docs.ttl', 'demo-geodeticont-kz-shapes.ttl'].map((f) => join(dir, f)));
await p.waitForFunction(() => window.__ontolens.state.files[0] === 'demo-geodeticont-kz.ttl' && document.querySelector('.card h1'));
await p.waitForTimeout(400);
const banner = await p.locator('.rv-carry').count();
const before = await p.evaluate(() => Object.keys(window.__ontolens.state.review.items).length);
await p.screenshot({ path: join(ROOT, 'tests/out/27-carry-banner.png') });
await p.getByRole('button', { name: 'Перенести' }).click();
await p.waitForTimeout(300);
const r = await p.evaluate((first) => {
  const S = window.__ontolens.state;
  const items = S.review.items;
  return { count: Object.keys(items).length, flash: (document.querySelector('.rv-flash') || {}).textContent,
    renamedCarried: !!items['http://ontogeo.kz/geodeticont-kz#ReferenceStationRenamed'],
    oldIriGone: !items[first[0]], expert: S.review.expert };
}, first);
const out = { reviewedFirst: first, bannerShown: banner === 1, reviewsBeforeCarry: before, ...r, console: errs };
writeFileSync(join(ROOT, 'tests/out/report4.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await b.close();
