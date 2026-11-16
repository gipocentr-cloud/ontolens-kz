# -*- coding: utf-8 -*-
"""
Генератор СИНТЕТИЧЕСКИХ тестовых наборов для OntoLens.

Пишет детерминированно (повторный запуск — побайтно тот же результат):
  data/demo-geodeticont-kz.ttl         — «чистый» пакет: 16 блоков, 119 терминов,
                                          паннинг класс+концепт, провенанс IRI, тег kk
  data/demo-geodeticont-kz-docs.ttl    — ABox нормативных документов (19)
  data/demo-geodeticont-kz-shapes.ttl  — SHACL: 1 полный шейп + 6 заготовок
  data/demo-legacy-geont.ttl           — «дефектный» набор, воспроизводящий
                                          типы ошибок, найденные в GeOnt-KZ.ttl

ЭТО НЕ НОРМАТИВНЫЕ ДАННЫЕ. Определения вымышлены.
"""
import os, sys, io
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from terms import T, STRUCTURAL, PARENT, DOCS, BLOCK_NAMES

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
os.makedirs(DATA, exist_ok=True)

NS = "http://ontogeo.kz/geodeticont-kz#"
DOCNS = "http://ontogeo.kz/geodeticont-kz/doc/"

PREFIXES = """@prefix :        <http://ontogeo.kz/geodeticont-kz#> .
@prefix owl:     <http://www.w3.org/2002/07/owl#> .
@prefix rdf:     <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs:    <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:     <http://www.w3.org/2001/XMLSchema#> .
@prefix skos:    <http://www.w3.org/2004/02/skos/core#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix sh:      <http://www.w3.org/ns/shacl#> .
@prefix ifc:     <http://www.buildingsmart-tech.org/ifcOWL/IFC4#> .
@prefix geo:     <http://www.opengis.net/ont/geosparql#> .
@prefix doc:     <http://ontogeo.kz/geodeticont-kz/doc/> .
"""


def esc(s):
    return (s.replace("\\", "\\\\").replace('"', '\\"')
             .replace("\n", "\\n").replace("\r", ""))


def lit(s, lang=None, dt=None):
    if lang:
        return '"%s"@%s' % (esc(s), lang)
    if dt:
        return '"%s"^^%s' % (esc(s), dt)
    return '"%s"' % esc(s)


def section(title):
    bar = "#" * 78
    return "\n%s\n#\n#    %s\n#\n%s\n\n" % (bar, title, bar)


# --------------------------------------------------------------------------
# Объектные (18) и датные (13) свойства — раздел 6 задания v2.2
# --------------------------------------------------------------------------
OBJ_PROPS = [
    ("regulatedBy", "Deviation", "RegulatoryDocument", "регулируется документом", "regulated by"),
    ("appliesTo", "AccuracyRequirement", "ConstructionObject", "применяется к", "applies to"),
    ("hasMeasurement", "ConstructionObject", "Measurement", "имеет измерение", "has measurement"),
    ("hasTolerance", "ConstructionObject", "Tolerance", "имеет допуск", "has tolerance"),
    ("hasDeviation", "ConstructionObject", "Deviation", "имеет отклонение", "has deviation"),
    ("exceedsTolerance", "Deviation", "Tolerance", "превышает допуск", "exceeds tolerance"),
    ("performedAtStage", "GeodeticWork", "ConstructionObject", "выполняется на стадии", "performed at stage"),
    ("documentedBy", "GeodeticWork", "TechnicalReport", "документируется", "documented by"),
    ("providesEvidenceFor", "Measurement", "TechnicalReport", "служит подтверждением для", "provides evidence for"),
    ("linkedToBIMElement", "ConstructionObject", "ifc:IfcProduct", "связан с элементом BIM", "linked to BIM element"),
    ("linkedToGISObject", "ConstructionObject", "GISObject", "связан с объектом ГИС", "linked to GIS object"),
    ("duplicatesRequirement", "skos:Concept", "skos:Concept", "дублирует требование", "duplicates requirement"),
    ("hasLegacyEquivalent", "skos:Concept", "skos:Concept", "имеет устаревший эквивалент", "has legacy equivalent"),
    ("replacesTerm", "skos:Concept", "skos:Concept", "заменяет термин", "replaces term"),
    ("hasCoordinateSystem", "ControlNetwork", "CoordinateSystem", "имеет систему координат", "has coordinate system"),
    ("hasHeightSystem", "ControlNetwork", "HeightSystem", "имеет систему высот", "has height system"),
    ("hasAccuracyRequirement", "GeodeticWork", "AccuracyRequirement", "имеет требование точности", "has accuracy requirement"),
    ("generatedFromSurvey", "CartographicProduct", "AsBuiltSurvey", "получен из съёмки", "generated from survey"),
]

