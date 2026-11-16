/**
 * Корпус определений (ТЗ v3.1, разделы 3 и 5): импорт таблицы-глоссария,
 * ранги документов, выравнивание определений с понятиями, генерация Turtle
 * для просмотрщика.
 *
 * Таблица терминов: doc_code, clause, term_ru, def_ru, term_kk, def_kk, term_en, def_en, note, concept
 * Таблица документов: doc_code, title, kind, status, year, replaces, rank, force
 */
import { termKey, foldText, termMentions } from './normalize.js';

// ---------------------------------------------------------------- ранги (ТЗ 3.4)
export const DEFAULT_RANKS = [
  { rank: 1, kind: 'кодекс', title: 'Конституция, кодексы', re: /кодекс|конституц/i },
  { rank: 2, kind: 'закон', title: 'Законы', re: /^закон|\bзакон\b/i },
  { rank: 3, kind: 'постановление', title: 'Указы, постановления Правительства', re: /постановлен|указ\b/i },
  { rank: 4, kind: 'приказ', title: 'НПА уполномоченного органа (приказы, правила)', re: /приказ|правила\b/i },
  { rank: 5, kind: 'обязательный НТД', title: 'Обязательные НТД (ТКН, СН РК, техрегламенты)', re: /^ткн|^сн\s*рк|^тр\b|техрегл|технический регламент/i },
  { rank: 7, kind: 'СТ РК ISO', title: 'Международные стандарты, принятые как СТ РК', re: /ст\s*рк\s*(iso|en|iec)/i },
  { rank: 6, kind: 'добровольный НТД', title: 'Документы добровольного применения (СП, СТ РК, ГОСТ)', re: /^сп\s*рк|^ст\s*рк|^гост/i },
  { rank: 8, kind: 'иное', title: 'Иные источники (ISO, ISO/DIS, словари, публикации)', re: /./ },
];
export function defaultRank(codeOrKind) {
  const s = String(codeOrKind || '');
  for (const r of DEFAULT_RANKS) if (r.re.test(s)) return r;
  return DEFAULT_RANKS[DEFAULT_RANKS.length - 1];
}
export const STATUSES = { active: 'действует', project: 'проект', replaced: 'заменён', cancelled: 'отменён', unverified: 'не подтверждён' };
export function normStatus(s) {
  const t = foldText(s);
  if (/отмен|cancel|withdraw|утрат/.test(t)) return 'cancelled';
  if (/замен|replac|supersed/.test(t)) return 'replaced';
  if (/проект|draft|dis\b/.test(t)) return 'project';
  if (/действ|active|force|введ/.test(t)) return 'active';
  return 'unverified';
}

// ---------------------------------------------------------------- CSV
export function parseCSV(text) {
  text = String(text || '').replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';'
    : ((firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',');
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((x) => String(x).trim()));
  if (!nonEmpty.length) return [];
  const head = nonEmpty[0].map((h) => foldText(h).replace(/\s+/g, '_'));
  return nonEmpty.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, String(r[i] == null ? '' : r[i]).trim()])));
}

// синонимы заголовков столбцов (рус/англ)
const ALIASES = {
  doc_code: ['doc_code', 'doc', 'документ', 'код_документа', 'обозначение', 'source'],
  clause: ['clause', 'пункт', 'п', 'раздел'],
  term_ru: ['term_ru', 'термин', 'термин_ru', 'label_ru', 'term'],
  def_ru: ['def_ru', 'определение', 'определение_ru', 'definition'],
  term_kk: ['term_kk', 'термин_kk', 'label_kk', 'термин_каз'],
  def_kk: ['def_kk', 'определение_kk'],
  term_en: ['term_en', 'термин_en', 'label_en'],
  def_en: ['def_en', 'определение_en'],
  note: ['note', 'примечание', 'notes'],
  concept: ['concept', 'понятие', 'concept_id'],
  title: ['title', 'название', 'наименование'],
  kind: ['kind', 'вид', 'тип'],
  status: ['status', 'статус'],
  year: ['year', 'год'],
  replaces: ['replaces', 'заменяет'],
  rank: ['rank', 'ранг', 'legal_rank'],
  force: ['force', 'сила', 'обязательность'],
};
function pick(row, key) {
  for (const k of ALIASES[key] || [key]) if (row[k] != null && row[k] !== '') return row[k];
  return '';
}

