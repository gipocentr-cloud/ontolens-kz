/**
 * Экраны корпуса определений (ТЗ v3.1, разделы 5–7):
 *   «Коллизии»     — список, карточка с определениями бок о бок и доказательством, вердикт эксперта;
 *   «Формализация» — род и видовые отличия определения с цитатами из текста;
 *   «Аксиомы»      — несовместимость классов и единственность значения свойства, с основанием.
 *
 * Модуль не знает о DOM-утилитах приложения: их передаёт app.js (makeCorpusUI(deps)).
 */
import { analyseCorpus, KIND_TITLES, KIND_LETTER, proposeGenus } from '../corpus/engine.js';
import { corpusFromFiles, corpusToTurtle, corpusProfile, STATUSES, idPart } from '../corpus/glossary.js';
import { resolveSpec, toSpec } from '../corpus/spec.js';
import { diffWords, foldText, termMentions } from '../corpus/normalize.js';
import { makeServerStore, makeLocalStore, applyWork } from '../corpus/store.js';
import {
  conflictKey, sourceText, SEVERITY_RU, STEP_RU, definitionsTurtle, axiomsTurtle, conflictsTurtle,
  conflictsCsvRows, conflictsMarkdown,
} from '../corpus/export.js';

export const CONFLICT_VERDICTS = [
  { code: 'conflict', ru: 'Коллизия подтверждена', tip: 'Определения действительно противоречат друг другу', color: '#A33A32' },
  { code: 'compatible', ru: 'Противоречия нет', tip: 'Определения совместимы (например, разная область применения)', color: '#3F7A4E' },
  { code: 'same_concept', ru: 'Одно понятие — синонимы', tip: 'Термины обозначают одно и то же; один основной, другой — синоним', color: '#4E6AA0' },
  { code: 'split', ru: 'Разные понятия — развести', tip: 'Один термин используется для двух разных понятий (омонимия)', color: '#9A6B1F' },
  { code: 'unclear', ru: 'Не могу оценить', tip: 'Вне моей компетенции или не хватает сведений — объясните в комментарии', color: '#2F6F7E' },
];
export const CONFLICT_VERDICT_BY_CODE = Object.fromEntries(CONFLICT_VERDICTS.map((v) => [v.code, v]));
const SEV_COLOR = { critical: '#A33A32', major: '#C2410C', minor: '#B9762C', candidate: '#6B7280', info: '#9AA3AE' };

/** Разделить файлы версии: глоссарии (CSV), файл формализаций (JSON), остальное (TTL, профиль). */
export function splitCorpusFiles(files) {
  const csv = [], rest = [];
  let spec = null, specFile = null;
  for (const f of files) {
    if (/\.(csv|tsv)$/i.test(f.name)) { csv.push(f); continue; }
    if (/\.json$/i.test(f.name)) {
      try {
        const j = JSON.parse(f.text);
        if (j && typeof j === 'object' && (j.formal || j.axioms || j.classes)) { spec = j; specFile = f.name; continue; }
      } catch (e) { /* не JSON формализаций */ }
    }
    rest.push(f);
  }
  return { csv, spec, specFile, rest };
}

/**
 * Подготовить корпус к загрузке в просмотрщик. Хэш модели считается по текстам глоссариев, а не по TTL:
 * TTL перестраивается после каждой формализации, а оценки и работа редактора привязаны к хэшу.
 */
export function corpusForViewer(parts, name) {
  const corpus = corpusFromFiles(parts.csv, { name });
  let hsh = 2166136261;
  for (const f of parts.csv) for (let i = 0; i < f.text.length; i++) hsh = Math.imul(hsh ^ f.text.charCodeAt(i), 16777619) >>> 0;
  const rest = parts.rest.filter((f) => !/\.json$/i.test(f.name));
  const ttlName = idPart(name, 40) + '.corpus.ttl';
  return { corpus, hash: 'c' + hsh.toString(16).padStart(8, '0'), rest, ttlName,
    files: [{ name: ttlName, text: corpusToTurtle(corpus, {}, []) }, ...rest], profile: corpusProfile() };
}

/** Файлы для перестройки модели просмотрщика по текущей работе редактора (роды → иерархия). */
export function corpusViewerFiles(c) {
  return [{ name: c.ttlName, text: corpusToTurtle(c.corpus, c.work.formal, c.work.classes) }, ...c.rest];
}

