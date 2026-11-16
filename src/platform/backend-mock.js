/**
 * Демонстрационный сервер платформы: данные в памяти (или в localStorage),
 * правила доступа повторяют firestore.rules — чтобы интерфейс и тесты
 * проверялись на тех же отказах, что дадут настоящие правила.
 *
 * Используется в тестах и в предпросмотре без Firebase.
 */
import { normEmail, reviewId, iriKey, cleanReview, splitText } from './common.js';

const SUPERADMINS = ['gipocentr@gmail.com'];

function deny(msg) { const e = new Error(msg || 'Нет доступа'); e.code = 'permission-denied'; throw e; }
const clone = (x) => JSON.parse(JSON.stringify(x));

export function createMockBackend(opts = {}) {
  const key = opts.storageKey || null;
  let db = null;
  if (key) { try { db = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { db = null; } }
  db = db || clone(opts.seed || { people: {}, ontologies: {}, versions: {}, chunks: {}, reviews: {}, log: [] });
  let user = opts.signedInAs ? { email: normEmail(opts.signedInAs), name: opts.displayName || opts.signedInAs } : null;
  const listeners = new Set();
  let seq = Object.keys(db.versions).length;

  const persist = () => { if (key) { try { localStorage.setItem(key, JSON.stringify(db)); } catch (e) { /* только память */ } } };
  const me = () => (user ? user.email : '');
  const person = () => db.people[me()] || null;
  const active = () => !!(person() && person().active !== false);
  const isAdmin = () => !!user && (SUPERADMINS.includes(me()) || (active() && person().role === 'admin'));
  const onto = (oid) => db.ontologies[oid] || deny('Онтология не найдена');
  const isEditor = (oid) => isAdmin() || (active() && onto(oid).editors.includes(me()));
  const isMember = (oid) => isEditor(oid) || (active() && onto(oid).experts.includes(me()));
  const delay = () => new Promise((r) => setTimeout(r, opts.latency || 0));
  const log = (action, details) => { db.log.push({ ts: new Date().toISOString(), email: me(), action, details: String(details || '').slice(0, 300) }); };

  return {
    kind: 'mock',
    async init() { await delay(); return user; },
    onAuth(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async signIn(email, name) {
      user = { email: normEmail(email || opts.signInAs || 'expert@example.com'), name: name || email };
      listeners.forEach((f) => f(user));
      return user;
    },
    async signOut() { user = null; listeners.forEach((f) => f(null)); },
    currentUser() { return user; },

    /** Своя карточка участника; суперадмин заводится при первом входе. */
    async me() {
      await delay();
      if (!user) return null;
      if (!db.people[me()] && SUPERADMINS.includes(me())) {
        db.people[me()] = { email: me(), name: user.name || me(), role: 'admin', active: true, created: new Date().toISOString(), by: 'bootstrap' };
        persist();
      }
      return db.people[me()] ? clone(db.people[me()]) : null;
    },

    // ---------------- участники (администратор)
    async listPeople() { await delay(); if (!isAdmin()) deny(); return clone(Object.values(db.people)); },
    async savePerson(p) {
      await delay(); if (!isAdmin()) deny();
      const e = normEmail(p.email);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('Некорректный email: ' + p.email);
      const prev = db.people[e] || { created: new Date().toISOString(), by: me() };
      db.people[e] = { ...prev, email: e, name: String(p.name || e).trim(), role: p.role === 'admin' ? 'admin' : 'member', active: p.active !== false };
      log('person', e); persist(); return clone(db.people[e]);
    },

    // ---------------- онтологии
    async listOntologies() {
      await delay(); if (!user) deny();
      const all = Object.values(db.ontologies);
      const mine = isAdmin() ? all : (active() ? all.filter((o) => o.editors.includes(me()) || o.experts.includes(me())) : []);
      return clone(mine);
    },
    async getOntology(oid) { await delay(); if (!isMember(oid)) deny(); return clone(onto(oid)); },
    async createOntology(o) {
      await delay(); if (!isAdmin()) deny();
      if (db.ontologies[o.id]) throw new Error('Онтология с кодом ' + o.id + ' уже есть');
      db.ontologies[o.id] = { id: o.id, title: o.title, description: o.description || '', status: 'open',
        editors: (o.editors || []).map(normEmail), experts: (o.experts || []).map(normEmail),
        visibility: o.visibility || 'after_own', currentVersion: '', created: new Date().toISOString(), updated: new Date().toISOString() };
      log('ontology.create', o.id); persist(); return clone(db.ontologies[o.id]);
    },
    async updateOntology(oid, patch) {
      await delay();
      const o = onto(oid);
      const keys = Object.keys(patch);
      const editorKeys = ['experts', 'visibility'];
      if (!isAdmin() && !(isEditor(oid) && keys.every((k) => editorKeys.includes(k)))) deny();
      const next = { ...o, ...patch, updated: new Date().toISOString() };
      if (patch.experts) next.experts = patch.experts.map(normEmail);
      if (patch.editors) next.editors = patch.editors.map(normEmail);
      db.ontologies[oid] = next; log('ontology.update', oid + ' ' + keys.join(',')); persist();
      return clone(next);
    },

    // ---------------- версии
    async listVersions(oid) {
      await delay(); if (!isMember(oid)) deny();
      return clone(Object.values(db.versions).filter((v) => v.oid === oid).sort((a, b) => b.n - a.n));
    },
    async getVersionFiles(oid, vid) {
      await delay(); if (!isMember(oid)) deny();
      const v = db.versions[oid + '/' + vid] || deny('Версия не найдена');
      const files = v.files.map((f) => ({ name: f.name, text: Array.from({ length: f.parts }, (_, i) => db.chunks[`${oid}/${vid}/${f.name}#${i}`]).join('') }));
      return { version: clone(v), files, profile: v.profile ? JSON.parse(v.profile) : null, layout: v.layout ? JSON.parse(v.layout) : null };
    },
    async publishVersion(oid, { files, profile, profileName, layout, note, metrics }) {
      await delay(); if (!isEditor(oid)) deny();
      const n = Object.values(db.versions).filter((v) => v.oid === oid).length + 1;
      const vid = 'v' + n;
      seq++;
      const meta = [];
      for (const f of files) {
        const parts = splitText(f.text);
        parts.forEach((p, i) => { db.chunks[`${oid}/${vid}/${f.name}#${i}`] = p; });
        meta.push({ name: f.name, parts: parts.length, size: f.text.length });
      }
      db.versions[oid + '/' + vid] = { oid, id: vid, n, note: note || '', files: meta,
        profile: profile ? JSON.stringify(profile) : '', profileName: profileName || '', layout: layout ? JSON.stringify(layout) : '',
        metrics: metrics || {}, createdBy: me(), created: new Date().toISOString() };
      db.ontologies[oid] = { ...onto(oid), currentVersion: vid, updated: new Date().toISOString() };
      log('version.publish', oid + ' ' + vid); persist();
      return vid;
    },

    // ---------------- оценки
    async myReviews(oid, vid) {
      await delay(); if (!isMember(oid)) deny();
      const out = {};
      for (const r of Object.values(db.reviews)) if (r.oid === oid && r.version === vid && r.email === me()) out[r.iri] = clone(r);
      return out;
    },
    async allReviews(oid, vid) {
      await delay(); if (!isEditor(oid)) deny('Сводка доступна редактору');
      const by = {};
      for (const r of Object.values(db.reviews)) {
        if (r.oid !== oid || r.version !== vid) continue;
        (by[r.email] = by[r.email] || { email: r.email, expert: r.expert, items: {} }).items[r.iri] = clone(r);
      }
      return Object.values(by);
    },
    /** Чужие оценки одного термина — по правилу видимости (ТЗ v2.2, 6.2). */
    async othersForTerm(oid, vid, iri) {
      await delay(); if (!isMember(oid)) deny();
      const o = onto(oid);
      const mine = db.reviews[reviewId(vid, me(), iri)];
      const may = isEditor(oid) || o.visibility === 'open' || (o.visibility === 'after_own' && !!mine);
      if (!may) return { hidden: true, items: [] };
      const items = Object.values(db.reviews).filter((r) => r.oid === oid && r.version === vid && r.iri === iri && r.email !== me());
      return { hidden: false, items: clone(items) };
    },
    async saveReview(oid, vid, iri, rec) {
      await delay(); if (!isMember(oid)) deny();
      const o = onto(oid);
      if (o.currentVersion !== vid) deny('Версия онтологии сменилась — перезагрузите страницу.');
      if (o.status === 'closed') deny('Экспертиза по этой онтологии закрыта.');
      const id = reviewId(vid, me(), iri);
      db.reviews[id] = { ...cleanReview(rec), oid, version: vid, iri, h: iriKey(iri), email: me(),
        expert: (person() && person().name) || me(), updated: new Date().toISOString() };
      log('review', `${rec.verdict} ${iri}`); persist();
      return { ok: true };
    },

    // ---------------- работа редактора над корпусом (ТЗ v3.1): классы, свойства, аксиомы, формализации
    async loadWork(oid) {
      await delay(); if (!isMember(oid)) deny();
      const w = { classes: [], props: [], axioms: [], formal: {} };
      for (const [k, v] of Object.entries(db.work || {})) {
        if (!k.startsWith(oid + '/')) continue;
        const { type, id, data } = v;
        if (type === 'formal') w.formal[id] = clone(data);
        else w[type === 'class' ? 'classes' : type === 'prop' ? 'props' : 'axioms'].push(clone(data));
      }
      return w;
    },
    async saveWork(oid, type, id, data) {
      await delay(); if (!isEditor(oid)) deny('Формализацию и аксиомы меняет редактор');
      if (!['formal', 'class', 'prop', 'axiom'].includes(type)) throw new Error('Неизвестный тип: ' + type);
      db.work = db.work || {};
      db.work[`${oid}/${type}__${id}`] = { type, id, data: { ...clone(data), updated: new Date().toISOString(), updatedBy: me() } };
      log('work.' + type, oid + ' ' + id); persist();
      return { ok: true };
    },

    async listLog(limit = 200) { await delay(); if (!isAdmin()) deny(); return clone(db.log.slice(-limit).reverse()); },
    async exportAll() { await delay(); if (!isAdmin()) deny(); return clone(db); },
    _db: () => db,
  };
}