// ---------------------------------------------------------------- идентификаторы
const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ы: 'y',
  э: 'e', ю: 'yu', я: 'ya', ъ: '', ь: '' };
export function idPart(s, max = 48) {
  return foldText(s).split('').map((c) => (TR[c] != null ? TR[c] : c)).join('')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, max) || 'x';
}

/**
 * Собрать корпус из таблиц.
 * @returns {{documents, concepts, definitions, warnings, stats}}
 */
export function corpusFromTables(termRows, docRows, opts = {}) {
  const warnings = [];
  const documents = new Map();
  for (const r of docRows || []) {
    const code = pick(r, 'doc_code');
    if (!code) continue;
    const dr = defaultRank(pick(r, 'kind') || code);
    const rank = Number(pick(r, 'rank')) || dr.rank;
    documents.set(code, {
      id: 'D_' + idPart(code, 40), code, title: pick(r, 'title') || code, kind: pick(r, 'kind') || dr.kind,
      status: normStatus(pick(r, 'status')), year: Number(pick(r, 'year')) || null,
      replaces: pick(r, 'replaces') || '', rank, rankFromDefault: !Number(pick(r, 'rank')),
      force: pick(r, 'force') || (rank <= 5 ? 'обязательный' : 'добровольный'),
    });
  }
  const concepts = new Map();
  const definitions = [];
  let n = 0;
  for (const r of termRows || []) {
    n++;
    const code = pick(r, 'doc_code');
    const label = pick(r, 'term_ru');
    const text = pick(r, 'def_ru');
    if (!label || !code) { warnings.push(`строка ${n + 1}: нет ${!label ? 'термина' : 'документа'} — пропущена`); continue; }
    if (!documents.has(code)) {
      const dr = defaultRank(code);
      documents.set(code, { id: 'D_' + idPart(code, 40), code, title: code, kind: dr.kind, status: 'unverified',
        year: null, replaces: '', rank: dr.rank, rankFromDefault: true, force: dr.rank <= 5 ? 'обязательный' : 'добровольный' });
      warnings.push(`документ «${code}» нет в листе документов — ранг ${dr.rank} по виду, статус «не подтверждён» [VERIFY]`);
    }
    const doc = documents.get(code);
    const explicit = pick(r, 'concept');
    const key = explicit ? 'explicit:' + idPart(explicit) : termKey(label);
    if (!concepts.has(key)) {
      concepts.set(key, { id: 'C_' + (explicit ? idPart(explicit) : idPart(label)), key, label_ru: label, labels: new Set([label]) });
    } else concepts.get(key).labels.add(label);
    const clause = pick(r, 'clause');
    const id = `${doc.id}__${idPart(clause || String(n), 16)}__${idPart(label, 32)}`;
    if (!text) warnings.push(`«${label}» в ${code}: нет определения`);
    definitions.push({
      id, concept: concepts.get(key).id, doc: doc.id, docCode: code, clause,
      label: { ru: label, kk: pick(r, 'term_kk'), en: pick(r, 'term_en') },
      text: { ru: text, kk: pick(r, 'def_kk'), en: pick(r, 'def_en') },
      note: pick(r, 'note'), alignment: explicit ? 'confirmed' : 'auto', row: n + 1,
    });
  }
  // уникальность id понятий
  const seen = new Map();
  for (const c of concepts.values()) {
    let id = c.id, i = 2;
    while (seen.has(id) && seen.get(id) !== c.key) id = c.id + '_' + (i++);
    seen.set(id, c.key);
    if (id !== c.id) { for (const d of definitions) if (d.concept === c.id && termKey(d.label.ru) === c.key) d.concept = id; c.id = id; }
  }
  const docs = [...documents.values()];
  // связи «заменяет»
  for (const d of docs) {
    if (!d.replaces) continue;
    const old = docs.find((x) => x.code === d.replaces);
    if (old) { old.replacedBy = d.id; d.replacesId = old.id; if (old.status === 'active' || old.status === 'unverified') old.status = 'replaced'; }
    else warnings.push(`«${d.code}» заменяет «${d.replaces}», которого нет в листе документов`);
  }
  const cs = [...concepts.values()].map((c) => ({ id: c.id, key: c.key, label_ru: c.label_ru, labels: [...c.labels] }));
  return {
    name: opts.name || 'corpus', documents: docs, concepts: cs, definitions, warnings,
    stats: { rows: n, documents: docs.length, definitions: definitions.length, concepts: cs.length,
      multi: cs.filter((c) => definitions.filter((d) => d.concept === c.id).length > 1).length },
  };
}

