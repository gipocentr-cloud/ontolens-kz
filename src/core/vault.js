/**
 * Хранилище моделей на диске пользователя (папка вида D:\Prog\OntoLens_Files).
 *
 * Структура (см. «Структура-папки-OntoLens_Files.md» в корне хранилища):
 *   <хранилище>\OntoLensF_<НАПРАВЛЕНИЕ>\ГГММДД-<Имя>-vX.Y\  — распакованный пакет версии
 *       *.ttl, profile.json, METRICS.md, metrics.json, corpus\*.csv, work\ (работа в OntoLens)
 *
 * Доступ к папке — File System Access API (Chrome, Edge): папка выбирается один раз,
 * дескриптор хранится в IndexedDB, при следующем запуске браузер спрашивает только разрешение.
 * В других браузерах — выбор папки через <input webkitdirectory>: только чтение.
 *
 * Модуль не знает о DOM приложения: работает с любым объектом, похожим на FileSystemDirectoryHandle
 * (kind, name, entries(), getDirectoryHandle(), getFileHandle()).
 */

export const DIRECTION_PREFIX = 'OntoLensF_';
export const WORK_DIR = 'work';
const VERSION_RE = /^(\d{6})[-_](.+?)(?:[-_]v(\d+(?:\.\d+)*))?$/i;

export const fsSupported = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

// ------------------------------------------------------------------ разбор имён
/** «261116-TimsoOnt-KZ-v0.2» → {date:'261116', dateText:'16.11.2026', title:'TimsoOnt-KZ', version:'0.2'} */
export function parseVersionName(name) {
  const m = VERSION_RE.exec(name);
  if (!m) return null;
  const d = m[1];
  return { date: d, dateText: `${d.slice(4, 6)}.${d.slice(2, 4)}.20${d.slice(0, 2)}`, title: m[2], version: m[3] || '' };
}

export function directionLabel(name) {
  return name.startsWith(DIRECTION_PREFIX) ? name.slice(DIRECTION_PREFIX.length) : name;
}

// ------------------------------------------------------------------ чтение каталогов
async function list(dir) {
  const out = [];
  for await (const [name, handle] of dir.entries()) out.push({ name, handle, kind: handle.kind });
  out.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return out;
}

async function subdir(dir, name, create = false) {
  try { return await dir.getDirectoryHandle(name, { create }); } catch (e) { return null; }
}

export async function readText(dir, name) {
  try { const fh = await dir.getFileHandle(name); const f = await fh.getFile(); return await f.text(); } catch (e) { return null; }
}

export async function readFileInfo(dir, name) {
  try { const fh = await dir.getFileHandle(name); const f = await fh.getFile(); return { size: f.size, modified: f.lastModified }; } catch (e) { return null; }
}

