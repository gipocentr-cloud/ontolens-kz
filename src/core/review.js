/**
 * Раздел 5.4 ТЗ — сбор замечаний эксперта.
 *
 * Контракт данных заморожен в «Регламенте работы ТЗ v2.2 и OntoLens», раздел 7:
 * поля панели = столбцы review-*.csv = столбцы мастер-таблицы. Любое изменение
 * набора столбцов здесь ломает review2master.py — менять только вместе.
 */

export const VERDICTS = [
  { code: 'ok', ru: 'Верно', kk: 'Дұрыс', en: 'Correct', color: '#3F7A4E', shape: 'circle' },
  { code: 'fix', ru: 'Исправить', kk: 'Түзету', en: 'Fix', color: '#B9762C', shape: 'square' },
  { code: 'delete', ru: 'Удалить', kk: 'Жою', en: 'Delete', color: '#A33A32', shape: 'cross' },
  { code: 'not_my_domain', ru: 'Не мой домен', kk: 'Менің салам емес', en: 'Not my domain', color: '#6B7280', shape: 'dash' },
  { code: 'duplicate', ru: 'Дубль термина', kk: 'Термин қосарламасы', en: 'Duplicate', color: '#7C5AA6', shape: 'diamond' },
  // ТЗ v2.2, 6.3: честный выход «не могу оценить» — только с комментарием, в сводке не считается вердиктом
  { code: 'unclear', ru: 'Не могу оценить', kk: 'Бағалай алмаймын', en: 'Cannot assess', color: '#2F6F7E', shape: 'ring' },
];
export const VERDICT_BY_CODE = Object.fromEntries(VERDICTS.map((v) => [v.code, v]));
const VERDICT_BY_RU = Object.fromEntries(VERDICTS.map((v) => [v.ru.toLowerCase(), v.code]));

/** Столбцы review-*.csv. Первые семь — контракт регламента, остальные — дополнение ТЗ 5.4. */
export const CSV_COLUMNS = [
  'id', 'verdict', 'def_ru_fixed', 'label_kk_fixed', 'parent_proposed', 'comment', 'ts',
  'iri', 'label_ru', 'label_ru_fixed', 'label_en_fixed', 'duplicate_of', 'expert',
];

/**
 * Слова-подтверждения, которые нельзя писать в поля исправления:
 * именно так в первом круге испортили казахский слой («дұрыс» вместо метки).
 */
const CONFIRM_WORDS = new Set([
  'дұрыс', 'дурыс', 'дұрыс.', 'верно', 'верно.', 'правильно', 'ок', 'ok', 'okay', 'да', 'иә', 'ия',
  'correct', 'yes', 'true', '+', '✓', '✔', 'v', 'согласен', 'согласна', 'келісемін', 'норм', 'нормально',
]);

export function isConfirmationWord(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[!.]+$/, '');
  return t.length > 0 && CONFIRM_WORDS.has(t);
}

export const FIX_FIELDS = ['def_ru_fixed', 'label_ru_fixed', 'label_kk_fixed', 'label_en_fixed'];

/**
 * Проверить запись перед сохранением.
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validateRecord(rec, current) {
  const errors = [];
  const warnings = [];
  for (const f of FIX_FIELDS) {
    if (isConfirmationWord(rec[f])) {
      errors.push(`Поле «${fieldTitle(f)}» содержит «${rec[f].trim()}». Для подтверждения выберите оценку «Верно», а поле исправления оставьте пустым.`);
    }
    if (rec[f] && current && current[f] && rec[f].trim() === current[f].trim()) {
      warnings.push(`Поле «${fieldTitle(f)}» совпадает с текущим значением — сохранится как пустое.`);
    }
  }
  if (!rec.verdict) errors.push('Выберите оценку.');
  if (rec.verdict === 'unclear' && !String(rec.comment || '').trim()) errors.push('Для «Не могу оценить» напишите в комментарии, чего не хватает: источника, контекста, определения.');
  if (rec.verdict === 'duplicate' && !rec.duplicate_of) errors.push('Для оценки «Дубль» укажите, дублем какого термина является этот.');
  if (rec.verdict === 'fix' && !FIX_FIELDS.some((f) => rec[f]) && !rec.parent_proposed && !rec.comment) {
    warnings.push('Оценка «Исправить» без исправления и без комментария: автору будет непонятно, что править.');
  }
  return { errors, warnings };
}

export function fieldTitle(f) {
  return ({
    def_ru_fixed: 'исправленное определение (ru)',
    label_ru_fixed: 'исправленная метка (ru)',
    label_kk_fixed: 'исправленная метка (kk)',
    label_en_fixed: 'исправленная метка (en)',
    parent_proposed: 'предлагаемый родитель',
    comment: 'комментарий',
  })[f] || f;
}

/** Очистить запись: пустые строки, значения, совпадающие с текущими. */
export function normaliseRecord(rec, current) {
  const out = { ...rec };
  for (const k of Object.keys(out)) if (typeof out[k] === 'string') out[k] = out[k].trim();
  for (const f of FIX_FIELDS) {
    if (current && current[f] && out[f] === current[f].trim()) out[f] = '';
  }
  if (out.verdict !== 'duplicate') out.duplicate_of = '';
  return out;
}

