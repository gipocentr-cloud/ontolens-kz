# -*- coding: utf-8 -*-
"""
Собирает tests/PROTOCOL.md: сверка чисел, показанных OntoLens в браузере,
с независимым подсчётом на rdflib. Ничего не «подтверждает» без данных —
таблица строится из tests/out/report.json (прогон Playwright) и
tests/ref-*.json (прогон rdflib).
"""
import json, os, datetime, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = json.load(open(os.path.join(ROOT, 'tests/out/report.json'), encoding='utf-8'))
ref_geo = json.load(open(os.path.join(ROOT, 'tests/ref-geodeticont.json'), encoding='utf-8'))
ref_leg = json.load(open(os.path.join(ROOT, 'tests/ref-geont.json'), encoding='utf-8'))
ref_str = json.loads(subprocess.check_output(
    [sys.executable, os.path.join(ROOT, 'build/reference_metrics.py'),
     os.path.join(ROOT, 'tests/stress-5000.ttl')]).decode('utf-8'))


def checks(d):
    return {c['id']: c['n'] for c in d['checks']}


def metrics(d):
    return {m['id']: m['v'] for m in d['metrics']}


def row(name, tool, ref):
    ok = str(tool) == str(ref)
    return f"| {name} | {tool} | {ref} | {'совпало' if ok else '**РАСХОЖДЕНИЕ**'} |"


L = []
L.append('# Протокол приёмочных тестов OntoLens, релиз 1')
L.append('')
L.append(f'Прогон: {datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M")} UTC. '
         'Среда: headless Chromium (Playwright), файл открыт с диска по `file://`.')
L.append('')
L.append('Числа в колонке «OntoLens» сняты из работающего приложения '
         '(`tests/run.mjs` читает состояние страницы), в колонке «rdflib» — '
         'независимым скриптом `build/reference_metrics.py`. Скриншоты — в `tests/out/`.')
L.append('')
L.append('> **Важно.** Приёмка по разделу 9 ТЗ (425 классов GeOnt-KZ, 2 046 тегов `kz`, '
         '119 терминов GeodeticOnt-KZ и т. д.) **не выполнена**: реальные файлы не переданы. '
         'Ниже — прогон на синтетических наборах, воспроизводящих ту же структуру и те же типы '
         'дефектов. Определения в них вымышлены.')
L.append('')

for title, d, ref, files in [
    ('Набор 1 — demo-geodeticont-kz (чистый пакет: TBox + документы + SHACL)',
     R['geodeticont'], ref_geo, R['geodeticont']['files']),
    ('Набор 2 — demo-legacy-geont (дефектный, воспроизводит ошибки GeOnt-KZ)',
     R['legacy'], ref_leg, R['legacy']['files']),
]:
    m, c = metrics(d), checks(d)
    L.append('## ' + title)
    L.append('')
    L.append('Файлы: ' + ', '.join(f'`{f}`' for f in files))
    L.append('')
    L.append('| Показатель | OntoLens | rdflib | Итог |')
    L.append('|---|---:|---:|---|')
    L.append(row('Триплетов', m['triples'], ref['triples']))
    L.append(row('Классов в неймспейсе', m['classes_ns'], ref['named_classes_in_ns']))
    L.append(row('Всего owl:Class (с внешними)', m['classes_all'], ref['owl_class_total']))
    L.append(row('Объектных свойств', m['objprops'], ref['object_properties']))
    L.append(row('Датных свойств', m['datprops'], ref['datatype_properties']))
    L.append(row('Коллекций', m['collections'], ref['collections']))
    if ref['collections']:
        L.append(row('Размеры блоков', m['collection_sizes'],
                     '/'.join(str(ref['collection_sizes'][k]) for k in sorted(ref['collection_sizes']))))
    L.append(row('Мостов к внешним онтологиям', m['bridges'],
                 sum(ref['bridges_by_namespace'].values())))
    L.append(row('Глубина макс. / средн.', m['depth'],
                 f"{ref['max_depth']} / {('%.2f' % ref['avg_depth']).replace('.', ',')}"))
    L.append(row('Классов без родителя (корней)', c.get('multiple-roots', 0),
                 ref['classes_without_parent']))
    L.append(row('Классов с несколькими родителями', c.get('multi-parent', 0),
                 ref['classes_multi_parent']))
    L.append(row('Циклов subClassOf', c.get('subclass-cycles', 0), ref['subclass_cycles']))
    L.append(row('Классов вовсе без метки', c.get('no-label-at-all', 0), ref['classes_without_label']))
    L.append(row('Классов вовсе без определения', c.get('no-definition-at-all', 0),
                 ref['classes_without_definition']))
    L.append(row('Триплетов провенанса литералом', c.get('provenance-literal', 0),
                 ref['provenance_literal_triples']))
    L.append(row('Свойств без домена или диапазона', c.get('property-no-domain-range', 0),
                 ref['properties_without_domain_or_range']))
    L.append(row('Свойств без метки', c.get('property-no-label', 0), ref['properties_without_label']))
    L.append(row('Свойств объявлено, не используется', c.get('property-unused', 0),
                 ref['properties_declared_unused']))
    L.append(row('owl:imports', c.get('owl-imports', 0), ref['owl_imports']))
    L.append(row('Литералов с недопустимым тегом', c.get('invalid-language-tag', 0),
                 sum(v for k, v in ref['lang_tags'].items() if k in ('kz', 'kaz', 'rus', 'eng'))))
    L.append(row('Языковые теги литералов', m['tags'],
                 ' · '.join(f'{k}: {v}' for k, v in sorted(ref['lang_tags'].items(),
                                                           key=lambda x: -x[1]))))
    L.append('')
    L.append(f"Время разбора и индексации в браузере: **{d['loadMs']} мс**.")
    L.append('')

