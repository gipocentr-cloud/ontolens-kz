/**
 * Приёмочный прогон в headless-Chromium.
 * Открывает dist/index.html с диска (file://), загружает демонаборы,
 * снимает скриншоты и вытаскивает числа диагностики для сверки с rdflib.
 */
import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tests', 'out');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const console_ = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console_.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => console_.push('[pageerror] ' + e.message));

const url = pathToFileURL(join(ROOT, 'dist/index.html')).href;
await page.goto(url);
await page.waitForSelector('.startcard', { timeout: 10000 });
await page.screenshot({ path: join(OUT, '01-start.png') });

// ---- демонабор GeodeticOnt-KZ --------------------------------------------
const t0 = Date.now();
await page.getByRole('button', { name: /Загрузить демонабор/ }).click();
await page.waitForSelector('.card h1', { timeout: 15000 });
const loadWall = Date.now() - t0;
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, '02-expert-geodeticont.png') });

const dump = async () => page.evaluate(() => {
  const S = window.__ontolens.state;
  return {
    files: S.files,
    triples: S.model.tripleCount,
    loadMs: S.model.loadMs,
    classes: S.model.classes.length,
    terms: S.model.classes.filter((e) => e.isTerm).length,
    collections: S.model.collections.length,
    collectionSizes: S.model.collections.map((c) => c.members.length),
    roots: S.model.roots.map((r) => r.local),
    checks: S.checks.map((c) => ({ id: c.id, n: c.count, sev: c.severity })),
    metrics: S.metrics.map((m) => ({ id: m.id, v: String(m.value), target: m.target, match: m.match })),
    parseErrors: S.model.parseErrors,
  };
});
const geo = await dump();
geo.loadWallMs = loadWall;

// диагностика
await page.getByRole('tab', { name: 'Диагностика' }).click();
await page.waitForSelector('.explain h2');
await page.screenshot({ path: join(OUT, '03-diagnostics-geodeticont.png') });

// карточка термина с SHACL
await page.getByRole('tab', { name: 'Термины' }).click();
await page.fill('#ol-search', 'предельное отклонение');
await page.waitForTimeout(250);
await page.locator('.left .row').first().click();
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, '04-term-card-shacl.png') });
const cardTitle = await page.locator('.card h1').innerText();

// 1) поиск по казахской метке без диакритики (қ→к, і→и) — строгий режим
await page.fill('#ol-search', 'геодезиялык тирек');
await page.waitForTimeout(200);
const foldMatch = await page.locator('.left .row').count();
// 2) поиск с настоящей опечаткой — только нестрогий режим
await page.fill('#ol-search', 'триангуляцыя');
await page.waitForTimeout(200);
const strict = await page.locator('.left .row').count();
await page.locator('.searchmeta input[type=checkbox]').check();
await page.waitForTimeout(250);
const fuzzy = await page.locator('.left .row').count();
await page.screenshot({ path: join(OUT, '05-fuzzy-search.png') });

// экспорт SVG
await page.fill('#ol-search', '');
await page.waitForTimeout(150);
await page.evaluate(() => { const S = window.__ontolens.state; window.__pick = S.model.classes.find((e) => e.local === 'LimitDeviation').iri; });
await page.evaluate(() => window.__ontolens.select(window.__pick));
await page.waitForTimeout(400);
const dl = page.waitForEvent('download');
await page.getByRole('button', { name: 'SVG', exact: true }).click();
const download = await dl;
const svgPath = join(OUT, 'fragment.svg');
await download.saveAs(svgPath);
const svgText = readFileSync(svgPath, 'utf8');

// экспорт METRICS.md и defects.csv
await page.getByRole('tab', { name: 'Диагностика' }).click();
await page.waitForSelector('.explain h2');
const dl2 = page.waitForEvent('download');
await page.getByRole('button', { name: /METRICS/ }).click();
await (await dl2).saveAs(join(OUT, 'METRICS.md'));
const dl3 = page.waitForEvent('download');
await page.getByRole('button', { name: /дефектах/ }).click();
await (await dl3).saveAs(join(OUT, 'defects.csv'));

// ---- дефектный набор GeOnt-KZ --------------------------------------------
await page.evaluate(async () => {
  const mod = await window.__ontolens.loadLegacy();
  return mod;
});
await page.waitForTimeout(600);
await page.screenshot({ path: join(OUT, '06-diagnostics-geont.png') });
const legacy = await dump();

// ---- нагрузочный набор: 5 000 классов / 50 084 триплета --------------------
await page.evaluate(() => { document.querySelector('.topbar input[type=file]').classList.remove('sr'); });
const t1 = Date.now();
await page.setInputFiles('.topbar input[type=file]', join(ROOT, 'tests/stress-5000.ttl'));
await page.waitForFunction(() => window.__ontolens.state.model
  && window.__ontolens.state.model.tripleCount > 40000, null, { timeout: 60000 });
const stressWall = Date.now() - t1;
const stress = await page.evaluate(() => ({
  triples: window.__ontolens.state.model.tripleCount,
  classes: window.__ontolens.state.model.classes.length,
  loadMs: window.__ontolens.state.model.loadMs,
}));
stress.wallMs = stressWall;
await page.waitForTimeout(300);
await page.screenshot({ path: join(OUT, '07-stress-5000.png') });

await browser.close();

const report = { geodeticont: geo, legacy, stress, console: console_, cardTitle,
  search: { foldMatch, strict, fuzzy },
  svg: { bytes: svgText.length, hasText: /<text/.test(svgText), textNodes: (svgText.match(/<text/g) || []).length } };
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2).slice(0, 200));
console.log('\nOK, отчёт: tests/out/report.json');