DATA_PROPS = [
    ("measuredValue", "Deviation", "xsd:decimal", "измеренное значение", "measured value"),
    ("permittedValue", "Tolerance", "xsd:decimal", "допустимое значение", "permitted value"),
    ("toleranceValue", "Tolerance", "xsd:decimal", "значение допуска", "tolerance value"),
    ("unitOfMeasurement", "Measurement", "xsd:string", "единица измерения", "unit of measurement"),
    ("accuracyClass", "AccuracyRequirement", "xsd:string", "класс точности", "accuracy class"),
    ("coordinateValueX", "ControlPoint", "xsd:decimal", "координата X", "coordinate value X"),
    ("coordinateValueY", "ControlPoint", "xsd:decimal", "координата Y", "coordinate value Y"),
    ("elevationValue", "ControlPoint", "xsd:decimal", "отметка", "elevation value"),
    ("measurementDate", "Measurement", "xsd:date", "дата измерения", "measurement date"),
    ("clauseNumber", "RegulatoryDocument", "xsd:string", "пункт документа", "clause number"),
    ("documentStatus", "RegulatoryDocument", "xsd:string", "статус документа", "document status"),
    ("documentYear", "RegulatoryDocument", "xsd:gYear", "год документа", "document year"),
    ("canBeFormalizedAsRule", "AccuracyRequirement", "xsd:boolean", "формализуемо как правило", "can be formalized as rule"),
]

BRIDGES = [
    ("StructuralElement", "ifc:IfcBuildingElement"),
    ("ConstructionObject", "ifc:IfcProduct"),
    ("ConstructionGeodeticGrid", "ifc:IfcGrid"),
    ("ControlPoint", "ifc:IfcAnnotation"),
    ("ControlPoint", "geo:Feature"),
    ("ConstructionObject", "geo:SpatialObject"),
]

# Легаси-пары: (легаси local_name, цель local_name или None, текст historyNote)
LEGACY = [
    ("FieldLog", "FieldDocumentation", None),
    ("TrigonometricLevelling", None,
     "исторический эквивалент журнала измерения зенитных расстояний; целевой термин уточняется"),
    ("TacheometricSurvey", None,
     "журнал тахеометрической съёмки не имеет канонического эквивалента среди 119 терминов [VERIFY target]"),
]

# Дубли, объединённые в altLabel
ALT = {
    "ActualDeviation": ["фактическое отклонение геометрического параметра"],
    "GeodeticTraverse": ["теодолитный ход"],
    "TopographicPlan": ["план местности"],
}

# Термины без казахского источника (по умолчанию — экспертная проверка)
KK_SOURCE_ATTESTED = {"GeodeticControlNetwork", "StateGeodeticNetwork", "Levelling",
                      "Theodolite", "TopographicMap", "RoadPavement",
                      "CoordinateSystemWGS84", "Benchmark", "Misclosure",
                      "AccuracyClass", "RoadDiagnostics"}

# Переводы en, сделанные авторами (а не взятые из источника)
EN_AUTHORS_TRANSLATION = {t[1] for t in T if t[0] % 3 != 0}

THRESHOLD = {  # threshold_category (Р9)
    "LimitDeviation": "scalar",
    "CoordinateTransformation": "tabular",
    "AccuracyClass": "tabular",
    "PavementThickness": "tabular",
    "Misclosure": "traverse_length",
    "Settlement": "delegated",
    "Tilt": "delegated",
}


