/**
 * Хранилище моделей на диске: подключение папки, направления и версии, открытие пакета одной кнопкой,
 * отчёт METRICS.md, запись оценок и выгрузок в work\ версии, перенос оценок на новую версию,
 * работа редактора корпуса в work\corpus-work.json, восстановление после перезапуска, режим «только чтение».
 *
 * Папку пользователя заменяет OPFS (тот же FileSystemDirectoryHandle): showDirectoryPicker подменён.
 * OPFS недоступен на file://, поэтому страница отдаётся с localhost; отдельная проверка — что на file://
 * есть showDirectoryPicker, IndexedDB и защищённый контекст (так открывают index.html с диска).
 *
 * Запуск: node tests/vault.mjs <папка-хранилища-с-реальными-пакетами>
 */
import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tests', 'out'); mkdirSync(OUT, { recursive: true });
const VAULT_SRC = process.argv[2] || join(ROOT, 'tests', 'fixtures', 'vault');
const R = { checks: [], console: [] };
const ok = (name, cond, extra) => { R.checks.push({ name, ok: !!cond, ...(extra !== undefined ? { extra } : {}) }); if (!cond) console.error('FAIL', name, extra ?? ''); };

// ---- манифест файлов хранилища (без zip и docx — они не нужны приложению)
const files = [];
(function walk(d) { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (!/\.(zip|docx)$/i.test(n)) files.push(relative(VAULT_SRC, p).split('\\').join('/')); } })(VAULT_SRC);

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  try {
    if (u === '/' || u === '/index.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(readFileSync(join(ROOT, 'dist/index.html'))); return; }
    if (u === '/__manifest') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(files)); return; }
    if (u.startsWith('/__vault/')) { res.writeHead(200); res.end(readFileSync(join(VAULT_SRC, u.slice('/__vault/'.length)))); return; }
  } catch (e) { /* 404 */ }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;

const browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
// подмена выбора папки: корень OPFS «OntoLens_Files»
await ctx.addInitScript(() => {
  window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('OntoLens_Files', { create: true });
});
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') R.console.push(m.text()); });
page.on('pageerror', (e) => R.console.push('pageerror: ' + e.message));
page.on('crash', () => console.log('PAGE CRASHED'));
page.on('close', () => console.log('PAGE CLOSED'));

await page.goto(BASE);
// наполнить OPFS реальными файлами хранилища + старая версия v0.1 (копия TBox) для проверки переноса
await page.evaluate(async () => {
  const list = await (await fetch('/__manifest')).json();
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('OntoLens_Files', { create: true });
  async function put(path, data) {
    const parts = path.split('/'); let d = root;
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
    const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable(); await w.write(data); await w.close();
  }
  for (const p of list) await put(p, await (await fetch('/__vault/' + p)).arrayBuffer());
  const tbox = list.find((p) => /v0\.2\.1\/timsoont-kz\.ttl$/.test(p));
  if (tbox) await put('OntoLensF_TIMSO/260930-TimsoOnt-KZ-v0.1/timsoont-kz.ttl', await (await fetch('/__vault/' + tbox)).arrayBuffer());
  return list.length;
});
await page.reload();

// 1. стартовый экран
ok('старт: блок «Хранилище моделей» и кнопка подключения', await page.getByRole('button', { name: 'Подключить хранилище' }).count() === 1);
await page.screenshot({ path: join(OUT, '80-vault-start.png') });
await page.getByRole('button', { name: 'Подключить хранилище' }).click();
await page.waitForSelector('.vver', { timeout: 20000 });
const listText = await page.locator('.vault').innerText();
ok('хранилище: направление TIMSO найдено', /TIMSO/.test(listText) && /OntoLensF_TIMSO/.test(listText), listText.slice(0, 300));
ok('хранилище: три версии, новая сверху с пометкой «последняя»', await page.locator('.vver').count() === 3 && /261116-TimsoOnt-KZ-v0\.2\.1/.test(await page.locator('.vver.latest').innerText()), await page.locator('.vver').allInnerTexts());
ok('версия: сводка из metrics.json (понятия, положения, HermiT)', /99 понятий · 596 положений · HermiT: непротиворечива/.test(listText), listText);
ok('версия: дата из имени папки', /16\.11\.2026/.test(listText));
ok('версия: кнопки «Открыть», «Коллизии», «Отчёт»', await page.locator('.vver.latest button').allInnerTexts().then((t) => t.join('|') === 'Открыть|Коллизии|Отчёт'));
await page.screenshot({ path: join(OUT, '81-vault-list.png') });
const AXE = readFileSync(join(ROOT, 'node_modules/axe-core/axe.min.js'), 'utf8');
async function axeCheck(p, name) {
  await p.addScriptTag({ content: AXE });
  const v = await p.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map((x) => x.id + ': ' + x.nodes.length));
  ok('доступность (axe, WCAG 2.1 AA): ' + name, v.length === 0, v);
}
await axeCheck(page, 'список хранилища');