/** Записать текст в файл (создаёт подпапку). Требует разрешения на запись. */
export async function writeText(dir, path, text) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  let cur = dir;
  for (const p of parts.slice(0, -1)) cur = await cur.getDirectoryHandle(p, { create: true });
  const fh = await cur.getFileHandle(parts[parts.length - 1], { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}

/** Сводка версии по metrics.json (формат генераторов пакетов по Методичке), иначе — по файлам. */
function summaryFromMetrics(text) {
  try {
    const m = JSON.parse(text);
    const b = m.build || m;
    const parts = [];
    const n = (k) => (typeof b[k] === 'number' ? b[k] : null);
    if (n('concepts_total') != null) parts.push(`${n('concepts_total')} понятий`);
    else if (n('terms_appendix1') != null) parts.push(`${n('terms_appendix1')} терминов`);
    else if (n('terms') != null) parts.push(`${n('terms')} терминов`);
    if (n('provisions') != null) parts.push(`${n('provisions')} положений`);
    const v = m.verify || {};
    if (v.hermit && v.hermit.status) parts.push(/consistent/i.test(v.hermit.status) ? 'HermiT: непротиворечива' : 'HermiT: ' + v.hermit.status);
    return parts.join(' · ');
  } catch (e) { return ''; }
}

/** Описание одной версии (папки пакета). */
export async function describeVersion(name, handle) {
  const entries = await list(handle);
  const files = entries.filter((e) => e.kind === 'file').map((e) => e.name);
  const ttl = files.filter((f) => /\.(ttl|turtle|n3|nt)$/i.test(f));
  const corpusDir = await subdir(handle, 'corpus');
  const corpusCsv = corpusDir ? (await list(corpusDir)).filter((e) => e.kind === 'file' && /\.(csv|tsv)$/i.test(e.name)).map((e) => e.name) : [];
  const workDir = await subdir(handle, WORK_DIR);
  const work = workDir ? (await list(workDir)).filter((e) => e.kind === 'file').map((e) => e.name) : [];
  const metricsJson = files.find((f) => /^metrics\.json$/i.test(f));
  const parsed = parseVersionName(name);
  return {
    name, handle, parsed,
    ttl, profile: files.find((f) => /^profile\.json$/i.test(f)) || null,
    layout: files.find((f) => /map-layout.*\.json$/i.test(f)) || null,
    metricsMd: files.find((f) => /^metrics\.md$/i.test(f)) || null,
    corpusCsv, work,
    reviewFiles: work.filter((f) => /^review-.+\.json$/i.test(f)),
    hasCorpusWork: work.some((f) => /^corpus-work\.json$/i.test(f)),
    summary: metricsJson ? summaryFromMetrics(await readText(handle, metricsJson)) : '',
  };
}

/** Новые сверху: по дате из имени, затем по номеру версии (0.10 новее 0.9), затем по имени. */
export function compareVersionsDesc(a, b) {
  const da = a.parsed ? a.parsed.date : '', db = b.parsed ? b.parsed.date : '';
  if (da !== db) return db.localeCompare(da);
  const va = (a.parsed && a.parsed.version ? a.parsed.version : '').split('.').map(Number);
  const vb = (b.parsed && b.parsed.version ? b.parsed.version : '').split('.').map(Number);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const x = va[i] || 0, y = vb[i] || 0;
    if (x !== y) return y - x;
  }
  return b.name.localeCompare(a.name);
}

const isVersionDir = (v) => v.ttl.length || v.corpusCsv.length;

/**
 * Обойти хранилище: направления → версии (новые сверху).
 * Направление — папка «OntoLensF_*» или любая папка верхнего уровня (кроме «_…» и «.…») с версиями внутри.
 */
export async function scanVault(root) {
  const directions = [];
  for (const e of await list(root)) {
    if (e.kind !== 'directory' || /^[_.]/.test(e.name)) continue;
    const versions = [], other = [];
    for (const v of await list(e.handle)) {
      if (v.kind !== 'directory') continue;
      const d = await describeVersion(v.name, v.handle);
      if (isVersionDir(d)) versions.push(d); else other.push(v.name);
    }
    if (!versions.length && !e.name.startsWith(DIRECTION_PREFIX)) continue;
    versions.sort(compareVersionsDesc);
    directions.push({ name: e.name, label: directionLabel(e.name), handle: e.handle, versions, other });
  }
  directions.sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  return { name: root.name, directions };
}

/** Тексты файлов версии для загрузки в просмотрщик. mode: 'onto' — TTL + профиль; 'corpus' — глоссарии CSV. */
export async function versionFiles(ver, mode) {
  const out = [];
  if (mode === 'corpus') {
    const cd = await subdir(ver.handle, 'corpus');
    for (const n of ver.corpusCsv) { const t = await readText(cd, n); if (t != null) out.push({ name: n, text: t }); }
    return { files: out, profile: null };
  }
  for (const n of ver.ttl) { const t = await readText(ver.handle, n); if (t != null) out.push({ name: n, text: t }); }
  let profile = null;
  if (ver.profile) { try { profile = JSON.parse(await readText(ver.handle, ver.profile)); } catch (e) { profile = null; } }
  let layout = null;
  if (ver.layout) { try { layout = JSON.parse(await readText(ver.handle, ver.layout)); } catch (e) { layout = null; } }
  return { files: out, profile, layout };
}

/** Прочитать все review-*.json из work\ версии. */
export async function readReviewFiles(ver) {
  const wd = await subdir(ver.handle, WORK_DIR);
  if (!wd) return [];
  const out = [];
  for (const n of ver.reviewFiles) { const t = await readText(wd, n); if (t != null) out.push({ name: n, text: t }); }
  return out;
}

