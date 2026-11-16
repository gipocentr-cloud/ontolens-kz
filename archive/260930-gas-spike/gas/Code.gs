/**
 * OntoLens-KZ — веб-приложение Google Apps Script.
 *
 * Страницу отдаёт doGet: собранный OntoLens (папка app/ на Диске) + паспорт
 * входа window.__OL_BOOT__. Онтология читается из папки «онтология/<версия>»,
 * оценки экспертов пишутся в Таблицу «OntoLens_данные» (лист «Оценки»).
 * Вход — по личной ссылке ?k=<токен> из листа «Допуск».
 *
 * Первый запуск: выполнить setup() в редакторе и дать разрешения.
 * Публикация: Развернуть → Новое развёртывание → Веб-приложение,
 * «Выполнять от имени: я», «Доступ: все».
 */

const ROOT_FOLDER_ID = '1nm6YBkwjBePX0LaZU6CpPe_2h3_XaPav';   // папка web-OntoLens
const SS_NAME = 'OntoLens_данные';
const APP_FOLDER = 'app';
const ONT_FOLDER = 'онтология';
const EXPORT_FOLDER = 'экспорт';

const REVIEW_COLS = ['id', 'verdict', 'def_ru_fixed', 'label_kk_fixed', 'parent_proposed', 'comment', 'ts',
  'iri', 'label_ru', 'label_ru_fixed', 'label_en_fixed', 'duplicate_of', 'expert'];
const SHEET_COLS = REVIEW_COLS.concat(['version', 'token', 'updated']);
const ACCESS_COLS = ['token', 'name', 'role', 'active', 'link', 'created', 'comment'];
const SETTINGS_COLS = ['key', 'value', 'comment'];
const LOG_COLS = ['ts', 'token', 'name', 'action', 'details'];
const VERDICTS = ['ok', 'fix', 'delete', 'not_my_domain', 'duplicate'];
const MAX_FIELD = 10000;

// ---------------------------------------------------------------------------
//  Настройка
// ---------------------------------------------------------------------------

/** Создаёт папки, Таблицу, листы и строку автора. Повторный запуск безопасен. */
function setup() {
  const root = root_();
  sub_(root, APP_FOLDER, true);
  const ont = sub_(root, ONT_FOLDER, true);
  sub_(root, EXPORT_FOLDER, true);

  let ss = ss_();
  if (!ss) {
    ss = SpreadsheetApp.create(SS_NAME);
    DriveApp.getFileById(ss.getId()).moveTo(root);
    PropertiesService.getScriptProperties().setProperty('SS_ID', ss.getId());
  }
  const access = ensureSheet_(ss, 'Допуск', ACCESS_COLS);
  const reviews = ensureSheet_(ss, 'Оценки', SHEET_COLS);
  reviews.getRange(1, 1, reviews.getMaxRows(), SHEET_COLS.length).setNumberFormat('@');
  access.getRange(1, 1, access.getMaxRows(), 1).setNumberFormat('@');
  const settings = ensureSheet_(ss, 'Настройки', SETTINGS_COLS);
  ensureSheet_(ss, 'Журнал', LOG_COLS);
  ss.getSheets().forEach(function (sh) {
    if (['Допуск', 'Оценки', 'Настройки', 'Журнал'].indexOf(sh.getName()) < 0 && sh.getLastRow() === 0) ss.deleteSheet(sh);
  });

  if (!getSetting_('current_version')) {
    const it = ont.getFolders();
    const first = it.hasNext() ? it.next().getName() : 'demo';
    setSetting_('current_version', first,
      'Имя подпапки в «онтология/», которую видят эксперты. demo — встроенный синтетический набор.');
  }
  if (getSetting_('app_url') === null) {
    setSetting_('app_url', '', 'Адрес веб-приложения (…/exec). Заполняется сам при первом открытии.');
  }

  const rows = access.getDataRange().getValues().slice(1);
  if (!rows.some(function (r) { return normRole_(r[2]) === 'author'; })) {
    access.appendRow([newToken_(), 'Автор', 'author', true, '', new Date(), 'создано setup()']);
  }
  issueTokens_();
  const msg = 'Готово. Таблица: ' + ss.getUrl() + ' · версия онтологии: ' + getSetting_('current_version');
  Logger.log(msg);
  return msg;
}

/** Проставляет токены и ссылки для новых строк «Допуска». Запускается и сам при входе автора. */
function issueTokens() { return issueTokens_(); }