// 2. отчёт
await page.locator('.vver.latest').getByRole('button', { name: 'Отчёт' }).click();
await page.waitForSelector('.md table.mdt');
const rep = await page.locator('.md').innerText();
ok('отчёт METRICS.md: заголовки и таблицы', /Состав пакета/.test(rep) && await page.locator('.md table.mdt').count() >= 3);
await page.screenshot({ path: join(OUT, '82-vault-report.png') });
await page.keyboard.press('Escape');

// 3. открыть онтологию
await page.locator('.vver.latest').getByRole('button', { name: 'Открыть' }).click();
await page.waitForSelector('.topbar', { timeout: 60000 });
const chip = await page.locator('.chip.vchip').innerText();
ok('открыто: в шапке направление и версия', /TIMSO/.test(chip) && /261116-TimsoOnt-KZ-v0\.2\.1/.test(chip), chip);
const langs = (await page.locator('.topbar .seg').first().innerText()).replace(/\s+/g, ' ').trim();
ok('открыто: подключён profile.json версии (языки ru, en)', langs === 'RU EN', langs);
const loadedFiles = await page.evaluate(() => document.querySelector('.chip.vchip').getAttribute('data-tip'));
ok('подсказка: работа сохраняется в work', /work/.test(loadedFiles), loadedFiles);
await page.screenshot({ path: join(OUT, '83-vault-open.png') });
await axeCheck(page, 'открытая версия');

// 4. оценка термина → work/review-<эксперт>.json
await page.fill('#rv-expert', 'Тестов Т.');
await page.locator('label.rv-verdict').first().click();
await page.getByRole('button', { name: 'Сохранить и далее' }).click();
await page.waitForTimeout(1200);
const rev = await page.evaluate(async () => {
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('OntoLens_Files');
  const w = await (await (await root.getDirectoryHandle('OntoLensF_TIMSO')).getDirectoryHandle('261116-TimsoOnt-KZ-v0.2.1')).getDirectoryHandle('work');
  const names = []; for await (const [n] of w.entries()) names.push(n);
  const f = await (await w.getFileHandle('review-testov-t.json')).getFile();
  return { names, json: JSON.parse(await f.text()) };
}).catch((e) => ({ err: String(e) }));
ok('оценка записана в work/review-testov-t.json (формат ontolens-review/1)', rev.json && rev.json.format === 'ontolens-review/1' && rev.json.items.length === 1 && rev.json.version === '261116-TimsoOnt-KZ-v0.2.1', rev);

// 5. выгрузка CSV ложится в work
const csvBtn = page.getByRole('button', { name: 'CSV', exact: true }).first();
if (await csvBtn.count()) {
  await csvBtn.click();
  await page.waitForTimeout(500);
  const t = await page.locator('.ol-toast').innerText().catch(() => '');
  ok('выгрузка CSV: сохранено в папку work версии', /Сохранено: OntoLensF_TIMSO\\261116-TimsoOnt-KZ-v0\.2\.1\\work\\review-testov-t-\d{6}\.csv/.test(t), t);
} else ok('выгрузка CSV: кнопка найдена', false);

// 6. назад к хранилищу: у версии видны оценки
await page.locator('button.back').click();
await page.waitForSelector('.vver');
const l2 = await page.locator('.vver.latest').innerText();
ok('после возврата: у версии «оценки: 1 файл» и отметка «открывали последней»', /оценки: 1 файл/.test(l2) && /открывали последней/.test(l2), l2);

