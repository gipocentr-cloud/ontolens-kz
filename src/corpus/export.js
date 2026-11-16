/**
 * Выгрузки корпуса (ТЗ v3.1, раздел 9): карта коллизий (CSV), отчёт с доказательствами (Markdown),
 * Turtle — определения с формализацией, аксиомы с основаниями, коллизии с шагами доказательства.
 */
import { idPart, STATUSES, corpusToTurtle } from './glossary.js';
import { KIND_TITLES, KIND_LETTER } from './engine.js';

const esc = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n');
const lit = (s, lang) => `"${esc(s)}"${lang ? '@' + lang : ''}`;
export const corpusNS = (corpus) => `http://ontogeo.kz/corpus/${idPart(corpus.name, 40)}#`;
const PFX = (ns) => [`@prefix : <${ns}> .`, '@prefix owl: <http://www.w3.org/2002/07/owl#> .',
  '@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .', '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
  '@prefix dcterms: <http://purl.org/dc/terms/> .', '@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .', ''];

export const SEVERITY_RU = { critical: 'критическая', major: 'существенная', minor: 'незначительная', candidate: 'кандидат', info: 'к сведению' };
export const STEP_RU = { premise: 'Посылка', step: 'Шаг', axiom: 'Аксиома', conclusion: 'Вывод' };

/** Ключ оценки коллизии: не зависит от вида (вид меняется по мере формализации). */
export function conflictKey(c) {
  return 'conflict:' + [c.concept, c.concept2 || ''].join('+') + '|' + c.defs.slice().sort().join('|');
}

export function sourceText(src) {
  if (!src) return 'источник не указан';
  if (src.axiom) return `аксиома ${src.axiom}${src.basis ? ': ' + src.basis : ''}${src.by ? ` (${src.by}${src.date ? ', ' + src.date : ''})` : ''}`;
  if (src.basis) return `${src.basis}${src.by ? ` (${src.by}${src.date ? ', ' + src.date : ''})` : ''}`;
  if (src.registry) return `реестр документов: ${src.code}`;
  return `${src.code}${src.clause ? ', п. ' + src.clause : ''}`;
}

/** Определения, формализации, структурные классы и свойства (TBox + описания определений). */
export function definitionsTurtle(corpus, work) {
  const ns = corpusNS(corpus);
  let out = corpusToTurtle(corpus, work.formal || {}, work.classes || []);
  const L = [''];
  L.push(':TermDefinition a owl:Class ; rdfs:label "определение термина в документе"@ru .');
  L.push(':Differentia a owl:Class ; rdfs:label "видовое отличие"@ru .');
  for (const p of ['ofConcept', 'inDocument', 'genus', 'differentia', 'onProperty', 'value']) L.push(`:${p} a owl:ObjectProperty .`);
  for (const p of work.props || []) L.push(`:${p.id} a owl:ObjectProperty ; rdfs:label ${lit(p.label, 'ru')} .`);
  for (const d of corpus.definitions) {
    const f = (work.formal || {})[d.id];
    const p = [`:${d.id} a :TermDefinition`, `  :ofConcept :${d.concept}`, `  :inDocument :${d.doc}`,
      `  rdfs:label ${lit(d.label.ru, 'ru')}`, `  :definitionText ${lit(d.text.ru, 'ru')}`];
    if (d.clause) p.push(`  :clause ${lit(d.clause)}`);
    if (f && f.genus) {
      p.push(`  :genus :${f.genus}`, `  :formalizationStatus ${lit(f.status || 'draft')}`);
      if (f.by) p.push(`  dcterms:creator ${lit(f.by)}`);
      (f.diffs || []).forEach((x) => {
        p.push(`  :differentia [ a :Differentia ; :onProperty :${x.prop}${x.value ? ' ; :value :' + x.value : ''}${x.literal ? ' ; :literalValue ' + lit(x.literal, 'ru') : ''}${x.quote ? ' ; :quote ' + lit(x.quote, 'ru') : ''} ]`);
      });
    }
    L.push(p.join(' ;\n') + ' .');
  }
  return out + L.join('\n') + '\n';
}

/** Аксиомы с основаниями (OWL-аннотации аксиом). */
export function axiomsTurtle(corpus, work) {
  const L = PFX(corpusNS(corpus));
  for (const a of work.axioms || []) {
    const ann = `dcterms:source ${lit(a.basis || 'основание не указано', 'ru')}${a.by ? ' ; dcterms:creator ' + lit(a.by) : ''}${a.date ? ' ; dcterms:date ' + lit(a.date) : ''} ; :axiomId ${lit(a.id)} ; :active ${a.active === false ? 'false' : 'true'}`;
    if (a.type === 'disjoint') {
      if (a.active !== false) L.push(`:${a.a} owl:disjointWith :${a.b} .`);
      L.push(`[] a owl:Axiom ; owl:annotatedSource :${a.a} ; owl:annotatedProperty owl:disjointWith ; owl:annotatedTarget :${a.b} ; ${ann} .`);
    } else if (a.type === 'functional') {
      if (a.active !== false) L.push(`:${a.prop} a owl:ObjectProperty , owl:FunctionalProperty .`);
      L.push(`[] a owl:Axiom ; owl:annotatedSource :${a.prop} ; owl:annotatedProperty rdf:type ; owl:annotatedTarget owl:FunctionalProperty ; ${ann} .`);
    }
  }
  return L.join('\n') + '\n';
}

