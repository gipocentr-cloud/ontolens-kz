/**
 * Движок коллизий в определениях терминов (ТЗ v3.1, разделы 3–4, 8).
 *
 * Коллизия признаётся доказанной только на подтверждённых формализациях
 * («род + видовые отличия») и утверждённых аксиомах; каждый шаг доказательства
 * несёт источник — пункт документа или решение редактора. Лексическое сходство
 * текстов только ставит пару в очередь на формализацию.
 */
import { wordDiff, foldText } from './normalize.js';
import { STATUSES } from './glossary.js';

const STATUS_ORDER = { active: 0, unverified: 1, project: 2, replaced: 3, cancelled: 4 };
export const KIND_TITLES = {
  'K1-genus': 'Несовместимый род',
  'K1-diff': 'Несовместимые признаки',
  'K1-scope': 'Разный объём понятия',
  'K1-open': 'Разный род, несовместимость не установлена',
  'K1-lex': 'Тексты расходятся — нужна формализация',
  'K3': 'Синонимия: одно понятие — разные термины',
  'K7': 'Опора на недействующий документ',
  'K8': 'Новая редакция изменила определение',
  'K9': 'Расхождение языковых слоёв',
  'K10-chain': 'Косвенное противоречие через родовую цепочку',
};
export const KIND_LETTER = { proved: 'доказано', candidate: 'кандидат', info: 'к сведению' };

/** Простая детерминированная хэш-строка для идентификаторов коллизий. */
function h(s) { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 0x01000193) >>> 0; return x.toString(36); }

/**
 * @param {object} corpus  {documents, concepts, definitions}
 * @param {object} formal  {defId: {genus, diffs:[{prop, value, quote}], status}}
 * @param {Array}  axioms  [{id, type:'disjoint'|'functional', a, b, prop, basis, by, date, active}]
 * @param {Array}  classes [{id, label, parent, basis}] — структурные классы редактора
 * @param {Array}  props   [{id, label}]
 * @param {object} opts    {lexThreshold:0.35, maxDepth:4}
 */
