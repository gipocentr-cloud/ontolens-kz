/**
 * Локальный граф окрестности термина (раздел 5.2 ТЗ).
 *
 * Раскладка — собственная, детерминированная: узлы разложены по слоям
 * (предки выше, потомки ниже, соседи по объектным свойствам сбоку),
 * порядок внутри слоя задаётся стабильной сортировкой. Силовые раскладки
 * со случайной инициализацией не применяются: при каждом открытии картинка
 * должна быть одна и та же.
 *
 * Рендер — настоящий SVG с элементами <text>, поэтому экспорт в SVG
 * даёт редактируемый векторный текст без дополнительных плагинов.
 */
import { KIND, labelOf } from './model.js';

export const NODE_KIND = {
  FOCUS: 'focus',
  STRUCTURAL: 'structural',
  TERM: 'term',
  EXTERNAL: 'external',
  PROPERTY: 'property',
  DOCUMENT: 'document',
  SHAPE: 'shape',
  GROUP: 'group',
};

export const NODE_COLORS = {
  focus:      { fill: '#FFFFFF', stroke: '#C2410C', width: 2,   text: '#16181C' },
  structural: { fill: '#E7EAEE', stroke: '#94A3B8', width: 1,   text: '#16181C' },
  term:       { fill: '#FFFFFF', stroke: '#C9C4B8', width: 1,   text: '#16181C' },
  external:   { fill: '#EFEAF4', stroke: '#8B7BA8', width: 1,   text: '#332B40', dash: '4 3' },
  property:   { fill: '#FBF3E6', stroke: '#B9762C', width: 1,   text: '#4A3818' },
  document:   { fill: '#F3F1EA', stroke: '#9AA3AF', width: 1,   text: '#33302B', dash: '4 3' },
  shape:      { fill: '#EAF2F3', stroke: '#2F6F7E', width: 1,   text: '#1F4E59', dash: '4 3' },
  group:      { fill: '#F2F1EC', stroke: '#B5AFA2', width: 1,   text: '#5A5750', dash: '2 3' },
};

function kindOf(model, e) {
  if (e.external) return NODE_KIND.EXTERNAL;
  if (e.kinds.has(KIND.SHAPE)) return NODE_KIND.SHAPE;
  if (e.kinds.has(KIND.OBJECT_PROPERTY) || e.kinds.has(KIND.DATA_PROPERTY)) return NODE_KIND.PROPERTY;
  if (e.kinds.has(KIND.CLASS) || e.kinds.has(KIND.CONCEPT)) return e.isTerm ? NODE_KIND.TERM : NODE_KIND.STRUCTURAL;
  return NODE_KIND.DOCUMENT;
}

/**
 * Собрать окрестность: предки до корня, потомки на глубину depth,
 * соседи по объектным свойствам, документ-источник, SHACL-шейпы.
 */
