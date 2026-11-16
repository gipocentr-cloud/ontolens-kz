/**
 * Приёмка движка коллизий (ТЗ v3.1, раздел 12) на синтетическом корпусе с заложенными коллизиями.
 * Протокол закладки — столбец note в data/synthetic-corpus/glossary.csv и formal.json.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { corpusFromFiles, corpusToTurtle } from '../src/corpus/glossary.js';
import { analyseCorpus } from '../src/corpus/engine.js';
import { resolveSpec } from '../src/corpus/spec.js';
import { wordDiff } from '../src/corpus/normalize.js';

const dir = new URL('../data/synthetic-corpus/', import.meta.url);
const files = ['glossary.csv', 'documents.csv'].map((n) => ({ name: n, text: readFileSync(new URL(n, dir), 'utf8') }));
const corpus = corpusFromFiles(files, { name: 'synthetic' });
const spec = resolveSpec(corpus, JSON.parse(readFileSync(new URL('formal.json', dir), 'utf8')));
const R = { checks: [] };
const ok = (name, cond, extra) => { R.checks.push({ name, ok: !!cond, ...(extra !== undefined ? { extra } : {}) }); if (!cond) console.error('FAIL', name, extra ?? ''); };

ok('корпус: 5 документов, 23 определения', corpus.documents.length === 5 && corpus.definitions.length === 23, corpus.stats);
ok('формализации сопоставлены все', spec.unresolved.length === 0, spec.unresolved);
const docs = Object.fromEntries(corpus.documents.map((d) => [d.code, d]));
ok('ранги по умолчанию: кодекс 1, ТКН 5, СТ РК ISO 7', docs['Строительный кодекс РК'].rank === 1 && docs['ТКН РК ТИМСО (проект)'].rank === 5 && docs['СТ РК ISO 19650-1'].rank === 7,
  Object.values(docs).map((d) => d.code + ':' + d.rank));
ok('статусы: проект, заменён (по связи «заменяет»)', docs['ТКН РК ТИМСО (проект)'].status === 'project' && docs['СН РК 1.03-00-2015'].status === 'replaced');

const t0 = Date.now();
const res = analyseCorpus(corpus, spec.formal, spec.axioms, spec.classes, spec.props);
R.ms = Date.now() - t0;
R.stats = res.stats;
const C = res.conflicts;
const label = (cid) => corpus.concepts.find((c) => c.id === cid).label_ru;
const find = (kind, term) => C.filter((c) => c.kind === kind && label(c.concept) === term);

// --- заложенные коллизии: полнота 100 %
const im = find('K1-genus', 'информационная модель');
ok('K1-genus «информационная модель» доказана', im.length === 1 && im[0].status === 'proved', im.map((c) => c.title));
ok('… критическая, уступает ТКН (ранг 5 против 1)', im[0] && im[0].severity === 'critical' && im[0].yields && im[0].yields.code === 'ТКН РК ТИМСО (проект)', im[0] && im[0].yields);
ok('… каждый шаг доказательства с источником', im[0] && im[0].proof.every((s) => s.type === 'conclusion' || s.source));
ok('… омонимия предложена как альтернативная трактовка', im[0] && im[0].homonymy === true);
ok('K10-chain «цифровая модель объекта» — косвенная через «электронная модель»', find('K10-chain', 'цифровая модель объекта').length === 1
  && find('K10-chain', 'цифровая модель объекта')[0].proof.some((s) => s.indirect && /электронная модель/.test(s.text)));
ok('K1-diff «оператор среды общих данных»: кем назначается', find('K1-diff', 'оператор среды общих данных').length === 1);
ok('K1-scope «атрибут» — к сведению, не коллизия', find('K1-scope', 'атрибут').length === 1 && find('K1-scope', 'атрибут')[0].status === 'info');
ok('K1-open «информационный контейнер» — кандидат с предложением аксиомы', find('K1-open', 'информационный контейнер').length === 1 && !!find('K1-open', 'информационный контейнер')[0].suggestAxiom);
const lex = find('K1-lex', 'среда общих данных');
ok('K1-lex «среда общих данных» — кандидат, не доказано', lex.length === 1 && lex[0].status === 'candidate', lex.map((c) => c.signal));
const k3 = C.filter((c) => c.kind === 'K3');
ok('K3 синонимия «проектировщик» ↔ «разработчик проекта»', k3.length === 1 && /проектировщик/.test(k3[0].title) && /разработчик проекта/.test(k3[0].title), k3.map((c) => c.title));
ok('K7 «чертёж» только в заменённом документе', find('K7', 'чертёж').length === 1);
ok('K8 «исполнительная съёмка»: новая редакция изменила определение', find('K8', 'исполнительная съёмка').length === 1);
const k9 = find('K9', 'информационная модель');
ok('K9 казахский термин «информационная модель» различается', k9.length >= 1 && k9.every((c) => c.lang === 'kk'), k9.map((c) => c.title));

// --- контрольные пары: ложных коллизий 0
const control = ['объект строительства', 'жизненный цикл объекта строительства'];
const falsePos = C.filter((c) => control.includes(label(c.concept)) && c.status !== 'info');
ok('контрольные пары: ни одной коллизии и ни одного кандидата', falsePos.length === 0, falsePos.map((c) => c.kind + ' ' + c.title));
ok('контроль «жизненный цикл»: различие текстов ниже порога 35 %', wordDiff('период от начала проектирования объекта строительства до его сноса',
  'период от начала проектирования объекта строительства до его сноса и утилизации') < 0.35);

// --- отзыв аксиомы переводит зависимые коллизии в другой статус
const withoutAx1 = analyseCorpus(corpus, spec.formal, spec.axioms.map((a) => (a.id === 'AX1' ? { ...a, active: false } : a)), spec.classes, spec.props);
const dependent = C.filter((c) => c.status === 'proved' && c.proof.some((s) => s.source && s.source.axiom === 'AX1')).map((c) => c.concept);
const after = withoutAx1.conflicts.filter((c) => dependent.includes(c.concept) && ['K1-genus', 'K10-chain'].includes(c.kind));
ok('отзыв аксиомы AX1: зависевшие коллизии (2) перестают быть доказанными', dependent.length === 2 && after.length === 0,
  { dependent: dependent.map(label), after: after.map((c) => c.kind) });
ok('… остальные доказательства не затронуты (K1-diff остаётся)', withoutAx1.conflicts.some((c) => c.kind === 'K1-diff'));

// --- смена ранга меняет, кто уступает
const swapped = JSON.parse(JSON.stringify(corpus));
swapped.documents.find((d) => d.code === 'ТКН РК ТИМСО (проект)').rank = 1;
swapped.documents.find((d) => d.code === 'Строительный кодекс РК').rank = 5;
const sw = analyseCorpus(swapped, spec.formal, spec.axioms, spec.classes, spec.props).conflicts.find((c) => c.kind === 'K1-genus');
ok('смена рангов: теперь уступает кодекс', sw && sw.yields.code === 'Строительный кодекс РК', sw && sw.yields);

// --- доказательство без источника не публикуется
const noBasis = analyseCorpus(corpus, spec.formal, spec.axioms.map((a) => (a.id === 'AX1' ? { ...a, basis: '' } : a)), spec.classes, spec.props);
const nb = noBasis.conflicts.find((c) => c.kind === 'K1-genus');
ok('аксиома без основания: коллизия остаётся кандидатом', nb && nb.status === 'candidate' && nb.unsourced && nb.unsourced.length === 1);

ok('расчёт быстрее 100 мс на синтетике', R.ms < 100, R.ms);

// --- Turtle для просмотрщика разбирается
const ttl = corpusToTurtle(corpus, spec.formal, spec.classes);
const { Parser } = await import('n3');
let triples = 0;
new Parser().parse(ttl).forEach(() => triples++);
ok('Turtle корпуса разбирается', triples > 100, triples);

// --- выгрузки (ТЗ v3.1, раздел 9)
const X = await import('../src/corpus/export.js');
const work = { classes: spec.classes, props: spec.props, axioms: spec.axioms, formal: spec.formal };
const n = (t) => { let k = 0; new Parser().parse(t).forEach(() => k++); return k; };
const tDefs = n(X.definitionsTurtle(corpus, work)), tAx = n(X.axiomsTurtle(corpus, work));
const fakeReview = [{ expert: 'Эксперт', items: { [X.conflictKey(im[0])]: { verdict: 'conflict', comment: 'согласен', disputed_step: '' } } }];
const cTtl = X.conflictsTurtle(corpus, C, fakeReview);
ok('Turtle: определения с формализацией разбираются', tDefs > triples, tDefs);
ok('Turtle: аксиомы с основаниями (disjointWith + FunctionalProperty)', tAx > 10 && /owl:disjointWith/.test(X.axiomsTurtle(corpus, work)) && /FunctionalProperty/.test(X.axiomsTurtle(corpus, work)), tAx);
ok('Turtle: коллизии с шагами доказательства и вердиктом', n(cTtl) > C.length * 5 && /expertVerdict/.test(cTtl), n(cTtl));
const rows = X.conflictsCsvRows(corpus, C, fakeReview);
ok('CSV карты коллизий: строка на коллизию + столбец эксперта', rows.length === C.length + 1 && rows[0].includes('verdict_Эксперт'));
const md = X.conflictsMarkdown(corpus, res);
ok('отчёт Markdown: доказательства с источниками', /Посылка/.test(md) && /источник: Строительный кодекс РК, п\. 1\.12/.test(md) && /Аксиома/.test(md));
ok('ключ оценки коллизии не зависит от вида', X.conflictKey({ ...im[0], kind: 'K1-lex' }) === X.conflictKey(im[0]));

mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
writeFileSync(new URL('./out/conflicts-report.json', import.meta.url), JSON.stringify({ ...R, conflicts: C.map((c) => ({ kind: c.kind, status: c.status, severity: c.severity, title: c.title, yields: c.yields && c.yields.code, proof: c.proof.map((s) => `[${s.type}] ${s.text}`) })) }, null, 2));
R.failed = R.checks.filter((c) => !c.ok).map((c) => c.name);
console.log(JSON.stringify({ passed: R.checks.filter((c) => c.ok).length, failed: R.failed, ms: R.ms, stats: R.stats }, null, 2));
if (R.failed.length) process.exit(1);