// ---------------------------------------------------------------------------
//  Страница
// ---------------------------------------------------------------------------

function doGet(e) {
  const p = (e && e.parameter) || {};
  rememberUrl_();
  let user = p.k ? access_(String(p.k)) : null;
  if (!user && !p.k) user = ownerSession_();
  if (!user) return noAccess_();
  if (user.role === 'author') issueTokens_();
  log_(user, 'open', p.lang || '');

  const boot = { token: user.token, role: user.role, expert: user.name, lang: String(p.lang || '') };
  const inject = '<script>window.__OL_BOOT__=' + JSON.stringify(boot).replace(/</g, '\\u003c') + ';</script>';
  let html = appHtml_();
  const at = html.indexOf('</head>');
  html = at >= 0 ? html.slice(0, at) + inject + html.slice(at) : inject + html;
  return HtmlService.createHtmlOutput(html)
    .setTitle('OntoLens-KZ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function noAccess_() {
  return HtmlService.createHtmlOutput(
    '<div style="font:15px/1.5 system-ui,sans-serif;max-width:520px;margin:12vh auto;padding:0 16px;color:#16181C">'
    + '<h1 style="font-size:20px">OntoLens-KZ: нет доступа</h1>'
    + '<p>Ссылка недействительна или отозвана. Откройте личную ссылку, которую вам прислал автор онтологии, '
    + 'или напишите ему.</p></div>').setTitle('OntoLens-KZ — нет доступа');
}

/**
 * Собранный OntoLens. В app/ лежит OntoLens-app.json {build, parts:[имена]} и части
 * страницы; при нескольких файлах с одним именем берётся самый свежий. Кэш — 6 часов.
 */
function appHtml_() {
  const folder = sub_(root_(), APP_FOLDER, false);
  if (!folder) throw new Error('Нет папки app/ с файлами OntoLens');
  const latest = {};
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const n = f.getName();
    if (!latest[n] || f.getLastUpdated().getTime() > latest[n].getLastUpdated().getTime()) latest[n] = f;
  }
  let parts;
  if (latest['OntoLens-app.json']) {
    const man = JSON.parse(latest['OntoLens-app.json'].getBlob().getDataAsString('UTF-8'));
    parts = (man.parts || []).map(function (n) {
      if (!latest[n]) throw new Error('В app/ нет части ' + n + ' (сборка ' + man.build + ')');
      return latest[n];
    });
  } else {
    parts = Object.keys(latest).filter(function (n) { return /^OntoLens-app.*\.html$/i.test(n); }).sort()
      .map(function (n) { return latest[n]; });
  }
  if (!parts.length) throw new Error('В папке app/ нет файлов OntoLens');
  const sig = parts.map(function (f) { return f.getId() + ':' + f.getLastUpdated().getTime(); }).join('|');
  const key = 'app:' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, sig)).slice(0, 16);
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(key + ':n'));
  if (n) {
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(key + ':' + i);
    const got = cache.getAll(keys);
    if (keys.every(function (k) { return got[k] != null; })) return keys.map(function (k) { return got[k]; }).join('');
  }
  const html = parts.map(function (f) { return f.getBlob().getDataAsString('UTF-8'); }).join('');
  try {
    const CH = 40000, put = {};
    let i = 0;
    for (let at = 0; at < html.length; at += CH) put[key + ':' + (i++)] = html.slice(at, at + CH);
    put[key + ':n'] = String(i);
    cache.putAll(put, 21600);
  } catch (err) { /* кэш — только ускорение */ }
  return html;
}

// ---------------------------------------------------------------------------
//  API для страницы (google.script.run)
// ---------------------------------------------------------------------------

/** Онтология текущей версии. */
function apiOntology(token) {
  const u = must_(token);
  const version = String(getSetting_('current_version') || 'demo');
  if (version === 'demo') return { version: 'demo', demo: true, files: [] };
  const ont = sub_(root_(), ONT_FOLDER, false);
  const dir = ont && sub_(ont, version, false);
  if (!dir) throw new Error('Нет папки «' + ONT_FOLDER + '/' + version + '» — проверьте current_version в листе «Настройки».');
  const files = [];
  let profile = null, profileName = '', layout = null;
  const it = dir.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const name = f.getName();
    if (/\.(ttl|turtle|nt|n3)$/i.test(name)) {
      files.push({ name: name, text: f.getBlob().getDataAsString('UTF-8') });
    } else if (/map-layout.*\.json$/i.test(name)) {
      try { layout = JSON.parse(f.getBlob().getDataAsString('UTF-8')); } catch (e) { /* пропустить */ }
    } else if (/profile.*\.json$/i.test(name)) {
      profile = JSON.parse(f.getBlob().getDataAsString('UTF-8'));
      profileName = name;
    }
  }
  files.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  log_(u, 'ontology', version + ' · файлов: ' + files.length);
  return { version: version, files: files, profile: profile, profileName: profileName, layout: layout };
}