export function neighbourhood(model, focusIri, opts = {}) {
  const depth = opts.depth == null ? 1 : opts.depth;
  const maxNodes = opts.maxNodes || 60;
  const E = model.entities;
  const focus = E.get(focusIri);
  if (!focus) return { nodes: [], edges: [] };

  const nodes = new Map();
  const edges = [];
  const addNode = (e, layer, kind) => {
    if (!nodes.has(e.iri)) nodes.set(e.iri, { iri: e.iri, entity: e, layer, kind: kind || kindOf(model, e) });
    else nodes.get(e.iri).layer = Math.min(nodes.get(e.iri).layer, layer);
    return nodes.get(e.iri);
  };
  const addEdge = (from, to, type, label) => {
    if (!edges.some((x) => x.from === from && x.to === to && x.type === type)) {
      edges.push({ from, to, type, label });
    }
  };

  addNode(focus, 0, NODE_KIND.FOCUS);

  // предки до корня
  let level = focus;
  let up = 0;
  const guard = new Set([focus.iri]);
  while (up < 6) {
    const parents = level.parents.map((p) => E.get(p)).filter(Boolean);
    if (!parents.length) break;
    up++;
    let next = null;
    for (const p of parents) {
      if (guard.has(p.iri)) continue;
      guard.add(p.iri);
      addNode(p, -up);
      addEdge(p.iri, level.iri, 'subClassOf');
      if (!next && !p.external) next = p;
    }
    if (!next) break;
    level = next;
  }

  // потомки
  const walkDown = (e, d, from) => {
    if (d > depth) return;
    for (const c of e.children) {
      const ce = E.get(c);
      if (!ce) continue;
      addNode(ce, d);
      addEdge(from, ce.iri, 'subClassOf');
      if (d < depth) walkDown(ce, d + 1, ce.iri);
    }
  };
  walkDown(focus, 1, focus.iri);

  // братья (дети того же родителя) — только на глубине 1
  if (opts.siblings !== false) {
    for (const p of focus.parents) {
      const pe = E.get(p);
      if (!pe || pe.external) continue;
      for (const c of pe.children) {
        if (c === focus.iri) continue;
        const ce = E.get(c);
        if (!ce) continue;
        if (nodes.size >= maxNodes) break;
        addNode(ce, 0);
        addEdge(p, c, 'subClassOf');
      }
    }
  }

  // документ-источник
  for (const p of focus.provenance) {
    if (!p.isIri) continue;
    const d = E.get(p.value);
    if (d) { addNode(d, 2, NODE_KIND.DOCUMENT); addEdge(focus.iri, d.iri, 'source', (opts.words || {}).source || 'источник'); }
  }
  // SHACL
  for (const s of focus.shapes) {
    const se = E.get(s);
    if (se) { addNode(se, 2, NODE_KIND.SHAPE); addEdge(focus.iri, se.iri, 'shacl', 'SHACL'); }
  }
  // соседи по объектным свойствам (в обе стороны)
  const skip = new Set(opts.skipProps || []);   // профиль: связи, которые не рисуются в окрестности (например, эвристические)
  for (const o of focus.outgoing) {
    if (skip.has(o.prop)) continue;
    const target = E.get(o.target);
    const prop = E.get(o.prop);
    if (!target) continue;
    if (target.kinds.has(KIND.SCHEME) || target.kinds.has(KIND.COLLECTION)) continue;
    addNode(target, 1);
    addEdge(focus.iri, target.iri, 'relation', prop ? labelOf(model, prop, opts.lang || 'ru').text : o.prop);
  }
  for (const i of focus.incoming) {
    if (skip.has(i.prop)) continue;
    const src = E.get(i.source);
    if (!src) continue;
    if (src.kinds.has(KIND.SCHEME) || src.kinds.has(KIND.COLLECTION)) continue;
    if (nodes.size >= maxNodes) break;
    const prop = E.get(i.prop);
    addNode(src, -1);
    addEdge(src.iri, focus.iri, 'relation', prop ? labelOf(model, prop, opts.lang || 'ru').text : i.prop);
  }
  // свойства, у которых фокус в домене или диапазоне
  if (opts.showProperties !== false) {
    for (const p of [...focus.domainOf, ...focus.rangeOf]) {
      if (nodes.size >= maxNodes) break;
      const pe = E.get(p);
      if (!pe) continue;
      addNode(pe, 2, NODE_KIND.PROPERTY);
      addEdge(focus.iri, pe.iri, focus.domainOf.includes(p) ? 'domain' : 'range',
        focus.domainOf.includes(p) ? ((opts.words || {}).domain || 'домен') : ((opts.words || {}).range || 'диапазон'));
    }
  }

  // свёртка при превышении лимита
  let list = [...nodes.values()];
  let collapsed = null;
  if (list.length > maxNodes) {
    const keep = new Set([focus.iri]);
    const byPriority = list.slice().sort((a, b) =>
      Math.abs(a.layer) - Math.abs(b.layer) || a.entity.local.localeCompare(b.entity.local));
    for (const n of byPriority) { if (keep.size < maxNodes - 1) keep.add(n.iri); }
    const dropped = list.filter((n) => !keep.has(n.iri));
    list = list.filter((n) => keep.has(n.iri));
    collapsed = { count: dropped.length, layer: 1 };
    list.push({ iri: '__collapsed__', entity: null, layer: 1, kind: NODE_KIND.GROUP, collapsedCount: dropped.length });
  }
  const alive = new Set(list.map((n) => n.iri));
  return {
    nodes: list,
    edges: edges.filter((e) => alive.has(e.from) && alive.has(e.to)),
    collapsed,
    focusIri,
  };
}

// --------------------------------------------------------------------------
//  Измерение текста и разбивка на строки
// --------------------------------------------------------------------------
let _ctx = null;
function measure(text, font) {
  if (typeof document === 'undefined') return text.length * 6.2;
  if (!_ctx) _ctx = document.createElement('canvas').getContext('2d');
  _ctx.font = font;
  return _ctx.measureText(text).width;
}