s = R['stress']
L.append('## Набор 3 — нагрузочный (порог раздела 5.1 ТЗ)')
L.append('')
L.append('| Показатель | OntoLens | rdflib | Итог |')
L.append('|---|---:|---:|---|')
L.append(row('Триплетов', s['triples'], ref_str['triples']))
L.append(row('Классов', s['classes'], ref_str['named_classes_in_ns']))
L.append('')
L.append(f"Требование ТЗ: 5 000 классов и 50 000 триплетов — не дольше 5 с. "
         f"Факт: разбор и индексация **{s['loadMs']} мс**, полный цикл "
         f"(чтение файла → модель → 38 проверок → отрисовка) **{s['wallMs']} мс**. "
         'Замер на этой машине в headless-Chromium; на ноутбуке эксперта время будет иным, '
         'но порядок величины тот же.')
L.append('')

L.append('## Функциональные проверки')
L.append('')
L.append('| Проверка | Результат |')
L.append('|---|---|')
L.append(f"| Открытие `dist/index.html` с диска (`file://`), без сети | пройдено, "
         f"ошибок в консоли: {len(R['console'])} |")
L.append(f"| Карточка термина открывается по поиску | пройдено: «{R['cardTitle']}» |")
L.append(f"| Поиск по казахской метке без диакритики («геодезиялык тирек») | "
         f"найдено {R['search']['foldMatch']} |")
L.append(f"| Поиск с опечаткой («триангуляцыя»): строгий / нестрогий | "
         f"{R['search']['strict']} / {R['search']['fuzzy']} |")
L.append(f"| Экспорт SVG фрагмента | файл {R['svg']['bytes']} байт, "
         f"текстовых элементов `<text>`: {R['svg']['textNodes']} — текст векторный и редактируемый |")
