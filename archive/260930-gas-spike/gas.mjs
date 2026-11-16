/**
 * Веб-версия на Apps Script: сервер gas/Code.gs в эмуляции служб Google
 * + настоящая страница OntoLens в Chromium, google.script.run → Code.gs.
 *
 * Проверяется: setup, вход по токену, «нет доступа», онтология с «Диска»,
 * запись оценок в «Таблицу», восстановление после очистки браузера,
 * сводка автора, отзыв токена, смена версии, защита от формул.
 */
import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { makeGas } from './gas-mock.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tests', 'out');
mkdirSync(OUT, { recursive: true });
const R = { console: [], checks: [] };
const ok = (name, cond, extra) => { R.checks.push({ name, ok: !!cond, ...(extra ? { extra } : {}) }); if (!cond) console.error('FAIL', name, extra || ''); };

const ROOT_ID = '1nm6YBkwjBePX0LaZU6CpPe_2h3_XaPav';
const g = makeGas({ rootId: ROOT_ID });
const { api } = g;

// ---------------------------------------------------------------- Диск: app/ и онтология
const dist = readFileSync(join(ROOT, 'dist/index.html'), 'utf8');
const app = g.root.createFolder('app');
const PARTS = 3, size = Math.ceil(dist.length / PARTS);
app.addFile('OntoLens-app-old-1.html', 'СТАРАЯ СБОРКА — не должна попасть на страницу');
const names = [];
for (let i = 0; i < PARTS; i++) { names.push(`OntoLens-app-test-${i + 1}.html`); app.addFile(names[i], dist.slice(i * size, (i + 1) * size)); }
app.addFile('OntoLens-app.json', JSON.stringify({ build: 'old', parts: ['OntoLens-app-old-1.html'] }));
await new Promise((r) => setTimeout(r, 5));
app.addFile('OntoLens-app.json', JSON.stringify({ build: 'test', parts: names }));   // свежий манифест побеждает
const ont = g.root.createFolder('онтология');
const v1 = ont.createFolder('demo-synthetic');
for (const f of ['demo-geodeticont-kz.ttl', 'demo-geodeticont-kz-docs.ttl', 'demo-geodeticont-kz-shapes.ttl']) {
  v1.addFile(f, readFileSync(join(ROOT, 'data', f), 'utf8'));
}
v1.addFile('geodeticont-kz.profile.json', readFileSync(join(ROOT, 'profiles/geodeticont-kz.profile.json'), 'utf8'));
v1.addFile('readme.txt', 'посторонний файл — должен игнорироваться');

// ---------------------------------------------------------------- setup
R.setup = api.setup();
const ss = g.sheets();
const sh = (n) => ss.getSheetByName(n);
ok('setup: четыре листа', ['Допуск', 'Оценки', 'Настройки', 'Журнал'].every((n) => sh(n)) && !ss.getSheetByName('Лист1'));
ok('setup: версия = первая подпапка', R.setup.includes('demo-synthetic'));
let access = sh('Допуск').rows();
const author = access[1];
ok('setup: строка автора с токеном', author[2] === 'author' && String(author[0]).length >= 32);
api.setup();
ok('setup повторно: автор не задваивается', sh('Допуск').rows().length === 2);

// эксперты добавляются строкой с одним именем
sh('Допуск').appendRow(['', 'Тестов Б. Ж.']);
sh('Допуск').appendRow(['', 'Второй Е. К.', 'expert']);
api.issueTokens();
access = sh('Допуск').rows();
const e1 = access[2], e2 = access[3];
ok('issueTokens: токен, роль, ссылка', e1[0] && e1[2] === 'expert' && e1[3] === true && String(e1[4]).endsWith('?k=' + e1[0]),
  e1.slice(0, 5));

// ---------------------------------------------------------------- doGet
const deny1 = api.doGet({ parameter: {} });
ok('doGet без токена (не владелец) → нет доступа', /нет доступа/.test(deny1.getContent()));
const deny2 = api.doGet({ parameter: { k: 'x'.repeat(40) } });
ok('doGet с чужим токеном → нет доступа', /нет доступа/.test(deny2.getContent()));
g.env.activeUser = g.env.owner;
const own = api.doGet({ parameter: {} });
ok('doGet владельца без токена → автор', own.getContent().includes('"role":"author"'));
g.env.activeUser = '';
const pageExpert = api.doGet({ parameter: { k: e1[0] } }).getContent();
ok('doGet эксперта: страница = бандл + паспорт', pageExpert.replace(/<script>window.__OL_BOOT__=.*?;<\/script>/, '') === dist
  && pageExpert.includes('"expert":"Тестов Б. Ж."'));
const again = api.doGet({ parameter: { k: e1[0] } }).getContent();
ok('doGet: повтор из кэша совпадает', again === pageExpert);
ok('app_url запомнен', sh('Настройки').rows().some((r) => r[0] === 'app_url' && /\/exec$/.test(r[1])));