export function wrap(text, maxWidth, font, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (measure(test, font) > maxWidth && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  if (maxLines && lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    let last = cut[maxLines - 1];
    while (measure(last + '…', font) > maxWidth && last.length > 1) last = last.slice(0, -1);
    cut[maxLines - 1] = last + '…';
    return cut;
  }
  return lines;
}

const F_TITLE = '700 13px "PT Sans", system-ui, sans-serif';
const F_TITLE_FOCUS = '700 14px "PT Sans", system-ui, sans-serif';
const F_SUB = '12px "PT Sans", system-ui, sans-serif';
const F_META = '10px "IBM Plex Mono", ui-monospace, monospace';

/** Подготовить содержимое узла в зависимости от уровня детализации. */
export function nodeContent(model, node, lang, detail, words) {
  const W_ = words || { structural: 'структурный класс', more: 'ещё узлов' };
  if (node.kind === NODE_KIND.GROUP) {
    return { width: 150, height: 34, lines: [{ text: `+${node.collapsedCount} ${W_.more}`, font: F_SUB, dy: 21, fill: '#5A5750' }] };
  }
  const e = node.entity;
  const isFocus = node.kind === NODE_KIND.FOCUS;
  const W = isFocus ? 300 : (node.kind === NODE_KIND.STRUCTURAL ? 200 : 232);
  const pad = 12;
  const inner = W - pad * 2;
  const lines = [];
  let y = 0;

  const main = labelOf(model, e, lang);
  const titleFont = isFocus ? F_TITLE_FOCUS : F_TITLE;
  const titleLines = wrap(main.text, inner, titleFont, isFocus ? 3 : 2);
  y += 10;
  for (const l of titleLines) { y += isFocus ? 17 : 16; lines.push({ text: l, font: titleFont, dy: y, fill: NODE_COLORS[node.kind].text }); }

  if (detail >= 2 && (isFocus || node.kind === NODE_KIND.TERM)) {
    for (const lg of model.profile.languages) {
      if (lg === lang) continue;
      const arr = e.labels[lg];
      if (!arr || !arr.length) continue;
      const sub = wrap(arr[0].value, inner, F_SUB, 1);
      y += 15;
      lines.push({ text: sub[0], font: F_SUB, dy: y, fill: '#5A5750' });
    }
  }
  if (node.kind === NODE_KIND.STRUCTURAL && detail >= 2) {
    y += 14; lines.push({ text: W_.structural, font: F_META, dy: y, fill: '#52606F' });
  }
  if (node.kind === NODE_KIND.EXTERNAL) {
    y += 14; lines.push({ text: e.curie, font: F_META, dy: y, fill: '#6B5B86' });
  }
  if (node.kind === NODE_KIND.PROPERTY && detail >= 2) {
    y += 14; lines.push({ text: e.curie, font: F_META, dy: y, fill: '#6B675E' });
  }

  const badges = [];
  if (detail >= 2) {
    if (e.identifiers.length) badges.push({ text: 'ID ' + e.identifiers[0], tone: 'muted' });
    if (e.shapes.length) badges.push({ text: 'SHACL', tone: 'teal' });
    const doc = e.provenance.find((p) => p.isIri);
    if (doc) {
      const d = model.entities.get(doc.value);
      if (d) badges.push({ text: labelOf(model, d, lang).text, tone: 'mono' });
    }
  }
  if (badges.length) y += 20;
  const H = y + 11;
  return { width: W, height: Math.max(H, 34), lines, badges, badgeY: y };
}

// --------------------------------------------------------------------------
//  Детерминированная послойная раскладка
// --------------------------------------------------------------------------
export function layout(model, graph, lang, detail = 2, words) {
  const HGAP = 28;
  const VGAP = 54;
  const sized = graph.nodes.map((n) => {
    const c = nodeContent(model, n, lang, n.kind === NODE_KIND.FOCUS ? Math.max(detail, 2) : detail, words);
    return { ...n, ...c, content: c };
  });

  const raw = new Map();
  for (const n of sized) {
    const key = n.layer;
    (raw.get(key) || raw.set(key, []).get(key)).push(n);
  }
  const rawKeys = [...raw.keys()].sort((a, b) => a - b);

  // стабильный порядок внутри слоя
  for (const k of rawKeys) {
    raw.get(k).sort((a, b) => {
      const pa = a.kind === NODE_KIND.FOCUS ? 0 : 1;
      const pb = b.kind === NODE_KIND.FOCUS ? 0 : 1;
      if (pa !== pb) return pa - pb;
      const la = a.entity ? labelOf(model, a.entity, lang).text : 'я';
      const lb = b.entity ? labelOf(model, b.entity, lang).text : 'я';
      return la.localeCompare(lb, 'ru');
    });
  }

  // широкий слой переносится в несколько подстрок: 5 узлов в ряд —
  // иначе окрестность термина с 15 потомками вытягивается на 4 000 px
  const PER_ROW = 5;
  const layers = new Map();
  const keys = [];
  for (const k of rawKeys) {
    const row = raw.get(k);
    const chunks = [];
    for (let i = 0; i < row.length; i += PER_ROW) chunks.push(row.slice(i, i + PER_ROW));
    chunks.forEach((chunk, i) => {
      const key = k + i / (chunks.length + 1) * 0.9;
      layers.set(key, chunk);
      keys.push(key);
    });
  }
  keys.sort((a, b) => a - b);

  // вертикальные позиции слоёв
  let y = 0;
  const layerY = new Map();
  for (const k of keys) {
    layerY.set(k, y);
    y += Math.max(...layers.get(k).map((n) => n.height)) + VGAP;
  }
  const totalH = y - VGAP;

  // горизонтальные позиции — центрирование слоя
  let maxW = 0;
  for (const k of keys) {
    const row = layers.get(k);
    const w = row.reduce((a, n) => a + n.width, 0) + HGAP * (row.length - 1);
    maxW = Math.max(maxW, w);
  }
  for (const k of keys) {
    const row = layers.get(k);
    const w = row.reduce((a, n) => a + n.width, 0) + HGAP * (row.length - 1);
    let x = (maxW - w) / 2;
    for (const n of row) { n.x = x; n.y = layerY.get(k); x += n.width + HGAP; }
  }

  const byIri = new Map(sized.map((n) => [n.iri, n]));
  const edges = graph.edges.map((e) => {
    const a = byIri.get(e.from), b = byIri.get(e.to);
    if (!a || !b) return null;
    return { ...e, a, b };
  }).filter(Boolean);

  return { nodes: sized, edges, width: maxW, height: totalH, byIri };
}

// --------------------------------------------------------------------------
//  Рендер в SVG
// --------------------------------------------------------------------------
const SVGNS = 'http://www.w3.org/2000/svg';
function el(name, attrs, parent) {
  const n = document.createElementNS(SVGNS, name);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

const BADGE_TONES = {
  muted: { fill: '#EDE9DC', text: '#5A5750' },
  teal: { fill: '#EAF2F3', text: '#1F4E59' },
  green: { fill: '#E8F0E9', text: '#2E5A39' },
  mono: { fill: '#F3F1EA', text: '#33302B' },
};

export function renderGraph(laid, { onSelect, focusIri, standalone = false, title = '' } = {}) {
  const PAD = 30;
  const svg = el('svg', {
    xmlns: SVGNS,
    viewBox: `${-PAD} ${-PAD} ${laid.width + PAD * 2} ${laid.height + PAD * 2 + (standalone ? 30 : 0)}`,
    width: standalone ? laid.width + PAD * 2 : null,
    height: standalone ? laid.height + PAD * 2 + 30 : null,
    role: 'img',
  });
  if (standalone) {
    el('rect', { x: -PAD, y: -PAD, width: laid.width + PAD * 2, height: laid.height + PAD * 2 + 30, fill: '#FFFFFF' }, svg);
  }
  const defs = el('defs', null, svg);
  const marker = el('marker', { id: 'ol-arrow', viewBox: '0 0 8 8', refX: '7', refY: '4', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }, defs);
  el('path', { d: 'M0 0 L8 4 L0 8 z', fill: '#6B675E' }, marker);

  const gEdges = el('g', { class: 'ol-edges' }, svg);
  const gNodes = el('g', { class: 'ol-nodes' }, svg);

  for (const e of laid.edges) {
    const x1 = e.a.x + e.a.width / 2, y1 = e.a.y + e.a.height;
    const x2 = e.b.x + e.b.width / 2, y2 = e.b.y;
    const midY = (y1 + y2) / 2;
    const dashed = e.type !== 'subClassOf';
    const color = e.type === 'shacl' ? '#2F6F7E' : (e.type === 'relation' ? '#B9762C' : '#B5AFA2');
    if (y2 >= y1) {
      el('polyline', {
        points: `${x1},${y1} ${x1},${midY} ${x2},${midY} ${x2},${y2}`,
        fill: 'none', stroke: color, 'stroke-width': 1.6,
        'stroke-dasharray': dashed ? '5 4' : null,
        'marker-end': 'url(#ol-arrow)',
      }, gEdges);
    } else {
      // связь снизу вверх — обводим сбоку
      const sx = e.a.x + e.a.width / 2, sy = e.a.y;
      const tx = e.b.x + e.b.width / 2, ty = e.b.y + e.b.height;
      const my = Math.min(sy, ty) - 18;
      el('polyline', {
        points: `${sx},${sy} ${sx},${my} ${tx},${my} ${tx},${ty}`,
        fill: 'none', stroke: color, 'stroke-width': 1.6, 'stroke-dasharray': '5 4',
        'marker-end': 'url(#ol-arrow)',
      }, gEdges);
    }
    if (e.label && e.type !== 'subClassOf') {
      const t = el('text', {
        x: (x1 + x2) / 2, y: midY - 4, 'text-anchor': 'middle',
        'font-family': '"IBM Plex Mono", ui-monospace, monospace', 'font-size': 9.5, fill: '#6B675E',
      }, gEdges);
      t.textContent = e.label;
    }
  }

  for (const n of laid.nodes) {
    const c = NODE_COLORS[n.kind] || NODE_COLORS.term;
    const g = el('g', {
      class: 'ol-node ol-node-' + n.kind,
      transform: `translate(${n.x},${n.y})`,
      tabindex: standalone ? null : '0',
      role: standalone ? null : 'button',
    }, gNodes);
    if (n.entity) g.setAttribute('data-iri', n.entity.iri);
    el('rect', {
      x: 0, y: 0, width: n.width, height: n.height, rx: 7,
      fill: c.fill, stroke: c.stroke, 'stroke-width': c.width,
      'stroke-dasharray': c.dash || null,
    }, g);
    for (const l of n.lines) {
      const parts = /^(\d+(?:\.\d+)?)px\s+(.*)$/.exec(l.font.replace(/^(\d+)\s+/, '')) || [];
      const bold = /700/.test(l.font);
      const size = (/(\d+(?:\.\d+)?)px/.exec(l.font) || [0, 12])[1];
      const fam = /IBM Plex Mono/.test(l.font) ? '"IBM Plex Mono", ui-monospace, monospace' : '"PT Sans", system-ui, sans-serif';
      const t = el('text', {
        x: 12, y: l.dy, 'font-family': fam, 'font-size': size,
        'font-weight': bold ? 700 : 400, fill: l.fill,
      }, g);
      t.textContent = l.text;
    }
    if (n.badges && n.badges.length) {
      let bx = 12;
      for (const b of n.badges) {
        const tone = BADGE_TONES[b.tone] || BADGE_TONES.muted;
        const w = Math.min(measure(b.text, F_META) + 12, n.width - bx - 12);
        if (w < 16) break;
        el('rect', { x: bx, y: n.badgeY + 2, width: w, height: 14, rx: 7, fill: tone.fill }, g);
        const t = el('text', {
          x: bx + 6, y: n.badgeY + 12, 'font-family': '"IBM Plex Mono", ui-monospace, monospace',
          'font-size': 9.5, fill: tone.text,
        }, g);
        t.textContent = b.text;
        bx += w + 6;
      }
    }
    if (!standalone && n.entity && onSelect) {
      g.style.cursor = 'pointer';
      g.addEventListener('click', () => onSelect(n.entity.iri));
      g.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(n.entity.iri); }
      });
      const titleEl = el('title', null, g);
      titleEl.textContent = n.entity.curie;
    }
  }

  if (standalone && title) {
    const t = el('text', {
      x: 0, y: laid.height + 24, 'font-family': '"PT Sans", system-ui, sans-serif',
      'font-size': 11, fill: '#5A5750',
    }, svg);
    t.textContent = title;
  }
  return svg;
}

