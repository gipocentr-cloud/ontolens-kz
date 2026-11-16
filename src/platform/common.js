/**
 * Общие части платформы (ТЗ OntoLens v2.2): ключи документов, поля оценки,
 * нарезка файлов на части для Firestore.
 */

/** Поля оценки, которые хранятся на сервере (контракт CSV + служебные). */
export const REVIEW_FIELDS = [
  'id', 'verdict', 'def_ru_fixed', 'label_kk_fixed', 'parent_proposed', 'comment', 'ts',
  'label_ru', 'label_ru_fixed', 'label_en_fixed', 'duplicate_of',
  // оценка коллизии (ТЗ v3.1, раздел 6)
  'basis_doc', 'proposed_wording', 'fix_clause', 'disputed_step', 'conflict_kind',
];

/** 64-битный FNV-1a в hex — короткий ключ IRI для идентификатора документа. */
export function iriKey(iri) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  const s = String(iri);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
    h2 ^= h2 >>> 15;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export function normEmail(e) { return String(e || '').trim().toLowerCase(); }

export function reviewId(version, email, iri) { return `${version}__${normEmail(email)}__${iriKey(iri)}`; }

/** Очистить запись оценки перед отправкой: только известные поля, строки, ограничение длины. */
export function cleanReview(rec) {
  const out = {};
  for (const f of REVIEW_FIELDS) {
    const v = rec[f];
    out[f] = v == null ? '' : String(v).slice(0, 10000);
  }
  return out;
}

/** Части файла: не больше CHUNK символов (кириллица в UTF-8 — до 2 байт, предел документа 1 МиБ). */
export const CHUNK = 300000;
export function splitText(text) {
  const parts = [];
  for (let i = 0; i < text.length; i += CHUNK) parts.push(text.slice(i, i + CHUNK));
  return parts.length ? parts : [''];
}

/** Код онтологии из названия: латиница, цифры, дефис. */
export function slugCode(s) {
  const tr = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
    н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ы: 'y',
    э: 'e', ю: 'yu', я: 'ya', ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i' };
  return String(s || '').toLowerCase().split('').map((c) => (tr[c] != null ? tr[c] : c)).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'ontology';
}

export const ROLES = ['admin', 'member'];   // роль в онтологии (редактор / эксперт) задаётся назначением
export const VISIBILITY = ['after_own', 'open', 'blind'];
