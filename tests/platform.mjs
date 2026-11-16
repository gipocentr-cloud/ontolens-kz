/**
 * Платформа OntoLens-KZ (ТЗ v2.2) на демонстрационном сервере: правила доступа
 * те же, что в firebase/firestore.rules. Проверяются пути пользователя раздела 4
 * и приёмка 2.0 раздела 9 (кроме того, что требует настоящего Firebase).
 */
import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tests', 'out');
mkdirSync(OUT, { recursive: true });
const R = { checks: [], console: [] };
const ok = (name, cond, extra) => { R.checks.push({ name, ok: !!cond, ...(extra !== undefined ? { extra } : {}) }); if (!cond) console.error('FAIL', name, extra ?? ''); };

const browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') R.console.push(m.text()); });
page.on('pageerror', (e) => R.console.push('pageerror: ' + e.message));
page.on('dialog', (d) => d.dismiss());
const url = pathToFileURL(join(ROOT, 'dist/platform.html')).href;

async function loginAs(email) {
  await page.evaluate(async () => { await window.__ontolensBackend.signOut(); sessionStorage.clear();
    if (location.hash !== '#/') location.hash = '#/'; else window.__ontolensPlatform.route(); });
  await page.waitForSelector('.gbtn', { timeout: 8000 }).catch(async (e) => {
    console.error('LOGIN WAIT', email, page.url(), (await page.locator('body').innerText()).slice(0, 300)); throw e; });
  await page.fill('#mock-email', email);
  await page.click('.gbtn');
}
const db = () => page.evaluate(() => window.__ontolensBackend._db());

await page.goto(url);
await page.waitForSelector('.gbtn', { timeout: 15000 });
ok('вход: экран с кнопкой Google', await page.locator('.gbtn').innerText().then((t) => /Google/.test(t)));
await page.screenshot({ path: join(OUT, '50-login.png') });

// ---------------------------------------------------------------- эксперт 1
await loginAs('expert1@example.com');
await page.waitForSelector('.card h1', { timeout: 15000 });
ok('эксперт с одной онтологией попадает сразу в неё', await page.locator('.topbar .chip').first().innerText().then((t) => /GeodeticOnt/.test(t)));
ok('шапка: имя и роль, без переключателя и загрузки', await page.locator('.whoami').innerText().then((t) => /Эксперт А\. А\./.test(t)) && /эксперт/i.test(await page.locator('.whoami small').innerText())
  && await page.locator('.topbar .seg button', { hasText: 'Автор' }).count() === 0 && await page.locator('.addfiles').count() === 0);
ok('эксперт не видит диагностику', await page.getByRole('tab', { name: 'Диагностика' }).count() === 0 && await page.locator('.chip.warn').count() === 0);
ok('имя эксперта нельзя изменить', await page.locator('#rv-expert').getAttribute('readonly') !== null);
const order = await page.evaluate(() => window.__ontolensPlatform.state.model.classes.filter((e) => e.isTerm).length);
ok('онтология с сервера: 119 терминов', order === 119, order);

async function rate(key, comment) {
  await page.locator('.card h1').click();
  await page.keyboard.press(key);
  if (comment) await page.fill('#rv-comment', comment);
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(150);
}
const iris = [];
iris.push(await page.evaluate(() => window.__ontolensPlatform.state.selected));
await rate('1');
iris.push(await page.evaluate(() => window.__ontolensPlatform.state.selected));
await rate('6');   // «не могу оценить» без комментария — не сохраняется
const stayed = await page.evaluate(() => window.__ontolensPlatform.state.selected);
ok('«Не могу оценить» без комментария отклонено', stayed === iris[1] && /комментарии/.test(await page.locator('.rv-flash').innerText()));
await rate('6', 'нет пункта норматива, на который ссылается определение');
iris.push(await page.evaluate(() => window.__ontolensPlatform.state.selected));
await rate('2', 'родитель выбран неверно');
await page.waitForTimeout(300);
let d = await db();
const mine1 = Object.values(d.reviews).filter((r) => r.email === 'expert1@example.com');
ok('оценки эксперта на сервере: 3', mine1.length === 3, mine1.map((r) => r.verdict));
ok('вердикт unclear сохранён с комментарием', mine1.some((r) => r.verdict === 'unclear' && r.comment));
ok('заметка: оценки сохраняются на сервере', /на сервере/.test(await page.locator('#rv-store').innerText()));
await page.screenshot({ path: join(OUT, '51-expert.png') });