/** Коллизии с шагами доказательства и оценками экспертов. reviews: [{expert, items}] */
export function conflictsTurtle(corpus, conflicts, reviews = []) {
  const L = PFX(corpusNS(corpus));
  L.push(':TermConflict a owl:Class ; rdfs:label "коллизия определений"@ru .', ':ProofStep a owl:Class ; rdfs:label "шаг доказательства"@ru .', '');
  for (const c of conflicts) {
    const p = [`:${c.id} a :TermConflict`, `  rdfs:label ${lit(c.title, 'ru')}`, `  :kind ${lit(c.kind)}`, `  :status ${lit(c.status)}`,
      `  :severity ${lit(c.severity)}`, `  :concerns :${c.concept}${c.concept2 ? ' , :' + c.concept2 : ''}`,
      `  :definition ${c.defs.filter((x) => x.includes('__')).map((x) => ':' + x).join(' , ')}`];
    if (c.yields) p.push(`  :yieldingDocument :${c.yields.doc}`, `  :yieldReason ${lit(c.yields.reason, 'ru')}`);
    c.proof.forEach((s, i) => {
      p.push(`  :proofStep [ a :ProofStep ; :order ${i + 1} ; :stepType ${lit(s.type)} ; rdfs:comment ${lit(s.text, 'ru')}${s.quote ? ' ; :quote ' + lit(s.quote, 'ru') : ''} ; :source ${lit(sourceText(s.source), 'ru')} ]`);
    });
    const key = conflictKey(c);
    for (const r of reviews) {
      const v = r.items && r.items[key];
      if (v && v.verdict) p.push(`  :expertVerdict [ :expert ${lit(r.expert)} ; :verdict ${lit(v.verdict)}${v.comment ? ' ; rdfs:comment ' + lit(v.comment, 'ru') : ''}${v.disputed_step ? ' ; :disputedStep ' + Number(v.disputed_step) : ''} ]`);
    }
    L.push(p.join(' ;\n') + ' .');
  }
  return L.join('\n') + '\n';
}

/** Карта коллизий: одна строка — одна коллизия; оценки экспертов — столбцами. */
export function conflictsCsvRows(corpus, conflicts, reviews = [], verdictName = (v) => v) {
  const defs = new Map(corpus.definitions.map((d) => [d.id, d]));
  const head = ['id', 'kind', 'kind_ru', 'status', 'severity', 'title', 'doc_a', 'clause_a', 'def_a', 'doc_b', 'clause_b', 'def_b',
    'yields_doc', 'yields_reason', 'conclusion', ...reviews.map((r) => 'verdict_' + r.expert), ...reviews.map((r) => 'comment_' + r.expert)];
  const rows = [head];
  for (const c of conflicts) {
    const [a, b] = c.defs.filter((x) => defs.has(x)).map((x) => defs.get(x));
    const concl = (c.proof.find((s) => s.type === 'conclusion') || {}).text || '';
    const key = conflictKey(c);
    rows.push([c.id, c.kind, KIND_TITLES[c.kind] || c.kind, KIND_LETTER[c.status] || c.status, SEVERITY_RU[c.severity] || c.severity, c.title,
      a ? a.docCode : '', a ? a.clause : '', a ? a.text.ru : '', b ? b.docCode : '', b ? b.clause : '', b ? b.text.ru : '',
      c.yields ? c.yields.code : '', c.yields ? c.yields.reason : '', concl,
      ...reviews.map((r) => (r.items[key] && r.items[key].verdict ? verdictName(r.items[key].verdict) : '')),
      ...reviews.map((r) => (r.items[key] && r.items[key].comment) || '')]);
  }
  return rows;
}

/** Отчёт с доказательствами — для письма разработчику нормы. */
export function conflictsMarkdown(corpus, res, opts = {}) {
  const only = opts.statuses || ['proved', 'candidate'];
  const list = res.conflicts.filter((c) => only.includes(c.status));
  const L = [`# Коллизии определений: ${corpus.name}`, '',
    `Документов: ${corpus.documents.length} · определений: ${corpus.definitions.length} · формализовано: ${res.stats.formalized}.`,
    `Доказанных коллизий: ${res.stats.proved} (критических: ${res.stats.critical}) · кандидатов: ${res.stats.candidates} · к сведению: ${res.stats.info}.`, '',
    'Доказанная коллизия опирается только на текст пунктов документов и на утверждённые аксиомы с основанием. Кандидат — сигнал, требующий формализации или решения редактора; это не доказательство.', '',
    '## Документы и ранги', '', '| Документ | Ранг | Статус |', '|---|---|---|',
    ...corpus.documents.slice().sort((a, b) => a.rank - b.rank).map((d) => `| ${d.code} | ${d.rank}${d.rankFromDefault ? ' (по умолчанию)' : ''} | ${STATUSES[d.status]} |`), ''];
  list.forEach((c, i) => {
    L.push(`## ${i + 1}. ${c.title}`, '', `*${KIND_TITLES[c.kind] || c.kind} · ${KIND_LETTER[c.status]} · ${SEVERITY_RU[c.severity]}*`, '');
    c.proof.forEach((s, j) => {
      L.push(`${j + 1}. **${STEP_RU[s.type] || s.type}.** ${s.text}`);
      if (s.quote) L.push(`   > ${s.quote}`);
      if (s.type !== 'conclusion') L.push(`   — источник: ${sourceText(s.source)}`);
    });
    if (c.unsourced) L.push('', `⚠ Не опубликовано как доказанное: у ${c.unsourced.length} шаг(ов) нет источника.`);
    L.push('');
  });
  return L.join('\n');
}