def write_main():
    o = io.StringIO()
    o.write(PREFIXES)
    o.write(section("Ontology"))
    o.write("""<http://ontogeo.kz/geodeticont-kz> rdf:type owl:Ontology ;
    owl:versionIRI <http://ontogeo.kz/geodeticont-kz/0.9-demo> ;
    owl:versionInfo "0.9-demo-synthetic" ;
    dcterms:title "GeodeticOnt-KZ (СИНТЕТИЧЕСКИЙ ДЕМОНАБОР)"@ru ;
    dcterms:title "GeodeticOnt-KZ (SYNTHETIC DEMO DATASET)"@en ;
    dcterms:license <https://creativecommons.org/licenses/by/4.0/> ;
    dcterms:created "2026-09-20"^^xsd:date ;
    rdfs:comment "ВНИМАНИЕ: набор сгенерирован скриптом build/make_demo_data.py для проверки визуализатора OntoLens. Определения вымышлены и не являются нормативными. Реальный пакет GeodeticOnt-KZ собирается по заданию v2.2."@ru ;
    rdfs:comment "WARNING: synthetic dataset generated to exercise the OntoLens viewer. Definitions are invented and carry no normative force."@en .

""")

    # ---- object properties
    o.write(section("Object Properties"))
    for ln, dom, rng, ru, en in OBJ_PROPS:
        dom_s = dom if ":" in dom else ":" + dom
        rng_s = rng if ":" in rng else ":" + rng
        o.write("###  %s%s\n:%s rdf:type owl:ObjectProperty ;\n" % (NS, ln, ln))
        o.write("    rdfs:domain %s ;\n    rdfs:range %s ;\n" % (dom_s, rng_s))
        o.write("    skos:prefLabel %s ;\n" % lit(ru, "ru"))
        o.write("    skos:prefLabel %s .\n\n" % lit(en, "en"))

    o.write(section("Data Properties"))
    for ln, dom, rng, ru, en in DATA_PROPS:
        o.write("###  %s%s\n:%s rdf:type owl:DatatypeProperty ;\n" % (NS, ln, ln))
        o.write("    rdfs:domain :%s ;\n    rdfs:range %s ;\n" % (dom, rng))
        o.write("    skos:prefLabel %s ;\n" % lit(ru, "ru"))
        o.write("    skos:prefLabel %s .\n\n" % lit(en, "en"))

    # ---- external stubs
    o.write(section("External class stubs (bridge targets, no owl:imports)"))
    for iri in sorted({b[1] for b in BRIDGES}):
        o.write("%s rdf:type owl:Class .\n" % iri)
    o.write("\n")

    # ---- structural classes
    o.write(section("Structural classes (27)"))
    bridges_by_class = {}
    for c, ext in BRIDGES:
        bridges_by_class.setdefault(c, []).append(ext)
    for ln, parent, ru, en in STRUCTURAL:
        o.write("###  %s%s\n:%s rdf:type owl:Class ;\n" % (NS, ln, ln))
        parents = []
        if parent:
            parents.append(":" + parent)
        parents += bridges_by_class.get(ln, [])
        for p in parents:
            o.write("    rdfs:subClassOf %s ;\n" % p)
        o.write("    skos:prefLabel %s ;\n" % lit(ru, "ru"))
        o.write("    skos:prefLabel %s .\n\n" % lit(en, "en"))

    # ---- term classes
    o.write(section("Term classes (119) — punning owl:Class + skos:Concept"))
    legacy_src = {a: (b, c) for a, b, c in LEGACY}
    for tid, ln, blk, ru, en, kk, dru, den, doc in T:
        P = []
        for p in [":" + PARENT[ln]] + bridges_by_class.get(ln, []):
            P.append("rdfs:subClassOf %s" % p)
        P.append("skos:prefLabel %s" % lit(ru, "ru"))
        if en:
            P.append("skos:prefLabel %s" % lit(en, "en"))
        if kk:
            P.append("skos:prefLabel %s" % lit(kk, "kk"))
        for a in ALT.get(ln, []):
            P.append("skos:altLabel %s" % lit(a, "ru"))
        if dru:
            P.append("skos:definition %s" % lit(dru, "ru"))
        if den:
            P.append("skos:definition %s" % lit(den, "en"))
        P.append("dcterms:identifier %s" % lit(str(tid), dt="xsd:integer"))
        if doc:
            P.append("rdfs:isDefinedBy doc:%s" % doc)
            P.append("dcterms:source doc:%s" % doc)
        P.append("skos:inScheme :GeodeticOntKZScheme")
        if ln in EN_AUTHORS_TRANSLATION and en:
            P.append("skos:editorialNote %s" % lit(
                "English label and definition: authors' translation, not source-attested", "en"))
        if kk:
            P.append("skos:editorialNote %s" % lit(
                "Kazakh label: source-attested" if ln in KK_SOURCE_ATTESTED
                else "Kazakh label: expert-reviewed, not source-attested", "en"))
        if ln in ALT:
            P.append("skos:changeNote %s" % lit("merged duplicate entry", "en"))
        if ln in legacy_src:
            tgt, note = legacy_src[ln]
            if tgt:
                P.append(":hasLegacyEquivalent :%s" % tgt)
            if note:
                P.append("skos:historyNote %s" % lit(note, "ru"))
        if blk == 16:
            P.append("skos:scopeNote %s" % lit(
                "road-survey and diagnostics submodule; flagged by reviewers as lying "
                "at the edge of construction geodesy", "en"))
        if ln in THRESHOLD:
            P.append(":canBeFormalizedAsRule %s"
                     % ("true" if THRESHOLD[ln] == "scalar" else "false"))
        o.write("###  %s%s\n:%s rdf:type owl:Class , skos:Concept ;\n    %s .\n\n"
                % (NS, ln, ln, " ;\n    ".join(P)))

    # ---- scheme and collections
    o.write(section("Concept scheme and thematic blocks (16 skos:Collection)"))
    o.write(":GeodeticOntKZScheme rdf:type skos:ConceptScheme ;\n"
            "    skos:prefLabel %s ;\n    skos:prefLabel %s .\n\n"
            % (lit("Тематические блоки GeodeticOnt-KZ", "ru"),
               lit("GeodeticOnt-KZ thematic blocks", "en")))
    for b in range(1, 17):
        ru, en = BLOCK_NAMES[b]
        members = [t[1] for t in T if t[2] == b]
        import re as _re
        slug = "".join(w.capitalize() for w in _re.sub(r"[^A-Za-z0-9 ]", " ", en).split())
        cname = ":Block%02d_%s" % (b, slug)
        o.write("###  Block %02d\n%s rdf:type skos:Collection ;\n" % (b, cname))
        o.write("    skos:prefLabel %s ;\n" % lit("%d · %s" % (b, ru), "ru"))
        o.write("    skos:prefLabel %s ;\n" % lit("%d · %s" % (b, en), "en"))
        if b == 16:
            o.write("    skos:scopeNote %s ;\n" % lit(
                "road-survey and diagnostics submodule; flagged by reviewers as lying "
                "at the edge of construction geodesy", "en"))
        o.write("    skos:member %s .\n\n" % (" ,\n        ".join(":" + m for m in members)))

    path = os.path.join(DATA, "demo-geodeticont-kz.ttl")
    open(path, "w", encoding="utf-8", newline="\n").write(o.getvalue())
    return path