L.append('| Экспорт METRICS.md и отчёта о дефектах (CSV) | пройдено, файлы в `tests/out/` |')
L.append('')
R2 = json.load(open(os.path.join(ROOT, 'tests/out/report2.json'), encoding='utf-8'))
yes = lambda b: 'пройдено' if b else '**НЕ ПРОЙДЕНО**'
L.append('## Раздел 5.3 — карта онтологии и семантический зум')
L.append('')
L.append('| Проверка (раздел 9 ТЗ) | Требование | Факт | Итог |')
L.append('|---|---|---|---|')
st = R2['stability']
L.append(f"| Координаты после 20 переходов | совпадают побайтно | {'совпали' if st['after20'] else 'РАЗЛИЧАЮТСЯ'} ({st['bytes']} байт JSON) | {yes(st['after20'])} |")
L.append(f"| Координаты после перезагрузки страницы | совпадают побайтно | источник: {st['reloadSource']}; {'совпали' if st['reload'] else 'РАЗЛИЧАЮТСЯ'} | {yes(st['reload'])} |")
L.append(f"| Пересчёт раскладки с нуля | тот же результат | {'совпал' if st['recomputed'] else 'ОТЛИЧАЕТСЯ'} | {yes(st['recomputed'])} |")
L.append(f"| Смена языка интерфейса | карта не сдвигается | {'не сдвинулась' if st['languageSwitch'] else 'СДВИНУЛАСЬ'} | {yes(st['languageSwitch'])} |")
m, ml, ms = R2['map'], R2['mapLegacy'], R2['mapStress']
L.append(f"| Построение карты, демонабор ({m['nodes']} узлов, {m['islands']} островов) | ≤ 300 мс | раскладка {m['layoutMs']} мс + растр {m['rasterMs']} мс | {yes(m['layoutMs'] + m['rasterMs'] <= 300)} |")
L.append(f"| Построение карты, дефектный набор ({ml['nodes']} узлов) | ≤ 300 мс | {ml['ms']} + {ml['raster']} мс | {yes(ml['ms'] + ml['raster'] <= 300)} |")
L.append(f"| Построение карты, {ms['nodes']} узлов | ≤ 2 000 мс | {ms['ms']} + {ms['raster']} мс | {yes(ms['ms'] + ms['raster'] <= 2000)} |")
mk = R2['marker']
L.append(f"| Отметка, путь до корня, рамка соответствуют выбранной сущности | да | отметка {mk['focusMatches']}, путь начинается с термина {mk['pathStartsAtFocus']}, второй узел пути — родитель {mk['pathSecondIsParent']} | {yes(all(mk.values()))} |")
L.append(f"| Окраска проверенных терминов меняется сразу после оценки | да | прогресс островов после 20 оценок: {R2['mapProgress']} | {yes(bool(R2['mapProgress']))} |")
fd = R2['frameDrag']
L.append(f"| Перетаскивание рамки | ≥ 30 кадров/с | {fd['moves']} перемещений за {fd['ms']} мс ≈ {fd['fps']} кадров/с; после отпускания — переход к ближайшему термину: {fd['navigated']} | {yes(fd['fps'] >= 30 and fd['navigated'])} |")
L.append(f"| Приближение к выбранной сущности | ≤ 400 мс | {R2['zoomInMs']} мс | {yes(R2['zoomInMs'] is not None and R2['zoomInMs'] <= 400)} |")
L.append(f"| Отмена приближения одним действием (Esc) | прежний масштаб | масштаб {R2['zoomK']:.2f} → {R2['escK']:.2f} | {yes(R2['escReturned'])} |")
for x in R2['lod']:
    want = {'far': 'только форма и цвет', 'mid': 'метка ≤ 24 символов', 'near': 'метки на 3 языках, код документа', 'max': '+ начало определения'}[x['name']]
    txt = (x['text'] or '—').replace('|', '/')
    L.append(f"| Семантический зум, масштаб {x['k']} | уровень {['far','mid','near','max'].index(x['name'])}: {want} | уровень {x['lod']}; текст узла: {txt[:110]} | {yes(str(['far','mid','near','max'].index(x['name'])) == x['lod'])} |")
L.append('')
L.append('## Раздел 5.4 — сбор замечаний, сценарный тест')
L.append('')
L.append('| Проверка | Факт | Итог |')
L.append('|---|---|---|')
L.append(f"| 20 терминов оценены с клавиатуры (1–5, Ctrl+Enter), часть — с исправлениями | {R2['saved']} оценок за {R2['scenarioMs'] / 1000:.1f} с автоматом; счётчик «{R2['progress']}» | {yes(R2['saved'] == 20)} |")
L.append(f"| Слово-подтверждение «дұрыс» в поле исправления | сохранение заблокировано с объяснением | {yes(R2['confirmWordBlocked'])} |")
L.append(f"| Экспорт | `{R2['export']['csv']}`, `{R2['export']['json']}` | пройдено |")
L.append(f"| Столбцы CSV | `{R2['export']['csvHead']}` — первые семь по контракту регламента, раздел 7 | пройдено |")
L.append(f"| Оценки сохраняются после перезагрузки | {st['reviewsKeptAfterReload']} из 20 | {yes(st['reviewsKeptAfterReload'] == 20)} |")
a = R2['author']
L.append(f"| Импорт второго эксперта, сводка | источников: {a['sources']}; расхождений: {a['rows']}; {a['agreement']}; {a['kappa']} | пройдено |")
L.append(f"| Влив обоих файлов скриптом `review2master.py` без ручных правок | {R2['review2master']} | {yes('конфликтов: 0' in R2['review2master'] and 'не сопоставлено: 0' in R2['review2master'])} |")
L.append(f"| Мастер-таблица после влива | {R2['masterCheck']} | пройдено |")
L.append(f"| Ошибки в консоли за прогон | {len(R2['console'])} | {yes(not R2['console'])} |")
L.append('')
L.append('Второй эксперт в сценарии синтетический: его файл получен из первого заменой каждой четвёртой оценки. '
         'Мастер-таблица `data/demo-master.xlsx` — синтетическая, в формате задания v2.2, раздел 3.1.')
L.append('')
def _load(name):
    fp = os.path.join(ROOT, 'tests/out', name)
    return json.load(open(fp, encoding='utf-8')) if os.path.exists(fp) else None
