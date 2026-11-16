/**
 * Связка рабочего пространства OntoLens с сервером платформы (ТЗ v2.2).
 * Сервер — любой объект с интерфейсом backend-firebase.js / backend-mock.js.
 */

/** Слияние черновика браузера и сервера: побеждает более свежая запись. */
export function mergeReviews(local, server) {
  const out = { ...server };
  const toPush = [];
  for (const [iri, rec] of Object.entries(local || {})) {
    if (!rec || !rec.verdict) continue;
    const s = server[iri];
    if (!s || String(rec.ts || '') > String(s.ts || '')) { out[iri] = rec; toPush.push(iri); }
  }
  return { items: out, toPush };
}

/**
 * Очередь отправки оценок: по одной, повтор при ошибке через 5, 10, 20… с (до минуты).
 * Отказ правил доступа (permission-denied) не повторяется — это не сбой связи.
 * onState({pending, lastOk, error, fatal}).
 */
export function makeSyncQueue(save, onState) {
  const pending = new Map();       // iri -> rec
  let busy = false, timer = null, delay = 5000, lastOk = null, error = null, fatal = false;
  const state = () => onState && onState({ pending: pending.size, lastOk, error, fatal });
  async function flush() {
    if (busy || !pending.size) return;
    busy = true; clearTimeout(timer); timer = null;
    try {
      while (pending.size) {
        const [iri, rec] = pending.entries().next().value;
        await save(iri, rec);
        if (pending.get(iri) === rec) pending.delete(iri);
        lastOk = new Date(); error = null; fatal = false; delay = 5000;
      }
    } catch (e) {
      error = String(e && e.message || e);
      fatal = !!(e && (e.code === 'permission-denied' || /permission/i.test(e.code || '')));
      if (!fatal) { timer = setTimeout(() => { flush(); }, delay); delay = Math.min(delay * 2, 60000); }
    } finally {
      busy = false;
      state();
    }
  }
  return {
    push(iri, rec) { pending.set(iri, rec); state(); flush(); },
    flush,
    get pending() { return pending.size; },
  };
}
