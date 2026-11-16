/**
 * OntoLens — визуализатор прикладных онтологий для экспертной валидации.
 * Релиз 1, ядро: 5.1 загрузка и модель, 5.2 браузер концептов, 5.5 диагностика.
 * Разделы 5.3 (карта и семантический зум) и 5.4 (сбор замечаний) — следующая итерация.
 */
import { buildModel, search, labelOf, allLabels, KIND } from './core/model.js';
import { DEFAULT_PROFILE, mergeProfile, NS, rx } from './core/profile.js';
import { runDiagnostics, computeMetrics, shortProp } from './core/diagnostics.js';
import { neighbourhood, layout, renderGraph, NODE_COLORS, layoutLOD, renderGraphLOD, lodLevel } from './core/graph.js';
import { obtainMapLayout, computeMapLayout } from './core/maplayout.js';
import { MiniMap } from './ui/minimap.js';
import { CSS } from './ui/styles.js';
import {
  VERDICTS, VERDICT_BY_CODE, validateRecord, normaliseRecord, loadReview, saveReview, storageAvailable,
  reviewToCsv, reviewToJson, slug, parseReviewFile, summarise, FIX_FIELDS, loadPref, savePref,
  findOtherReviews, carryOver,
} from './core/review.js';
import { makeT, pickLang, plural } from './ui/i18n.js';
import { mergeReviews, makeSyncQueue } from './platform.js';
import { makeCorpusUI, splitCorpusFiles, corpusForViewer, corpusViewerFiles } from './ui/corpus-ui.js';
import { corpusProfile } from './corpus/glossary.js';
import {
  fsSupported, scanVault, versionFiles, readReviewFiles, writeText, makeFileWorkStore, kvGet, kvSet, permission,
  treeFromFileList, readText, WORK_DIR, DIRECTION_PREFIX,
} from './core/vault.js';

const VERSION = '3.1.0 · 261116';

// --------------------------------------------------------------------------
//  Мини-DOM
// --------------------------------------------------------------------------
function h(tag, attrs, ...kids) {
  const m = /^([a-z0-9]+)((?:[.#][\w-]+)*)$/i.exec(tag) || [];
  const name = m[1] || tag;
  const e = document.createElement(name);
  if (m[2]) {
    for (const part of m[2].split(/(?=[.#])/)) {
      if (part[0] === '.') e.classList.add(part.slice(1));
      else if (part[0] === '#') e.id = part.slice(1);
    }
  }
  if (attrs && (attrs.constructor === Object)) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className += (e.className ? ' ' : '') + v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'text') e.textContent = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
  } else if (attrs != null) {
    kids.unshift(attrs);
  }
  for (const k of kids.flat(3)) {
    if (k == null || k === false) continue;
    e.appendChild(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return e;
}
const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };

// --------------------------------------------------------------------------
//  Всплывающие подсказки: один плавающий элемент на всю страницу.
//  Показываются и по наведению, и при переходе на элемент с клавиатуры.
// --------------------------------------------------------------------------
let tipEl = null, tipTimer = null, tipFor = null;

function hideTip() {
  clearTimeout(tipTimer);
  tipFor = null;
  if (tipEl) { tipEl.classList.remove('on'); tipEl.hidden = true; }
}

function showTip(el, instant) {
  const text = el.getAttribute('data-tip');
  if (!text) return;
  clearTimeout(tipTimer);
  tipFor = el;
  tipTimer = setTimeout(() => {
    if (tipFor !== el || !el.isConnected) return;
    if (!tipEl) { tipEl = h('div.ol-tip', { role: 'tooltip' }); document.body.appendChild(tipEl); }
    clear(tipEl);
    const key = el.getAttribute('data-tip-title');
    if (key) tipEl.appendChild(h('b', key));
    tipEl.appendChild(document.createTextNode(text));
    tipEl.hidden = false;
    tipEl.style.left = '0px'; tipEl.style.top = '0px';
    const r = el.getBoundingClientRect();
    const t = tipEl.getBoundingClientRect();
    let x = r.left + r.width / 2 - t.width / 2;
    x = Math.max(8, Math.min(x, window.innerWidth - t.width - 8));
    let y = r.bottom + 8;
    if (y + t.height > window.innerHeight - 8) y = Math.max(8, r.top - t.height - 8);
    tipEl.style.left = Math.round(x) + 'px';
    tipEl.style.top = Math.round(y) + 'px';
    tipEl.classList.add('on');
  }, instant ? 0 : 350);
}

function initTooltips() {
  document.addEventListener('pointerover', (ev) => {
    const el = ev.target.closest && ev.target.closest('[data-tip]');
    if (el) showTip(el); else if (tipFor) hideTip();
  });
  document.addEventListener('pointerdown', hideTip);
  document.addEventListener('focusin', (ev) => {
    const el = ev.target.closest && ev.target.closest('[data-tip]');
    if (el) showTip(el, true); else hideTip();
  });
  document.addEventListener('focusout', hideTip);
  window.addEventListener('scroll', hideTip, true);
  window.addEventListener('resize', hideTip);
}

// --------------------------------------------------------------------------
//  Модальное окно
// --------------------------------------------------------------------------
function modal(title, bodyNodes, footerNodes) {
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } };
  const ov = h('div.ol-overlay', { onclick: (ev) => { if (ev.target === ov) close(); } },
    h('div.ol-modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('header',
        h('h2', title),
        h('button.btn', { onclick: close, 'data-tip': 'Esc' }, '✕')),
      h('div', { class: 'body', tabindex: '0' }, ...bodyNodes),
      h('footer', ...(footerNodes || [h('span'), h('button.btn.primary', { onclick: close }, 'Закрыть')]))));
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(ov);
  const first = ov.querySelector('button, textarea, a[href]');
  if (first) first.focus();
  return close;
}

// --------------------------------------------------------------------------
//  Состояние
// --------------------------------------------------------------------------
const S = {
  model: null,
  profile: DEFAULT_PROFILE,
  profileName: 'встроенный',
  lang: 'ru',
  role: 'expert',
  view: 'terms',            // terms | diag
  leftTab: 'blocks',        // blocks | hierarchy | properties
  selected: null,
  expanded: new Set(),
  query: '',
  fuzzy: false,
  checks: [],
  metrics: [],
  activeCheck: null,
  depth: 1,
  graphTransform: { x: 0, y: 0, k: 1 },
  loadError: null,
  files: [],
  // 5.4 — замечания
  review: { expert: '', items: {} },
  reviewStorage: true,
  imported: [],            // [{expert, items, file}]
  rightTab: 'review',      // review | info
  reviewsFilter: 'remarks', // all | remarks | disagree | unreviewed
  flash: null,             // {kind, text}
  trail: [],               // последние посещённые сущности (след на карте)
  mapInfo: null,           // {layout, source, ms}
  suppliedLayout: null,    // map-layout.json, приложенный к онтологии
  lastZoomMs: null,
  // веб-версия (Apps Script)
  srv: null,                   // работа на платформе: {backend, ontology, vid, email, name, role, preview, onBack, onPublished}
  ontVersion: '',              // версия онтологии на сервере
  sync: { pending: 0, lastOk: null, error: null },
  serverReviews: null,         // [{email, expert, items}] — для редактора
  others: null,                // {iri, hidden, items} — оценки коллег по текущему термину
  cx: null,                    // корпус определений (ТЗ v3.1): {corpus, work, res, …}
  // хранилище моделей на диске (папка OntoLens_Files): {root, scan, perm, busy, error, readOnly, current, last}
  vault: { root: null, scan: null, perm: null, busy: false, error: null, readOnly: false, current: null, last: null },
};
let syncQ = null;
let minimap = null;
let T = makeT('ru');

// --------------------------------------------------------------------------
//  Загрузка
// --------------------------------------------------------------------------
async function loadTexts(files, profileOverride) {
  S.loadError = null;
  try {
    // корпус определений: глоссарии CSV → TTL для просмотрщика; формализация — отдельно (ТЗ v3.1)
    const cp = splitCorpusFiles(files);
    const cv = cp.csv.length ? corpusForViewer(cp, S.srv ? S.srv.ontology.id : cp.csv[0].name.replace(/\.[^.]+$/, '')) : null;
    S.profile = mergeProfile(DEFAULT_PROFILE, profileOverride || (cv ? cv.profile : null));
    const t0 = performance.now();
    const model = buildModel(cv ? cv.files : files, S.profile);
    if (cv) model.hash = cv.hash;
    if (model.parseErrors.length && model.tripleCount === 0) {
      S.loadError = model.parseErrors.map((e) => `${e.file}: ${e.message}`).join('\n');
      S.model = null;
    } else {
      S.model = model;
      S.model.wallMs = Math.round(performance.now() - t0);
      S.checks = runDiagnostics(model);
      S.metrics = computeMetrics(model);
      S.files = files.map((f) => f.name);
      S.fileTexts = files;
      S.profileRaw = profileOverride || null;
      const firstTerm = model.classes.find((e) => e.isTerm) || model.classes[0];
      S.selected = firstTerm ? firstTerm.iri : null;
      S.expanded = new Set();
      if (model.collections.length) S.leftTab = 'blocks';
      else S.leftTab = 'hierarchy';
      if (S.selected) expandTo(S.selected);
      const ranked = S.checks.filter((c) => c.count > 0)
        .sort((a, b) => ({ error: 0, warn: 1, info: 2 }[a.severity] - { error: 0, warn: 1, info: 2 }[b.severity])
          || b.count - a.count);
      S.activeCheck = ranked[0] || S.checks[0];
      _orderCache = { key: null, list: [] };
      const firstInOrder = termOrder()[0];
      if (firstInOrder) { S.selected = firstInOrder; S.expanded = new Set(); expandTo(firstInOrder); }
      S.reviewStorage = storageAvailable();
      S.review = loadReview(reviewKey(model.hash));
      if (!S.review.expert) S.review.expert = loadPref('expert', '');
      S.otherReviews = S.srv ? [] : (Object.keys(S.review.items).length ? [] : findOtherReviews(model.hash)
        .filter((x) => !x.mainNs || x.mainNs === model.mainNs));
      if (S.srv) S.review.expert = S.srv.name;
      S.imported = [];
      S.rightTab = S.role === 'author' ? 'info' : 'review';
      S.trail = [];
      S.parseDismissed = false;
      buildMinimap();
      S.cx = null;
      if (cv) {
        await cxUI.attach(cv.corpus, cp, model.hash);
        Object.assign(S.cx, { ttlName: cv.ttlName, rest: cv.rest });
        rebuildCorpusModel();
        S.view = 'conflicts';
        S.profileName = 'корпус определений';
      } else if (['conflicts', 'formal', 'axioms'].includes(S.view)) S.view = 'terms';
    }
  } catch (err) {
    S.loadError = String(err && err.stack || err);
    S.model = null;
  }
  render();
}

function readFileList(list) {
  return Promise.all([...list].map((f) => f.text().then((text) => ({ name: f.name, text }))));
}

function expandTo(iri) {
  const E = S.model.entities;
  let cur = E.get(iri);
  const guard = new Set();
  while (cur && !guard.has(cur.iri)) {
    guard.add(cur.iri);
    for (const c of cur.collections) S.expanded.add(c);
    const p = cur.parents.map((x) => E.get(x)).filter((x) => x && !x.external)[0];
    if (!p) break;
    S.expanded.add(p.iri);
    cur = p;
  }
}

function buildMinimap() {
  S.mapInfo = obtainMapLayout(S.model, S.suppliedLayout);
  const prefs = loadPref('minimap', null) || {
    collapsed: false, expanded: false, corner: (S.profile.map && S.profile.map.corner) || 'bottom-right',
  };
  const m = S.model;
  minimap = new MiniMap({
    layout: S.mapInfo.layout,
    model: m,
    verdictOf: (iri) => (S.review.items[iri] && S.review.items[iri].verdict) || null,
    verdictColor: (code) => (VERDICT_BY_CODE[code] ? VERDICT_BY_CODE[code].color : '#D6D3CC'),
    isReviewable: (iri) => isReviewable(m.entities.get(iri)),
    labelOf: (iri) => labelOf(m, m.entities.get(iri), S.lang).text,
    islandLabel: (is) => (is.labelIri ? labelOf(m, m.entities.get(is.labelIri), S.lang).text : T('mapIslandOther')(is.label)),
    onSelect: (iri) => select(iri),
    onExport: () => download(JSON.stringify(S.mapInfo.layout), 'map-layout.json', 'application/json'),
    prefs,
    savePrefs: (p) => savePref('minimap', p),
    texts: {
      title: T('mapTitle'), here: T('mapHere'), outside: T('mapOutside'),
      expand: T('tips').mapExpand, shrink: T('tips').mapShrink, corner: T('tips').mapCorner,
      collapse: T('tips').mapCollapse, export: T('tips').mapExport,
    },
  });
}

function select(iri) {
  if (S.selected && S.selected !== iri) {
    S.trail = S.trail.filter((x) => x !== S.selected);
    S.trail.push(S.selected);
    if (S.trail.length > 10) S.trail.shift();
  }
  S.selected = iri;
  S.view = 'terms';
  S.graphTransform = { x: 0, y: 0, k: 1 };
  expandTo(iri);
  render();
  const c = document.querySelector('.card h1');
  if (c) c.setAttribute('tabindex', '-1');
}

// --------------------------------------------------------------------------
//  Рендер: корень
// --------------------------------------------------------------------------
let root = null;
function render() {
  T = makeT(S.lang);
  document.documentElement.lang = S.lang;
  const app = clear(root);
  if (!S.model) { app.appendChild(startScreen()); return; }
  app.appendChild(topbar());
  if (S.srv && S.srv.preview) {
    const errs = S.model.parseErrors.length;
    app.appendChild(h('div.previewbar', { role: 'region', 'aria-label': T('srvPreviewTag') },
      h('b', T('srvPreviewTitle')(S.srv.ontology.title)),
      h('span', T('srvPreviewInfo')(S.files.length, S.model.tripleCount, errs)),
      h('div.spacer'),
      h('button.btn', { onclick: () => S.srv.onBack() }, T('srvCancel')),
      h('button.btn.primary', { disabled: errs > 0 ? true : null, 'data-tip': errs ? T('srvPublishBlocked') : T('srvPublishTip'),
        onclick: (ev) => { ev.target.disabled = true; ev.target.textContent = T('srvPublishing'); S.srv.onPublish(previewPayload()); } },
        T('srvPublish'))));
  }
  if (S.model.parseErrors.length && !S.parseDismissed) {
    app.appendChild(h('div.loadwarn', { role: 'alert' },
      h('b', T('parseWarn')(S.model.parseErrors.length)),
      ...S.model.parseErrors.map((x) => h('span', h('code.mono', x.file), ': ', x.message)),
      h('button.linkbtn', { onclick: () => { S.view = 'diag'; S.activeCheck = S.checks.find((c) => c.id === 'parse-errors'); render(); } }, T('details')),
      h('button.btn', { onclick: () => { S.parseDismissed = true; render(); }, 'aria-label': T('close') }, '✕')));
  }
  const cxPanes = S.cx ? cxUI.panes() : null;
  if (!cxPanes) app.appendChild(crumbs());
  const main = h('div.main');
  if (cxPanes) {
    cxPanes.forEach((p) => main.appendChild(p));
  } else if (S.view === 'diag') {
    main.appendChild(diagLeft());
    main.appendChild(diagCenter());
    main.appendChild(diagRight());
  } else if (S.view === 'reviews') {
    main.appendChild(reviewsLeft());
    main.appendChild(reviewsCenter());
    main.appendChild(reviewsRight());
  } else {
    main.appendChild(termsLeft());
    main.appendChild(termsCenter());
    main.appendChild(termsRight());
  }
  app.appendChild(main);
}

// --------------------------------------------------------------------------
//  Стартовый экран
// --------------------------------------------------------------------------
function startScreen() {
  if (S.loading) {
    return h('div.start', h('div.startcard',
      h('span', { style: { fontFamily: 'var(--serif)', fontSize: '15px', color: 'var(--muted-2)' } }, 'OntoLens'),
      h('h1', T('gasLoading')), h('p.lead', T('gasLoadingLead'))));
  }
  const input = h('input', { type: 'file', 'aria-label': T('openFile'), multiple: true, accept: '.ttl,.turtle,.n3,.nt,.json,.csv,.tsv', class: 'sr',
    onchange: async (e) => { const fs = await readFileList(e.target.files); await loadFilesWithProfile(fs); } });
  const zone = h('div.dropzone',
    h('div.startrow',
      h('button.btn.primary', { onclick: () => input.click(), 'data-tip': T('tips').openFile }, T('openFile')),
      h('button.btn', { onclick: loadDemo, 'data-tip': T('tips').demo }, T('demo')),
      h('button.btn', { onclick: loadCorpusDemo, 'data-tip': 'Синтетический корпус определений: 5 документов, 23 определения, заложенные коллизии с доказательствами' }, 'Демо: коллизии терминов'),
      h('button.btn', { onclick: showHelp, 'data-tip': T('tips').help }, T('help')),
      h('span', { style: { fontSize: '12px', color: 'var(--muted-2)' } }, T('demoHint')),
    ),
    h('p', T('dropHere')),
    h('p', T('dropHint')),
  );
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => {
    e.preventDefault(); zone.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => {
    e.preventDefault(); zone.classList.remove('over');
  }));
  zone.addEventListener('drop', async (e) => {
    const fs = await readFileList(e.dataTransfer.files);
    if (fs.length) await loadFilesWithProfile(fs);
  });

  const vaultOn = !!(S.vault.root || fsSupported());
  return h('div.start',
    h('div.startcard' + (vaultOn ? '.wide' : ''),
      h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '4px' } },
        h('span', { style: { fontFamily: 'var(--serif)', fontSize: '15px', color: 'var(--muted-2)' } }, 'OntoLens'),
        h('span.mono', { style: { fontSize: '11px', color: 'var(--muted-2)' } }, VERSION)),
      h('h1', T('startTitle')),
      h('p.lead', T('startLead')),
      vaultPanel(),
      vaultOn ? h('h2.vh', { style: { marginTop: '22px' } }, 'Отдельные файлы') : null,
      zone, input,
      S.loadError ? h('div.errbox', T('loadError') + ':\n' + S.loadError) : null,
      h('div.startfoot',
        h('div', 'Поддерживается Turtle (.ttl). Можно открыть сразу несколько файлов пакета: TBox, документы, SHACL — они объединяются в один граф.'),
        h('div', { style: { marginTop: '6px' } }, 'Корпус определений для проверки коллизий: глоссарий (.csv: doc_code; clause; term_ru; def_ru; term_kk; term_en) и лист документов (.csv: doc_code; title; kind; status; year; replaces; rank), по желанию — файл формализаций (.json).'),
        h('div', { style: { marginTop: '6px' } },
          'Параметр URL: ', h('code.mono', '?src=путь.ttl'), ' — загрузить онтологию по ссылке; ',
          h('code.mono', '?profile=профиль.json'), ' — подключить профиль (раздел 7 ТЗ).'),
      ),
    ),
  );
}