/** Свои оценки версии: {iri: rec}. */
function apiMyReviews(token, version) {
  const u = must_(token);
  const out = {};
  reviewRows_().forEach(function (r) {
    if (r.token === u.token && r.version === String(version)) out[r.rec.iri] = r.rec;
  });
  return out;
}

/** Все оценки версии по экспертам — только автору. */
function apiAllReviews(token, version) {
  const u = must_(token);
  if (u.role !== 'author') throw new Error('Сводка доступна только автору.');
  const names = {};
  accessRows_().forEach(function (a) { names[a.token] = a.name; });
  const by = {};
  reviewRows_().forEach(function (r) {
    if (r.version !== String(version)) return;
    if (!by[r.token]) by[r.token] = { expert: names[r.token] || r.rec.expert || '?', token8: r.token.slice(0, 8), items: {} };
    by[r.token].items[r.rec.iri] = r.rec;
  });
  return Object.keys(by).map(function (k) { return by[k]; });
}

/** Записать (или заменить) оценку эксперта по термину. */
function apiSaveReview(token, version, iri, rec) {
  const u = must_(token);
  const current = String(getSetting_('current_version') || 'demo');
  if (String(version) !== current) {
    throw new Error('Версия онтологии сменилась на «' + current + '». Перезагрузите страницу.');
  }
  iri = String(iri || '');
  if (!iri || iri.length > 2000) throw new Error('Некорректный IRI');
  rec = rec || {};
  if (VERDICTS.indexOf(String(rec.verdict)) < 0) throw new Error('Некорректная оценка: ' + rec.verdict);
  const row = REVIEW_COLS.map(function (c) {
    if (c === 'iri') return iri;
    if (c === 'expert') return u.name;
    return cell_(rec[c]);
  }).concat([current, u.token, new Date().toISOString()]);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_('Оценки');
    const last = sh.getLastRow();
    let target = 0;
    if (last > 1) {
      const iIri = SHEET_COLS.indexOf('iri'), iVer = SHEET_COLS.indexOf('version'), iTok = SHEET_COLS.indexOf('token');
      const vals = sh.getRange(2, 1, last - 1, SHEET_COLS.length).getValues();
      for (let i = 0; i < vals.length; i++) {
        if (String(vals[i][iIri]) === iri && String(vals[i][iVer]) === current && String(vals[i][iTok]) === u.token) {
          target = i + 2; break;
        }
      }
    }
    if (!target) target = last + 1;
    sh.getRange(target, 1, 1, SHEET_COLS.length).setNumberFormat('@').setValues([row]);
  } finally {
    lock.releaseLock();
  }
  log_(u, 'review', rec.verdict + ' · ' + iri);
  return { ok: true };
}

// ---------------------------------------------------------------------------
//  Допуск
// ---------------------------------------------------------------------------

function accessRows_() {
  const sh = sheet_('Допуск');
  const vals = sh.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < vals.length; i++) {
    const r = vals[i];
    out.push({ row: i + 1, token: String(r[0] || '').trim(), name: String(r[1] || '').trim(),
      role: normRole_(r[2]), active: isActive_(r[3]) });
  }
  return out;
}

function access_(token) {
  if (!token || token.length < 12) return null;
  const hit = accessRows_().filter(function (a) { return a.token === token && a.active && a.name; })[0];
  return hit ? { token: hit.token, name: hit.name, role: hit.role } : null;
}

function must_(token) {
  const u = access_(String(token || ''));
  if (!u) throw new Error('Доступ отозван или ссылка недействительна.');
  return u;
}

/** Владелец скрипта, открывший ссылку без токена (работает, если Google сообщает его адрес). */
function ownerSession_() {
  let me = '';
  try { me = Session.getActiveUser().getEmail(); } catch (e) { /* нет данных */ }
  const owner = Session.getEffectiveUser().getEmail();
  if (!me || me !== owner) return null;
  const a = accessRows_().filter(function (x) { return x.role === 'author' && x.active && x.token; })[0];
  return a ? { token: a.token, name: a.name, role: 'author' } : null;
}

