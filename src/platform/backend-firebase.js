/**
 * Сервер платформы на Firebase: вход Google (Authentication) и данные в Firestore.
 * Серверного кода нет: доступ ограничивают правила firebase/firestore.rules.
 *
 * Структура:
 *   people/{email}                                  — участники и глобальная роль
 *   ontologies/{oid}                                — онтология, editors[], experts[], currentVersion, visibility
 *   ontologies/{oid}/versions/{vid}                 — описание версии
 *   ontologies/{oid}/versions/{vid}/chunks/{name#i} — части файлов TTL
 *   ontologies/{oid}/reviews/{vid}__{email}__{h}    — оценка эксперта
 *   log/{auto}                                      — журнал (только добавление)
 */
import { initializeApp } from 'firebase/app';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut as fbSignOut, onAuthStateChanged,
  browserLocalPersistence, setPersistence,
} from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, collection, query, where,
  orderBy, limit, serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { normEmail, reviewId, iriKey, cleanReview, splitText } from './common.js';

const SUPERADMINS = ['gipocentr@gmail.com'];

export function createFirebaseBackend(config) {
  const app = initializeApp(config);
  const auth = getAuth(app);
  let fs;
  try { fs = initializeFirestore(app, { localCache: persistentLocalCache() }); }
  catch (e) { fs = initializeFirestore(app, {}); }
  let user = null;
  const me = () => (user ? normEmail(user.email) : '');
  const iso = () => new Date().toISOString();
  const d = (snap) => (snap.exists() ? { ...snap.data() } : null);

  async function log(action, details) {
    try { await addDoc(collection(fs, 'log'), { ts: iso(), at: serverTimestamp(), email: me(), action, details: String(details || '').slice(0, 300) }); }
    catch (e) { /* журнал не должен ломать работу */ }
  }

  return {
    kind: 'firebase',
    async init() {
      await setPersistence(auth, browserLocalPersistence).catch(() => {});
      return new Promise((resolve) => {
        const off = onAuthStateChanged(auth, (u) => { off(); user = u ? { email: u.email, name: u.displayName || u.email } : null; resolve(user); });
      });
    },
    onAuth(fn) { return onAuthStateChanged(auth, (u) => { user = u ? { email: u.email, name: u.displayName || u.email } : null; fn(user); }); },
    async signIn() {
      const p = new GoogleAuthProvider();
      p.setCustomParameters({ prompt: 'select_account' });
      try {
        const r = await signInWithPopup(auth, p);
        user = { email: r.user.email, name: r.user.displayName || r.user.email };
        return user;
      } catch (e) {
        // всплывающее окно заблокировано — переходим на страницу входа целиком
        if (e && /popup-blocked|operation-not-supported/.test(e.code || '')) { await signInWithRedirect(auth, p); return null; }
        throw e;
      }
    },
    async signOut() { await fbSignOut(auth); user = null; },
    currentUser() { return user; },

    async me() {
      if (!user) return null;
      const ref = doc(fs, 'people', me());
      let p = d(await getDoc(ref).catch((e) => { if (e.code === 'permission-denied') return { exists: () => false }; throw e; }));
      if (!p && SUPERADMINS.includes(me())) {
        p = { email: me(), name: user.name || me(), role: 'admin', active: true, created: iso(), by: 'bootstrap' };
        await setDoc(ref, p);
      }
      return p;
    },

    async listPeople() { return (await getDocs(collection(fs, 'people'))).docs.map((s) => s.data()); },
    async savePerson(p) {
      const e = normEmail(p.email);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('Некорректный email: ' + p.email);
      const ref = doc(fs, 'people', e);
      const prev = d(await getDoc(ref)) || { created: iso(), by: me() };
      const next = { ...prev, email: e, name: String(p.name || e).trim(), role: p.role === 'admin' ? 'admin' : 'member', active: p.active !== false };
      await setDoc(ref, next);
      log('person', e);
      return next;
    },

    async listOntologies() {
      const col = collection(fs, 'ontologies');
      const p = await this.me();
      const admin = SUPERADMINS.includes(me()) || (p && p.role === 'admin' && p.active !== false);
      if (admin) return (await getDocs(col)).docs.map((s) => ({ ...s.data(), id: s.id }));
      const [a, b] = await Promise.all([
        getDocs(query(col, where('editors', 'array-contains', me()))),
        getDocs(query(col, where('experts', 'array-contains', me()))),
      ]);
      const out = new Map();
      for (const s of [...a.docs, ...b.docs]) out.set(s.id, { ...s.data(), id: s.id });
      return [...out.values()];
    },
    async getOntology(oid) { const o = d(await getDoc(doc(fs, 'ontologies', oid))); if (!o) throw new Error('Онтология не найдена'); return { ...o, id: oid }; },
    async createOntology(o) {
      const ref = doc(fs, 'ontologies', o.id);
      if ((await getDoc(ref)).exists()) throw new Error('Онтология с кодом ' + o.id + ' уже есть');
      const rec = { id: o.id, title: o.title, description: o.description || '', status: 'open',
        editors: (o.editors || []).map(normEmail), experts: (o.experts || []).map(normEmail),
        visibility: o.visibility || 'after_own', currentVersion: '', created: iso(), updated: iso() };
      await setDoc(ref, rec);
      log('ontology.create', o.id);
      return rec;
    },
    async updateOntology(oid, patch) {
      const p = { ...patch, updated: iso() };
      if (patch.experts) p.experts = patch.experts.map(normEmail);
      if (patch.editors) p.editors = patch.editors.map(normEmail);
      await updateDoc(doc(fs, 'ontologies', oid), p);
      log('ontology.update', oid + ' ' + Object.keys(patch).join(','));
      return this.getOntology(oid);
    },

    async listVersions(oid) {
      const s = await getDocs(query(collection(fs, 'ontologies', oid, 'versions'), orderBy('n', 'desc')));
      return s.docs.map((x) => ({ ...x.data(), id: x.id }));
    },
    async getVersionFiles(oid, vid) {
      const v = d(await getDoc(doc(fs, 'ontologies', oid, 'versions', vid)));
      if (!v) throw new Error('Версия не найдена');
      const chunks = await getDocs(collection(fs, 'ontologies', oid, 'versions', vid, 'chunks'));
      const byId = Object.fromEntries(chunks.docs.map((s) => [s.id, s.data().text]));
      const files = v.files.map((f) => ({ name: f.name, text: Array.from({ length: f.parts }, (_, i) => byId[`${f.name}#${i}`] || '').join('') }));
      return { version: { ...v, id: vid }, files, profile: v.profile ? JSON.parse(v.profile) : null, layout: v.layout ? JSON.parse(v.layout) : null };
    },
    async publishVersion(oid, { files, profile, profileName, layout, note, metrics }) {
      const prev = await this.listVersions(oid);
      const n = (prev[0] ? prev[0].n : 0) + 1;
      const vid = 'v' + n;
      const meta = [];
      // части — пачками: в одной пакетной записи не больше ~10 МБ и 500 операций
      let batch = writeBatch(fs), size = 0, ops = 0;
      for (const f of files) {
        const parts = splitText(f.text);
        for (let i = 0; i < parts.length; i++) {
          if (size + parts[i].length * 2 > 8e6 || ops >= 450) { await batch.commit(); batch = writeBatch(fs); size = 0; ops = 0; }
          batch.set(doc(fs, 'ontologies', oid, 'versions', vid, 'chunks', `${f.name}#${i}`), { text: parts[i] });
          size += parts[i].length * 2; ops++;
        }
        meta.push({ name: f.name, parts: parts.length, size: f.text.length });
      }
      batch.set(doc(fs, 'ontologies', oid, 'versions', vid), { n, note: note || '', files: meta,
        profile: profile ? JSON.stringify(profile) : '', profileName: profileName || '', layout: layout ? JSON.stringify(layout) : '',
        metrics: metrics || {}, createdBy: me(), created: iso() });
      await batch.commit();
      // версия становится текущей только после того, как все части записаны
      await updateDoc(doc(fs, 'ontologies', oid), { currentVersion: vid, updated: iso() });
      log('version.publish', oid + ' ' + vid);
      return vid;
    },

    async myReviews(oid, vid) {
      const s = await getDocs(query(collection(fs, 'ontologies', oid, 'reviews'), where('email', '==', me()), where('version', '==', vid)));
      return Object.fromEntries(s.docs.map((x) => [x.data().iri, x.data()]));
    },
    async allReviews(oid, vid) {
      const s = await getDocs(query(collection(fs, 'ontologies', oid, 'reviews'), where('version', '==', vid)));
      const by = {};
      for (const x of s.docs) {
        const r = x.data();
        (by[r.email] = by[r.email] || { email: r.email, expert: r.expert, items: {} }).items[r.iri] = r;
      }
      return Object.values(by);
    },
    /** Чужие оценки термина: по одному документу на эксперта, правила решают, что видно. */
    async othersForTerm(oid, vid, iri, emails) {
      const o = await this.getOntology(oid);
      const people = (emails || o.experts.concat(o.editors)).map(normEmail).filter((e) => e !== me());
      const got = await Promise.all(people.map((e) => getDoc(doc(fs, 'ontologies', oid, 'reviews', reviewId(vid, e, iri)))
        .then((s) => (s.exists() ? s.data() : null)).catch((err) => (err.code === 'permission-denied' ? 'denied' : null))));
      if (got.includes('denied')) return { hidden: true, items: [] };
      return { hidden: false, items: got.filter(Boolean) };
    },
    async saveReview(oid, vid, iri, rec) {
      const p = await this.me();
      await setDoc(doc(fs, 'ontologies', oid, 'reviews', reviewId(vid, me(), iri)), {
        ...cleanReview(rec), version: vid, iri, h: iriKey(iri), email: me(), expert: (p && p.name) || me(), updated: iso(),
      });
      return { ok: true };
    },

    // работа редактора над корпусом: ontologies/{oid}/work/{type}__{id}
    async loadWork(oid) {
      const w = { classes: [], props: [], axioms: [], formal: {} };
      const s = await getDocs(collection(fs, 'ontologies', oid, 'work'));
      for (const x of s.docs) {
        const { type, id, data } = x.data();
        if (type === 'formal') w.formal[id] = data;
        else w[type === 'class' ? 'classes' : type === 'prop' ? 'props' : 'axioms'].push(data);
      }
      return w;
    },
    async saveWork(oid, type, id, data) {
      await setDoc(doc(fs, 'ontologies', oid, 'work', `${type}__${id}`), { type, id, data: { ...data, updated: iso(), updatedBy: me() } });
      log('work.' + type, oid + ' ' + id);
      return { ok: true };
    },

    async listLog(n = 200) { return (await getDocs(query(collection(fs, 'log'), orderBy('ts', 'desc'), limit(n)))).docs.map((s) => s.data()); },
    async exportAll() {
      const out = { people: await this.listPeople(), ontologies: [] };
      for (const o of await this.listOntologies()) {
        const versions = await this.listVersions(o.id);
        const reviews = (await getDocs(collection(fs, 'ontologies', o.id, 'reviews'))).docs.map((s) => s.data());
        out.ontologies.push({ ...o, versions, reviews });
      }
      return out;
    },
  };
}
