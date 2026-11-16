/**
 * Нормализация терминов и определений (ТЗ v3.1, разделы 3.1 и 8).
 * Детерминированно, без словарей: регистр, ё→е, казахские буквы, пунктуация,
 * грубый стемминг русских окончаний — для выравнивания названий и лексического сигнала.
 */

const KK = { 'ә': 'а', 'ғ': 'г', 'қ': 'к', 'ң': 'н', 'ө': 'о', 'ұ': 'у', 'ү': 'у', 'һ': 'х', 'і': 'и' };

export function foldText(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[әғқңөұүһі]/g, (c) => KK[c])
    .replace(/[«»"“”„'’`()[\]{}]/g, ' ').replace(/[‐-―−-]/g, '-').replace(/\s+/g, ' ').trim();
}

/** Ключ названия термина для выравнивания: без пунктуации, со стеммингом, порядок слов сохраняется. */
export function termKey(label) {
  return words(label).map(stem).join(' ');
}

export function words(s) {
  return foldText(s).split(/[^a-zа-я0-9-]+/i).map((w) => w.replace(/^-+|-+$/g, '')).filter(Boolean);
}

const ENDINGS = ['иями', 'ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ией', 'ией', 'ией', 'ешь', 'ует',
  'ются', 'ется', 'ится', 'ость', 'ости', 'ая', 'яя', 'ое', 'ее', 'ой', 'ей', 'ий', 'ый', 'ых', 'их', 'ов', 'ев',
  'ам', 'ям', 'ах', 'ях', 'ом', 'ем', 'ую', 'юю', 'ия', 'ие', 'ии', 'ию', 'а', 'я', 'о', 'е', 'ы', 'и', 'у', 'ю', 'ь'];

/** Грубая основа слова: отрезать самое длинное окончание, оставив не меньше 4 букв. */
export function stem(w) {
  if (!/[а-я]/.test(w) || w.length <= 4) return w;
  for (const e of ENDINGS) {
    if (w.endsWith(e) && w.length - e.length >= 4) return w.slice(0, -e.length);
  }
  return w;
}

export const STOP = new Set(['и', 'в', 'во', 'на', 'с', 'со', 'к', 'по', 'для', 'при', 'из', 'от', 'до', 'о', 'об', 'а',
  'или', 'не', 'что', 'как', 'который', 'которая', 'которое', 'которые', 'которых', 'его', 'ее', 'их', 'это', 'также',
  'так', 'же', 'то', 'а', 'the', 'of', 'and', 'or', 'to', 'in', 'for', 'a', 'an', 'by', 'with', 'on', 'is', 'are']);

/** Значимые основы текста. */
export function contentStems(s) {
  return words(s).filter((w) => !STOP.has(w) && w.length > 1).map(stem);
}

/**
 * Лексическое различие двух текстов: доля несовпадающих значимых основ (0 — совпадают, 1 — ничего общего).
 * Мера Жаккара по множествам основ.
 */
export function wordDiff(a, b) {
  const A = new Set(contentStems(a)), B = new Set(contentStems(b));
  if (!A.size && !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return 1 - inter / (A.size + B.size - inter);
}

/** Пословное сравнение для подсветки: [{w, same}] для текста a относительно b. */
export function diffWords(a, b) {
  const B = new Set(contentStems(b));
  return String(a || '').split(/(\s+)/).map((tok) => {
    if (/^\s+$/.test(tok) || !tok) return { w: tok, same: true };
    const st = words(tok).map(stem);
    const significant = st.filter((x) => !STOP.has(x));
    return { w: tok, same: !significant.length || significant.every((x) => B.has(x)) };
  });
}

/**
 * Упоминания терминов корпуса в текстах определений других понятий: самое длинное совпадение
 * последовательности основ названия (ТЗ v3.1, K5/K6 — граф опоры определений).
 * Возвращает [{from, to, def, doc, quote}].
 */
export function termMentions(corpus) {
  const index = new Map();
  for (const c of corpus.concepts) {
    for (const lab of (c.labels || [c.label_ru])) {
      const st = words(lab).map(stem).filter(Boolean);
      if (!st.length) continue;
      (index.get(st[0]) || index.set(st[0], []).get(st[0])).push({ concept: c.id, st, label: lab });
    }
  }
  for (const list of index.values()) list.sort((a, b) => b.st.length - a.st.length);
  const out = [];
  for (const d of corpus.definitions) {
    const w = words(d.text.ru), st = w.map(stem);
    for (let i = 0; i < st.length;) {
      const hit = (index.get(st[i]) || []).find((x) => x.concept !== d.concept && x.st.every((s, k) => st[i + k] === s));
      if (hit) {
        if (!out.some((m) => m.def === d.id && m.to === hit.concept)) out.push({ from: d.concept, to: hit.concept, def: d.id, doc: d.doc, quote: w.slice(i, i + hit.st.length).join(' ') });
        i += hit.st.length;
      } else i++;
    }
  }
  return out;
}