// --------------------------------------------------------------------------
//  Хранилище в браузере (localStorage). Может быть недоступно — тогда
//  работаем в памяти и честно предупреждаем эксперта.
// --------------------------------------------------------------------------
export function storageKey(hash) { return 'ontolens.review.v1.' + hash; }

export function storageAvailable() {
  try {
    const k = '__ontolens_probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return true;
  } catch (e) { return false; }
}

export function loadReview(hash) {
  try {
    const raw = window.localStorage.getItem(storageKey(hash));
    if (raw) {
      const d = JSON.parse(raw);
      if (d && typeof d === 'object' && d.items) return d;
    }
  } catch (e) { /* ignore */ }
  return { expert: '', items: {}, updated: null };
}

export function saveReview(hash, data) {
  try {
    window.localStorage.setItem(storageKey(hash), JSON.stringify(data));
    return true;
  } catch (e) { return false; }
}

/**
 * Оценки, сохранённые для других версий онтологии (другой хэш файлов).
 * Нужны, когда пакет пересобран между кругами экспертизы: оценки не должны
 * «пропасть» только потому, что изменился файл.
 * @returns [{hash, expert, updated, count, mainNs, data}]
 */
export function findOtherReviews(currentHash) {
  const out = [];
  try {
    const ls = window.localStorage;
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k || !k.startsWith('ontolens.review.v1.') || k === storageKey(currentHash)) continue;
      try {
        const d = JSON.parse(ls.getItem(k));
        const n = d && d.items ? Object.values(d.items).filter((r) => r && r.verdict).length : 0;
        if (n) out.push({ hash: k.slice('ontolens.review.v1.'.length), expert: d.expert || '', updated: d.updated || '', count: n, mainNs: d.mainNs || '', data: d });
      } catch (e) { /* повреждённая запись — пропустить */ }
    }
  } catch (e) { /* нет хранилища */ }
  out.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  return out;
}

/**
 * Перенести оценки на текущую версию: по IRI, а если термин переименован —
 * по dcterms:identifier (номер строки листа 3), сохранённому в записи.
 */
export function carryOver(source, model) {
  const byId = new Map();
  for (const e of model.classes) for (const id of e.identifiers) byId.set(String(id), e.iri);
  const items = {};
  let byIri = 0, byIdent = 0;
  const lost = [];
  for (const [iri, rec] of Object.entries(source.data.items || {})) {
    if (!rec || !rec.verdict) continue;
    let target = null;
    if (model.entities.has(iri) && model.entities.get(iri).types.size) { target = iri; byIri++; }
    else if (rec.id && byId.has(String(rec.id))) { target = byId.get(String(rec.id)); byIdent++; }
    if (target) items[target] = { ...rec, carriedFrom: source.hash };
    else lost.push(rec.label_ru || iri);
  }
  return { items, byIri, byIdent, lost };
}

export function loadPref(key, fallback) {
  try { const v = window.localStorage.getItem('ontolens.pref.' + key); return v == null ? fallback : JSON.parse(v); }
  catch (e) { return fallback; }
}
export function savePref(key, value) {
  try { window.localStorage.setItem('ontolens.pref.' + key, JSON.stringify(value)); } catch (e) { /* ignore */ }
}

// --------------------------------------------------------------------------
//  Экспорт
// --------------------------------------------------------------------------
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * @param rows  [{iri, id, label_ru, ...record}]
 */