async function loadFilesWithProfile(fs) {
  const layoutFile = fs.find((f) => /map-layout.*\.json$/i.test(f.name));
  S.suppliedLayout = null;
  if (layoutFile) { try { S.suppliedLayout = JSON.parse(layoutFile.text); } catch (e) { /* ignore */ } }
  if (splitCorpusFiles(fs.filter((f) => f !== layoutFile)).csv.length) { await loadTexts(fs.filter((f) => f !== layoutFile), null); return; }
  const profFile = fs.find((f) => /\.json$/i.test(f.name) && f !== layoutFile);
  const ttl = fs.filter((f) => !/\.json$/i.test(f.name));
  let prof = null;
  S.profileName = 'по умолчанию';
  if (profFile) { try { prof = JSON.parse(profFile.text); S.profileName = profFile.name; } catch (e) { /* ignore */ } }
  await loadTexts(ttl, prof);
}

async function loadCorpusDemo() {
  const { DEMO_CORPUS_FILES } = await import('./demo-data.js');
  await loadTexts(DEMO_CORPUS_FILES.map((f) => ({ name: f.name, text: f.text })), null);
}

async function loadDemo() {
  const { DEMO_FILES, DEMO_PROFILE } = await import('./demo-data.js');
  S.profileName = 'geodeticont-kz (встроенный)';
  await loadTexts(DEMO_FILES.map((f) => ({ name: f.name, text: f.text })), DEMO_PROFILE);
}

// --------------------------------------------------------------------------
//  Верхняя панель
// --------------------------------------------------------------------------
function topbar() {
  const m = S.model;
  const errors = S.checks.filter((c) => c.severity === 'error' && c.count > 0);
  const errCount = errors.reduce((a, c) => a + c.count, 0);
  const fileInput = h('input', { type: 'file', 'aria-label': T('openFile'), multiple: true, accept: '.ttl,.turtle,.n3,.nt,.json,.csv,.tsv', class: 'sr',
    onchange: async (e) => { const fs = await readFileList(e.target.files); await loadFilesWithProfile(fs); } });

  const searchInput = h('input', {
    id: 'ol-search', type: 'search', value: S.query, placeholder: T('searchPlaceholder'),
    autocomplete: 'off',
    oninput: (e) => { S.query = e.target.value; renderLeft(); },
  });

  return h('header.topbar',
    S.srv ? h('button.iconbtn.back', { onclick: () => S.srv.onBack(), 'data-tip': T('srvBackTip'), 'aria-label': T('srvBack') }, '←') : null,
    S.vault.current ? h('button.iconbtn.back', { onclick: closeToVault, 'data-tip': 'Вернуться к хранилищу: список направлений и версий', 'aria-label': 'Хранилище' }, '←') : null,
    h('div.brand', h('b', 'OntoLens'), S.srv || S.vault.current ? null : h('span', T('tagline'))),
    S.vault.current ? h('button.chip.vchip', { 'data-tip': `Хранилище «${S.vault.root ? S.vault.root.name : ''}» · ${S.vault.current.dir.name}\\${S.vault.current.ver.name}${S.vault.readOnly ? ' · только чтение' : ' · работа сохраняется в папку ' + WORK_DIR} · файлов: ${S.files.length}`, onclick: showFiles },
      h('b', S.vault.current.dir.label), h('span', S.vault.current.ver.name)) : null,
    S.vault.current ? null : S.srv ? h('button.chip', { 'data-tip': T('tips').file, onclick: showFiles },
      h('span', { style: { minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, S.srv.ontology.title),
      h('span', { style: { color: '#A8A49B', flexShrink: '0' } }, S.srv.preview ? T('srvPreviewTag') : S.ontVersion)) :
    h('button.chip', { 'data-tip': T('tips').file, onclick: showFiles },
      h('span', { style: { minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
        S.files[0] || '—'),
      S.files.length > 1 ? h('span', { style: { color: '#A8A49B', flexShrink: '0' } }, `+${S.files.length - 1}`) : null),
    h('nav.navtabs', { role: 'tablist' },
      ...(S.cx ? cxUI.tabs() : []),
      h('button', { role: 'tab', 'aria-selected': String(S.view === 'terms'),
        'data-tip': T('tips').tabTerms,
        onclick: () => { S.view = 'terms'; render(); } }, T('tabTerms')),
      srvExpert() ? null : h('button', { role: 'tab', 'aria-selected': String(S.view === 'diag'),
        'data-tip': T('tips').tabDiag,
        onclick: () => { S.view = 'diag'; render(); } }, T('tabDiag')),
      h('button', { role: 'tab', 'aria-selected': String(S.view === 'reviews'),
        'data-tip': T('tips').tabReview,
        onclick: () => { S.view = 'reviews'; render(); } }, T('tabReview')),
    ),
    h('div.spacer'),
    cxView() ? null : h('div.searchbox', { 'data-tip': T('tips').search },
      h('label.sr', { for: 'ol-search' }, T('search')),
      searchInput,
      h('span.hint', 'ru · kk · en')),
    errCount && !srvExpert() ? h('button.chip.warn', {
      'data-tip': T('tips').errors + ' — ' + errors.map((c) => pickLang(c.title, S.lang) + ': ' + c.count).join('; '),
      'data-tip-title': `${errors.length} ${S.lang === 'ru' ? plural(errors.length, ['категория', 'категории', 'категорий']) : 'cat.'}`,
      onclick: () => {
        S.view = 'diag';
        S.activeCheck = errors.slice().sort((a, b) => b.count - a.count)[0];
        render();
      },
    }, T('errorsIn')(errCount, errors.length)) : null,
    h('div.seg', { 'data-tip': T('tips').lang }, ...S.profile.languages.map((l) => h('button', {
      'aria-pressed': String(S.lang === l),
      onclick: () => { S.lang = l; render(); },
    }, l.toUpperCase()))),
    h('div.who',
      cxView() ? null : (() => {
        const pr = reviewProgress();
        return h('button.progress-chip', {
          'data-tip': T('tips').progress, onclick: goNextUnreviewed,
        }, `${pr.done} / ${pr.total}`);
      })(),
      S.srv ? h('span.whoami', { 'data-tip': S.srv.email }, S.srv.name, h('small', ' · ' + T(S.srv.role === 'editor' ? 'roleEditor' : 'roleExpert'))) : null,
      srvExpert() ? null : h('div.seg', { 'data-tip': T('tips').role },
        h('button', { 'aria-pressed': String(S.role === 'expert'), onclick: () => { S.role = 'expert'; render(); } }, T('roleExpert')),
        h('button', { 'aria-pressed': String(S.role === 'author'), onclick: () => { S.role = 'author'; render(); } }, T('roleAuthor'))),
      (S.srv && !S.srv.preview) ? null : h('button.btn.addfiles', { onclick: () => fileInput.click(), 'data-tip': T('tips').addFiles,
        style: { background: '#26282D', borderColor: '#3A3D44', color: '#CFCBC2' } }, T('addFiles')),
      (S.srv && !S.srv.preview) ? null : h('button.iconbtn.addfiles-icon', { onclick: () => fileInput.click(),
        'data-tip': T('tips').addFiles, 'aria-label': T('addFiles') }, '+'),
      h('button.iconbtn', { onclick: showHelp, 'data-tip': T('tips').help,
        'aria-label': T('help') }, '?'),
      fileInput,
    ),
  );
}

function crumbs() {
  const m = S.model;
  if (S.view === 'diag') {
    return h('div.crumbs',
      h('div.path', h('b', T('tabDiag')),
        h('span', { style: { color: 'var(--muted-2)' } }, '·'),
        h('span', T('checksDone')(S.checks.filter((c) => c.count > 0).length, S.checks.length))),
      h('div', h('span.pill', `${T('profileIs')}: ${S.profileName}`)),
    );
  }
  const e = S.selected && m.entities.get(S.selected);
  const path = [];
  if (e) {
    let cur = e;
    const guard = new Set();
    while (cur && !guard.has(cur.iri)) {
      guard.add(cur.iri);
      path.unshift(cur);
      cur = cur.parents.map((p) => m.entities.get(p)).filter((p) => p && !p.external)[0];
    }
  }
  const coll = e && e.collections.length ? m.entities.get(e.collections[0]) : null;
  const nodes = [];
  path.forEach((p, i) => {
    if (i) nodes.push(h('span', { style: { color: 'var(--muted-2)' } }, '›'));
    nodes.push(i === path.length - 1
      ? h('b', labelOf(m, p, S.lang).text)
      : h('button.link', { onclick: () => select(p.iri), 'data-tip': T('tips').crumb },
        labelOf(m, p, S.lang).text));
  });
  return h('div.crumbs',
    h('div.path', ...(nodes.length ? nodes : [h('span', T('noSelection'))]),
      coll ? h('span.pill', labelOf(m, coll, S.lang).text) : null),
    h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
      h('span.pill', `${m.loadMs} ${T('ms')}`),
      h('span.pill', T('triplesFmt')(m.tripleCount)),
      h('span.pill', T('classesTermsFmt')(m.classes.length, m.classes.filter((x) => x.isTerm).length))),
  );
}

// --------------------------------------------------------------------------
//  Левая панель — блоки / иерархия / свойства
// --------------------------------------------------------------------------
function renderLeft(focusKey) {
  const old = document.querySelector('.main > .left');
  if (!old) return render();
  const fresh = S.view === 'diag' ? diagLeft() : termsLeft();
  old.replaceWith(fresh);
  if (focusKey) {
    const el = [...fresh.querySelectorAll('[data-key]')].find((x) => x.getAttribute('data-key') === focusKey);
    if (el) el.focus();
  }
}

/**
 * Навигация по дереву с клавиатуры (ТЗ, раздел 6): ↑/↓ — соседняя строка,
 * → — раскрыть, ← — свернуть или перейти к родительской строке,
 * Home/End — первая/последняя, Enter/пробел — открыть карточку.
 */
function treeKeys(ev) {
  const cur = ev.target.closest && ev.target.closest('[data-key]');
  if (!cur) return;
  const rows = [...ev.currentTarget.querySelectorAll('.row[data-key], .blockrow[data-key]')];
  const i = rows.indexOf(cur);
  const key = cur.getAttribute('data-key');
  const isBlock = cur.classList.contains('blockrow');
  const expanded = cur.getAttribute('aria-expanded') === 'true';
  const go = (j) => { const t = rows[Math.max(0, Math.min(rows.length - 1, j))]; if (t) t.focus(); };
  switch (ev.key) {
    case 'ArrowDown': ev.preventDefault(); go(i + 1); break;
    case 'ArrowUp': ev.preventDefault(); go(i - 1); break;
    case 'Home': ev.preventDefault(); go(0); break;
    case 'End': ev.preventDefault(); go(rows.length - 1); break;
    case 'ArrowRight':
      ev.preventDefault();
      if ((isBlock || cur.getAttribute('data-kids')) && !expanded) { S.expanded.add(key); renderLeft(key); }
      else go(i + 1);
      break;
    case 'ArrowLeft': {
      ev.preventDefault();
      if (expanded) { S.expanded.delete(key); renderLeft(key); break; }
      // к родительской строке: ближайшая выше с меньшим отступом или блок
      const pad = parseFloat(cur.style.paddingLeft) || 0;
      for (let j = i - 1; j >= 0; j--) {
        const r = rows[j];
        if (r.classList.contains('blockrow') || (parseFloat(r.style.paddingLeft) || 0) < pad) { r.focus(); break; }
      }
      break;
    }
    default:
  }
}

function termsLeft() {
  const m = S.model;
  const left = h('aside.left');
  left.appendChild(h('div.tabs', { role: 'tablist' },
    m.collections.length ? h('button', {
      role: 'tab', 'aria-selected': String(S.leftTab === 'blocks'), 'data-tip': T('tips').blocks,
      onclick: () => { S.leftTab = 'blocks'; renderLeft(); },
    }, `${T('blocks')} (${m.collections.length})`) : null,
    h('button', {
      role: 'tab', 'aria-selected': String(S.leftTab === 'hierarchy'), 'data-tip': T('tips').hierarchy,
      onclick: () => { S.leftTab = 'hierarchy'; renderLeft(); },
    }, T('hierarchy')),
    h('button', {
      role: 'tab', 'aria-selected': String(S.leftTab === 'properties'), 'data-tip': T('tips').properties,
      onclick: () => { S.leftTab = 'properties'; renderLeft(); },
    }, T('properties')),
  ));

  if (S.query.trim()) {
    left.appendChild(searchResults());
    return left;
  }
  const scroll = h('div.scroll', { onkeydown: treeKeys, 'aria-label': T('treeNav') });
  if (S.leftTab === 'blocks') scroll.appendChild(blocksTree());
  else if (S.leftTab === 'hierarchy') scroll.appendChild(hierarchyTree());
  else scroll.appendChild(propertiesList());
  left.appendChild(scroll);
  return left;
}

function highlight(text, q) {
  if (!q) return document.createTextNode(text);
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return document.createTextNode(text);
  const f = document.createDocumentFragment();
  f.appendChild(document.createTextNode(text.slice(0, i)));
  f.appendChild(h('mark', text.slice(i, i + q.length)));
  f.appendChild(document.createTextNode(text.slice(i + q.length)));
  return f;
}

function searchResults() {
  const m = S.model;
  const res = search(m, S.query, { fuzzy: S.fuzzy, limit: 300 });
  const box = h('div');
  box.appendChild(h('div.searchmeta',
    h('span', `${T('counted')}: ${res.length}`),
    h('label', { 'data-tip': T('tips').fuzzy }, h('input', {
      type: 'checkbox', checked: S.fuzzy,
      onchange: (e) => { S.fuzzy = e.target.checked; renderLeft(); },
    }), T('fuzzy')),
    h('button.linkbtn', { onclick: () => { S.query = ''; render(); } }, T('reset')),
  ));
  const scroll = h('div.scroll');
  const tree = h('div.tree');
  if (!res.length) tree.appendChild(h('div.empty', T('nothingFound')));
  for (const r of res) {
    const e = m.entities.get(r.iri);
    const lbl = labelOf(m, e, S.lang);
    const row = h('button.row', {
      'aria-current': String(S.selected === r.iri),
      onclick: () => select(r.iri),
      title: e.curie,
    },
      h('span', { class: 'dot ' + dotClass(e) }),
      h('span.name'),
      h('span.num', r.hit && r.hit.lang ? r.hit.lang : ''),
    );
    row.querySelector('.name').appendChild(highlight(lbl.text, S.query));
    if (r.hit && r.hit.t === 'def') {
      const sub = h('div', { style: { fontSize: '11px', color: 'var(--muted-2)', padding: '0 8px 4px 23px', lineHeight: '1.35' } });
      sub.appendChild(highlight(r.hit.v.slice(0, 120), S.query));
      tree.appendChild(row); tree.appendChild(sub);
    } else {
      tree.appendChild(row);
    }
  }
  scroll.appendChild(tree);
  box.appendChild(scroll);
  const wrap = h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: '0', flexGrow: '1' } }, box);
  wrap.style.overflow = 'hidden';
  box.style.display = 'flex'; box.style.flexDirection = 'column'; box.style.minHeight = '0'; box.style.flexGrow = '1';
  return wrap;
}