export function analyseCorpus(corpus, formal = {}, axioms = [], classes = [], props = [], opts = {}) {
  const lexThreshold = opts.lexThreshold == null ? 0.35 : opts.lexThreshold;
  const maxDepth = opts.maxDepth || 6;
  const docs = new Map(corpus.documents.map((d) => [d.id, d]));
  const defs = new Map(corpus.definitions.map((d) => [d.id, d]));
  const conceptById = new Map(corpus.concepts.map((c) => [c.id, c]));
  const clsById = new Map(classes.map((c) => [c.id, c]));
  const propById = new Map(props.map((p) => [p.id, p]));
  const label = (id) => (conceptById.get(id) ? conceptById.get(id).label_ru : clsById.get(id) ? clsById.get(id).label : (propById.get(id) ? propById.get(id).label : id));
  const docRef = (d) => { const doc = docs.get(d.doc); return { doc: doc.id, code: doc.code, clause: d.clause, rank: doc.rank, status: doc.status }; };
  const cite = (d) => `${docs.get(d.doc).code}${d.clause ? ', п. ' + d.clause : ''}`;
  const short = (t, n = 260) => { t = String(t || '').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

  // ---------- подтверждённые формализации
  const F = {};
  for (const [id, f] of Object.entries(formal)) if (f && f.status === 'confirmed' && defs.has(id) && f.genus) F[id] = f;

  // ---------- рёбра «вид → род» с источниками
  const edges = new Map();   // child -> [{parent, src}]
  const addEdge = (child, parent, src) => { if (!child || !parent || child === parent) return; (edges.get(child) || edges.set(child, []).get(child)).push({ parent, src }); };
  for (const [id, f] of Object.entries(F)) {
    const d = defs.get(id);
    addEdge(d.concept, f.genus, { kind: 'def', def: d });
  }
  for (const c of classes) if (c.parent) addEdge(c.id, c.parent, { kind: 'class', cls: c });

  /** Предки класса с путём; рёбра от понятия `skip` не используются (чтобы второе определение не подмешивалось). */
  function ancestors(start, skip) {
    const out = new Map([[start, []]]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      const path = out.get(cur);
      if (path.length >= maxDepth) continue;
      for (const e of edges.get(cur) || []) {
        if (cur === skip) continue;
        if (out.has(e.parent)) continue;
        out.set(e.parent, path.concat([{ from: cur, to: e.parent, src: e.src }]));
        queue.push(e.parent);
      }
    }
    return out;
  }

  const activeAx = axioms.filter((a) => a.active !== false);
  const disjointAx = activeAx.filter((a) => a.type === 'disjoint');
  const functionalProps = new Map(activeAx.filter((a) => a.type === 'functional').map((a) => [a.prop, a]));

  /** Несовместимость двух классов: ищем аксиому A⊥B среди их предков. */
  function disjointness(x, y, skip) {
    const ax = ancestors(x, skip), ay = ancestors(y, skip);
    if (ax.has(y)) return { rel: 'sub', path: ax.get(y) };          // x ⊑ y
    if (ay.has(x)) return { rel: 'super', path: ay.get(x) };        // y ⊑ x
    for (const a of disjointAx) {
      for (const [p, q] of [[a.a, a.b], [a.b, a.a]]) {
        if (ax.has(p) && ay.has(q)) return { rel: 'disjoint', axiom: a, pathX: ax.get(p), pathY: ay.get(q), A: p, B: q };
      }
    }
    return { rel: 'unrelated' };
  }

  function yields(dA, dB) {
    const a = docs.get(dA.doc), b = docs.get(dB.doc);
    if (a.rank !== b.rank) {
      const lo = a.rank > b.rank ? a : b, hi = lo === a ? b : a;
      return { doc: lo.id, code: lo.code, reason: `ранг ${lo.rank} ниже ранга ${hi.rank} (${hi.code})` };
    }
    if (STATUS_ORDER[a.status] !== STATUS_ORDER[b.status]) {
      const lo = STATUS_ORDER[a.status] > STATUS_ORDER[b.status] ? a : b, hi = lo === a ? b : a;
      return { doc: lo.id, code: lo.code, reason: `ранг равный; статус «${STATUSES[lo.status]}» против «${STATUSES[hi.status]}»` };
    }
    if (a.year && b.year && a.year !== b.year) {
      const lo = a.year < b.year ? a : b, hi = lo === a ? b : a;
      return { doc: lo.id, code: lo.code, reason: `ранг и статус равны; редакция ${lo.year} г. старше ${hi.year} г.` };
    }
    return null;
  }

  function severityOf(kind, dA, dB) {
    const a = docs.get(dA.doc), b = docs.get(dB.doc);
    if (a.rank !== b.rank && Math.min(a.rank, b.rank) <= 5) return 'critical';
    return 'major';
  }

  // ---------- текст шагов
  const pathSteps = (path) => path.map((e) => {
    if (e.src.kind === 'def') {
      const d = e.src.def;
      return { type: 'step', text: `«${label(e.from)}» — вид «${label(e.to)}»: так определено в ${cite(d)} (род в формализации определения).`,
        source: { ...docRef(d), def: d.id }, quote: short(d.text.ru, 200), indirect: true };
    }
    const c = e.src.cls;
    return { type: 'step', text: `«${label(e.from)}» — вид «${label(e.to)}» (структурный класс онтологии корпуса).`,
      source: c.basis ? { basis: c.basis, by: c.by, date: c.date } : null };
  });
  const premise = (d, f) => ({ type: 'premise',
    text: `${cite(d)} (ранг ${docs.get(d.doc).rank}, ${STATUSES[docs.get(d.doc).status]}) определяет «${d.label.ru}» как вид «${label(f.genus)}»${f.diffs && f.diffs.length ? ', с признаками: ' + f.diffs.map((x) => `${label(x.prop)} — ${x.value ? label(x.value) : '«' + x.literal + '»'}`).join('; ') : ''}.`,
    quote: short(d.text.ru), source: { ...docRef(d), def: d.id } });
  const axiomStep = (a, text) => ({ type: 'axiom', text, source: a.basis ? { axiom: a.id, basis: a.basis, by: a.by, date: a.date } : null });

  const out = [];
  function push(c) {
    c.id = c.kind + '_' + h(c.kind + '|' + c.concept + '|' + c.defs.slice().sort().join('|'));
    // доказательство публикуется только если у каждого шага есть источник
    if (c.status === 'proved' && c.proof.some((s) => s.type !== 'conclusion' && !s.source)) {
      c.status = 'candidate';
      c.unsourced = c.proof.filter((s) => s.type !== 'conclusion' && !s.source).map((s) => s.text);
    }
    out.push(c);
  }

  // ---------- по понятиям
  const byConcept = new Map();
  for (const d of corpus.definitions) (byConcept.get(d.concept) || byConcept.set(d.concept, []).get(d.concept)).push(d);

  for (const [cid, list] of byConcept) {
    const cname = label(cid);
    // K7: нет ни одного определения из действующего документа
    const live = list.filter((d) => !['cancelled', 'replaced'].includes(docs.get(d.doc).status));
    if (!live.length) {
      const d = list[0];
      push({ kind: 'K7', concept: cid, defs: list.map((x) => x.id), docs: [...new Set(list.map((x) => x.doc))], status: 'proved', severity: 'major',
        title: `«${cname}» определено только в недействующих документах`,
        proof: [...list.map((x) => ({ type: 'premise', text: `«${x.label.ru}» определено в ${cite(x)}.`, quote: short(x.text.ru), source: { ...docRef(x), def: x.id } })),
          ...[...new Set(list.map((x) => x.doc))].map((id) => { const doc = docs.get(id); return { type: 'premise', text: `${doc.code} имеет статус «${STATUSES[doc.status]}»${doc.replacedBy ? `, заменён ${docs.get(doc.replacedBy).code}` : ''}.`, source: { doc: id, code: doc.code, registry: true } }; }),
          { type: 'conclusion', text: `Действующего определения понятия «${cname}» в корпусе нет: ссылка на него опирается на недействующий источник.${d && docs.get(d.doc).replacedBy ? ` Определение нужно взять из ${docs.get(docs.get(d.doc).replacedBy).code} или добавить в действующий документ.` : ''}` }],
        explanation: 'все определения — из отменённых или заменённых документов' });
    }
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const d1 = list[i], d2 = list[j];
        if (d1.doc === d2.doc) continue;
        const f1 = F[d1.id], f2 = F[d2.id];
        const pairDocs = [d1.doc, d2.doc];
        const y = yields(d1, d2);
        // K9: языковые слои
        for (const lang of ['kk', 'en']) {
          const a = d1.label[lang], b = d2.label[lang];
          if (a && b && foldText(a) !== foldText(b)) {
            push({ kind: 'K9', lang, concept: cid, defs: [d1.id, d2.id].concat(lang), docs: pairDocs, status: 'proved', severity: 'minor', yields: y,
              title: `«${cname}»: ${lang === 'kk' ? 'казахский' : 'английский'} термин различается`,
              proof: [
                { type: 'premise', text: `${cite(d1)}: ${lang} — «${a}».`, source: { ...docRef(d1), def: d1.id } },
                { type: 'premise', text: `${cite(d2)}: ${lang} — «${b}».`, source: { ...docRef(d2), def: d2.id } },
                { type: 'conclusion', text: `Одно понятие имеет два ${lang === 'kk' ? 'казахских' : 'английских'} названия.${y ? ` По приоритету источников основой следует взять «${y.doc === d1.doc ? b : a}» (${y.reason}).` : ''}` }],
              explanation: `${lang}: «${a}» ≠ «${b}»` });
          }
        }
        // K8: редакция
        const D1 = docs.get(d1.doc), D2 = docs.get(d2.doc);
        if ((D1.replacedBy === D2.id || D2.replacedBy === D1.id)) {
          const wd = wordDiff(d1.text.ru, d2.text.ru);
          if (wd > 0.1) {
            const [old, nw] = D1.replacedBy === D2.id ? [d1, d2] : [d2, d1];
            push({ kind: 'K8', concept: cid, defs: [d1.id, d2.id], docs: pairDocs, status: 'info', severity: 'info', signal: wd,
              title: `«${cname}»: в ${docs.get(nw.doc).code} определение изменено`,
              proof: [premiseText(old), premiseText(nw), { type: 'premise', text: `${docs.get(nw.doc).code} заменяет ${docs.get(old.doc).code}.`, source: { doc: nw.doc, code: docs.get(nw.doc).code, registry: true } },
                { type: 'conclusion', text: `Документы, ссылающиеся на ${docs.get(old.doc).code}, применяют прежний объём понятия (различие текстов ${Math.round(wd * 100)} %).` }],
              explanation: `различие ${Math.round(wd * 100)} %` });
          }
        }
        if (f1 && f2) {
          const r = disjointness(f1.genus, f2.genus, cid);
          if (r.rel === 'disjoint') {
            const chain = [...r.pathX, ...r.pathY];
            const indirect = chain.some((e) => e.src.kind === 'def');
            const kind = indirect ? 'K10-chain' : 'K1-genus';
            const sameLabel = foldText(d1.label.ru) === foldText(d2.label.ru);
            const sev = severityOf(kind, d1, d2);
            push({ kind, concept: cid, defs: [d1.id, d2.id], docs: pairDocs, status: 'proved', severity: sev, yields: y,
              title: `«${cname}»: «${label(f1.genus)}» (${D1.code}) ↔ «${label(f2.genus)}» (${D2.code})`,
              proof: [premise(d1, f1), premise(d2, f2), ...pathSteps(r.pathX), ...pathSteps(r.pathY),
                axiomStep(r.axiom, `«${label(r.A)}» и «${label(r.B)}» — несовместимые классы: ни один объект не может быть одновременно тем и другим.${r.axiom.basis ? ' Основание: ' + r.axiom.basis + '.' : ''}`),
                { type: 'conclusion', text: `Следовательно, документы «${D1.code}» и «${D2.code}» относят понятие «${cname}» к несовместимым родам${indirect ? ' (через цепочку определений других терминов)' : ''}; оба определения не могут быть верны одновременно.${y ? ` Уступает «${y.code}»: ${y.reason}.` : ' Ранг и статус документов равны — основу выбирает редактор.'}${sameLabel ? ' Возможна иная трактовка: один термин обозначает два разных понятия (омонимия) — тогда понятие нужно развести.' : ''}` }],
              explanation: `${label(r.A)} ⊥ ${label(r.B)}${indirect ? ', через цепочку' : ''}`, homonymy: sameLabel });
            continue;
          }
          if (r.rel === 'unrelated') {
            push({ kind: 'K1-open', concept: cid, defs: [d1.id, d2.id], docs: pairDocs, status: 'candidate', severity: 'candidate', yields: y,
              title: `«${cname}»: род «${label(f1.genus)}» (${D1.code}) и «${label(f2.genus)}» (${D2.code})`,
              proof: [premise(d1, f1), premise(d2, f2),
                { type: 'conclusion', text: `Роды различны и не связаны отношением «вид — род». Если «${label(f1.genus)}» и «${label(f2.genus)}» несовместимы, это коллизия — добавьте аксиому несовместимости с основанием; если совместимы — закройте как «допустимо».` }],
              explanation: 'нужна аксиома или решение', suggestAxiom: { a: f1.genus, b: f2.genus } });
            continue;
          }
          // род совместим: признаки
          let diffConflict = null;
          for (const x1 of f1.diffs || []) {
            for (const x2 of f2.diffs || []) {
              if (x1.prop !== x2.prop) continue;
              if (x1.value && x2.value && x1.value !== x2.value) {
                const rv = disjointness(x1.value, x2.value, cid);
                if (rv.rel === 'disjoint') { diffConflict = { x1, x2, why: 'disjoint', rv }; break; }
                if (rv.rel === 'unrelated' && functionalProps.has(x1.prop)) { diffConflict = { x1, x2, why: 'functional', ax: functionalProps.get(x1.prop) }; break; }
              } else if (!x1.value && !x2.value && x1.literal && x2.literal && foldText(x1.literal) !== foldText(x2.literal) && functionalProps.has(x1.prop)) {
                diffConflict = { x1, x2, why: 'functional', ax: functionalProps.get(x1.prop) }; break;
              }
            }
            if (diffConflict) break;
          }
          if (diffConflict) {
            const { x1, x2 } = diffConflict;
            const v1 = x1.value ? label(x1.value) : x1.literal, v2 = x2.value ? label(x2.value) : x2.literal;
            const steps = diffConflict.why === 'disjoint'
              ? [...pathSteps(diffConflict.rv.pathX), ...pathSteps(diffConflict.rv.pathY),
                axiomStep(diffConflict.rv.axiom, `«${label(diffConflict.rv.A)}» и «${label(diffConflict.rv.B)}» несовместимы.${diffConflict.rv.axiom.basis ? ' Основание: ' + diffConflict.rv.axiom.basis + '.' : ''}`)]
              : [axiomStep(diffConflict.ax, `Признак «${label(x1.prop)}» может иметь только одно значение.${diffConflict.ax.basis ? ' Основание: ' + diffConflict.ax.basis + '.' : ''}`)];
            push({ kind: 'K1-diff', concept: cid, defs: [d1.id, d2.id], docs: pairDocs, status: 'proved', severity: severityOf('K1-diff', d1, d2), yields: y,
              title: `«${cname}»: признак «${label(x1.prop)}» — «${v1}» ↔ «${v2}»`,
              proof: [premise(d1, f1), premise(d2, f2),
                { type: 'step', text: `${cite(d1)}: «${label(x1.prop)}» — «${v1}»${x1.quote ? ` («${x1.quote}»)` : ''}.`, source: { ...docRef(d1), def: d1.id } },
                { type: 'step', text: `${cite(d2)}: «${label(x2.prop)}» — «${v2}»${x2.quote ? ` («${x2.quote}»)` : ''}.`, source: { ...docRef(d2), def: d2.id } },
                ...steps,
                { type: 'conclusion', text: `Род у определений совместим, но признак «${label(x1.prop)}» задан несовместимо; оба определения не могут быть верны одновременно.${y ? ` Уступает «${y.code}»: ${y.reason}.` : ''}` }],
              explanation: `${label(x1.prop)}: ${v1} ↔ ${v2}` });
            continue;
          }
          // объём
          const p1 = new Set((f1.diffs || []).map((x) => x.prop + '=' + (x.value || foldText(x.literal || '')))), p2 = new Set((f2.diffs || []).map((x) => x.prop + '=' + (x.value || foldText(x.literal || ''))));
          const only1 = [...p1].filter((x) => !p2.has(x)), only2 = [...p2].filter((x) => !p1.has(x));
          if (r.rel !== 'sub' && r.rel !== 'super' && !only1.length && !only2.length) continue;   // одинаковы
          if (f1.genus === f2.genus && !only1.length && !only2.length) continue;
          push({ kind: 'K1-scope', concept: cid, defs: [d1.id, d2.id], docs: pairDocs, status: 'info', severity: 'info', yields: y,
            title: `«${cname}»: объём понятия различается (${D1.code} / ${D2.code})`,
            proof: [premise(d1, f1), premise(d2, f2),
              ...(f1.genus !== f2.genus ? pathSteps(r.path) : []),
              { type: 'conclusion', text: `Несовместимости нет: ${f1.genus !== f2.genus ? 'один род — вид другого' : 'род общий'}${only1.length || only2.length ? ', наборы признаков различаются' : ''}. Одно определение уже другого; это допустимо, если область применения документов различается. Решает эксперт.` }],
            explanation: 'уточнение объёма' });
          continue;
        }
        // нет формализации — лексический сигнал
        const wd = wordDiff(d1.text.ru, d2.text.ru);
        if (wd >= lexThreshold) {
          push({ kind: 'K1-lex', concept: cid, defs: [d1.id, d2.id], docs: pairDocs, status: 'candidate', severity: 'candidate', signal: wd, yields: y,
            title: `«${cname}»: тексты расходятся на ${Math.round(wd * 100)} % (${D1.code} / ${D2.code})`,
            proof: [premiseText(d1), premiseText(d2),
              { type: 'conclusion', text: `Тексты различаются на ${Math.round(wd * 100)} % значимых слов. Это не доказательство: формализуйте оба определения (род и признаки), чтобы установить, есть ли противоречие.${!f1 ? ` Не формализовано: ${cite(d1)}.` : ''}${!f2 ? ` Не формализовано: ${cite(d2)}.` : ''}` }],
            explanation: `различие ${Math.round(wd * 100)} %, формализации нет` });
        }
      }
    }
  }

  // ---------- K3: синонимия между понятиями
  const sig = new Map();
  for (const [id, f] of Object.entries(F)) {
    if (!f.diffs || !f.diffs.length) continue;
    const key = f.genus + '|' + f.diffs.map((x) => x.prop + '=' + (x.value || foldText(x.literal || ''))).sort().join('|');
    (sig.get(key) || sig.set(key, []).get(key)).push(defs.get(id));
  }
  for (const group of sig.values()) {
    const concepts = [...new Set(group.map((d) => d.concept))];
    if (concepts.length < 2) continue;
    for (let i = 0; i < concepts.length; i++) {
      for (let j = i + 1; j < concepts.length; j++) {
        const d1 = group.find((d) => d.concept === concepts[i]), d2 = group.find((d) => d.concept === concepts[j]);
        const y = yields(d1, d2);
        push({ kind: 'K3', concept: concepts[i], concept2: concepts[j], defs: [d1.id, d2.id], docs: [d1.doc, d2.doc], status: 'proved', severity: 'major', yields: y,
          title: `«${d1.label.ru}» (${docs.get(d1.doc).code}) и «${d2.label.ru}» (${docs.get(d2.doc).code}) — одно понятие`,
          proof: [premise(d1, F[d1.id]), premise(d2, F[d2.id]),
            { type: 'conclusion', text: `У обоих определений один род и одинаковые отличительные признаки: это одно понятие под двумя терминами.${y ? ` Основным термином следует взять «${y.doc === d1.doc ? d2.label.ru : d1.label.ru}» (${y.reason}), второй — допустимым синонимом.` : ''}` }],
          explanation: 'одинаковые род и признаки' });
      }
    }
  }

  function premiseText(d) {
    return { type: 'premise', text: `${cite(d)} (ранг ${docs.get(d.doc).rank}, ${STATUSES[docs.get(d.doc).status]}) определяет «${d.label.ru}».`, quote: short(d.text.ru), source: { ...docRef(d), def: d.id } };
  }

  // порядок: критические доказанные → доказанные → кандидаты → к сведению
  const sevOrder = { critical: 0, major: 1, minor: 2, candidate: 3, info: 4 };
  out.sort((a, b) => (sevOrder[a.severity] - sevOrder[b.severity]) || ((b.signal || 0) - (a.signal || 0)) || a.title.localeCompare(b.title, 'ru'));
  const stats = { total: out.length, proved: out.filter((c) => c.status === 'proved').length, candidates: out.filter((c) => c.status === 'candidate').length,
    info: out.filter((c) => c.status === 'info').length, critical: out.filter((c) => c.severity === 'critical').length,
    formalized: Object.keys(F).length, definitions: corpus.definitions.length,
    byKind: out.reduce((a, c) => ((a[c.kind] = (a[c.kind] || 0) + 1), a), {}) };
  return { conflicts: out, stats };
}

