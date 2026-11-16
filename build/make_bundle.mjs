/**
 * Сборка: один самодостаточный index.html (раздел 6 ТЗ).
 *  1) генерирует src/demo-data.js — демонабор, встроенный в бандл;
 *  2) собирает JS через esbuild (IIFE, без внешних зависимостей);
 *  3) вклеивает всё в index.html.
 *
 * Запуск: node build/make_bundle.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as esbuild from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// ---- 1. демонабор ---------------------------------------------------------
const demoFiles = [
  'data/demo-geodeticont-kz.ttl',
  'data/demo-geodeticont-kz-docs.ttl',
  'data/demo-geodeticont-kz-shapes.ttl',
];
const demoProfile = JSON.parse(read('profiles/geodeticont-kz.profile.json'));
const legacy = 'data/demo-legacy-geont.ttl';

const demoModule = `/* СГЕНЕРИРОВАНО build/make_bundle.mjs — не редактировать вручную. */
export const DEMO_PROFILE = ${JSON.stringify(demoProfile)};
export const DEMO_FILES = ${JSON.stringify(
  demoFiles.map((p) => ({ name: p.split('/').pop(), text: read(p) })))};
export const LEGACY_PROFILE = ${JSON.stringify(JSON.parse(read('profiles/geont-kz.profile.json')))};
export const LEGACY_FILES = ${JSON.stringify([{ name: legacy.split('/').pop(), text: read(legacy) }])};
export const DEMO_CORPUS_FILES = ${JSON.stringify(['glossary.csv', 'documents.csv', 'formal.json'].map((n) => ({
  name: n === 'formal.json' ? 'synthetic-corpus-formal.json' : 'synthetic-' + n, text: read('data/synthetic-corpus/' + n) })))};
`;
writeFileSync(join(ROOT, 'src/demo-data.js'), demoModule);

// ---- 2. esbuild -----------------------------------------------------------
const result = await esbuild.build({
  entryPoints: [join(ROOT, 'src/entry.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  write: false,
  charset: 'utf8',
  // Apps Script (HtmlService) вырезает «//…» до конца строки внутри шаблонных
  // строк `…` — демонабор и CSS ломались. Поэтому шаблонные строки не используем:
  // esbuild превращает их в обычные кавычки с \n, которые HtmlService не трогает.
  supported: { 'template-literal': false },
});
// U+FFFD внутри строковых литералов полифилла string_decoder заменяем
// на escape-последовательность: смысл тот же, а файл остаётся чистым ASCII-safe
// шаблонных строк после esbuild нет; оставшиеся ` стоят внутри строк и регулярных
// выражений — пишем их как \x60 (тот же символ), чтобы в бандле не было ни одного `
const js = result.outputFiles[0].text.replace(/\uFFFD/g, '\\uFFFD').replace(/\\?`/g, '\\x60');   // и «\`», и «`» → \x60

// ---- 3. index.html --------------------------------------------------------
const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OntoLens — визуализатор прикладных онтологий</title>
<meta name="description" content="Экспертная валидация прикладных онтологий: карточка термина на трёх языках, документ-источник, иерархия, диагностика дефектов. Работает с диска, без сети.">
<style>html,body{margin:0;height:100%;background:#F2F1EC;font:14px/1.4 "PT Sans",system-ui,sans-serif}
#app{height:100%}
#boot{display:flex;align-items:center;justify-content:center;height:100%;color:#8A867D;font-size:13px}</style>
</head>
<body>
<div id="app"><div id="boot">OntoLens…</div></div>
<noscript><p style="padding:24px">Для работы нужен включённый JavaScript. Данные при этом никуда не передаются: разбор идёт в браузере.</p></noscript>
<script>
${js}
</script>
</body>
</html>
`;
mkdirSync(join(ROOT, 'dist'), { recursive: true });
writeFileSync(join(ROOT, 'dist/index.html'), html);

// вариант для публикации как артефакта: без doctype/html/head/body —
// скелет страницы добавляется при публикации
const artifact = `<title>OntoLens</title>
<style>html,body{height:100%;margin:0;background:#F2F1EC;color-scheme:light;
  font:14px/1.4 "PT Sans",system-ui,sans-serif}
#app{height:100%}
#boot{display:flex;align-items:center;justify-content:center;height:100%;color:#8A867D;font-size:13px}</style>
<div id="app"><div id="boot">OntoLens…</div></div>
<script>
${js}
</script>
`;
writeFileSync(join(ROOT, 'dist/artifact.html'), artifact);

const kb = (n) => (n / 1024).toFixed(1) + ' КБ';
console.log('dist/index.html        ', kb(statSync(join(ROOT, 'dist/index.html')).size));
console.log('  из них JS            ', kb(Buffer.byteLength(js, 'utf8')));
console.log('  из них демонабор     ', kb(Buffer.byteLength(demoModule, 'utf8')));

// ---- 4. платформа (ТЗ v2.2): dist/platform.js + dist/platform.html ----------
const plat = await esbuild.build({
  entryPoints: [join(ROOT, 'src/platform-entry.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  write: false,
  charset: 'utf8',
  supported: { 'template-literal': false },
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'error',
});
const pjs = plat.outputFiles[0].text.replace(/�/g, '\\uFFFD').replace(/\\?`/g, '\\x60');
writeFileSync(join(ROOT, 'dist/platform.js'), pjs);
writeFileSync(join(ROOT, 'dist/platform.html'), `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OntoLens-KZ</title>
<style>html,body{margin:0;height:100%;background:#F2F1EC;font:14px/1.4 "PT Sans",system-ui,sans-serif}#app{height:100%}</style>
</head>
<body>
<div id="app"><div style="display:flex;align-items:center;justify-content:center;height:100%;color:#6B675E">OntoLens…</div></div>
<script>
${pjs}
</script>
</body>
</html>
`);
console.log('dist/platform.js       ', kb(Buffer.byteLength(pjs, 'utf8')));
