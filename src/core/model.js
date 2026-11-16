/**
 * Раздел 5.1 ТЗ — загрузка и внутренняя модель.
 *
 * Парсинг — N3.js. Принадлежность триплета файлу сохраняется (нужно для
 * фильтра «только TBox» и для сравнения версий в релизе 2).
 * Паннинг: одна сущность с несколькими типами, а не две сущности.
 */
import { Parser, Store, DataFactory } from 'n3';
import { NS } from './profile.js';

const { namedNode } = DataFactory;

const A = NS.rdf + 'type';
const SUBCLASS = NS.rdfs + 'subClassOf';
const BROADER = NS.skos + 'broader';
const NARROWER = NS.skos + 'narrower';
const MEMBER = NS.skos + 'member';
const IN_SCHEME = NS.skos + 'inScheme';
const DOMAIN = NS.rdfs + 'domain';
const RANGE = NS.rdfs + 'range';
const SEE_ALSO = NS.rdfs + 'seeAlso';
const TARGET_CLASS = NS.sh + 'targetClass';

export const KIND = {
  CLASS: 'class',
  CONCEPT: 'concept',
  OBJECT_PROPERTY: 'objectProperty',
  DATA_PROPERTY: 'dataProperty',
  ANNOTATION_PROPERTY: 'annotationProperty',
  INDIVIDUAL: 'individual',
  COLLECTION: 'collection',
  SCHEME: 'scheme',
  SHAPE: 'shape',
  ONTOLOGY: 'ontology',
};

const TYPE_KIND = {
  [NS.owl + 'Class']: KIND.CLASS,
  [NS.rdfs + 'Class']: KIND.CLASS,
  [NS.skos + 'Concept']: KIND.CONCEPT,
  [NS.owl + 'ObjectProperty']: KIND.OBJECT_PROPERTY,
  [NS.owl + 'DatatypeProperty']: KIND.DATA_PROPERTY,
  [NS.owl + 'AnnotationProperty']: KIND.ANNOTATION_PROPERTY,
  [NS.owl + 'NamedIndividual']: KIND.INDIVIDUAL,
  [NS.skos + 'Collection']: KIND.COLLECTION,
  [NS.skos + 'OrderedCollection']: KIND.COLLECTION,
  [NS.skos + 'ConceptScheme']: KIND.SCHEME,
  [NS.sh + 'NodeShape']: KIND.SHAPE,
  [NS.sh + 'PropertyShape']: KIND.SHAPE,
  [NS.owl + 'Ontology']: KIND.ONTOLOGY,
};

export function localName(iri) {
  const h = iri.lastIndexOf('#');
  if (h >= 0) return iri.slice(h + 1);
  const s = iri.lastIndexOf('/');
  return s >= 0 ? iri.slice(s + 1) : iri;
}

export function nsOf(iri) {
  const h = iri.lastIndexOf('#');
  if (h >= 0) return iri.slice(0, h + 1);
  const s = iri.lastIndexOf('/');
  return s >= 0 ? iri.slice(0, s + 1) : iri;
}

function newEntity(iri) {
  return {
    iri,
    local: localName(iri),
    ns: nsOf(iri),
    curie: null,
    types: new Set(),
    kinds: new Set(),
    labels: {},            // lang -> [{value, prop}]
    altLabels: {},         // lang -> [string]
    definitions: {},       // lang -> [{value, prop}]
    notes: [],             // {prop, lang, value}
    parents: [],           // IRIs (subClassOf | broader)
    children: [],
    collections: [],       // IRIs of skos:Collection
    members: [],           // для коллекций
    schemes: [],
    provenance: [],        // {value, isIri}
    identifiers: [],
    domainOf: [],
    rangeOf: [],
    domain: [],
    range: [],
    seeAlso: [],
    shapes: [],            // IRIs of sh:NodeShape targeting this
    shapeTarget: null,
    external: false,
    files: new Set(),
    outgoing: [],          // {prop, target} — объектные связи
    incoming: [],
    literals: [],          // {prop, value, lang, datatype}
    isTerm: false,
    depth: 0,
  };
}

function push(map, lang, item) {
  (map[lang] || (map[lang] = [])).push(item);
}

/**
 * @param {Array<{name:string, text:string}>} files
 * @param {object} profile
 */
