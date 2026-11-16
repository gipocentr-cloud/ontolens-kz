/**
 * Точка входа платформы OntoLens-KZ (ТЗ v2.2).
 *
 * Конфигурация — window.ONTOLENS_CONFIG = {firebase: {...}} (задаёт загрузчик на хостинге).
 * Без неё, или с ?demo в адресе, платформа работает на демонстрационном сервере
 * в браузере: данные — в localStorage, правила доступа — те же, что в Firestore.
 */
import { startShell } from './platform/shell.js';
import { createMockBackend } from './platform/backend-mock.js';
import { createFirebaseBackend } from './platform/backend-firebase.js';
import { DEMO_FILES, DEMO_PROFILE, DEMO_CORPUS_FILES } from './demo-data.js';
import { corpusFromFiles } from './corpus/glossary.js';
import { resolveSpec } from './corpus/spec.js';
import { select } from './app.js';

async function seedDemo(b) {
  // заполняем пустую демобазу от имени первого администратора
  await b.signIn('gipocentr@gmail.com', 'Шахнович А.');
  await b.me();
  if ((await b.listOntologies()).length) { await b.signOut(); return; }
  await b.savePerson({ email: 'gipocentr@gmail.com', name: 'Шахнович А.', role: 'admin' });
  await b.savePerson({ email: 'editor@example.com', name: 'Редактор Р. Р.', role: 'member' });
  await b.savePerson({ email: 'expert1@example.com', name: 'Эксперт А. А.', role: 'member' });
  await b.savePerson({ email: 'expert2@example.com', name: 'Эксперт Б. Б.', role: 'member' });
  await b.savePerson({ email: 'terminolog@example.com', name: 'Терминолог Т. Т.', role: 'member' });
  await b.savePerson({ email: 'jurist@example.com', name: 'Юрист Ю. Ю.', role: 'member' });
  await b.savePerson({ email: 'tim@example.com', name: 'Специалист ТИМ С. С.', role: 'member' });
  await b.createOntology({ id: 'geodeticont-kz', title: 'GeodeticOnt-KZ — строительная геодезия (демонабор)',
    description: 'Синтетический набор: 119 терминов, 16 блоков.', editors: ['editor@example.com'],
    experts: ['expert1@example.com', 'expert2@example.com'] });
  await b.publishVersion('geodeticont-kz', { files: DEMO_FILES, profile: DEMO_PROFILE, profileName: 'geodeticont-kz.profile.json',
    metrics: { terms: 119, collections: 16 }, note: 'демонабор' });
  // корпус определений (ТЗ v3.1): глоссарии CSV + работа редактора над формализацией
  await b.createOntology({ id: 'tkn-corpus', title: 'Корпус определений ТКН ТИМСО — проверка коллизий (синтетический)',
    description: '5 документов (Строительный кодекс, ТКН, СТ РК ISO 19650-1, СН РК двух редакций), 23 определения, заложенные коллизии.',
    editors: ['terminolog@example.com'], experts: ['jurist@example.com', 'tim@example.com'] });
  await b.publishVersion('tkn-corpus', { files: DEMO_CORPUS_FILES.filter((f) => /\.csv$/.test(f.name)), metrics: {}, note: 'синтетический корпус' });
  const corpus = corpusFromFiles(DEMO_CORPUS_FILES.filter((f) => /\.csv$/.test(f.name)), { name: 'tkn-corpus' });
  const spec = resolveSpec(corpus, JSON.parse(DEMO_CORPUS_FILES.find((f) => /\.json$/.test(f.name)).text));
  for (const k of spec.classes) await b.saveWork('tkn-corpus', 'class', k.id, k);
  for (const p of spec.props) await b.saveWork('tkn-corpus', 'prop', p.id, p);
  for (const a of spec.axioms) await b.saveWork('tkn-corpus', 'axiom', a.id, a);
  for (const [id, f] of Object.entries(spec.formal)) await b.saveWork('tkn-corpus', 'formal', id, { ...f, by: 'terminolog@example.com', date: '2026-10-06' });
  await b.signOut();
}

export async function startPlatform(mount, opts = {}) {
  const cfg = opts.config || window.ONTOLENS_CONFIG || {};
  const params = new URLSearchParams(location.search);
  let backend;
  if (cfg.firebase && params.get('demo') == null && !opts.mock) {
    backend = createFirebaseBackend(cfg.firebase);
  } else {
    backend = createMockBackend({ storageKey: opts.storageKey === undefined ? 'ontolens.demo.db.v2' : opts.storageKey, latency: opts.latency || 0 });
    await seedDemo(backend);
  }
  window.__ontolensPlatform = startShell(mount, backend, { mockEmail: opts.mockEmail });
  window.__ontolensBackend = backend;
  window.__olSelect = select;
  return backend;
}

const mount = document.getElementById('app');
if (mount && !window.__OL_NO_AUTOSTART__) {
  mount.innerHTML = '';
  startPlatform(mount).catch((e) => {
    mount.innerHTML = '<pre style="padding:20px;white-space:pre-wrap;color:#8E2F27">'
      + String(e && e.stack || e).replace(/[<&]/g, (c) => ({ '<': '&lt;', '&': '&amp;' }[c])) + '</pre>';
  });
}