// 7. перезапуск. Папка запоминается в IndexedDB (дескриптор). В этой сборке headless Chromium чтение
// FileSystemHandle из IndexedDB закрывает вкладку (ошибка среды; в настольном Chrome это штатный приём),
// поэтому здесь проверяется только запись ключей, а восстановление — на машине пользователя.
const keys = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('ontolens-vault', 1); r.onsuccess = () => { const q = r.result.transaction('kv').objectStore('kv').getAllKeys(); q.onsuccess = () => res(q.result); }; r.onerror = () => res(null); }));
ok('папка и последняя версия запомнены в IndexedDB (ключи root, last)', Array.isArray(keys) && keys.includes('root') && keys.includes('last'), keys);
await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('ontolens-vault', 1); r.onsuccess = () => { const t = r.result.transaction('kv', 'readwrite'); t.objectStore('kv').delete('root'); t.oncomplete = res; }; }));
await page.goto(BASE);
await page.getByRole('button', { name: 'Подключить хранилище' }).click();
await page.waitForSelector('.vver', { timeout: 20000 });
ok('после перезапуска: отметка «открывали последней» сохранилась', /открывали последней/.test(await page.locator('.vver.latest').innerText()));

// 8. новый браузер (пустой localStorage): свои оценки подтягиваются из файла по имени эксперта
await page.evaluate(() => { const ks = Object.keys(localStorage).filter((k) => k.startsWith('ontolens.review')); ks.forEach((k) => localStorage.removeItem(k)); });
await page.locator('.vver.latest').getByRole('button', { name: 'Открыть' }).click();
await page.waitForSelector('.topbar', { timeout: 60000 });
const prog = await page.locator('.progress-chip').innerText();
ok('чистый браузер: оценка восстановлена из work (прогресс 1 / N)', /^1 \//.test(prog.trim()), prog);

// 9. v0.2 — профиль в старом формате (languages — объект) открывается
await page.locator('button.back').click();
await page.waitForSelector('.vver');
await page.locator('.vver').nth(1).getByRole('button', { name: 'Открыть' }).click();
await page.waitForSelector('.topbar', { timeout: 60000 });
ok('v0.2 с профилем старого формата открывается', /261116-TimsoOnt-KZ-v0\.2$/.test((await page.locator('.chip.vchip span').innerText()).trim()));
// старая версия v0.1 без оценок: перенос с более новой не предлагается
await page.locator('button.back').click();
await page.waitForSelector('.vver');
await page.locator('.vver').nth(2).getByRole('button', { name: 'Открыть' }).click();
await page.waitForSelector('.topbar', { timeout: 60000 });
ok('старая версия v0.1 (только TBox, без профиля) открывается', /260930-TimsoOnt-KZ-v0\.1/.test(await page.locator('.chip.vchip').innerText()));
// перенос оценок с предыдущей версии из хранилища: оценки эксперта «Другой Э.» лежат в v0.2\work
await page.evaluate(async () => {
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('OntoLens_Files');
  const v = await (await root.getDirectoryHandle('OntoLensF_TIMSO')).getDirectoryHandle('261116-TimsoOnt-KZ-v0.2');
  const w = await v.getDirectoryHandle('work', { create: true });
  const src = await (await (await (await (await root.getDirectoryHandle('OntoLensF_TIMSO')).getDirectoryHandle('261116-TimsoOnt-KZ-v0.2.1')).getDirectoryHandle('work')).getFileHandle('review-testov-t.json')).getFile();
  const j = JSON.parse(await src.text()); j.expert = 'Другой Э.';
  const fw = await (await w.getFileHandle('review-drugoy-e.json', { create: true })).createWritable(); await fw.write(JSON.stringify(j)); await fw.close();
  Object.keys(localStorage).filter((k) => k.startsWith('ontolens.review')).forEach((k) => localStorage.removeItem(k));
  localStorage.setItem('ontolens.pref.expert', JSON.stringify('Другой Э.'));
});
await page.locator('button.back').click();
await page.waitForSelector('.vver');
await page.locator('.vver.latest').getByRole('button', { name: 'Открыть' }).click();
await page.waitForSelector('.topbar', { timeout: 60000 });
const carry = await page.locator('.rv-carry').innerText().catch(() => '');
ok('новая версия: предложен перенос оценок эксперта с предыдущей версии хранилища', /Другой Э\./.test(carry) && /\b1\b/.test(carry), carry);
await page.locator('.rv-carry').getByRole('button').first().click();
await page.waitForTimeout(1200);
const moved = await page.evaluate(async () => {
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('OntoLens_Files');
  const w = await (await (await root.getDirectoryHandle('OntoLensF_TIMSO')).getDirectoryHandle('261116-TimsoOnt-KZ-v0.2.1')).getDirectoryHandle('work');
  try { return JSON.parse(await (await (await w.getFileHandle('review-drugoy-e.json')).getFile()).text()).items.length; } catch (e) { return 0; }
});
ok('после переноса оценки записаны в work новой версии', moved === 1, moved);

// 10. корпус: коллизии; работа редактора → work/corpus-work.json
await page.locator('button.back').click();
await page.waitForSelector('.vver');
await page.locator('.vver.latest').getByRole('button', { name: 'Коллизии' }).click();
await page.waitForSelector('.cx-stats', { timeout: 30000 });
ok('коллизии: корпус из corpus/*.csv открыт', await page.getByRole('tab', { name: /Коллизии/ }).getAttribute('aria-selected') === 'true');
await page.getByRole('tab', { name: 'Аксиомы' }).click();
await page.locator('details.cx-new summary', { hasText: '+ класс' }).click();
await page.locator('details.cx-new[open] .cx-inline input').first().fill('цифровое представление');
await page.getByRole('button', { name: 'Добавить класс' }).click();
await page.waitForTimeout(700);
const cw = await page.evaluate(async () => {
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('OntoLens_Files');
  const w = await (await (await root.getDirectoryHandle('OntoLensF_TIMSO')).getDirectoryHandle('261116-TimsoOnt-KZ-v0.2.1')).getDirectoryHandle('work');
  return JSON.parse(await (await (await w.getFileHandle('corpus-work.json')).getFile()).text());
}).catch((e) => ({ err: String(e) }));
ok('работа редактора записана в work/corpus-work.json', cw.work && cw.work.classes.some((c) => c.label === 'цифровое представление'), cw);
await page.screenshot({ path: join(OUT, '84-vault-corpus.png') });
// чистый localStorage → класс читается из файла
await page.locator('button.back').click();
await page.waitForSelector('.vver');
await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ontolens.work')).forEach((k) => localStorage.removeItem(k)));
await page.locator('.vver.latest').getByRole('button', { name: 'Коллизии' }).click();
await page.waitForSelector('.cx-stats');
await page.getByRole('tab', { name: 'Аксиомы' }).click();
ok('чистый браузер: структурный класс восстановлен из work/corpus-work.json', /цифровое представление/.test(await page.locator('main, .main').first().innerText()));

// 11. только чтение: браузер без showDirectoryPicker (Firefox, Safari) — папка через webkitdirectory
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx2.addInitScript(() => { Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true }); });
const p2 = await ctx2.newPage();
p2.on('pageerror', (e) => R.console.push('ro pageerror: ' + e.message));
await p2.goto(BASE);
ok('без File System Access: кнопка «Выбрать папку хранилища» и предупреждение о чтении', await p2.getByRole('button', { name: 'Выбрать папку хранилища' }).count() === 1 && /только для чтения/.test(await p2.locator('.vault').innerText()));
try {
  await p2.locator('.vault input[type=file]').setInputFiles(VAULT_SRC);
  await p2.waitForSelector('.vver', { timeout: 20000 });
  ok('только чтение: версии прочитаны из выбранной папки', /261116-TimsoOnt-KZ-v0\.2\.1/.test(await p2.locator('.vault').innerText()) && /только чтение/.test(await p2.locator('.vault').innerText()));
  await p2.locator('.vver.latest').getByRole('button', { name: 'Открыть' }).click();
  await p2.waitForSelector('.topbar', { timeout: 30000 });
  ok('только чтение: онтология открыта', /TIMSO/.test(await p2.locator('.chip.vchip').innerText()));
} catch (e) { ok('только чтение: выбор папки через webkitdirectory', false, String(e)); }

// 12. file:// — так index.html открывают с диска
const p3 = await ctx.newPage();
await p3.goto(pathToFileURL(join(ROOT, 'dist/index.html')).href);
const env = await p3.evaluate(() => ({ secure: isSecureContext, picker: typeof window.showDirectoryPicker, idb: typeof indexedDB }));
ok('file://: защищённый контекст, showDirectoryPicker и IndexedDB доступны', env.secure && env.picker === 'function' && env.idb === 'object', env);
ok('file://: на стартовом экране есть «Подключить хранилище»', await p3.getByRole('button', { name: 'Подключить хранилище' }).count() === 1);

const consoleErr = R.console.filter((x) => !/favicon|404/.test(x));
ok('без ошибок в консоли', consoleErr.length === 0, consoleErr);
await browser.close(); server.close();
const passed = R.checks.filter((c) => c.ok).length, failed = R.checks.filter((c) => !c.ok);
writeFileSync(join(OUT, 'vault.json'), JSON.stringify(R, null, 1));
console.log(JSON.stringify({ passed, failed: failed.map((f) => f.name) }, null, 1));
process.exit(failed.length ? 1 : 0);
