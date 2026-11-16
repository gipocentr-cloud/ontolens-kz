/**
 * Палитра и типографика — по мокапу «Мокап интерфейса OntoLens»
 * (артборд «Принципы и палитра»).
 * Шрифты подключаются локально, если установлены; иначе системные —
 * сетевых обращений нет (раздел 6 ТЗ).
 */
export const CSS = `
:root{
  --ink:#16181C; --ink-2:#24262A; --ink-3:#33302B; --muted:#5A5750; --muted-2:#6B675E;
  --paper:#F2F1EC; --paper-2:#FBFAF6; --white:#FFFFFF;
  --line:#DAD6CB; --line-2:#E0DCD2; --line-3:#C9C4B8;
  --accent:#C2410C; --teal:#2F6F7E; --teal-d:#1F4E59; --green:#3F7A4E;
  --amber:#B9762C; --red:#A33A32; --grey:#6B7280; --neutral:#D6D3CC;
  --sans:"PT Sans","Segoe UI",system-ui,-apple-system,sans-serif;
  --serif:"PT Serif",Georgia,"Times New Roman",serif;
  --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
[hidden]{display:none!important}
html,body{height:100%}
body{margin:0;font-family:var(--sans);font-size:14px;color:var(--ink);background:var(--paper);
  -webkit-font-smoothing:antialiased}
button,input,select,textarea{font-family:inherit;font-size:inherit;color:inherit}
button{cursor:pointer}
a{color:var(--teal)} a:hover{color:var(--teal-d)}
.mono{font-family:var(--mono)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

/* ---------- каркас ---------- */
html,body{height:100%}
#app{display:flex;flex-direction:column;height:100%;min-height:100%;overflow:hidden}
.topbar{height:56px;flex-shrink:0;display:flex;align-items:center;gap:12px;padding:0 14px;
  background:var(--ink);color:var(--paper)}
.brand{display:flex;align-items:baseline;gap:9px}
.brand b{font-family:var(--serif);font-size:20px;font-weight:700;letter-spacing:.2px}
.brand span{font-size:12px;color:#A8A49B}
.chip{display:flex;align-items:center;gap:7px;padding:5px 10px;background:#26282D;border-radius:6px;
  font-family:var(--mono);font-size:12px;color:#E4E1D8;white-space:nowrap;flex-shrink:1;
  min-width:90px;max-width:240px;overflow:hidden}
.chip.warn{background:#3A2520;border:1px solid #7A3B2A;color:#F0C4B4;font-family:var(--sans);flex-shrink:0}
button.chip{border:0;font:inherit;font-family:var(--mono)}
button.chip:hover{background:#34373D;color:#fff}
button.chip.warn:hover{background:#4A2E27;border-color:#9A4A34;color:#FFD9CB}
button.chip.warn::after{content:"›";margin-left:2px;opacity:.7}
.iconbtn{width:28px;height:28px;display:flex;align-items:center;justify-content:center;
  background:#26282D;border:1px solid #3A3D44;border-radius:50%;color:#CFCBC2;font-size:14px;flex-shrink:0}
.iconbtn:hover{background:#34373D;color:#fff}
.navtabs{display:flex;gap:2px}
.navtabs button{padding:6px 14px;background:transparent;border:0;border-radius:5px;color:#CFCBC2;font-size:13px}
.navtabs button[aria-selected="true"]{background:#26282D;color:var(--paper);font-weight:700}
.navtabs button:hover{color:#fff}
.spacer{flex-grow:1}
.searchbox{display:flex;align-items:center;gap:8px;padding:6px 12px;background:#26282D;
  border:1px solid #3A3D44;border-radius:6px;width:min(340px,24vw);flex-shrink:1;min-width:130px}
.searchbox input{flex-grow:1;border:0;background:transparent;color:var(--paper);outline:none;min-width:0}
.searchbox input::placeholder{color:#A19D94}
.searchbox .hint{font-size:11px;color:#A8A49B;white-space:nowrap}
.seg{display:flex;align-items:center;gap:3px;padding:3px;background:#26282D;border-radius:6px}
.seg button{border:0;border-radius:4px;padding:5px 10px;background:transparent;color:#CFCBC2;font-size:13px}
.seg button[aria-pressed="true"]{background:var(--accent);color:#fff;font-weight:700}
.who{display:flex;align-items:center;gap:8px;padding-left:12px;border-left:1px solid #3A3D44;font-size:13px;color:#CFCBC2;flex-shrink:0}

.crumbs{height:40px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;
  gap:12px;padding:0 16px;background:var(--paper-2);border-bottom:1px solid var(--line);font-size:13px;color:var(--muted)}
.crumbs .path{display:flex;align-items:center;gap:8px;min-width:0;overflow:hidden;white-space:nowrap}
.crumbs .path b{color:var(--ink)}
.crumbs button.link{background:none;border:0;color:var(--muted);padding:0;text-decoration:none}
.crumbs button.link:hover{color:var(--ink);text-decoration:underline}
.pill{padding:2px 8px;background:#EDE9DC;border-radius:10px;font-size:12px;color:var(--muted);white-space:nowrap}

.main{flex-grow:1;display:flex;min-height:0}
.left{width:310px;flex-shrink:0;display:flex;flex-direction:column;background:var(--paper-2);
  border-right:1px solid var(--line);min-height:0}
.center{flex-grow:1;display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--paper)}
.right{width:340px;flex-shrink:0;display:flex;flex-direction:column;background:var(--paper-2);
  border-left:1px solid var(--line);min-height:0}

.tabs{display:flex;gap:2px;padding:10px 12px 0 12px;flex-shrink:0}
.tabs button{padding:7px 13px;background:transparent;border:0;border-radius:6px 6px 0 0;font-size:13px;color:var(--muted)}
.tabs button[aria-selected="true"]{background:var(--white);border:1px solid var(--line);
  border-bottom-color:var(--white);font-weight:700;color:var(--ink)}
.scroll{overflow:auto;flex-grow:1;min-height:0}
.scroll::-webkit-scrollbar{width:10px;height:10px}
.scroll::-webkit-scrollbar-thumb{background:#D5D1C6;border-radius:5px;border:3px solid var(--paper-2)}

/* ---------- дерево и списки ---------- */
.tree{padding:4px 8px 16px}
.row{display:flex;align-items:center;gap:7px;padding:5px 8px;border-radius:5px;width:100%;
  background:none;border:0;text-align:left;font-size:13px;color:var(--ink-3);line-height:1.3}
.row:hover{background:#EEEBE1}
.row[aria-current="true"]{background:#F6EEE6;border:1px solid #E8C3A7;font-weight:700;color:var(--ink)}
.row .twist{width:14px;flex-shrink:0;color:var(--muted-2);font-size:10px;text-align:center}
.row .name{flex-grow:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .num{font-family:var(--mono);font-size:11px;color:var(--muted);flex-shrink:0}
.row .num.fallback{color:#8B7BA8;background:#F1EDF6;border-radius:6px;padding:0 4px}
.row .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;background:var(--neutral)}
.row .dot.structural{border-radius:2px;background:#94A3B8}
.row .dot.term{background:var(--neutral)}
.row .dot.external{background:#8B7BA8;border-radius:0;transform:rotate(45deg);width:7px;height:7px}
.row .dot.property{background:var(--amber);border-radius:2px}
.blockrow{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:5px;width:100%;
  background:none;border:0;text-align:left}
.blockrow:hover{background:#EEEBE1}
.blockrow[aria-current="true"]{background:#FFF4EC;border:1px solid #E8C3A7}
.blockrow .idx{width:18px;font-family:var(--mono);font-size:11px;color:var(--muted-2);flex-shrink:0}
.blockrow .nm{flex-grow:1;font-size:13px;color:var(--ink-3);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.blockrow[aria-current="true"] .nm{font-weight:700;color:var(--ink)}
.blockrow .cnt{width:26px;text-align:right;font-family:var(--mono);font-size:11px;color:var(--muted)}
.sublist{padding:1px 8px 6px 30px;display:flex;flex-direction:column;gap:1px}

.panelhead{padding:12px 14px 6px;font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:var(--muted-2)}
.searchmeta{padding:6px 14px;font-size:12px;color:var(--muted);display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.searchmeta label{display:flex;align-items:center;gap:5px;cursor:pointer}
mark{background:#FDE8D5;color:inherit;padding:0 1px;border-radius:2px}

/* ---------- карточка ---------- */
.cardwrap{padding:14px 16px 0;flex-shrink:0}
.card{padding:16px 20px;background:var(--white);border:1px solid var(--line);border-radius:8px}
.card h1{margin:0 0 6px;font-family:var(--serif);font-size:24px;line-height:1.2;font-weight:700}
.langline{display:flex;flex-wrap:wrap;gap:5px 14px;font-size:13px;color:var(--muted)}
.langline .tag{font-family:var(--mono);font-size:11px;color:var(--muted-2);margin-right:4px}
.langline .missing{color:var(--red);font-style:italic}
.badge{display:inline-block;padding:1px 7px;background:#EDE9DC;border-radius:9px;font-size:10.5px;color:var(--muted);vertical-align:1px}
.badge.teal{background:#EAF2F3;color:var(--teal-d)}
.badge.green{background:#E8F0E9;color:#2E5A39}
.badge.amber{background:#FBEEDC;color:#6B4A18}
.badge.red{background:#F7E4E2;color:#8E2F27}
.cardhead{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.cardhead .meta{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0}
.defn{margin:14px 0 0;font-size:15px;line-height:1.5;color:var(--ink-2)}
.defn.sec{margin-top:8px;font-size:13px;color:var(--muted)}
.defn.none{color:var(--red);font-style:italic;font-size:13px}
.cardfoot{margin-top:14px;padding-top:12px;border-top:1px solid #EAE7DE;display:flex;flex-wrap:wrap;
  align-items:center;gap:8px 18px;font-size:12px;color:var(--muted)}
.cardfoot b{color:var(--ink);font-weight:400}
.shaclbox{margin-top:10px;padding:9px 12px;background:#EAF2F3;border-left:3px solid var(--teal);border-radius:0 5px 5px 0;font-size:12px}
.warnbox{margin-top:10px;padding:9px 12px;background:#FFF9F2;border-left:3px solid var(--amber);border-radius:0 5px 5px 0;font-size:12px;color:#5A4326}
.linkbtn{background:none;border:0;padding:0;color:var(--teal);text-decoration:underline;text-underline-offset:2px;font-size:inherit}
.linkbtn:hover{color:var(--teal-d)}

/* ---------- граф ---------- */
.graphbox{position:relative;flex-grow:1;margin:12px 16px 16px;background:var(--paper-2);
  border:1px solid var(--line);border-radius:8px;overflow:hidden;min-height:220px}
.graphbar{position:absolute;left:0;right:0;top:0;height:34px;display:flex;align-items:center;
  justify-content:space-between;gap:10px;padding:0 12px;font-size:12px;color:var(--muted);
  background:linear-gradient(var(--paper-2),rgba(251,250,246,0));z-index:2;pointer-events:none}
.graphbar > *{pointer-events:auto}
.graphbar .tools{display:flex;align-items:center;gap:6px}
.btn{padding:4px 9px;background:var(--white);border:1px solid var(--line-3);border-radius:6px;
  font-size:12px;color:var(--ink-3)}
.btn:hover{background:#F7F5EF}
.btn.primary{background:var(--ink);border-color:var(--ink);color:var(--paper);font-weight:700}
.btn.primary:hover{background:#2A2D33}
.graphviewport{position:absolute;inset:0;overflow:hidden;cursor:grab}
.graphviewport.drag{cursor:grabbing}
.graphviewport svg{position:absolute;left:0;top:0;transform-origin:0 0}
.ol-node:focus-visible rect{stroke:var(--accent);stroke-width:2.5}
.legend{position:absolute;left:12px;bottom:10px;display:flex;flex-wrap:wrap;gap:6px 14px;font-size:11px;
  color:var(--muted);background:rgba(251,250,246,.9);padding:4px 8px;border-radius:6px}
.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}

/* ---------- правая панель ---------- */
.side{padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.side h2{margin:0;font-family:var(--serif);font-size:17px;font-weight:700}
.side p.sub{margin:2px 0 0;font-size:12px;color:var(--muted-2)}
.kv{background:var(--white);border:1px solid var(--line);border-radius:8px;overflow:hidden}
.kv .r{display:flex;justify-content:space-between;gap:10px;padding:7px 12px;border-bottom:1px solid #F0EDE4;font-size:13px}
.kv .r:last-child{border-bottom:0}
.kv .r.wide{display:block}
.kv .r.muted,.kv .r.muted b{color:var(--muted-2)}
.kv .r b{font-family:var(--mono);font-size:12.5px;font-weight:400;text-align:right;white-space:nowrap}
.kv .r.wide b{display:block;text-align:left;white-space:normal;margin-top:3px;word-break:break-word}
.kv .r .ok{color:var(--green)} .kv .r .bad{color:var(--red)}
.note{padding:10px 12px;background:#FFF9F2;border:1px solid #E8D3B8;border-radius:8px;font-size:12px;line-height:1.45;color:#5A4326}
.note.info{background:#EFF4F5;border-color:#C3D8DC;color:#22505A}

/* ---------- диагностика ---------- */
.checklist{padding:8px 10px 20px}
.checkgroup{margin-bottom:12px}
.checkgroup > div.h{padding:2px 6px 6px;font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:var(--muted-2)}
.check{display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:5px;width:100%;background:none;border:0;text-align:left}
.check:hover{background:#EEEBE1}
.check[aria-current="true"]{background:#FFF4EC;border:1px solid #E8C3A7}
.check .sq{width:8px;height:8px;border-radius:2px;flex-shrink:0}
.check .sq.error{background:var(--red)} .check .sq.warn{background:var(--amber)}
.check .sq.info{background:var(--grey)} .check .sq.zero{background:var(--green)}
.check .t{flex-grow:1;font-size:13px;color:var(--ink-3);min-width:0}
.check[aria-current="true"] .t{font-weight:700;color:var(--ink)}
.check .n{font-family:var(--mono);font-size:12px;color:var(--ink-3)}
.check .n.zero{color:var(--muted-2)}
.diagmain{padding:16px 18px;display:flex;flex-direction:column;gap:12px;min-height:0;flex-grow:1}
.explain{padding:13px 16px;background:var(--white);border:1px solid var(--line);
  border-left:3px solid var(--amber);border-radius:0 8px 8px 0}
.explain.error{border-left-color:var(--red)} .explain.info{border-left-color:var(--grey)}
.explain.zero{border-left-color:var(--green)}
.explain h2{margin:0 0 5px;font-family:var(--serif);font-size:19px;font-weight:700}
.explain p{margin:0;font-size:13px;line-height:1.5;color:var(--muted)}
.table{flex-grow:1;min-height:0;background:var(--white);border:1px solid var(--line);border-radius:8px;
  overflow:hidden;display:flex;flex-direction:column}
.table .th,.table .td{display:flex;align-items:center;gap:12px;padding:8px 14px}
.table .th{background:#F7F6F1;border-bottom:1px solid var(--line-2);font-size:11px;
  letter-spacing:.4px;text-transform:uppercase;color:var(--muted-2);flex-shrink:0}
.table .body{overflow:auto;flex-grow:1;min-height:0}
.table .td{border-bottom:1px solid #F0EDE4;font-size:13px;width:100%;background:none;border-left:0;border-right:0;border-top:0;text-align:left}
.table .td:hover{background:#FAF9F4}
.table .c1{width:44%;flex-shrink:0;font-family:var(--mono);font-size:12px;color:var(--ink);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.table .c2{flex-grow:1;color:var(--ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.table .foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 14px;
  background:#F7F6F1;border-top:1px solid var(--line-2);font-size:12px;color:var(--muted-2);flex-shrink:0}
.empty{padding:26px;text-align:center;color:var(--muted-2);font-size:13px}


/* ---------- 5.4 оценки: цвет + форма ---------- */
.dot{display:inline-block;width:8px;height:8px;flex-shrink:0;border-radius:50%;background:var(--neutral)}
.dot.v-ok{background:var(--green);border-radius:50%}
.dot.v-fix{background:var(--amber);border-radius:1px}
.dot.v-delete{background:var(--red);border-radius:0;
  clip-path:polygon(20% 0,50% 30%,80% 0,100% 20%,70% 50%,100% 80%,80% 100%,50% 70%,20% 100%,0 80%,30% 50%,0 20%)}
.dot.v-not_my_domain{background:var(--grey);height:3px;border-radius:2px}
.dot.v-unclear{background:transparent;border:2px solid var(--teal,#2F6F7E);border-radius:50%;width:6px;height:6px}
.dot.v-duplicate{background:#7C5AA6;border-radius:1px;transform:rotate(45deg);width:7px;height:7px}
.dot.unreviewed{background:transparent;border:1.5px solid #B5AFA2}
.bprog{width:40px;height:5px;background:#E0DCD2;border-radius:3px;overflow:hidden;display:flex;flex-shrink:0}
.bprog i{display:block;height:100%}
.num.remarks{color:#6B4A18;background:#FBEEDC;border-radius:6px;padding:0 4px}
.progress-chip{border:0;background:#26282D;border-radius:6px;padding:5px 9px;font-family:var(--mono);
  font-size:12.5px;color:#8FBF9B;white-space:nowrap}
.progress-chip:hover{background:#34373D;color:#B7E2C1}
.right .tabs{padding:10px 12px 0;border-bottom:1px solid var(--line)}
.right .tabs button[aria-selected="true"]{margin-bottom:-1px}
.rv-wrap{display:flex;flex-direction:column;flex-grow:1;min-height:0}
.rv{gap:11px}
.rv-field{display:flex;flex-direction:column;gap:4px}
.rv-field label{font-size:12px;color:var(--muted)}
.rv-field input,.rv-field textarea{width:100%;padding:7px 10px;border:1px solid var(--line-3);border-radius:6px;
  background:var(--white);font-size:13px;color:var(--ink-2);resize:vertical}
.rv-field input:focus,.rv-field textarea:focus{outline:2px solid var(--accent);outline-offset:0;border-color:transparent}
.rv-lang{display:flex;align-items:center;gap:7px}
.rv-lang .tag{width:20px;font-size:10.5px;color:var(--muted-2)}
.rv-verdicts{display:flex;flex-direction:column;gap:5px}
.rv-verdict{display:flex;align-items:center;gap:9px;padding:7px 10px;background:var(--white);
  border:1px solid var(--line);border-radius:6px;cursor:pointer;font-size:14px;color:var(--ink-3)}
.rv-verdict:hover{border-color:var(--line-3)}
.rv-verdict input{margin:0}
.rv-verdict .t{flex-grow:1}
.rv-verdict kbd{font-family:var(--mono);font-size:10.5px;color:var(--muted-2);border:1px solid var(--line);
  border-radius:4px;padding:0 5px}
.rv-verdict.on{font-weight:700;color:var(--ink)}
.rv-verdict.rv-ok.on{background:#E8F0E9;border-color:var(--green)}
.rv-verdict.rv-fix.on{background:#FBF1E3;border-color:var(--amber)}
.rv-verdict.rv-delete.on{background:#F7E4E2;border-color:var(--red)}
.rv-verdict.rv-not_my_domain.on{background:#EEEFF1;border-color:var(--grey)}
.rv-verdict.rv-unclear.on{background:#E6F0F2;border-color:#2F6F7E}
.rv-verdict.rv-duplicate.on{background:#F0EBF6;border-color:#7C5AA6}
.rv-carry{display:flex;flex-direction:column;gap:6px;padding:10px 12px;background:#EFF4F5;border:1px solid #C3D8DC;
  border-radius:8px;font-size:12.5px;color:#22505A}
.rv-carry p{margin:0;line-height:1.45}
.rv-flash{padding:8px 11px;border-radius:6px;font-size:12.5px;line-height:1.45}
.rv-flash.bad{background:#FBEDEB;border:1px solid #E7BFB9;color:#7A2A20}
.rv-flash.warn{background:#FFF9F2;border:1px solid #E8D3B8;color:#5A4326}
.rv-flash.ok{background:#E8F0E9;border:1px solid #BCD3C1;color:#2E5A39}
.rv-foot{flex-shrink:0;padding:12px 16px 14px;border-top:1px solid var(--line-2);background:var(--paper-2)}
.rv-bar{height:6px;background:#E0DCD2;border-radius:3px;overflow:hidden}
.rv-bar i{display:block;height:100%;background:var(--green)}
.rv-store{margin:10px 0 0;font-size:11px;line-height:1.4;color:var(--muted-2)}
.rv-store.bad{color:var(--red)}
.seg.light{background:#E9E6DD;align-self:flex-start}
.seg.light button{color:var(--muted)}
.seg.light button[aria-pressed="true"]{background:var(--ink);color:var(--paper)}


/* ---------- 5.3 семантический зум ---------- */
.ol-graph .lod{opacity:0;pointer-events:none;transition:opacity .18s ease}
.ol-graph[data-lod="0"] .lod-0,.ol-graph[data-lod="1"] .lod-1,
.ol-graph[data-lod="2"] .lod-2,.ol-graph[data-lod="3"] .lod-3{opacity:1}
.ol-graph .hit{pointer-events:all}
.ol-node:focus-visible .hit{stroke:var(--accent);stroke-width:2.5;rx:8}
.zoomlvl{font-family:var(--mono);font-size:11px;color:var(--muted-2)}
@media (prefers-reduced-motion:reduce){.ol-graph .lod{transition:none}}

/* ---------- 5.3 карта «вы здесь» ---------- */
.minimap{position:absolute;z-index:3;width:240px;background:var(--white);border:1px solid var(--line-3);
  border-radius:8px;box-shadow:0 3px 12px rgba(22,24,28,.12);overflow:hidden;display:flex;flex-direction:column}
.minimap[data-corner="bottom-right"]{right:14px;bottom:14px}
.minimap[data-corner="bottom-left"]{left:14px;bottom:40px}
.minimap[data-corner="top-left"]{left:14px;top:44px}
.minimap[data-corner="top-right"]{right:14px;top:44px}
.minimap.expanded{width:min(56%,760px);top:44px!important;bottom:14px!important}
.minimap.expanded .mm-body{height:auto;flex-grow:1}
.mm-head{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:4px 6px 4px 9px;
  background:var(--paper);border-bottom:1px solid var(--line-2);cursor:default;user-select:none}
.mm-title{font-size:11px;color:var(--muted)}
.mm-tools{display:flex;gap:2px}
.mm-btn{border:0;background:transparent;border-radius:4px;padding:1px 5px;font-size:12px;color:var(--muted);line-height:1.2}
.mm-btn.mono{font-family:var(--mono);font-size:10px}
.mm-btn:hover{background:#E6E2D8;color:var(--ink)}
.mm-body{position:relative;height:180px;background:#F7F6F1;cursor:grab;touch-action:none}
.minimap.collapsed .mm-body{display:none}
.minimap.collapsed{width:auto}
.mm-canvas,.mm-svg{position:absolute;left:0;top:0}
.mm-svg{overflow:hidden}
.mm-island{font-family:var(--sans);font-size:9.5px;fill:#3A382F;pointer-events:none}
.minimap.expanded .mm-island{font-size:11px}
.mm-count{font-family:var(--mono);fill:#5A5750}
.minimap.expanded .mm-count{font-size:10.5px}
.mm-node{font-family:var(--sans);font-size:9px;fill:#33302B;pointer-events:none}
.mm-pathline{fill:none;stroke:var(--accent);stroke-width:1.4;stroke-opacity:.55}
.mm-trailline{fill:none;stroke:var(--accent);stroke-width:1.2;stroke-opacity:.35;stroke-dasharray:3 3}
.mm-trailpt{fill:var(--accent);cursor:pointer}
.mm-frame{fill:rgba(22,24,28,.03);stroke:#5A5750;stroke-width:1;stroke-dasharray:4 3;cursor:move}
.mm-here{fill:var(--accent);stroke:#fff;stroke-width:2}
.mm-plus{stroke:#fff;stroke-width:1.4}
.mm-halo{fill:none;stroke:var(--accent);stroke-opacity:.35;stroke-width:3}
.mm-halo.pulse{animation:mmpulse .9s ease-out 1}
@keyframes mmpulse{0%{stroke-opacity:.8;stroke-width:9}100%{stroke-opacity:.35;stroke-width:3}}
@media (prefers-reduced-motion:reduce){.mm-halo.pulse{animation:none}}
.mm-caption{position:absolute;left:7px;bottom:4px;font-size:9.5px;color:var(--muted-2);pointer-events:none;
  background:rgba(247,246,241,.85);padding:0 3px;border-radius:3px;max-width:90%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}

/* ---------- ошибки разбора ---------- */
.loadwarn{flex-shrink:0;display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;padding:8px 16px;
  background:#FBEDEB;border-bottom:1px solid #E7BFB9;color:#7A2A20;font-size:13px}
.loadwarn code{font-size:12px}
.loadwarn .btn{margin-left:auto;padding:1px 8px}

/* ---------- всплывающие подсказки ---------- */
.ol-tip{position:fixed;z-index:60;max-width:300px;padding:7px 10px;background:#16181C;color:#F2F1EC;
  border-radius:7px;font-size:12px;line-height:1.4;box-shadow:0 4px 14px rgba(22,24,28,.28);
  pointer-events:none;opacity:0;transition:opacity .12s}
.ol-tip.on{opacity:1}
.ol-tip b{display:block;font-weight:700;margin-bottom:2px}
@media (prefers-reduced-motion:reduce){.ol-tip{transition:none}}

/* ---------- модальные окна ---------- */
.ol-overlay{position:fixed;inset:0;z-index:55;background:rgba(22,24,28,.45);
  display:flex;align-items:center;justify-content:center;padding:24px}
.ol-modal{background:var(--paper-2);border:1px solid var(--line);border-radius:12px;
  width:min(760px,100%);max-height:86vh;display:flex;flex-direction:column;overflow:hidden}
.ol-modal header{display:flex;align-items:baseline;justify-content:space-between;gap:12px;
  padding:16px 20px 10px}
.ol-modal h2{margin:0;font-family:var(--serif);font-size:20px;font-weight:700}
.ol-modal .body{overflow:auto;padding:0 20px 4px;display:flex;flex-direction:column;gap:12px}
.ol-modal footer{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;
  padding:12px 20px 16px;border-top:1px solid var(--line-2);margin-top:8px;flex-shrink:0}
.helpstep{display:flex;gap:12px;align-items:flex-start}
.helpstep .txt{min-width:0}
.helpstep b{display:block;font-size:14px;margin-bottom:2px}
.helpstep p{margin:0;font-size:13px;line-height:1.5;color:var(--muted)}
.keys{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12.5px;color:var(--muted)}
.keys kbd{font-family:var(--mono);font-size:11.5px;background:var(--white);border:1px solid var(--line-3);
  border-bottom-width:2px;border-radius:5px;padding:1px 6px;margin-right:5px;color:var(--ink)}

/* ---------- стартовый экран ---------- */
.start{flex-grow:1;display:flex;align-items:center;justify-content:center;padding:32px}
.startcard{max-width:780px;width:100%;background:var(--white);border:1px solid var(--line);
  border-radius:12px;padding:32px 36px}
.startcard h1{margin:0 0 8px;font-family:var(--serif);font-size:28px;font-weight:700}
.startcard p.lead{margin:0 0 20px;font-size:15px;line-height:1.55;color:var(--muted)}
.dropzone{border:2px dashed var(--line-3);border-radius:10px;padding:26px;text-align:center;
  background:var(--paper-2);transition:border-color .12s,background .12s}
.dropzone.over{border-color:var(--accent);background:#FFF4EC}
.dropzone p{margin:8px 0 0;font-size:13px;color:var(--muted-2)}
.startrow{display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap}
.startcard.wide{max-width:980px}
.start{overflow:auto;align-items:flex-start}
.vault{margin:0 0 4px;padding:16px 18px;background:var(--paper-2);border:1px solid var(--line);border-radius:10px}
.vhead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.vhead .spacer{flex-grow:1}
h2.vh{margin:0;font-family:var(--serif);font-size:18px;font-weight:700}
.vroot{font-size:12px;color:var(--muted-2)}
.vnote{margin:10px 0 0;font-size:13px;line-height:1.5;color:var(--muted)}
.vgrant{display:flex;align-items:center;gap:12px;margin-top:12px;padding:10px 12px;background:#FFF4EC;border:1px solid #E8C3A7;border-radius:8px;font-size:13px}
.vdir{margin-top:14px}
.vdirh{display:flex;align-items:baseline;gap:10px;padding-bottom:6px;border-bottom:1px solid var(--line-2)}
.vdirh b{font-size:15px}
.vdirh .mono{font-size:11px;color:var(--muted-2)}
.vdirh span:last-child{margin-left:auto;font-size:12px;color:var(--muted-2)}
.vver{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"name btns" "meta btns";gap:2px 14px;align-items:center;
  padding:9px 10px;border-bottom:1px solid var(--line-2)}
.vver.latest{background:var(--white);border:1px solid var(--line);border-radius:8px;margin-top:6px}
.vvname{grid-area:name;display:flex;align-items:center;gap:8px;min-width:0}
.vvname .mono{font-size:13px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pill.vlast{background:#E6EFF1;color:var(--teal-d)}
.vmeta{grid-area:meta;font-size:12px;color:var(--muted-2)}
.vbtns{grid-area:btns;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.chip.vchip{font-family:var(--sans);max-width:360px}
.chip.vchip b{color:#fff;flex-shrink:0}
.chip.vchip span{color:#A8A49B;font-family:var(--mono);overflow:hidden;text-overflow:ellipsis}
.md{max-width:860px;font-size:13px;line-height:1.5}
.md h2{font-family:var(--serif);font-size:18px;margin:14px 0 6px}
.md h3{font-size:14px;margin:12px 0 4px}
.md p{margin:6px 0}
.md ul{margin:4px 0 8px;padding-left:20px}
.md pre{background:var(--paper);padding:8px;border-radius:6px;overflow:auto;font-size:12px}
table.mdt{border-collapse:collapse;margin:6px 0 10px;font-size:12px}
table.mdt th,table.mdt td{border:1px solid var(--line);padding:4px 7px;vertical-align:top;text-align:left}
table.mdt th{background:var(--paper)}
.startfoot{margin-top:18px;font-size:12px;color:var(--muted-2);line-height:1.5}
.errbox{margin-top:14px;padding:10px 13px;background:#FBEDEB;border:1px solid #E7BFB9;
  border-radius:8px;font-size:13px;color:#7A2A20;white-space:pre-wrap}

@media (max-width:1560px){ .brand span{display:none} }
.addfiles-icon{display:none}
@media (max-width:1400px){ .who .btn.addfiles{display:none} .addfiles-icon{display:flex} }
@media (max-width:1180px){ .navtabs button{padding:6px 10px} .chip{max-width:170px} }
@media (max-width:1280px){
  .left{width:270px} .right{width:300px}
  .searchbox{width:min(280px,22vw)}
}

.ol-toast{position:fixed;left:16px;bottom:16px;z-index:60;max-width:min(520px,calc(100vw - 32px));display:flex;gap:12px;align-items:center;
  background:#16181C;color:#F2F1EC;border-radius:8px;padding:10px 14px;font-size:13px;box-shadow:0 6px 24px rgba(0,0,0,.25)}
.ol-toast.bad{background:#A33A32}
.ol-toast .linkbtn{color:#F2C9A8;font-size:12.5px}
.whoami{font-size:12.5px;color:#CFCBC2;padding:4px 10px;border:1px solid #3A3D44;border-radius:6px;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis}
.previewbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:8px 16px;background:#FFF4E5;border-bottom:1px solid #E8C99A;font-size:13px}
.previewbar .spacer{flex:1}
.iconbtn.back{font-size:16px;margin-right:4px}
.whoami small{color:#A8A49B}
/* ---- корпус определений: коллизии, формализация, аксиомы (ТЗ v3.1) */
.tabcount{display:inline-block;margin-left:6px;padding:0 6px;border-radius:9px;background:var(--red);color:#fff;font-size:11px;font-weight:700}
.cx-stats{padding:6px 8px 10px;font-size:13px;display:flex;flex-direction:column;gap:3px}
.cx-stats b{font-family:var(--mono)}
.cx-bar{height:5px;background:var(--line-2);border-radius:3px;overflow:hidden;margin-top:4px}
.cx-bar span{display:block;height:100%;background:var(--teal)}
.cx-filters{flex-wrap:wrap;margin:0 6px 8px}
.cx-filters button{font-size:12px}
.cx-kind{display:block;padding:0 8px 8px;font-size:12px;color:var(--muted-2)}
.cx-kind select{max-width:210px}
.cx-row{align-items:flex-start}
.cx-row .sq{margin-top:5px}
.cx-sub{display:block;font-size:11.5px;color:var(--muted-2);margin-top:1px}
.cx-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;display:inline-block}
.cx-row .cx-dot{margin-top:5px}
.cx-export{display:flex;flex-direction:column;gap:6px;padding:0 6px}
.cx-export .btn{text-align:left}
.cx-main{gap:14px;max-width:1100px}
.cx-main>*{flex-shrink:0}
.cx-fform>button{align-self:flex-start}
.cx-head h2{margin:6px 0 4px;font-family:var(--serif);font-size:20px;line-height:1.3}
.cx-badges{display:flex;gap:6px;flex-wrap:wrap}
.cx-badge{padding:2px 8px;border-radius:4px;background:#ECE9E0;font-size:12px;color:var(--ink-3)}
.cx-badge.f-confirmed{background:#E3EFE6;color:var(--green)} .cx-badge.f-draft{background:#FFF1DE;color:#7A4E14}
.cx-yield{margin:4px 0 0;font-size:13.5px}
.cx-pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}
.cx-def{background:var(--white);border:1px solid var(--line);border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;gap:6px}
.cx-doc{font-size:12.5px;color:var(--muted)}
.cx-doc b{color:var(--ink)}
.cx-term{font-weight:700;font-size:14px}
.cx-term span{font-weight:400;color:var(--muted-2);font-size:12.5px}
.cx-text{margin:0;font-family:var(--serif);font-size:14.5px;line-height:1.5}
.cx-text.big{font-size:16px;background:var(--white);border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin-top:8px}
.cx-text mark{background:#FCE3C8;color:inherit;border-radius:2px;padding:0 1px}
.cx-formal{font-size:12.5px;color:var(--ink-3);border-top:1px dashed var(--line);padding-top:6px}
.cx-h3{margin:6px 0 0;font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted-2)}
.cx-proof{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px}
.cx-step{background:var(--white);border:1px solid var(--line);border-left:4px solid var(--line-3);border-radius:6px;padding:9px 12px;font-size:13.5px;line-height:1.5}
.cx-step.t-premise{border-left-color:var(--teal)} .cx-step.t-axiom{border-left-color:#7A5AA8}
.cx-step.t-step{border-left-color:var(--amber)} .cx-step.t-conclusion{border-left-color:var(--red);background:#FFF8F5}
.cx-stype{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted-2);margin-bottom:2px}
.cx-step blockquote{margin:6px 0 0;padding:4px 10px;border-left:2px solid var(--line-3);font-family:var(--serif);color:var(--muted)}
.cx-src{margin-top:5px;font-size:12px;color:var(--muted-2)}
.cx-src.bad{color:var(--red)}
.cx-form{display:flex;flex-direction:column;gap:10px}
.cx-verdicts{display:flex;flex-direction:column;gap:4px}
.cx-v{display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--white);cursor:pointer;font-size:13px}
.cx-v span:nth-of-type(2){flex-grow:1}
.cx-v kbd{font-family:var(--mono);font-size:11px;color:var(--muted-2)}
.cx-v:has(input:checked){border-color:var(--accent);background:#FFF4EC}
.cx-field{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--muted)}
.cx-field textarea,.cx-field input,.cx-field select,.cx-fform select,.cx-fform input,.cx-fform textarea,.cx-inline input,.cx-inline select{font:inherit;font-size:13px;padding:6px 8px;border:1px solid var(--line-3);border-radius:6px;background:#fff;color:var(--ink);min-width:0}
.cx-fform{display:flex;flex-direction:column;gap:8px}
.cx-row2{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.cx-row2 select{flex:1;min-width:220px}
.cx-hint{font-size:12px;color:var(--muted-2)}
.cx-diffs{display:flex;flex-direction:column;gap:6px}
.cx-diff{display:grid;grid-template-columns:1fr 1fr .8fr 1.2fr auto;gap:6px;align-items:center}
.cx-new summary{cursor:pointer;font-size:12.5px;color:var(--teal)}
.cx-inline{display:flex;gap:6px;flex-wrap:wrap;padding:8px 0}
.cx-inline input{flex:1;min-width:180px}
.cx-fmark{width:14px;text-align:center;font-size:12px;flex-shrink:0;margin-top:1px}
.cx-fmark.f-confirmed{color:var(--green)} .cx-fmark.f-draft{color:var(--amber)} .cx-fmark.f-none{color:var(--muted-2)}
details.note summary{cursor:pointer}
details.note ul{margin:6px 0 0;padding-left:18px}
@media (max-width:900px){ .cx-diff{grid-template-columns:1fr 1fr} }
`;
