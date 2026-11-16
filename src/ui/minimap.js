/**
 * Раздел 5.3 ТЗ — миникарта онтологии «вы здесь».
 *
 * Два слоя. Нижний — растровый: острова и точки терминов рисуются один раз
 * в offscreen canvas при загрузке (и заново — только когда меняются оценки).
 * При навигации, зуме и панорамировании этот растр лишь переносится на
 * видимый canvas одной операцией drawImage. Верхний слой — SVG: отметка
 * положения, путь до корня, след, рамка области основного вида, подписи.
 *
 * Экземпляр живёт всё время работы с онтологией: при перерисовке интерфейса
 * его DOM-узел переносится в новое место, а не строится заново.
 */
const SVGNS = 'http://www.w3.org/2000/svg';
const NEUTRAL = '#D6D3CC';

function el(tag, attrs, parent) {
  const n = tag === 'svg' || /^(g|rect|circle|line|polyline|path|text|title)$/.test(tag)
    ? document.createElementNS(SVGNS, tag) : document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

export class MiniMap {
  /**
   * @param {object} o
   *  layout, model, verdictOf(iri) → code|null, verdictColor(code), labelOf(iri) → text,
   *  islandLabel(island) → text, onSelect(iri), prefs {collapsed, expanded, corner}, savePrefs(p),
   *  texts {title, here, outside, expand, shrink, corner, collapse, reset}
   */
  constructor(o) {
    Object.assign(this, o);
    this.focus = null;
    this.trail = [];
    this.frameIris = [];
    this.view = null;           // {k, tx, ty}
    this.level = 0;
    this.stats = { buildMs: 0, frames: 0 };
    this.root = el('div', { class: 'minimap', role: 'region', 'aria-label': this.texts.title });
    this._build();
    this.rebuildBase();
  }

  // ------------------------------------------------------------------ DOM
  _build() {
    const r = this.root;
    const head = el('div', { class: 'mm-head' }, r);
    const title = el('span', { class: 'mm-title' }, head);
    title.textContent = this.texts.title;
    const tools = el('span', { class: 'mm-tools' }, head);
    const mkBtn = (label, tip, fn, cls) => {
      const b = el('button', { type: 'button', class: 'mm-btn ' + (cls || ''), 'data-tip': tip, 'aria-label': tip }, tools);
      b.textContent = label;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      return b;
    };
    if (this.onExport) mkBtn('⤓', this.texts.export, () => this.onExport());
    this.btnCorner = mkBtn('◰', this.texts.corner, () => this.cycleCorner());
    this.btnExpand = mkBtn('⤢', this.texts.expand, () => this.toggleExpanded());
    this.btnCollapse = mkBtn('M', this.texts.collapse, () => this.toggleCollapsed(), 'mono');

    this.body = el('div', { class: 'mm-body' }, r);
    this.canvas = el('canvas', { class: 'mm-canvas', 'aria-hidden': 'true' }, this.body);
    this.svg = el('svg', { class: 'mm-svg', xmlns: SVGNS }, this.body);
    this.gLabels = el('g', { class: 'mm-labels' }, this.svg);
    this.gPath = el('g', { class: 'mm-path' }, this.svg);
    this.gTrail = el('g', { class: 'mm-trail' }, this.svg);
    this.frame = el('rect', { class: 'mm-frame', rx: 3 }, this.svg);
    this.gMarker = el('g', { class: 'mm-marker' }, this.svg);
    this.caption = el('div', { class: 'mm-caption' }, this.body);

    this._bindEvents();
    this.applyPrefs();
  }

  applyPrefs() {
    const p = this.prefs;
    this.root.classList.toggle('collapsed', !!p.collapsed);
    this.root.classList.toggle('expanded', !!p.expanded);
    this.root.dataset.corner = p.corner || 'bottom-right';
    this.btnExpand.textContent = p.expanded ? '⤡' : '⤢';
    this.btnExpand.setAttribute('data-tip', p.expanded ? this.texts.shrink : this.texts.expand);
    this.btnExpand.setAttribute('aria-label', p.expanded ? this.texts.shrink : this.texts.expand);
  }

  toggleCollapsed() { this.prefs.collapsed = !this.prefs.collapsed; this.savePrefs(this.prefs); this.applyPrefs(); this.resize(); }
  toggleExpanded() { this.prefs.expanded = !this.prefs.expanded; this.prefs.collapsed = false; this.savePrefs(this.prefs); this.applyPrefs(); this.view = null; this.resize(); }
  cycleCorner() {
    const order = ['bottom-right', 'bottom-left', 'top-left', 'top-right'];
    this.prefs.corner = order[(order.indexOf(this.prefs.corner || 'bottom-right') + 1) % order.length];
    this.savePrefs(this.prefs); this.applyPrefs();
  }

  attach(container) {
    if (this.root.parentNode !== container) container.appendChild(this.root);
    requestAnimationFrame(() => this.resize());
  }

  // ------------------------------------------------------------------ растровый слой
  /** Нарисовать острова и точки в offscreen canvas. Вызывается при загрузке и при смене оценок. */
  rebuildBase() {
    const t0 = performance.now();
    const L = this.layout;
    const res = Math.max(1, Math.min(8, 4096 / Math.max(L.width, L.height, 1)));
    this.res = res;
    const W = Math.ceil(L.width * res) + 2, H = Math.ceil(L.height * res) + 2;
    const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
    const islandsOnly = mk(), withDots = mk();
    const progress = this.islandProgress();
    for (const cv of [islandsOnly, withDots]) {
      const g = cv.getContext('2d');
      g.scale(res, res);
      L.islands.forEach((is, i) => {
        const pr = progress[i];
        g.fillStyle = pr.fill; g.strokeStyle = pr.stroke; g.lineWidth = 1 / res * 1.2;
        roundRect(g, is.x, is.y, is.w, is.h, 3);
        g.fill(); g.stroke();
      });
    }
    const g = withDots.getContext('2d');
    g.scale(res, res);
    for (const [iri, [x, y]] of Object.entries(L.nodes)) {
      const v = this.verdictOf(iri);
      g.fillStyle = v ? this.verdictColor(v) : '#FFFFFF';
      g.strokeStyle = v ? 'rgba(0,0,0,0.15)' : '#A8A296';
      g.lineWidth = 0.6;
      g.beginPath(); g.arc(x, y, 2.6, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    this.base = { islandsOnly, withDots };
    this.progress = progress;
    this.stats.buildMs = Math.round((performance.now() - t0) * 10) / 10;
    this.draw();
  }

  islandProgress() {
    const L = this.layout;
    const per = L.islands.map(() => ({ total: 0, done: 0, remarks: 0 }));
    for (const [iri, [, , bi]] of Object.entries(L.nodes)) {
      const p = per[bi];
      if (!this.isReviewable(iri)) continue;
      p.total++;
      const v = this.verdictOf(iri);
      if (v) { p.done++; if (v !== 'ok') p.remarks++; }
    }
    return per.map((p) => {
      let fill = '#E3E0D8', stroke = '#C4BEB1';
      if (p.total && p.done) {
        if (p.remarks) { fill = '#E4D3B0'; stroke = '#C4AD80'; }
        else if (p.done === p.total) { fill = '#BFD8C4'; stroke = '#93B89C'; }
        else { fill = '#D3E2D6'; stroke = '#A3BCA9'; }
      }
      return { ...p, fill, stroke };
    });
  }

  // ------------------------------------------------------------------ вид
  resize() {
    const rect = this.body.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.svg.setAttribute('width', rect.width);
    this.svg.setAttribute('height', rect.height);
    this.w = rect.width; this.h = rect.height;
    if (!this.view) this.view = this.fitView();
    this.draw();
  }

  fitView(box) {
    const L = this.layout;
    const b = box || { x: 0, y: 0, w: L.width, h: L.height };
    const m = 8;
    const k = Math.min((this.w - m * 2) / b.w, (this.h - m * 2) / b.h);
    return { k, tx: (this.w - b.w * k) / 2 - b.x * k, ty: (this.h - b.h * k) / 2 - b.y * k };
  }

  fitK() { const L = this.layout; return Math.min((this.w - 16) / L.width, (this.h - 16) / L.height); }

  levelFor(k) {
    const rel = k / this.fitK();
    return rel < 1.9 ? 0 : rel < 4.2 ? 1 : 2;
  }

  toScreen(x, y) { const v = this.view; return [x * v.k + v.tx, y * v.k + v.ty]; }
  toMap(px, py) { const v = this.view; return [(px - v.tx) / v.k, (py - v.ty) / v.k]; }

  // ------------------------------------------------------------------ отрисовка
  draw() {
    if (!this.view || !this.w) return;
    this.level = this.levelFor(this.view.k);
    this.root.dataset.level = String(this.level);
    const ctx = this.canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#F7F6F1';
    ctx.fillRect(0, 0, this.w, this.h);
    const img = this.level === 0 ? this.base.islandsOnly : this.base.withDots;
    const v = this.view;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, v.tx, v.ty, img.width / this.res * v.k, img.height / this.res * v.k);
    this.drawLabels();
    this.drawOverlay();
    this.stats.frames++;
  }

  drawLabels() {
    const g = this.gLabels;
    while (g.firstChild) g.removeChild(g.firstChild);
    const L = this.layout;
    const v = this.view;
    L.islands.forEach((is, i) => {
      const [x, y] = this.toScreen(is.x, is.y);
      const w = is.w * v.k;
      if (w < 26) return;
      const pr = this.progress[i];
      const name = this.islandLabel(is);
      const count = pr.total ? `${pr.done}/${pr.total}` : String(is.count);
      const maxChars = Math.max(2, Math.floor((w - 8) / 5.6));
      const t = el('text', { x: x + 4, y: y + 10, class: 'mm-island' }, g);
      t.textContent = name.length > maxChars ? name.slice(0, maxChars - 1) + '…' : name;
      const tt = el('title', null, t); tt.textContent = `${name} — ${count}`;
      // на уровне 0 — вторая строка с прогрессом, если остров достаточно высокий
      if (this.level === 0 && is.h * v.k >= 26) {
        const c = el('text', { x: x + 4, y: y + 21, class: 'mm-island mm-count' }, g);
        c.textContent = count;
      }
    });
    if (this.level < 2) return;
    // подписи узлов — только видимых
    const cell = 10 * v.k;
    const maxChars = Math.floor((cell - 6) / 5.2);
    if (maxChars < 3) return;
    for (const [iri, [x, y]] of Object.entries(L.nodes)) {
      const [sx, sy] = this.toScreen(x, y);
      if (sx < -20 || sy < -10 || sx > this.w + 20 || sy > this.h + 10) continue;
      const lbl = this.labelOf(iri);
      const t = el('text', { x: sx + 4, y: sy + 3, class: 'mm-node' }, g);
      t.textContent = lbl.length > maxChars ? lbl.slice(0, maxChars - 1) + '…' : lbl;
    }
  }

  drawOverlay() {
    const L = this.layout;
    // путь до корня
    const gp = this.gPath;
    while (gp.firstChild) gp.removeChild(gp.firstChild);
    if (this.pathIris && this.pathIris.length > 1) {
      const pts = this.pathIris.map((i) => L.nodes[i]).filter(Boolean).map(([x, y]) => this.toScreen(x, y));
      if (pts.length > 1) el('polyline', { points: pts.map((p) => p.join(',')).join(' '), class: 'mm-pathline' }, gp);
    }
    // след
    const gt = this.gTrail;
    while (gt.firstChild) gt.removeChild(gt.firstChild);
    const tr = this.trail.filter((i) => L.nodes[i] && i !== this.focus);
    if (tr.length) {
      const pts = [...tr, this.focus].filter((i) => L.nodes[i]).map((i) => this.toScreen(L.nodes[i][0], L.nodes[i][1]));
      if (pts.length > 1) el('polyline', { points: pts.map((p) => p.join(',')).join(' '), class: 'mm-trailline' }, gt);
      tr.forEach((iri, i) => {
        const [x, y] = this.toScreen(L.nodes[iri][0], L.nodes[iri][1]);
        const op = 0.25 + 0.5 * (i + 1) / tr.length;
        const c = el('circle', { cx: x, cy: y, r: 4, class: 'mm-trailpt', 'fill-opacity': op.toFixed(2), tabindex: '-1' }, gt);
        const tt = el('title', null, c); tt.textContent = this.labelOf(iri);
        c.addEventListener('click', (e) => { e.stopPropagation(); this.onSelect(iri); });
      });
    }
    // рамка области основного вида
    const pts = this.frameIris.map((i) => L.nodes[i]).filter(Boolean);
    if (pts.length && !this.dragFrame) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      const [sx0, sy0] = this.toScreen(x0 - 6, y0 - 6);
      const [sx1, sy1] = this.toScreen(x1 + 6, y1 + 6);
      this.frameBox = { x: sx0, y: sy0, w: Math.max(10, sx1 - sx0), h: Math.max(10, sy1 - sy0) };
    }
    if (this.frameBox && pts.length) {
      const b = this.frameBox;
      this.frame.setAttribute('x', b.x); this.frame.setAttribute('y', b.y);
      this.frame.setAttribute('width', b.w); this.frame.setAttribute('height', b.h);
      this.frame.style.display = '';
    } else {
      this.frame.style.display = 'none';
    }
    // отметка «вы здесь»
    const gm = this.gMarker;
    while (gm.firstChild) gm.removeChild(gm.firstChild);
    const pos = this.focus && L.nodes[this.focus];
    if (pos) {
      const [x, y] = this.toScreen(pos[0], pos[1]);
      el('circle', { cx: x, cy: y, r: 9, class: 'mm-halo' + (this.pulse ? ' pulse' : '') }, gm);
      el('circle', { cx: x, cy: y, r: 5.5, class: 'mm-here' }, gm);
      el('path', { d: `M${x - 3} ${y}h6M${x} ${y - 3}v6`, class: 'mm-plus' }, gm);
      this.pulse = false;
      this.caption.textContent = this.texts.here(this.islandLabel(L.islands[pos[2]]));
    } else {
      this.caption.textContent = this.focus ? this.texts.outside : '';
    }
  }

  // ------------------------------------------------------------------ состояние
  setFocus(iri, { trail, pathIris, frameIris }) {
    const changed = iri !== this.focus;
    this.focus = iri;
    this.trail = trail || [];
    this.pathIris = pathIris || [];
    this.frameIris = frameIris || [];
    this.frameBox = null;
    if (changed) this.pulse = true;
    // если отметка вне видимой части карты — сдвинуть вид, масштаб не трогать
    const pos = iri && this.layout.nodes[iri];
    if (pos && this.view && this.w) {
      const [x, y] = this.toScreen(pos[0], pos[1]);
      if (x < 6 || y < 6 || x > this.w - 6 || y > this.h - 6) {
        this.view = { ...this.view, tx: this.w / 2 - pos[0] * this.view.k, ty: this.h / 2 - pos[1] * this.view.k };
      }
    }
    this.draw();
  }

  /** Обновить рамку области основного вида (без перерисовки растра). */
  setFrame(iris) {
    if (this.dragFrame) return;
    this.frameIris = iris || [];
    this.frameBox = null;
    if (this.view && this.w) this.drawOverlay();
  }

  // ------------------------------------------------------------------ события
  nodeAt(px, py) {
    if (this.level === 0) return null;
    const [mx, my] = this.toMap(px, py);
    let best = null, bd = (7 / this.view.k) ** 2;
    for (const [iri, [x, y]] of Object.entries(this.layout.nodes)) {
      const d = (x - mx) ** 2 + (y - my) ** 2;
      if (d < bd) { bd = d; best = iri; }
    }
    return best;
  }
  islandAt(px, py) {
    const [mx, my] = this.toMap(px, py);
    return this.layout.islands.find((is) => mx >= is.x && mx <= is.x + is.w && my >= is.y && my <= is.y + is.h) || null;
  }
  nearestNode(mx, my) {
    let best = null, bd = Infinity;
    for (const [iri, [x, y]] of Object.entries(this.layout.nodes)) {
      if (!this.isReviewable(iri)) continue;
      const d = (x - mx) ** 2 + (y - my) ** 2;
      if (d < bd) { bd = d; best = iri; }
    }
    return best;
  }

  animateTo(target, ms = 220) {
    const from = { ...this.view };
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { this.view = target; this.draw(); return; }
    const t0 = performance.now();
    const step = (t) => {
      const u = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - u, 3);
      this.view = { k: from.k + (target.k - from.k) * e, tx: from.tx + (target.tx - from.tx) * e, ty: from.ty + (target.ty - from.ty) * e };
      this.draw();
      if (u < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  _bindEvents() {
    const b = this.body;
    b.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const r = b.getBoundingClientRect();
      const px = ev.clientX - r.left, py = ev.clientY - r.top;
      const f = Math.exp(-ev.deltaY * 0.0018);
      const k0 = this.fitK();
      const k = Math.min(k0 * 14, Math.max(k0 * 0.8, this.view.k * f));
      const v = this.view;
      this.view = { k, tx: px - (px - v.tx) * (k / v.k), ty: py - (py - v.ty) * (k / v.k) };
      this.draw();
    }, { passive: false });

    let drag = null;
    b.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      const r = b.getBoundingClientRect();
      const px = ev.clientX - r.left, py = ev.clientY - r.top;
      const fb = this.frameBox;
      const onFrame = fb && this.frame.style.display !== 'none'
        && px >= fb.x && px <= fb.x + fb.w && py >= fb.y && py <= fb.y + fb.h;
      drag = { px, py, sx: px, sy: py, mode: onFrame ? 'frame' : 'pan', view: { ...this.view }, fb: fb && { ...fb }, moved: false };
      if (onFrame) this.dragFrame = true;
      b.setPointerCapture(ev.pointerId);
    });
    b.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      const r = b.getBoundingClientRect();
      const px = ev.clientX - r.left, py = ev.clientY - r.top;
      if (Math.abs(px - drag.sx) + Math.abs(py - drag.sy) > 3) drag.moved = true;
      if (drag.mode === 'frame') {
        this.frameBox = { ...drag.fb, x: drag.fb.x + px - drag.sx, y: drag.fb.y + py - drag.sy };
        this.frame.setAttribute('x', this.frameBox.x); this.frame.setAttribute('y', this.frameBox.y);
        this.stats.frames++;
      } else {
        this.view = { ...drag.view, tx: drag.view.tx + px - drag.sx, ty: drag.view.ty + py - drag.sy };
        this.draw();
      }
    });
    const end = (ev) => {
      if (!drag) return;
      const d = drag; drag = null;
      const r = b.getBoundingClientRect();
      const px = ev.clientX - r.left, py = ev.clientY - r.top;
      if (d.mode === 'frame') {
        this.dragFrame = false;
        if (d.moved) {
          const c = this.frameBox;
          const [mx, my] = this.toMap(c.x + c.w / 2, c.y + c.h / 2);
          const target = this.nearestNode(mx, my);
          if (target) { this.onSelect(target); return; }
        }
        this.draw();
      }
      if (!d.moved) this.click(px, py);
    };
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', () => { drag = null; this.dragFrame = false; this.draw(); });
    b.addEventListener('dblclick', (ev) => {
      const r = b.getBoundingClientRect();
      if (!this.nodeAt(ev.clientX - r.left, ev.clientY - r.top)) this.animateTo(this.fitView());
    });
    this.root.querySelector('.mm-head').addEventListener('dblclick', () => this.toggleCollapsed());
  }

  click(px, py) {
    const n = this.nodeAt(px, py);
    if (n) { this.onSelect(n); return; }
    if (this.level === 0) {
      const is = this.islandAt(px, py);
      if (is) this.animateTo(this.fitView({ x: is.x - 4, y: is.y - 4, w: is.w + 8, h: is.h + 8 }));
    }
  }

  resetView() { this.animateTo(this.fitView()); }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