// ---------------------------------------------------------------- браузер
const browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const calls = [];
async function openAs(token, { failSaves = 0 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') R.console.push(m.text()); });
  page.on('pageerror', (e) => R.console.push('pageerror: ' + e.message));
  let fails = failSaves;
  await page.exposeFunction('__gasCall', (fn, args) => {
    calls.push(fn);
    if (fn === 'apiSaveReview' && fails > 0) { fails--; return { __error: 'Сеть недоступна (эмуляция)' }; }
    try { return { value: JSON.parse(JSON.stringify(api[fn](...args) ?? null)) }; }
    catch (e) { return { __error: e.message }; }
  });
  await page.addInitScript(() => {
    const make = (ok, fail) => new Proxy({}, {
      get(_, prop) {
        if (prop === 'withSuccessHandler') return (f) => make(f, fail);
        if (prop === 'withFailureHandler') return (f) => make(ok, f);
        return (...args) => { window.__gasCall(prop, args).then((r) => {
          if (r.__error) { fail && fail(new Error(r.__error)); } else { ok && ok(r.value); }
        }); };
      },
    });
    window.google = { script: { get run() { return make(null, null); } } };
  });
  const html = api.doGet({ parameter: { k: token } }).getContent();
  await page.route('https://ontolens.test/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto('https://ontolens.test/exec');
  return { ctx, page };
}

// эксперт 1
let { ctx, page } = await openAs(e1[0], { failSaves: 1 });
await page.waitForSelector('.card h1', { timeout: 15000 });
R.expertState = await page.evaluate(() => {
  const S = window.__ontolens.state;
  return { version: S.ontVersion, files: S.files, role: S.role, expert: S.review.expert, profile: S.profileName,
    terms: S.model.classes.filter((e) => e.isTerm).length };
});
ok('эксперт: онтология с Диска, без постороннего файла', R.expertState.version === 'demo-synthetic'
  && R.expertState.files.length === 3 && R.expertState.profile === 'geodeticont-kz.profile.json', R.expertState);
ok('эксперт: роль и имя из токена', R.expertState.role === 'expert' && R.expertState.expert === 'Тестов Б. Ж.');
ok('эксперт: нет переключателя роли и загрузки файлов', await page.locator('.who .seg').count() === 0
  && await page.locator('.addfiles').count() === 0 && await page.locator('.whoami').innerText() === 'Тестов Б. Ж.');
ok('эксперт: имя нельзя изменить', await page.locator('#rv-expert').getAttribute('readonly') !== null);

const plan = ['1', '2', '1', '3', '1'];
const iris = [];
for (let i = 0; i < plan.length; i++) {
  iris.push(await page.evaluate(() => window.__ontolens.state.selected));
  await page.locator('.card h1').click();
  await page.keyboard.press(plan[i]);
  if (i === 1) await page.fill('#rv-comment', '=HYPERLINK("http://x";"y") проверка формулы');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(120);
}
await page.waitForTimeout(6500);   // первая запись падает (эмуляция), повтор через 5 с
R.sync = await page.evaluate(() => window.__ontolens.state.sync);
ok('очередь: после сбоя всё дописано', R.sync.pending === 0 && !R.sync.error, R.sync);
let rows = sh('Оценки').rows().slice(1);
ok('Таблица: 5 строк эксперта', rows.length === 5 && rows.every((r) => r[12] === 'Тестов Б. Ж.' && r[13] === 'demo-synthetic'));
const cIdx = 5;
const fx = rows.find((r) => String(r[cIdx]).startsWith('=HYPERLINK'));
ok('Таблица: формула сохранена как текст', fx && sh('Оценки').formulas.length === 0, fx && fx[cIdx]);
await page.screenshot({ path: join(OUT, '40-gas-expert.png') });
ok('заметка о хранении — Таблица', /Google Таблицу/.test(await page.locator('#rv-store').innerText()));

// повторное сохранение того же термина — замена строки, не новая
await page.evaluate((iri) => window.__ontolens.select(iri), iris[0]);
await page.locator('.card h1').click();
await page.keyboard.press('4');
await page.keyboard.press('Control+Enter');
await page.waitForTimeout(400);
rows = sh('Оценки').rows().slice(1);
ok('повторная оценка заменяет строку', rows.length === 5 && rows.find((r) => r[7] === iris[0])[1] === 'not_my_domain');

// скачивание CSV работает обычным образом
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }),
  page.getByRole('button', { name: 'CSV' }).first().click()]);
ok('экспорт CSV скачивается', /^review-testov/.test(dl.suggestedFilename()), dl.suggestedFilename());
ok('после скачивания — подсказка', await page.locator('.ol-toast').count() === 1);
await ctx.close();