// ---------------------------------------------------------------- подсказка разбора определения
/**
 * Эвристика (без языковой модели): род — самый длинный класс корпуса,
 * название которого стоит в начале определения. Только предложение; подтверждает человек.
 */
import { contentStems, words, stem } from './normalize.js';
export function proposeGenus(def, corpus, classes = []) {
  const cand = [
    ...corpus.concepts.filter((c) => c.id !== def.concept).map((c) => ({ id: c.id, labels: c.labels || [c.label_ru] })),
    ...classes.map((c) => ({ id: c.id, labels: [c.label] })),
  ];
  const head = words(def.text.ru).slice(0, 8).map(stem);
  let best = null;
  for (const c of cand) {
    for (const l of c.labels) {
      const st = words(l).map(stem);
      if (!st.length) continue;
      for (let pos = 0; pos <= 2; pos++) {
        if (st.every((s, i) => head[pos + i] === s)) {
          const score = st.length * 10 - pos;
          if (!best || score > best.score) best = { genus: c.id, label: l, score, quote: words(def.text.ru).slice(pos, pos + st.length).join(' ') };
        }
      }
    }
  }
  if (best) return best;
  // нет подходящего класса — предложить новый структурный класс по первому слову
  const first = words(def.text.ru).find((w) => !['это', 'вид', 'один'].includes(w));
  return first ? { newClass: first, quote: first, score: 0 } : null;
}

export { contentStems };