function issueTokens_() {
  const sh = sheet_('Допуск');
  const vals = sh.getDataRange().getValues();
  const base = appUrl_();
  let changed = 0;
  for (let i = 1; i < vals.length; i++) {
    const r = vals[i];
    if (!String(r[1] || '').trim()) continue;
    if (!String(r[0] || '').trim()) { r[0] = newToken_(); changed++; }
    if (r[2] === '' || r[2] == null) { r[2] = 'expert'; changed++; }
    if (r[3] === '' || r[3] == null) { r[3] = true; changed++; }
    if (!r[5]) { r[5] = new Date(); changed++; }
    const link = base ? base + '?k=' + r[0] : '';
    if (link && r[4] !== link) { r[4] = link; changed++; }
  }
  if (changed) sh.getRange(1, 1, vals.length, ACCESS_COLS.length).setValues(vals);
  return changed;
}

function normRole_(v) {
  const s = String(v || '').trim().toLowerCase();
  return (s === 'author' || s === 'автор') ? 'author' : 'expert';
}

function isActive_(v) {
  if (v === false) return false;
  const s = String(v).trim().toLowerCase();
  return ['false', 'нет', '0', 'no', 'отозван'].indexOf(s) < 0;
}

function newToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}

// ---------------------------------------------------------------------------
//  Таблица, настройки, журнал
// ---------------------------------------------------------------------------

function root_() { return DriveApp.getFolderById(ROOT_FOLDER_ID); }

function sub_(parent, name, create) {
  const it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return create ? parent.createFolder(name) : null;
}

function ss_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SS_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) { /* удалена — ищем заново */ } }
  const it = root_().getFilesByName(SS_NAME);
  if (it.hasNext()) {
    const f = it.next();
    props.setProperty('SS_ID', f.getId());
    return SpreadsheetApp.openById(f.getId());
  }
  return null;
}

function sheet_(name) {
  const ss = ss_();
  if (!ss) throw new Error('Не найдена Таблица ' + SS_NAME + ' — выполните setup().');
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Нет листа «' + name + '» — выполните setup().');
  return sh;
}

function ensureSheet_(ss, name, cols) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function reviewRows_() {
  const sh = sheet_('Оценки');
  const last = sh.getLastRow();
  if (last < 2) return [];
  const vals = sh.getRange(2, 1, last - 1, SHEET_COLS.length).getValues();
  return vals.map(function (v) {
    const rec = {};
    REVIEW_COLS.forEach(function (c, i) { rec[c] = v[i] instanceof Date ? v[i].toISOString() : String(v[i] == null ? '' : v[i]); });
    const o = {};
    SHEET_COLS.slice(REVIEW_COLS.length).forEach(function (c, i) { o[c] = String(v[REVIEW_COLS.length + i] || ''); });
    return { rec: rec, version: o.version, token: o.token };
  }).filter(function (r) { return r.rec.iri && r.token; });
}

function cell_(v) {
  let s = v == null ? '' : String(v);
  if (s.length > MAX_FIELD) s = s.slice(0, MAX_FIELD);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function getSetting_(key) {
  const vals = sheet_('Настройки').getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) if (String(vals[i][0]).trim() === key) return String(vals[i][1] == null ? '' : vals[i][1]).trim();
  return null;
}

function setSetting_(key, value, comment) {
  const sh = sheet_('Настройки');
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === key) { sh.getRange(i + 1, 2).setValue(value); return; }
  }
  sh.appendRow([key, value, comment || '']);
}

function appUrl_() {
  const s = getSetting_('app_url');
  if (s) return s.replace(/\?.*$/, '');
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}

/** Запоминает адрес …/exec при первом открытии веб-приложения. */
function rememberUrl_() {
  try {
    if (getSetting_('app_url')) return;
    const u = ScriptApp.getService().getUrl();
    if (u && /\/exec$/.test(u)) setSetting_('app_url', u);
  } catch (e) { /* не критично */ }
}

function log_(u, action, details) {
  try {
    sheet_('Журнал').appendRow([new Date(), (u.token || '').slice(0, 8), u.name || '', action, String(details || '').slice(0, 500)]);
  } catch (e) { /* журнал не должен ломать работу */ }
}
