/**
 * Приёмочный прогон разделов 5.3 и 5.4 (карта, семантический зум, оценки).
 * Сценарий раздела 9 ТЗ: эксперт оценивает 20 терминов, выгружает CSV,
 * автор вливает его скриптом review2master.py без ручных правок.
 */
import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const { chromium } = pw;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tests', 'out');
mkdirSync(OUT, { recursive: true });
const R = { console: [] };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') R.console.push(m.text()); });
page.on('pageerror', (e) => R.console.push('pageerror: ' + e.message));
const url = pathToFileURL(join(ROOT, 'dist/index.html')).href;

await page.goto(url + '?demo');
await page.waitForSelector('.card h1');
await page.waitForTimeout(700);

// ------------------------------------------------------------ 5.3 карта: построение
R.map = await page.evaluate(() => {
  const S = window.__ontolens.state, mm = window.__ontolens.testHooks.minimap();
  return { source: S.mapInfo.source, layoutMs: S.mapInfo.ms, rasterMs: mm.stats.buildMs,
    islands: S.mapInfo.layout.islands.length, nodes: Object.keys(S.mapInfo.layout.nodes).length };
});
const layoutBefore = await page.evaluate(() => JSON.stringify(window.__ontolens.state.mapInfo.layout));

// ------------------------------------------------------------ 5.3 зум: время приближения
R.zoomInMs = await page.evaluate(() => window.__ontolens.state.lastZoomMs);
R.zoomK = await page.evaluate(() => window.__ontolens.state.graphTransform.k);
// Esc возвращает прежний масштаб
const kBefore = R.zoomK;
await page.locator('.graphviewport').click({ position: { x: 20, y: 60 } });
await page.keyboard.press('Escape');
await page.waitForTimeout(450);
R.escK = await page.evaluate(() => window.__ontolens.state.graphTransform.k);
R.escReturned = R.escK < kBefore;

// четыре уровня детализации
R.lod = [];
for (const [k, name] of [[0.3, 'far'], [0.6, 'mid'], [1.2, 'near'], [2.0, 'max']]) {
  await page.evaluate((kk) => window.__ontolens.testHooks.graph().setK(kk), k);
  await page.waitForTimeout(260);
  const info = await page.evaluate(() => {
    const svg = document.querySelector('.ol-graph');
    const lv = svg.getAttribute('data-lod');
    const vis = svg.querySelector(`.ol-node-focus .lod-${lv}`);
    return { lod: lv, text: vis ? vis.textContent.slice(0, 220) : '', opacity: vis ? getComputedStyle(vis).opacity : null };
  });
  R.lod.push({ k, name, ...info });
  const box = await page.locator('.graphbox').boundingBox();
  await page.screenshot({ path: join(OUT, `20-lod-${name}.png`), clip: box });
}

// ------------------------------------------------------------ 5.4 сценарий: 20 оценок
await page.evaluate(() => window.__ontolens.testHooks.graph().resetView());
await page.fill('#rv-expert', 'Тестов Б. Ж.');
const t0 = Date.now();
const plan = ['1', '1', '2', '1', '1', '3', '1', '4', '1', '2', '1', '1', '5', '1', '2', '1', '1', '1', '2', '1'];
const iris = [];
for (let i = 0; i < plan.length; i++) {
  iris.push(await page.evaluate(() => window.__ontolens.state.selected));
  await page.locator('.card h1').click();          // фокус вне полей ввода
  await page.keyboard.press(plan[i]);
  if (plan[i] === '2') {
    if (i === 2) await page.fill('#rv-def', 'уточнённое определение, предложенное экспертом при проверке');
    if (i === 9) await page.fill('#rv-label-kk', 'түзетілген белгі');
    if (i === 14) await page.fill('#rv-comment', 'родитель выбран неверно');
    if (i === 18) await page.fill('#rv-parent', 'ControlNetwork');
  }
  if (plan[i] === '5') {
    await page.fill('#rv-dup', 'GeodeticControlNetwork');
  }
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(80);
}
R.scenarioMs = Date.now() - t0;
R.progress = await page.locator('.progress-chip').innerText();
R.saved = await page.evaluate(() => Object.keys(window.__ontolens.state.review.items).length);
await page.screenshot({ path: join(OUT, '21-after-20-reviews.png') });

// окраска карты изменилась сразу после оценок
R.mapProgress = await page.evaluate(() => {
  const mm = window.__ontolens.testHooks.minimap();
  return mm.progress.map((p) => `${p.done}/${p.total}`).filter((x) => !x.startsWith('0/')).join(' ');
});

