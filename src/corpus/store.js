/**
 * Хранилище работы редактора над корпусом: структурные классы, свойства, аксиомы, формализации.
 * На платформе — сервер (backend.loadWork / saveWork); офлайн — localStorage этого браузера.
 */
export function makeServerStore(backend, oid) {
  return {
    kind: 'server',
    async load() { return backend.loadWork(oid); },
    async save(type, id, data) { return backend.saveWork(oid, type, id, data); },
  };
}

export function makeLocalStore(key, seed) {
  const k = 'ontolens.work.' + key;
  let cache = null;
  const read = () => {
    if (cache) return cache;
    try { cache = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { cache = null; }
    if (!cache) cache = seed ? JSON.parse(JSON.stringify(seed)) : { classes: [], props: [], axioms: [], formal: {} };
    return cache;
  };
  const write = () => { try { localStorage.setItem(k, JSON.stringify(cache)); } catch (e) { /* только память */ } };
  return {
    kind: 'local',
    async load() { return JSON.parse(JSON.stringify(read())); },
    async save(type, id, data) {
      const w = read();
      if (type === 'formal') w.formal[id] = data;
      else {
        const list = w[type === 'class' ? 'classes' : type === 'prop' ? 'props' : 'axioms'];
        const i = list.findIndex((x) => x.id === id);
        if (i >= 0) list[i] = data; else list.push(data);
      }
      write();
      return { ok: true };
    },
  };
}

/** Применить сохранение к загруженной работе (чтобы не перечитывать всё). */
export function applyWork(work, type, id, data) {
  if (type === 'formal') { work.formal[id] = data; return; }
  const list = work[type === 'class' ? 'classes' : type === 'prop' ? 'props' : 'axioms'];
  const i = list.findIndex((x) => x.id === id);
  if (i >= 0) list[i] = data; else list.push(data);
}
