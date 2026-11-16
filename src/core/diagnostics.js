/**
 * Раздел 5.5 ТЗ — диагностика качества.
 * Каждая проверка: счётчик + список сущностей с переходом.
 * Эвристики («предположение») в релиз 1 не входят.
 */
import { DataFactory } from 'n3';
import { KIND, localName, nsOf } from './model.js';

const { namedNode } = DataFactory;
import { NS } from './profile.js';

const SEV = { ERROR: 'error', WARN: 'warn', INFO: 'info' };

const BCP47_OK = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
// теги, которые в корпусе строительных онтологий РК встречаются ошибочно
const KNOWN_BAD_TAGS = { kz: 'kk', kaz: 'kk', rus: 'ru', eng: 'en', ru_RU: 'ru' };

function t(ru, en, kk) { return { ru, en, kk: kk || ru }; }

export function runDiagnostics(model) {
  const P = model.profile;
  const E = model.entities;
  const checks = [];
  const add = (c) => { c.count = c.items.length; checks.push(c); return c; };

  const classes = model.nsClasses;                     // именованные классы основного неймспейса
  const nsSet = new Set(classes.map((e) => e.iri));
  const terms = classes.filter((e) => e.isTerm);
  const structural = classes.filter((e) => !e.isTerm);
  const props = [...E.values()].filter((e) =>
    !e.external && (e.kinds.has(KIND.OBJECT_PROPERTY) || e.kinds.has(KIND.DATA_PROPERTY)));
  const shapes = [...E.values()].filter((e) => e.kinds.has(KIND.SHAPE));
  // если признак «термин» в онтологии не выражен (нет ни dcterms:identifier,
  // ни коллекций, ни skos:Concept), проверки терминов применяются ко всем классам
  const scope = terms.length ? terms : classes;
  const collections = model.collections;

  const internalParents = (e) => e.parents.filter((p) => nsSet.has(p));

  // Второй счёт — по всем узлам с rdf:type owl:Class, включая анонимные выражения
  // и внешние IRI. Эксперту показывается первый (именованные классы неймспейса),
  // второй выводится рядом, чтобы числа не путали при сверке с rdflib.
  const allClassNodes = allOwlClassNodes(model);
  const hasSubClass = new Set();
  const hasLabel = new Set();
  for (const q of model.store.getQuads(null, namedNode(NS.rdfs + 'subClassOf'), null, null)) hasSubClass.add(nodeKey(q.subject));
  for (const lp of P.labelProperties) {
    for (const q of model.store.getQuads(null, namedNode(lp), null, null)) hasLabel.add(nodeKey(q.subject));
  }
  const allNoParent = allClassNodes.filter((k) => !hasSubClass.has(k)).length;
  const allNoLabel = allClassNodes.filter((k) => !hasLabel.has(k)).length;
  const rootSet = new Set(P.rootClasses || []);
  const SCOPE_NOTE = t('Счёт по именованным классам неймспейса онтологии.', 'Counted over named classes in the ontology namespace.');

  // ------------------------------------------------ файлы
  add({
    id: 'parse-errors', group: 'files', severity: SEV.ERROR,
    title: t('Файлы, которые не удалось разобрать', 'Files that failed to parse', 'Талданбаған файлдар'),
    explain: t('Файл с синтаксической ошибкой Turtle не загружается целиком — ни один его триплет не попал в граф, и все числа ниже посчитаны без него. Исправьте указанную строку и откройте файл снова.',
      'A file with a Turtle syntax error is dropped entirely: none of its triples are in the graph and every figure below excludes it.'),
    items: model.parseErrors.map((x) => ({ iri: null, label: x.file, detail: x.message })),
  });

  // ------------------------------------------------ структура
  add({
    id: 'multiple-roots', group: 'structure', severity: model.nsRoots.length > 1 ? SEV.WARN : SEV.INFO,
    title: t('Корней иерархии', 'Hierarchy roots', 'Иерархия түбірлері'),
    explain: t(
      'Класс без родителя внутри онтологии считается корнем. Обычно корень должен быть один; несколько корней означают, что часть ветвей не подключена к общему предку.',
      'A class with no internal parent is a root. Normally there should be exactly one.'),
    items: model.nsRoots.map((e) => ({ iri: e.iri })),
  });

  add({
    id: 'no-parent', group: 'structure', severity: SEV.WARN,
    title: t('Классы без родителя', 'Classes without a parent', 'Аталық класы жоқ кластар'),
    explain: t(
      'Кроме объявленных корней (список rootClasses в профиле), каждый класс должен иметь родителя внутри онтологии — rdfs:subClassOf или skos:broader. Класс-сирота не попадает ни в одну ветвь и не виден эксперту при обходе иерархии.',
      'Apart from the declared root, every class should have a parent; orphans never appear when walking the hierarchy.'),
    items: model.nsRoots.filter((e) => !rootSet.has(e.local)).map((e) => ({ iri: e.iri })),
    scope: SCOPE_NOTE,
    alt: { label: t('по всем owl:Class, включая анонимные и внешние', 'over all owl:Class incl. anonymous and external'), count: allNoParent },
  });

  // циклы
  const cyc = [];
  for (const e of classes) {
    const seen = new Set([e.iri]);
    const stack = [...internalParents(e)];
    while (stack.length) {
      const cur = stack.pop();
      if (cur === e.iri) { cyc.push(e.iri); break; }
      if (seen.has(cur)) continue;
      seen.add(cur);
      const ce = E.get(cur);
      if (ce) stack.push(...internalParents(ce));
    }
  }
  add({
    id: 'subclass-cycles', group: 'structure', severity: SEV.ERROR,
    title: t('Циклы subClassOf', 'subClassOf cycles', 'subClassOf циклдері'),
    explain: t('Цикл в иерархии делает онтологию неконсистентной для ризонера и ломает вычисление глубины.',
      'A cycle makes the ontology inconsistent for a reasoner.'),
    items: [...new Set(cyc)].map((iri) => ({ iri })),
  });

  add({
    id: 'multi-parent', group: 'structure', severity: SEV.INFO,
    title: t('Несколько родителей', 'Multiple parents', 'Бірнеше аталық класс'),
    explain: t('Не ошибка, но список стоит просмотреть: множественное наследование часто появляется случайно при слиянии версий.',
      'Not an error, but worth reviewing: multiple inheritance often appears by accident when merging versions.'),
    items: classes.filter((e) => internalParents(e).length > 1)
      .map((e) => ({ iri: e.iri, detail: internalParents(e).map((p) => E.get(p).curie).join(', ') })),
  });

  add({
    id: 'structural-without-children', group: 'structure', severity: SEV.WARN,
    title: t('Структурные классы без потомков', 'Structural classes with no subclasses', 'Ұрпағы жоқ құрылымдық кластар'),
    explain: t('Структурный класс существует, чтобы собирать под собой термины. Пустой структурный класс либо лишний, либо термины к нему не привязаны.',
      'A structural class exists to group terms; an empty one is either redundant or its terms were not attached.'),
    items: structural.filter((e) => e.children.length === 0).map((e) => ({ iri: e.iri })),
  });

  add({
    id: 'empty-collections', group: 'structure', severity: SEV.WARN,
    title: t('Пустые коллекции', 'Empty collections', 'Бос коллекциялар'),
    explain: t('skos:Collection без skos:member — тематический блок, в который не попал ни один термин.',
      'A skos:Collection with no members is a thematic block that received no terms.'),
    items: collections.filter((c) => c.members.length === 0).map((c) => ({ iri: c.iri })),
  });

  if (collections.length) {
    add({
      id: 'terms-outside-collections', group: 'structure', severity: SEV.WARN,
      title: t('Термины вне всех блоков', 'Terms outside all collections', 'Ешбір блокқа кірмейтін терминдер'),
      explain: t('Термин, не входящий ни в одну коллекцию, не виден эксперту при проверке по блокам.',
        'A term in no collection is invisible to an expert reviewing block by block.'),
      items: terms.filter((e) => e.collections.length === 0).map((e) => ({ iri: e.iri })),
    });
    add({
      id: 'terms-in-several-collections', group: 'structure', severity: SEV.WARN,
      title: t('Термины в нескольких блоках', 'Terms in several collections', 'Бірнеше блоктағы терминдер'),
      explain: t('По правилу пакета термин входит ровно в одну коллекцию; иначе счёт терминов в таблице блоков не сойдётся.',
        'Package rule: exactly one collection per term, otherwise block counts will not match.'),
      items: terms.filter((e) => e.collections.length > 1)
        .map((e) => ({ iri: e.iri, detail: e.collections.map((c) => E.get(c).curie).join(', ') })),
    });
  }

  // ------------------------------------------------ метки
  for (const lang of P.languages) {
    add({
      id: 'missing-label-' + lang, group: 'labels', severity: lang === P.languages[0] ? SEV.ERROR : SEV.WARN,
      title: t(`Нет метки на «${lang}»`, `No label in "${lang}"`, `«${lang}» тілінде белгі жоқ`),
      explain: t(`Сущность без prefLabel на языке ${lang} в интерфейсе показывается меткой другого языка или локальным именем IRI.`,
        `An entity with no prefLabel in ${lang} falls back to another language or to the local IRI name.`),
      items: classes.filter((e) => !(e.labels[lang] && e.labels[lang].length)).map((e) => ({ iri: e.iri })),
    });
  }

  add({
    id: 'no-label-at-all', group: 'labels', severity: SEV.ERROR,
    title: t('Классы вовсе без метки', 'Classes with no label at all', 'Мүлдем белгісіз кластар'),
    explain: t('Такой класс показывается локальным именем IRI и для эксперта-предметника нечитаем.',
      'Such a class is displayed by its local IRI name and is unreadable for a domain expert.'),
    items: classes.filter((e) => Object.keys(e.labels).length === 0).map((e) => ({ iri: e.iri })),
    scope: SCOPE_NOTE,
    alt: { label: t('по всем owl:Class, включая анонимные и внешние', 'over all owl:Class incl. anonymous and external'), count: allNoLabel },
  });

  const multiLabel = [];
  for (const e of [...classes, ...props]) {
    for (const lang of Object.keys(e.labels)) {
      const prefOnly = e.labels[lang].filter((x) => x.prop === P.labelProperties[0]);
      if (prefOnly.length > 1) {
        multiLabel.push({ iri: e.iri, detail: `${lang}: ` + prefOnly.map((x) => '«' + x.value + '»').join(', ') });
      }
    }
  }
  add({
    id: 'multiple-preflabel', group: 'labels', severity: SEV.ERROR,
    title: t('Более одной prefLabel на язык', 'More than one prefLabel per language', 'Бір тілге бірнеше prefLabel'),
    explain: t('SKOS допускает ровно одну skos:prefLabel на язык. Вторая метка должна быть skos:altLabel.',
      'SKOS allows exactly one skos:prefLabel per language; the second one belongs in skos:altLabel.'),
    items: multiLabel,
  });

  const byLabel = new Map();
  for (const e of [...classes, ...props]) {
    for (const lang of Object.keys(e.labels)) {
      for (const x of e.labels[lang]) {
        const k = lang + '|' + x.value.trim().toLowerCase();
        (byLabel.get(k) || byLabel.set(k, []).get(k)).push(e.iri);
      }
    }
  }
  const dupLabel = [];
  for (const [k, list] of byLabel) {
    const uniq = [...new Set(list)];
    if (uniq.length > 1) {
      const [lang, val] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)];
      for (const iri of uniq) dupLabel.push({ iri, detail: `@${lang} «${val}» — ещё ${uniq.length - 1}` });
    }
  }
  const firstLang = P.languages[0];
  const dupPairsFirst = [...byLabel.entries()].filter(([k, l]) => k.startsWith(firstLang + '|') && new Set(l).size > 1).length;
  add({
    id: 'duplicate-label', group: 'labels', severity: SEV.WARN,
    scope: t('Счёт — сущности с совпадающей меткой на любом языке.', 'Entities sharing a label in any language.'),
    alt: { label: t(`групп совпадений только на @${firstLang}`, `duplicate groups in @${firstLang} only`), count: dupPairsFirst },
    title: t('Одинаковая метка у разных сущностей', 'Same label on different entities', 'Әртүрлі мәндердегі бірдей белгі'),
    explain: t('Потенциальные дубли терминов. В SKOS одинаковая prefLabel у двух концептов допустима формально, но для терминологического ресурса это почти всегда ошибка.',
      'Potential duplicate terms.'),
    items: dupLabel,
  });

  const labelIsDef = [];
  for (const e of classes) {
    for (const lang of Object.keys(e.labels)) {
      for (const x of e.labels[lang]) {
        if (x.value.length > 80 || /[.;]\s/.test(x.value)) {
          labelIsDef.push({ iri: e.iri, detail: `@${lang}, ${x.value.length} симв.: ${x.value.slice(0, 90)}…` });
        }
      }
    }
  }
  add({
    id: 'label-looks-like-definition', group: 'labels', severity: SEV.WARN,
    title: t('Метка похожа на определение', 'Label looks like a definition', 'Белгі анықтамаға ұқсайды'),
    explain: t('Метка длиннее 80 символов или содержит несколько предложений — типичный признак перепутанных полей «термин» и «определение».',
      'A label longer than 80 characters or containing several sentences usually means the term and definition fields were swapped.'),
    items: labelIsDef,
  });

  // языковые теги
  const tagCount = new Map();
  const badTagItems = [];
  const emptyTagItems = [];
  const textProps = new Set([...P.labelProperties, ...P.altLabelProperties,
    ...P.definitionProperties, ...Object.keys(P.noteProperties)]);
  const labelPropSet = new Set(P.labelProperties);
  let badTagInLabels = 0;
  for (const q of model.store.getQuads(null, null, null, null)) {
    if (q.object.termType !== 'Literal') continue;
    const prop = q.predicate.value;
    const owner = q.subject.termType === 'NamedNode' ? q.subject.value : findShapeOwner(model, q.subject);
    const value = q.object.value;
    const tag = q.object.language || '';
    if (tag) tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
    if (!tag) {
      if (textProps.has(prop) && q.object.datatype.value.endsWith('#string')) {
        emptyTagItems.push({ iri: owner, detail: `${shortProp(prop)}: ${value.slice(0, 70)}` });
      }
    } else if (KNOWN_BAD_TAGS[tag] || !BCP47_OK.test(tag)) {
      if (labelPropSet.has(prop)) badTagInLabels++;
      badTagItems.push({
        iri: owner, tag,
        detail: `${shortProp(prop)} @${tag}${KNOWN_BAD_TAGS[tag] ? ' → должно быть @' + KNOWN_BAD_TAGS[tag] : ''}: ${value.slice(0, 70)}`,
        literal: value, prop,
      });
    }
  }
  add({
    id: 'invalid-language-tag', group: 'labels', severity: SEV.ERROR,
    title: t('Недопустимый языковой тег', 'Invalid language tag', 'Жарамсыз тіл тегі'),
    explain: t('Казахский язык по BCP 47 обозначается тегом kk. Тег kz принадлежит домену, а не языку: запрос «дай казахскую метку» вернёт пустой результат.',
      'Kazakh is kk in BCP 47; kz is a country domain, not a language. A query for Kazakh labels returns nothing.'),
    items: badTagItems,
    scope: t('Счёт по всем литералам графа.', 'Counted over all literals in the graph.'),
    alt: { label: t('только в метках', 'in labels only'), count: badTagInLabels },
  });
  add({
    id: 'empty-language-tag', group: 'labels', severity: SEV.WARN,
    title: t('Литерал без языкового тега', 'Literal without a language tag', 'Тіл тегісіз литерал'),
    explain: t('Текстовый литерал без тега не попадёт ни в один языковой слой.',
      'An untagged text literal belongs to no language layer.'),
    items: emptyTagItems,
  });

  const tagFamilies = new Map();
  for (const tag of tagCount.keys()) {
    const canon = KNOWN_BAD_TAGS[tag] || tag.split('-')[0];
    (tagFamilies.get(canon) || tagFamilies.set(canon, new Set()).get(canon)).add(tag);
  }
  const mixed = [...tagFamilies.entries()].filter(([, s]) => s.size > 1);
  add({
    id: 'mixed-language-tags', group: 'labels', severity: SEV.ERROR,
    title: t('Смешение тегов одного языка', 'Mixed tags for one language', 'Бір тілдің тегтері аралас'),
    explain: t('Один и тот же язык записан разными тегами — часть данных выпадет из любого языкового запроса.',
      'One language written with different tags — part of the data drops out of any language query.'),
    items: mixed.map(([canon, s]) => ({
      iri: null, label: canon,
      detail: [...s].map((x) => `@${x} — ${tagCount.get(x)}`).join(' · '),
    })),
  });

  const bothLabelProps = classes.filter((e) => {
    const used = new Set();
    for (const lang of Object.keys(e.labels)) for (const x of e.labels[lang]) used.add(x.prop);
    return used.size > 1;
  });
  add({
    id: 'mixed-label-properties', group: 'labels', severity: SEV.WARN,
    title: t('rdfs:label и skos:prefLabel вместе', 'rdfs:label and skos:prefLabel together', 'rdfs:label және skos:prefLabel бірге'),
    explain: t('Смешение двух свойств меток означает, что часть инструментов увидит одну метку, часть — другую.',
      'Mixing the two label properties means different tools will see different labels.'),
    items: bothLabelProps.map((e) => ({ iri: e.iri })),
  });

  // ------------------------------------------------ определения
  for (const lang of (P.definitionLanguages || P.languages.slice(0, 2))) {
    add({
      id: 'missing-definition-' + lang, group: 'definitions', severity: SEV.WARN,
      title: t(`Нет определения на «${lang}»`, `No definition in "${lang}"`, `«${lang}» тілінде анықтама жоқ`),
      explain: t('Термин без определения эксперт проверить не может — ему нечего сверять с нормативным документом.',
        'A term with no definition cannot be validated against a source document.'),
      items: scope.filter((e) => !(e.definitions[lang] && e.definitions[lang].length)).map((e) => ({ iri: e.iri })),
    });
  }
  add({
    id: 'no-definition-at-all', group: 'definitions', severity: SEV.WARN,
    title: t('Классы вовсе без определения', 'Classes with no definition', 'Анықтамасы жоқ кластар'),
    explain: t('Ни skos:definition, ни rdfs:comment ни на одном языке.', 'Neither skos:definition nor rdfs:comment in any language.'),
    items: classes.filter((e) => Object.keys(e.definitions).length === 0).map((e) => ({ iri: e.iri })),
  });

  const byDef = new Map();
  for (const e of classes) {
    for (const lang of Object.keys(e.definitions)) {
      for (const x of e.definitions[lang]) {
        const k = lang + '|' + x.value.trim().toLowerCase();
        (byDef.get(k) || byDef.set(k, []).get(k)).push(e.iri);
      }
    }
  }
  const dupDef = [];
  for (const [k, list] of byDef) {
    const uniq = [...new Set(list)];
    if (uniq.length > 1) for (const iri of uniq) dupDef.push({ iri, detail: `@${k.slice(0, k.indexOf('|'))}, повторов: ${uniq.length}` });
  }
  add({
    id: 'duplicate-definition', group: 'definitions', severity: SEV.WARN,
    title: t('Одинаковое определение у разных сущностей', 'Same definition on different entities', 'Бірдей анықтамалар'),
    explain: t('Почти всегда — копирование строки при сборке или нераспознанный дубль термина.',
      'Almost always a copy-paste during the build or an unrecognised duplicate term.'),
    items: dupDef,
  });

  const shortDefs = [];
  const selfDefs = [];
  for (const e of scope) {
    for (const lang of Object.keys(e.definitions)) {
      for (const x of e.definitions[lang]) {
        if (x.value.trim().length < P.minDefinitionLength) {
          shortDefs.push({ iri: e.iri, detail: `@${lang}, ${x.value.trim().length} симв.: «${x.value}»` });
        }
        const lbl = (e.labels[lang] && e.labels[lang][0]) ? e.labels[lang][0].value : null;
        if (lbl && x.value.trim().toLowerCase() === lbl.trim().toLowerCase()) {
          selfDefs.push({ iri: e.iri, detail: `@${lang}: определение повторяет метку` });
        }
      }
    }
  }
  add({
    id: 'short-definition', group: 'definitions', severity: SEV.WARN,
    title: t(`Определение короче ${P.minDefinitionLength} символов`, `Definition shorter than ${P.minDefinitionLength} chars`, `Анықтама тым қысқа`),
    explain: t('Слишком короткое определение обычно означает обрывок строки при переносе из таблицы.',
      'A very short definition usually means a truncated cell during import.'),
    items: shortDefs,
  });
  add({
    id: 'definition-equals-label', group: 'definitions', severity: SEV.ERROR,
    title: t('Определение повторяет метку', 'Definition repeats the label', 'Анықтама белгіні қайталайды'),
    explain: t('Поля «термин» и «определение» перепутаны или определение не заполнено.',
      'The term and definition fields were swapped, or the definition was never filled in.'),
    items: selfDefs,
  });

  // ------------------------------------------------ провенанс
  add({
    id: 'no-provenance', group: 'provenance', severity: SEV.ERROR,
    title: t('Термины без провенанса', 'Terms without provenance', 'Дереккөзі жоқ терминдер'),
    explain: t('Нет ни rdfs:isDefinedBy, ни dcterms:source. На вопрос «какой документ определяет термин» онтология ответить не может.',
      'Neither rdfs:isDefinedBy nor dcterms:source: the ontology cannot answer "which document defines this term".'),
    items: scope.filter((e) => e.provenance.length === 0).map((e) => ({ iri: e.iri })),
  });

  const litProv = [];
  for (const e of E.values()) {
    for (const p of e.provenance) if (!p.isIri) litProv.push({ iri: e.iri, detail: `${shortProp(p.prop)}: «${p.value}»` });
  }
  add({
    id: 'provenance-literal', group: 'provenance', severity: SEV.ERROR,
    title: t('Провенанс задан литералом', 'Provenance given as a literal', 'Дереккөз литералмен берілген'),
    explain: t('Строка вместо IRI документа: нельзя спросить «все термины документа X», нельзя показать статус и год документа, нельзя обнаружить, что один документ записан в разных вариантах написания.',
      'A string instead of a document IRI: you cannot query "all terms of document X", show its status, or detect spelling variants.'),
    items: litProv,
  });

  const docIriMissing = [];
  const docNoStatus = [];
  const statusProp = [...E.values()].length ? findStatusProp(model) : null;
  for (const e of E.values()) {
    for (const p of e.provenance) {
      if (!p.isIri) continue;
      const d = E.get(p.value);
      if (!d || (d.types.size === 0 && d.literals.length === 0)) {
        docIriMissing.push({ iri: e.iri, detail: p.value });
      } else if (statusProp && !d.literals.some((x) => x.prop === statusProp)) {
        docNoStatus.push({ iri: p.value });
      }
    }
  }
  add({
    id: 'provenance-iri-undescribed', group: 'provenance', severity: SEV.WARN,
    title: t('Документ-источник не описан в графе', 'Source document not described in the graph', 'Дереккөз құжат сипатталмаған'),
    explain: t('IRI документа указан, но самого документа (кода, названия, статуса) в графе нет — карточка термина покажет голый IRI.',
      'The document IRI is given but the document itself is absent from the graph.'),
    items: docIriMissing,
  });
  add({
    id: 'document-without-status', group: 'provenance', severity: SEV.WARN,
    title: t('Документ без статуса', 'Document without status', 'Мәртебесі жоқ құжат'),
    explain: t('Не указано, действует документ или отменён. Эксперт не может оценить, актуален ли термин.',
      'It is not stated whether the document is in force or withdrawn.'),
    items: dedupe(docNoStatus),
  });

  // ------------------------------------------------ свойства
  add({
    id: 'property-no-domain-range', group: 'properties', severity: SEV.WARN,
    title: t('Свойства без домена или диапазона', 'Properties without domain or range', 'Домені не диапазоны жоқ қасиеттер'),
    explain: t('Без rdfs:domain и rdfs:range свойство не даёт ризонеру никакой информации и не проверяется SHACL-ом по классу.',
      'Without domain and range a property carries no information for a reasoner.'),
    items: props.filter((e) => e.domain.length === 0 || e.range.length === 0)
      .map((e) => ({ iri: e.iri, detail: (e.domain.length ? '' : 'нет domain ') + (e.range.length ? '' : 'нет range') })),
  });
  add({
    id: 'property-no-label', group: 'properties', severity: SEV.WARN,
    title: t('Свойства без метки', 'Properties without a label', 'Белгісі жоқ қасиеттер'),
    explain: t('В карточке термина свойство будет показано локальным именем IRI.',
      'The property will be shown by its local IRI name.'),
    items: props.filter((e) => Object.keys(e.labels).length === 0).map((e) => ({ iri: e.iri })),
  });

  const usedPredicates = new Set();
  for (const q of model.store.getQuads(null, null, null, null)) usedPredicates.add(q.predicate.value);
  add({
    id: 'property-unused', group: 'properties', severity: SEV.INFO,
    title: t('Свойства объявлены, но не используются', 'Properties declared but never used', 'Жарияланған, бірақ қолданылмаған қасиеттер'),
    explain: t('Свойство объявлено, но ни разу не встречается как предикат ни в TBox, ни в ABox. Не ошибка, но в статье такое свойство нельзя называть «используемым».',
      'Declared but never used as a predicate. Not an error, but such a property cannot be called "used" in a paper.'),
    items: props.filter((e) => !usedPredicates.has(e.iri)).map((e) => ({ iri: e.iri })),
  });

  const inverseProp = NS.owl + 'inverseOf';
  const invPairs = new Map();
  for (const e of props) for (const o of e.outgoing) if (o.prop === inverseProp) invPairs.set(e.iri, o.target);
  const invUnpaired = [];
  for (const [a, b] of invPairs) if (invPairs.get(b) !== a) invUnpaired.push({ iri: a, detail: 'нет обратного owl:inverseOf у ' + (E.get(b) ? E.get(b).curie : b) });
  add({
    id: 'inverse-without-pair', group: 'properties', severity: SEV.INFO,
    title: t('Инверсы без пары', 'Inverses without a pair', 'Жұбы жоқ инверстер'),
    explain: t('owl:inverseOf объявлен в одну сторону.', 'owl:inverseOf declared in one direction only.'),
    items: invUnpaired,
  });

  // ------------------------------------------------ внешние ссылки
  const extRefs = new Map();
  for (const e of classes) {
    for (const p of e.parents) {
      const pe = E.get(p);
      if (pe && pe.external) {
        const key = pe.iri;
        if (!extRefs.has(key)) extRefs.set(key, { iri: key, declared: pe.types.size > 0, from: [] });
        extRefs.get(key).from.push(e.iri);
      }
    }
  }
  add({
    id: 'external-not-declared', group: 'external', severity: SEV.WARN,
    title: t('Внешние классы без заглушки', 'External classes not declared as stubs', 'Сыртқы кластар жарияланбаған'),
    explain: t('Мост ведёт к IRI внешней онтологии, который в файле не объявлен даже как owl:Class. Без заглушки и без owl:imports такой класс для ризонера не существует.',
      'A bridge points at an external IRI that is not even declared as owl:Class in the file.'),
    items: [...extRefs.values()].filter((x) => !x.declared)
      .map((x) => ({ iri: x.iri, detail: `используется ${x.from.length} раз` })),
  });

  const imports = [];
  for (const o of model.ontologies) {
    for (const x of o.outgoing) if (x.prop === NS.owl + 'imports') imports.push({ iri: o.iri, detail: x.target });
  }
  add({
    id: 'owl-imports', group: 'external', severity: SEV.WARN,
    title: t('owl:imports в файле', 'owl:imports in the file', 'Файлдағы owl:imports'),
    explain: t('SKOS опубликован как OWL Full: его импорт выводит онтологию из профиля OWL 2 DL и ломает проверку в HermiT. Импортировать словарь не нужно — достаточно использовать его IRI.',
      'SKOS is published as OWL Full; importing it takes the ontology out of OWL 2 DL and breaks HermiT.'),
    items: imports,
  });

  // ------------------------------------------------ SHACL
  add({
    id: 'shape-no-target', group: 'shacl', severity: SEV.WARN,
    title: t('Шейпы без targetClass', 'Shapes without targetClass', 'targetClass жоқ шейптер'),
    explain: t('Шейп без цели никогда не применяется к данным.', 'A shape with no target is never applied.'),
    items: shapes.filter((e) => !e.shapeTarget && !e.incoming.some((i) => i.prop === NS.sh + 'property'))
      .map((e) => ({ iri: e.iri })),
  });
  add({
    id: 'shape-todo', group: 'shacl', severity: SEV.INFO,
    title: t('Шейпы-заготовки (TODO)', 'Placeholder shapes (TODO)', 'Дайындама шейптер (TODO)'),
    explain: t('Комментарий содержит TODO или [VERIFY]: ограничение ещё не формализовано, числовой порог не подтверждён.',
      'The comment contains TODO or [VERIFY]: the constraint is not yet formalised.'),
    items: shapes.filter((e) => e.literals.some((x) => /TODO|\[VERIFY/i.test(x.value)))
      .map((e) => ({ iri: e.iri, detail: (e.literals.find((x) => /TODO|\[VERIFY/i.test(x.value)) || {}).value })),
  });

  const shapePathMissing = [];
  for (const q of model.store.getQuads(null, namedNode(NS.sh + 'path'), null, null)) {
    if (q.object.termType !== 'NamedNode') continue;
    const target = E.get(q.object.value);
    if (!target || !(target.kinds.has(KIND.OBJECT_PROPERTY) || target.kinds.has(KIND.DATA_PROPERTY))) {
      const owner = findShapeOwner(model, q.subject);
      shapePathMissing.push({ iri: owner, detail: 'sh:path → ' + (E.get(q.object.value) ? E.get(q.object.value).curie : q.object.value) });
    }
  }
  add({
    id: 'shape-path-unknown', group: 'shacl', severity: SEV.ERROR,
    title: t('Шейп ссылается на несуществующее свойство', 'Shape references an undeclared property', 'Шейп жоқ қасиетке сілтейді'),
    explain: t('sh:path указывает на IRI, не объявленный как свойство: ограничение молча не сработает.',
      'sh:path points at an IRI that is not declared as a property; the constraint silently never fires.'),
    items: shapePathMissing,
  });

  return checks;
}

function nodeKey(term) {
  return (term.termType === 'BlankNode' ? '_:' : '') + term.value;
}

/** Все узлы с rdf:type owl:Class — именованные и анонимные (как set(g.subjects(RDF.type, OWL.Class)) в rdflib). */
export function allOwlClassNodes(model) {
  const seen = new Set();
  for (const q of model.store.getQuads(null, namedNode(NS.rdf + 'type'), namedNode(NS.owl + 'Class'), null)) {
    seen.add(nodeKey(q.subject));
  }
  return [...seen];
}

function findShapeOwner(model, node, depth = 0) {
  if (node.termType === 'NamedNode') return node.value;
  if (depth > 8) return null;
  for (const q of model.store.getQuads(null, null, node, null)) {
    if (q.subject.termType === 'NamedNode') return q.subject.value;
    return findShapeOwner(model, q.subject, depth + 1);
  }
  return null;
}

function findStatusProp(model) {
  for (const e of model.entities.values()) {
    if (/documentStatus$/i.test(e.iri)) return e.iri;
  }
  return null;
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((i) => { const k = i.iri + '|' + (i.detail || ''); if (seen.has(k)) return false; seen.add(k); return true; });
}

export function shortProp(iri) {
  for (const [p, ns] of Object.entries(NS)) if (iri.startsWith(ns)) return p + ':' + iri.slice(ns.length);
  return localName(iri);
}

// --------------------------------------------------------------------------
//  Метрики (та же панель)
// --------------------------------------------------------------------------
export function computeMetrics(model) {
  const E = model.entities;
  const P = model.profile;
  const classes = model.nsClasses;
  const terms = classes.filter((e) => e.isTerm);
  const structural = classes.filter((e) => !e.isTerm);
  const objProps = [...E.values()].filter((e) => !e.external && e.kinds.has(KIND.OBJECT_PROPERTY));
  const datProps = [...E.values()].filter((e) => !e.external && e.kinds.has(KIND.DATA_PROPERTY));
  const allOwlClasses = allOwlClassNodes(model);
  const individuals = [...E.values()].filter((e) => e.types.has(NS.owl + 'NamedIndividual'));
  const punned = individuals.filter((e) => e.types.has(NS.owl + 'Class')).length;
  const labelTags = new Map();
  for (const lp of P.labelProperties) {
    for (const q of model.store.getQuads(null, namedNode(lp), null, null)) {
      if (q.object.termType !== 'Literal') continue;
      const tg = q.object.language || '(без тега)';
      labelTags.set(tg, (labelTags.get(tg) || 0) + 1);
    }
  }

  const bridges = new Map();
  for (const e of classes) {
    for (const p of e.parents) {
      const pe = E.get(p);
      if (pe && pe.external) {
        const ns = nsOf(pe.iri);
        bridges.set(ns, (bridges.get(ns) || 0) + 1);
      }
    }
  }

  const labelCounts = {};
  for (const lang of P.languages) {
    labelCounts[lang] = classes.filter((e) => e.labels[lang] && e.labels[lang].length).length;
  }
  const defCounts = {};
  for (const lang of P.languages) {
    defCounts[lang] = classes.filter((e) => e.definitions[lang] && e.definitions[lang].length).length;
  }

  const depths = classes.map((e) => e.nsDepth);
  const maxDepth = depths.length ? Math.max(...depths) : 0;
  const avgDepth = depths.length ? (depths.reduce((a, b) => a + b, 0) / depths.length) : 0;

  // путь максимальной глубины
  let deepest = null;
  for (const e of classes) if (e.nsDepth === maxDepth) { deepest = e; break; }
  const path = [];
  let cur = deepest;
  const guard = new Set();
  while (cur && !guard.has(cur.iri)) {
    guard.add(cur.iri);
    path.unshift(cur);
    const ps = cur.parents.map((p) => E.get(p)).filter((p) => p && p.ns === model.mainNs && p.nsDepth);
    ps.sort((a, b) => b.nsDepth - a.nsDepth);
    cur = ps[0];
  }

  const tagCount = new Map();
  for (const q of model.store.getQuads(null, null, null, null)) {
    if (q.object.termType === 'Literal' && q.object.language) {
      tagCount.set(q.object.language, (tagCount.get(q.object.language) || 0) + 1);
    }
  }

  const rows = [
    { id: 'triples', label: t('Триплетов', 'Triples'), value: model.tripleCount },
    { id: 'files', label: t('Файлов загружено', 'Files loaded'), value: model.files.length,
      detail: model.files.map((f) => `${f.name}: ${f.triples}`).join(' · ') },
    { id: 'classes_ns', label: t('Классов в неймспейсе', 'Named classes in the namespace'), value: classes.length,
      detail: model.mainNs },
    ...(model.classes.length !== classes.length ? [{ id: 'classes_other_ns',
      label: t('Классов в соседних неймспейсах пакета', 'Classes in sibling package namespaces'),
      value: model.classes.length - classes.length }] : []),
    { id: 'classes_all', label: t('Всего owl:Class (с анонимными и внешними)', 'Total owl:Class incl. anonymous and external'), value: allOwlClasses.length, muted: true },
    { id: 'individuals', label: t('owl:NamedIndividual', 'owl:NamedIndividual'), value: individuals.length,
      detail: individuals.length ? t(`из них паннинг класс + индивид: ${punned}`, `punned class + individual: ${punned}`).ru : null },
    { id: 'terms', label: t('Терминальных классов', 'Term classes'), value: terms.length },
    { id: 'structural', label: t('Структурных классов', 'Structural classes'), value: structural.length },
    { id: 'concepts', label: t('skos:Concept', 'skos:Concept'), value: classes.filter((e) => e.kinds.has(KIND.CONCEPT)).length },
    { id: 'objprops', label: t('Объектных свойств', 'Object properties'), value: objProps.length },
    { id: 'datprops', label: t('Датных свойств', 'Datatype properties'), value: datProps.length },
    { id: 'collections', label: t('Коллекций (блоков)', 'Collections (blocks)'), value: model.collections.length },
    { id: 'bridges', label: t('Мостов к внешним онтологиям', 'Bridges to external ontologies'),
      value: [...bridges.values()].reduce((a, b) => a + b, 0),
      detail: [...bridges.entries()].map(([ns, n]) => `${extLabel(P, ns)}: ${n}`).join(' · ') },
    { id: 'depth', label: t('Глубина макс. / средн.', 'Depth max / avg'),
      value: `${maxDepth} / ${avgDepth.toFixed(2).replace('.', ',')}` },
    { id: 'deepest', label: t('Путь максимальной глубины', 'Deepest path'),
      value: path.map((e) => e.local).join(' → '), wide: true },
  ];
  for (const lang of P.languages) {
    rows.push({ id: 'labels_' + lang, label: t(`Классов с меткой @${lang}`, `Classes with @${lang} label`), value: labelCounts[lang] });
  }
  for (const lang of P.languages.slice(0, 2)) {
    rows.push({ id: 'defs_' + lang, label: t(`Классов с определением @${lang}`, `Classes with @${lang} definition`), value: defCounts[lang] });
  }
  rows.push({
    id: 'label_tags', label: t('Метки по языковым тегам', 'Labels by language tag'),
    value: [...labelTags.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(' · '), wide: true,
  });
  rows.push({
    id: 'tags', label: t('Языковые теги всех литералов', 'Language tags of all literals'),
    value: [...tagCount.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(' · '), wide: true,
  });

  if (model.collections.length) {
    rows.push({
      id: 'collection_sizes', label: t('Размеры блоков', 'Block sizes'), wide: true,
      value: model.collections.map((c) => c.members.length).join('/'),
    });
  }

  // цель — факт
  if (P.targets) {
    for (const r of rows) {
      if (Object.prototype.hasOwnProperty.call(P.targets, r.id)) {
        r.target = P.targets[r.id];
        r.match = String(r.target) === String(r.value);
      }
    }
  }
  return rows;
}

function extLabel(P, ns) {
  const e = P.externalNamespaces[ns];
  return e ? e.label : ns;
}