function dotClass(e) {
  if (e.external) return 'external';
  if (e.kinds.has(KIND.OBJECT_PROPERTY) || e.kinds.has(KIND.DATA_PROPERTY)) return 'property';
  if (e.kinds.has(KIND.CLASS) || e.kinds.has(KIND.CONCEPT)) return e.isTerm ? 'term' : 'structural';
  return 'term';
}

function blocksTree() {
  const m = S.model;
  const tree = h('div.tree');
  for (const c of m.collections) {
    const open = S.expanded.has(c.iri);
    const inside = S.selected && c.members.includes(S.selected);
    tree.appendChild(h('button.blockrow', {
      'data-key': c.iri,
      'aria-current': String(!!inside), 'aria-expanded': String(open),
      onclick: () => { if (open) S.expanded.delete(c.iri); else S.expanded.add(c.iri); renderLeft(); },
    },
      h('span.idx', open ? '▾' : '▸'),
      h('span.nm', labelOf(m, c, S.lang).text),
      blockProgress(c),
      h('span.cnt', String(c.members.length)),
    ));
    if (open) {
      const sub = h('div.sublist');
      const members = c.members.map((x) => m.entities.get(x)).filter(Boolean)
        .sort((a, b) => labelOf(m, a, S.lang).text.localeCompare(labelOf(m, b, S.lang).text, 'ru'));
      for (const e of members) sub.appendChild(entityRow(e, 0));
      tree.appendChild(sub);
    }
  }
  if (!m.collections.length) tree.appendChild(h('div.empty', 'В онтологии нет skos:Collection'));
  return tree;
}

function blockProgress(c) {
  const total = c.members.length || 1;
  let ok = 0, other = 0;
  for (const iri of c.members) {
    const r = S.review.items[iri];
    if (!r || !r.verdict) continue;
    if (r.verdict === 'ok') ok++; else other++;
  }
  const done = ok + other;
  return h('span.bprog', { title: `проверено ${done} из ${c.members.length}`, 'aria-label': `проверено ${done} из ${c.members.length}` },
    h('i', { style: { width: (ok / total * 100) + '%', background: 'var(--green)' } }),
    h('i', { style: { width: (other / total * 100) + '%', background: 'var(--amber)' } }));
}

function entityRow(e, indent) {
  const m = S.model;
  const lbl = labelOf(m, e, S.lang);
  const hasKids = e.children.length > 0;
  const open = S.expanded.has(e.iri);
  return h('button.row', {
    'data-key': e.iri,
    'data-kids': hasKids ? '1' : null,
    'aria-expanded': hasKids ? String(open) : null,
    'aria-current': String(S.selected === e.iri),
    style: { paddingLeft: (8 + indent * 14) + 'px' },
    title: e.curie + (lbl.fallback ? ` · ${T('fallbackFrom')} @${lbl.lang || '—'}` : ''),
    onclick: (ev) => {
      if (hasKids && ev.altKey) { toggle(e.iri); return; }
      select(e.iri);
    },
  },
    hasKids
      ? h('span.twist', {
        onclick: (ev) => { ev.stopPropagation(); toggle(e.iri); },
      }, open ? '▾' : '▸')
      : h('span.twist', ''),
    verdictDot(e),
    h('span.name', lbl.isLocalName ? h('i', lbl.text) : lbl.text),
    lbl.fallback && !lbl.isLocalName ? h('span.num.fallback', lbl.lang || '?') : null,
    importedBadge(e),
    hasKids ? h('span.num', String(e.children.length)) : null,
  );
}

/** Точка в дереве: тип сущности, а для термина — оценка эксперта (цвет + форма). */
function verdictDot(e) {
  const rec = S.review.items[e.iri];
  if (rec && rec.verdict && VERDICT_BY_CODE[rec.verdict]) {
    const v = VERDICT_BY_CODE[rec.verdict];
    return h('span', { class: 'dot v-' + v.code, title: pickLang(v, S.lang), 'aria-label': pickLang(v, S.lang) });
  }
  return h('span', { class: 'dot ' + dotClass(e) + (isReviewable(e) ? ' unreviewed' : '') });
}

/** Счётчик замечаний из импортированных файлов (роль автора). */
function importedBadge(e) {
  if (!S.imported.length) return null;
  const n = S.imported.filter((x) => {
    const it = x.items[e.iri];
    return it && (it.verdict && it.verdict !== 'ok' || it.comment || FIX_FIELDS.some((f) => it[f]) || it.parent_proposed);
  }).length;
  return n ? h('span.num.remarks', { title: `замечаний экспертов: ${n}` }, '✎' + n) : null;
}

function toggle(iri) {
  if (S.expanded.has(iri)) S.expanded.delete(iri); else S.expanded.add(iri);
  renderLeft(iri);
}

function hierarchyTree() {
  const m = S.model;
  const tree = h('div.tree');
  const seen = new Set();
  const walk = (e, indent) => {
    if (seen.has(e.iri) || indent > 12) return;
    seen.add(e.iri);
    tree.appendChild(entityRow(e, indent));
    if (S.expanded.has(e.iri)) {
      const kids = e.children.map((c) => m.entities.get(c)).filter((c) => c && !c.external)
        .sort((a, b) => labelOf(m, a, S.lang).text.localeCompare(labelOf(m, b, S.lang).text, 'ru'));
      for (const k of kids) walk(k, indent + 1);
    }
    seen.delete(e.iri);
  };
  for (const r of m.roots) walk(r, 0);
  return tree;
}

function propertiesList() {
  const m = S.model;
  const tree = h('div.tree');
  const props = [...m.entities.values()].filter((e) => !e.external
    && (e.kinds.has(KIND.OBJECT_PROPERTY) || e.kinds.has(KIND.DATA_PROPERTY)))
    .sort((a, b) => a.local.localeCompare(b.local));
  const obj = props.filter((p) => p.kinds.has(KIND.OBJECT_PROPERTY));
  const dat = props.filter((p) => p.kinds.has(KIND.DATA_PROPERTY) && !p.kinds.has(KIND.OBJECT_PROPERTY));
  tree.appendChild(h('div.panelhead', `owl:ObjectProperty (${obj.length})`));
  for (const p of obj) tree.appendChild(entityRow(p, 0));
  tree.appendChild(h('div.panelhead', `owl:DatatypeProperty (${dat.length})`));
  for (const p of dat) tree.appendChild(entityRow(p, 0));
  return tree;
}

// --------------------------------------------------------------------------
//  Центр — карточка + граф окрестности
// --------------------------------------------------------------------------
function termsCenter() {
  const m = S.model;
  const center = h('div.center');
  const e = S.selected && m.entities.get(S.selected);
  if (!e) { center.appendChild(h('div.empty', T('noSelection'))); return center; }
  center.appendChild(h('div.cardwrap', entityCard(e)));
  center.appendChild(graphBox(e));
  return center;
}

function noteBadges(e) {
  const out = [];
  for (const n of e.notes) {
    const v = String(n.value);
    let matched = false;
    for (const b of S.profile.noteBadges || []) {
      if (rx(b.match).test(v)) { out.push({ text: pickLang(b, S.lang), title: v }); matched = true; }
    }
    if (!matched) out.push({ text: v.length > 60 ? v.slice(0, 57) + '…' : v, title: v, plain: true });
  }
  return out;
}