export function buildModel(files, profile) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const store = new Store();
  const prefixes = {};
  const fileStats = [];
  const parseErrors = [];

  files.forEach((f, idx) => {
    const parser = new Parser({ baseIRI: f.baseIRI || undefined });
    let n = 0;
    try {
      const quads = parser.parse(f.text, null, (pfx, iri) => {
        if (pfx && !prefixes[pfx]) prefixes[pfx] = iri.value || String(iri);
      });
      for (const q of quads) {
        store.addQuad(q.subject, q.predicate, q.object, namedNode('file:' + idx));
        n++;
      }
    } catch (e) {
      parseErrors.push({ file: f.name, message: String(e && e.message || e) });
    }
    fileStats.push({ name: f.name, index: idx, triples: n, bytes: f.text.length });
  });

  const labelProps = new Set(profile.labelProperties);
  const altProps = new Set(profile.altLabelProperties);
  const defProps = new Set(profile.definitionProperties);
  const provProps = new Set(profile.provenanceProperties);
  const idProps = new Set(profile.identifierProperties);
  const noteProps = new Set(Object.keys(profile.noteProperties));

  /** @type {Map<string, any>} */
  const E = new Map();
  const get = (iri) => {
    let e = E.get(iri);
    if (!e) { e = newEntity(iri); E.set(iri, e); }
    return e;
  };

  let tripleCount = 0;
  for (const q of store.getQuads(null, null, null, null)) {
    tripleCount++;
    const s = q.subject, p = q.predicate.value, o = q.object;
    if (s.termType !== 'NamedNode') continue;
    const e = get(s.value);
    const fileIdx = q.graph && q.graph.value && q.graph.value.startsWith('file:')
      ? Number(q.graph.value.slice(5)) : 0;
    e.files.add(fileIdx);

    if (o.termType === 'Literal') {
      const lang = o.language || '';
      const item = { value: o.value, prop: p, lang, datatype: o.datatype ? o.datatype.value : null };
      e.literals.push(item);
      if (labelProps.has(p)) push(e.labels, lang, item);
      else if (altProps.has(p)) push(e.altLabels, lang, o.value);
      else if (defProps.has(p)) push(e.definitions, lang, item);
      if (noteProps.has(p)) e.notes.push(item);
      if (provProps.has(p)) e.provenance.push({ value: o.value, isIri: false, prop: p });
      if (idProps.has(p)) e.identifiers.push(o.value);
      continue;
    }
    if (o.termType !== 'NamedNode') {
      // анонимные узлы (ограничения OWL, sh:property) — фиксируем факт связи
      if (p === SUBCLASS) e.hasAnonymousRestriction = true;
      continue;
    }

    const ov = o.value;
    switch (p) {
      case A: {
        e.types.add(ov);
        const k = TYPE_KIND[ov];
        if (k) e.kinds.add(k);
        else e.kinds.add(KIND.INDIVIDUAL);
        break;
      }
      case SUBCLASS:
      case BROADER:
        if (!e.parents.includes(ov)) e.parents.push(ov);
        get(ov);   // родитель может быть не объявлен (внешний IRI без заглушки)
        break;
      case NARROWER: {
        const c = get(ov);
        if (!c.parents.includes(s.value)) c.parents.push(s.value);
        break;
      }
      case MEMBER: {
        e.members.push(ov);
        const m = get(ov);
        if (!m.collections.includes(s.value)) m.collections.push(s.value);
        break;
      }
      case IN_SCHEME:
        e.schemes.push(ov);
        break;
      case DOMAIN:
        e.domain.push(ov);
        get(ov).domainOf.push(s.value);
        break;
      case RANGE:
        e.range.push(ov);
        get(ov).rangeOf.push(s.value);
        break;
      case SEE_ALSO:
        e.seeAlso.push(ov);
        break;
      case TARGET_CLASS: {
        e.shapeTarget = ov;
        const t = get(ov);
        if (!t.shapes.includes(s.value)) t.shapes.push(s.value);
        break;
      }
      default:
        if (provProps.has(p)) {
          e.provenance.push({ value: ov, isIri: true, prop: p });
        } else if (noteProps.has(p)) {
          e.notes.push({ value: ov, prop: p, lang: '', isIri: true });
        } else if (p !== A) {
          e.outgoing.push({ prop: p, target: ov });
          get(ov).incoming.push({ prop: p, source: s.value });
        }
    }
  }

  // ---- определить неймспейс онтологии -------------------------------------
  const ontologyEntities = [...E.values()].filter((e) => e.kinds.has(KIND.ONTOLOGY));
  const nsCount = new Map();
  for (const e of E.values()) {
    if (e.kinds.has(KIND.CLASS) || e.kinds.has(KIND.CONCEPT)) {
      nsCount.set(e.ns, (nsCount.get(e.ns) || 0) + 1);
    }
  }
  let mainNs = '';
  let best = -1;
  for (const [ns, n] of nsCount) if (n > best) { best = n; mainNs = ns; }
  if (!mainNs && ontologyEntities.length) mainNs = ontologyEntities[0].iri + '#';

  // вторичные неймспейсы того же пакета (например .../doc/)
  const ontoBase = mainNs.replace(/[#/]$/, '');
  const packageNs = new Set([mainNs]);
  for (const ns of nsCount.keys()) if (ns.startsWith(ontoBase)) packageNs.add(ns);

  for (const e of E.values()) {
    e.external = !(e.ns === mainNs || e.iri.startsWith(ontoBase));
    e.curie = toCurie(e.iri, prefixes, mainNs);
  }

  // ---- дети, глубина, термины ---------------------------------------------
  for (const e of E.values()) {
    for (const p of e.parents) {
      const pe = E.get(p);
      if (pe && !pe.children.includes(e.iri)) pe.children.push(e.iri);
    }
  }

  const structuralSet = new Set(profile.structuralClasses || []);
  for (const e of E.values()) {
    if (!(e.kinds.has(KIND.CLASS) || e.kinds.has(KIND.CONCEPT))) continue;
    if (e.external) continue;
    if (structuralSet.size) {
      e.isTerm = !structuralSet.has(e.local);
    } else {
      e.isTerm = e.identifiers.length > 0 || e.collections.length > 0 || e.kinds.has(KIND.CONCEPT);
    }
  }

  const depthCache = new Map();
  const depthOf = (iri, seen) => {
    if (depthCache.has(iri)) return depthCache.get(iri);
    const e = E.get(iri);
    if (!e) return 1;
    const ps = e.parents.filter((p) => { const pe = E.get(p); return pe && !pe.external; });
    let d = 1;
    if (ps.length) {
      const s2 = new Set(seen); s2.add(iri);
      let m = 0;
      for (const p of ps) { if (s2.has(p)) continue; m = Math.max(m, depthOf(p, s2)); }
      d = 1 + m;
    }
    depthCache.set(iri, d);
    return d;
  };
  const classes = [...E.values()].filter((e) => !e.external && (e.kinds.has(KIND.CLASS) || e.kinds.has(KIND.CONCEPT)));
  for (const e of classes) e.depth = depthOf(e.iri, new Set());

  const roots = classes.filter((e) => !e.parents.some((p) => { const pe = E.get(p); return pe && !pe.external; }))
    .sort((a, b) => a.local.localeCompare(b.local));

  // Строгий счёт — только именованные классы основного неймспейса (так считает
  // контрольный лист приёмки и rdflib). Классы в соседних неймспейсах пакета
  // (…/onto/X при основном …/onto#) видны в интерфейсе, но в метрики не входят.
  const nsClasses = classes.filter((e) => e.ns === mainNs);
  const nsSet = new Set(nsClasses.map((e) => e.iri));
  const strictCache = new Map();
  const strictDepth = (iri, seen) => {
    if (strictCache.has(iri)) return strictCache.get(iri);
    const e = E.get(iri);
    const ps = e ? e.parents.filter((p) => nsSet.has(p)) : [];
    let d = 1;
    if (ps.length) {
      const s2 = new Set(seen); s2.add(iri);
      let m = 0;
      for (const p of ps) { if (s2.has(p)) continue; m = Math.max(m, strictDepth(p, s2)); }
      d = 1 + m;
    }
    strictCache.set(iri, d);
    return d;
  };
  for (const e of nsClasses) e.nsDepth = strictDepth(e.iri, new Set());
  const nsRoots = nsClasses.filter((e) => !e.parents.some((p) => nsSet.has(p)))
    .sort((a, b) => a.local.localeCompare(b.local));

  const collections = [...E.values()].filter((e) => e.kinds.has(KIND.COLLECTION))
    .sort((a, b) => a.local.localeCompare(b.local, 'ru'));

  // хэш графа: ключ хранилища оценок и кэша раскладки карты
  let hsh = 0x811c9dc5;
  for (const f of files) {
    const t = f.text;
    for (let i = 0; i < t.length; i++) { hsh ^= t.charCodeAt(i); hsh = Math.imul(hsh, 0x01000193) >>> 0; }
  }

  const model = {
    hash: hsh.toString(16).padStart(8, '0'),
    entities: E,
    store,
    prefixes,
    files: fileStats,
    parseErrors,
    tripleCount,
    mainNs,
    ontoBase,
    packageNs: [...packageNs],
    ontology: ontologyEntities[0] || null,
    ontologies: ontologyEntities,
    roots,
    collections,
    classes,
    nsClasses,
    nsRoots,
    profile,
    loadMs: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 10) / 10,
  };
  model.searchIndex = buildSearchIndex(model);
  return model;
}