// ==========================================================================
//  Раздел 5.3 — семантический зум основного вида.
//  Каждый узел рисуется в четырёх вариантах; видимый выбирается по масштабу,
//  смена — через интерполяцию прозрачности (CSS). Положение узлов от уровня
//  не зависит: место («слот») каждому узлу отводится под самый подробный
//  вариант, остальные центрируются в нём.
// ==========================================================================
const F_PILL = '13px "PT Sans", system-ui, sans-serif';
const F_DEF = '12px "PT Sans", system-ui, sans-serif';

function truncate(text, n) { return text.length > n ? text.slice(0, n - 1).trimEnd() + '…' : text; }

function cardContent(model, node, lang, withDef, words, verdictOf) {
  const e = node.entity;
  const isFocus = node.kind === NODE_KIND.FOCUS;
  const W = isFocus ? 300 : (node.kind === NODE_KIND.STRUCTURAL ? 210 : 240);
  const inner = W - 24;
  const lines = [];
  let y = 10;
  const titleFont = isFocus ? F_TITLE_FOCUS : F_TITLE;
  for (const l of wrap(labelOf(model, e, lang).text, inner, titleFont, isFocus ? 3 : 2)) {
    y += isFocus ? 17 : 16; lines.push({ text: l, font: titleFont, dy: y, fill: NODE_COLORS[node.kind].text });
  }
  if (node.kind === NODE_KIND.FOCUS || node.kind === NODE_KIND.TERM) {
    for (const lg of model.profile.languages) {
      if (lg === lang) continue;
      const arr = e.labels[lg];
      if (!arr || !arr.length) continue;
      y += 15; lines.push({ text: wrap(arr[0].value, inner, F_SUB, 1)[0], font: F_SUB, dy: y, fill: '#5A5750' });
    }
  } else if (node.kind === NODE_KIND.STRUCTURAL) {
    y += 14; lines.push({ text: (words && words.structural) || 'структурный класс', font: F_META, dy: y, fill: '#52606F' });
  } else {
    y += 14; lines.push({ text: e.curie, font: F_META, dy: y, fill: '#6B675E' });
  }
  if (withDef) {
    const d = (e.definitions[lang] && e.definitions[lang][0]) || Object.values(e.definitions).flat()[0];
    if (d) {
      y += 8;
      const sep = y;
      for (const l of wrap(truncate(d.value, 140), inner, F_DEF, 4)) { y += 15; lines.push({ text: l, font: F_DEF, dy: y, fill: '#24262A' }); }
      lines.sepY = sep;
    }
  }
  const badges = [];
  const doc = e.provenance.find((p) => p.isIri);
  if (doc) { const d = model.entities.get(doc.value); if (d) badges.push({ text: labelOf(model, d, lang).text, tone: 'mono' }); }
  if (e.shapes.length) badges.push({ text: 'SHACL', tone: 'teal' });
  const v = verdictOf && verdictOf(e.iri);
  if (v) badges.push({ text: v.label, tone: v.code === 'ok' ? 'green' : 'muted', verdict: v });
  if (badges.length) y += 20;
  return { kind: 'card', width: W, height: Math.max(y + 11, 34), lines, badges, badgeY: y, sepY: lines.sepY };
}