function entityCard(e) {
  const m = S.model;
  const labels = allLabels(m, e);
  const main = labels.find((l) => l.lang === S.lang && l.value) || labels.find((l) => l.value);
  const others = labels.filter((l) => l !== main);

  const badgesFor = (lang) => {
    const out = [];
    for (const n of e.notes) {
      const v = String(n.value);
      if (lang === 'en' && /authors'? translation/i.test(v)) out.push({ t: pickLang({ ru: 'авторский перевод', en: "authors' translation", kk: 'авторлық аударма' }, S.lang), c: '' });
      if (lang === 'kk' && /Kazakh label: expert-reviewed/i.test(v)) out.push({ t: pickLang({ ru: 'экспертная проверка', en: 'expert-reviewed', kk: 'сараптамалық тексеру' }, S.lang), c: '' });
      if (lang === 'kk' && /Kazakh label: source-attested/i.test(v)) out.push({ t: pickLang({ ru: 'подтверждён источником', en: 'source-attested', kk: 'дереккөзбен расталған' }, S.lang), c: 'green' });
    }
    return out;
  };

  const langLine = h('div.langline');
  for (const l of others) {
    const span = h('span', h('span.tag', String(l.lang).toUpperCase()));
    if (l.value) {
      span.appendChild(document.createTextNode(l.value + ' '));
      for (const b of badgesFor(l.lang)) span.appendChild(h('span', { class: 'badge ' + (b.c || '') }, b.t));
    } else {
      span.appendChild(h('span.missing', T('missingLabel')));
    }
    langLine.appendChild(span);
  }

  const defs = [];
  const langsOrder = [S.lang, ...S.profile.languages.filter((l) => l !== S.lang)];
  for (const l of langsOrder) {
    const arr = e.definitions[l];
    if (arr && arr.length) defs.push({ lang: l, value: arr[0].value });
  }
  for (const l of Object.keys(e.definitions)) {
    if (!S.profile.languages.includes(l)) defs.push({ lang: l || '—', value: e.definitions[l][0].value, foreign: true });
  }

  // провенанс
  const provNodes = [];
  const provSeen = new Set();
  for (const p of e.provenance) {
    const key = (p.isIri ? 'i|' : 'l|') + p.value;
    if (provSeen.has(key)) continue;
    provSeen.add(key);
    if (p.isIri) {
      const d = m.entities.get(p.value);
      if (d) {
        const status = d.literals.find((x) => /documentStatus$/i.test(x.prop));
        const title = d.literals.find((x) => x.prop === NS.dcterms + 'title');
        const year = d.literals.find((x) => /documentYear$/i.test(x.prop));
        provNodes.push(h('span', { style: { display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' } },
          T('source') + ':',
          h('b.mono', { style: { fontSize: '12px' } }, labelOf(m, d, S.lang).text),
          title ? h('span', { style: { color: 'var(--muted-2)' } }, title.value) : null,
          status ? h('span.badge', status.value) : null,
          year ? h('span', { style: { color: 'var(--muted-2)' } }, year.value) : null,
          h('button.linkbtn', { onclick: () => select(d.iri), 'data-tip': T('tips').source }, '→'),
        ));
      } else {
        provNodes.push(h('span', T('source') + ': ', h('code.mono', { style: { fontSize: '11.5px' } }, p.value),
          h('span.badge.amber', 'документ не описан в графе')));
      }
    } else {
      provNodes.push(h('span', T('source') + ': ', h('b', p.value),
        h('span.badge.red', { title: T('provLiteral') }, T('provLiteral'))));
    }
  }
  if (!e.provenance.length && e.isTerm) provNodes.push(h('span', { style: { color: 'var(--red)' } }, T('noSource')));

  const parents = e.parents.map((p) => m.entities.get(p)).filter(Boolean);
  const shapes = e.shapes.map((s) => m.entities.get(s)).filter(Boolean);

  const card = h('div.card',
    h('div.cardhead',
      h('div', { style: { minWidth: '0' } },
        h('h1', main && main.value ? main.value : h('i', e.local)),
        langLine,
        e.altLabels && Object.keys(e.altLabels).length
          ? h('div', { style: { marginTop: '6px', fontSize: '12.5px', color: 'var(--muted)' } },
            T('altLabels') + ': ' + Object.entries(e.altLabels).map(([l, v]) => v.join('; ')).join('; '))
          : null,
      ),
      h('div.meta',
        e.identifiers.length ? h('span.mono', { style: { fontSize: '11px', color: 'var(--muted-2)' } }, 'ID ' + e.identifiers[0]) : null,
        ...[...e.kinds].map((k) => h('span.badge', kindLabel(k))),
        shapes.length ? h('span.badge.teal', 'SHACL') : null,
        e.external ? h('span.badge', T('external')) : null,
      ),
    ),
    ...defs.map((d, i) => h('p', { class: 'defn' + (i ? ' sec' : '') },
      h('span.tag.mono', { style: { fontSize: '11px', color: 'var(--muted-2)', marginRight: '6px' } }, String(d.lang).toUpperCase()),
      d.value)),
    !defs.length ? h('p.defn.none', T('noDefinition')) : null,
    h('div.cardfoot',
      parents.length ? h('span', (parents.length > 1 ? T('parents') : T('parent')) + ': ',
        ...parents.map((p, i) => h('span', i ? ', ' : '',
          h('button.linkbtn', { onclick: () => select(p.iri) }, labelOf(m, p, S.lang).text),
          p.external ? h('span.badge', extName(p)) : null))) : null,
      e.children.length ? h('span', `${T('children')}: ${e.children.length}`) : null,
      e.collections.length ? h('span', T('block') + ': ',
        ...e.collections.map((c) => h('button.linkbtn', {
          onclick: () => { S.leftTab = 'blocks'; S.expanded.add(c); renderLeft(); },
        }, labelOf(m, m.entities.get(c), S.lang).text))) : null,
      ...provNodes,
    ),
    ...shapes.map((s) => h('div.shaclbox', shaclText(s))),
    ...noteBadges(e).filter((b) => b.plain).map((b) => h('div.warnbox', b.title)),
  );
  return card;
}

function kindLabel(k) {
  return ({
    class: 'owl:Class', concept: 'skos:Concept', objectProperty: 'owl:ObjectProperty',
    dataProperty: 'owl:DatatypeProperty', annotationProperty: 'owl:AnnotationProperty',
    individual: 'individual', collection: 'skos:Collection', scheme: 'skos:ConceptScheme',
    shape: 'sh:NodeShape', ontology: 'owl:Ontology',
  })[k] || k;
}

function extName(e) {
  const ns = S.profile.externalNamespaces[e.ns];
  return ns ? ns.label : T('external');
}

/** Человекочитаемый пересказ SHACL-шейпа (5.2). */
function shaclText(shape) {
  const m = S.model;
  const store = m.store;
  const out = [];
  const q = (s, p) => store.getObjects(s, p, null);
  const label = (iri) => {
    const e = m.entities.get(iri);
    return e ? (labelOf(m, e, S.lang).text || e.local) : shortProp(iri);
  };
  const props = [];
  for (const o of q(shape.iri, NS.sh + 'property')) {
    const path = q(o, NS.sh + 'path')[0];
    const pn = path ? label(path.value) : '?';
    const parts = [];
    for (const [pred, txt] of [
      [NS.sh + 'lessThanOrEquals', '≤'], [NS.sh + 'lessThan', '<'],
      [NS.sh + 'equals', '='], [NS.sh + 'minInclusive', '≥'], [NS.sh + 'maxInclusive', '≤'],
    ]) {
      for (const v of q(o, pred)) parts.push(`${pn} ${txt} ${v.termType === 'Literal' ? v.value : label(v.value)}`);
    }
    for (const v of q(o, NS.sh + 'minCount')) parts.push(`${pn}: обязательно (minCount ${v.value})`);
    for (const v of q(o, NS.sh + 'datatype')) parts.push(`${pn}: ${shortProp(v.value)}`);
    props.push(parts.length ? parts.join('; ') : pn);
  }
  const todo = shape.literals.find((x) => /TODO|\[VERIFY/i.test(x.value));
  out.push(h('code.mono', { style: { fontSize: '12px', color: 'var(--teal-d)' } },
    props.length ? props.join(' · ') : shape.local));
  if (todo) out.push(h('span', { style: { fontSize: '12px', color: 'var(--ink-3)' } }, ' — ' + todo.value));
  return h('span', ...out);
}

// --------------------------------------------------------------------------
//  Граф окрестности
// --------------------------------------------------------------------------
let currentLaid = null;
let graphCtl = null;     // управление видом текущего графа (для Esc и тестов)
function graphBox(e) {
  const m = S.model;
  const words = graphWords();
  const limit = S.nodeLimitFor === e.iri ? S.nodeLimit : S.profile.maxNeighbourhoodNodes;
  const g = neighbourhood(m, e.iri, {
    depth: S.depth, maxNodes: limit, lang: S.lang,
    showProperties: S.role === 'author', words, siblings: S.profile.neighbourhoodSiblings !== false, skipProps: S.profile.neighbourhoodSkipProperties,
  });
  const verdictOf = (iri) => {
    const r = S.review.items[iri];
    const v = r && r.verdict && VERDICT_BY_CODE[r.verdict];
    return v ? { code: v.code, color: v.color, label: pickLang(v, S.lang) } : null;
  };
  const laid = layoutLOD(m, g, S.lang, words, verdictOf);
  currentLaid = laid;
  const viewport = h('div.graphviewport', { tabindex: '0', 'aria-label': T('neighbourhood') });
  const svg = renderGraphLOD(laid, {
    onSelect: select,
    onExpand: () => { S.nodeLimitFor = e.iri; S.nodeLimit = limit + 60; render(); },
    expandLabel: T('tips').expandGroup,
    ariaLabel: `${T('neighbourhood')}: ${labelOf(m, e, S.lang).text}`,
  });
  const SW = laid.width + 60, SH = laid.height + 60;
  svg.style.width = SW + 'px';
  svg.style.height = SH + 'px';
  viewport.appendChild(svg);
  const thresholds = (S.profile.map && S.profile.map.zoomThresholds) || [0.4, 0.8, 1.6];

  let frameRaf = 0;
  const updateFrame = () => {
    frameRaf = 0;
    if (!minimap || !minimap.layout) return;
    const vb = viewport.getBoundingClientRect();
    const t = S.graphTransform;
    const L = minimap.layout.nodes;
    const focusIsland = L[e.iri] ? L[e.iri][2] : null;
    const vis = [];
    for (const n of laid.nodes) {
      if (!n.entity || !L[n.entity.iri]) continue;
      if (focusIsland != null && L[n.entity.iri][2] !== focusIsland) continue;
      const x0 = (n.x + 30) * t.k + t.x, y0 = (n.y + 30) * t.k + t.y;
      const x1 = x0 + n.slotW * t.k, y1 = y0 + n.slotH * t.k;
      if (x1 > 0 && y1 > 34 && x0 < vb.width && y0 < vb.height) vis.push(n.entity.iri);
    }
    minimap.setFrame(vis.length ? vis : [e.iri]);
  };
  const apply = () => {
    const t = S.graphTransform;
    svg.style.transform = `translate(${t.x}px,${t.y}px) scale(${t.k})`;
    if (!frameRaf) frameRaf = requestAnimationFrame(updateFrame);
    const lv = lodLevel(t.k, thresholds);
    if (svg.getAttribute('data-lod') !== String(lv)) svg.setAttribute('data-lod', String(lv));
    const lab = box && box.querySelector('.zoomlvl');
    if (lab) lab.textContent = T('zoomLevels')[lv] + ' · ' + t.k.toFixed(2).replace('.', ',');
  };
  const overview = () => {
    const vb = viewport.getBoundingClientRect();
    const k = Math.min(1.2, (vb.width - 24) / SW, (vb.height - 56) / SH);
    return { k, x: (vb.width - SW * k) / 2, y: 40 + Math.max(0, (vb.height - 56 - SH * k) / 2) };
  };
  const focusView = () => {
    const vb = viewport.getBoundingClientRect();
    const f = laid.byIri.get(e.iri);
    if (!f) return overview();
    // ближний план: карточка фокуса целиком в окне, масштаб внутри [порог ближнего; порог максимального)
    const kFit = Math.min((vb.width - 40) / (f.slotW + 120), (vb.height - 90) / (f.slotH + 120));
    const k = Math.max(thresholds[1] + 0.05, Math.min(1.05, thresholds[2] - 0.1, kFit));
    const cx = f.x + f.slotW / 2 + 30, cy = f.y + f.slotH / 2 + 30;
    return { k, x: vb.width / 2 - cx * k, y: (vb.height + 34) / 2 - cy * k };
  };
  let anim = 0;
  const animateTo = (target, ms, done) => {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = { ...S.graphTransform };
    const id = ++anim;
    const t0 = performance.now();
    if (reduce || ms <= 0) { S.graphTransform = target; apply(); if (done) done(0); return; }
    const step = (now) => {
      if (id !== anim) return;
      const u = Math.min(1, (now - t0) / ms);
      const q = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      S.graphTransform = { k: from.k + (target.k - from.k) * q, x: from.x + (target.x - from.x) * q, y: from.y + (target.y - from.y) * q };
      apply();
      if (u < 1) requestAnimationFrame(step); else if (done) done(performance.now() - t0);
    };
    requestAnimationFrame(step);
  };
  let prev = null;
  const zoomToFocus = () => {
    prev = overview();
    S.graphTransform = prev;
    apply();
    animateTo(focusView(), 350, (ms) => { S.lastZoomMs = Math.round(ms); });
  };
  const resetView = () => animateTo(prev || overview(), 300);
  graphCtl = { resetView, zoomToFocus, apply, setK: (k) => { const vb = viewport.getBoundingClientRect(); const t = S.graphTransform; const cx = vb.width / 2, cy = vb.height / 2; S.graphTransform = { k, x: cx - (cx - t.x) * (k / t.k), y: cy - (cy - t.y) * (k / t.k) }; apply(); } };
  requestAnimationFrame(zoomToFocus);

  viewport.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    anim++;
    const t = S.graphTransform;
    const r = viewport.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    const f = Math.exp(-ev.deltaY * 0.0015);
    const k2 = Math.min(3, Math.max(0.12, t.k * f));
    S.graphTransform = { k: k2, x: mx - (mx - t.x) * (k2 / t.k), y: my - (my - t.y) * (k2 / t.k) };
    apply();
  }, { passive: false });
  let drag = null;
  viewport.addEventListener('pointerdown', (ev) => {
    if (ev.target.closest('.ol-node') || ev.target.closest('.minimap')) return;
    anim++;
    drag = { x: ev.clientX, y: ev.clientY, t: { ...S.graphTransform } };
    viewport.classList.add('drag');
    viewport.setPointerCapture(ev.pointerId);
  });
  viewport.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    S.graphTransform = { k: drag.t.k, x: drag.t.x + (ev.clientX - drag.x), y: drag.t.y + (ev.clientY - drag.y) };
    apply();
  });
  const stop = () => { drag = null; viewport.classList.remove('drag'); };
  viewport.addEventListener('pointerup', stop);
  viewport.addEventListener('pointercancel', stop);
  viewport.addEventListener('dblclick', (ev) => { if (!ev.target.closest('.ol-node')) resetView(); });

  const box = h('div.graphbox',
    viewport,
    h('div.graphbar',
      h('span', `${T('neighbourhood')} · ${T('depth')} `,
        h('select', {
          'aria-label': T('depth'), 'data-tip': T('tips').depth,
          onchange: (ev) => { S.depth = Number(ev.target.value); render(); },
          style: { border: '1px solid var(--line-3)', borderRadius: '5px', padding: '1px 4px', background: '#fff' },
        }, ...[1, 2].map((d) => h('option', { value: d, selected: d === S.depth }, String(d)))),
        ' · ' + T('nodesFmt')(laid.nodes.length) + ' · ',
        h('span.zoomlvl', { 'data-tip': T('tips').zoomLevel })),
      h('span.tools',
        h('button.btn', { onclick: resetView, 'data-tip': T('tips').resetView }, T('resetView') + ' (Esc)'),
        h('button.btn', { onclick: () => exportSvg(e), 'data-tip': T('tips').exportSvg }, T('exportSvg')),
      ),
    ),
    legend(),
  );
  // миникарта «вы здесь»
  if (minimap) {
    minimap.attach(box);
    minimap.setFocus(e.iri, {
      trail: S.trail.slice(-8),
      pathIris: pathToRoot(e),
      frameIris: [e.iri],
    });
  }
  return box;
}

function pathToRoot(e) {
  const m = S.model;
  const out = [];
  let cur = e;
  const guard = new Set();
  while (cur && !guard.has(cur.iri)) {
    guard.add(cur.iri);
    out.push(cur.iri);
    cur = cur.parents.map((p) => m.entities.get(p)).find((p) => p && !p.external);
  }
  return out;
}

function legend() {
  const items = [
    ['term', T('term')], ['structural', T('structural')], ['external', T('external')],
    ['document', T('document')], ['shape', 'SHACL'], ['property', T('property')],
  ];
  return h('div.legend', ...items.map(([k, label]) => h('span',
    h('i', { style: { background: NODE_COLORS[k].fill, border: '1px solid ' + NODE_COLORS[k].stroke } }), label)));
}

function graphWords() {
  return {
    structural: T('structural'),
    source: T('source').toLowerCase(),
    domain: S.lang === 'en' ? 'domain' : (S.lang === 'kk' ? 'домен' : 'домен'),
    range: S.lang === 'en' ? 'range' : (S.lang === 'kk' ? 'диапазон' : 'диапазон'),
    more: S.lang === 'en' ? 'more nodes' : (S.lang === 'kk' ? 'тағы түйін' : 'ещё узлов'),
  };
}

function exportSvg(e) {
  const m = S.model;
  const g = neighbourhood(m, e.iri, { depth: S.depth, maxNodes: S.profile.maxNeighbourhoodNodes,
    lang: S.lang, showProperties: S.role === 'author', words: graphWords(), siblings: S.profile.neighbourhoodSiblings !== false, skipProps: S.profile.neighbourhoodSkipProperties });
  const laid = layout(m, g, S.lang, 2, graphWords());
  const onto = m.ontology ? (m.ontology.literals.find((x) => x.prop === NS.owl + 'versionInfo') || {}).value : '';
  const title = `OntoLens · ${labelOf(m, e, S.lang).text} · ${S.files.join(', ')}${onto ? ' · ' + onto : ''} · ${new Date().toISOString().slice(0, 10)}`;
  const svg = renderGraph(laid, { standalone: true, title });
  const text = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
  download(text, `${dateSlug()}-ontolens-${e.local}.svg`, 'image/svg+xml');
}

// --------------------------------------------------------------------------
//  Правая панель (термины)
// --------------------------------------------------------------------------
function termsRight() {
  const e = S.selected && S.model.entities.get(S.selected);
  const tabs = h('div.tabs', { role: 'tablist' },
    h('button', { role: 'tab', 'aria-selected': String(S.rightTab === 'review'), 'data-tip': T('tips').reviewTab,
      onclick: () => { S.rightTab = 'review'; render(); } }, T('yourReview')),
    h('button', { role: 'tab', 'aria-selected': String(S.rightTab === 'info'), 'data-tip': T('tips').infoTab,
      onclick: () => { S.rightTab = 'info'; render(); } }, T('technical')));
  const body = S.rightTab === 'review' ? reviewPanel(e) : infoPanel(e);
  return h('aside.right', tabs, body);
}

function infoPanel(e) {
  const m = S.model;
  const side = h('div.side');
  side.appendChild(h('div', h('h2', T('technical')), h('p.sub', e ? e.curie : '')));
  if (e) {
    const rows = [];
    rows.push(['IRI', e.iri, true]);
    rows.push([T('types'), [...e.types].map((x) => shortProp(x)).join(', ') || '—', true]);
    if (e.identifiers.length) rows.push(['dcterms:identifier', e.identifiers.join(', ')]);
    rows.push([T('files'), [...e.files].map((i) => (m.files[i] || {}).name || i).join(', '), true]);
    if (e.depth) rows.push([T('depthWord'), String(e.depth)]);
    const kv = h('div.kv', ...rows.map(([k, v, wide]) =>
      h('div', { class: 'r' + (wide ? ' wide' : '') }, h('span', k), h('b', v))));
    side.appendChild(kv);

    const propsIn = e.domainOf.map((p) => m.entities.get(p)).filter(Boolean);
    const propsOut = e.rangeOf.map((p) => m.entities.get(p)).filter(Boolean);
    if (propsIn.length) side.appendChild(listBlock(T('inDomain'), propsIn));
    if (propsOut.length) side.appendChild(listBlock(T('inRange'), propsOut));
    const ext = e.parents.map((p) => m.entities.get(p)).filter((p) => p && p.external);
    if (ext.length) {
      side.appendChild(h('div', h('div.panelhead', { style: { padding: '0 0 6px' } }, T('bridges')),
        h('div.kv', ...ext.map((x) => h('div.r',
          h('span', extName(x)), h('b', { title: x.iri }, x.curie))))));
    }
    if (e.notes.length) {
      side.appendChild(h('div',
        h('div.panelhead', { style: { padding: '0 0 6px' } }, T('notes')),
        h('div.kv', ...e.notes.map((n) => {
          const v = String(n.value);
          const hit = (S.profile.noteBadges || []).find((b) => rx(b.match).test(v));
          return h('div.r.wide',
            h('span', pickLang(S.profile.noteProperties[n.prop] || { ru: shortProp(n.prop) }, S.lang)),
            h('b', { style: { fontFamily: 'var(--sans)' } },
              hit ? pickLang(hit, S.lang) : v),
            hit ? h('span', { style: { display: 'block', fontSize: '11px', color: 'var(--muted-2)', marginTop: '2px' } }, v) : null);
        }))));
    }
  }
  return h('div.scroll', side);
}

function listBlock(title, items) {
  const m = S.model;
  return h('div',
    h('div.panelhead', { style: { padding: '0 0 6px' } }, title),
    h('div.kv', ...items.map((p) => h('div.r',
      h('button.linkbtn', { onclick: () => select(p.iri) }, labelOf(m, p, S.lang).text),
      h('b', { title: p.iri }, p.curie)))));
}

// --------------------------------------------------------------------------
//  5.4 — оценка эксперта
// --------------------------------------------------------------------------
function reviewScope() {
  const m = S.model;
  const terms = m.classes.filter((e) => e.isTerm);
  return terms.length ? terms : m.classes;
}
function isReviewable(e) {
  if (!e || e.external) return false;
  const terms = S.model.classes.some((x) => x.isTerm);
  return terms ? e.isTerm : (e.kinds.has(KIND.CLASS) || e.kinds.has(KIND.CONCEPT));
}

/** Порядок обхода терминов — тот же, что в левой панели: по блокам, внутри блока по алфавиту. */
let _orderCache = { key: null, list: [] };
function termOrder() {
  const m = S.model;
  const key = m.hash + '|' + S.lang;
  if (_orderCache.key === key) return _orderCache.list;
  const byLabel = (a, b) => labelOf(m, a, S.lang).text.localeCompare(labelOf(m, b, S.lang).text, 'ru');
  const out = [];
  const seen = new Set();
  for (const c of m.collections) {
    const mem = c.members.map((x) => m.entities.get(x)).filter((x) => x && isReviewable(x)).sort(byLabel);
    for (const e of mem) if (!seen.has(e.iri)) { seen.add(e.iri); out.push(e.iri); }
  }
  const rest = reviewScope().filter((e) => !seen.has(e.iri)).sort(byLabel);
  for (const e of rest) out.push(e.iri);
  _orderCache = { key, list: out };
  return out;
}

function reviewProgress() {
  const order = termOrder();
  const done = order.filter((iri) => S.review.items[iri] && S.review.items[iri].verdict).length;
  return { done, total: order.length, pct: order.length ? Math.round(done / order.length * 100) : 0 };
}

function goNextUnreviewed() {
  const order = termOrder();
  const start = Math.max(0, order.indexOf(S.selected));
  for (let i = 1; i <= order.length; i++) {
    const iri = order[(start + i) % order.length];
    if (!(S.review.items[iri] && S.review.items[iri].verdict)) { S.rightTab = 'review'; select(iri); return; }
  }
  flash('ok', T('allReviewed'));
}

function goNext() {
  const order = termOrder();
  const i = order.indexOf(S.selected);
  const next = order[(i + 1) % order.length];
  if (next) select(next);
}