/** Корпус из файлов: глоссарий (CSV) и лист документов (CSV), по именам. */
export function corpusFromFiles(files, opts = {}) {
  const terms = [], docs = [];
  for (const f of files) {
    const rows = parseCSV(f.text);
    if (!rows.length) continue;
    const cols = Object.keys(rows[0]);
    const isDocs = /doc|документ/i.test(f.name) && !cols.some((c) => ALIASES.def_ru.includes(c))
      || (!cols.some((c) => ALIASES.term_ru.includes(c)) && cols.some((c) => ALIASES.title.includes(c) || ALIASES.rank.includes(c)));
    (isDocs ? docs : terms).push(...rows);
  }
  return corpusFromTables(terms, docs, opts);
}

export function isGlossaryFile(name) { return /\.(csv|tsv)$/i.test(name) || /glossary|глоссари/i.test(name); }

// ---------------------------------------------------------------- Turtle для просмотрщика
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n');
const lit = (s, lang) => `"${esc(s)}"${lang ? '@' + lang : ''}`;

/**
 * TBox корпуса: понятие = owl:Class + skos:Concept; основное определение — из документа высшего ранга;
 * коллекции — по документам; подтверждённый род формализации — rdfs:subClassOf.
 */
export function corpusToTurtle(corpus, formal = {}, extraClasses = []) {
  const NS = `http://ontogeo.kz/corpus/${idPart(corpus.name, 40)}#`;
  const docById = new Map(corpus.documents.map((d) => [d.id, d]));
  const L = [];
  L.push(`@prefix : <${NS}> .`, '@prefix owl: <http://www.w3.org/2002/07/owl#> .', '@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .',
    '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .', '@prefix skos: <http://www.w3.org/2004/02/skos/core#> .',
    '@prefix dcterms: <http://purl.org/dc/terms/> .', '@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .', '');
  L.push(`<${NS.slice(0, -1)}> a owl:Ontology ; dcterms:title ${lit('Корпус определений: ' + corpus.name, 'ru')} .`, '');
  L.push(':CorpusEntity a owl:Class ; skos:prefLabel "классы корпуса"@ru , "corpus classes"@en ; skos:definition "Корень: структурные классы и понятия корпуса определений."@ru .');
  L.push(':Unformalized a owl:Class ; rdfs:subClassOf :CorpusEntity ; skos:prefLabel "род не установлен"@ru , "genus not established"@en ; skos:definition "Понятия, ни одно определение которых ещё не формализовано (род не подтверждён)."@ru .');
  L.push(':usesTerm a owl:ObjectProperty ; rdfs:domain :CorpusEntity ; rdfs:range :CorpusEntity ; skos:prefLabel "использует в определении"@ru , "uses in definition"@en ; skos:definition "Термин упомянут в тексте определения понятия."@ru .', '');
  for (const c of extraClasses) {
    L.push(`:${c.id} a owl:Class ; rdfs:subClassOf ${c.parent ? ':' + c.parent : ':CorpusEntity'} ; skos:prefLabel ${lit(c.label, 'ru')} ; skos:editorialNote "structural class, not a term"@en .`);
  }
  const uses = new Map();
  for (const m of termMentions(corpus)) (uses.get(m.from) || uses.set(m.from, new Set()).get(m.from)).add(m.to);
  const known = new Set([...corpus.concepts.map((c) => c.id), ...extraClasses.map((c) => c.id)]);
  const byConcept = new Map();
  for (const d of corpus.definitions) (byConcept.get(d.concept) || byConcept.set(d.concept, []).get(d.concept)).push(d);
  for (const c of corpus.concepts) {
    const defs = (byConcept.get(c.id) || []).slice().sort((a, b) => (docById.get(a.doc).rank - docById.get(b.doc).rank));
    const main = defs[0];
    const parents = new Set();
    for (const d of defs) { const f = formal[d.id]; if (f && f.status === 'confirmed' && f.genus && f.genus !== c.id && known.has(f.genus)) parents.add(f.genus); }
    const p = [];
    p.push(`:${c.id} a owl:Class , skos:Concept`);
    p.push(`  rdfs:subClassOf ${parents.size ? [...parents].map((x) => ':' + x).join(' , ') : ':Unformalized'}`);
    if (uses.get(c.id)) p.push(`  :usesTerm ${[...uses.get(c.id)].map((x) => ':' + x).join(' , ')}`);
    p.push(`  skos:prefLabel ${lit(main ? main.label.ru : c.label_ru, 'ru')}${main && main.label.kk ? ' , ' + lit(main.label.kk, 'kk') : ''}${main && main.label.en ? ' , ' + lit(main.label.en, 'en') : ''}`);
    const alts = new Set(defs.map((d) => d.label.ru).filter((x) => main && x !== main.label.ru));
    if (alts.size) p.push(`  skos:altLabel ${[...alts].map((x) => lit(x, 'ru')).join(' , ')}`);
    if (main && main.text.ru) p.push(`  skos:definition ${lit(main.text.ru, 'ru')}${main.text.en ? ' , ' + lit(main.text.en, 'en') : ''}${main.text.kk ? ' , ' + lit(main.text.kk, 'kk') : ''}`);
    if (main) p.push(`  rdfs:isDefinedBy :${main.doc}`, `  dcterms:source ${defs.map((d) => ':' + d.doc).filter((v, i, a) => a.indexOf(v) === i).join(' , ')}`);
    if (defs.length > 1) p.push(`  skos:editorialNote ${lit(`Определений в корпусе: ${defs.length} (${defs.map((d) => d.docCode + (d.clause ? ', п. ' + d.clause : '')).join('; ')}).`, 'ru')}`);
    L.push(p.join(' ;\n') + ' .');
  }
  L.push('');
  L.push(':CorpusScheme a skos:ConceptScheme ; skos:prefLabel "Корпус"@ru .');
  for (const d of corpus.documents) {
    const members = [...new Set(corpus.definitions.filter((x) => x.doc === d.id).map((x) => x.concept))];
    L.push(`:${d.id} a :ReferencedDocument ; skos:prefLabel ${lit(d.code, 'ru')} ; dcterms:title ${lit(d.title, 'ru')} ; skos:notation ${lit(d.code)} ; :documentStatus ${lit(STATUSES[d.status] || d.status, 'ru')} ; :legalRank ${d.rank}${d.year ? ` ; :documentYear ${d.year}` : ''} .`);
    if (members.length) {
      L.push(`:Coll_${d.id} a skos:Collection ; skos:prefLabel ${lit(`${d.code} (ранг ${d.rank}, ${STATUSES[d.status]})`, 'ru')} ; skos:member ${members.map((m) => ':' + m).join(' , ')} .`);
    }
  }
  L.push(':ReferencedDocument a owl:Class ; skos:prefLabel "документ корпуса"@ru .');
  return L.join('\n') + '\n';
}

/** Профиль просмотрщика для корпуса. */
export function corpusProfile(extraClasses = []) {
  return { languages: ['ru', 'kk', 'en'], rootClasses: ['CorpusEntity'],
    structuralClasses: ['CorpusEntity', 'Unformalized', 'ReferencedDocument', ...extraClasses.map((c) => c.id)], targets: {}, neighbourhoodSiblings: false };
}
