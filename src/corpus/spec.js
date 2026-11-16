/**
 * Файл формализаций корпуса (JSON): структурные классы, свойства, аксиомы и формализации
 * с ключами «код документа|пункт». Нужен для демонабора, тестов и переноса между версиями.
 */
import { foldText } from './normalize.js';

export function resolveSpec(corpus, spec) {
  const classes = (spec.classes || []).map((c) => ({ ...c }));
  const props = (spec.props || []).map((p) => ({ ...p }));
  const axioms = (spec.axioms || []).map((a) => ({ active: true, ...a }));
  const byLabel = new Map(corpus.concepts.map((c) => [foldText(c.label_ru), c.id]));
  const ref = (v) => (typeof v === 'string' && v.startsWith('@') ? byLabel.get(foldText(v.slice(1))) || v : v);
  const formal = {};
  const unresolved = [];
  for (const [key, f] of Object.entries(spec.formal || {})) {
    const [code, clause] = key.split('|');
    const d = corpus.definitions.find((x) => x.docCode === code && String(x.clause) === String(clause));
    if (!d) { unresolved.push(key); continue; }
    formal[d.id] = { genus: ref(f.genus), diffs: (f.diffs || []).map((x) => ({ ...x, value: ref(x.value) })), status: f.status || 'confirmed',
      by: f.by || 'spec', origin: f.origin || 'manual', note: f.note || '' };
  }
  return { classes, props, axioms, formal, unresolved };
}

/** Обратно: формализации корпуса → JSON-спецификация (для экспорта и переноса на новую версию). */
export function toSpec(corpus, { classes, props, axioms, formal }) {
  const defs = new Map(corpus.definitions.map((d) => [d.id, d]));
  const out = {};
  for (const [id, f] of Object.entries(formal || {})) {
    const d = defs.get(id);
    if (d) out[`${d.docCode}|${d.clause}`] = f;
  }
  return { classes, props, axioms, formal: out };
}
