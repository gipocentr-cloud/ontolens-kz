# -*- coding: utf-8 -*-
"""
Независимый подсчёт метрик и дефектов на rdflib.
Служит эталоном для сверки с числами, которые показывает OntoLens
(раздел 9 ТЗ: «метрики, показанные инструментом, совпадают с METRICS.md,
посчитанным rdflib»).

Запуск:  python3 build/reference_metrics.py data/demo-geodeticont-kz.ttl [...]
Печатает JSON.
"""
import sys, json, collections
from rdflib import Graph, URIRef, Literal, BNode, RDF, RDFS, OWL
from rdflib.namespace import SKOS, DCTERMS

SH = URIRef("http://www.w3.org/ns/shacl#")


def analyse(paths):
    g = Graph()
    for p in paths:
        g.parse(p, format="turtle")

    # неймспейс онтологии: берём самый частый префикс среди субъектов-классов
    classes_all = set(g.subjects(RDF.type, OWL.Class))
    named = {c for c in classes_all if isinstance(c, URIRef)}
    ns_count = collections.Counter()
    for c in named:
        ns_count[str(c).rsplit("#", 1)[0] + "#" if "#" in str(c)
                  else str(c).rsplit("/", 1)[0] + "/"] += 1
    ns = ns_count.most_common(1)[0][0] if ns_count else ""
    in_ns = {c for c in named if str(c).startswith(ns)}

    obj_props = {p for p in g.subjects(RDF.type, OWL.ObjectProperty) if isinstance(p, URIRef)}
    dat_props = {p for p in g.subjects(RDF.type, OWL.DatatypeProperty) if isinstance(p, URIRef)}
    props = obj_props | dat_props

    # языковые теги
    tags = collections.Counter()
    for s, p, o in g:
        if isinstance(o, Literal) and o.language:
            tags[o.language] += 1

    label_props = [SKOS.prefLabel, RDFS.label]
    def labels(e):
        out = collections.defaultdict(list)
        for lp in label_props:
            for o in g.objects(e, lp):
                if isinstance(o, Literal):
                    out[o.language or ""].append(str(o))
        return out

    def defs(e):
        out = collections.defaultdict(list)
        for dp in (SKOS.definition, RDFS.comment):
            for o in g.objects(e, dp):
                if isinstance(o, Literal):
                    out[o.language or ""].append(str(o))
        return out

    # иерархия
    parents = collections.defaultdict(set)
    children = collections.defaultdict(set)
    for s, o in g.subject_objects(RDFS.subClassOf):
        if isinstance(s, URIRef) and isinstance(o, URIRef):
            parents[s].add(o)
            children[o].add(s)

    internal_parents = {c: {p for p in parents.get(c, ()) if p in in_ns} for c in in_ns}
    no_parent = sorted(str(c) for c in in_ns if not internal_parents[c])
    multi_parent = sorted(str(c) for c in in_ns if len(internal_parents[c]) > 1)

    # глубина
    depth_cache = {}
    def depth(c, seen=None):
        if c in depth_cache:
            return depth_cache[c]
        seen = seen or set()
        if c in seen:
            return 0
        ps = internal_parents.get(c) or set()
        d = 1 if not ps else 1 + max(depth(p, seen | {c}) for p in ps)
        depth_cache[c] = d
        return d
    depths = {c: depth(c) for c in in_ns}
    maxd = max(depths.values()) if depths else 0
    avgd = round(sum(depths.values()) / len(depths), 2) if depths else 0

    # циклы
    cycles = []
    for c in in_ns:
        stack = [(c, {c})]
        while stack:
            cur, seen = stack.pop()
            for p in internal_parents.get(cur, ()):
                if p == c:
                    cycles.append(str(c))
                    stack = []
                    break
                if p not in seen:
                    stack.append((p, seen | {p}))

    no_label = sorted(str(c) for c in in_ns if not labels(c))
    no_def = sorted(str(c) for c in in_ns if not defs(c))

    prov_props = [RDFS.isDefinedBy, DCTERMS.source]
    prov_literal = []
    prov_iri = []
    for s, p, o in g:
        if p in prov_props:
            (prov_literal if isinstance(o, Literal) else prov_iri).append(str(s))
    cls_with_prov = {c for c in in_ns
                     if any(True for pp in prov_props for _ in g.objects(c, pp))}
    cls_prov_iri = {c for c in in_ns
                    if any(isinstance(o, URIRef) for pp in prov_props for o in g.objects(c, pp))}

    props_no_dom_range = sorted(
        str(p) for p in props
        if not list(g.objects(p, RDFS.domain)) or not list(g.objects(p, RDFS.range)))
    props_no_label = sorted(str(p) for p in props if not labels(p))
    used = set()
    for s, p, o in g:
        used.add(p)
    props_unused = sorted(str(p) for p in props if p not in used)

    collections_ = sorted(g.subjects(RDF.type, SKOS.Collection))
    coll_sizes = {str(c): len(list(g.objects(c, SKOS.member))) for c in collections_}

    concepts = {c for c in g.subjects(RDF.type, SKOS.Concept) if isinstance(c, URIRef)}
    in_coll = set()
    for c in collections_:
        in_coll |= set(g.objects(c, SKOS.member))

    bridges = collections.Counter()
    for s, o in g.subject_objects(RDFS.subClassOf):
        if isinstance(s, URIRef) and isinstance(o, URIRef) and s in in_ns and o not in in_ns:
            base = str(o).rsplit("#", 1)[0] if "#" in str(o) else str(o).rsplit("/", 1)[0]
            bridges[base] += 1

    dup_labels = collections.defaultdict(list)
    for c in in_ns | concepts | props:
        for lang, vals in labels(c).items():
            for v in vals:
                dup_labels[(lang, v)].append(str(c))
    same_label = {("%s|%s" % k): v for k, v in dup_labels.items() if len(v) > 1}

    return {
        "namespace": ns,
        "triples": len(g),
        "owl_class_total": len(classes_all),
        "named_classes_in_ns": len(in_ns),
        "object_properties": len(obj_props),
        "datatype_properties": len(dat_props),
        "skos_concepts": len(concepts),
        "collections": len(collections_),
        "collection_sizes": coll_sizes,
        "concepts_outside_collections": len(concepts - in_coll),
        "lang_tags": dict(sorted(tags.items())),
        "classes_without_parent": len(no_parent),
        "classes_without_parent_list": no_parent[:40],
        "classes_multi_parent": len(multi_parent),
        "subclass_cycles": len(set(cycles)),
        "classes_without_label": len(no_label),
        "classes_without_definition": len(no_def),
        "provenance_literal_triples": len(prov_literal),
        "provenance_iri_triples": len(prov_iri),
        "classes_with_provenance": len(cls_with_prov),
        "classes_with_provenance_iri": len(cls_prov_iri),
        "properties_without_domain_or_range": len(props_no_dom_range),
        "properties_without_label": len(props_no_label),
        "properties_declared_unused": len(props_unused),
        "bridges_by_namespace": dict(bridges),
        "max_depth": maxd,
        "avg_depth": avgd,
        "duplicate_labels": len(same_label),
        "owl_imports": len(list(g.objects(None, OWL.imports))),
    }


if __name__ == "__main__":
    print(json.dumps(analyse(sys.argv[1:]), ensure_ascii=False, indent=2))