function flash(kind, text) {
  S.flash = { kind, text };
  const box = document.querySelector('.rv-flash');
  if (box) { box.className = 'rv-flash ' + kind; box.textContent = text; box.hidden = false; }
}

function currentValues(e) {
  const m = S.model;
  const first = (map, l) => (map[l] && map[l][0] ? map[l][0].value : '');
  const parent = e.parents.map((p) => m.entities.get(p)).find((p) => p && !p.external);
  return {
    def_ru_fixed: first(e.definitions, 'ru'),
    label_ru_fixed: first(e.labels, 'ru'),
    label_kk_fixed: first(e.labels, 'kk'),
    label_en_fixed: first(e.labels, 'en'),
    parent_proposed: parent ? parent.local : '',
  };
}

/** Подпись термина для списков выбора: «метка — ЛокальноеИмя». */
function pickLabel(e) { return `${labelOf(S.model, e, S.lang).text} — ${e.local}`; }
function resolvePick(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  const m = S.model;
  const local = t.includes(' — ') ? t.split(' — ').pop().trim() : t;
  const hit = m.classes.find((e) => e.local === local) || m.classes.find((e) => labelOf(m, e, S.lang).text === t);
  return hit ? hit.local : t;
}

function reviewPanel(e) {
  const m = S.model;
  const side = h('div.side.rv');
  if (!e) { side.appendChild(h('p.sub', T('noSelection'))); return h('div.scroll', side); }
  if (!isReviewable(e)) {
    side.appendChild(h('div', h('h2', T('yourReview')), h('p.sub', T('notReviewable'))));
    side.appendChild(h('button.btn', { onclick: goNextUnreviewed }, T('nextUnreviewed')));
    return h('div.scroll', side);
  }
  const order = termOrder();
  const idx = order.indexOf(e.iri);
  const rec = S.review.items[e.iri] || {};
  const cur = currentValues(e);
  const coll = e.collections.length ? m.entities.get(e.collections[0]) : null;

  side.appendChild(h('div',
    h('h2', T('yourReview')),
    h('p.sub', `${T('termNofM')(idx + 1, order.length)}${coll ? ' · ' + labelOf(m, coll, S.lang).text : ''}`)));

  if (S.otherReviews && S.otherReviews.length) {
    const src = S.otherReviews[0];
    side.appendChild(h('div.rv-carry', { role: 'status' },
      h('b', T('carryTitle')),
      h('p', T('carryText')(src.count, src.expert, src.updated ? new Date(src.updated).toLocaleDateString('ru-RU') : '—')),
      h('div', { style: { display: 'flex', gap: '8px' } },
        h('button.btn.primary', { onclick: () => doCarryOver(src), 'data-tip': T('tips').carry }, T('carryDo')),
        h('button.btn', { onclick: () => { S.otherReviews = []; render(); } }, T('carryNo')))));
  }

  // эксперт
  const expertInput = h('input#rv-expert', {
    type: 'text', value: S.review.expert || '', placeholder: T('expertPlaceholder'), autocomplete: 'name',
    readonly: S.srv ? true : null, 'data-tip': S.srv ? T('srvExpertLocked') : null,
    onchange: (ev) => { S.review.expert = ev.target.value.trim(); savePref('expert', S.review.expert); persist(); },
  });
  side.appendChild(h('div.rv-field',
    h('label', { for: 'rv-expert' }, T('expertName')), expertInput));

  // оценка
  const group = h('div.rv-verdicts', { role: 'radiogroup', 'aria-label': T('verdict') });
  VERDICTS.forEach((v, i) => {
    const id = 'rv-v-' + v.code;
    const checked = rec.verdict === v.code;
    group.appendChild(h('label', { class: 'rv-verdict rv-' + v.code + (checked ? ' on' : ''), for: id,
      'data-tip': T('verdictTips')[v.code] },
      h('input', { type: 'radio', name: 'rv-verdict', id, value: v.code, checked,
        onchange: () => {
          group.querySelectorAll('.rv-verdict').forEach((x) => x.classList.remove('on'));
          group.querySelector(`label[for="${id}"]`).classList.add('on');
          dupBox.hidden = v.code !== 'duplicate';
        } }),
      h('span', { class: 'dot v-' + v.code }),
      h('span.t', pickLang(v, S.lang)),
      h('kbd', String(i + 1))));
  });
  side.appendChild(group);

  // дубль какого термина
  const termsList = h('datalist#rv-terms', ...reviewScope().filter((x) => x.iri !== e.iri)
    .map((x) => h('option', { value: pickLabel(x) })));
  const dupTarget = rec.duplicate_of
    ? (m.classes.find((x) => x.local === rec.duplicate_of || x.identifiers.includes(rec.duplicate_of)) || null) : null;
  const dupBox = h('div.rv-field', { hidden: rec.verdict !== 'duplicate' },
    h('label', { for: 'rv-dup' }, T('duplicateOf')),
    h('input#rv-dup', { type: 'text', list: 'rv-terms', value: dupTarget ? pickLabel(dupTarget) : (rec.duplicate_of || ''),
      placeholder: T('startTyping') }),
    termsList);
  side.appendChild(dupBox);

  // исправления
  const ta = (id, label, value, placeholder, rows) => h('div.rv-field',
    h('label', { for: id }, label),
    h('textarea', { id, rows: rows || 3, placeholder, text: value || '' }));
  side.appendChild(ta('rv-def', T('defFixed'), rec.def_ru_fixed, T('leaveEmptyIfOk')));

  const lblRow = h('div.rv-field',
    h('label', T('labelFixed')),
    ...['ru', 'kk', 'en'].map((l) => h('div.rv-lang',
      h('span.tag.mono', l.toUpperCase()),
      h('input', { id: 'rv-label-' + l, type: 'text', value: rec['label_' + l + '_fixed'] || '',
        placeholder: cur['label_' + l + '_fixed'] || T('missingLabel'),
        'aria-label': T('labelFixed') + ' ' + l }))));
  side.appendChild(lblRow);

  const classList = h('datalist#rv-classes', ...m.classes.filter((x) => x.iri !== e.iri)
    .map((x) => h('option', { value: pickLabel(x) })));
  const parentTarget = rec.parent_proposed ? m.classes.find((x) => x.local === rec.parent_proposed) : null;
  const curParent = m.classes.find((x) => x.local === cur.parent_proposed);
  side.appendChild(h('div.rv-field',
    h('label', { for: 'rv-parent' }, T('parentProposed')),
    h('input#rv-parent', { type: 'text', list: 'rv-classes',
      value: parentTarget ? pickLabel(parentTarget) : (rec.parent_proposed || ''),
      placeholder: curParent ? `${T('current')}: ${labelOf(m, curParent, S.lang).text}` : T('startTyping') }),
    classList));

  side.appendChild(ta('rv-comment', T('comment'), rec.comment, '', 2));

  side.appendChild(h('div', { class: 'rv-flash' + (S.flash ? ' ' + S.flash.kind : ''), hidden: !S.flash, role: 'status' },
    S.flash ? S.flash.text : ''));
  S.flash = null;

  if (rec.ts) {
    side.appendChild(h('p.sub', { style: { margin: '0' } },
      `${T('savedAt')} ${new Date(rec.ts).toLocaleString('ru-RU')} · `,
      S.srv ? null : h('button.linkbtn', { onclick: () => { delete S.review.items[e.iri]; persist(); render(); } }, T('resetReview'))));
  }

  // оценки других экспертов: из загруженных файлов или, на платформе, с сервера
  if (S.srv && !S.srv.preview) {
    const o = S.others && S.others.iri === e.iri ? S.others : null;
    if (!o) { loadOthers(e.iri); }
    else if (o.hidden) side.appendChild(h('p.note', T('othersHidden')));
    else if (o.items.length) {
      side.appendChild(h('div', h('div.panelhead', { style: { padding: '4px 0 6px' } }, T('othersTitle')),
        h('div.kv', ...o.items.map((it) => otherRow(it.expert || it.email, it)))));
    } else if (rec.verdict) side.appendChild(h('p.note', T('othersNone')));
  }
  if (S.imported.length) {
    const rows = S.imported.map((x) => {
      const it = x.items[e.iri];
      const v = it && it.verdict ? VERDICT_BY_CODE[it.verdict] : null;
      const extra = it ? [it.def_ru_fixed && `опр.: ${it.def_ru_fixed}`, it.label_kk_fixed && `kk: ${it.label_kk_fixed}`,
        it.label_ru_fixed && `ru: ${it.label_ru_fixed}`, it.label_en_fixed && `en: ${it.label_en_fixed}`,
        it.parent_proposed && `родитель: ${it.parent_proposed}`, it.comment].filter(Boolean).join(' · ') : '';
      return h('div.r.wide',
        h('span', x.expert, ' ', v ? h('span', { class: 'dot v-' + v.code, style: { display: 'inline-block', marginLeft: '4px' } }) : null),
        h('b', { style: { fontFamily: 'var(--sans)' } }, v ? pickLang(v, S.lang) : '—'),
        extra ? h('span', { style: { display: 'block', fontSize: '12px', color: 'var(--muted)', marginTop: '2px' } }, extra) : null);
    });
    side.appendChild(h('div', h('div.panelhead', { style: { padding: '4px 0 6px' } }, T('otherExperts')), h('div.kv', ...rows)));
  }

  // низ панели
  const pr = reviewProgress();
  const foot = h('div.rv-foot',
    h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--muted)', marginBottom: '6px' } },
      h('span', T('checkedNofM')(pr.done, pr.total)), h('span.mono', { style: { color: 'var(--green)' } }, pr.pct + ' %')),
    h('div.rv-bar', h('i', { style: { width: pr.pct + '%' } })),
    h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } },
      h('button.btn.primary', { style: { flexGrow: '1', padding: '9px 12px', fontSize: '14px' },
        onclick: () => saveCurrent(e, true), 'data-tip': T('tips').saveNext }, T('saveNext')),
      h('button.btn', { style: { padding: '9px 12px', fontSize: '14px' }, onclick: goNext,
        'data-tip': T('tips').skip }, T('skip'))),
    h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '10px', fontSize: '12px' } },
      h('button.linkbtn', { onclick: goNextUnreviewed, 'data-tip': T('tips').nextUnreviewed }, T('nextUnreviewed')),
      h('span',
        h('button.linkbtn', { onclick: () => exportReview('csv'), 'data-tip': T('tips').exportReview }, 'CSV'), ' · ',
        h('button.linkbtn', { onclick: () => exportReview('json'), 'data-tip': T('tips').exportReview }, 'JSON'))),
    S.srv ? srvStoreNote() : h('p', { class: 'rv-store' + (S.reviewStorage ? '' : ' bad') },
      S.vault.current && !S.vault.readOnly
        ? `Оценки сохраняются в папку ${S.vault.current.ver.name}\\${WORK_DIR} (review-<эксперт>.json) и в этом браузере.`
        : S.reviewStorage ? T('storageNote') : T('storageOff')));
  return h('div.rv-wrap', h('div.scroll', side), foot);
}

function doCarryOver(src) {
  const r = carryOver(src, S.model);
  S.review.items = { ...r.items, ...S.review.items };
  if (!S.review.expert) S.review.expert = src.expert;
  S.otherReviews = [];
  persist(Object.keys(r.items));
  S.flash = { kind: r.lost.length ? 'warn' : 'ok', text: T('carryDone')(r.byIri, r.byIdent, r.lost.length)
    + (r.lost.length ? ' ' + r.lost.slice(0, 5).join('; ') + (r.lost.length > 5 ? '…' : '') : '') };
  render();
}

function readForm() {
  const val = (id) => { const x = document.getElementById(id); return x ? x.value : ''; };
  const checked = document.querySelector('input[name="rv-verdict"]:checked');
  return {
    verdict: checked ? checked.value : '',
    duplicate_of: resolvePick(val('rv-dup')),
    def_ru_fixed: val('rv-def'),
    label_ru_fixed: val('rv-label-ru'),
    label_kk_fixed: val('rv-label-kk'),
    label_en_fixed: val('rv-label-en'),
    parent_proposed: resolvePick(val('rv-parent')),
    comment: val('rv-comment'),
  };
}

function persist(changed) {
  S.review.updated = new Date().toISOString();
  S.review.mainNs = S.model.mainNs;
  const ok = saveReview(reviewKey(S.model.hash), S.review);
  if (!ok) S.reviewStorage = false;
  if (syncQ && changed) for (const iri of changed) if (S.review.items[iri]) syncQ.push(iri, S.review.items[iri]);
  if (minimap) minimap.rebuildBase();
  scheduleVaultReviewSave();
}

/** Ключ черновика в браузере: в веб-версии — свой для каждого токена. */
function reviewKey(hash) {
  return S.srv ? `${hash}.${S.srv.email}.${S.ontVersion}` : hash;
}

function saveCurrent(e, andNext) {
  const expertEl = document.getElementById('rv-expert');
  if (expertEl) S.review.expert = expertEl.value.trim();
  if (!S.review.expert) { flash('bad', T('needExpert')); if (expertEl) expertEl.focus(); return false; }
  savePref('expert', S.review.expert);
  const cur = currentValues(e);
  const raw = readForm();
  const { errors, warnings } = validateRecord(raw, cur);
  if (errors.length) { flash('bad', errors.join(' ')); return false; }
  const rec = normaliseRecord(raw, cur);
  if (rec.parent_proposed === cur.parent_proposed) rec.parent_proposed = '';
  rec.ts = new Date().toISOString();
  rec.id = e.identifiers.length ? String(e.identifiers[0]) : '';
  rec.label_ru = (e.labels.ru && e.labels.ru[0] && e.labels.ru[0].value) || '';
  S.review.items[e.iri] = rec;
  persist([e.iri]);
  if (warnings.length) S.flash = { kind: 'warn', text: warnings.join(' ') };
  if (andNext) goNext(); else render();
  return true;
}

function reviewRows(items) {
  const m = S.model;
  const out = [];
  for (const [iri, r] of Object.entries(items)) {
    if (!r || !r.verdict || iri.startsWith('conflict:')) continue;
    const e = m.entities.get(iri);
    const dup = r.duplicate_of ? m.classes.find((x) => x.local === r.duplicate_of) : null;
    out.push({
      id: e && e.identifiers.length ? e.identifiers[0] : '',
      iri,
      label_ru: e ? ((e.labels.ru && e.labels.ru[0] && e.labels.ru[0].value) || '') : '',
      verdict: r.verdict,
      duplicate_of: dup && dup.identifiers.length ? dup.identifiers[0] : (r.duplicate_of || ''),
      def_ru_fixed: r.def_ru_fixed || '',
      label_ru_fixed: r.label_ru_fixed || '',
      label_kk_fixed: r.label_kk_fixed || '',
      label_en_fixed: r.label_en_fixed || '',
      parent_proposed: r.parent_proposed || '',
      comment: r.comment || '',
      ts: r.ts || '',
    });
  }
  out.sort((a, b) => (Number(a.id) || 1e9) - (Number(b.id) || 1e9) || a.iri.localeCompare(b.iri));
  return out;
}

function exportReview(fmt) {
  if (!S.review.expert) { S.rightTab = 'review'; render(); flash('bad', T('needExpert')); return; }
  const rows = reviewRows(S.review.items);
  if (!rows.length) { flash('warn', T('nothingToExport')); return; }
  const name = `review-${slug(S.review.expert)}-${dateSlug()}`;
  if (fmt === 'json') {
    download(reviewToJson(rows, S.review.expert, { ontology: S.files.join(', '), graph_hash: S.model.hash }),
      name + '.json', 'application/json');
  } else {
    download(reviewToCsv(rows, S.review.expert), name + '.csv', 'text/csv');
  }
}

// --------------------------------------------------------------------------
//  5.4 — роль автора: импорт замечаний и сводка
// --------------------------------------------------------------------------
async function importReviews(fileList) {
  const errs = [];
  for (const f of [...fileList]) {
    try {
      const text = await f.text();
      const parsed = parseReviewFile(f.name, text);
      // привязка по id, если IRI в файле из другой версии онтологии
      const m = S.model;
      const byId = new Map();
      for (const e of m.classes) for (const id of e.identifiers) byId.set(String(id), e.iri);
      const items = {};
      let unmatched = 0;
      for (const [iri, it] of Object.entries(parsed.items)) {
        const target = m.entities.has(iri) ? iri : (it.id && byId.get(String(it.id)));
        if (target) items[target] = it; else unmatched++;
      }
      S.imported = S.imported.filter((x) => x.file !== parsed.file);
      S.imported.push({ ...parsed, items, unmatched });
    } catch (e) {
      errs.push(`${f.name}: ${e.message || e}`);
    }
  }
  if (errs.length) S.flash = { kind: 'bad', text: errs.join('; ') };
  render();
}