def write_docs():
    o = io.StringIO()
    o.write(PREFIXES)
    o.write(section("Regulatory documents (ABox, synthetic)"))
    for did, code, title, status, year, role in DOCS:
        o.write("###  %s%s\ndoc:%s rdf:type :RegulatoryDocument ;\n" % (DOCNS, did, did))
        o.write("    skos:prefLabel %s ;\n" % lit(code, "ru"))
        o.write("    dcterms:title %s ;\n" % lit(title, "ru"))
        o.write("    :documentStatus %s ;\n" % lit(status))
        if year:
            o.write("    :documentYear %s ;\n" % lit(str(year), dt="xsd:gYear"))
        o.write("    dcterms:identifier %s .\n\n" % lit(did))
    path = os.path.join(DATA, "demo-geodeticont-kz-docs.ttl")
    open(path, "w", encoding="utf-8", newline="\n").write(o.getvalue())
    return path


def write_shapes():
    o = io.StringIO()
    o.write(PREFIXES)
    o.write(section("SHACL shapes (1 full + 6 placeholders)"))
    o.write(""":DeviationShape rdf:type sh:NodeShape ;
    sh:targetClass :Deviation ;
    rdfs:label "Отклонение не превышает допустимого значения"@ru ;
    sh:property [
        sh:path :measuredValue ;
        sh:datatype xsd:decimal ;
        sh:lessThanOrEquals :permittedValue ;
        sh:message "measuredValue must not exceed permittedValue"@en ;
    ] .

:LimitDeviationShape rdf:type sh:NodeShape ;
    sh:targetClass :LimitDeviation ;
    rdfs:label "Предельное отклонение — скалярный порог"@ru ;
    sh:property [
        sh:path :permittedValue ;
        sh:datatype xsd:decimal ;
        sh:minCount 1 ;
    ] .

:AccuracyClassShape rdf:type sh:NodeShape ;
    sh:targetClass :AccuracyClass ;
    rdfs:comment "TODO: resolves to a table parameterised by accuracy class / network order; value not confirmed by expert (workbook sheet 2)"@en .

:CoordinateTransformationShape rdf:type sh:NodeShape ;
    sh:targetClass :CoordinateTransformation ;
    rdfs:comment "TODO: resolves to a table parameterised by zone and transformation parameters; value not confirmed by expert"@en .

:PavementThicknessShape rdf:type sh:NodeShape ;
    sh:targetClass :PavementThickness ;
    rdfs:comment "TODO: resolves to a table parameterised by nominal size range; value not confirmed by expert"@en .

:MisclosureShape rdf:type sh:NodeShape ;
    sh:targetClass :Misclosure ;
    rdfs:comment "TODO: limit is a function of traverse length; formula placeholder, not confirmed"@en .

:SettlementShape rdf:type sh:NodeShape ;
    rdfs:comment "TODO: limit delegated to geotechnical norms; no targetClass assigned yet"@en .
""")
    path = os.path.join(DATA, "demo-geodeticont-kz-shapes.ttl")
    open(path, "w", encoding="utf-8", newline="\n").write(o.getvalue())
    return path


