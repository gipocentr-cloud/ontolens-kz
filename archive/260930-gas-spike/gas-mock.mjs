/**
 * Эмуляция служб Google Apps Script для проверки gas/Code.gs в Node.
 * Модель минимальная: ровно то, что вызывает Code.gs.
 */
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

let seq = 0;
const nid = (p) => `${p}_${++seq}`;

function iter(arr) { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; }

class MFile {
  constructor(name, text, parent) { this.id = nid('file'); this.name = name; this.text = text; this.parent = parent; this.updated = new Date(); }
  getName() { return this.name; }
  getId() { return this.id; }
  getLastUpdated() { return this.updated; }
  getBlob() { const t = this.text; return { getDataAsString: () => t }; }
  moveTo(folder) { this.parent.files = this.parent.files.filter((f) => f !== this); folder.files.push(this); this.parent = folder; return this; }
}

class MFolder {
  constructor(name, id) { this.id = id || nid('folder'); this.name = name; this.folders = []; this.files = []; }
  getName() { return this.name; }
  getId() { return this.id; }
  getFoldersByName(n) { return iter(this.folders.filter((f) => f.name === n)); }
  getFolders() { return iter(this.folders.slice()); }
  getFiles() { return iter(this.files.slice()); }
  getFilesByName(n) { return iter(this.files.filter((f) => f.name === n)); }
  createFolder(n) { const f = new MFolder(n); this.folders.push(f); return f; }
  addFile(name, text) { const f = new MFile(name, text, this); this.files.push(f); return f; }
}

class MRange {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet.data[this.r - 1 + i] || [];
      const o = [];
      for (let j = 0; j < this.nc; j++) { const v = row[this.c - 1 + j]; o.push(v === undefined ? '' : v); }
      out.push(o);
    }
    return out;
  }
  setValues(vals) {
    if (vals.length !== this.nr || vals.some((r) => r.length !== this.nc)) throw new Error('setValues: размеры не совпадают');
    vals.forEach((row, i) => {
      const t = this.sheet.data[this.r - 1 + i] || (this.sheet.data[this.r - 1 + i] = []);
      row.forEach((v, j) => {
        // как в Таблицах: строка, начинающаяся с апострофа, хранится без него и как текст;
        // строка на «=» без апострофа стала бы формулой — отмечаем это
        if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1);
        else if (typeof v === 'string' && v.startsWith('=')) { this.sheet.formulas.push(v); v = '#FORMULA'; }
        t[this.c - 1 + j] = v;
      });
    });
    for (let i = 0; i < this.sheet.data.length; i++) if (!this.sheet.data[i]) this.sheet.data[i] = [];
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
}

class MSheet {
  constructor(name) { this.name = name; this.data = []; this.formulas = []; }
  getName() { return this.name; }
  getLastRow() { let n = this.data.length; while (n && !(this.data[n - 1] || []).some((v) => v !== '' && v != null)) n--; return n; }
  getLastColumn() { return Math.max(0, ...this.data.map((r) => (r || []).length)); }
  getMaxRows() { return Math.max(1000, this.data.length); }
  getRange(r, c, nr = 1, nc = 1) { return new MRange(this, r, c, nr, nc); }
  getDataRange() { return new MRange(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  appendRow(row) { const r = this.getLastRow() + 1; this.getRange(r, 1, 1, row.length).setValues([row]); return this; }
  setFrozenRows() { return this; }
  rows() { return this.data.slice(0, this.getLastRow()); }
}

class MSpreadsheet {
  constructor(name) { this.id = nid('ss'); this.name = name; this.sheets = [new MSheet('Лист1')]; }
  getId() { return this.id; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) { const s = new MSheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets.slice(); }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
}

export function makeGas({ rootId, activeUser = '', owner = 'owner@example.com', execUrl = 'https://script.google.com/macros/s/TEST/exec' }) {
  const root = new MFolder('web-OntoLens', rootId);
  const sheetsById = new Map();
  const filesById = new Map();
  const props = new Map();
  const cache = new Map();
  const env = { activeUser, owner, execUrl, logs: [] };

  const DriveApp = {
    getFolderById: (id) => { if (id !== rootId) throw new Error('no folder ' + id); return root; },
    getFileById: (id) => {
      if (filesById.has(id)) return filesById.get(id);
      throw new Error('no file ' + id);
    },
  };
  const SpreadsheetApp = {
    create: (name) => {
      const ss = new MSpreadsheet(name);
      sheetsById.set(ss.id, ss);
      const f = root.addFile(name, '');     // для moveTo: сначала «в корне Диска»
      root.files.pop();
      const drive = new MFolder('Мой диск');
      drive.files.push(f); f.parent = drive; f.id = ss.id;
      filesById.set(ss.id, f);
      return ss;
    },
    openById: (id) => { if (!sheetsById.has(id)) throw new Error('no ss'); return sheetsById.get(id); },
  };
  const ctx = {
    DriveApp,
    SpreadsheetApp,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    CacheService: { getScriptCache: () => ({
      get: (k) => cache.get(k) ?? null,
      getAll: (ks) => Object.fromEntries(ks.filter((k) => cache.has(k)).map((k) => [k, cache.get(k)])),
      putAll: (o) => { for (const [k, v] of Object.entries(o)) { if (Buffer.byteLength(v) > 100 * 1024) throw new Error('cache value > 100KB'); cache.set(k, v); } },
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => randomUUID(),
      DigestAlgorithm: { MD5: 'md5' },
      computeDigest: (alg, s) => [...createHash(alg).update(s).digest()],
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString('base64url'),
    },
    Session: {
      getActiveUser: () => ({ getEmail: () => env.activeUser }),
      getEffectiveUser: () => ({ getEmail: () => env.owner }),
    },
    ScriptApp: { getService: () => ({ getUrl: () => env.execUrl }) },
    Logger: { log: (m) => env.logs.push(m) },
    HtmlService: { createHtmlOutput: (html) => {
      const o = { html, title: '', setTitle(t) { o.title = t; return o; }, addMetaTag() { return o; }, getContent: () => o.html };
      return o;
    } },
    console,
  };
  vm.createContext(ctx);
  const code = readFileSync(new URL('../gas/Code.gs', import.meta.url), 'utf8');
  vm.runInContext(code + '\n;globalThis.__api = { setup, issueTokens, doGet, apiOntology, apiMyReviews, apiAllReviews, apiSaveReview };', ctx);
  return { api: ctx.__api, root, env, sheets: () => [...sheetsById.values()][0], MFolder };
}