export function lodContents(model, node, lang, words, verdictOf) {
  if (node.kind === NODE_KIND.GROUP) {
    const c = { kind: 'card', width: 150, height: 34, lines: [{ text: `+${node.collapsedCount} ${(words && words.more) || 'ещё узлов'}`, font: F_SUB, dy: 21, fill: '#5A5750' }], badges: [] };
    return [{ kind: 'dot', r: 8, width: 16, height: 16 }, { kind: 'pill', text: `+${node.collapsedCount}`, width: 60, height: 28 }, c, c];
  }
  const isFocus = node.kind === NODE_KIND.FOCUS;
  // на дальнем плане масштаб мал (< 0,4), поэтому фигуры крупные: 20–28 единиц дают 6–11 px на экране
  const r = isFocus ? 28 : 20;
  const label = labelOf(model, node.entity, lang).text;
  const pillText = truncate(label, 24);
  const pw = Math.ceil(measure(pillText, F_PILL)) + 38;
  return [
    { kind: 'dot', r, width: r * 2, height: r * 2 },
    { kind: 'pill', text: pillText, width: pw, height: 30 },
    cardContent(model, node, lang, false, words, verdictOf),
    cardContent(model, node, lang, true, words, verdictOf),
  ];
}

/** Раскладка для интерактивного вида: слоты под самый подробный вариант. */
export function layoutLOD(model, graph, lang, words, verdictOf) {
  const g2 = { ...graph, nodes: graph.nodes.map((n) => ({ ...n })) };
  const lods = new Map();
  for (const n of g2.nodes) lods.set(n.iri, lodContents(model, n, lang, words, verdictOf));
  // подменяем размеры для общей раскладки: ширина и высота слота = вариант 3
  const laid = layout(model, g2, lang, 2, words);
  for (const n of laid.nodes) {
    const L = lods.get(n.iri);
    const slotW = Math.max(L[3].width, n.width);
    const slotH = Math.max(L[3].height, n.height);
    n.lod = L; n.slotW = slotW; n.slotH = slotH;
  }
  // пересчитать позиции с размерами слотов — тем же детерминированным алгоритмом
  const HGAP = 28, VGAP = 58, PER_ROW = 5;
  const raw = new Map();
  for (const n of laid.nodes) (raw.get(n.layer) || raw.set(n.layer, []).get(n.layer)).push(n);
  const rawKeys = [...raw.keys()].sort((a, b) => a - b);
  for (const k of rawKeys) {
    raw.get(k).sort((a, b) => {
      const pa = a.kind === NODE_KIND.FOCUS ? 0 : 1, pb = b.kind === NODE_KIND.FOCUS ? 0 : 1;
      if (pa !== pb) return pa - pb;
      const la = a.entity ? labelOf(model, a.entity, lang).text : 'я';
      const lb = b.entity ? labelOf(model, b.entity, lang).text : 'я';
      return la.localeCompare(lb, 'ru');
    });
  }
  const rows = [];
  for (const k of rawKeys) {
    const row = raw.get(k);
    for (let i = 0; i < row.length; i += PER_ROW) rows.push(row.slice(i, i + PER_ROW));
  }
  let y = 0, maxW = 0;
  for (const row of rows) maxW = Math.max(maxW, row.reduce((a, n) => a + n.slotW, 0) + HGAP * (row.length - 1));
  for (const row of rows) {
    const w = row.reduce((a, n) => a + n.slotW, 0) + HGAP * (row.length - 1);
    let x = (maxW - w) / 2;
    const h = Math.max(...row.map((n) => n.slotH));
    for (const n of row) { n.x = x; n.y = y + (h - n.slotH) / 2; n.width = n.slotW; n.height = n.slotH; x += n.slotW + HGAP; }
    y += h + VGAP;
  }
  laid.width = maxW;
  laid.height = y - VGAP;
  return laid;
}

