#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
review2master.py — влив замечаний экспертов из OntoLens в мастер-таблицу.

Контракт данных — «Регламент работы ТЗ v2.2 и OntoLens», раздел 7:

    review-*.csv        мастер-таблица, лист terms
    ---------------     ------------------------------------------------
    id                  id (номер строки листа 3)
    verdict             verdict_<эксперт>  — новый столбец на каждого эксперта
    def_ru_fixed        def_ru, и def_ru_revised = TRUE
    label_kk_fixed      label_kk
    parent_proposed     parent
    comment             notes (дописывается, не перезаписывается)
    ts                  — (только в отчёт)

Дополнительно (ТЗ OntoLens 5.4): label_ru_fixed → label_ru, label_en_fixed → label_en,
duplicate_of и «Удалить» → пометка в notes (статус термина меняет только автор).

Правила:
  * мастер-таблица не перезаписывается по умолчанию: результат пишется в
    <имя>.reviewed.xlsx; --in-place пишет поверх, предварительно сохранив копию;
  * если два эксперта предлагают для одной ячейки разные значения — ячейка не
    меняется, случай уходит в отчёт как конфликт: решает автор;
  * слова-подтверждения («дұрыс», «верно», «ок»…) в полях исправления не
    вливаются — ровно эта путаница испортила казахский слой в первом круге;
  * повторный запуск с теми же файлами ничего не дублирует.

Запуск:
    python3 review2master.py build/master.xlsx review-*.csv
    python3 review2master.py build/master.xlsx review-*.csv --dry-run
    python3 review2master.py build/master.xlsx review-*.csv -o out.xlsx --report report.md
