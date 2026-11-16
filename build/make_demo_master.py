# -*- coding: utf-8 -*-
"""
СИНТЕТИЧЕСКАЯ мастер-таблица в формате задания v2.2, раздел 3.1
(лист `terms`, столбцы в том же порядке). Нужна только для проверки
review2master.py до получения настоящего build/master.xlsx.

Запуск: python3 build/make_demo_master.py  →  data/demo-master.xlsx
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from terms import T, PARENT, STRUCTURAL
from openpyxl import Workbook
from openpyxl.styles import PatternFill, Font

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

COLUMNS = ['id', 'status', 'exclusion_reason', 'local_name', 'label_ru', 'label_en', 'label_en_source',
           'label_kk', 'kk_status', 'kk_source', 'def_ru', 'def_ru_revised', 'def_en', 'def_kk',
           'block', 'block_proposed', 'block_confidence', 'doc_source_string', 'expert_votes',
           'parent', 'doc_id', 'clause', 'alt_labels', 'threshold_category', 'legacy_target_id',
           'ifc_bridge', 'geo_bridge', 'notes']
EXECUTOR = {'local_name', 'label_en', 'def_en', 'parent'}   # «столбцы исполнителя выделены жёлтым»

wb = Workbook()
ws = wb.active
ws.title = 'terms'
ws.append(COLUMNS)
yellow = PatternFill('solid', fgColor='FFF2CC')
for i, c in enumerate(COLUMNS, 1):
    ws.cell(1, i).font = Font(bold=True)
    if c in EXECUTOR:
        ws.cell(1, i).fill = yellow
for tid, ln, blk, ru, en, kk, dru, den, doc in T:
    row = {
        'id': tid, 'status': 'canonical', 'local_name': ln, 'label_ru': ru, 'label_en': en,
        'label_en_source': 'authors_translation' if tid % 3 else 'source',
        'label_kk': kk, 'kk_status': 'expert_reviewed' if kk else '', 'def_ru': dru,
        'def_ru_revised': False, 'def_en': den, 'block': blk, 'block_proposed': blk,
        'block_confidence': 'high', 'parent': PARENT[ln], 'doc_id': doc,
        'notes': 'СИНТЕТИЧЕСКАЯ СТРОКА — не нормативные данные',
    }
    ws.append([row.get(c, '') for c in COLUMNS])

st = wb.create_sheet('structural')
st.append(['local_name', 'parent', 'label_ru', 'label_en', 'def_en', 'note'])
for ln, parent, ru, en in STRUCTURAL:
    st.append([ln, parent or '', ru, en, '', ''])

out = os.path.join(ROOT, 'data', 'demo-master.xlsx')
wb.save(out)
print(out, ws.max_row - 1, 'строк')