export async function workDir(ver, create) { return subdir(ver.handle, WORK_DIR, create); }

// ------------------------------------------------------------------ работа редактора над корпусом
/**
 * Хранилище работы редактора (классы, свойства, аксиомы, формализации) в файле work\corpus-work.json версии.
 * Читает файл, если он есть, иначе — локальную копию браузера; пишет в оба места.
 */
export function makeFileWorkStore(ver, local, onError) {
  let cache = null;
  const empty = () => ({ classes: [], props: [], axioms: [], formal: {} });
  return {
    kind: 'vault',
    async load() {
      const wd = await subdir(ver.handle, WORK_DIR);
      const t = wd ? await readText(wd, 'corpus-work.json') : null;
      if (t) { try { const j = JSON.parse(t); cache = { ...empty(), ...(j.work || j) }; } catch (e) { cache = null; } }
      if (!cache) cache = await local.load();
      return JSON.parse(JSON.stringify(cache));
    },
    async save(type, id, data) {
      await local.save(type, id, data);
      if (!cache) cache = empty();
      if (type === 'formal') cache.formal[id] = data;
      else {
        const lst = cache[type === 'class' ? 'classes' : type === 'prop' ? 'props' : 'axioms'];
        const i = lst.findIndex((x) => x.id === id);
        if (i >= 0) lst[i] = data; else lst.push(data);
      }
      try {
        await writeText(ver.handle, `${WORK_DIR}/corpus-work.json`,
          JSON.stringify({ format: 'ontolens-corpus-work/1', saved: new Date().toISOString(), version: ver.name, work: cache }, null, 1));
      } catch (e) { if (onError) onError(e); }
      return { ok: true };
    },
  };
}

// ------------------------------------------------------------------ IndexedDB: запомнить папку
const DB = 'ontolens-vault', STORE = 'kv';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function kvGet(key) {
  try {
    const db = await idb();
    return await new Promise((res) => { const q = db.transaction(STORE).objectStore(STORE).get(key); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); });
  } catch (e) { return undefined; }
}
export async function kvSet(key, val) {
  try {
    const db = await idb();
    await new Promise((res) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(val, key); t.oncomplete = () => res(); t.onerror = () => res(); });
    return true;
  } catch (e) { return false; }
}

/** Состояние разрешения на запись: 'granted' | 'prompt' | 'denied'. */
export async function permission(handle, request) {
  if (!handle || typeof handle.queryPermission !== 'function') return 'granted';
  const opts = { mode: 'readwrite' };
  let p = await handle.queryPermission(opts);
  if (p !== 'granted' && request) p = await handle.requestPermission(opts);
  return p;
}

// ------------------------------------------------------------------ только чтение: дерево из <input webkitdirectory>
/** Псевдо-дескриптор каталога из списка File с webkitRelativePath — тот же интерфейс, без записи. */
export function treeFromFileList(fileList) {
  const mk = (name) => ({ kind: 'directory', name, dirs: new Map(), files: new Map() });
  let root = null;
  for (const f of [...fileList]) {
    const parts = (f.webkitRelativePath || f.name).split('/');
    if (!root) root = mk(parts.length > 1 ? parts[0] : 'хранилище');
    let cur = root;
    for (const p of parts.slice(parts.length > 1 ? 1 : 0, -1)) {
      if (!cur.dirs.has(p)) cur.dirs.set(p, mk(p));
      cur = cur.dirs.get(p);
    }
    cur.files.set(parts[parts.length - 1], f);
  }
  const wrap = (node) => ({
    kind: 'directory', name: node.name, readOnly: true,
    async *entries() {
      for (const [n, d] of node.dirs) yield [n, wrap(d)];
      for (const [n, f] of node.files) yield [n, { kind: 'file', name: n, getFile: async () => f }];
    },
    async getDirectoryHandle(n) { if (!node.dirs.has(n)) throw new Error('NotFound'); return wrap(node.dirs.get(n)); },
    async getFileHandle(n) { if (!node.files.has(n)) throw new Error('NotFound'); const f = node.files.get(n); return { kind: 'file', name: n, getFile: async () => f }; },
  });
  return root ? wrap(root) : null;
}
