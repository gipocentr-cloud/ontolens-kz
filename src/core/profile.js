/**
 * Профиль онтологии (раздел 7 ТЗ).
 * Значения по умолчанию рассчитаны на пакеты авторского коллектива:
 * SKOS-слой поверх OWL, три языка, провенанс через rdfs:isDefinedBy.
 */

export const NS = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  owl: 'http://www.w3.org/2002/07/owl#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  skos: 'http://www.w3.org/2004/02/skos/core#',
  dcterms: 'http://purl.org/dc/terms/',
  dc: 'http://purl.org/dc/elements/1.1/',
  sh: 'http://www.w3.org/ns/shacl#',
  ontolex: 'http://www.w3.org/ns/lemon/ontolex#',
};

export const DEFAULT_PROFILE = {
  id: 'default',
  title: 'Профиль по умолчанию',
  /** Требуемые языки; порядок задаёт порядок показа меток. */
  languages: ['ru', 'kk', 'en'],
  /** Языки, на которых определение обязательно (проверка 5.5). */
  definitionLanguages: ['ru', 'en'],
  /** Свойства меток, в порядке приоритета. */
  labelProperties: [NS.skos + 'prefLabel', NS.rdfs + 'label'],
  altLabelProperties: [NS.skos + 'altLabel', NS.skos + 'hiddenLabel'],
  definitionProperties: [NS.skos + 'definition', NS.rdfs + 'comment'],
  provenanceProperties: [NS.rdfs + 'isDefinedBy', NS.dcterms + 'source'],
  identifierProperties: [NS.dcterms + 'identifier'],
  /** Аннотации-пометки: IRI → человекочитаемая подпись. */
  noteProperties: {
    [NS.skos + 'editorialNote']: { ru: 'редакционная пометка', kk: 'редакциялық белгі', en: 'editorial note' },
    [NS.skos + 'changeNote']: { ru: 'изменение', kk: 'өзгеріс', en: 'change note' },
    [NS.skos + 'historyNote']: { ru: 'историческая справка', kk: 'тарихи анықтама', en: 'history note' },
    [NS.skos + 'scopeNote']: { ru: 'область применения', kk: 'қолдану аясы', en: 'scope note' },
    [NS.rdfs + 'comment']: { ru: 'примечание', kk: 'ескертпе', en: 'comment' },
    [NS.skos + 'example']: { ru: 'пример', kk: 'мысал', en: 'example' },
  },
  /**
   * Человекочитаемый пересказ значений пометок (подстрока → текст).
   * Нужен, чтобы эксперт видел «авторский перевод», а не имя свойства.
   */
  noteBadges: [
    { match: "authors'? translation", ru: 'авторский перевод', kk: 'авторлық аударма', en: "authors' translation" },
    { match: "expert-reviewed", ru: 'экспертная проверка', kk: 'сараптамалық тексеру', en: 'expert-reviewed' },
    { match: "source-attested", ru: 'подтверждён источником', kk: 'дереккөзбен расталған', en: 'source-attested' },
    { match: "merged duplicate", ru: 'объединён дубль', kk: 'қосарлану біріктірілді', en: 'merged duplicate' },
    { match: "definition revised", ru: 'определение исправлено', kk: 'анықтама түзетілді', en: 'definition revised' },
    { match: "submodule", ru: 'субмодуль', kk: 'субмодуль', en: 'submodule' },
    { match: "\\[VERIFY[^\\]]*\\]", ru: 'требует проверки', kk: 'тексеруді қажет етеді', en: 'needs verification' },
  ],
  /** Префиксы внешних онтологий и подписи мостов. */
  externalNamespaces: {
    'http://www.buildingsmart-tech.org/ifcOWL/IFC4#': { prefix: 'ifc', label: 'IFC4 (ifcOWL)' },
    'http://www.opengis.net/ont/geosparql#': { prefix: 'geo', label: 'GeoSPARQL' },
    'http://www.geoscience.org/geocore#': { prefix: 'geocore', label: 'GeoCore' },
    'http://www.w3.org/ns/lemon/ontolex#': { prefix: 'ontolex', label: 'OntoLex' },
    'http://purl.org/dc/terms/': { prefix: 'dcterms', label: 'Dublin Core Terms' },
    'http://www.w3.org/2004/02/skos/core#': { prefix: 'skos', label: 'SKOS' },
  },
  /**
   * Как отличать «структурный» класс от «термина».
   * term: есть dcterms:identifier ИЛИ членство в коллекции.
   */
  termRule: 'identifier-or-collection',
  /** Явный список структурных классов (локальные имена), если правило не годится. */
  structuralClasses: [],
  /** Объявленные корни иерархии: не считаются «классами без родителя». */
  rootClasses: [],
  /** Свойства для счётчиков в метриках. */
  countProperties: {
    legacy: [NS.skos + 'historyNote'],
  },
  /** Минимальная длина определения (проверка 5.5). */
  minDefinitionLength: 20,
  /** Целевые метрики: показатель → значение (для колонки «цель — факт»). */
  targets: null,
  /** Параметры карты и семантического зума (5.3; релиз 1b). */
  map: {
    layout: 'cluster',
    corner: 'bottom-right',
    width: 240,
    height: 180,
    zoomThresholds: [0.4, 0.8, 1.6],
  },
  /** Глубина окрестности по умолчанию. */
  neighbourhoodDepth: 1,
  /** Свойства (IRI), связи по которым не рисуются в окрестности термина: массовые или эвристические. */
  neighbourhoodSkipProperties: [],
  maxNeighbourhoodNodes: 60,
};

const _rxCache = new Map();
/** Скомпилировать шаблон пометки (шаблоны хранятся строками, см. mergeProfile). */
export function rx(pattern) {
  if (pattern instanceof RegExp) return pattern;
  let r = _rxCache.get(pattern);
  if (!r) { r = new RegExp(pattern, 'i'); _rxCache.set(pattern, r); }
  return r;
}

export function mergeProfile(base, override) {
  if (!override) return base;
  const out = JSON.parse(JSON.stringify(base));
  for (const k of Object.keys(override)) {
    const v = override[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      Object.assign(out[k], v);
    } else {
      out[k] = v;
    }
  }
  // профиль в виде {required, optional} (пакеты TimsoOnt-KZ v0.2) → список требуемых языков
  for (const k of ['languages', 'definitionLanguages']) {
    const v = out[k];
    if (v && !Array.isArray(v) && typeof v === 'object') out[k] = Array.isArray(v.required) ? v.required.slice() : base[k];
    else if (!Array.isArray(v)) out[k] = base[k];
  }
  // match всегда хранится строкой: профиль клонируется через JSON,
  // а RegExp такой клон не переживает.
  return out;
}
