import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
import { fileURLToPath } from 'node:url'; import { dirname, join } from 'node:path'; const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
import { pathToFileURL } from 'node:url';
const b = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs=[]; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
await p.goto(pathToFileURL(ROOT + '/dist/index.html').href);
await p.waitForSelector('.startcard');
await p.setInputFiles('.startcard input[type=file]', [ROOT + '/tests/fixtures/tricky.ttl', ROOT + '/tests/fixtures/broken.ttl']);
await p.waitForSelector('.topbar'); await p.waitForTimeout(600);
const r = await p.evaluate(() => { const S = window.__ontolens.state; const m = Object.fromEntries(S.metrics.map((x) => [x.id, String(x.value)]));
  return { triples: S.model.tripleCount, parseErrors: S.model.parseErrors, classes_ns: m.classes_ns, classes_all: m.classes_all, other: m.classes_other_ns,
    tags: m.tags, label_tags: m.label_tags, depth: m.depth, noParent: S.checks.find(c=>c.id==='no-parent').count,
    roots: S.model.nsRoots.map(e=>e.local), banner: !!document.querySelector('.loadwarn'),
    labelA: S.model.entities.get('http://example.org/tricky#A').labels, defA: S.model.entities.get('http://example.org/tricky#A').definitions,
    badTags: S.checks.find(c=>c.id==='invalid-language-tag').count };
});
console.log(JSON.stringify(r, null, 1));
import('node:fs').then((fs) => fs.writeFileSync(ROOT + '/tests/out/report3.json', JSON.stringify({ ...r, console: errs }, null, 2)));
await p.screenshot({ path: ROOT + '/tests/out/26-parse-error.png' });
console.log('errors:', errs);
await b.close();