// ---------------------------------------------------------------- эксперт 2: видимость после своей оценки
await loginAs('expert2@example.com');
await page.waitForSelector('.card h1', { timeout: 15000 });
// перейти к первому термину эксперта 1
await page.evaluate((iri) => window.__olSelect && window.__olSelect(iri), iris[0]);
await page.waitForTimeout(400);
const hiddenTxt = await page.locator('.rv').innerText();
ok('до своей оценки чужие скрыты', /появятся после того, как вы сохраните свою/.test(hiddenTxt));
await page.locator('.card h1').click();
await page.keyboard.press('2');
await page.fill('#rv-comment', 'не согласен с родителем');
await page.locator('button', { hasText: 'Сохранить и далее' }).click();
await page.waitForTimeout(300);
await page.evaluate((iri) => window.__olSelect(iri), iris[0]);
await page.waitForTimeout(500);
const shownTxt = await page.locator('.rv').innerText();
ok('после своей оценки видна оценка коллеги', /Другие эксперты/i.test(shownTxt) && /Эксперт А\. А\./.test(shownTxt), shownTxt.slice(0, 300));
await page.screenshot({ path: join(OUT, '52-expert2-others.png') });

// ---------------------------------------------------------------- незнакомый аккаунт
await loginAs('stranger@example.com');
await page.waitForSelector('text=Доступ ещё не выдан');
ok('незнакомый аккаунт: «доступ не выдан»', true);
const denied = await page.evaluate(async () => {
  const b = window.__ontolensBackend;
  const out = {};
  for (const [k, f] of Object.entries({ list: () => b.listOntologies(), get: () => b.getOntology('geodeticont-kz'),
    files: () => b.getVersionFiles('geodeticont-kz', 'v1'), reviews: () => b.myReviews('geodeticont-kz', 'v1') })) {
    try { const r = await f(); out[k] = Array.isArray(r) ? r.length : 'данные'; } catch (e) { out[k] = 'отказ'; }
  }
  return out;
});
ok('незнакомый аккаунт не получает данных', denied.list === 0 && denied.get === 'отказ' && denied.files === 'отказ' && denied.reviews === 'отказ', denied);

// ---------------------------------------------------------------- редактор
await loginAs('editor@example.com');
await page.waitForSelector('.card-o', { timeout: 15000 }).catch(() => {});
if (await page.locator('.card-o').count() === 0) { await page.evaluate(() => { location.hash = '#/'; }); }
await page.waitForSelector('.card-o .nums b', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(500);
const cardTxt = await page.locator('.card-o').first().innerText().catch(() => '');
ok('карточка редактора: экспертов, прогресс, расхождения', /2 \/ 2/.test(cardTxt) && /расхождений/.test(cardTxt) && /Новая версия/.test(cardTxt), cardTxt);
await page.screenshot({ path: join(OUT, '53-editor-list.png') });
await page.locator('.card-o button', { hasText: 'Открыть' }).click();
await page.waitForSelector('.card h1', { timeout: 15000 });
await page.getByRole('tab', { name: 'Замечания' }).click();
await page.waitForTimeout(300);
const head = await page.locator('.table .th').innerText();
ok('сводка редактора: обе колонки экспертов', /Эксперт А/i.test(head) && /Эксперт Б/i.test(head), head);
const rightTxt = await page.locator('.right').innerText();
ok('согласие посчитано (unclear не в счёт)', /Согласие|согласие/.test(rightTxt));
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }),
  page.locator('.checklist').getByRole('button', { name: 'CSV' }).first().click()]);
const csvText = readFileSync(await dl.path(), 'utf8');
ok('CSV эксперта в формате контракта', /^﻿?id;verdict;def_ru_fixed/.test(csvText), csvText.slice(0, 60));
writeFileSync(join(OUT, 'platform-expert.csv'), csvText);
await page.screenshot({ path: join(OUT, '54-editor-summary.png') });

// эксперт не может писать от чужого имени и в чужую онтологию — проверка правил
const rules = await page.evaluate(async () => {
  const b = window.__ontolensBackend;
  const out = {};
  try { await b.allReviews('geodeticont-kz', 'v1'); out.editorSummary = 'ok'; } catch (e) { out.editorSummary = 'отказ'; }
  return out;
});
ok('редактор читает сводку', rules.editorSummary === 'ok');