// тот же эксперт в «чистом» браузере — оценки из Таблицы
({ ctx, page } = await openAs(e1[0]));
await page.waitForSelector('.card h1', { timeout: 15000 });
await page.waitForTimeout(500);
R.restored = await page.evaluate(() => Object.values(window.__ontolens.state.review.items).filter((r) => r.verdict).length);
ok('чистый браузер: 5 оценок восстановлены из Таблицы', R.restored === 5, R.restored);
await ctx.close();

// эксперт 2 — 3 оценки, одна расходится
({ ctx, page } = await openAs(e2[0]));
await page.waitForSelector('.card h1', { timeout: 15000 });
for (const k of ['1', '1', '1']) {
  await page.locator('.card h1').click();
  await page.keyboard.press(k);
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(120);
}
await page.waitForTimeout(500);
ok('эксперт 2 не видит чужих оценок', await page.evaluate(() => Object.keys(window.__ontolens.state.review.items).length) === 3);
await ctx.close();

// автор — сводка
({ ctx, page } = await openAs(author[0]));
await page.waitForSelector('.card h1', { timeout: 15000 });
await page.waitForTimeout(500);
R.author = await page.evaluate(() => {
  const S = window.__ontolens.state;
  return { role: S.role, experts: (S.serverReviews || []).map((x) => x.expert + ':' + Object.keys(x.items).length) };
});
ok('автор: видит обоих экспертов', R.author.role === 'author' && R.author.experts.length === 2, R.author);
await page.getByRole('tab', { name: 'Замечания' }).click();
await page.waitForTimeout(300);
R.authorHead = await page.locator('.table .th').innerText();
ok('автор: столбцы экспертов в сводке', /Тестов/i.test(R.authorHead) && /Второй/i.test(R.authorHead), R.authorHead);
R.kappa = await page.locator('.kv .r').filter({ hasText: /κ|Флейс|kappa/i }).first().innerText().catch(() => '');
await page.screenshot({ path: join(OUT, '41-gas-author-reviews.png') });
const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }),
  page.locator('.checklist').getByRole('button', { name: 'CSV' }).first().click()]);
const csvText = readFileSync(await dl2.path(), 'utf8');
ok('автор: CSV эксперта из Таблицы в формате контракта', csvText.split('\n')[0].replace(/^﻿/, '').startsWith('id;verdict;def_ru_fixed'), csvText.split('\n')[0]);
writeFileSync(join(OUT, 'gas-expert1.csv'), csvText);
await ctx.close();

// ---------------------------------------------------------------- отзыв и смена версии
const acc = sh('Допуск');
acc.data[3][3] = 'нет';      // отозвать эксперта 2
let err = '';
try { api.apiSaveReview(e2[0], 'demo-synthetic', iris[0], { verdict: 'ok' }); } catch (e) { err = e.message; }
ok('отозванный токен: запись запрещена', /отозван/.test(err), err);
ok('отозванный токен: страница закрыта', /нет доступа/.test(api.doGet({ parameter: { k: e2[0] } }).getContent()));
try { api.apiAllReviews(e1[0], 'demo-synthetic'); err = ''; } catch (e) { err = e.message; }
ok('эксперту сводка недоступна', /только автору/.test(err), err);
try { api.apiSaveReview(e1[0], 'demo-synthetic', iris[0], { verdict: 'хорошо' }); err = ''; } catch (e) { err = e.message; }
ok('некорректная оценка отклонена', /Некорректная/.test(err), err);
const st = sh('Настройки');
st.data.find((r) => r[0] === 'current_version')[1] = 'v2';
try { api.apiSaveReview(e1[0], 'demo-synthetic', iris[0], { verdict: 'ok' }); err = ''; } catch (e) { err = e.message; }
ok('смена версии: старая страница не пишет', /Перезагрузите/.test(err), err);
try { api.apiOntology(e1[0]); err = ''; } catch (e) { err = e.message; }
ok('несуществующая версия: понятная ошибка', /Нет папки/.test(err), err);
st.data.find((r) => r[0] === 'current_version')[1] = 'demo';
ok('версия demo → встроенный набор', api.apiOntology(e1[0]).demo === true);
ok('журнал ведётся', sh('Журнал').rows().length > 10);

await browser.close();
R.calls = calls.reduce((a, c) => ((a[c] = (a[c] || 0) + 1), a), {});
R.failed = R.checks.filter((c) => !c.ok).map((c) => c.name);
R.console = R.console.filter((m) => !/Сеть недоступна/.test(m));
writeFileSync(join(OUT, 'gas-report.json'), JSON.stringify(R, null, 2));
console.log(JSON.stringify({ passed: R.checks.filter((c) => c.ok).length, failed: R.failed, console: R.console, calls: R.calls }, null, 2));
if (R.failed.length) process.exit(1);