/** Прямоугольник видимого варианта узла внутри слота. */
function lodBox(n, level) {
  const c = n.lod[level];
  const w = c.kind === 'dot' ? c.r * 2 : c.width;
  const h = c.kind === 'dot' ? c.r * 2 : c.height;
  return { x: n.x + (n.slotW - w) / 2, y: n.y + (n.slotH - h) / 2, w, h };
}

function dotShape(g, kind, cx, cy, r, c) {
  const common = { fill: c.fill, stroke: c.stroke, 'stroke-width': r > 10 ? (kind === NODE_KIND.FOCUS ? 6 : 3.5) : (kind === NODE_KIND.FOCUS ? 2.5 : 1.4) };
  if (kind === NODE_KIND.STRUCTURAL) return el('rect', { x: cx - r, y: cy - r, width: r * 2, height: r * 2, rx: 3, ...common }, g);
  if (kind === NODE_KIND.EXTERNAL) return el('path', { d: `M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z`, ...common }, g);
  if (kind === NODE_KIND.DOCUMENT || kind === NODE_KIND.SHAPE) {
    return el('rect', { x: cx - r, y: cy - r * 0.75, width: r * 2, height: r * 1.5, rx: 2, 'stroke-dasharray': '3 2', ...common }, g);
  }
  if (kind === NODE_KIND.PROPERTY) return el('path', { d: `M${cx} ${cy - r}L${cx + r} ${cy + r * 0.8}L${cx - r} ${cy + r * 0.8}Z`, ...common }, g);
  return el('circle', { cx, cy, r, ...common }, g);
}

