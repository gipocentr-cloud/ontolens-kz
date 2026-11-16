# -*- coding: utf-8 -*-
"""Нагрузочный набор: 5 000 классов / ~50 000 триплетов (порог раздела 5.1 ТЗ)."""
import os, random
random.seed(20260920)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = [
 '@prefix :        <http://example.org/stress#> .',
 '@prefix owl:     <http://www.w3.org/2002/07/owl#> .',
 '@prefix rdf:     <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .',
 '@prefix rdfs:    <http://www.w3.org/2000/01/rdf-schema#> .',
 '@prefix skos:    <http://www.w3.org/2004/02/skos/core#> .',
 '@prefix dcterms: <http://purl.org/dc/terms/> .',
 '',
 '<http://example.org/stress> rdf:type owl:Ontology ; rdfs:comment "нагрузочный синтетический набор"@ru .',
 '',
]
N = 5000
for i in range(1, N + 1):
    parent = ':Root' if i <= 20 else ':C%d' % random.randint(1, i - 1)
    out.append('###  http://example.org/stress#C%d' % i)
    out.append(':C%d rdf:type owl:Class , skos:Concept ;' % i)
    out.append('    rdfs:subClassOf %s ;' % parent)
    out.append('    skos:prefLabel "класс номер %d"@ru ;' % i)
    out.append('    skos:prefLabel "class number %d"@en ;' % i)
    out.append('    skos:prefLabel "%d нөмірлі класс"@kk ;' % i)
    out.append('    skos:definition "синтетическое определение класса номер %d для нагрузочной проверки"@ru ;' % i)
    out.append('    skos:definition "synthetic definition of class number %d"@en ;' % i)
    out.append('    dcterms:identifier "%d"^^<http://www.w3.org/2001/XMLSchema#integer> ;' % i)
    out.append('    rdfs:isDefinedBy <http://example.org/stress/doc/d%d> .' % (i % 40))
    out.append('')
out.append(':Root rdf:type owl:Class ; skos:prefLabel "корень"@ru .')
for d in range(40):
    out.append('<http://example.org/stress/doc/d%d> rdf:type :Document ; skos:prefLabel "Документ %d"@ru .' % (d, d))
p = os.path.join(ROOT, 'tests', 'stress-5000.ttl')
open(p, 'w', encoding='utf-8', newline='\n').write('\n'.join(out))
print(p, os.path.getsize(p))