function toCurie(iri, prefixes, mainNs) {
  if (iri.startsWith(mainNs)) return ':' + iri.slice(mainNs.length);
  let bestP = null, bestLen = 0;
  for (const [p, ns] of Object.entries(prefixes)) {
    if (ns && iri.startsWith(ns) && ns.length > bestLen) { bestP = p; bestLen = ns.length; }
  }
  return bestP ? bestP + ':' + iri.slice(bestLen) : iri;
}

// --------------------------------------------------------------------------
//  Метки и определения с учётом языка
// --------------------------------------------------------------------------

/** Вернуть метку на языке lang; при отсутствии — на любом другом с пометкой. */
export function labelOf(model, e, lang) {
  if (typeof e === 'string') e = model.entities.get(e);
  if (!e) return { text: '', lang: null, fallback: false };
  const order = [lang, ...model.profile.languages.filter((l) => l !== lang), ''];
  for (const l of order) {
    const arr = e.labels[l];
    if (arr && arr.length) {
      return { text: arr[0].value, lang: l || null, fallback: l !== lang };
    }
  }
  return { text: e.local, lang: null, fallback: true, isLocalName: true };
}

export function labelText(model, e, lang) {
  return labelOf(model, e, lang).text;
}

export function definitionOf(model, e, lang) {
  const arr = e.definitions[lang];
  return arr && arr.length ? arr[0].value : null;
}