# --------------------------------------------------------------------------
# «Дефектный» набор — воспроизводит типы ошибок, найденные в GeOnt-KZ.ttl
# --------------------------------------------------------------------------
GEONT_PREFIXES = """@prefix :        <http://ontogeo.kz/geont-kz#> .
@prefix owl:     <http://www.w3.org/2002/07/owl#> .
@prefix rdf:     <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs:    <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:     <http://www.w3.org/2001/XMLSchema#> .
@prefix skos:    <http://www.w3.org/2004/02/skos/core#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix ifc:     <http://www.buildingsmart-tech.org/ifcOWL/IFC4#> .
@prefix geocore: <http://www.geoscience.org/geocore#> .
@prefix ontolex: <http://www.w3.org/ns/lemon/ontolex#> .
"""

GEONT_TERMS = [
    # (local, parent(s), ru, kz, def_ru, provenance-literal)
    ("Soil", ["GeotechnicalEntity"], "грунт", "топырақ", "любая горная порода, почва или техногенное образование", "СН РК 5.01-01-2013"),
    ("Clay_soil", ["Soil"], "глинистый грунт", "сазды топырақ", "связный грунт с числом пластичности более единицы", "СН РК 5.01-01-2013"),
    ("Sandy_soil", ["Soil"], "песчаный грунт", "құмды топырақ", "несвязный грунт, содержащий менее 50 % частиц крупнее 2 мм", "СН РК 5.01-01-2013"),
    ("Anthropogenic_soil", ["Soil"], "антропогенный грунт", "антропогендік топырақ", "грунт, образованный в результате хозяйственной деятельности", "СН РК 5.01-01-2013"),
    ("Frozen_soil", ["Soil"], "мёрзлый грунт", "тоңды топырақ", "грунт, имеющий отрицательную температуру и содержащий лёд", "СП РК 5.01-102-2013"),
    ("Permafrost", ["Frozen_soil"], "многолетнемёрзлый грунт", "көпжылдық тоңды топырақ", "грунт, находящийся в мёрзлом состоянии не менее трёх лет", "СП РК 5.01-102-2013"),
    ("Loess", ["Clay_soil"], "лёссовый грунт", "лёсс топырағы", "пылеватый грунт, обладающий просадочностью при замачивании", "СН РК 5.01-01-2013"),
    ("Subsidence", ["Deformation"], "просадка", "шөгу", "деформация основания, возникающая при замачивании просадочного грунта", "СН РК 5.01-01-2013"),
    ("Settlement_geotech", ["Deformation"], "осадка", "отыру", "вертикальная деформация основания под нагрузкой", "СН РК 5.01-01-2013"),
    ("Heave", ["Deformation"], "пучение", "көтерілу", "подъём поверхности грунта при промерзании", "СП РК 5.01-102-2013"),
    ("Bearing_capacity", ["GeotechnicalProperty"], "несущая способность", "көтергіш қабілет", "", "СН РК 5.01-01-2013"),
    ("Youngs_modulus", ["GeotechnicalProperty"], "модуль деформации", "серпімділік модулі (бірінші типтегі серпімділік модулі)", "отношение приращения напряжения к приращению относительной деформации", "ГОСТ 12248-2010"),
    ("Poisson_ratio", ["GeotechnicalProperty"], "коэффициент Пуассона", "Пуассон коэффициенті", "отношение поперечной деформации к продольной", "ГОСТ 12248-2010"),
    ("Cohesion", ["GeotechnicalProperty"], "удельное сцепление", "меншікті ілінісу", "характеристика прочности грунта на сдвиг при нулевом нормальном напряжении", "ГОСТ 12248-2010"),
    ("Friction_angle", ["GeotechnicalProperty"], "угол внутреннего трения", "ішкі үйкеліс бұрышы", "характеристика прочности грунта на сдвиг", "ГОСТ 12248-2010"),
    ("Porosity", ["GeotechnicalProperty"], "пористость", "кеуектілік", "отношение объёма пор к общему объёму грунта", "ГОСТ 5180-2015"),
    ("Water_content", ["GeotechnicalProperty"], "влажность грунта", "топырақ ылғалдылығы", "отношение массы воды к массе сухого грунта", "ГОСТ 5180-2015"),
    ("Density", ["GeotechnicalProperty"], "плотность грунта", "топырақ тығыздығы", "отношение массы грунта к занимаемому им объёму", "ГОСТ 5180-2015"),
    ("Anisotropy", ["GeotechnicalProperty"], "анизотропия", "анизотропия", "зависимость свойств грунта от направления", "ГОСТ 12248-2010"),
    # категориальная ошибка иерархии: свойство как подкласс явления
    ("Anisotropic_material", ["Anisotropy"], "анизотропный материал", "анизотропты материал", "материал, свойства которого зависят от направления", "ГОСТ 12248-2010"),
    ("Foundation", ["StructuralEntity"], "фундамент", "іргетас", "часть сооружения, передающая нагрузку на основание", "СП РК 5.01-101-2013"),
    ("Pile_foundation", ["Foundation"], "свайный фундамент", "қадалы іргетас", "фундамент, состоящий из свай и объединяющего их ростверка", "СП РК 5.01-103-2013"),
    ("Slab_foundation", ["Foundation"], "плитный фундамент", "тақталы іргетас", "фундамент в виде сплошной плиты под всем сооружением", "СП РК 5.01-101-2013"),
    ("Pile", ["StructuralEntity", "Foundation"], "свая", "қада", "стержневой элемент, передающий нагрузку на грунт основания", "СП РК 5.01-103-2013"),
    ("Retaining_wall", ["StructuralEntity"], "подпорная стена", "тірек қабырға", "сооружение, удерживающее массив грунта от обрушения", "СП РК 5.01-104-2013"),
    ("Excavation", ["GeotechnicalWork"], "котлован", "қазаншұңқыр", "выемка в грунте, устраиваемая для возведения подземной части", "СП РК 5.01-101-2013"),
    ("Slope", ["GeotechnicalEntity"], "откос", "еңіс", "наклонная поверхность, ограничивающая выемку или насыпь", "СП РК 5.01-104-2013"),
    ("Slope_stability", ["GeotechnicalProperty"], "устойчивость откоса", "еңістің орнықтылығы", "", "СП РК 5.01-104-2013"),
    ("Dewatering", ["GeotechnicalWork"], "водопонижение", "суды төмендету", "искусственное понижение уровня подземных вод", "СП РК 5.01-101-2013"),
    ("Soil_improvement", ["GeotechnicalWork"], "закрепление грунта", "топырақты бекіту", "изменение свойств грунта техническими средствами", "СП РК 5.01-105-2013"),
    ("Static_load_test", ["FieldTest"], "статическое испытание сваи", "қаданы статикалық сынау", "испытание сваи ступенчато возрастающей нагрузкой", "ГОСТ 5686-2012"),
    ("Dynamic_load_test", ["FieldTest"], "динамическое испытание сваи", "қаданы динамикалық сынау", "испытание сваи ударной нагрузкой", "ГОСТ 5686-2012"),
    ("Cone_penetration_test", ["FieldTest"], "статическое зондирование", "статикалық зондтау", "полевое испытание вдавливанием зонда в грунт", "ГОСТ 19912-2012"),
    ("Standard_penetration_test", ["FieldTest"], "динамическое зондирование", "динамикалық зондтау", "полевое испытание забивкой зонда в грунт", "ГОСТ 19912-2012"),
    ("Plate_load_test", ["FieldTest"], "испытание штампом", "штампен сынау", "полевое испытание грунта статической нагрузкой на штамп", "ГОСТ 20276-2012"),
    ("Borehole", ["FieldWork"], "скважина", "ұңғыма", "цилиндрическая горная выработка малого диаметра", "СП РК 1.02-102-2014"),
    ("Sampling", ["FieldWork"], "отбор проб", "сынама алу", "извлечение образцов грунта для лабораторных испытаний", "ГОСТ 12071-2014"),
    ("Seismic_microzoning", ["SeismicEntity"], "сейсмическое микрорайонирование", "сейсмикалық микроаудандастыру", "уточнение сейсмичности площадки с учётом грунтовых условий", "СП РК 2.03-30-2017"),
    ("Design_earthquake", ["SeismicEntity"], "расчётное землетрясение", "есептік жер сілкінісі", "землетрясение с параметрами, принимаемыми в расчёте конструкций", "СП РК 2.03-30-2017"),
    ("Seismic_intensity", ["SeismicEntity"], "сейсмическая интенсивность", "сейсмикалық қарқындылық", "мера силы сотрясения поверхности в баллах", "СП РК 2.03-30-2017"),
    ("Response_spectrum", ["SeismicEntity"], "спектр реакции", "әсер спектрі", "зависимость максимального отклика осциллятора от его периода", "СП РК 2.03-30-2017"),
    ("Ultimate_limit_states", ["LimitState"], "предельные состояния первой группы", "бірінші топтың шекті күйлері", "состояния, при достижении которых конструкция теряет несущую способность", "СН РК 5.03-01-2013"),
    # категориальная ошибка: воздействие как подкласс предельного состояния
    ("Accidental_actions", ["Ultimate_limit_states"], "особые воздействия", "арнайы жүктемелер", "воздействия, возникающие в исключительных случаях", "СН РК 5.03-01-2013"),
    ("Serviceability_limit_states", ["LimitState"], "предельные состояния второй группы", "екінші топтың шекті күйлері", "состояния, при которых нарушается нормальная эксплуатация", "СН РК 5.03-01-2013"),
    ("Action_load_effect", ["LoadEntity"], "усилие от воздействия", "әсерден туындайтын күш", "Конструкция элементтерінде кернеуді немесе олардың орын ауыстыруын тудыратын әсер", "СН РК 5.03-01-2013"),
    ("Permanent_action", ["LoadEntity"], "постоянное воздействие", "тұрақты жүктеме", "воздействие, действующее в течение всего срока службы", "СН РК 5.03-01-2013"),
    ("Variable_action", ["LoadEntity"], "переменное воздействие", "айнымалы жүктеме", "воздействие, изменяющееся во времени", "СН РК 5.03-01-2013"),
    ("Acceptance_test", ["QualityEntity"], "приёмочное испытание", "қабылдау сынағы", "испытание, проводимое при приёмке конструкции", "СН РК 5.03-01-2013"),
    ("Quality_control_geotech", ["QualityEntity"], "контроль качества", "сапаны бақылау", "проверка соответствия установленным требованиям", "СН РК 5.03-01-2013"),
    ("Monitoring_geotech", ["QualityEntity"], "геотехнический мониторинг", "геотехникалық мониторинг", "система наблюдений за состоянием основания и конструкций", "СП РК 5.01-101-2013"),
]