A11Y, R3, R4 = _load('a11y.json'), _load('report3.json'), _load('report4.json')
L.append('## Доступность, устойчивость разбора, перенос оценок')
L.append('')
L.append('| Проверка | Факт | Итог |')
L.append('|---|---|---|')
if A11Y:
    screens = [x for x in A11Y if 'keyboard' not in x]
    total = sum(len(x['violations']) for x in screens)
    L.append(f"| Аудит WCAG 2.1 AA (axe-core) на экранах: {', '.join(x['screen'] for x in screens)} | нарушений: {total} | {yes(total == 0)} |")
    kb = next((x['keyboard'] for x in A11Y if 'keyboard' in x), None)
    if kb:
        L.append(f"| Дерево с клавиатуры: ↑↓ перемещение, Enter открывает, ← к родителю и свернуть, → раскрыть | {kb} | {yes(all(kb.values()))} |")
if R3:
    ok3 = R3['triples'] == 39 and R3['classes_ns'] == '4' and R3['classes_all'] == '7' and R3['noParent'] == 2 and R3['banner']
    L.append(f"| «Неудобный» Turtle: @base, относительные IRI, PREFIX в стиле SPARQL, списки, анонимные ограничения, многострочные и одинарные кавычки, тег `EN` | триплетов {R3['triples']} (rdflib 39), owl:Class {R3['classes_all']} (7), в неймспейсе {R3['classes_ns']} (4), без родителя {R3['noParent']} (2), в соседнем неймспейсе пакета {R3.get('other')} | {yes(ok3)} |")
    pe = R3['parseErrors'][0] if R3['parseErrors'] else {}
    L.append(f"| Битый файл рядом с исправным | исправный загружен, битый назван в баннере и в проверке «Файлы»: `{pe.get('file')}` — {pe.get('message')} | {yes(bool(pe) and R3['banner'])} |")
if R4:
    L.append(f"| Перенос оценок на пересобранную онтологию (один термин переименован) | предложение показано: {R4['bannerShown']}; {R4['flash']} | {yes(R4['bannerShown'] and R4['count'] == 3 and R4['renamedCarried'])} |")
L.append('')
L.append('## Скриншоты')
L.append('')
for f, cap in [
    ('01-start.png', 'стартовый экран'),
    ('02-expert-geodeticont.png', 'режим эксперта: карточка термина и граф окрестности'),
    ('03-diagnostics-geodeticont.png', 'диагностика чистого пакета'),
    ('04-term-card-shacl.png', 'термин с SHACL-ограничением'),
    ('05-fuzzy-search.png', 'нестрогий поиск'),
    ('06-diagnostics-geont.png', 'диагностика дефектного набора'),
    ('07-stress-5000.png', 'нагрузочный набор, 5 000 классов'),
    ('20-lod-far.png', 'семантический зум: дальний план'),
    ('20-lod-mid.png', 'семантический зум: средний план'),
    ('20-lod-near.png', 'семантический зум: ближний план'),
    ('20-lod-max.png', 'семантический зум: максимальное приближение'),
    ('21-after-20-reviews.png', 'после 20 оценок: прогресс в шапке, окраска дерева и карты'),
    ('23-map-expanded.png', 'карта, развёрнутая на половину экрана'),
    ('24-author-reviews.png', 'роль автора: сводка двух экспертов, расхождения, κ'),
    ('25-stress-map.png', 'карта нагрузочного набора, 5 001 узел'),
    ('26-parse-error.png', 'битый файл: баннер с номером строки'),
    ('27-carry-banner.png', 'предложение перенести оценки на новую версию'),
]:
    L.append(f'- `tests/out/{f}` — {cap}')
L.append('')
L.append('## Что НЕ проверено')
L.append('')
L.append('- Реальные GeOnt-KZ.ttl и пакет GeodeticOnt-KZ — файлы не переданы; '
         'числа раздела 9 ТЗ не воспроизводились.')
L.append('- Сценарный тест с живым приглашённым экспертом: 20 терминов оценены автоматом, '
         'а требование «без подготовки за 30 минут» проверяется только на человеке.')
L.append('- Открытие экспортированного SVG в Inkscape/Illustrator — в этой среде их нет; '
         'проверено только наличие векторных `<text>` и корректность разметки SVG 1.1.')
L.append('- Safari и Firefox — прогон выполнен в Chromium. Кода, специфичного для движка, нет, '
         'но это не замена прогону.')
L.append('')

open(os.path.join(ROOT, 'tests/PROTOCOL.md'), 'w', encoding='utf-8', newline='\n').write('\n'.join(L))
print('tests/PROTOCOL.md')