function reviewSources() {
  const own = Object.keys(S.review.items).length
    ? [{ expert: (S.review.expert || T('thisDevice')) + ' · ' + (S.srv ? T('gasYou') : T('thisDevice')), items: S.review.items, own: true }] : [];
  const server = (S.serverReviews || []).filter((x) => !(S.srv && x.email === S.srv.email))
    .map((x) => ({ expert: x.expert, items: x.items, file: T('gasSheet'), server: true }));
  return [...own, ...server, ...S.imported];
}

function reviewsLeft() {
  const input = h('input', { type: 'file', 'aria-label': T('importReviews'), multiple: true, accept: '.csv,.json', class: 'sr',
    onchange: (ev) => importReviews(ev.target.files) });
  const src = reviewSources();
  const list = h('div.checklist',
    h('div.checkgroup', h('div', { class: 'h' }, T('experts')),
      ...(src.length ? src.map((x) => {
        const n = Object.entries(x.items).filter(([k, r]) => r.verdict && !k.startsWith('conflict:')).length;
        return h('div.check', { style: { cursor: 'default' } },
          h('span', { class: 'sq ' + (x.own ? 'zero' : 'info') }),
          h('span.t', x.expert, x.file ? h('span', { style: { display: 'block', fontSize: '11px', color: 'var(--muted-2)' } },
            x.file + (x.unmatched ? ` · не сопоставлено: ${x.unmatched}` : '')) : null),
          h('span.n', String(n)),
          x.server ? h('button.linkbtn', { style: { fontSize: '12px' }, 'data-tip': T('gasCsvTip'),
            onclick: () => { const rows = reviewRows(x.items); if (rows.length) download(reviewToCsv(rows, x.expert), `review-${slug(x.expert)}-${dateSlug()}.csv`, 'text/csv'); } }, 'CSV')
            : x.own ? null : h('button.linkbtn', { style: { fontSize: '12px' }, 'data-tip': T('tips').removeImport,
            onclick: () => { S.imported = S.imported.filter((y) => y !== x); render(); } }, '✕'));
      }) : [h('div.empty', { style: { padding: '12px 6px', textAlign: 'left' } }, T('noReviewsYet'))])),
    h('div', { style: { padding: '0 6px', display: 'flex', flexDirection: 'column', gap: '8px' } },
      S.srv && S.srv.role === 'editor' && !S.srv.preview ? h('button.btn', { onclick: () => srvLoadAll(true), 'data-tip': T('srvRefreshTip') }, T('srvRefresh')) : null,
      h('button.btn.primary', { onclick: () => input.click(), 'data-tip': T('tips').importReviews }, T('importReviews')),
      input,
      h('p', { style: { margin: '0', fontSize: '12px', color: 'var(--muted-2)', lineHeight: '1.45' } }, T('importHint'))));
  return h('aside.left', h('div.scroll', list));
}

