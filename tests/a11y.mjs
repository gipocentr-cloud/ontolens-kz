/** Аудит доступности (WCAG 2.1 AA) на основных экранах с axe-core. */
import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const axe = readFileSync(join(ROOT, 'node_modules/axe-core/axe.min.js'), 'utf8');
const b = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const run = async (name) => {
  await p.addScriptTag({ content: axe });
  const r = await p.evaluate(async () => {
    const res = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return res.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help,
      sample: v.nodes.slice(0, 3).map((x) => (x.target.join(' ') + ' :: ' + (x.failureSummary || '').split('\n').slice(1, 2).join('')).slice(0, 220)) }));
  });
  return { screen: name, violations: r };
};
const out = [];
await p.goto(pathToFileURL(join(ROOT, 'dist/index.html')).href);
await p.waitForSelector('.startcard');
out.push(await run('стартовый экран'));
await p.keyboard.press('F1'); await p.waitForSelector('.ol-modal');
out.push(await run('справка'));
await p.keyboard.press('Escape');
await p.goto(pathToFileURL(join(ROOT, 'dist/index.html')).href + '?demo');
await p.waitForSelector('.card h1'); await p.waitForTimeout(700);
out.push(await run('термины + оценка'));
// клавиатура в дереве
await p.locator('.left .row').first().focus();
const k0 = await p.evaluate(() => document.activeElement.getAttribute('data-key'));
await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown');
const k1 = await p.evaluate(() => document.activeElement.getAttribute('data-key'));
await p.keyboard.press('Enter'); await p.waitForTimeout(300);
const sel = await p.evaluate(() => window.__ontolens.state.selected);
const kb = { moved: k0 !== k1, enterSelects: sel === k1 };
// ← до блока, ← свернуть блок
const blocksBefore = await p.locator('.left .row').count();
await p.locator('.left .row[aria-current="true"]').focus();
await p.keyboard.press('ArrowLeft');
kb.leftToParent = await p.evaluate(() => document.activeElement.classList.contains('blockrow') || document.activeElement.getAttribute('aria-expanded') === 'true');
if (!(await p.evaluate(() => document.activeElement.classList.contains('blockrow')))) await p.keyboard.press('ArrowLeft');
await p.keyboard.press('ArrowLeft');
kb.collapsed = (await p.locator('.left .row').count()) < blocksBefore;
await p.keyboard.press('ArrowRight');
kb.reexpanded = (await p.locator('.left .row').count()) > 0;
console.log('keyboard:', JSON.stringify(kb));
out.push({ screen: 'клавиатура в дереве', keyboard: kb, violations: [] });
await p.getByRole('tab', { name: 'Диагностика' }).click(); await p.waitForTimeout(300);
out.push(await run('диагностика'));
await p.getByRole('tab', { name: 'Замечания' }).click(); await p.waitForTimeout(300);
out.push(await run('замечания'));
await p.getByRole('tab', { name: 'Термины' }).click(); await p.waitForTimeout(300);
await p.locator('.right .tabs button').nth(1).click(); await p.waitForTimeout(200);
out.push(await run('технические сведения'));
await b.close();
writeFileSync(join(ROOT, 'tests/out/a11y.json'), JSON.stringify(out, null, 2));
for (const s of out) {
  console.log(`== ${s.screen}: ${s.violations.length} типов нарушений`);
  for (const v of s.violations) { console.log(` [${v.impact}] ${v.id} ×${v.n} — ${v.help}`); v.sample.forEach((x) => console.log('    ' + x)); }
}