function drawCard(g, n, c, box, colors) {
  el('rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx: 8, fill: colors.fill, stroke: colors.stroke,
    'stroke-width': colors.width, 'stroke-dasharray': colors.dash || null,
    filter: n.kind === NODE_KIND.FOCUS ? 'url(#ol-shadow)' : null }, g);
  if (c.sepY) el('line', { x1: box.x + 12, x2: box.x + box.w - 12, y1: box.y + c.sepY, y2: box.y + c.sepY, stroke: '#EAE7DE' }, g);
  for (const l of c.lines) {
    const bold = /700/.test(l.font);
    const size = (/(\d+(?:\.\d+)?)px/.exec(l.font) || [0, 12])[1];
    const fam = /IBM Plex Mono/.test(l.font) ? '"IBM Plex Mono", ui-monospace, monospace' : '"PT Sans", system-ui, sans-serif';
    const t = el('text', { x: box.x + 12, y: box.y + l.dy, 'font-family': fam, 'font-size': size, 'font-weight': bold ? 700 : 400, fill: l.fill }, g);
    t.textContent = l.text;
  }
  let bx = box.x + 12;
  for (const b of c.badges || []) {
    const tone = BADGE_TONES[b.tone] || BADGE_TONES.muted;
    const w = Math.min(measure(b.text, F_META) + 12 + (b.verdict ? 10 : 0), box.x + box.w - bx - 12);
    if (w < 16) break;
    el('rect', { x: bx, y: box.y + c.badgeY + 2, width: w, height: 14, rx: 7, fill: tone.fill }, g);
    let tx = bx + 6;
    if (b.verdict) { el('circle', { cx: bx + 8, cy: box.y + c.badgeY + 9, r: 3, fill: b.verdict.color }, g); tx += 8; }
    const t = el('text', { x: tx, y: box.y + c.badgeY + 12, 'font-family': '"IBM Plex Mono", ui-monospace, monospace', 'font-size': 9.5, fill: tone.text }, g);
    t.textContent = b.text;
    bx += w + 6;
  }
}