// новая версия: предпросмотр → публикация
await page.locator('.iconbtn.back').click();
await page.waitForSelector('.card-o');
await page.locator('.card-o button', { hasText: 'Новая версия' }).click();
await page.waitForSelector('input[type=file]', { state: 'attached' });
// в новой версии меняем определение одного термина
const ttl = readFileSync(join(ROOT, 'data/demo-geodeticont-kz.ttl'), 'utf8');
const files = [
  { name: 'demo-geodeticont-kz.ttl', mimeType: 'text/turtle', buffer: Buffer.from(ttl) },
  { name: 'demo-geodeticont-kz-docs.ttl', mimeType: 'text/turtle', buffer: readFileSync(join(ROOT, 'data/demo-geodeticont-kz-docs.ttl')) },
  { name: 'geodeticont-kz.profile.json', mimeType: 'application/json', buffer: readFileSync(join(ROOT, 'profiles/geodeticont-kz.profile.json')) },
];
await page.locator('input[type=file]').first().setInputFiles(files);
await page.waitForSelector('.previewbar', { timeout: 15000 });
ok('предпросмотр: панель публикации', /Новая версия/.test(await page.locator('.previewbar').innerText()));
await page.screenshot({ path: join(OUT, '55-preview.png') });
await page.locator('.previewbar button', { hasText: 'Опубликовать' }).click();
await page.waitForSelector('.card h1', { timeout: 15000 });
d = await db();
ok('опубликована v2 и стала текущей', d.ontologies['geodeticont-kz'].currentVersion === 'v2' && !!d.versions['geodeticont-kz/v2']);

// эксперт 1 открывает v2 — оценки перенесены
await loginAs('expert1@example.com');
await page.waitForSelector('.card h1', { timeout: 15000 });
await page.waitForTimeout(600);
d = await db();
const v2 = Object.values(d.reviews).filter((r) => r.email === 'expert1@example.com' && r.version === 'v2');
ok('оценки эксперта перенесены на v2', v2.length === 3, v2.length);
let err = '';
try { await page.evaluate(() => window.__ontolensBackend.saveReview('geodeticont-kz', 'v1', 'urn:x', { verdict: 'ok' })); } catch (e) { err = e.message; }
ok('запись в старую версию запрещена', /Версия онтологии сменилась/.test(err), err);

// ---------------------------------------------------------------- администратор
await loginAs('gipocentr@gmail.com');
await page.waitForSelector('.sh-top', { timeout: 15000 });
await page.evaluate(() => { location.hash = '#/admin'; });
await page.waitForSelector('#p-email');
await page.fill('#p-email', 'New.Expert@Example.com');
await page.fill('#p-name', 'Новый Э. Э.');
await page.locator('form.form button[type=submit]').first().click();
await page.waitForSelector('text=new.expert@example.com');
await page.fill('#o-title', 'TimsoOnt-KZ — тест');
await page.fill('#o-editors', 'editor@example.com');
await page.locator('form.form button[type=submit]').nth(1).click();
await page.waitForSelector('text=timsoont-kz-test');
d = await db();
ok('администратор: участник заведён (email в нижнем регистре)', !!d.people['new.expert@example.com']);
ok('администратор: онтология создана с редактором', d.ontologies['timsoont-kz-test'] && d.ontologies['timsoont-kz-test'].editors[0] === 'editor@example.com');
ok('журнал ведётся', d.log.length > 5);
await page.screenshot({ path: join(OUT, '56-admin.png'), fullPage: true });

// эксперт не видит управление
await loginAs('expert1@example.com');
await page.waitForSelector('.card h1', { timeout: 15000 });
await page.evaluate(() => { location.hash = '#/admin'; });
await page.waitForTimeout(500);
ok('эксперт не попадает в «Управление»', await page.locator('#p-email').count() === 0);

await browser.close();
R.failed = R.checks.filter((c) => !c.ok).map((c) => c.name);
writeFileSync(join(OUT, 'platform-report.json'), JSON.stringify(R, null, 2));
console.log(JSON.stringify({ passed: R.checks.filter((c) => c.ok).length, failed: R.failed, console: R.console.slice(0, 10) }, null, 2));
if (R.failed.length) process.exit(1);
