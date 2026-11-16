/**
 * Раздел 5.3 ТЗ — раскладка карты онтологии.
 *
 * Требование стабильности: координаты считаются один раз для версии онтологии
 * и не зависят ни от языка интерфейса, ни от выбранного термина, ни от оценок.
 * Поэтому здесь нет ни случайности, ни сортировки по меткам: только IRI,
 * порядок коллекций и структура иерархии. Один и тот же граф — побайтно один
 * и тот же JSON раскладки.
 *
 * Раскладка кластерная: каждый тематический блок (skos:Collection) — «остров»
 * с закреплённым местом; структурные классы — отдельный остров; при отсутствии
 * коллекций острова строятся по ветвям верхнего уровня.
 */
import { KIND } from './model.js';

export const MAP_LAYOUT_VERSION = 1;
const CELL = 10;      // шаг сетки узлов внутри острова
const PAD = 8;        // поля острова
const HEAD = 14;      // место под подпись острова
const GAP = 14;       // зазор между островами

function byIri(a, b) { return a.iri < b.iri ? -1 : a.iri > b.iri ? 1 : 0; }

/** Порядок внутри острова: обход иерархии в глубину, дети по IRI. */
function hierarchyOrder(model, members) {
  const set = new Set(members.map((e) => e.iri));
  const E = model.entities;
  const roots = members.filter((e) => !e.parents.some((p) => set.has(p))).sort(byIri);
  const out = [];
  const seen = new Set();
  const walk = (e) => {
    if (seen.has(e.iri)) return;
    seen.add(e.iri);
    out.push(e);
    const kids = e.children.map((c) => E.get(c)).filter((c) => c && set.has(c.iri)).sort(byIri);
    for (const k of kids) walk(k);
  };
  for (const r of roots) walk(r);
  for (const e of members.slice().sort(byIri)) walk(e);   // циклы и прочие хвосты
  return out;
}

/** Собрать острова: [{key, labelIri, label, members:[entity]}]. */
function islands(model) {
  const E = model.entities;
  const classes = model.classes;
  const out = [];
  const placed = new Set();
  if (model.collections.length) {
    const cols = model.collections.slice().sort(byIri);
    for (const c of cols) {
      const mem = c.members.map((m) => E.get(m)).filter((e) => e && !e.external && !placed.has(e.iri));
      mem.forEach((e) => placed.add(e.iri));
      out.push({ key: c.iri, labelIri: c.iri, members: mem });
    }
    const rest = classes.filter((e) => !placed.has(e.iri));
    if (rest.length) out.push({ key: '__structure__', labelIri: null, label: 'структура', members: rest });
    return out;
  }
  // без коллекций — ветви верхнего уровня
  const roots = model.roots.slice().sort(byIri);
  let tops = [];
  if (roots.length === 1) {
    const r = roots[0];
    tops = r.children.map((c) => E.get(c)).filter((c) => c && !c.external).sort(byIri);
    placed.add(r.iri);
  } else {
    tops = roots;
  }
  const small = [];
  for (const t of tops) {
    const mem = [];
    const stack = [t];
    while (stack.length) {
      const e = stack.pop();
      if (placed.has(e.iri)) continue;
      placed.add(e.iri);
      mem.push(e);
      for (const c of e.children) { const ce = E.get(c); if (ce && !ce.external) stack.push(ce); }
    }
    if (mem.length >= 3) out.push({ key: t.iri, labelIri: t.iri, members: mem });
    else small.push(...mem);
  }
  const rest = classes.filter((e) => !placed.has(e.iri));
  const tail = [...small, ...rest, ...(roots.length === 1 ? [roots[0]] : [])];
  if (tail.length) out.push({ key: '__other__', labelIri: null, label: 'прочее', members: tail });
  return out;
}

/**
 * Посчитать раскладку. Результат — чистые данные, пригодные для JSON.
 * @returns {{version, hash, width, height, islands:[{key,labelIri,label,x,y,w,h,count}], nodes:Object<iri,[x,y,islandIndex]>}}
 */
export function computeMapLayout(model) {
  const isl = islands(model);
  // размер острова — почти квадратная сетка
  const boxes = isl.map((it) => {
    const n = Math.max(1, it.members.length);
    const cols = Math.max(2, Math.ceil(Math.sqrt(n * 1.4)));
    const rows = Math.ceil(n / cols);
    return { ...it, cols, rows, w: PAD * 2 + cols * CELL, h: HEAD + PAD + rows * CELL + PAD / 2 };
  });
  // упаковка полками: ширина полосы подбирается под соотношение сторон ~4:3
  const area = boxes.reduce((a, b) => a + (b.w + GAP) * (b.h + GAP), 0);
  const maxW = Math.max(Math.max(...boxes.map((b) => b.w)), Math.ceil(Math.sqrt(area * 4 / 3)));
  let x = 0, y = 0, rowH = 0, width = 0;
  for (const b of boxes) {
    if (x > 0 && x + b.w > maxW) { x = 0; y += rowH + GAP; rowH = 0; }
    b.x = x; b.y = y;
    x += b.w + GAP;
    rowH = Math.max(rowH, b.h);
    width = Math.max(width, b.x + b.w);
  }
  const height = y + rowH;
  const nodes = {};
  boxes.forEach((b, bi) => {
    const ordered = hierarchyOrder(model, b.members);
    ordered.forEach((e, i) => {
      const cx = b.x + PAD + (i % b.cols) * CELL + CELL / 2;
      const cy = b.y + HEAD + Math.floor(i / b.cols) * CELL + CELL / 2;
      nodes[e.iri] = [cx, cy, bi];
    });
  });
  const iris = Object.keys(nodes).sort();
  const sortedNodes = {};
  for (const k of iris) sortedNodes[k] = nodes[k];
  return {
    version: MAP_LAYOUT_VERSION,
    hash: model.hash,
    width,
    height,
    islands: boxes.map((b) => ({
      key: b.key, labelIri: b.labelIri, label: b.label || null,
      x: b.x, y: b.y, w: b.w, h: b.h, count: b.members.length,
    })),
    nodes: sortedNodes,
  };
}

/** Проверить, что сохранённая раскладка годится для этого графа. */
export function layoutMatches(layout, model) {
  return layout && layout.version === MAP_LAYOUT_VERSION && layout.hash === model.hash
    && layout.nodes && typeof layout.nodes === 'object';
}

export function mapCacheKey(hash) { return 'ontolens.map.v1.' + hash; }

/**
 * Получить раскладку: приложенный map-layout.json → кэш браузера → расчёт.
 * @returns {{layout, source: 'file'|'cache'|'computed', ms:number}}
 */
export function obtainMapLayout(model, supplied) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (supplied && layoutMatches(supplied, model)) {
    return { layout: supplied, source: 'file', ms: 0 };
  }
  try {
    const raw = window.localStorage.getItem(mapCacheKey(model.hash));
    if (raw) {
      const l = JSON.parse(raw);
      if (layoutMatches(l, model)) return { layout: l, source: 'cache', ms: 0 };
    }
  } catch (e) { /* нет хранилища — считаем */ }
  const layout = computeMapLayout(model);
  try { window.localStorage.setItem(mapCacheKey(model.hash), JSON.stringify(layout)); } catch (e) { /* ignore */ }
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return { layout, source: 'computed', ms: Math.round(ms * 10) / 10 };
}

export { KIND };