/** Интерактивный граф с четырьмя уровнями детализации. */
export function renderGraphLOD(laid, { onSelect, onExpand, expandLabel, ariaLabel } = {}) {
  const PAD = 30;
  const svg = el('svg', { xmlns: SVGNS, class: 'ol-graph', 'data-lod': '2',
    viewBox: `${-PAD} ${-PAD} ${laid.width + PAD * 2} ${laid.height + PAD * 2}`, role: 'group',
    'aria-label': ariaLabel || 'Окрестность термина' });
  const defs = el('defs', null, svg);
  const marker = el('marker', { id: 'ol-arrow', viewBox: '0 0 8 8', refX: '7', refY: '4', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }, defs);
  el('path', { d: 'M0 0 L8 4 L0 8 z', fill: '#6B675E' }, marker);
  const f = el('filter', { id: 'ol-shadow', x: '-10%', y: '-10%', width: '120%', height: '130%' }, defs);
  el('feDropShadow', { dx: 0, dy: 3, stdDeviation: 4, 'flood-color': '#16181C', 'flood-opacity': 0.12 }, f);

  const levels = [0, 1, 2, 3];
  const gEdges = levels.map((lv) => el('g', { class: `lod lod-${lv} ol-edges` }, svg));
  const gNodes = el('g', { class: 'ol-nodes' }, svg);

  for (const lv of levels) {
    for (const e of laid.edges) {
      const a = lodBox(e.a, lv), b = lodBox(e.b, lv);
      const x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + b.w / 2, y2 = b.y;
      const dashed = e.type !== 'subClassOf';
      const color = e.type === 'shacl' ? '#2F6F7E' : (e.type === 'relation' ? '#B9762C' : '#B5AFA2');
      const midY = (y1 + y2) / 2;
      const pts = y2 >= y1
        ? `${x1},${y1} ${x1},${midY} ${x2},${midY} ${x2},${y2}`
        : `${a.x + a.w / 2},${a.y} ${a.x + a.w / 2},${Math.min(a.y, b.y + b.h) - 18} ${x2},${Math.min(a.y, b.y + b.h) - 18} ${x2},${b.y + b.h}`;
      el('polyline', { points: pts, fill: 'none', stroke: color, 'stroke-width': 1.6,
        'stroke-dasharray': dashed ? '5 4' : null, 'marker-end': lv > 0 ? 'url(#ol-arrow)' : null }, gEdges[lv]);
      if (lv >= 2 && e.label && e.type !== 'subClassOf') {
        const t = el('text', { x: (x1 + x2) / 2, y: midY - 4, 'text-anchor': 'middle',
          'font-family': '"IBM Plex Mono", ui-monospace, monospace', 'font-size': 9.5, fill: '#6B675E' }, gEdges[lv]);
        t.textContent = e.label;
      }
    }
  }

  for (const n of laid.nodes) {
    const colors = NODE_COLORS[n.kind] || NODE_COLORS.term;
    const g = el('g', { class: 'ol-node ol-node-' + n.kind, tabindex: n.entity ? '0' : null, role: n.entity ? 'button' : null }, gNodes);
    if (n.entity) g.setAttribute('data-iri', n.entity.iri);
    // невидимая область попадания — один и тот же слот на всех уровнях
    el('rect', { x: n.x, y: n.y, width: n.slotW, height: n.slotH, fill: 'transparent', class: 'hit' }, g);
    // 0 — дальний план: форма и цвет типа
    const g0 = el('g', { class: 'lod lod-0' }, g);
    const b0 = lodBox(n, 0);
    dotShape(g0, n.kind, b0.x + b0.w / 2, b0.y + b0.h / 2, n.lod[0].r, colors);
    if (n.kind === NODE_KIND.FOCUS) el('circle', { cx: b0.x + b0.w / 2, cy: b0.y + b0.h / 2, r: n.lod[0].r + 12, fill: 'none', stroke: '#C2410C', 'stroke-opacity': 0.25, 'stroke-width': 10 }, g0);
    // 1 — средний план: кружок + метка до 24 символов
    const g1 = el('g', { class: 'lod lod-1' }, g);
    const b1 = lodBox(n, 1);
    el('rect', { x: b1.x, y: b1.y, width: b1.w, height: b1.h, rx: b1.h / 2, fill: '#FFFFFF', stroke: colors.stroke, 'stroke-width': n.kind === NODE_KIND.FOCUS ? 2 : 1.2, 'stroke-dasharray': colors.dash || null }, g1);
    dotShape(g1, n.kind, b1.x + 15, b1.y + b1.h / 2, 5.5, n.kind === NODE_KIND.FOCUS ? { fill: '#C2410C', stroke: '#C2410C' } : colors);
    const t1 = el('text', { x: b1.x + 27, y: b1.y + b1.h / 2 + 4.5, 'font-family': '"PT Sans", system-ui, sans-serif', 'font-size': 13, fill: '#16181C', 'font-weight': n.kind === NODE_KIND.FOCUS ? 700 : 400 }, g1);
    t1.textContent = n.lod[1].text;
    // 2 — ближний план: карточка; 3 — карточка с началом определения
    for (const lv of [2, 3]) {
      const gl = el('g', { class: `lod lod-${lv}` }, g);
      drawCard(gl, n, n.lod[lv], lodBox(n, lv), colors);
    }
    if (n.entity && onSelect) {
      g.style.cursor = 'pointer';
      g.addEventListener('click', () => onSelect(n.entity.iri));
      g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(n.entity.iri); } });
      const tt = el('title', null, g); tt.textContent = n.entity.curie;
    } else if (n.kind === NODE_KIND.GROUP && onExpand) {
      // свёрнутые узлы раскрываются по клику: лимит окрестности поднимается
      g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button');
      g.setAttribute('data-tip', expandLabel || 'Показать скрытые узлы');
      g.style.cursor = 'pointer';
      g.addEventListener('click', onExpand);
      g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onExpand(); } });
    }
  }
  return svg;
}

/** Уровень детализации по масштабу и порогам профиля. */
export function lodLevel(k, thresholds) {
  const [a, b, c] = thresholds && thresholds.length === 3 ? thresholds : [0.4, 0.8, 1.6];
  return k < a ? 0 : k < b ? 1 : k < c ? 2 : 3;
}
