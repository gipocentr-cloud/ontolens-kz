/**
 * Подготовка поставки для Google Диска (веб-версия на Apps Script).
 *  deploy/payload/ — части собранной страницы, манифест, демонабор;
 *  deploy/uploader.html — страница-загрузчик (артефакт с доступом к Google Диску).
 *
 * Запуск после сборки: node build/make_deploy.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'deploy');
const PAY = join(OUT, 'payload');
rmSync(PAY, { recursive: true, force: true });
mkdirSync(PAY, { recursive: true });

// папки на Диске (созданы заранее в web-OntoLens)
const FOLDERS = {
  app: '1y98mSCQjC9tPTBRBJ73Ai_yw2Tb5HPhO',
  demo: '1gDtyA16i22Ya6U7XvkcKTYzafCxHnMIa',
};

const dist = readFileSync(join(ROOT, 'dist/index.html'), 'utf8');
const d = new Date();
const ymd = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
const BUILD = `${ymd}-${createHash('md5').update(dist).digest('hex').slice(0, 6)}`;

// части не больше ~200 КБ: у вызова коннектора предел 1 МиБ на входные данные
const PARTS = Math.max(1, Math.ceil(Buffer.byteLength(dist) / 200000));
const size = Math.ceil(dist.length / PARTS);
const items = [];
const parts = [];
for (let i = 0; i < PARTS; i++) {
  const title = `OntoLens-app-${BUILD}-${i + 1}.html`;
  const path = `payload/app-${i + 1}.txt`;
  writeFileSync(join(OUT, path), dist.slice(i * size, (i + 1) * size));
  parts.push(title);
  items.push({ group: 'app', title, path, parent: FOLDERS.app, mime: 'text/html' });
}
// манифест — последним: пока его нет, сервер собирает прежнюю сборку
writeFileSync(join(PAY, 'manifest.txt'), JSON.stringify({ build: BUILD, parts, created: d.toISOString() }));
items.push({ group: 'app', title: 'OntoLens-app.json', path: 'payload/manifest.txt', parent: FOLDERS.app, mime: 'application/json', manifest: true });

const demo = [
  ['data/demo-geodeticont-kz.ttl', 'text/turtle'],
  ['data/demo-geodeticont-kz-docs.ttl', 'text/turtle'],
  ['data/demo-geodeticont-kz-shapes.ttl', 'text/turtle'],
  ['profiles/geodeticont-kz.profile.json', 'application/json'],
];
for (const [src, mime] of demo) {
  const title = src.split('/').pop();
  const path = `payload/${title}.txt`;
  writeFileSync(join(OUT, path), readFileSync(join(ROOT, src), 'utf8'));
  items.push({ group: 'demo', title, path, parent: FOLDERS.demo, mime, once: true });
}

for (const x of items) x.bytes = Buffer.byteLength(readFileSync(join(OUT, x.path)));
const tpl = readFileSync(join(ROOT, 'build/uploader.tpl.html'), 'utf8');
writeFileSync(join(OUT, 'uploader.html'), tpl
  .replace('/*__ITEMS__*/[]', JSON.stringify(items))
  .replace(/__BUILD__/g, BUILD)
  .replace('/*__FOLDERS__*/{}', JSON.stringify(FOLDERS)));

const files = Object.fromEntries(items.map((x) => [x.path, join('deploy', x.path)]));
writeFileSync(join(OUT, 'files.json'), JSON.stringify(files, null, 2));
console.log('build', BUILD, 'parts', PARTS, 'items', items.length);