export function reviewToCsv(rows, expert) {
  const lines = [CSV_COLUMNS.join(';')];
  for (const r of rows) {
    const rec = { ...r, expert: expert || r.expert || '', verdict: r.verdict ? VERDICT_BY_CODE[r.verdict].ru : '' };
    lines.push(CSV_COLUMNS.map((c) => csvCell(rec[c])).join(';'));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function reviewToJson(rows, expert, meta) {
  return JSON.stringify({
    format: 'ontolens-review/1',
    expert,
    exported: new Date().toISOString(),
    ...meta,
    columns: CSV_COLUMNS,
    items: rows.map((r) => ({ ...r, verdict_label: r.verdict ? VERDICT_BY_CODE[r.verdict].ru : '' })),
  }, null, 2);
}

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ә: 'a', ғ: 'g', қ: 'q', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i',
};

/** Имя эксперта для имени файла: латиница, без пробелов (кириллица в имени загрузки ломается в части браузеров). */
export function slug(s) {
  const t = String(s || 'expert').trim().toLowerCase().replace(/./gu, (c) => (c in TRANSLIT ? TRANSLIT[c] : c));
  return t.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'expert';
}

// --------------------------------------------------------------------------
//  Импорт файлов замечаний (роль автора)
// --------------------------------------------------------------------------
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], cell = '', q = false;
  const delim = (text.split(/\r?\n/)[0].match(/;/g) || []).length >= (text.split(/\r?\n/)[0].match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ''));
}

function verdictCode(v) {
  if (!v) return '';
  if (VERDICT_BY_CODE[v]) return v;
  return VERDICT_BY_RU[String(v).trim().toLowerCase()] || '';
}

/**
 * Разобрать файл замечаний (CSV или JSON).
 * @returns {{expert: string, items: Object<string, object>, file: string}}
 */
export function parseReviewFile(name, text) {
  const items = {};
  let expert = '';
  if (/\.json$/i.test(name) || /^\s*\{/.test(text)) {
    const d = JSON.parse(text);
    expert = d.expert || '';
    for (const it of d.items || []) {
      const code = verdictCode(it.verdict);
      if (!it.iri) continue;
      items[it.iri] = { ...it, verdict: code };
    }
  } else {
    const rows = parseCsv(text);
    const head = rows.shift().map((h) => h.trim());
    for (const r of rows) {
      const o = {};
      head.forEach((h, i) => { o[h] = (r[i] || '').trim(); });
      if (!o.iri) continue;
      o.verdict = verdictCode(o.verdict);
      items[o.iri] = o;
      if (!expert && o.expert) expert = o.expert;
    }
  }
  if (!expert) {
    const m = /^review-(.+?)-\d{6}/i.exec(name);
    expert = m ? m[1] : name.replace(/\.[^.]+$/, '');
  }
  return { expert, items, file: name };
}

/**
 * Сводка по нескольким экспертам: по каждому термину — оценки и согласие.
 * Заготовка под расчёт κ (ТЗ 5.4): считается простое согласие и κ Флейса
 * по терминам, которые оценили все эксперты.
 */
export function summarise(termIris, experts) {
  const rows = [];
  for (const iri of termIris) {
    const votes = experts.map((x) => (x.items[iri] && x.items[iri].verdict) || '');
    // «не могу оценить» показывается в таблице, но в согласие и κ не входит
    const given = votes.filter((v) => v && v !== 'unclear');
    const agree = given.length > 1 ? given.every((v) => v === given[0]) : null;
    const hasRemarks = experts.some((x) => {
      const it = x.items[iri];
      return it && (it.verdict && it.verdict !== 'ok' || it.comment || FIX_FIELDS.some((f) => it[f]) || it.parent_proposed);
    });
    rows.push({ iri, votes, reviewedBy: given.length, agree, hasRemarks });
  }
  // κ Флейса по терминам, оценённым всеми
  const n = experts.length;
  let kappa = null;
  const full = rows.filter((r) => r.reviewedBy === n && n > 1);
  if (full.length) {
    const cats = VERDICTS.map((v) => v.code).filter((c) => c !== 'unclear');
    const pj = Object.fromEntries(cats.map((c) => [c, 0]));
    let Pbar = 0;
    for (const r of full) {
      const cnt = Object.fromEntries(cats.map((c) => [c, 0]));
      for (const v of r.votes) if (v in cnt) cnt[v]++;
      for (const c of cats) pj[c] += cnt[c];
      Pbar += (cats.reduce((a, c) => a + cnt[c] * cnt[c], 0) - n) / (n * (n - 1));
    }
    Pbar /= full.length;
    const Pe = cats.reduce((a, c) => a + Math.pow(pj[c] / (full.length * n), 2), 0);
    kappa = Pe === 1 ? 1 : (Pbar - Pe) / (1 - Pe);
  }
  const both = rows.filter((r) => r.agree !== null);
  return {
    rows,
    kappa,
    kappaN: full.length,
    agreementShare: both.length ? both.filter((r) => r.agree).length / both.length : null,
    comparable: both.length,
  };
}
