/**
 * Экраны корпуса (ТЗ v3.1): «Коллизии», «Формализация», «Аксиомы» —
 * офлайн (dist/index.html) и на платформе (dist/platform.html, демосервер).
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

// ================================================================ офлайн
await page.goto(pathToFileURL(join(ROOT, 'dist/index.html')).href);
await page.getByRole('button', { name: 'Демо: коллизии терминов' }).click();
await page.waitForSelector('.cx-row', { timeout: 15000 });
const st = () => page.evaluate(() => {
  // состояние приложения недоступно из бандла напрямую — читаем из разметки
  const t = document.querySelector('.cx-stats').innerText;
  return { proved: Number((/(\d+)\s+доказано/.exec(t) || [])[1]), cand: Number((/(\d+)\s+кандидатов/.exec(t) || [])[1]), text: t };
});
let s0 = await st();
ok('офлайн: корпус из CSV открылся на вкладке «Коллизии»', await page.getByRole('tab', { name: /Коллизии/ }).getAttribute('aria-selected') === 'true');
ok('офлайн: 7 доказанных, 5 кандидатов (формализации из файла)', s0.proved === 7 && s0.cand === 5, s0);
ok('офлайн: в списке «Доказанные» 7 строк', await page.locator('.cx-row').count() === 7);
await page.locator('.cx-row', { hasText: 'информационная модель' }).first().click();
const center = await page.locator('.center').innerText();
ok('карточка: два определения бок о бок', await page.locator('.cx-def').count() === 2);
ok('карточка: различия подсвечены', await page.locator('.cx-def mark').count() > 0);
ok('карточка: доказательство из посылок, аксиомы и вывода', await page.locator('.cx-step.t-premise').count() >= 2 && await page.locator('.cx-step.t-axiom').count() === 1 && await page.locator('.cx-step.t-conclusion').count() === 1);
ok('карточка: уступающий документ и причина', /Уступает: ТКН РК ТИМСО \(проект\)/.test(center) && /ранг 5 ниже ранга 1/.test(center), center.slice(0, 400));
ok('карточка: у каждого шага источник', await page.locator('.cx-src.bad').count() === 0);
await page.screenshot({ path: join(OUT, '70-conflict-card.png') });

// вердикт клавишей 1 и сохранение
await page.locator('.cx-head h2').click();
await page.keyboard.press('1');
await page.fill('textarea[name="comment"]', 'Кодекс выше по рангу');
await page.locator('.cx-form button[type=submit]').click();
await page.waitForTimeout(200);
const saved = await page.evaluate(() => Object.entries(JSON.parse(Object.entries(localStorage).find(([k]) => /review/i.test(k) && /conflict:/.test(localStorage.getItem(k)))?.[1] || '{"items":{}}').items).filter(([k]) => k.startsWith('conflict:')));
ok('вердикт коллизии сохранён (ключ conflict:…)', saved.length === 1 && saved[0][1].verdict === 'conflict' && saved[0][1].conflict_kind === 'K1-genus', saved);
ok('после сохранения — следующая неоценённая', !(await page.locator('.cx-head h2').innerText()).includes('«информационная модель»: «совокупность'));
// «Не могу оценить» без комментария не сохраняется
await page.locator('.cx-head h2').click();
await page.keyboard.press('5');
await page.fill('textarea[name="comment"]', '');
await page.locator('.cx-form button[type=submit]').click();
ok('«Не могу оценить» требует комментарий', /нужен комментарий/.test(await page.locator('.ol-toast').innerText()));

// формализация: разобрать определение ISO 3.3.8 «информационная модель»
await page.getByRole('tab', { name: 'Формализация' }).click();
await page.locator('.seg.light button', { hasText: 'Без разбора' }).click();
await page.locator('.cx-row', { hasText: '3.3.8' }).first().click();
ok('формализация: текст определения и форма', /набор структурированных/.test(await page.locator('.cx-text.big').innerText()) && await page.locator('.cx-fform select').count() >= 1);
await page.locator('.cx-fform select').first().selectOption('S_set');
await page.fill('.cx-fform .cx-field input', 'набор');
await page.getByRole('button', { name: 'Подтвердить' }).click();
await page.waitForTimeout(200);
let toastT = await page.locator('.ol-toast').innerText();
ok('формализация подтверждена, пересчёт сразу', /Формализация подтверждена/.test(toastT) && /Доказанных коллизий/.test(toastT), toastT);
await page.screenshot({ path: join(OUT, '71-formal.png') });
// цитата не из текста — подтверждение отклоняется
await page.locator('.seg.light button', { hasText: 'Без разбора' }).click();
await page.locator('.cx-row').first().click();
await page.locator('.cx-fform select').first().selectOption('S_set');
await page.getByRole('button', { name: '+ признак' }).click();
await page.locator('.cx-diff select').first().selectOption('P_represents');
await page.locator('.cx-diff select').nth(1).selectOption('S_building');
await page.locator('.cx-diff input').nth(1).fill('этих слов нет в определении');
await page.getByRole('button', { name: 'Подтвердить' }).click();
ok('цитата не из текста пункта — подтверждение отклонено', /Цитаты нет в тексте/.test(await page.locator('.ol-toast').innerText()));

// аксиомы: S_set ⊥ S_digital → кандидат K1-open по «информационной модели» становится доказанным
await page.getByRole('tab', { name: 'Аксиомы' }).click();
const before = await page.getByRole('tab', { name: /Коллизии/ }).innerText();
const sug = await page.locator('.center').innerText();
ok('аксиомы: предложено решить совместимость родов из кандидатов', /Предложено решить/i.test(sug) && /набор информации/.test(sug), sug.slice(sug.toLowerCase().indexOf('предложено'), sug.toLowerCase().indexOf('предложено') + 700));
await page.locator('.center button.linkbtn', { hasText: 'несовместимы — добавить аксиому' }).first().click();
await page.fill('.cx-fform textarea', 'СТ РК ISO 19650-1, п. 3.3.12: набор информации — не документ (решение рабочей группы)');
await page.getByRole('button', { name: 'Добавить аксиому', exact: true }).click();
await page.waitForTimeout(200);
toastT = await page.locator('.ol-toast').innerText();
const after = await page.getByRole('tab', { name: /Коллизии/ }).innerText();
ok('новая аксиома с основанием увеличила число доказанных', Number(after.replace(/\D/g, '')) > Number(before.replace(/\D/g, '')), { before, after, toastT });
// отзыв AX1 уменьшает
const p1 = Number(after.replace(/\D/g, ''));
await page.locator('.center .kv .r', { hasText: 'AX1' }).locator('input[type=checkbox]').uncheck();
await page.waitForTimeout(200);
const p2 = Number((await page.getByRole('tab', { name: /Коллизии/ }).innerText()).replace(/\D/g, ''));
ok('отзыв аксиомы AX1 снимает зависимые доказательства', p2 < p1, { p1, p2 });
await page.screenshot({ path: join(OUT, '72-axioms.png') });

// выгрузки
await page.getByRole('tab', { name: /Коллизии/ }).click();
async function grab(name) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name }).click()]);
  return { file: dl.suggestedFilename(), text: readFileSync(await dl.path(), 'utf8') };
}
const md = await grab('Отчёт с доказательствами (.md)');
ok('выгрузка отчёта .md: имя с датой ГГММДД, шаги и источники', /^\d{6}-/.test(md.file) && /Посылка/.test(md.text) && /источник:/.test(md.text), md.file);
const cs = await grab('Карта коллизий (.csv)');
ok('выгрузка карты коллизий .csv со столбцом оценки', /verdict_/.test(cs.text) && /Коллизия подтверждена/.test(cs.text), cs.file);
const tt = await grab('Turtle: коллизии');
ok('выгрузка Turtle коллизий', /:TermConflict/.test(tt.text) && /:proofStep/.test(tt.text), tt.file);
const fj = await grab('Формализации (.json)');
ok('выгрузка формализаций .json с ключами «код|пункт»', /"СТ РК ISO 19650-1\|3\.3\.8"/.test(fj.text), fj.file);
// после перезагрузки работа сохраняется в браузере
await page.reload();
await page.getByRole('button', { name: 'Демо: коллизии терминов' }).click();
await page.waitForSelector('.cx-row');
const p3 = Number((await page.getByRole('tab', { name: /Коллизии/ }).innerText()).replace(/\D/g, ''));
ok('офлайн: работа редактора переживает перезагрузку', p3 === p2, { p2, p3 });

// ================================================================ платформа
await page.goto(pathToFileURL(join(ROOT, 'dist/platform.html')).href);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.gbtn', { timeout: 15000 });
async function loginAs(email) {
  await page.evaluate(async () => { await window.__ontolensBackend.signOut(); sessionStorage.clear();
    if (location.hash !== '#/') location.hash = '#/'; else window.__ontolensPlatform.route(); });
  await page.waitForSelector('.gbtn', { timeout: 8000 });
  await page.fill('#mock-email', email);
  await page.click('.gbtn');
}
const db = () => page.evaluate(() => window.__ontolensBackend._db());

await loginAs('jurist@example.com');
await page.waitForSelector('.cx-row', { timeout: 15000 });
ok('эксперт корпуса попадает сразу в «Коллизии»', await page.getByRole('tab', { name: /Коллизии/ }).getAttribute('aria-selected') === 'true');
const sj = await st();
ok('платформа: работа редактора загружена с сервера (7 доказанных)', sj.proved === 7, sj);
await page.locator('.cx-head h2').click();
await page.keyboard.press('2');
await page.fill('textarea[name="comment"]', 'Разная область применения');
await page.locator('.cx-form button[type=submit]').click();
await page.waitForTimeout(400);
let d = await db();
const rv = Object.values(d.reviews).filter((r) => r.oid === 'tkn-corpus');
ok('вердикт эксперта записан на сервер', rv.length === 1 && rv[0].iri.startsWith('conflict:') && rv[0].verdict === 'compatible' && rv[0].email === 'jurist@example.com', rv);
await page.getByRole('tab', { name: 'Формализация' }).click();
ok('эксперт видит разбор, но не меняет его', await page.locator('.cx-fform select').first().isDisabled() && await page.getByRole('button', { name: 'Подтвердить' }).count() === 0);
ok('эксперт не видит диагностику', await page.getByRole('tab', { name: 'Диагностика' }).count() === 0);
const denied = await page.evaluate(() => window.__ontolensBackend.saveWork('tkn-corpus', 'axiom', 'AXX', { id: 'AXX' }).then(() => 'ok', (e) => e.code));
ok('сервер не даёт эксперту менять аксиомы', denied === 'permission-denied', denied);
await page.screenshot({ path: join(OUT, '73-platform-expert.png') });

await loginAs('terminolog@example.com');
await page.waitForSelector('.cx-row', { timeout: 15000 });
const firstTitle = rv[0].label_ru;
await page.locator('.cx-row', { hasText: firstTitle.slice(0, 30) }).first().click().catch(() => {});
const rt = await page.locator('.right').innerText();
ok('редактор видит оценку эксперта по коллизии', /Оценки экспертов: 1/i.test(rt) && /Противоречия нет/.test(rt), rt.slice(0, 400));
await page.getByRole('tab', { name: 'Аксиомы' }).click();
await page.locator('.center .kv .r', { hasText: 'AX1' }).locator('input[type=checkbox]').uncheck();
await page.waitForTimeout(300);
d = await db();
const w = Object.entries(d.work).find(([k]) => k === 'tkn-corpus/axiom__AX1');
ok('редактор: отзыв аксиомы записан на сервер с автором', w && w[1].data.active === false && w[1].data.updatedBy === 'terminolog@example.com', w);
await page.screenshot({ path: join(OUT, '74-platform-editor.png') });

R.console = R.console.filter((x) => !/favicon/.test(x));
ok('ошибок в консоли нет', R.console.length === 0, R.console);
await browser.close();
writeFileSync(join(OUT, 'corpus-ui-report.json'), JSON.stringify(R, null, 2));
R.failed = R.checks.filter((c) => !c.ok).map((c) => c.name);
console.log(JSON.stringify({ passed: R.checks.filter((c) => c.ok).length, failed: R.failed }, null, 2));
if (R.failed.length) process.exit(1);