export function allLabels(model, e) {
  const out = [];
  for (const l of model.profile.languages) {
    const arr = e.labels[l];
    out.push({ lang: l, value: arr && arr.length ? arr[0].value : null, extra: arr ? arr.slice(1).map((x) => x.value) : [] });
  }
  for (const l of Object.keys(e.labels)) {
    if (!model.profile.languages.includes(l)) {
      out.push({ lang: l || '(без тега)', value: e.labels[l][0].value, foreign: true });
    }
  }
  return out;
}

// --------------------------------------------------------------------------
//  Поиск (5.2): по всем языкам, altLabel и определению, с нестрогим режимом
// --------------------------------------------------------------------------

function fold(s) {
  return s.toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[әӘ]/g, 'а').replace(/[ғҒ]/g, 'г').replace(/[қҚ]/g, 'к')
    .replace(/[ңҢ]/g, 'н').replace(/[өӨ]/g, 'о').replace(/[ұҰүҮ]/g, 'у')
    .replace(/[һҺ]/g, 'х').replace(/[іІ]/g, 'и')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function buildSearchIndex(model) {
  const rows = [];
  for (const e of model.entities.values()) {
    if (e.kinds.has(KIND.ONTOLOGY)) continue;
    const parts = [];
    for (const l of Object.keys(e.labels)) for (const x of e.labels[l]) parts.push({ t: 'label', lang: l, v: x.value });
    for (const l of Object.keys(e.altLabels)) for (const v of e.altLabels[l]) parts.push({ t: 'alt', lang: l, v });
    for (const l of Object.keys(e.definitions)) for (const x of e.definitions[l]) parts.push({ t: 'def', lang: l, v: x.value });
    parts.push({ t: 'iri', lang: '', v: e.local });
    rows.push({ iri: e.iri, parts, folded: parts.map((p) => fold(p.v)) });
  }
  return rows;
}

/** расстояние Левенштейна с ранним выходом */
function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1);
  const cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let best = cur[0];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

export function search(model, query, { fuzzy = false, limit = 200 } = {}) {
  const q = fold(query || '');
  if (!q) return [];
  const out = [];
  for (const row of model.searchIndex) {
    let bestScore = 0, bestPart = null;
    for (let i = 0; i < row.parts.length; i++) {
      const f = row.folded[i];
      const p = row.parts[i];
      let score = 0;
      const idx = f.indexOf(q);
      if (idx === 0) score = 100;
      else if (idx > 0) score = 70;
      else if (fuzzy && q.length >= 4) {
        // нестрогое совпадение по словам (опечатки в казахских метках)
        for (const w of f.split(' ')) {
          if (Math.abs(w.length - q.length) > 2) continue;
          const d = lev(q, w, Math.max(1, Math.floor(q.length / 4)));
          if (d <= Math.max(1, Math.floor(q.length / 4))) { score = Math.max(score, 45 - d * 5); }
        }
      }
      if (!score) continue;
      if (p.t === 'alt') score -= 8;
      if (p.t === 'def') score -= 30;
      if (p.t === 'iri') score -= 20;
      if (score > bestScore) { bestScore = score; bestPart = p; }
    }
    if (bestScore > 0) out.push({ iri: row.iri, score: bestScore, hit: bestPart });
  }
  out.sort((a, b) => b.score - a.score
    || (model.entities.get(a.iri).local).localeCompare(model.entities.get(b.iri).local));
  return out.slice(0, limit);
}

export { fold as foldText };