GEONT_ROOTS = ["GeotechnicalEntity", "GeotechnicalProperty", "GeotechnicalWork",
               "StructuralEntity", "FieldTest", "FieldWork", "SeismicEntity",
               "LimitState", "LoadEntity", "QualityEntity", "Deformation"]

# Классы-сироты (без rdfs:subClassOf) — воспроизводят «10 классов без родителя»
GEONT_ORPHANS = ["Geotechnical_category", "Soil_classification_system",
                 "Laboratory_test", "Engineering_geology", "Hydrogeology",
                 "Groundwater_level", "Site_investigation_report"]

# Свойства: часть без домена/диапазона, часть без метки, часть не используется
GEONT_PROPS = [
    ("hasSoilType", "Soil", "Soil", "тип грунта"),
    ("hasStrength", None, None, "прочность"),
    ("hasIceContent", None, None, None),
    ("isLocatedIn", "Borehole", None, "расположен в"),
    ("hasTestResult", None, "FieldTest", None),
    ("relatesToDocument", None, None, None),
    ("hasSubsoil", "Foundation", "Soil", None),
    ("measuredAt", None, None, "измерено на"),
]


def write_geont():
    o = io.StringIO()
    o.write(GEONT_PREFIXES)
    o.write(section("Ontology"))
    o.write("""<http://ontogeo.kz/geont-kz> rdf:type owl:Ontology ;
    owl:imports <http://www.w3.org/2004/02/skos/core> ;
    owl:imports <http://www.buildingsmart-tech.org/ifcOWL/IFC4> ;
    owl:versionInfo "0.4-demo-defective" ;
    rdfs:label "GeOnt-KZ (СИНТЕТИЧЕСКИЙ ДЕФЕКТНЫЙ ДЕМОНАБОР)"@ru ;
    rdfs:comment "ВНИМАНИЕ: сгенерировано build/make_demo_data.py. Набор намеренно воспроизводит типы дефектов, найденные в настоящем GeOnt-KZ.ttl (тег kz вместо kk, классы-сироты, множественные родители, провенанс литералом, свойства без домена и диапазона, категориальные ошибки иерархии). Определения вымышлены."@ru .

""")
    o.write(section("Object Properties"))
    for ln, dom, rng, ru in GEONT_PROPS:
        o.write("###  http://ontogeo.kz/geont-kz#%s\n:%s rdf:type owl:ObjectProperty" % (ln, ln))
        if dom:
            o.write(" ;\n    rdfs:domain :%s" % dom)
        if rng:
            o.write(" ;\n    rdfs:range :%s" % rng)
        if ru:
            o.write(" ;\n    rdfs:label %s" % lit(ru, "kz"))
        o.write(" .\n\n")

    o.write(section("Data Properties"))
    for ln, ru in [("hasValue", "значение"), ("hasUnit", None), ("hasDepth", "глубина")]:
        o.write("###  http://ontogeo.kz/geont-kz#%s\n:%s rdf:type owl:DatatypeProperty" % (ln, ln))
        if ru:
            o.write(" ;\n    rdfs:label %s" % lit(ru, "ru"))
        o.write(" .\n\n")

    o.write(section("Classes"))
    # корневые (с меткой, без определения)
    for r in GEONT_ROOTS:
        o.write("###  http://ontogeo.kz/geont-kz#%s\n:%s rdf:type owl:Class ;\n"
                "    rdfs:label %s .\n\n" % (r, r, lit(r.replace("_", " "), "en")))
    # сироты
    for i, r in enumerate(GEONT_ORPHANS):
        o.write("###  http://ontogeo.kz/geont-kz#%s\n:%s rdf:type owl:Class" % (r, r))
        if i < len(GEONT_ORPHANS) - 2:  # два класса вовсе без метки
            o.write(" ;\n    rdfs:label %s" % lit(r.replace("_", " ").lower(), "ru"))
            o.write(" ;\n    rdfs:label %s" % lit(r.replace("_", " ").lower(), "kz"))
        o.write(" .\n\n")
    # термины
    for ln, parents, ru, kz, dru, prov in GEONT_TERMS:
        o.write("###  http://ontogeo.kz/geont-kz#%s\n:%s rdf:type owl:Class ;\n" % (ln, ln))
        for p in parents:
            o.write("    rdfs:subClassOf :%s ;\n" % p)
        o.write("    rdfs:label %s ;\n" % lit(ru, "ru"))
        o.write("    rdfs:label %s ;\n" % lit(kz, "kz"))          # ← дефект: тег kz
        if dru:
            o.write("    rdfs:comment %s ;\n" % lit(dru, "ru"))
            o.write("    rdfs:comment %s ;\n" % lit(dru, "kz"))   # ← дефект
        o.write("    rdfs:isDefinedBy %s .\n\n" % lit(prov))      # ← дефект: провенанс литералом
    # мосты к внешним онтологиям
    o.write(section("Bridges"))
    for c, ext in [("Foundation", "ifc:IfcFooting"), ("Pile", "ifc:IfcPile"),
                   ("Retaining_wall", "ifc:IfcWall"), ("Borehole", "geocore:Borehole"),
                   ("Soil", "geocore:GeologicUnit")]:
        o.write(":%s rdfs:subClassOf %s .\n" % (c, ext))
    o.write("\n")
    # ontolex-концепты с провенансом (как в настоящем GeOnt-KZ)
    o.write(section("Lexical concepts (provenance hangs here, not on classes)"))
    for ln, parents, ru, kz, dru, prov in GEONT_TERMS[:12]:
        o.write(":%s_Concept rdf:type owl:NamedIndividual , ontolex:LexicalConcept ;\n"
                "    rdfs:label %s ;\n"
                "    rdfs:isDefinedBy %s .\n\n" % (ln, lit(ru, "kz"), lit(prov)))
    path = os.path.join(DATA, "demo-legacy-geont.ttl")
    open(path, "w", encoding="utf-8", newline="\n").write(o.getvalue())
    return path


if __name__ == "__main__":
    for p in (write_main(), write_docs(), write_shapes(), write_geont()):
        print("%8d  %s" % (os.path.getsize(p), os.path.relpath(p, ROOT)))