// попытка сохранить «дұрыс» в поле исправления
await page.locator('label.rv-fix').click();
await page.fill('#rv-label-kk', 'дұрыс');
await page.getByRole('button', { name: 'Сохранить и далее' }).click();
await page.waitForTimeout(150);
R.confirmWordBlocked = /дұрыс/.test(await page.locator('.rv-flash').innerText());
await page.fill('#rv-label-kk', '');

// экспорт CSV и JSON
let dl = page.waitForEvent('download');
await page.locator('.rv-foot').getByRole('button', { name: 'CSV' }).click();
let d = await dl; const csvName = d.suggestedFilename(); await d.saveAs(join(OUT, csvName));
dl = page.waitForEvent('download');
await page.locator('.rv-foot').getByRole('button', { name: 'JSON' }).click();
d = await dl; const jsonName = d.suggestedFilename(); await d.saveAs(join(OUT, jsonName));
R.export = { csv: csvName, json: jsonName, csvHead: readFileSync(join(OUT, csvName), 'utf8').split(/\r?\n/)[0].replace(/^﻿/, '') };

// ------------------------------------------------------------ 5.3 стабильность карты
// двадцать переходов уже были; сравниваем с исходной раскладкой и с пересчётом с нуля
const layoutAfter = await page.evaluate(() => JSON.stringify(window.__ontolens.state.mapInfo.layout));
const recomputed = await page.evaluate(() => JSON.stringify(window.__ontolens.testHooks.recomputeMapLayout()));
// смена языка не должна двигать карту
await page.locator('.topbar .seg button', { hasText: 'KK' }).first().click();
await page.waitForTimeout(200);
const layoutKk = await page.evaluate(() => JSON.stringify(window.__ontolens.testHooks.recomputeMapLayout()));
await page.locator('.topbar .seg button', { hasText: 'RU' }).first().click();
// перезагрузка страницы: раскладка берётся из кэша и совпадает побайтно
await page.reload();
await page.waitForSelector('.card h1');
await page.waitForTimeout(500);
const reloaded = await page.evaluate(() => ({ source: window.__ontolens.state.mapInfo.source,
  json: JSON.stringify(window.__ontolens.state.mapInfo.layout),
  reviewsKept: Object.keys(window.__ontolens.state.review.items).length }));
R.stability = {
  after20: layoutAfter === layoutBefore,
  recomputed: recomputed === layoutBefore,
  languageSwitch: layoutKk === layoutBefore,
  reloadSource: reloaded.source,
  reload: reloaded.json === layoutBefore,
  bytes: layoutBefore.length,
  reviewsKeptAfterReload: reloaded.reviewsKept,
};
writeFileSync(join(OUT, 'map-layout.json'), layoutBefore);

// отметка, путь, рамка соответствуют выбранной сущности
R.marker = await page.evaluate(() => {
  const S = window.__ontolens.state, mm = window.__ontolens.testHooks.minimap();
  const e = S.model.entities.get(S.selected);
  const parent = e.parents.find((p) => S.model.entities.get(p) && !S.model.entities.get(p).external);
  return { focusMatches: mm.focus === S.selected, pathStartsAtFocus: mm.pathIris[0] === S.selected,
    pathSecondIsParent: mm.pathIris[1] === parent, frameHasFocusOrVisible: mm.frameIris.length > 0,
    markerDrawn: !!document.querySelector('.mm-here') };
});

// перетаскивание рамки: частота кадров и переход к ближайшему термину
await page.evaluate(() => { const mm = window.__ontolens.testHooks.minimap(); mm.stats.frames = 0; });
const fr = await page.locator('.mm-frame').boundingBox();
const before = await page.evaluate(() => window.__ontolens.state.selected);
const tDrag = Date.now();
await page.mouse.move(fr.x + fr.width / 2, fr.y + fr.height / 2);
await page.mouse.down();
for (let i = 1; i <= 30; i++) await page.mouse.move(fr.x + fr.width / 2 + i * 3, fr.y + fr.height / 2 + i * 2);
await page.mouse.up();
const dragMs = Date.now() - tDrag;
await page.waitForTimeout(300);
const frames = await page.evaluate(() => window.__ontolens.testHooks.minimap().stats.frames);
R.frameDrag = { moves: 30, ms: dragMs, fps: Math.round(30 / (dragMs / 1000)), framesDrawn: frames,
  navigated: (await page.evaluate(() => window.__ontolens.state.selected)) !== before };
await page.screenshot({ path: join(OUT, '22-after-frame-drag.png') });