export function makeCorpusUI(d) {
  const { h, S, render, toast, download, csv, dateSlug, modal } = d;
  const cx = () => S.cx;
  const today = () => new Date().toISOString().slice(0, 10);

  // ------------------------------------------------------------------ состояние
  async function attach(corpus, parts, hash) {
    const seed = parts.spec ? resolveSpec(corpus, parts.spec) : null;
    S.cx = {
      corpus, spec: parts.spec, specFile: parts.specFile, seedUnresolved: seed ? seed.unresolved : [],
      work: { classes: [], props: [], axioms: [], formal: {} }, res: null,
      sel: null, filter: 'proved', kind: '', fsel: null, ffilter: 'queue', draft: null, axDraft: null,
      store: null, loadError: null,
    };
    const srv = S.srv;
    const server = srv && !srv.preview && srv.backend && srv.backend.loadWork;
    const local = () => makeLocalStore('corpus.' + hash, seed);
    S.cx.store = server ? makeServerStore(srv.backend, srv.ontology.id) : (d.workStore ? d.workStore(local()) : local());
    try { S.cx.work = await S.cx.store.load(); }
    catch (e) { S.cx.loadError = String(e && e.message || e); }
    analyse();
    const first = S.cx.res.conflicts.find((c) => c.status === 'proved') || S.cx.res.conflicts[0];
    if (!S.cx.res.conflicts.some((c) => c.status === 'proved')) S.cx.filter = 'all';
    S.cx.sel = first ? first.id : null;
  }

  function analyse() {
    const c = cx();
    const w = c.work;
    c.res = analyseCorpus(c.corpus, w.formal, w.axioms, w.classes, w.props, { lexThreshold: 0.35 });
    for (const x of c.res.conflicts) x.key = conflictKey(x);
    c.defs = new Map(c.corpus.definitions.map((x) => [x.id, x]));
    c.docs = new Map(c.corpus.documents.map((x) => [x.id, x]));
    c.concepts = new Map(c.corpus.concepts.map((x) => [x.id, x]));
    c.classById = new Map(w.classes.map((x) => [x.id, x]));
    c.propById = new Map(w.props.map((x) => [x.id, x]));
    if (!c.mentions) c.mentions = termMentions(c.corpus);
    // в каких коллизиях участвует определение
    c.byDef = new Map();
    for (const x of c.res.conflicts) for (const id of x.defs) (c.byDef.get(id) || c.byDef.set(id, []).get(id)).push(x);
  }

  const canEdit = () => (S.srv ? S.srv.role === 'editor' && !S.srv.preview : true);
  const label = (id) => { const c = cx(); return c.concepts.get(id) ? c.concepts.get(id).label_ru : c.classById.get(id) ? c.classById.get(id).label : c.propById.get(id) ? c.propById.get(id).label : (id || '—'); };
  const cite = (def) => `${def.docCode}${def.clause ? ', п. ' + def.clause : ''}`;
  const myVerdict = (x) => { const r = S.review.items[x.key]; return r && r.verdict ? r : null; };

  async function saveWork(type, id, data, okText) {
    const c = cx();
    if (!canEdit()) { toast('Менять формализацию и аксиомы может только редактор онтологии.', null, null, true); return false; }
    try {
      await c.store.save(type, id, data);
      applyWork(c.work, type, id, data);
      const before = c.res.stats;
      analyse();
      if (d.onWorkChanged && type !== 'axiom') d.onWorkChanged();
      const after = c.res.stats;
      if (okText !== false) toast(`${okText || 'Сохранено'}. Доказанных коллизий: ${after.proved}${after.proved !== before.proved ? ` (было ${before.proved})` : ''}, кандидатов: ${after.candidates}.`);
      render();
      return true;
    } catch (e) {
      toast('Не сохранено: ' + (e && e.message || e), null, null, true);
      return false;
    }
  }

  // ------------------------------------------------------------------ вкладки
  function tabs() {
    const c = cx();
    if (!c) return [];
    const st = c.res.stats;
    return [
      h('button', { role: 'tab', 'aria-selected': String(S.view === 'conflicts'), 'data-tip': 'Противоречия в определениях терминов с доказательством',
        onclick: () => { S.view = 'conflicts'; render(); } }, 'Коллизии', st.proved ? h('span.tabcount', String(st.proved)) : null),
      h('button', { role: 'tab', 'aria-selected': String(S.view === 'formal'), 'data-tip': 'Разбор определений: род и видовые отличия',
        onclick: () => { S.view = 'formal'; render(); } }, 'Формализация'),
      h('button', { role: 'tab', 'aria-selected': String(S.view === 'axioms'), 'data-tip': 'Несовместимые классы и признаки с единственным значением — с основанием',
        onclick: () => { S.view = 'axioms'; render(); } }, 'Аксиомы'),
    ];
  }

  // ================================================================== КОЛЛИЗИИ
  const FILTERS = [['proved', 'Доказанные'], ['candidate', 'Кандидаты'], ['info', 'К сведению'], ['mine', 'Без моей оценки'], ['all', 'Все']];
  function filtered() {
    const c = cx();
    return c.res.conflicts.filter((x) => {
      if (c.kind && x.kind !== c.kind) return false;
      if (c.filter === 'all') return true;
      if (c.filter === 'mine') return x.status !== 'info' && !myVerdict(x);
      return x.status === c.filter;
    });
  }

  function conflictsLeft() {
    const c = cx();
    const st = c.res.stats;
    const list = filtered();
    const kinds = Object.keys(st.byKind).sort();
    const box = h('div.checklist',
      h('div.cx-stats',
        h('div', h('b', String(st.proved)), ' доказано', st.critical ? h('span', { style: { color: SEV_COLOR.critical } }, ` (критических ${st.critical})`) : null),
        h('div', h('b', String(st.candidates)), ' кандидатов · ', h('b', String(st.info)), ' к сведению'),
        h('div.cx-bar', { 'data-tip': 'Сколько определений разобрано на род и признаки. Доказать коллизию можно только для формализованных определений.' },
          h('span', { style: { width: Math.round(100 * st.formalized / Math.max(1, st.definitions)) + '%' } })),
        h('div', { style: { fontSize: '12px', color: 'var(--muted-2)' } }, `формализовано ${st.formalized} из ${st.definitions} определений`)),
      h('div.seg.light.cx-filters', ...FILTERS.map(([k, t]) => h('button', { 'aria-pressed': String(c.filter === k),
        onclick: () => { c.filter = k; const f = filtered(); if (f.length && !f.some((x) => x.id === c.sel)) c.sel = f[0].id; render(); } }, t))),
      h('label.cx-kind', 'Вид: ', h('select', { onchange: (ev) => { c.kind = ev.target.value; render(); } },
        h('option', { value: '' }, 'все виды'),
        ...kinds.map((k) => h('option', { value: k, selected: c.kind === k ? true : null }, `${KIND_TITLES[k] || k} (${st.byKind[k]})`)))),
      ...(list.length ? list.slice(0, 500).map((x) => {
        const mv = myVerdict(x);
        return h('button.check.cx-row', { 'aria-current': String(c.sel === x.id), onclick: () => { c.sel = x.id; render(); } },
          h('span.sq', { style: { background: SEV_COLOR[x.severity] } }),
          h('span.t', x.title, h('span.cx-sub', `${KIND_TITLES[x.kind] || x.kind} · ${SEVERITY_RU[x.severity]}`)),
          mv ? h('span', { class: 'cx-dot', style: { background: CONFLICT_VERDICT_BY_CODE[mv.verdict] ? CONFLICT_VERDICT_BY_CODE[mv.verdict].color : '#999' },
            'data-tip': 'Ваша оценка: ' + (CONFLICT_VERDICT_BY_CODE[mv.verdict] || { ru: mv.verdict }).ru }) : null);
      }) : [h('div.empty', { style: { padding: '14px 6px', textAlign: 'left' } },
        c.filter === 'proved' ? 'Доказанных коллизий нет. Смотрите кандидатов: их нужно формализовать.' : 'Ничего не найдено.')]),
      exportBlock());
    return h('aside.left', h('div.scroll', box));
  }

  function defCard(def, other, f) {
    const doc = cx().docs.get(def.doc);
    const parts = other ? diffWords(def.text.ru, other.text.ru) : [{ w: def.text.ru, same: true }];
    return h('div.cx-def',
      h('div.cx-doc', h('b', doc.code), h('span', ` · ранг ${doc.rank}${doc.rankFromDefault ? '*' : ''} · ${STATUSES[doc.status]}`), def.clause ? h('span', ` · п. ${def.clause}`) : null),
      h('div.cx-term', def.label.ru, def.label.kk ? h('span', ' · kk: ' + def.label.kk) : null, def.label.en ? h('span', ' · en: ' + def.label.en) : null),
      h('p.cx-text', ...parts.map((p) => (p.same ? p.w : h('mark', { 'data-tip': 'Этих слов нет во втором определении' }, p.w)))),
      h('div.cx-formal', f && f.genus
        ? [h('span', f.status === 'confirmed' ? '✓ ' : '✎ черновик: '), 'род — ', h('b', label(f.genus)),
          ...(f.diffs && f.diffs.length ? ['; признаки: ', f.diffs.map((x) => `${label(x.prop)} — ${x.value ? label(x.value) : '«' + (x.literal || '') + '»'}`).join('; ')] : [])]
        : h('span', { style: { color: 'var(--muted-2)' } }, 'не формализовано'),
      h('button.linkbtn', { style: { marginLeft: '8px', fontSize: '12px' }, onclick: () => goFormal(def.id) }, canEdit() ? 'Формализовать →' : 'Разбор →')));
  }

  function goFormal(defId) {
    const c = cx();
    c.fsel = defId; c.draft = null; S.view = 'formal'; render();
  }

  function proofList(x) {
    return h('ol.cx-proof', ...x.proof.map((s, i) => h('li', { class: 'cx-step t-' + s.type },
      h('span.cx-stype', `${i + 1}. ${STEP_RU[s.type] || s.type}${s.indirect ? ' (через другой термин)' : ''}`),
      h('div', s.text),
      s.quote ? h('blockquote', s.quote) : null,
      s.type !== 'conclusion' ? h('div.cx-src', { class: s.source ? '' : 'bad' }, 'Источник: ', sourceText(s.source)) : null)));
  }

  function conflictsCenter() {
    const c = cx();
    const x = c.res.conflicts.find((y) => y.id === c.sel);
    const wrap = h('div.diagmain.cx-main');
    if (c.loadError) wrap.appendChild(h('div.note', 'Работа редактора не загружена: ' + c.loadError));
    if (c.corpus.warnings.length) {
      wrap.appendChild(h('details.note', h('summary', `Замечания к таблицам корпуса: ${c.corpus.warnings.length}`),
        h('ul', ...c.corpus.warnings.slice(0, 60).map((w) => h('li', w)))));
    }
    if (!x) {
      wrap.appendChild(h('div.explain.info', h('h2', 'Коллизий не найдено'),
        h('p', c.res.stats.formalized ? 'По формализованным определениям противоречий нет.' : 'Ни одно определение не формализовано. Начните с вкладки «Формализация»: коллизию можно доказать только по роду и признакам определения.')));
      return h('div.center', wrap);
    }
    const defs = x.defs.filter((id) => c.defs.has(id)).map((id) => c.defs.get(id));
    wrap.appendChild(h('div.cx-head',
      h('div.cx-badges',
        h('span.cx-badge', { style: { background: SEV_COLOR[x.severity], color: '#fff' } }, KIND_LETTER[x.status] + (x.status === 'proved' ? ' · ' + SEVERITY_RU[x.severity] : '')),
        h('span.cx-badge', KIND_TITLES[x.kind] || x.kind),
        h('span.cx-badge.mono', x.id)),
      h('h2', x.title),
      x.yields ? h('p.cx-yield', 'Уступает: ', h('b', x.yields.code), ' — ', x.yields.reason) : null,
      x.unsourced ? h('div.note', `Не публикуется как доказанная: у ${x.unsourced.length} шаг(ов) нет источника. Укажите основание аксиомы или класса.`) : null,
      x.homonymy ? h('div.note.info', 'Термин одинаковый, но роды несовместимы. Возможна иная трактовка — омонимия: один термин обозначает два понятия. Тогда вердикт «Разные понятия — развести».') : null));
    wrap.appendChild(h('div.cx-pair', ...defs.map((dd, i) => defCard(dd, defs[1 - i] || null, c.work.formal[dd.id]))));
    wrap.appendChild(h('h3.cx-h3', 'Доказательство'));
    wrap.appendChild(proofList(x));
    return h('div.center', wrap);
  }

  // ---------------- вердикт по коллизии
  let othersFor = null;
  async function loadOthersFor(x) {
    if (!S.srv || S.srv.preview) return;
    if (othersFor && othersFor.key === x.key) return;
    othersFor = { key: x.key, loading: true, items: [] };
    try {
      const o = S.srv.ontology;
      const r = await S.srv.backend.othersForTerm(o.id, S.ontVersion, x.key, o.experts.concat(o.editors));
      othersFor = { key: x.key, hidden: r.hidden, items: r.items };
    } catch (e) { othersFor = { key: x.key, hidden: true, items: [] }; }
    if (S.view === 'conflicts' && cx().sel === x.id) render();
  }

  function conflictsRight() {
    const c = cx();
    const x = c.res.conflicts.find((y) => y.id === c.sel);
    const side = h('div.side');
    if (!x) return h('aside.right', h('div.scroll', side));
    const rec = S.review.items[x.key] || {};
    side.appendChild(h('div', h('h2', 'Ваша оценка'), h('p.sub', x.status === 'info' ? 'Отмечено к сведению; оценка не обязательна.' : 'Согласны ли вы с выводом? Оценка видна редактору.')));
    if (rec.verdict && rec.conflict_kind && rec.conflict_kind !== x.kind) {
      side.appendChild(h('div.note', `Оценка дана, когда коллизия была «${KIND_TITLES[rec.conflict_kind] || rec.conflict_kind}». С тех пор формализация изменилась — проверьте вывод заново.`));
    }
    const form = h('form.cx-form', { onsubmit: (ev) => { ev.preventDefault(); submit(); } });
    const group = h('div.cx-verdicts', { role: 'radiogroup', 'aria-label': 'Вердикт' },
      ...CONFLICT_VERDICTS.map((v, i) => h('label.cx-v', { 'data-tip': v.tip },
        h('input', { type: 'radio', name: 'cx-verdict', value: v.code, checked: rec.verdict === v.code ? true : null }),
        h('span', { class: 'cx-dot', style: { background: v.color } }), h('span', v.ru), h('kbd', String(i + 1)))));
    const comment = h('textarea', { name: 'comment', rows: 3, placeholder: 'Почему вы так считаете (обязательно для «Не могу оценить» и при оспаривании шага)' });
    comment.value = rec.comment || '';
    const step = h('select', { name: 'disputed_step' }, h('option', { value: '' }, 'не оспариваю'),
      ...x.proof.map((s, i) => h('option', { value: String(i + 1), selected: String(rec.disputed_step) === String(i + 1) ? true : null }, `шаг ${i + 1}: ${STEP_RU[s.type]}`)));
    const basis = h('select', { name: 'basis_doc' }, h('option', { value: '' }, '—'),
      ...x.docs.map((id) => c.docs.get(id)).filter(Boolean).map((doc) => h('option', { value: doc.code, selected: rec.basis_doc === doc.code ? true : null }, doc.code)));
    const wording = h('textarea', { name: 'proposed_wording', rows: 3, placeholder: 'Если нужно исправить определение — ваша редакция' });
    wording.value = rec.proposed_wording || '';
    const where = h('input', { name: 'fix_clause', placeholder: 'например: ТКН, п. 3.18' });
    where.value = rec.fix_clause || '';
    form.append(group,
      h('label.cx-field', 'Комментарий', comment),
      h('label.cx-field', 'Оспариваю шаг доказательства', step),
      h('label.cx-field', 'Основой считать документ', basis),
      h('label.cx-field', 'Предлагаемая редакция', wording),
      h('label.cx-field', 'Где править', where),
      h('div', { style: { display: 'flex', gap: '8px' } },
        h('button.btn.primary', { type: 'submit' }, 'Сохранить и дальше'),
        S.srv && S.srv.preview ? null : null));
    function submit() {
      const v = (form.querySelector('input[name="cx-verdict"]:checked') || {}).value;
      if (!v) { toast('Выберите вердикт.', null, null, true); return; }
      if ((v === 'unclear' || step.value) && !comment.value.trim()) { toast(v === 'unclear' ? 'Для «Не могу оценить» нужен комментарий.' : 'Объясните в комментарии, что не так с оспоренным шагом.', null, null, true); comment.focus(); return; }
      const r = { verdict: v, comment: comment.value.trim(), disputed_step: step.value, basis_doc: basis.value,
        proposed_wording: wording.value.trim(), fix_clause: where.value.trim(), conflict_kind: x.kind, label_ru: x.title, ts: new Date().toISOString() };
      d.saveConflictReview(x.key, r);
      const next = filtered().find((y) => y.id !== x.id && y.status !== 'info' && !myVerdict(y));
      toast('Оценка сохранена' + (next ? '' : '. Неоценённых коллизий в этом списке нет.'));
      if (next) c.sel = next.id;
      render();
    }
    side.appendChild(form);
    if (S.srv && S.srv.preview) side.appendChild(h('p.rv-store', 'Предпросмотр: оценки не сохраняются.'));
    else if (S.srv) side.appendChild(d.storeNote());

    // оценки коллег
    if (S.srv && !S.srv.preview) {
      if (S.srv.role === 'editor' && S.serverReviews) {
        const rows = S.serverReviews.map((r) => [r.expert, r.items[x.key]]).filter(([, it]) => it && it.verdict);
        side.appendChild(h('div', h('div.panelhead', { style: { padding: '4px 0 6px' } }, `Оценки экспертов: ${rows.length}`),
          rows.length ? h('div.kv', ...rows.map(([n, it]) => otherRow(n, it, x))) : h('p.sub', 'Пока никто не оценил.')));
      } else {
        loadOthersFor(x);
        const o = othersFor && othersFor.key === x.key ? othersFor : null;
        side.appendChild(h('div', h('div.panelhead', { style: { padding: '4px 0 6px' } }, 'Оценки коллег'),
          !o || o.loading ? h('p.sub', 'загрузка…') : o.hidden ? h('p.sub', 'Станут видны после вашей оценки.')
            : o.items.length ? h('div.kv', ...o.items.map((it) => otherRow(it.expert, it, x))) : h('p.sub', 'Пока никто не оценил.')));
      }
    }
    return h('aside.right', h('div.scroll', side));
  }

  function otherRow(name, it, x) {
    const v = CONFLICT_VERDICT_BY_CODE[it.verdict];
    const extra = [it.disputed_step && `оспаривает шаг ${it.disputed_step}`, it.basis_doc && `основа: ${it.basis_doc}`,
      it.proposed_wording && `редакция: ${it.proposed_wording}`, it.fix_clause && `где: ${it.fix_clause}`, it.comment,
      it.conflict_kind && it.conflict_kind !== x.kind && `(оценено при виде «${KIND_TITLES[it.conflict_kind] || it.conflict_kind}»)`].filter(Boolean).join(' · ');
    return h('div.r.wide', h('span', name, ' ', v ? h('span', { class: 'cx-dot', style: { background: v.color, display: 'inline-block', marginLeft: '4px' } }) : null),
      h('b', { style: { fontFamily: 'var(--sans)' } }, v ? v.ru : it.verdict),
      extra ? h('span', { style: { display: 'block', fontSize: '12px', color: 'var(--muted)', marginTop: '2px' } }, extra) : null);
  }

  // ---------------- выгрузки
  function reviewSets() {
    const own = { expert: S.srv ? S.srv.name : (S.review.expert || 'этот браузер'), items: S.review.items };
    const others = (S.serverReviews || []).filter((r) => !(S.srv && r.email === S.srv.email)).map((r) => ({ expert: r.expert, items: r.items }));
    return [own, ...others].filter((r) => Object.keys(r.items).some((k) => k.startsWith('conflict:')));
  }
  const base = () => `${dateSlug()}-${idPart(cx().corpus.name, 30)}`;
  function exportBlock() {
    const c = cx();
    const btn = (t, tip, fn) => h('button.btn', { 'data-tip': tip, onclick: fn }, t);
    return h('div.cx-export',
      h('div.panelhead', { style: { padding: '14px 0 6px' } }, 'Выгрузки'),
      btn('Отчёт с доказательствами (.md)', 'Доказанные коллизии и кандидаты с шагами и источниками — для письма разработчику нормы',
        () => download(conflictsMarkdown(c.corpus, c.res), `${base()}-conflicts-report.md`, 'text/markdown')),
      btn('Карта коллизий (.csv)', 'Одна строка — одна коллизия; оценки экспертов столбцами',
        () => download(csv(conflictsCsvRows(c.corpus, c.res.conflicts, reviewSets(), (v) => (CONFLICT_VERDICT_BY_CODE[v] || { ru: v }).ru)), `${base()}-conflicts.csv`, 'text/csv')),
      btn('Turtle: определения', 'Понятия, определения по документам, формализация (род, признаки, цитаты), структурные классы',
        () => download(definitionsTurtle(c.corpus, c.work), `${base()}-definitions.ttl`, 'text/turtle')),
      btn('Turtle: аксиомы', 'owl:disjointWith и owl:FunctionalProperty с основанием каждой аксиомы',
        () => download(axiomsTurtle(c.corpus, c.work), `${base()}-axioms.ttl`, 'text/turtle')),
      btn('Turtle: коллизии', 'Коллизии с шагами доказательства и вердиктами экспертов',
        () => download(conflictsTurtle(c.corpus, c.res.conflicts, reviewSets()), `${base()}-conflicts.ttl`, 'text/turtle')),
      btn('Формализации (.json)', 'Классы, свойства, аксиомы и формализации — для переноса на новую версию корпуса',
        () => download(JSON.stringify(toSpec(c.corpus, c.work), null, 1), `${base()}-formal.json`, 'application/json')));
  }

  // ================================================================== ФОРМАЛИЗАЦИЯ
  const FFILTERS = [['queue', 'Очередь'], ['none', 'Без разбора'], ['draft', 'Черновики'], ['all', 'Все']];
  function fstatus(id) { const f = cx().work.formal[id]; return f && f.genus ? (f.status === 'confirmed' ? 'confirmed' : 'draft') : 'none'; }
  /** Очередь: определения из кандидатов (их формализация решит вопрос), затем понятия с несколькими определениями. */
  function queue() {
    const c = cx();
    const multi = new Set(c.corpus.concepts.filter((k) => c.corpus.definitions.filter((x) => x.concept === k.id).length > 1).map((k) => k.id));
    const score = (dd) => {
      const cand = (c.byDef.get(dd.id) || []).some((x) => x.status === 'candidate');
      return (fstatus(dd.id) === 'confirmed' ? 100 : 0) + (cand ? 0 : multi.has(dd.concept) ? 10 : 50);
    };
    return c.corpus.definitions.slice().sort((a, b) => score(a) - score(b) || a.label.ru.localeCompare(b.label.ru, 'ru'));
  }
  function flist() {
    const c = cx();
    if (c.ffilter === 'queue') return queue().filter((dd) => fstatus(dd.id) !== 'confirmed');
    if (c.ffilter === 'all') return queue();
    return c.corpus.definitions.filter((dd) => fstatus(dd.id) === c.ffilter);
  }

  function formalLeft() {
    const c = cx();
    const list = flist();
    if (!c.fsel && list[0]) c.fsel = list[0].id;
    const mark = { confirmed: '✓', draft: '✎', none: '○' };
    return h('aside.left', h('div.scroll', h('div.checklist',
      h('div.cx-stats', h('div', h('b', String(c.res.stats.formalized)), ` из ${c.res.stats.definitions} определений подтверждено`),
        h('div', { style: { fontSize: '12px', color: 'var(--muted-2)' } }, 'Очередь: сначала определения из кандидатов в коллизии.')),
      h('div.seg.light.cx-filters', ...FFILTERS.map(([k, t]) => h('button', { 'aria-pressed': String(c.ffilter === k), onclick: () => { c.ffilter = k; render(); } }, t))),
      ...(list.length ? list.slice(0, 800).map((dd) => {
        const n = (c.byDef.get(dd.id) || []).filter((x) => x.status !== 'info').length;
        return h('button.check.cx-row', { 'aria-current': String(c.fsel === dd.id), onclick: () => { c.fsel = dd.id; c.draft = null; render(); } },
          h('span', { class: 'cx-fmark f-' + fstatus(dd.id) }, mark[fstatus(dd.id)]),
          h('span.t', dd.label.ru, h('span.cx-sub', cite(dd))),
          n ? h('span.n', { 'data-tip': 'Участвует в коллизиях и кандидатах' }, String(n)) : null);
      }) : [h('div.empty', { style: { padding: '14px 6px', textAlign: 'left' } }, 'Список пуст.')]))));
  }

  /** Варианты рода и значения: структурные классы, затем понятия корпуса. */
  function classOptions(selected, excludeConcept) {
    const c = cx();
    return [h('option', { value: '' }, '— не выбрано —'),
      h('optgroup', { label: 'Структурные классы' }, ...c.work.classes.map((k) => h('option', { value: k.id, selected: selected === k.id ? true : null }, '▪ ' + k.label))),
      h('optgroup', { label: 'Понятия корпуса' }, ...c.corpus.concepts.filter((k) => k.id !== excludeConcept)
        .slice().sort((a, b) => a.label_ru.localeCompare(b.label_ru, 'ru'))
        .map((k) => h('option', { value: k.id, selected: selected === k.id ? true : null }, k.label_ru)))];
  }

  function formalCenter() {
    const c = cx();
    const dd = c.fsel && c.defs.get(c.fsel);
    const wrap = h('div.diagmain.cx-main');
    if (!dd) { wrap.appendChild(h('div.explain.info', h('h2', 'Нет определений'))); return h('div.center', wrap); }
    const doc = c.docs.get(dd.doc);
    const saved = c.work.formal[dd.id];
    if (!c.draft || c.draft.defId !== dd.id) {
      c.draft = { defId: dd.id, genus: saved ? saved.genus : '', genusQuote: saved ? saved.genusQuote || '' : '', diffs: saved ? JSON.parse(JSON.stringify(saved.diffs || [])) : [], note: saved ? saved.note || '' : '' };
    }
    const dr = c.draft;
    const ed = canEdit();
    const dis = ed ? null : true;
    wrap.appendChild(h('div.cx-head',
      h('div.cx-badges', h('span.cx-badge', doc.code), h('span.cx-badge', `ранг ${doc.rank} · ${STATUSES[doc.status]}`), dd.clause ? h('span.cx-badge', 'п. ' + dd.clause) : null,
        h('span', { class: 'cx-badge f-' + fstatus(dd.id) }, { confirmed: 'подтверждено', draft: 'черновик', none: 'не разобрано' }[fstatus(dd.id)])),
      h('h2', dd.label.ru),
      h('p.cx-text.big', dd.text.ru || h('i', 'текст определения отсутствует'))));
    if (!ed) wrap.appendChild(h('div.note.info', 'Разбор определений ведёт редактор онтологии; здесь он показан для проверки.'));

    const genusSel = h('select', { disabled: dis, onchange: (ev) => { dr.genus = ev.target.value; } }, ...classOptions(dr.genus, dd.concept));
    const genusQuote = h('input', { disabled: dis, value: dr.genusQuote, placeholder: 'слова определения, называющие род', oninput: (ev) => { dr.genusQuote = ev.target.value; } });
    const hint = h('span.cx-hint');
    const suggest = h('button.btn', { type: 'button', disabled: dis, 'data-tip': 'Подсказка по началу определения: ищется подходящий класс или понятие корпуса. Только предложение — проверьте.',
      onclick: () => {
        const p = proposeGenus(dd, c.corpus, c.work.classes);
        if (p && p.genus) { dr.genus = p.genus; dr.genusQuote = p.quote || dr.genusQuote; render(); toast(`Подсказка: род — «${label(p.genus)}» (по словам «${p.quote}»). Проверьте.`); }
        else if (p && p.newClass) { hint.textContent = `Подходящего класса нет. Начало определения: «${p.quote}» — заведите структурный класс.`; newClassForm.querySelector('input').value = p.newClass; }
        else hint.textContent = 'Подсказки нет.';
      } }, 'Подсказать род');

    const newClassForm = inlineClassForm((id) => { dr.genus = id; });
    const diffRows = h('div.cx-diffs');
    const drawDiffs = () => {
      while (diffRows.firstChild) diffRows.removeChild(diffRows.firstChild);
      dr.diffs.forEach((x, i) => {
        const prop = h('select', { disabled: dis, onchange: (ev) => { x.prop = ev.target.value; } }, h('option', { value: '' }, '— свойство —'),
          ...c.work.props.map((p) => h('option', { value: p.id, selected: x.prop === p.id ? true : null }, p.label)));
        const val = h('select', { disabled: dis, onchange: (ev) => { x.value = ev.target.value; if (x.value) x.literal = ''; } }, ...classOptions(x.value || ''));
        const litIn = h('input', { disabled: dis, value: x.literal || '', placeholder: 'или текстом', oninput: (ev) => { x.literal = ev.target.value; } });
        const q = h('input', { disabled: dis, value: x.quote || '', placeholder: 'цитата из определения', oninput: (ev) => { x.quote = ev.target.value; } });
        diffRows.appendChild(h('div.cx-diff', prop, val, litIn, q,
          ed ? h('button.iconbtn', { type: 'button', 'aria-label': 'Удалить признак', onclick: () => { dr.diffs.splice(i, 1); drawDiffs(); } }, '✕') : null));
      });
      if (!dr.diffs.length) diffRows.appendChild(h('p.sub', 'Признаков нет: определение только называет род.'));
    };
    drawDiffs();

    const checkQuotes = () => {
      const t = foldText(dd.text.ru);
      const bad = [dr.genusQuote, ...dr.diffs.map((x) => x.quote)].filter((q) => q && !t.includes(foldText(q)));
      return bad;
    };
    const save = (status) => {
      if (!dr.genus) { toast('Укажите род.', null, null, true); return; }
      const diffs = dr.diffs.filter((x) => x.prop && (x.value || x.literal));
      if (diffs.length !== dr.diffs.length) { toast('У каждого признака должны быть свойство и значение (класс или текст).', null, null, true); return; }
      if (status === 'confirmed' && diffs.some((x) => !x.quote)) { toast('Для подтверждения у каждого признака нужна цитата из определения.', null, null, true); return; }
      const bad = checkQuotes();
      if (status === 'confirmed' && bad.length) { toast(`Цитаты нет в тексте определения: «${bad[0]}». Цитата должна совпадать с текстом пункта.`, null, null, true); return; }
      const by = S.srv ? S.srv.email : (S.review.expert || 'этот браузер');
      saveWork('formal', dd.id, { genus: dr.genus, genusQuote: dr.genusQuote, diffs: diffs.map((x) => ({ prop: x.prop, value: x.value || '', literal: x.literal || '', quote: x.quote || '' })),
        status, by, date: today(), origin: 'manual', note: dr.note }, status === 'confirmed' ? 'Формализация подтверждена' : 'Черновик сохранён');
    };

    wrap.appendChild(h('div.cx-fform',
      h('h3.cx-h3', 'Род (ближайшее родовое понятие)'),
      h('div.cx-row2', genusSel, ed ? suggest : null), h('label.cx-field', 'Цитата рода', genusQuote), hint,
      ed ? h('details.cx-new', h('summary', '+ новый структурный класс'), newClassForm) : null,
      h('h3.cx-h3', 'Видовые отличия'),
      h('p.sub', 'Свойство и значение: значение — класс или понятие (для сравнения) либо текст (сравнивается дословно). Цитата — слова из определения, из которых взят признак.'),
      diffRows,
      ed ? h('div.cx-row2',
        h('button.btn', { type: 'button', onclick: () => { dr.diffs.push({ prop: '', value: '', literal: '', quote: '' }); drawDiffs(); } }, '+ признак'),
        h('details.cx-new', h('summary', '+ новое свойство'), inlinePropForm())) : null,
      ed ? h('div.cx-row2', { style: { marginTop: '14px' } },
        h('button.btn', { onclick: () => save('draft') }, 'Сохранить черновик'),
        h('button.btn.primary', { onclick: () => save('confirmed'), 'data-tip': 'Подтверждённая формализация участвует в доказательстве коллизий' }, 'Подтвердить'),
        saved && saved.status === 'confirmed' ? h('button.linkbtn', { onclick: () => saveWork('formal', dd.id, { ...saved, status: 'draft' }, 'Подтверждение снято') }, 'снять подтверждение') : null) : null,
      saved && saved.by ? h('p.sub', `Сохранено: ${saved.by}${saved.date ? ', ' + saved.date : ''}${saved.origin && saved.origin !== 'manual' ? ' (' + saved.origin + ')' : ''}`) : null));
    return h('div.center', wrap);
  }

  function inlineClassForm(onCreated) {
    const c = cx();
    const lab = h('input', { placeholder: 'название класса, напр. «цифровое представление»' });
    const parent = h('select', h('option', { value: '' }, 'без родителя'), ...c.work.classes.map((k) => h('option', { value: k.id }, k.label)));
    const basis = h('input', { placeholder: 'основание (необязательно): откуда класс' });
    return h('div.cx-inline', lab, parent, basis, h('button.btn', { type: 'button', onclick: async () => {
      const l = lab.value.trim();
      if (!l) { lab.focus(); return; }
      let id = 'S_' + idPart(l, 40), i = 2;
      while (c.work.classes.some((k) => k.id === id)) id = 'S_' + idPart(l, 40) + '_' + (i++);
      if (onCreated) onCreated(id);
      await saveWork('class', id, { id, label: l, parent: parent.value || '', basis: basis.value.trim() || 'структурный класс корпуса', by: S.srv ? S.srv.email : '', date: today() }, `Класс «${l}» добавлен`);
    } }, 'Добавить класс'));
  }

  function inlinePropForm() {
    const c = cx();
    const lab = h('input', { placeholder: 'название свойства, напр. «кем назначается»' });
    return h('div.cx-inline', lab, h('button.btn', { type: 'button', onclick: async () => {
      const l = lab.value.trim();
      if (!l) { lab.focus(); return; }
      let id = 'P_' + idPart(l, 40), i = 2;
      while (c.work.props.some((k) => k.id === id)) id = 'P_' + idPart(l, 40) + '_' + (i++);
      if (c.draft) c.draft.diffs.push({ prop: id, value: '', literal: '', quote: '' });
      await saveWork('prop', id, { id, label: l, by: S.srv ? S.srv.email : '', date: today() }, `Свойство «${l}» добавлено`);
    } }, 'Добавить свойство'));
  }

  function formalRight() {
    const c = cx();
    const dd = c.fsel && c.defs.get(c.fsel);
    const side = h('div.side');
    if (!dd) return h('aside.right', h('div.scroll', side));
    const same = c.corpus.definitions.filter((x) => x.concept === dd.concept && x.id !== dd.id);
    side.appendChild(h('div', h('h2', 'Другие определения'), h('p.sub', same.length ? 'Того же понятия в других документах' : 'Понятие определено только здесь')));
    for (const o of same) {
      const f = c.work.formal[o.id];
      side.appendChild(h('div.kv', h('div.r.wide', h('span', cite(o)), h('b', { style: { fontFamily: 'var(--sans)' } }, o.text.ru)),
        h('div.r', h('span', 'род'), h('b', f && f.genus ? label(f.genus) + (f.status === 'confirmed' ? '' : ' (черновик)') : '—')),
        h('div.r', h('span'), h('button.linkbtn', { onclick: () => { c.fsel = o.id; c.draft = null; render(); } }, 'открыть'))));
    }
    const uses = c.mentions.filter((m) => m.def === dd.id), usedBy = c.mentions.filter((m) => m.to === dd.concept);
    const mrow = (m, id) => h('div.r.wide', h('span', label(id)),
      h('span', { style: { display: 'block', fontSize: '12px', color: 'var(--muted-2)' } }, `«${m.quote}» — ${cite(c.defs.get(m.def))}`));
    if (uses.length || usedBy.length) {
      side.appendChild(h('div', h('div.panelhead', { style: { padding: '4px 0 6px' } }, 'Связи через тексты определений'),
        uses.length ? h('p.sub', 'Это определение использует термины:') : null,
        uses.length ? h('div.kv', ...uses.map((m) => mrow(m, m.to))) : null,
        usedBy.length ? h('p.sub', { style: { marginTop: '8px' } }, 'На это понятие опираются определения:') : null,
        usedBy.length ? h('div.kv', ...usedBy.map((m) => mrow(m, m.from))) : null));
    }
    const inv = (c.byDef.get(dd.id) || []);
    if (inv.length) {
      side.appendChild(h('div', h('div.panelhead', { style: { padding: '4px 0 6px' } }, 'Коллизии с этим определением'),
        h('div.kv', ...inv.map((x) => h('div.r.wide', h('button.linkbtn', { style: { textAlign: 'left' }, onclick: () => { c.sel = x.id; S.view = 'conflicts'; render(); } }, x.title),
          h('span', { style: { display: 'block', fontSize: '12px', color: 'var(--muted-2)' } }, `${KIND_TITLES[x.kind]} · ${KIND_LETTER[x.status]}`))))));
    }
    side.appendChild(h('div.note.info', 'Метод: определение = род + видовые отличия. Коллизия доказывается, если роды двух определений несовместимы (аксиома) или признак с единственным значением задан по-разному. Каждый шаг опирается на цитату из пункта или на аксиому с основанием.'));
    return h('aside.right', h('div.scroll', side));
  }

  // ================================================================== АКСИОМЫ
  function axiomsLeft() {
    const c = cx();
    const ed = canEdit();
    return h('aside.left', h('div.scroll', h('div.checklist',
      h('div.panelhead', { style: { padding: '6px 6px' } }, `Структурные классы: ${c.work.classes.length}`),
      h('div.kv', ...c.work.classes.map((k) => h('div.r.wide', h('span', '▪ ' + k.label + (k.parent ? ' ⊑ ' + label(k.parent) : '')),
        h('span', { style: { display: 'block', fontSize: '11.5px', color: 'var(--muted-2)' } }, k.basis || 'основание не указано')))),
      ed ? h('details.cx-new', h('summary', '+ класс'), inlineClassForm()) : null,
      h('div.panelhead', { style: { padding: '14px 6px 6px' } }, `Свойства: ${c.work.props.length}`),
      h('div.kv', ...c.work.props.map((p) => h('div.r', h('span', p.label), h('b', p.id)))),
      ed ? h('details.cx-new', h('summary', '+ свойство'), inlinePropForm()) : null)));
  }

  function axiomUse(a) {
    return cx().res.conflicts.filter((x) => x.proof.some((s) => s.source && s.source.axiom === a.id)).length;
  }

  function axiomsCenter() {
    const c = cx();
    const ed = canEdit();
    const wrap = h('div.diagmain.cx-main');
    wrap.appendChild(h('div.explain.info', h('h2', 'Аксиомы'),
      h('p', 'Аксиома — утверждение, на которое опирается доказательство: «классы A и B несовместимы» или «у свойства одно значение». У каждой аксиомы должно быть основание (пункт стандарта, словаря или решение рабочей группы). Без основания коллизии с этой аксиомой остаются кандидатами.')));
    const axs = c.work.axioms;
    const table = h('div.kv');
    for (const a of axs) {
      const n = axiomUse(a);
      const stmt = a.type === 'disjoint' ? `«${label(a.a)}» ⊥ «${label(a.b)}»` : `«${label(a.prop)}» — единственное значение`;
      table.appendChild(h('div.r.wide', { style: a.active === false ? { opacity: '.55' } : null },
        h('span', h('b', { style: { fontFamily: 'var(--mono)' } }, a.id), ' ', stmt),
        h('span', { style: { display: 'block', fontSize: '12px', color: a.basis ? 'var(--muted)' : 'var(--red)', marginTop: '3px' } },
          a.basis ? 'Основание: ' + a.basis : 'Основание не указано — зависимые коллизии остаются кандидатами', a.by ? ` · ${a.by}${a.date ? ', ' + a.date : ''}` : ''),
        h('span', { style: { display: 'flex', gap: '12px', alignItems: 'center', marginTop: '4px', fontSize: '12px' } },
          h('span', `используется в коллизиях: ${n}`),
          ed ? h('label', h('input', { type: 'checkbox', checked: a.active !== false ? true : null,
            onchange: (ev) => saveWork('axiom', a.id, { ...a, active: ev.target.checked }, ev.target.checked ? `Аксиома ${a.id} включена` : `Аксиома ${a.id} отозвана`) }), ' действует') : h('span', a.active === false ? 'отозвана' : 'действует'))));
    }
    if (!axs.length) table.appendChild(h('div.r', h('span', 'Аксиом пока нет.')));
    wrap.appendChild(table);

    // предложения из кандидатов K1-open
    const sugg = [];
    const seen = new Set();
    for (const x of c.res.conflicts) {
      if (!x.suggestAxiom) continue;
      const k = [x.suggestAxiom.a, x.suggestAxiom.b].sort().join('|');
      if (seen.has(k)) continue;
      seen.add(k); sugg.push(x);
    }
    if (sugg.length) {
      wrap.appendChild(h('h3.cx-h3', 'Предложено решить'));
      wrap.appendChild(h('div.kv', ...sugg.map((x) => h('div.r.wide',
        h('span', `Совместимы ли «${label(x.suggestAxiom.a)}» и «${label(x.suggestAxiom.b)}»? (${x.title})`),
        ed ? h('span', { style: { display: 'block', marginTop: '4px' } }, h('button.linkbtn', { onclick: () => { c.axDraft = { type: 'disjoint', a: x.suggestAxiom.a, b: x.suggestAxiom.b, prop: '', basis: '' }; render(); } }, 'несовместимы — добавить аксиому'),
          ' · ', h('button.linkbtn', { onclick: () => { c.sel = x.id; S.view = 'conflicts'; render(); } }, 'открыть кандидата')) : null))));
    }

    if (ed) {
      const dr = c.axDraft = c.axDraft || { type: 'disjoint', a: '', b: '', prop: '', basis: '' };
      const type = h('select', { onchange: (ev) => { dr.type = ev.target.value; render(); } },
        h('option', { value: 'disjoint', selected: dr.type === 'disjoint' ? true : null }, 'несовместимые классы (A ⊥ B)'),
        h('option', { value: 'functional', selected: dr.type === 'functional' ? true : null }, 'единственное значение свойства'));
      const A = h('select', { onchange: (ev) => { dr.a = ev.target.value; } }, ...classOptions(dr.a));
      const B = h('select', { onchange: (ev) => { dr.b = ev.target.value; } }, ...classOptions(dr.b));
      const P = h('select', { onchange: (ev) => { dr.prop = ev.target.value; } }, h('option', { value: '' }, '— свойство —'),
        ...c.work.props.map((p) => h('option', { value: p.id, selected: dr.prop === p.id ? true : null }, p.label)));
      const basis = h('textarea', { rows: 2, placeholder: 'Основание: пункт стандарта/словаря или решение рабочей группы (кто, когда)', oninput: (ev) => { dr.basis = ev.target.value; } });
      basis.value = dr.basis;
      wrap.appendChild(h('h3.cx-h3', 'Новая аксиома'));
      wrap.appendChild(h('div.cx-fform', type, dr.type === 'disjoint' ? h('div.cx-row2', A, h('span', '⊥'), B) : P, h('label.cx-field', 'Основание', basis),
        h('button.btn.primary', { onclick: async () => {
          if (dr.type === 'disjoint' && (!dr.a || !dr.b || dr.a === dr.b)) { toast('Выберите два разных класса.', null, null, true); return; }
          if (dr.type === 'functional' && !dr.prop) { toast('Выберите свойство.', null, null, true); return; }
          if (!dr.basis.trim() && !confirmNoBasis()) return;
          let n = c.work.axioms.length + 1; let id = 'AX' + n;
          while (c.work.axioms.some((x) => x.id === id)) id = 'AX' + (++n);
          const ok = await saveWork('axiom', id, { id, type: dr.type, a: dr.type === 'disjoint' ? dr.a : '', b: dr.type === 'disjoint' ? dr.b : '', prop: dr.type === 'functional' ? dr.prop : '',
            basis: dr.basis.trim(), by: S.srv ? S.srv.email : (S.review.expert || ''), date: today(), active: true }, `Аксиома ${id} добавлена`);
          if (ok) c.axDraft = null;
        } }, 'Добавить аксиому')));
    }
    return h('div.center', wrap);
  }
  let noBasisWarned = false;
  function confirmNoBasis() {
    if (noBasisWarned) return true;
    noBasisWarned = true;
    toast('Аксиома без основания: коллизии с ней не будут доказанными. Нажмите «Добавить» ещё раз, чтобы сохранить так.', null, null, true);
    return false;
  }

  function axiomsRight() {
    const c = cx();
    const side = h('div.side', h('div', h('h2', 'Документы корпуса'), h('p.sub', 'Ранг определяет, чьё определение уступает при коллизии (1 — высший).')));
    side.appendChild(h('div.kv', ...c.corpus.documents.slice().sort((a, b) => a.rank - b.rank).map((doc) => h('div.r.wide',
      h('span', h('b', { style: { fontFamily: 'var(--sans)', display: 'inline' } }, doc.code), ` · ранг ${doc.rank}${doc.rankFromDefault ? ' (по виду документа)' : ''}`),
      h('span', { style: { display: 'block', fontSize: '12px', color: 'var(--muted-2)' } }, `${STATUSES[doc.status]}${doc.year ? ', ' + doc.year : ''} · ${doc.force}`)))));
    if (c.corpus.documents.some((x) => x.rankFromDefault)) side.appendChild(h('div.note', 'Ранги, отмеченные «по виду документа», назначены по умолчанию. Шкалу нужно подтвердить с юристом; задать ранг можно столбцом rank в листе документов.'));
    if (canEdit() && c.spec && S.srv) {
      side.appendChild(h('div.note.info', `В версии есть файл формализаций (${c.specFile}).`, h('br'),
        h('button.btn', { style: { marginTop: '6px' }, onclick: importSpec }, 'Перенести его на сервер')));
    }
    if (canEdit()) {
      const inp = h('input', { type: 'file', accept: '.json', class: 'sr', onchange: async (ev) => {
        const f = ev.target.files[0]; if (!f) return;
        try { c.spec = JSON.parse(await f.text()); c.specFile = f.name; await importSpec(); } catch (e) { toast('Файл не прочитан: ' + (e.message || e), null, null, true); }
      } });
      side.appendChild(h('div', inp, h('button.btn', { onclick: () => inp.click(), 'data-tip': 'Классы, свойства, аксиомы и формализации из файла *-formal.json (ключи «код документа|пункт»)' }, 'Импорт формализаций (.json)')));
    }
    return h('aside.right', h('div.scroll', side));
  }

  async function importSpec() {
    const c = cx();
    const r = resolveSpec(c.corpus, c.spec);
    const by = S.srv ? S.srv.email : '';
    let n = 0;
    try {
      for (const k of r.classes) { await c.store.save('class', k.id, k); applyWork(c.work, 'class', k.id, k); n++; }
      for (const p of r.props) { await c.store.save('prop', p.id, p); applyWork(c.work, 'prop', p.id, p); n++; }
      for (const a of r.axioms) { await c.store.save('axiom', a.id, a); applyWork(c.work, 'axiom', a.id, a); n++; }
      for (const [id, f] of Object.entries(r.formal)) { const v = { ...f, by: f.by === 'spec' ? (by || 'импорт') : f.by, origin: 'import', date: today() }; await c.store.save('formal', id, v); applyWork(c.work, 'formal', id, v); n++; }
    } catch (e) { toast('Импорт прерван: ' + (e.message || e), null, null, true); }
    analyse();
    if (d.onWorkChanged) d.onWorkChanged();
    toast(`Импортировано записей: ${n}${r.unresolved.length ? `; не сопоставлено пунктов: ${r.unresolved.length} (${r.unresolved.slice(0, 3).join('; ')})` : ''}.`);
    render();
  }

  // ------------------------------------------------------------------ клавиши
  function hotkey(ev) {
    const c = cx();
    if (!c || S.view !== 'conflicts') return false;
    if (/^[1-5]$/.test(ev.key) && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      const r = document.querySelectorAll('input[name="cx-verdict"]')[Number(ev.key) - 1];
      if (r) { r.checked = true; ev.preventDefault(); return true; }
    }
    if (ev.key === 'n' || ev.key === 'т') {
      const list = filtered();
      const i = list.findIndex((x) => x.id === c.sel);
      const next = list.slice(i + 1).concat(list.slice(0, i + 1)).find((x) => x.status !== 'info' && !myVerdict(x));
      if (next) { c.sel = next.id; render(); }
      return true;
    }
    if (ev.key === 'j' || ev.key === 'k' || ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      const list = filtered();
      const i = list.findIndex((x) => x.id === c.sel);
      const j = Math.max(0, Math.min(list.length - 1, i + (ev.key === 'j' || ev.key === 'ArrowDown' ? 1 : -1)));
      if (list[j] && list[j].id !== c.sel) { c.sel = list[j].id; render(); ev.preventDefault(); }
      return true;
    }
    return false;
  }

  function panes() {
    if (S.view === 'conflicts') return [conflictsLeft(), conflictsCenter(), conflictsRight()];
    if (S.view === 'formal') return [formalLeft(), formalCenter(), formalRight()];
    if (S.view === 'axioms') return [axiomsLeft(), axiomsCenter(), axiomsRight()];
    return null;
  }

  return { attach, analyse, tabs, panes, hotkey, CONFLICT_VERDICTS };
}