function reviewsCenter() {
  const m = S.model;
  const src = reviewSources();
  const order = termOrder();
  const sum = summarise(order, src);
  const filters = [
    ['remarks', T('fRemarks')], ['disagree', T('fDisagree')], ['unreviewed', T('fUnreviewed')], ['all', T('fAll')],
  ];
  const rows = sum.rows.filter((r) => {
    if (S.reviewsFilter === 'remarks') return r.hasRemarks;
    if (S.reviewsFilter === 'disagree') return r.agree === false;
    if (S.reviewsFilter === 'unreviewed') return r.reviewedBy === 0;
    return true;
  });
  const wrap = h('div.diagmain');
  wrap.appendChild(h('div.explain.info',
    h('h2', T('tabReview')),
    h('p', src.length ? T('reviewsLead')(src.length, order.length) : T('reviewsEmpty'))));
  wrap.appendChild(h('div.seg.light', ...filters.map(([k, label]) => h('button', {
    'aria-pressed': String(S.reviewsFilter === k), onclick: () => { S.reviewsFilter = k; render(); },
  }, label))));
  const head = h('div.th', h('span.c1', { style: { width: '34%' } }, T('entity')),
    ...src.map((x) => h('span', { style: { width: '110px', flexShrink: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, x.expert)),
    h('span.c2', T('comment')));
  const body = h('div.body');
  for (const r of rows.slice(0, 600)) {
    const e = m.entities.get(r.iri);
    const comments = src.map((x) => x.items[r.iri]).filter(Boolean)
      .map((it) => [it.comment, it.def_ru_fixed && 'опр.', it.label_kk_fixed && 'kk', it.parent_proposed && 'родитель'].filter(Boolean).join(', '))
      .filter(Boolean).join(' | ');
    body.appendChild(h('button.td', { onclick: () => { S.rightTab = 'review'; select(r.iri); },
      style: r.agree === false ? { background: '#FFF7F0' } : null },
      h('span.c1', { style: { width: '34%', fontFamily: 'var(--sans)' } },
        e.identifiers.length ? h('span.mono', { style: { color: 'var(--muted-2)', marginRight: '6px' } }, e.identifiers[0]) : null,
        labelOf(m, e, S.lang).text),
      ...r.votes.map((v) => h('span', { style: { width: '110px', flexShrink: '0', display: 'flex', alignItems: 'center', gap: '6px' } },
        v ? h('span', { class: 'dot v-' + v }) : h('span', { class: 'dot unreviewed' }),
        v ? pickLang(VERDICT_BY_CODE[v], S.lang) : '—')),
      h('span.c2', comments)));
  }
  if (!rows.length) body.appendChild(h('div.empty', T('noItems')));
  wrap.appendChild(h('div.table', head, body,
    h('div.foot', h('span', `${T('shown')} ${Math.min(rows.length, 600)} ${T('of')} ${rows.length}`),
      h('button.btn', { onclick: () => exportSummary(src, sum), 'data-tip': T('tips').exportSummary }, T('exportSummary')))));
  const center = h('div.center');
  center.appendChild(wrap);
  return center;
}

function reviewsRight() {
  const src = reviewSources();
  const sum = summarise(termOrder(), src);
  const side = h('div.side');
  side.appendChild(h('div', h('h2', T('summary')), h('p.sub', T('summaryHint'))));
  const kv = h('div.kv',
    h('div.r', h('span', T('termsTotal')), h('b', String(sum.rows.length))),
    h('div.r', h('span', T('reviewedByAny')), h('b', String(sum.rows.filter((r) => r.reviewedBy > 0).length))),
    h('div.r', h('span', T('withRemarks')), h('b', String(sum.rows.filter((r) => r.hasRemarks).length))),
    h('div.r', h('span', T('comparable')), h('b', String(sum.comparable))),
    h('div.r', h('span', T('agreement')), h('b', sum.agreementShare == null ? '—' : (sum.agreementShare * 100).toFixed(1).replace('.', ',') + ' %')),
    h('div.r', h('span', T('kappa')), h('b', sum.kappa == null ? '—' : sum.kappa.toFixed(2).replace('.', ',') + ` (n = ${sum.kappaN})`)));
  side.appendChild(kv);
  for (const x of src) {
    const counts = VERDICTS.map((v) => [v, Object.values(x.items).filter((r) => r.verdict === v.code).length]);
    side.appendChild(h('div',
      h('div.panelhead', { style: { padding: '4px 0 6px' } }, x.expert),
      h('div.kv', ...counts.map(([v, n]) => h('div.r',
        h('span', h('span', { class: 'dot v-' + v.code, style: { display: 'inline-block', marginRight: '7px' } }), pickLang(v, S.lang)),
        h('b', String(n)))))));
  }
  if (src.length < 2) side.appendChild(h('div.note', T('kappaNeedsTwo')));
  return h('aside.right', h('div.scroll', side));
}

function exportSummary(src, sum) {
  const m = S.model;
  const head = ['id', 'iri', 'label_ru', ...src.map((x) => 'verdict_' + slug(x.expert)), 'reviewed_by', 'agree', 'has_remarks'];
  const rows = [head];
  for (const r of sum.rows) {
    const e = m.entities.get(r.iri);
    rows.push([e.identifiers[0] || '', r.iri, (e.labels.ru && e.labels.ru[0] && e.labels.ru[0].value) || '',
      ...r.votes.map((v) => (v ? VERDICT_BY_CODE[v].ru : '')), r.reviewedBy,
      r.agree == null ? '' : (r.agree ? 'да' : 'нет'), r.hasRemarks ? 'да' : '']);
  }
  rows.push([]);
  rows.push(['agreement_share', sum.agreementShare == null ? '' : sum.agreementShare.toFixed(4)]);
  rows.push(['fleiss_kappa', sum.kappa == null ? '' : sum.kappa.toFixed(4), 'n', sum.kappaN]);
  download(csv(rows), `${dateSlug()}-ontolens-review-summary.csv`, 'text/csv');
}

// --------------------------------------------------------------------------
//  Диагностика
// --------------------------------------------------------------------------
const GROUP_TITLES = {
  files: 'groupFiles',
  structure: 'groupStructure', labels: 'groupLabels', definitions: 'groupDefinitions',
  provenance: 'groupProvenance', properties: 'groupProperties', external: 'groupExternal', shacl: 'groupShacl',
};

function diagLeft() {
  const left = h('aside.left');
  const scroll = h('div.scroll');
  const list = h('div.checklist');
  const groups = [...new Set(S.checks.map((c) => c.group))];
  for (const gname of groups) {
    const g = h('div.checkgroup', h('div', { class: 'h' }, T(GROUP_TITLES[gname] || gname)));
    for (const c of S.checks.filter((x) => x.group === gname)) {
      const zero = c.count === 0;
      g.appendChild(h('button.check', {
        'aria-current': String(S.activeCheck === c),
        'data-tip': pickLang(c.explain, S.lang),
        onclick: () => { S.activeCheck = c; render(); },
      },
        h('span', { class: 'sq ' + (zero ? 'zero' : c.severity) }),
        h('span.t', pickLang(c.title, S.lang)),
        h('span', { class: 'n' + (zero ? ' zero' : '') }, zero ? '0' : c.count.toLocaleString('ru-RU')),
      ));
    }
    list.appendChild(g);
  }
  scroll.appendChild(list);
  left.appendChild(scroll);
  return left;
}

function diagCenter() {
  const m = S.model;
  const c = S.activeCheck;
  const center = h('div.center');
  const wrap = h('div.diagmain');
  if (!c) { wrap.appendChild(h('div.empty', '—')); center.appendChild(wrap); return center; }
  const zero = c.count === 0;
  wrap.appendChild(h('div', { class: 'explain ' + (zero ? 'zero' : c.severity) },
    h('h2', pickLang(c.title, S.lang) + ' — ' + (zero ? T('noCases') : c.count.toLocaleString('ru-RU'))),
    h('p', pickLang(c.explain, S.lang)),
    c.scope || c.alt ? h('p', { style: { marginTop: '6px', fontSize: '12.5px', color: 'var(--ink-3)' } },
      c.scope ? pickLang(c.scope, S.lang) + ' ' : '',
      c.alt ? h('span', { style: { whiteSpace: 'nowrap' } },
        pickLang(c.alt.label, S.lang).replace(/^./, (x) => x.toUpperCase()) + ': ',
        h('b.mono', String(c.alt.count.toLocaleString('ru-RU'))), '.') : null) : null,
  ));

  const body = h('div.body');
  const shown = c.items.slice(0, 500);
  for (const it of shown) {
    const e = it.iri ? m.entities.get(it.iri) : null;
    body.appendChild(h('button.td', {
      onclick: () => { if (e) select(e.iri); },
      disabled: !e,
    },
      h('span.c1', { title: it.iri || '' }, e ? e.curie : (it.label || it.iri || '—')),
      h('span.c2', { title: it.detail || '' }, it.detail || (e ? labelOf(m, e, S.lang).text : '')),
    ));
  }
  if (!shown.length) body.appendChild(h('div.empty', T('noItems')));

  wrap.appendChild(h('div.table',
    h('div.th', h('span.c1', T('entity')), h('span.c2', T('detailCol'))),
    body,
    h('div.foot',
      h('span', `${T('shown')} ${shown.length} ${T('of')} ${c.count.toLocaleString('ru-RU')} · ${T('sortedByIri')}`),
      h('span', { style: { display: 'flex', gap: '8px' } },
        h('button.btn', { onclick: () => exportCheckCsv(c), 'data-tip': T('tips').exportList }, T('exportList'))),
    ),
  ));
  center.appendChild(wrap);
  return center;
}

function diagRight() {
  const side = h('div.side');
  side.appendChild(h('div', h('h2', T('metrics')), h('p.sub', T('metricsHint') + ' · rdflib-совместимо')));
  const kv = h('div.kv');
  for (const r of S.metrics) {
    const row = h('div', { class: 'r' + (r.wide ? ' wide' : '') + (r.muted ? ' muted' : '') },
      h('span', pickLang(r.label, S.lang)),
      h('b', String(r.value)));
    if (r.detail) {
      row.appendChild(h('span', { style: { display: 'block', width: '100%', fontSize: '11.5px',
        color: 'var(--muted-2)', marginTop: '2px', textAlign: 'right' } }, r.detail));
    }
    if (r.target != null) {
      row.appendChild(h('span', { class: r.match ? 'ok' : 'bad', style: { fontSize: '12px' } },
        ` ${T('target')}: ${r.target}${r.match ? ' ✓' : ' ✗'}`));
    }
    kv.appendChild(row);
  }
  side.appendChild(kv);
  if (!S.profile.targets) {
    side.appendChild(h('div.note',
      'Целевые метрики не заданы: в профиле нет секции targets. Колонка «цель — факт» появится, когда профиль будет заполнен.'));
  }
  side.appendChild(h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
    h('button.btn.primary', { onclick: exportMetricsMd, 'data-tip': T('tips').exportMetrics }, T('exportMetrics')),
    h('button.btn', { onclick: exportDefectsCsv, 'data-tip': T('tips').exportDefects }, T('exportDefects')),
  ));
  return h('aside.right', h('div.scroll', side));
}

// --------------------------------------------------------------------------
//  Экспорт
// --------------------------------------------------------------------------
function dateSlug() {
  const d = new Date();
  return String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}

/** Встроен ли документ в чужую страницу (например, опубликован как артефакт). */
function inFrame() {
  try { return window.self !== window.top; } catch (e) { return true; }
}

let _downloadsNs;   // undefined — ещё не спрашивали; null — недоступно
async function hostDownloads() {
  if (_downloadsNs !== undefined) return _downloadsNs;
  try {
    _downloadsNs = (window.claude && typeof window.claude.use === 'function')
      ? await window.claude.use('downloads') : null;
  } catch (e) { _downloadsNs = null; }
  return _downloadsNs;
}

async function download(text, name, mime) {
  // Открыта версия из хранилища: выгрузка ложится в папку work этой версии
  if (S.vault.current && !S.vault.readOnly) {
    try {
      await writeText(S.vault.current.ver.handle, `${WORK_DIR}/${name}`, text);
      toast(`Сохранено: ${S.vault.current.dir.name}\\${S.vault.current.ver.name}\\${WORK_DIR}\\${name}`, 'Скачать копию', () => blobDownload(text, name, mime));
      return;
    } catch (e) { toast('Не удалось записать в хранилище (' + (e && e.message || e) + '), файл скачан', null, null, true); }
  }
  // Опубликованная по ссылке страница: сохранение идёт через платформу
  // (зритель подтверждает имя файла); если это недоступно — окно с текстом.
  if (S.srv) {
    blobDownload(text, name, mime);
    toast(T('gasDownloaded')(name), T('gasShowText'), () => showTextFallback(text, name));
    return;
  }
  if (inFrame()) {
    const dl = await hostDownloads();
    if (dl) {
      try { await dl.save({ filename: name, data: text }); return; }
      catch (e) {
        if (e && (e.code === 'declined' || e.code === 'rate_limited')) return;
      }
    }
    showTextFallback(text, name);
    return;
  }
  blobDownload(text, name, mime);
}

function blobDownload(text, name, mime) {
  const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

function showTextFallback(text, name) {
  const ta = h('textarea', { readonly: true, spellcheck: 'false', style: {
    width: '100%', height: '42vh', resize: 'none', fontFamily: 'var(--mono)', fontSize: '12px',
    border: '1px solid var(--line-3)', borderRadius: '8px', padding: '10px', background: '#fff' } });
  ta.value = text;
  const close = modal(name,
    [h('p', { style: { margin: '0', fontSize: '12.5px', color: 'var(--muted)' } },
      'Опубликованная по ссылке страница не может сохранять файлы — скопируйте текст. '
      + 'В локальном index.html файл скачивается обычным образом.'), ta],
    [h('button.btn', { onclick: () => { ta.select(); try { document.execCommand('copy'); } catch (e) { /* noop */ } },
      'data-tip': 'Выделить и скопировать содержимое' }, 'Скопировать'),
     h('button.btn.primary', { onclick: () => close() }, T('close'))]);
  ta.focus();
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csv(rows) {
  return '\ufeff' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
}

function exportCheckCsv(c) {
  const m = S.model;
  const rows = [['check', 'iri', 'curie', 'label_' + S.lang, 'detail']];
  for (const it of c.items) {
    const e = it.iri ? m.entities.get(it.iri) : null;
    rows.push([c.id, it.iri || it.label || '', e ? e.curie : '', e ? labelOf(m, e, S.lang).text : '', it.detail || '']);
  }
  download(csv(rows), `${dateSlug()}-ontolens-${c.id}.csv`, 'text/csv');
}

function exportDefectsCsv() {
  const m = S.model;
  const rows = [['check_id', 'group', 'severity', 'check_title_ru', 'count', 'iri', 'curie', 'label_ru', 'detail']];
  for (const c of S.checks) {
    if (!c.count) continue;
    for (const it of c.items) {
      const e = it.iri ? m.entities.get(it.iri) : null;
      rows.push([c.id, c.group, c.severity, c.title.ru, c.count, it.iri || it.label || '',
        e ? e.curie : '', e ? labelOf(m, e, 'ru').text : '', it.detail || '']);
    }
  }
  download(csv(rows), `${dateSlug()}-ontolens-defects.csv`, 'text/csv');
}

function exportMetricsMd() {
  const m = S.model;
  const L = [];
  L.push(`# METRICS — ${S.files.join(', ')}`);
  L.push('');
  L.push(`Посчитано OntoLens ${VERSION}, ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC.`);
  L.push(`Профиль: ${S.profileName}. Время разбора: ${m.loadMs} мс.`);
  L.push('');
  L.push('## Файлы');
  L.push('');
  L.push('| Файл | Триплетов | Байт |');
  L.push('|---|---:|---:|');
  for (const f of m.files) L.push(`| ${f.name} | ${f.triples} | ${f.bytes} |`);
  L.push('');
  L.push('## Показатели');
  L.push('');
  L.push(S.profile.targets ? '| Показатель | Факт | Цель | Совпало |' : '| Показатель | Значение |');
  L.push(S.profile.targets ? '|---|---|---|---|' : '|---|---|');
  for (const r of S.metrics) {
    const label = r.label.ru;
    if (S.profile.targets) {
      L.push(`| ${label} | ${r.value} | ${r.target != null ? r.target : '—'} | ${r.target != null ? (r.match ? 'да' : 'НЕТ') : '—'} |`);
    } else {
      L.push(`| ${label} | ${r.value} |`);
    }
  }
  L.push('');
  L.push('## Диагностика');
  L.push('');
  L.push('| Проверка | Категория | Уровень | Найдено |');
  L.push('|---|---|---|---:|');
  for (const c of S.checks) L.push(`| ${c.title.ru} | ${c.group} | ${c.severity} | ${c.count} |`);
  L.push('');
  L.push('Списки сущностей по каждой проверке — в файле отчёта о дефектах (CSV).');
  L.push('');
  download(L.join('\n'), `${dateSlug()}-METRICS.md`, 'text/markdown');
}

/** Список загруженных файлов с числом триплетов. */
function showFiles() {
  const m = S.model;
  let close;
  close = modal(T('files'),
    [h('div.kv', ...m.files.map((f) => h('div.r',
      h('span', f.name), h('b', `${f.triples} · ${(f.bytes / 1024).toFixed(0)} КБ`)))),
     h('p', { style: { margin: '0', fontSize: '12.5px', color: 'var(--muted-2)' } },
       `${T('profileIs')}: ${S.profileName}. ${T('triplesFmt')(m.tripleCount)}, `
       + `${T('classesTermsFmt')(m.classes.length, m.classes.filter((x) => x.isTerm).length)}.`)],
    [h('span'), h('button.btn.primary', { onclick: () => close() }, T('close'))]);
}

// --------------------------------------------------------------------------
//  Справка «как пользоваться»
// --------------------------------------------------------------------------
function showHelp() {
  const steps = T('helpSteps').map(([title, text], i) => h('div.helpstep',
    h('span', { style: {
      flexShrink: '0', width: '22px', height: '22px', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'var(--ink)', color: 'var(--paper)',
      borderRadius: '50%', fontFamily: 'var(--mono)', fontSize: '12px', marginTop: '1px' } },
      String(i + 1)),
    h('div.txt', h('b', title.replace(/^\d+\.\s*/, '')),
      h('p', text.replace('{n}', String(S.checks.length || 0))))));
  const keys = h('div.keys', ...T('helpKeys').map(([k, t]) => h('span', h('kbd', k), t)));
  let close;
  close = modal(T('helpTitle'),
    [...steps,
      h('p', { style: { margin: '2px 0 0', fontSize: '12.5px', color: 'var(--muted-2)' } }, T('helpFooter'))],
    [h('div', { style: { minWidth: '0' } },
      h('div', { style: { fontSize: '11px', letterSpacing: '.5px', textTransform: 'uppercase',
        color: 'var(--muted-2)', marginBottom: '6px' } }, T('hotkeys')),
      keys),
     h('button.btn.primary', { onclick: () => close(), style: { flexShrink: '0' } }, T('close'))]);
}

// --------------------------------------------------------------------------
//  Горячие клавиши
// --------------------------------------------------------------------------
function hotkeys(ev) {
  const inReview = S.model && S.view === 'terms' && S.rightTab === 'review';
  if (inReview && (ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
    ev.preventDefault();
    const e = S.selected && S.model.entities.get(S.selected);
    if (e && isReviewable(e)) saveCurrent(e, true);
    return;
  }
  if (ev.target.matches('input,textarea,select')) {
    if (ev.key === 'Escape') { ev.target.blur(); }
    return;
  }
  if (S.model && S.cx && cxUI.hotkey(ev)) return;
  if (inReview && /^[1-6]$/.test(ev.key) && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
    const r = document.querySelectorAll('input[name="rv-verdict"]')[Number(ev.key) - 1];
    if (r) { r.checked = true; r.dispatchEvent(new Event('change')); ev.preventDefault(); return; }
  }
  if (S.model && (ev.key === 'n' || ev.key === 'т')) { goNextUnreviewed(); return; }
  if (S.model && S.view === 'terms' && (ev.key === 'm' || ev.key === 'ь' || ev.key === 'M')) { if (minimap) minimap.toggleCollapsed(); return; }
  if (S.model && S.view === 'terms' && ev.key === 'Escape' && graphCtl) { graphCtl.resetView(); return; }
  if (ev.key === '/') { ev.preventDefault(); const i = document.getElementById('ol-search'); if (i) i.focus(); }
  if (ev.key === 'F1' || ev.key === '?') { ev.preventDefault(); if (!document.querySelector('.ol-overlay')) showHelp(); }
  if (!S.model) return;
  if ((ev.key === 'd' || ev.key === 'в') && !srvExpert()) { S.view = S.view === 'diag' ? 'terms' : 'diag'; render(); }
}

// --------------------------------------------------------------------------
//  Старт
// --------------------------------------------------------------------------
export async function boot(mount) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  root = mount;
  root.id = 'app';
  document.addEventListener('keydown', hotkeys);
  initTooltips();

  const params = new URLSearchParams(location.search);
  const lang = params.get('lang');
  if (lang && ['ru', 'kk', 'en'].includes(lang)) S.lang = lang;
  const src = params.getAll('src');
  if (src.length) {
    try {
      let prof = null;
      const lj = params.get('layout');
      if (lj) { try { S.suppliedLayout = await (await fetch(lj)).json(); } catch (e) { /* ignore */ } }
      const pj = params.get('profile');
      if (pj) { prof = await (await fetch(pj)).json(); S.profileName = pj; }
      const files = [];
      for (const u of src) {
        const r = await fetch(u);
        if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
        files.push({ name: u.split('/').pop(), text: await r.text() });
      }
      await loadTexts(files, prof);
      return;
    } catch (e) {
      S.loadError = String(e && e.message || e);
    }
  }
  if (params.get('demo') != null) { await loadDemo(); return; }
  render();
  restoreVault();
}

// --------------------------------------------------------------------------
//  Веб-версия (Apps Script): онтология с Диска, оценки в Таблицу
// --------------------------------------------------------------------------
/** Короткое сообщение внизу экрана (видно на любом экране). */
let toastEl = null, toastTimer = null;
function toast(text, actionLabel, action, bad) {
  if (toastEl) toastEl.remove();
  clearTimeout(toastTimer);
  toastEl = h('div', { class: 'ol-toast' + (bad ? ' bad' : ''), role: 'status' },
    h('span', text),
    actionLabel ? h('button.linkbtn', { onclick: () => { action(); toastEl && toastEl.remove(); } }, actionLabel) : null,
    h('button.linkbtn', { 'aria-label': T('close'), onclick: () => toastEl && toastEl.remove() }, '✕'));
  document.body.appendChild(toastEl);
  toastTimer = setTimeout(() => { if (toastEl) toastEl.remove(); }, bad ? 15000 : 9000);
}

/** Перестроить модель просмотрщика корпуса после правки формализации: иерархия следует за подтверждёнными родами. */
function rebuildCorpusModel() {
  if (!S.cx || !S.model) return;
  const hash = S.model.hash, checkId = S.activeCheck && S.activeCheck.id;
  S.profile = mergeProfile(DEFAULT_PROFILE, S.profileRaw || corpusProfile(S.cx.work.classes));
  const m = buildModel(corpusViewerFiles(S.cx), S.profile);
  if (m.tripleCount === 0) return;
  m.hash = hash; m.wallMs = S.model.wallMs;
  S.model = m;
  S.checks = runDiagnostics(m);
  S.metrics = computeMetrics(m);
  S.activeCheck = S.checks.find((c) => c.id === checkId) || S.checks.find((c) => c.count > 0) || S.checks[0];
  _orderCache = { key: null, list: [] };
  if (!S.selected || !m.entities.get(S.selected)) S.selected = termOrder()[0] || null;
  S.expanded = new Set();
  if (S.selected) expandTo(S.selected);
  buildMinimap();
}

// --------------------------------------------------------------------------
//  Хранилище моделей на диске (D:\Prog\OntoLens_Files): направления → версии
// --------------------------------------------------------------------------
async function restoreVault() {
  if (!fsSupported()) return;
  const root = await kvGet('root');
  S.vault.last = (await kvGet('last')) || null;
  if (!root) return;
  S.vault.root = root;
  try { S.vault.perm = await permission(root, false); } catch (e) { S.vault.perm = 'prompt'; }
  if (S.vault.perm === 'granted') await rescanVault(); else render();
}

async function connectVault() {
  try {
    const root = await window.showDirectoryPicker({ id: 'ontolens-vault', mode: 'readwrite' });
    S.vault.root = root; S.vault.readOnly = false; S.vault.perm = 'granted'; S.vault.error = null;
    await kvSet('root', root);
    await rescanVault();
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    S.vault.error = String(e && e.message || e); render();
  }
}

async function grantVault() {
  try { S.vault.perm = await permission(S.vault.root, true); } catch (e) { S.vault.perm = 'denied'; }
  if (S.vault.perm === 'granted') await rescanVault(); else render();
}

/** Без File System Access API (Firefox, Safari): папка через <input webkitdirectory>, только чтение. */
async function vaultFromFileList(list) {
  const root = treeFromFileList(list);
  if (!root) return;
  S.vault.root = root; S.vault.readOnly = true; S.vault.perm = 'granted'; S.vault.error = null;
  await rescanVault();
}

async function rescanVault() {
  S.vault.busy = true; render();
  try { S.vault.scan = await scanVault(S.vault.root); S.vault.error = null; }
  catch (e) { S.vault.scan = null; S.vault.error = String(e && e.message || e); }
  S.vault.busy = false;
  render();
}

/** Открыть версию пакета: mode 'onto' — онтология (TTL + профиль), 'corpus' — проверка коллизий (глоссарии). */
async function openVaultVersion(dir, ver, mode) {
  S.loading = true; render();
  try {
    if (!S.vault.readOnly && S.vault.root && S.vault.root.queryPermission) {
      const p = await permission(S.vault.root, true);
      if (p !== 'granted') S.vault.readOnly = true;
    }
    const { files, profile, layout } = await versionFiles(ver, mode);
    S.vault.current = { dir, ver, mode };
    S.suppliedLayout = layout || null;
    S.profileName = profile ? `${ver.name}\\profile.json` : 'по умолчанию';
    S.loading = false;
    await loadTexts(files, profile);
    if (!S.model) { S.vault.current = null; render(); return; }
    await mergeVaultReviews(dir, ver);
    S.vault.last = { dir: dir.name, ver: ver.name, mode, at: new Date().toISOString() };
    kvSet('last', S.vault.last);
    render();
  } catch (e) {
    S.loading = false; S.vault.current = null;
    S.loadError = `${ver.name}: ${e && e.message || e}`;
    render();
  }
}

function closeToVault() {
  flushVaultReviewSave();
  S.model = null; S.cx = null; S.vault.current = null; S.loadError = null;
  if (S.vault.root && S.vault.perm === 'granted') rescanVault(); else render();
}

/** Оценки из work\review-*.json: свои — слить с черновиком браузера (новее — по времени), чужие — в «Замечания». */
async function mergeVaultReviews(dir, ver) {
  const files = await readReviewFiles(ver);
  const me = slug(S.review.expert || loadPref('expert', ''));
  let merged = 0;
  for (const f of files) {
    let parsed, extra = {};
    try { parsed = parseReviewFile(f.name, f.text); extra = JSON.parse(f.text); } catch (e) { continue; }
    if (!me) {
      // имя эксперта в этом браузере ещё не задано: предложить перенос, а не сливать молча
      const n = Object.values(parsed.items).filter((r) => r && r.verdict).length;
      if (n && !Object.keys(S.review.items).length && !(S.otherReviews || []).length) S.otherReviews = [{ hash: 'vault:' + ver.name, expert: parsed.expert, updated: '', count: n, mainNs: '', data: { items: parsed.items } }];
      S.imported = S.imported.filter((x) => x.file !== f.name);
      S.imported.push({ ...parsed, items: Object.fromEntries(Object.entries(parsed.items).filter(([iri]) => S.model.entities.has(iri))), unmatched: 0, fromVault: true });
      continue;
    }
    if (slug(parsed.expert) === me) {
      if (!S.review.expert) S.review.expert = parsed.expert;
      const all = { ...parsed.items, ...(extra.conflicts || {}) };
      for (const [k, rec] of Object.entries(all)) {
        const cur = S.review.items[k];
        if (!cur || String(rec.ts || '') > String(cur.ts || '')) { S.review.items[k] = rec; merged++; }
      }
    } else {
      S.imported = S.imported.filter((x) => x.file !== f.name);
      S.imported.push({ ...parsed, items: Object.fromEntries(Object.entries(parsed.items).filter(([iri]) => S.model.entities.has(iri))), unmatched: 0, fromVault: true });
    }
  }
  if (merged) { S.otherReviews = []; saveReview(reviewKey(S.model.hash), S.review); }
  // нет своих оценок — предложить перенос с предыдущей версии того же направления
  if (!Object.keys(S.review.items).length && !(S.otherReviews || []).length) {
    const idx = dir.versions.indexOf(ver);
    for (const prev of dir.versions.slice(idx + 1)) {
      if (!prev.reviewFiles.length) continue;
      for (const f of await readReviewFiles(prev)) {
        let parsed; try { parsed = parseReviewFile(f.name, f.text); } catch (e) { continue; }
        if (me && slug(parsed.expert) !== me) continue;
        const n = Object.values(parsed.items).filter((r) => r && r.verdict).length;
        if (n) { S.otherReviews = [{ hash: 'vault:' + prev.name, expert: parsed.expert, updated: '', count: n, mainNs: '', data: { items: parsed.items } }]; return; }
      }
    }
  }
}

let _vaultSaveTimer = null;
function scheduleVaultReviewSave() {
  if (!S.vault.current || S.vault.readOnly || !S.model) return;
  clearTimeout(_vaultSaveTimer);
  _vaultSaveTimer = setTimeout(() => { _vaultSaveTimer = null; writeVaultReview(); }, 700);
}
function flushVaultReviewSave() { if (_vaultSaveTimer) { clearTimeout(_vaultSaveTimer); _vaultSaveTimer = null; writeVaultReview(); } }

async function writeVaultReview() {
  const cur = S.vault.current;
  if (!cur || S.vault.readOnly || !S.model || !S.review.expert) return;
  const rows = reviewRows(S.review.items);
  const conflicts = Object.fromEntries(Object.entries(S.review.items).filter(([k, r]) => k.startsWith('conflict:') && r && r.verdict));
  if (!rows.length && !Object.keys(conflicts).length) return;
  const text = reviewToJson(rows, S.review.expert, { ontology: S.files.join(', '), graph_hash: S.model.hash, version: cur.ver.name, conflicts });
  try {
    await writeText(cur.ver.handle, `${WORK_DIR}/review-${slug(S.review.expert)}.json`, text);
    S.vault.lastSaved = new Date();
  } catch (e) { toast('Оценки не записаны в папку версии: ' + (e && e.message || e), null, null, true); }
}
window.addEventListener('beforeunload', () => flushVaultReviewSave());

/** Отчёт о сборке (METRICS.md) — в окне, простым Markdown. */
async function showVersionReport(ver) {
  const text = await readText(ver.handle, ver.metricsMd);
  modal(ver.name + ' — ' + ver.metricsMd, [h('div.md', ...mdLite(text || ''))], [h('button.btn', { onclick: () => blobDownload(text || '', ver.metricsMd, 'text/markdown') }, 'Скачать')]);
}

function mdInline(s) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let i = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > i) out.push(s.slice(i, m.index));
    out.push(m[0][0] === '*' ? h('b', m[0].slice(2, -2)) : h('code.mono', m[0].slice(1, -1)));
    i = m.index + m[0].length;
  }
  if (i < s.length) out.push(s.slice(i));
  return out;
}
function mdLite(text) {
  const nodes = [];
  const lines = text.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,3}\s/.test(l)) { const n = l.match(/^#+/)[0].length; nodes.push(h(n === 1 ? 'h2' : 'h3', ...mdInline(l.replace(/^#+\s*/, '')))); continue; }
    if (/^\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      i--;
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = rows.filter((r) => !/^\|[\s:|-]+\|$/.test(r));
      nodes.push(h('table.mdt', ...body.map((r, k) => h('tr', ...cells(r).map((c) => h(k === 0 ? 'th' : 'td', ...mdInline(c)))))));
      continue;
    }
    if (/^\s*[-*]\s/.test(l)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s/, '')); i++; }
      i--;
      nodes.push(h('ul', ...items.map((x) => h('li', ...mdInline(x)))));
      continue;
    }
    if (/^```/.test(l)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      nodes.push(h('pre.mono', buf.join('\n')));
      continue;
    }
    if (l.trim()) nodes.push(h('p', ...mdInline(l)));
  }
  return nodes;
}

function vaultPanel() {
  const V = S.vault;
  const supported = fsSupported();
  const dirInput = supported ? null : h('input', { type: 'file', class: 'sr', webkitdirectory: true, multiple: true, 'aria-label': 'Папка хранилища', tabindex: '-1',
    onchange: (e) => vaultFromFileList(e.target.files) });
  const head = h('div.vhead',
    h('h2.vh', 'Хранилище моделей'),
    V.root ? h('span.vroot', { 'data-tip': V.readOnly ? 'Папка открыта только для чтения: оценки и выгрузки не записываются в неё' : 'Работа (оценки, формализации, выгрузки) сохраняется в папку work открытой версии' },
      h('code.mono', V.root.name), V.perm === 'granted' ? (V.readOnly ? ' · только чтение' : ' · доступ есть') : '') : null,
    h('div.spacer'),
    V.root && V.perm === 'granted' ? h('button.btn', { onclick: rescanVault, 'data-tip': 'Перечитать папку: новые направления и версии' }, 'Обновить') : null,
    supported ? h('button.btn' + (V.root ? '' : '.primary'), { onclick: connectVault, 'data-tip': 'Выбрать папку хранилища, например D:\\Prog\\OntoLens_Files. Браузер запомнит её.' }, V.root ? 'Другая папка…' : 'Подключить хранилище')
      : h('button.btn' + (V.root ? '' : '.primary'), { onclick: () => dirInput.click(), 'data-tip': 'В этом браузере папку можно только читать. Для записи откройте OntoLens в Chrome или Edge.' }, V.root ? 'Другая папка…' : 'Выбрать папку хранилища'),
    dirInput);
  const box = h('section.vault', head);
  if (!V.root) {
    box.appendChild(h('p.vnote', supported
      ? 'Выберите папку хранилища (D:\\Prog\\OntoLens_Files) — один раз. Дальше версии открываются одной кнопкой, а оценки, формализации и выгрузки сохраняются в папку work рядом с моделью.'
      : 'В этом браузере нет записи в папки: хранилище откроется только для чтения, работа останется в браузере. Для полной работы откройте OntoLens в Chrome или Edge.'));
    return box;
  }
  if (V.perm !== 'granted') {
    box.appendChild(h('div.vgrant', h('span', `Браузер помнит папку «${V.root.name}», но после перезапуска просит подтвердить доступ.`),
      h('button.btn.primary', { onclick: grantVault }, 'Разрешить доступ')));
    return box;
  }
  if (V.busy) { box.appendChild(h('p.vnote', 'Читаю папку…')); return box; }
  if (V.error) box.appendChild(h('div.errbox', V.error));
  const scan = V.scan;
  if (!scan) return box;
  if (!scan.directions.length) {
    box.appendChild(h('p.vnote', `В папке «${scan.name}» нет направлений. Направление — подпапка ${DIRECTION_PREFIX}<НАЗВАНИЕ>, внутри неё — папки версий ГГММДД-Имя-vX.Y с файлами .ttl.`));
    return box;
  }
  const last = V.last;
  for (const d of scan.directions) {
    const sec = h('div.vdir', h('div.vdirh', h('b', d.label), h('span.mono', d.name), h('span', `${d.versions.length} ${plural(d.versions.length, ['версия', 'версии', 'версий'])}`)));
    if (!d.versions.length) sec.appendChild(h('p.vnote', 'Версий пока нет.'));
    d.versions.forEach((v, i) => {
      const isLast = last && last.dir === d.name && last.ver === v.name;
      const meta = [v.parsed ? v.parsed.dateText : '', v.summary,
        v.reviewFiles.length ? `оценки: ${v.reviewFiles.length} ${plural(v.reviewFiles.length, ['файл', 'файла', 'файлов'])}` : '',
        v.hasCorpusWork ? 'есть формализации' : ''].filter(Boolean).join(' · ');
      sec.appendChild(h('div.vver' + (i === 0 ? '.latest' : ''),
        h('div.vvname', h('span.mono', v.name), i === 0 ? h('span.pill', 'последняя') : null, isLast ? h('span.pill.vlast', 'открывали последней') : null),
        h('div.vmeta', meta || `${v.ttl.length} файл(ов) .ttl`),
        h('div.vbtns',
          v.ttl.length ? h('button.btn' + (i === 0 ? '.primary' : ''), { onclick: () => openVaultVersion(d, v, 'onto'), 'data-tip': `Открыть онтологию: ${v.ttl.join(', ')}${v.profile ? ' + profile.json' : ''}` }, 'Открыть') : null,
          v.corpusCsv.length ? h('button.btn', { onclick: () => openVaultVersion(d, v, 'corpus'), 'data-tip': `Проверка коллизий по глоссарию: ${v.corpusCsv.join(', ')}` }, 'Коллизии') : null,
          v.metricsMd ? h('button.btn', { onclick: () => showVersionReport(v), 'data-tip': 'Отчёт о сборке пакета (METRICS.md)' }, 'Отчёт') : null)));
    });
    box.appendChild(sec);
  }
  return box;
}

function cxView() { return !!(S.cx && ['conflicts', 'formal', 'axioms'].includes(S.view)); }
function srvExpert() { return !!(S.srv && S.srv.role !== 'editor'); }

/** Оценка коллизии: хранится рядом с оценками терминов, ключ — 'conflict:…' (ТЗ v3.1, 6). */
function saveConflictReview(key, rec) {
  if (S.srv && S.srv.preview) return;
  S.review.items[key] = rec;
  saveReview(reviewKey(S.model.hash), S.review);
  if (syncQ) syncQ.push(key, rec);
  scheduleVaultReviewSave();
}

const cxUI = makeCorpusUI({ h, S, render: () => render(), toast: (...a) => toast(...a), download: (...a) => download(...a), csv, dateSlug, modal,
  saveConflictReview, storeNote: () => srvStoreNote(), onWorkChanged: () => rebuildCorpusModel(),
  workStore: (local) => (S.vault.current && !S.vault.readOnly && !S.srv
    ? makeFileWorkStore(S.vault.current.ver, local, (e) => toast('Работа не записана в папку версии: ' + (e && e.message || e), null, null, true))
    : local) });

/** Строка оценки коллеги (та же разметка, что у импортированных файлов). */
function otherRow(name, it) {
  const v = it && it.verdict ? VERDICT_BY_CODE[it.verdict] : null;
  const extra = it ? [it.def_ru_fixed && `опр.: ${it.def_ru_fixed}`, it.label_kk_fixed && `kk: ${it.label_kk_fixed}`,
    it.label_ru_fixed && `ru: ${it.label_ru_fixed}`, it.label_en_fixed && `en: ${it.label_en_fixed}`,
    it.parent_proposed && `родитель: ${it.parent_proposed}`, it.comment].filter(Boolean).join(' · ') : '';
  return h('div.r.wide',
    h('span', name, ' ', v ? h('span', { class: 'dot v-' + v.code, style: { display: 'inline-block', marginLeft: '4px' } }) : null),
    h('b', { style: { fontFamily: 'var(--sans)' } }, v ? pickLang(v, S.lang) : '—'),
    extra ? h('span', { style: { display: 'block', fontSize: '12px', color: 'var(--muted)', marginTop: '2px' } }, extra) : null);
}

let _othersReq = null;
async function loadOthers(iri) {
  if (_othersReq === iri) return;
  _othersReq = iri;
  try {
    const r = await S.srv.backend.othersForTerm(S.srv.ontology.id, S.ontVersion, iri,
      S.srv.ontology.experts.concat(S.srv.ontology.editors));
    S.others = { iri, hidden: r.hidden, items: r.items };
  } catch (e) {
    S.others = { iri, hidden: true, items: [] };
  }
  _othersReq = null;
  if (S.selected === iri && S.view === 'terms') render();
}

/**
 * Открыть рабочее пространство на платформе (ТЗ v2.2, 5.3).
 * ctx: {backend, ontology, vid, email, name, role:'editor'|'expert', files, profile, profileName, layout,
 *       prevVid, preview, onBack, onPublished, lang}
 */
export async function openWorkspace(mount, ctx) {
  if (!root) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    document.addEventListener('keydown', hotkeys);
    initTooltips();
  }
  root = mount;
  root.id = 'app';
  S.srv = ctx;
  S.ontVersion = ctx.vid || '';
  S.role = ctx.role === 'editor' ? 'author' : 'expert';
  if (ctx.lang) S.lang = ctx.lang;
  S.view = 'terms';
  S.serverReviews = null;
  S.others = null;
  S.imported = [];
  S.suppliedLayout = ctx.layout || null;
  S.profileName = ctx.profileName || 'по умолчанию';
  S.sync = { pending: 0, lastOk: null, error: null };
  syncQ = ctx.preview ? null : makeSyncQueue(
    (iri, rec) => ctx.backend.saveReview(ctx.ontology.id, S.ontVersion, iri, rec),
    (st) => { S.sync = st; updateSyncNote(); });
  if (ctx.preview && !(ctx.files && ctx.files.length)) { S.model = null; render(); return; }
  await loadTexts(ctx.files, ctx.profile || null);
  if (!S.model) return;
  S.rightTab = ctx.preview || ctx.role === 'editor' ? 'info' : 'review';
  if (!ctx.preview) {
    try {
      let server = await ctx.backend.myReviews(ctx.ontology.id, S.ontVersion);
      // новая версия: перенести свои оценки с предыдущей (по IRI, затем по dcterms:identifier)
      if (!Object.keys(server).length && ctx.prevVid) {
        const prev = await ctx.backend.myReviews(ctx.ontology.id, ctx.prevVid);
        if (Object.keys(prev).length) {
          const r = carryOver({ data: { items: prev }, hash: ctx.prevVid }, S.model);
          for (const [iri, rec] of Object.entries(r.items)) S.review.items[iri] = { ...rec, ts: rec.ts || new Date().toISOString() };
          toast(T('srvCarried')(Object.keys(r.items).length, ctx.prevVid, r.lost.length));
        }
      }
      const m = mergeReviews(S.review.items, server || {});
      S.review.items = m.items;
      saveReview(reviewKey(S.model.hash), S.review);
      for (const iri of m.toPush) syncQ.push(iri, S.review.items[iri]);
      if (minimap) minimap.rebuildBase();
      // курсор — на первый непроверенный термин
      const first = termOrder().find((iri) => !(S.review.items[iri] && S.review.items[iri].verdict));
      if (first && ctx.role !== 'editor') { S.selected = first; S.expanded = new Set(); expandTo(first); }
    } catch (e) {
      toast(T('srvSyncFail') + ': ' + (e && e.message || e), null, null, true);
    }
    if (ctx.role === 'editor') await srvLoadAll(false);
  }
  render();
}

/** Перечитать оценки всех экспертов (редактор). */
async function srvLoadAll(rerender) {
  try {
    S.serverReviews = await S.srv.backend.allReviews(S.srv.ontology.id, S.ontVersion);
    if (rerender) { render(); toast(T('srvRefreshed')(S.serverReviews.length)); }
  } catch (e) {
    toast(T('srvSyncFail') + ': ' + (e && e.message || e), null, null, true);
  }
}

function srvStoreText() {
  const st = S.sync || {};
  if (st.fatal) return { bad: true, text: T('srvStoreDenied')(st.error) };
  if (st.error && st.pending) return { bad: true, text: T('srvStoreErr')(st.pending, st.error) };
  if (st.pending) return { bad: false, text: T('srvStorePending')(st.pending) };
  const t = st.lastOk ? st.lastOk.toLocaleTimeString(S.lang === 'en' ? 'en-GB' : 'ru-RU', { hour: '2-digit', minute: '2-digit' }) : null;
  return { bad: false, text: T('srvStoreOk')(t) };
}

function srvStoreNote() {
  if (S.srv.preview) return h('p', { class: 'rv-store' }, T('srvPreviewNote'));
  const s = srvStoreText();
  return h('p', { id: 'rv-store', class: 'rv-store' + (s.bad ? ' bad' : ''), role: 'status' }, s.text);
}

function updateSyncNote() {
  const el = document.getElementById('rv-store');
  if (!el || !S.srv) return;
  const s = srvStoreText();
  el.textContent = s.text;
  el.className = 'rv-store' + (s.bad ? ' bad' : '');
}

/** Сводка метрик для карточки версии. */
export function versionMetrics() {
  if (!S.model) return {};
  const m = S.model;
  const errors = S.checks.filter((c) => c.severity === 'error' && c.count > 0).reduce((a, c) => a + c.count, 0);
  return { triples: m.tripleCount, classes: m.classes.length, terms: m.classes.filter((x) => x.isTerm).length,
    collections: m.collections.length, errors, parseErrors: m.parseErrors.length };
}

/** То, что загружено в предпросмотр новой версии (для публикации). */
export function previewPayload() {
  return { files: S.fileTexts || [], profile: S.profileRaw, profileName: S.profileName, layout: S.suppliedLayout,
    metrics: versionMetrics(), ok: !!S.model && S.model.tripleCount > 0 };
}

export async function loadLegacy() {
  const { LEGACY_FILES, LEGACY_PROFILE } = await import('./demo-data.js');
  S.profileName = 'geont-kz (встроенный)';
  await loadTexts(LEGACY_FILES.map((f) => ({ name: f.name, text: f.text })), LEGACY_PROFILE);
  S.view = 'diag';
  render();
  return true;
}

export { S as state, select, render };
/** Точки доступа для приёмочных тестов (tests/run.mjs). */
export const testHooks = {
  minimap: () => minimap,
  graph: () => graphCtl,
  recomputeMapLayout: () => computeMapLayout(S.model),
  termOrder: () => termOrder(),
};