// развернуть карту на половину экрана
await page.keyboard.press('Escape');
await page.locator('.minimap .mm-btn[aria-label^="Развернуть"]').click();
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, '23-map-expanded.png') });
await page.locator('.minimap .mm-btn[aria-label^="Вернуть"]').click();

// ------------------------------------------------------------ 5.4 роль автора: второй эксперт и сводка
const csv1 = readFileSync(join(OUT, csvName), 'utf8');
const lines = csv1.replace(/^﻿/, '').trim().split(/\r?\n/);
const head = lines[0].split(';');
const vi = head.indexOf('verdict'), ei = head.indexOf('expert');
const second = [lines[0], ...lines.slice(1).map((l, i) => {
  const c = l.split(';');
  if (i % 4 === 0) c[vi] = c[vi] === 'Верно' ? 'Исправить' : 'Верно';
  c[ei] = 'Второй Э. К.';
  return c.join(';');
})].join('\r\n');
const secondName = 'review-vtoroy-e-k-' + csvName.slice(-10);
writeFileSync(join(OUT, secondName), '﻿' + second + '\r\n');
await page.getByRole('tab', { name: 'Замечания' }).click();
await page.setInputFiles('.left input[type=file]', [join(OUT, secondName)]);
await page.waitForTimeout(400);
await page.locator('.seg.light button', { hasText: 'Расхождения' }).click();
await page.waitForTimeout(200);
R.author = await page.evaluate(() => ({
  sources: document.querySelectorAll('.left .check').length,
  rows: document.querySelectorAll('.center .table .td').length,
  kappa: [...document.querySelectorAll('.right .kv .r')].map((r) => r.innerText.replace(/\n/g, ' ')).find((t) => /κ/.test(t)),
  agreement: [...document.querySelectorAll('.right .kv .r')].map((r) => r.innerText.replace(/\n/g, ' ')).find((t) => /согласие/.test(t)),
}));
await page.screenshot({ path: join(OUT, '24-author-reviews.png') });

// ------------------------------------------------------------ карта на других наборах
await page.evaluate(() => window.__ontolens.loadLegacy());
await page.waitForTimeout(500);
R.mapLegacy = await page.evaluate(() => ({ ms: window.__ontolens.state.mapInfo.ms, source: window.__ontolens.state.mapInfo.source,
  raster: window.__ontolens.testHooks.minimap().stats.buildMs, nodes: Object.keys(window.__ontolens.state.mapInfo.layout.nodes).length,
  islands: window.__ontolens.state.mapInfo.layout.islands.length }));
await page.evaluate(() => { document.querySelector('.topbar input[type=file]').classList.remove('sr'); });
await page.setInputFiles('.topbar input[type=file]', join(ROOT, 'tests/stress-5000.ttl'));
await page.waitForFunction(() => window.__ontolens.state.model && window.__ontolens.state.model.tripleCount > 40000, null, { timeout: 60000 });
await page.waitForTimeout(600);
R.mapStress = await page.evaluate(() => ({ ms: window.__ontolens.state.mapInfo.ms, source: window.__ontolens.state.mapInfo.source,
  raster: window.__ontolens.testHooks.minimap().stats.buildMs, nodes: Object.keys(window.__ontolens.state.mapInfo.layout.nodes).length }));
await page.screenshot({ path: join(OUT, '25-stress-map.png') });
await browser.close();

// ------------------------------------------------------------ влив в мастер-таблицу скриптом
copyFileSync(join(ROOT, 'data/demo-master.xlsx'), join(OUT, 'master.xlsx'));
const py = execFileSync('python3', [join(ROOT, 'review2master.py'), join(OUT, 'master.xlsx'),
  join(OUT, csvName), join(OUT, secondName), '-o', join(OUT, 'master.reviewed.xlsx')], { encoding: 'utf8' });
R.review2master = py.trim().split('\n')[0];
const check = execFileSync('python3', ['-c', `
from openpyxl import load_workbook
ws = load_workbook(r'${join(OUT, 'master.reviewed.xlsx')}')['terms']
h = [c.value for c in ws[1]]
vc = [x for x in h if str(x).startswith('verdict_')]
filled = {c: sum(1 for r in range(2, ws.max_row + 1) if ws.cell(r, h.index(c) + 1).value) for c in vc}
rev = sum(1 for r in range(2, ws.max_row + 1) if ws.cell(r, h.index('def_ru_revised') + 1).value is True)
print(filled, 'def_ru_revised=', rev)
`], { encoding: 'utf8' });
R.masterCheck = check.trim();

writeFileSync(join(OUT, 'report2.json'), JSON.stringify(R, null, 2));
console.log(JSON.stringify(R, null, 2));