"""
import argparse, csv, datetime, io, json, os, re, shutil, sys
from collections import defaultdict

try:
    from openpyxl import load_workbook
    from openpyxl.styles import Font
except ImportError:
    sys.exit('Нужен openpyxl: pip install openpyxl')

VERDICTS = {'верно': 'Верно', 'ok': 'Верно', 'исправить': 'Исправить', 'fix': 'Исправить',
            'удалить': 'Удалить', 'delete': 'Удалить', 'не мой домен': 'Не мой домен',
            'not_my_domain': 'Не мой домен', 'дубль термина': 'Дубль термина', 'duplicate': 'Дубль термина',
            'не могу оценить': 'Не могу оценить', 'unclear': 'Не могу оценить'}
# «Не могу оценить» — не оценка термина, а вопрос эксперта: в столбец оценок не пишется,
# уходит в notes вместе с комментарием (ТЗ OntoLens v2.2, 6.3)
NOT_A_VERDICT = {'Не могу оценить'}

CONFIRM = {'дұрыс', 'дурыс', 'верно', 'правильно', 'ок', 'ok', 'okay', 'да', 'иә', 'ия', 'correct',
           'yes', 'true', '+', '✓', '✔', 'v', 'согласен', 'согласна', 'келісемін', 'норм', 'нормально'}

# поле файла замечаний → столбец мастер-таблицы
FIELD_MAP = [
    ('def_ru_fixed', 'def_ru'),
    ('label_ru_fixed', 'label_ru'),
    ('label_kk_fixed', 'label_kk'),
    ('label_en_fixed', 'label_en'),
    ('parent_proposed', 'parent'),
]


TRANSLIT = dict(zip('абвгдеёжзийклмнопрстуфхцчшщъыьэюяәғқңөұүһі',
                    ['a', 'b', 'v', 'g', 'd', 'e', 'e', 'zh', 'z', 'i', 'y', 'k', 'l', 'm', 'n', 'o', 'p', 'r', 's',
                     't', 'u', 'f', 'kh', 'ts', 'ch', 'sh', 'shch', '', 'y', '', 'e', 'yu', 'ya',
                     'a', 'g', 'q', 'n', 'o', 'u', 'u', 'h', 'i']))


def slug(s):
    """Имя эксперта для столбца verdict_<эксперт>: латиница — так же, как в именах файлов OntoLens."""
    t = ''.join(TRANSLIT.get(c, c) for c in str(s or 'expert').strip().lower())
    t = re.sub(r'[^a-z0-9]+', '_', t).strip('_')
    return t[:40] or 'expert'


def is_confirmation(v):
    return str(v or '').strip().lower().rstrip('.!') in CONFIRM


def read_review(path):
    """Прочитать review-*.csv или .json. Возвращает (эксперт, [строки])."""
    with open(path, 'rb') as f:
        raw = f.read()
    text = raw.decode('utf-8-sig')
    if path.lower().endswith('.json') or text.lstrip().startswith('{'):
        d = json.loads(text)
        rows = []
        for it in d.get('items', []):
            r = {k: ('' if v is None else str(v)) for k, v in it.items()}
            r['verdict'] = it.get('verdict_label') or it.get('verdict') or ''
            rows.append(r)
        return d.get('expert') or '', rows
    first = text.splitlines()[0] if text else ''
    delim = ';' if first.count(';') >= first.count(',') else ','
    rows = list(csv.DictReader(io.StringIO(text), delimiter=delim))
    expert = next((r.get('expert') for r in rows if r.get('expert')), '')
    if not expert:
        m = re.match(r'review-(.+?)-\d{6}', os.path.basename(path), re.I)
        expert = m.group(1) if m else os.path.splitext(os.path.basename(path))[0]
    return expert, rows


def norm_id(v):
    s = str(v if v is not None else '').strip()
    if re.fullmatch(r'\d+(\.0)?', s):
        return str(int(float(s)))
    return s


def local_from_iri(iri):
    iri = iri or ''
    return re.split(r'[#/]', iri)[-1] if iri else ''


def main(argv=None):
    ap = argparse.ArgumentParser(description='Влив замечаний OntoLens в мастер-таблицу')
    ap.add_argument('master', help='мастер-таблица .xlsx (лист terms)')
    ap.add_argument('reviews', nargs='+', help='файлы review-*.csv / .json')
    ap.add_argument('-o', '--out', help='куда записать результат (по умолчанию <master>.reviewed.xlsx)')
    ap.add_argument('--in-place', action='store_true', help='писать поверх мастер-таблицы (с резервной копией)')
    ap.add_argument('--dry-run', action='store_true', help='только отчёт, файл не записывается')
    ap.add_argument('--report', help='путь к отчёту .md (по умолчанию рядом с результатом)')
    ap.add_argument('--sheet', default='terms')
    a = ap.parse_args(argv)

    wb = load_workbook(a.master)
    if a.sheet not in wb.sheetnames:
        sys.exit(f'В {a.master} нет листа {a.sheet!r}')
    ws = wb[a.sheet]
    header = [c.value for c in ws[1]]
    col = {str(h).strip(): i + 1 for i, h in enumerate(header) if h is not None}
    if 'id' not in col:
        sys.exit('В листе нет столбца id')

    by_id, by_local = {}, {}
    for r in range(2, ws.max_row + 1):
        rid = norm_id(ws.cell(r, col['id']).value)
        if rid:
            by_id[rid] = r
        if 'local_name' in col:
            ln = ws.cell(r, col['local_name']).value
            if ln:
                by_local[str(ln).strip()] = r

    today = datetime.date.today().isoformat()
    log = {'applied': [], 'unchanged': [], 'conflicts': [], 'skipped': [], 'unmatched': [], 'notes': [],
           'verdicts': 0, 'files': []}

    proposals = defaultdict(list)    # (row, column) -> [(expert, value, ts)]
    notes_add = defaultdict(list)    # row -> [text]
    verdict_cells = []               # (row, column_name, value)

    for path in a.reviews:
        expert, rows = read_review(path)
        log['files'].append((os.path.basename(path), expert, len(rows)))
        vcol = 'verdict_' + slug(expert)
        for rv in rows:
            rid = norm_id(rv.get('id'))
            row = by_id.get(rid) if rid else None
            if row is None:
                row = by_local.get(local_from_iri(rv.get('iri')))
            if row is None:
                log['unmatched'].append((expert, rid or rv.get('iri', ''), rv.get('label_ru', '')))
                continue
            tid = norm_id(ws.cell(row, col['id']).value)
            verdict = VERDICTS.get(str(rv.get('verdict', '')).strip().lower(), str(rv.get('verdict', '')).strip())
            if verdict and verdict not in NOT_A_VERDICT:
                verdict_cells.append((row, vcol, verdict))
            for src, dst in FIELD_MAP:
                v = str(rv.get(src) or '').strip()
                if not v:
                    continue
                if is_confirmation(v):
                    log['skipped'].append((tid, dst, expert, v, 'слово-подтверждение вместо исправления'))
                    continue
                if dst not in col:
                    log['skipped'].append((tid, dst, expert, v, f'в мастер-таблице нет столбца {dst}'))
                    continue
                proposals[(row, dst)].append((expert, v, rv.get('ts', '')))
            # дата берётся из отметки времени оценки: повторный влив в другой день не дублирует пометки
            day = str(rv.get('ts') or '')[:10] or today
            c = str(rv.get('comment') or '').strip()
            if verdict in NOT_A_VERDICT:
                notes_add[row].append(f'[{expert}, {day}] не может оценить: {c or "без пояснения"}')
            elif c:
                notes_add[row].append(f'[{expert}, {day}] {c}')
            if verdict == 'Удалить':
                notes_add[row].append(f'[{expert}, {day}] предлагает удалить термин')
            dup = str(rv.get('duplicate_of') or '').strip()
            if verdict == 'Дубль термина' or dup:
                notes_add[row].append(f'[{expert}, {day}] дубль термина № {dup or "?"}')

    # ---- столбцы оценок: по одному на эксперта, в конец таблицы
    for _, vcol, _ in verdict_cells:
        if vcol not in col:
            nc = ws.max_column + 1
            ws.cell(1, nc, vcol).font = Font(bold=True)
            col[vcol] = nc
    for row, vcol, verdict in verdict_cells:
        ws.cell(row, col[vcol], verdict)
        log['verdicts'] += 1

    # ---- правки ячеек
    for (row, dst), props in sorted(proposals.items()):
        tid = norm_id(ws.cell(row, col['id']).value)
        values = {v for _, v, _ in props}
        old = ws.cell(row, col[dst]).value
        old_s = '' if old is None else str(old)
        if len(values) > 1:
            log['conflicts'].append((tid, dst, old_s, [(e, v) for e, v, _ in props]))
            continue
        new = values.pop()
        experts = ', '.join(sorted({e for e, _, _ in props}))
        if new == old_s.strip():
            log['unchanged'].append((tid, dst, experts))
            continue
        ws.cell(row, col[dst], new)
        log['applied'].append((tid, dst, old_s, new, experts))
        if dst == 'def_ru' and 'def_ru_revised' in col:
            ws.cell(row, col['def_ru_revised'], True)

    # ---- notes: дописать, не дублируя
    if notes_add and 'notes' not in col:
        nc = ws.max_column + 1
        ws.cell(1, nc, 'notes').font = Font(bold=True)
        col['notes'] = nc
    for row, items in notes_add.items():
        cur = ws.cell(row, col['notes']).value
        cur = '' if cur is None else str(cur)
        added = [x for x in dict.fromkeys(items) if x not in cur]
        if added:
            ws.cell(row, col['notes'], (cur + '\n' if cur else '') + '\n'.join(added))
            for x in added:
                log['notes'].append((norm_id(ws.cell(row, col['id']).value), x))

    # ---- запись
    if a.in_place:
        out = a.master
    else:
        base, ext = os.path.splitext(a.master)
        out = a.out or base + '.reviewed' + ext
    report = a.report or os.path.splitext(out)[0] + '.review-report.md'

    if not a.dry_run:
        if a.in_place:
            stamp = datetime.datetime.now().strftime('%y%m%d-%H%M%S')
            shutil.copy2(a.master, os.path.splitext(a.master)[0] + f'.backup-{stamp}.xlsx')
        wb.save(out)

    write_report(report, a, out, log)
    print(f'Файлов замечаний: {len(log["files"])}; оценок записано: {log["verdicts"]}; '
          f'правок: {len(log["applied"])}; конфликтов: {len(log["conflicts"])}; '
          f'пропущено: {len(log["skipped"])}; не сопоставлено: {len(log["unmatched"])}')
    print(('(dry-run, файл не записан) ' if a.dry_run else 'Результат: ' + out + '\n') + 'Отчёт: ' + report)
    return 0


def write_report(path, a, out, log):
    L = ['# Влив замечаний экспертов в мастер-таблицу', '',
         f'{datetime.datetime.now():%Y-%m-%d %H:%M}. Мастер-таблица: `{a.master}`. '
         + ('Режим проверки: файл не записан.' if a.dry_run else f'Результат: `{out}`.'), '',
         '## Файлы', '', '| Файл | Эксперт | Строк |', '|---|---|---:|']
    for f, e, n in log['files']:
        L.append(f'| {f} | {e} | {n} |')
    L += ['', f'Оценок записано: **{log["verdicts"]}**. Правок ячеек: **{len(log["applied"])}**. '
          f'Конфликтов: **{len(log["conflicts"])}**. Пропущено: **{len(log["skipped"])}**. '
          f'Не сопоставлено: **{len(log["unmatched"])}**.', '']
    if log['conflicts']:
        L += ['## Конфликты — решает автор', '',
              'Эксперты предложили разные значения для одной ячейки; ячейка не изменена.', '',
              '| id | Столбец | Сейчас | Предложения |', '|---|---|---|---|']
        for tid, dst, old, props in log['conflicts']:
            L.append(f'| {tid} | {dst} | {old} | ' + '; '.join(f'{e}: «{v}»' for e, v in props) + ' |')
        L.append('')
    if log['applied']:
        L += ['## Внесённые правки', '', '| id | Столбец | Было | Стало | Эксперт |', '|---|---|---|---|---|']
        for tid, dst, old, new, e in log['applied']:
            L.append(f'| {tid} | {dst} | {old} | {new} | {e} |')
        L.append('')
    if log['skipped']:
        L += ['## Пропущено', '', '| id | Столбец | Эксперт | Значение | Причина |', '|---|---|---|---|---|']
        for tid, dst, e, v, why in log['skipped']:
            L.append(f'| {tid} | {dst} | {e} | {v} | {why} |')
        L.append('')
    if log['unmatched']:
        L += ['## Не сопоставлено с мастер-таблицей', '', '| Эксперт | id / IRI | Метка |', '|---|---|---|']
        for e, k, lbl in log['unmatched']:
            L.append(f'| {e} | {k} | {lbl} |')
        L.append('')
    if log['notes']:
        L += ['## Дописано в notes', '']
        for tid, x in log['notes']:
            L.append(f'- {tid}: {x}')
        L.append('')
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(L))


if __name__ == '__main__':
    sys.exit(main())
